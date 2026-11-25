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

const DAY_MS = 24 * 60 * 60 * 1000;

test('a store keeps answering however old its snapshot is, unless an age limit is set', () => {
  const dir = makeStoreDir();
  // No limit by default: an old snapshot is still far better than no map
  // evidence, which is what the provider fallback gives when Overpass fails.
  const yearLater = createOsmExtractStore({ dir, now: () => NOW + 400 * DAY_MS });
  assert.ok(yearLater.answer(plan()), 'a 400-day-old snapshot still answers');
  assert.equal(yearLater.describe()[0].fresh, true);
  assert.equal(yearLater.describe()[0].age_days, 400);
  assert.equal(yearLater.acceptsSnapshot({ region: 'testland', data_timestamp: DATA_TIME }), true);

  // An operator who wants a limit still gets one.
  const limited = createOsmExtractStore({ dir, now: () => NOW + 31 * DAY_MS, maxAgeMs: 30 * DAY_MS });
  assert.equal(limited.answer(plan()), null, 'older than the configured age');
  assert.equal(limited.describe()[0].fresh, false);
  assert.equal(limited.acceptsSnapshot({ region: 'testland', data_timestamp: DATA_TIME }), false);
});

test('the store does not answer a circle that leaves its coverage, or a broken tile', () => {
  const dir = makeStoreDir();
  const store = createOsmExtractStore({ dir, now: () => NOW });
  assert.equal(store.answer(plan({ anchors: [{ lat: 45.905, lng: 14.5 }] })), null, 'circle crosses the edge');
  assert.equal(store.answer(plan({ anchors: [{ lat: 59.33, lng: 18.07 }] })), null, 'another country');
  assert.equal(store.answer(plan({ anchors: [CENTRE, { lat: 59.33, lng: 18.07 }] })), null, 'one of two anchors outside');

  const tiles = path.join(dir, 'testland', 'tiles');
  for (const file of fs.readdirSync(tiles)) fs.writeFileSync(path.join(tiles, file), '{not json');
  const broken = createOsmExtractStore({ dir, now: () => NOW });
  assert.equal(broken.answer(plan()), null, 'an unreadable tile is not read as an empty neighbourhood');
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

test('the default loader keeps a year-old extract unless PARRANDA_OSM_EXTRACT_MAX_AGE_DAYS says otherwise', async () => {
  const realFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; return { ok: false, status: 502 }; };
  try {
    const dir = makeStoreDir({ dataTimestamp: new Date(Date.now() - 365 * DAY_MS).toISOString() });
    const kept = resolveDefaultOpenDataLoader({ PARRANDA_OPEN_DATA_LOADER: 'enabled', PARRANDA_OSM_EXTRACT_DIR: dir });
    const covered = await kept({ lat: CENTRE.lat, lng: CENTRE.lng });
    assert.equal(calls, 0, 'no limit by default: the old extract answers and no provider is asked');
    assert.ok(covered.length >= 12);

    const limited = resolveDefaultOpenDataLoader({
      PARRANDA_OPEN_DATA_LOADER: 'enabled', PARRANDA_OSM_EXTRACT_DIR: dir, PARRANDA_OSM_EXTRACT_MAX_AGE_DAYS: '30',
    });
    await limited({ lat: CENTRE.lat, lng: CENTRE.lng });
    assert.ok(calls >= 1, 'an explicit limit sends an older place to the provider');
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
  assert.equal(manifest.format, 'parranda-osm-extract-v2');
  assert.equal(manifest.data_timestamp_source, 'operator');
  assert.equal(Object.values(manifest.tiles).reduce((sum, tile) => sum + tile.n, 0), 20);
  assert.equal(manifest.element_count, 20);
  assert.match(manifest.attribution, /OpenStreetMap/);
  const stored = fs.readdirSync(path.join(dir, 'testland', 'tiles'))
    .flatMap(file => JSON.parse(fs.readFileSync(path.join(dir, 'testland', 'tiles', file), 'utf8')));
  assert.equal(stored.length, 20);
  assert.ok(!stored.some(element => element.id === 5000 || element.id === 5001));
});

test('a day answered from the extract says so, with the snapshot it came from', async () => {
  const label = { extracts: [{ region: 'testland', data_timestamp: '2026-11-14T21:20:00.000Z' }], includes_live_answer: false };
  const { createSourceCache } = require('../server/place-candidates/source-cache');
  let calls = 0;
  const loader = createOpenDataLoader({
    fetcher: async () => {
      calls += 1;
      return { ok: true, status: 200, json: async () => ({ elements: [
        { type: 'node', id: 1, lat: 59.33, lon: 18.07, tags: { name: 'Kafé', amenity: 'cafe' } },
      ] }) };
    },
    cache: createSourceCache({ namespace: 'overpass', now: () => NOW }),
    now: () => NOW,
    localSource: createOsmExtractStore({ dir: makeStoreDir(), now: () => NOW }),
  });
  const covered = await loader({ lat: CENTRE.lat, lng: CENTRE.lng });
  assert.deepEqual(covered.loader_metadata.map_snapshot, label);
  const again = await loader({ lat: CENTRE.lat, lng: CENTRE.lng });
  assert.deepEqual(again.loader_metadata.map_snapshot, label, 'the label survives the request cache');
  assert.equal(calls, 0);

  const live = await loader({ lat: 59.33, lng: 18.07 });
  assert.equal(live.loader_metadata.map_snapshot ?? null, null, 'a provider answer carries no snapshot label');
});

// Places spread over 5 km around the centre: a thin core and a rich ring.
function spread(idBase, count, { minKm, maxKm, kinds = KINDS }) {
  return Array.from({ length: count }, (_, i) => {
    const km = minKm + ((maxKm - minKm) * i) / Math.max(1, count - 1);
    const angle = (i * 2.399) % (2 * Math.PI);
    return {
      type: 'node', id: idBase + i,
      lat: CENTRE.lat + (km / 111.32) * Math.sin(angle),
      lon: CENTRE.lng + (km / (111.32 * Math.cos(CENTRE.lat * Math.PI / 180))) * Math.cos(angle),
      tags: { name: `P${idBase + i}`, ...kinds[i % kinds.length] },
    };
  });
}
const SMALL_BOX = [{ outer: [[14.46, 46.02], [14.55, 46.02], [14.55, 46.08], [14.46, 46.08]], holes: [] }];
function originsOf(records, table) {
  const found = new Set();
  for (const record of records) {
    const id = Number(String(record.id).replace(/^osm-(node|way|relation)-/, ''));
    for (const [name, test] of table) if (test(id)) found.add(name);
  }
  return found;
}

test('a day mixing two extracts names every extract whose places it keeps, oldest first', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'osm-extract-mixed-'));
  // The small, newer region holds only a thin core; the large, older one
  // holds the ring that the wider pass reaches.
  writeExtractStore({ outDir: dir, region: 'a-small', dataTimestamp: '2026-11-15T00:00:00Z', coverage: SMALL_BOX,
    elements: spread(100, 3, { minKm: 0.2, maxKm: 0.8, kinds: [{ amenity: 'cafe' }] }) });
  writeExtractStore({ outDir: dir, region: 'b-large', dataTimestamp: '2026-11-01T00:00:00Z', coverage: COVERAGE,
    elements: spread(200, 30, { minKm: 1.6, maxKm: 4.5 }) });
  let calls = 0;
  const loader = createOpenDataLoader({
    fetcher: async () => { calls += 1; throw new Error('provider must not be asked'); },
    localSource: createOsmExtractStore({ dir, now: () => NOW }),
  });
  const records = await loader({ lat: CENTRE.lat, lng: CENTRE.lng });
  assert.equal(calls, 0);
  const kept = originsOf(records, [['a-small', id => id >= 100 && id < 200], ['b-large', id => id >= 200 && id < 300]]);
  assert.ok(kept.has('b-large') && kept.has('a-small'), 'places from both extracts are kept');
  const expected = [
    ...(kept.has('b-large') ? [{ region: 'b-large', data_timestamp: '2026-11-01T00:00:00.000Z' }] : []),
    ...(kept.has('a-small') ? [{ region: 'a-small', data_timestamp: '2026-11-15T00:00:00.000Z' }] : []),
  ];
  assert.deepEqual(records.loader_metadata.map_snapshot, { extracts: expected, includes_live_answer: false });
});

test('a day mixing an extract with a live provider answer says both', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'osm-extract-live-'));
  writeExtractStore({ outDir: dir, region: 'a-small', dataTimestamp: '2026-11-15T00:00:00Z', coverage: SMALL_BOX,
    elements: spread(100, 3, { minKm: 0.2, maxKm: 0.8, kinds: [{ amenity: 'cafe' }] }) });
  const ring = spread(300, 30, { minKm: 1.6, maxKm: 4.5 });
  let calls = 0;
  const loader = createOpenDataLoader({
    fetcher: async () => { calls += 1; return { ok: true, status: 200, json: async () => ({ elements: ring }) }; },
    localSource: createOsmExtractStore({ dir, now: () => NOW }),
  });
  const records = await loader({ lat: CENTRE.lat, lng: CENTRE.lng });
  assert.equal(calls, 1, 'only the wider pass, outside the small extract, asks the provider');
  const kept = originsOf(records, [['a-small', id => id >= 100 && id < 200], ['live', id => id >= 300]]);
  assert.ok(kept.has('live') && kept.has('a-small'), 'places from the extract and the provider are kept');
  assert.deepEqual(records.loader_metadata.map_snapshot, kept.has('a-small')
    ? { extracts: [{ region: 'a-small', data_timestamp: '2026-11-15T00:00:00.000Z' }], includes_live_answer: true }
    : null);
});

test('with an age limit set, an answer read from an extract is not replayed after the extract passes it', async () => {
  const { createSourceCache } = require('../server/place-candidates/source-cache');
  const dataMs = Date.parse(DATA_TIME);
  const limitMs = 30 * 24 * 60 * 60 * 1000;
  let clock = dataMs + limitMs - 60 * 1000; // one minute before the limit
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'osm-extract-cache-'));
  const storeDir = makeStoreDir();
  let calls = 0;
  const failing = async () => { calls += 1; return { ok: false, status: 502 }; };
  const build = () => createOpenDataLoader({
    fetcher: failing,
    cache: createSourceCache({ namespace: 'overpass', dir: cacheDir, now: () => clock }),
    staleIfErrorMs: 7 * 24 * 60 * 60 * 1000,
    now: () => clock,
    localSource: createOsmExtractStore({ dir: storeDir, now: () => clock, maxAgeMs: limitMs }),
  });
  const loader = build();
  const request = { lat: CENTRE.lat, lng: CENTRE.lng, walkingTargetBand: { targetKm: 4, floorKm: 2.4, ceilingKm: 4.7 } };
  const warm = await loader(request);
  assert.ok(warm.length >= 12);
  assert.equal(calls, 0);
  assert.ok(loader.readNeighbouring(CENTRE, { ...request, walkingTargetBand: { targetKm: 6, floorKm: 3.6, ceilingKm: 7.08 } }),
    'before the limit a neighbouring budget may keep it');

  clock += 2 * 60 * 1000; // one minute past the limit, well inside the cache TTL
  const replay = await loader(request);
  assert.equal(replay.length, 0, 'the request cache does not replay it');
  assert.ok(calls >= 1, 'the provider is asked instead');
  assert.equal((await loader.readCached(CENTRE, request)).length, 0, 'the cache-only read does not replay it');
  assert.equal(loader.readNeighbouring(CENTRE, { ...request, walkingTargetBand: { targetKm: 6, floorKm: 3.6, ceilingKm: 7.08 } }), null,
    'a neighbouring budget does not keep it');

  const restarted = build();
  assert.equal((await restarted(request)).length, 0, 'after a restart the stored file is not replayed');
  assert.equal((await restarted.readCached(CENTRE, request)).length, 0);

  const withoutStore = createOpenDataLoader({
    fetcher: failing,
    cache: createSourceCache({ namespace: 'overpass', dir: cacheDir, now: () => dataMs + 60 * 1000 }),
    staleIfErrorMs: 7 * 24 * 60 * 60 * 1000,
    now: () => dataMs + 60 * 1000,
  });
  assert.equal((await withoutStore.readCached(CENTRE, request)).length, 0,
    'an extract answer is not replayed by a server that no longer has the extract');
});

test('coverage must hold the whole circle: a hole or a notch between sample points refuses it', () => {
  const { circleInCoverage } = require('../server/place-candidates/osm-extract-store');
  const box = [[14.3, 45.9], [14.7, 45.9], [14.7, 46.2], [14.3, 46.2]];
  const dLng = km => km / (111.32 * Math.cos(CENTRE.lat * Math.PI / 180));
  const dLat = km => km / 111.32;
  // A small hole about 750 m from the centre, inside a 1,500 m circle and
  // between the eight points on its edge.
  const hx = CENTRE.lng + dLng(0.53), hy = CENTRE.lat + dLat(0.53);
  const hole = [[hx - 0.0005, hy - 0.0005], [hx + 0.0005, hy - 0.0005], [hx + 0.0005, hy + 0.0005], [hx - 0.0005, hy + 0.0005]];
  assert.equal(circleInCoverage([{ outer: box, holes: [] }], CENTRE.lat, CENTRE.lng, 1500), true, 'convex coverage holds');
  assert.equal(circleInCoverage([{ outer: box, holes: [hole] }], CENTRE.lat, CENTRE.lng, 1500), false, 'a hole inside the circle');
  const around = [[CENTRE.lng - 0.001, CENTRE.lat - 0.001], [CENTRE.lng + 0.001, CENTRE.lat - 0.001],
    [CENTRE.lng + 0.001, CENTRE.lat + 0.001], [CENTRE.lng - 0.001, CENTRE.lat + 0.001]];
  assert.equal(circleInCoverage([{ outer: box, holes: [around] }], CENTRE.lat, CENTRE.lng, 1500), false, 'centre in a hole');
  // A narrow notch cut in from the east edge, reaching to 900 m east of the
  // centre on a line between two of the eight edge points.
  const tipLng = CENTRE.lng + dLng(0.9);
  const notched = [[14.3, 45.9], [14.7, 45.9], [14.7, CENTRE.lat + dLat(0.3)], [tipLng, CENTRE.lat + dLat(0.38)],
    [tipLng, CENTRE.lat + dLat(0.4)], [14.7, CENTRE.lat + dLat(0.5)], [14.7, 46.2], [14.3, 46.2]];
  assert.equal(circleInCoverage([{ outer: notched, holes: [] }], CENTRE.lat, CENTRE.lng, 1500), false, 'a notch into the circle');
  assert.equal(circleInCoverage([{ outer: notched, holes: [] }], CENTRE.lat, CENTRE.lng, 500), true, 'a smaller circle clear of it');
});

test('a listed tile that is missing or from another build refuses the answer; an unlisted one is empty', () => {
  const dir = makeStoreDir();
  const tiles = path.join(dir, 'testland', 'tiles');
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'testland', 'manifest.json'), 'utf8'));
  const centreKey = `${Math.floor(CENTRE.lat / manifest.tile_deg)}_${Math.floor(CENTRE.lng / manifest.tile_deg)}`;
  assert.ok(manifest.tiles[centreKey], 'the centre tile is listed');
  assert.ok(createOsmExtractStore({ dir, now: () => NOW }).answer(plan()), 'the intact store answers');

  fs.rmSync(path.join(tiles, `${centreKey}.json`));
  assert.equal(createOsmExtractStore({ dir, now: () => NOW }).answer(plan()), null, 'a lost tile is not an empty area');

  fs.writeFileSync(path.join(tiles, `${centreKey}.json`), JSON.stringify([]));
  assert.equal(createOsmExtractStore({ dir, now: () => NOW }).answer(plan()), null, 'a different tile is refused');

  const far = createOsmExtractStore({ dir: makeStoreDir(), now: () => NOW }).answer(plan({ anchors: [{ lat: 46.15, lng: 14.62 }], radiusM: 300 }));
  assert.deepEqual(far.payload.elements, [], 'an area with no listed tile is answered as empty');
});

test('a rebuild swaps the region whole; a reader of the old build refuses tiles from the new one', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'osm-extract-swap-'));
  const one = (id, name) => [{ type: 'node', id, lat: CENTRE.lat, lon: CENTRE.lng, tags: { name, amenity: 'cafe' } }];
  writeExtractStore({ outDir: dir, region: 'testland', dataTimestamp: '2026-11-01T00:00:00Z', coverage: COVERAGE, elements: one(201, 'Old') });
  const before = createOsmExtractStore({ dir, now: () => NOW });
  writeExtractStore({ outDir: dir, region: 'testland', dataTimestamp: '2026-11-14T00:00:00Z', coverage: COVERAGE, elements: one(301, 'New') });
  assert.deepEqual(fs.readdirSync(dir), ['testland'], 'no build or retired directory is left behind');
  const cafes = plan({ groups: [{ selectors: [{ key: 'amenity', value: 'cafe' }], named: false }] });
  assert.equal(before.answer(cafes), null, 'old manifest, new tile: refused, not mixed');
  const after = createOsmExtractStore({ dir, now: () => NOW }).answer(cafes);
  assert.deepEqual(after.payload.elements.map(element => element.id), [301]);
  assert.equal(after.snapshot.data_timestamp, '2026-11-14T00:00:00.000Z');
});

// A minimal OSM PBF file: one header block, optionally with a replication
// timestamp, in a zlib-compressed blob.
function pbfWithHeader(seconds, { compressed = true } = {}) {
  const zlib = require('node:zlib');
  const varint = (value) => { const out = []; let v = BigInt(value); do { let byte = Number(v & 0x7fn); v >>= 7n; if (v) byte |= 0x80; out.push(byte); } while (v); return Buffer.from(out); };
  const field = (number, wire, payload) => Buffer.concat([varint((number << 3) | wire), wire === 2 ? Buffer.concat([varint(payload.length), payload]) : varint(payload)]);
  const block = Buffer.concat([
    field(4, 2, Buffer.from('OsmSchema-V0.6')),
    field(16, 2, Buffer.from('test')),
    ...(seconds ? [field(32, 0, seconds)] : []),
  ]);
  const blob = compressed
    ? Buffer.concat([field(2, 0, block.length), field(3, 2, zlib.deflateSync(block))])
    : field(1, 2, block);
  const header = Buffer.concat([field(1, 2, Buffer.from('OSMHeader')), field(3, 0, blob.length)]);
  const length = Buffer.alloc(4); length.writeUInt32BE(header.length);
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pbf-')), 'x.osm.pbf');
  fs.writeFileSync(file, Buffer.concat([length, header, blob]));
  return file;
}

test('the data time comes from the file header; a stated time must agree, and is labelled when it stands alone', () => {
  const { readPbfReplicationTimestamp, resolveDataTimestamp } = require('../scripts/build-osm-extract');
  const seconds = Date.parse('2026-11-14T21:20:41Z') / 1000;
  assert.equal(readPbfReplicationTimestamp(pbfWithHeader(seconds)), '2026-11-14T21:20:41.000Z');
  assert.equal(readPbfReplicationTimestamp(pbfWithHeader(seconds, { compressed: false })), '2026-11-14T21:20:41.000Z');
  assert.equal(readPbfReplicationTimestamp(pbfWithHeader(null)), null);

  assert.deepEqual(resolveDataTimestamp({ headerTimestamp: '2026-11-14T21:20:41.000Z' }),
    { dataTimestamp: '2026-11-14T21:20:41.000Z', source: 'pbf_header' });
  assert.throws(() => resolveDataTimestamp({ headerTimestamp: '2026-11-14T21:20:41.000Z', statedTimestamp: '2026-11-14T21:20:00Z' }), /disagrees/);
  assert.throws(() => resolveDataTimestamp({ headerTimestamp: null }), /no replication timestamp/);
  assert.deepEqual(resolveDataTimestamp({ headerTimestamp: null, statedTimestamp: '2026-11-14T21:20:00Z' }),
    { dataTimestamp: '2026-11-14T21:20:00.000Z', source: 'operator' });
});

// Hermes review of #705: the manifest's own counts were never checked, so a
// manifest that lost its tile list read as a fresh store with nothing in it.
test('a manifest whose tile list disagrees with its own counts is refused', () => {
  for (const damage of [
    manifest => { manifest.tiles = {}; },
    manifest => { const [key] = Object.keys(manifest.tiles); delete manifest.tiles[key]; },
    manifest => { manifest.element_count += 1; },
    manifest => { delete manifest.tile_count; },
  ]) {
    const dir = makeStoreDir();
    const file = path.join(dir, 'testland', 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
    damage(manifest);
    fs.writeFileSync(file, JSON.stringify(manifest));
    assert.equal(createOsmExtractStore({ dir, now: () => NOW }), null, String(damage));
  }
});

// Hermes review of #705: the tiles to read were chosen with a shorter degree
// than the distance check uses, so a place just inside the circle, just past
// a tile edge, was never read.
test('a place just inside the circle is found when it lies in the next tile', () => {
  const tileDeg = 0.05;
  const edge = 1201 * tileDeg; // a tile boundary at about 60.05 N
  const anchor = { lat: edge - 0.008988, lng: 10.52 };
  const element = { type: 'node', id: 4242, lat: edge + 0.000002, lon: anchor.lng,
    tags: { name: 'Kanten', amenity: 'cafe' } };
  const coverage = [{ outer: [[10, 59.5], [11, 59.5], [11, 60.5], [10, 60.5]], holes: [] }];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'osm-extract-'));
  writeExtractStore({ outDir: dir, region: 'edge', dataTimestamp: DATA_TIME, coverage, elements: [element], tileDeg });
  const answer = createOsmExtractStore({ dir, now: () => NOW }).answer({
    anchors: [anchor], radiusM: 1000, perCategory: 6,
    groups: [{ selectors: [{ key: 'amenity', value: 'cafe' }], named: false }],
  });
  assert.ok(answer, 'the circle is covered');
  assert.deepEqual(answer.payload.elements.map(e => e.id), [4242], 'the café about 1 m inside the edge is found');
});
