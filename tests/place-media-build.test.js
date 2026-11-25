'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { scanExtract, buildPlaceMediaIndex } = require('../scripts/build-place-media');
const { OSM_EXTRACT_FORMAT } = require('../server/place-candidates/osm-extract-store');
const { createWikimediaClient } = require('../server/place-media/wikimedia-client');
const { createPlaceMedia } = require('../server/place-media');
const { createFixtureFetcher } = require('./helpers/place-media-fixtures');

// A small extract store in the osm-extract-store layout, with real OSM tags.
function writeStore(root) {
  const region = path.join(root, 'sweden');
  fs.mkdirSync(path.join(region, 'tiles'), { recursive: true });
  const tiles = {
    '1186_361': [
      { type: 'node', id: 304609719, lat: 59.3294531, lon: 18.0672982,
        tags: { name: 'Medelhavsmuseet', tourism: 'museum', wikidata: 'Q1331646', wikimedia_commons: 'Category:Medelhavsmuseet' } },
      { type: 'node', id: 360757854, lat: 59.3335675, lon: 18.0776856, tags: { name: 'Tidemans', amenity: 'cafe' } },
      { type: 'node', id: 1, lat: 59.33, lon: 18.07, tags: { name: 'Espresso House', amenity: 'cafe', wikidata: 'Q100', 'brand:wikidata': 'Q100' } },
    ],
    '1197_352': [
      { type: 'way', id: 32119036, center: { lat: 59.8579425, lon: 17.6317236 },
        tags: { name: 'Gustavianum', tourism: 'museum', wikidata: 'Q1506922', wikimedia_commons: 'File:GUSTAVIANUM 1.jpg' } },
      { type: 'node', id: 2, lat: 59.858, lon: 17.632, tags: { name: 'Gustavianum shop', shop: 'gift', wikidata: 'Q1506922;Q2' } },
    ],
  };
  const inventory = {};
  let count = 0;
  for (const [key, elements] of Object.entries(tiles)) {
    const raw = JSON.stringify(elements);
    fs.writeFileSync(path.join(region, 'tiles', `${key}.json`), raw);
    inventory[key] = { n: elements.length, sha256: createHash('sha256').update(raw).digest('hex') };
    count += elements.length;
  }
  fs.writeFileSync(path.join(region, 'manifest.json'), JSON.stringify({
    format: OSM_EXTRACT_FORMAT, region: 'sweden', data_timestamp: '2026-11-20T00:00:00Z', tile_deg: 0.05,
    coverage: [{ outer: [[17, 59], [19, 59], [19, 60], [17, 60]], holes: [] }],
    tiles: inventory, tile_count: Object.keys(inventory).length, element_count: count,
  }));
  return root;
}

test('scanExtract finds QIDs, OSM Commons files and skips brand tags', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'place-media-build-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeStore(root);
  const { qids, stats } = scanExtract(root);
  assert.deepEqual([...qids.keys()].sort(), ['Q1331646', 'Q1506922']);
  assert.equal(qids.get('Q1331646').osmCommons, null, 'a Commons category is not a file');
  assert.equal(qids.get('Q1506922').osmCommons, 'File:GUSTAVIANUM 1.jpg');
  assert.equal(stats.brand_skipped, 1);
  assert.equal(stats.elements, 5);
  // One region directory works as well as the store.
  assert.equal(scanExtract(path.join(root, 'sweden')).qids.size, 2);
});

test('buildPlaceMediaIndex writes index-v1.jsonl atomically, reuses records and loads in the service', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'place-media-build-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeStore(path.join(root, 'extract'));
  const out = path.join(root, 'media');
  const { fetcher, calls } = createFixtureFetcher();
  const client = createWikimediaClient({ fetcher, clock: () => Date.parse('2026-11-24T10:00:00Z') });
  const lines = [];
  const summary = await buildPlaceMediaIndex({ extractDir: path.join(root, 'extract'), outDir: out, client, log: line => lines.push(line) });
  assert.equal(summary.fetched, 2);
  assert.equal(summary.coverage.records, 2);
  assert.equal(summary.coverage.with_photo, 2);
  assert.equal(summary.coverage.with_about.sv, 2);
  assert.ok(lines.some(line => line.startsWith('[2/2]')));
  assert.deepEqual(fs.readdirSync(out), ['index-v1.jsonl'], 'no temp file left behind');
  const written = fs.readFileSync(path.join(out, 'index-v1.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
  assert.deepEqual(written.map(r => r.qid), ['Q1331646', 'Q1506922']);
  const service = createPlaceMedia({ dir: out, fetcher: async () => { throw new Error('offline'); } });
  assert.equal(service.health().index_records, 2);
  assert.ok(service.peek('Q1506922').photo);

  const before = calls.length;
  const again = await buildPlaceMediaIndex({ extractDir: path.join(root, 'extract'), outDir: out, client });
  assert.equal(again.reused, 2);
  assert.equal(again.fetched, 0);
  assert.equal(calls.length, before, 'reused records are not fetched again');
  const limited = await buildPlaceMediaIndex({ extractDir: path.join(root, 'extract'), outDir: path.join(root, 'one'), client, limit: 1 });
  assert.equal(limited.selected, 1);
  assert.equal(limited.coverage.records, 1);
});

test('a rebuild retires photos the new index no longer uses, so live shares keep them', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'place-media-build-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeStore(path.join(root, 'extract'));
  const out = path.join(root, 'media');
  const client = createWikimediaClient({ fetcher: createFixtureFetcher().fetcher, clock: () => Date.parse('2026-11-24T10:00:00Z') });
  await buildPlaceMediaIndex({ extractDir: path.join(root, 'extract'), outDir: out, client });
  // Pretend the earlier index showed another version of the file (another sha1).
  const file = path.join(out, 'index-v1.jsonl');
  const records = fs.readFileSync(file, 'utf8').trim().split('\n').map(line => JSON.parse(line));
  const oldId = 'a'.repeat(40);
  records[0].photo.media_id = oldId;
  fs.writeFileSync(file, `${records.map(record => JSON.stringify(record)).join('\n')}\n`);
  const summary = await buildPlaceMediaIndex({ extractDir: path.join(root, 'extract'), outDir: out, client, refresh: true });
  assert.equal(summary.retained, 1);
  const service = createPlaceMedia({ dir: out, fetcher: async () => { throw new Error('offline'); } });
  assert.notEqual(service.peek(records[0].qid).photo.media_id, oldId, 'new days get the current file');
  assert.equal(service.byMediaId(oldId)?.media_id, oldId, 'the old version stays servable');
  const unchanged = await buildPlaceMediaIndex({ extractDir: path.join(root, 'extract'), outDir: out, client });
  assert.equal(unchanged.retained, 0, 'nothing is retired when nothing changed');
});
