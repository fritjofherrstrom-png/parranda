'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createOsmExtractStore } = require('../server/place-candidates/osm-extract-store');
const { createOpenDataLoader, resolveDefaultOpenDataLoader } = require('../server/place-candidates/open-data-loader');
const { parsePolyFile, writeExtractStore } = require('../scripts/build-osm-extract');

const CENTRE = { lat: 46.0511, lng: 14.5051 };
const DATA_TIME = '2026-11-14T21:20:00Z';
const NOW = Date.parse('2026-11-15T12:00:00Z');
// A box around the test town, [lon, lat].
const COVERAGE = [{ outer: [[14.3, 45.9], [14.7, 45.9], [14.7, 46.2], [14.3, 46.2]], holes: [] }];

const KINDS = [
  { amenity: 'restaurant' }, { amenity: 'cafe' }, { amenity: 'bar' },
  { tourism: 'museum' }, { leisure: 'park' }, { tourism: 'viewpoint' },
];
function townElements() {
  const elements = [];
  for (let i = 0; i < 18; i += 1) {
    elements.push({
      type: 'node', id: 100 + i, lat: CENTRE.lat + (i % 6) * 0.0012, lon: CENTRE.lng + Math.floor(i / 6) * 0.0015,
      tags: { name: `Kraj ${i}`, ...KINDS[i % KINDS.length], opening_hours: 'Mo-Su 09:00-22:00' },
    });
  }
  elements.push({ type: 'way', id: 7, center: { lat: CENTRE.lat + 0.002, lon: CENTRE.lng }, tags: { name: 'Grad', historic: 'castle' } });
  // 20 km away: inside the extract, outside any walking circle.
  elements.push({ type: 'node', id: 999, lat: CENTRE.lat + 0.18, lon: CENTRE.lng, tags: { name: 'Daleč', amenity: 'cafe' } });
  return elements;
}
function makeStoreDir({ dataTimestamp = DATA_TIME, elements = townElements(), coverage = COVERAGE } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'osm-extract-'));
  writeExtractStore({ outDir: dir, region: 'testland', dataTimestamp, coverage, elements });
  return dir;
}
const plan = (overrides = {}) => ({
  anchors: [CENTRE], radiusM: 1500, perCategory: 6,
  groups: [
    { selectors: [{ key: 'amenity', value: 'restaurant' }], named: false },
    { selectors: [{ key: 'amenity', value: 'cafe' }], named: false },
    { selectors: [{ key: 'historic', value: 'castle' }], named: true },
  ],
  ...overrides,
});

test('the store answers a covered circle per group, nodes before ways, within the group size', () => {
  const store = createOsmExtractStore({ dir: makeStoreDir(), now: () => NOW });
  const answered = store.answer(plan({ perCategory: 3 }));
  assert.ok(answered, 'a covered place is answered');
  const names = answered.payload.elements.map(element => element.tags.name);
  assert.deepEqual(names, ['Kraj 0', 'Kraj 6', 'Kraj 12', 'Kraj 1', 'Kraj 7', 'Kraj 13', 'Grad']);
  assert.ok(!names.includes('Daleč'), 'a place outside the circle is not returned');
  assert.deepEqual(answered.snapshot, { region: 'testland', data_timestamp: '2026-11-14T21:20:00.000Z' });
});

test('a selector with a qualifier matches only elements that carry it', () => {
  const elements = [
    { type: 'node', id: 1, lat: CENTRE.lat, lon: CENTRE.lng, tags: { name: 'Novo', shop: 'clothes' } },
    { type: 'node', id: 2, lat: CENTRE.lat, lon: CENTRE.lng, tags: { name: 'Rabljeno', shop: 'clothes', second_hand: 'only' } },
  ];
  const store = createOsmExtractStore({ dir: makeStoreDir({ elements }), now: () => NOW });
  const answered = store.answer(plan({ groups: [{ selectors: [{ key: 'shop', value: 'clothes', and: { second_hand: 'only' } }], named: false }] }));
  assert.deepEqual(answered.payload.elements.map(element => element.tags.name), ['Rabljeno']);
});

test('the store does not answer a circle that leaves its coverage, an old snapshot, or a broken tile', () => {
  const dir = makeStoreDir();
  const store = createOsmExtractStore({ dir, now: () => NOW });
  assert.equal(store.answer(plan({ anchors: [{ lat: 45.905, lng: 14.5 }] })), null, 'circle crosses the edge');
  assert.equal(store.answer(plan({ anchors: [{ lat: 59.33, lng: 18.07 }] })), null, 'another country');
  assert.equal(store.answer(plan({ anchors: [CENTRE, { lat: 59.33, lng: 18.07 }] })), null, 'one of two anchors outside');

  const old = createOsmExtractStore({ dir, now: () => NOW + 31 * 24 * 60 * 60 * 1000 });
  assert.equal(old.answer(plan()), null, 'older than the allowed age');
  assert.equal(old.describe()[0].fresh, false);

  const tiles = path.join(dir, 'testland', 'tiles');
  fs.writeFileSync(path.join(tiles, fs.readdirSync(tiles)[0]), '{not json');
  const broken = createOsmExtractStore({ dir, now: () => NOW });
  const hitsBrokenTile = [plan({ radiusM: 5000 }), plan()].some(asked => broken.answer(asked) === null);
  assert.ok(hitsBrokenTile, 'an unreadable tile is not read as an empty neighbourhood');
});

test('no directory, an empty directory and a foreign manifest give no store', () => {
  assert.equal(createOsmExtractStore({}), null);
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'osm-extract-empty-'));
  assert.equal(createOsmExtractStore({ dir: empty }), null);
  fs.mkdirSync(path.join(empty, 'x'));
  fs.writeFileSync(path.join(empty, 'x', 'manifest.json'), JSON.stringify({ format: 'something-else' }));
  assert.equal(createOsmExtractStore({ dir: empty }), null);
});

test('the loader answers a covered place from the extract without asking the provider', async () => {
  let calls = 0;
  const loader = createOpenDataLoader({
    fetcher: async () => { calls += 1; throw new Error('provider must not be asked'); },
    localSource: createOsmExtractStore({ dir: makeStoreDir(), now: () => NOW }),
  });
  const records = await loader({ lat: CENTRE.lat, lng: CENTRE.lng });
  assert.equal(calls, 0);
  assert.match(records.loader_status, /^loaded:[1-9]/);
  assert.equal(records.loader_error, null);
  assert.ok(records.length >= 12, `a full town is supplied, got ${records.length}`);
  assert.ok(records.every(record => record.sources.some(source => source.provider === 'osm')));
  assert.ok(records.some(record => record.type === 'castle'), 'a way reaches the day through its centre');
  assert.equal(records.filter(record => record.opening_hours === 'Mo-Su 09:00-22:00').length, 18, 'opening hours come through');
});

test('the loader asks the provider for a place the extract does not cover', async () => {
  let calls = 0;
  const loader = createOpenDataLoader({
    fetcher: async () => {
      calls += 1;
      return { ok: true, status: 200, json: async () => ({ elements: [
        { type: 'node', id: 1, lat: 59.33, lon: 18.07, tags: { name: 'Kafé', amenity: 'cafe' } },
      ] }) };
    },
    localSource: createOsmExtractStore({ dir: makeStoreDir(), now: () => NOW }),
  });
  const records = await loader({ lat: 59.33, lng: 18.07 });
  assert.ok(calls >= 1, 'the provider is asked as before');
  assert.equal(records[0].name, 'Kafé');
});

test('the default loader uses the extract only when its directory is configured', async () => {
  const realFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; return { ok: false, status: 502 }; };
  try {
    const dir = makeStoreDir({ dataTimestamp: new Date(Date.now() - 3600 * 1000).toISOString() });
    const withExtract = resolveDefaultOpenDataLoader({ PARRANDA_OPEN_DATA_LOADER: 'enabled', PARRANDA_OSM_EXTRACT_DIR: dir });
    const covered = await withExtract({ lat: CENTRE.lat, lng: CENTRE.lng });
    assert.equal(calls, 0, 'a covered place asks no provider');
    assert.ok(covered.length >= 12);

    const without = resolveDefaultOpenDataLoader({ PARRANDA_OPEN_DATA_LOADER: 'enabled' });
    const asked = await without({ lat: CENTRE.lat, lng: CENTRE.lng });
    assert.ok(calls >= 1, 'without the directory the provider is asked, as today');
    assert.equal(asked.length, 0);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('a polygon file becomes coverage rings, with holes kept apart', () => {
  const coverage = parsePolyFile([
    'testland', '1', '   1.0E+01   4.0E+01', '   1.2E+01   4.0E+01', '   1.2E+01   4.2E+01', '   1.0E+01   4.0E+01', 'END',
    '!2', '  10.5 40.2', '  10.7 40.2', '  10.7 40.4', '  10.5 40.2', 'END', 'END', '',
  ].join('\n'));
  assert.equal(coverage.length, 1);
  assert.deepEqual(coverage[0].outer[1], [12, 40]);
  assert.equal(coverage[0].holes.length, 1);
  assert.throws(() => parsePolyFile('nothing useful'), /polygon/);
});

test('the written store keeps only named, mapped places and puts each in its tile', () => {
  const dir = makeStoreDir({ elements: [
    ...townElements(),
    { type: 'node', id: 5000, lat: CENTRE.lat, lon: CENTRE.lng, tags: { amenity: 'cafe' } },
    { type: 'node', id: 5001, lat: CENTRE.lat, lon: CENTRE.lng, tags: { name: 'Banka', amenity: 'bank' } },
  ] });
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'testland', 'manifest.json'), 'utf8'));
  assert.equal(manifest.format, 'parranda-osm-extract-v1');
  assert.equal(manifest.element_count, 20);
  assert.match(manifest.attribution, /OpenStreetMap/);
  const stored = fs.readdirSync(path.join(dir, 'testland', 'tiles'))
    .flatMap(file => JSON.parse(fs.readFileSync(path.join(dir, 'testland', 'tiles', file), 'utf8')));
  assert.equal(stored.length, 20);
  assert.ok(!stored.some(element => element.id === 5000 || element.id === 5001));
});

test('a day answered from the extract says so, with the snapshot it came from', async () => {
  const snapshot = { region: 'testland', data_timestamp: '2026-11-14T21:20:00.000Z' };
  const { createSourceCache } = require('../server/place-candidates/source-cache');
  let calls = 0;
  const loader = createOpenDataLoader({
    fetcher: async () => {
      calls += 1;
      return { ok: true, status: 200, json: async () => ({ elements: [
        { type: 'node', id: 1, lat: 59.33, lon: 18.07, tags: { name: 'Kafé', amenity: 'cafe' } },
      ] }) };
    },
    cache: createSourceCache({ namespace: 'overpass' }),
    localSource: createOsmExtractStore({ dir: makeStoreDir(), now: () => NOW }),
  });
  const covered = await loader({ lat: CENTRE.lat, lng: CENTRE.lng });
  assert.deepEqual(covered.loader_metadata.map_snapshot, snapshot);
  const again = await loader({ lat: CENTRE.lat, lng: CENTRE.lng });
  assert.deepEqual(again.loader_metadata.map_snapshot, snapshot, 'the label survives the request cache');
  assert.equal(calls, 0);

  const live = await loader({ lat: 59.33, lng: 18.07 });
  assert.equal(live.loader_metadata.map_snapshot ?? null, null, 'a provider answer carries no snapshot label');
});
