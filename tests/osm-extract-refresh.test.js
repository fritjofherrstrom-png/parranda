'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { writeExtractStore } = require('../scripts/build-osm-extract');
const {
  REGIONS, regionUrls, selectRegions, diskPlan, verifyStore, refreshRegion, removeBuildLeftovers,
} = require('../scripts/refresh-osm-extracts');

const GB = 1024 ** 3;
const COVERAGE = [{ outer: [[14.3, 45.9], [14.7, 45.9], [14.7, 46.2], [14.3, 46.2]], holes: [] }];
const elements = () => [
  { type: 'node', id: 1, lat: 46.05, lon: 14.5, tags: { name: 'Kavarna', amenity: 'cafe' } },
  { type: 'node', id: 2, lat: 46.06, lon: 14.51, tags: { name: 'Muzej', tourism: 'museum' } },
  { type: 'node', id: 3, lat: 46.12, lon: 14.6, tags: { name: 'Park', leisure: 'park' } },
];
function makeStore(region = 'testland') {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'osm-refresh-'));
  writeExtractStore({ outDir: out, region, dataTimestamp: '2026-11-23T21:00:00Z', coverage: COVERAGE, elements: elements() });
  return { out, regionDir: path.join(out, region) };
}

test('the region list is well formed and keeps Sweden, which staging serves', () => {
  const names = REGIONS.map(entry => entry.region);
  assert.equal(new Set(names).size, names.length);
  for (const entry of REGIONS) {
    assert.match(entry.region, /^[a-z0-9][a-z0-9-]{0,63}$/);
    const urls = regionUrls(entry);
    assert.equal(urls.pbf, `https://download.geofabrik.de/${entry.geofabrik}-latest.osm.pbf`);
    assert.equal(urls.md5, `${urls.pbf}.md5`);
    assert.equal(urls.poly, `https://download.geofabrik.de/${entry.geofabrik}.poly`);
  }
  assert.ok(names.includes('sweden'));
  // France and Germany only as sub-regions: the whole countries do not fit a build disk.
  assert.ok(!REGIONS.some(entry => entry.geofabrik === 'europe/france' || entry.geofabrik === 'europe/germany'));
});

test('a build gives the same tiles and hashes whatever order the places arrive in', () => {
  const build = (list) => {
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'osm-refresh-order-'));
    writeExtractStore({ outDir: out, region: 'testland', dataTimestamp: '2026-11-23T21:00:00Z', coverage: COVERAGE, elements: list,
      builtAt: '2026-11-24T00:00:00Z' });
    return fs.readFileSync(path.join(out, 'testland', 'manifest.json'), 'utf8');
  };
  const many = [...elements(),
    { type: 'way', id: 9, center: { lat: 46.0501, lon: 14.5001 }, tags: { name: 'Grad', historic: 'castle' } },
    { type: 'node', id: 7, lat: 46.0502, lon: 14.5002, tags: { name: 'Bar', amenity: 'bar' } }];
  assert.equal(build(many), build([...many].reverse()));
});

test('selectRegions keeps the list order and refuses unknown names', () => {
  assert.deepEqual(selectRegions('spain,sweden').map(entry => entry.region), ['sweden', 'spain']);
  assert.throws(() => selectRegions('sweden,atlantis'), /atlantis/);
  assert.equal(selectRegions(undefined).length, REGIONS.length);
  assert.throws(() => regionUrls({ geofabrik: '../etc/passwd' }), /bad Geofabrik path/);
});

test('diskPlan counts the extract, DuckDB temp files and the free-space floor', () => {
  assert.equal(diskPlan({ free: 8 * GB, pbfBytes: 1 * GB, minFree: 2.5 * GB }).fits, true);
  // 2.3 GB extract: 2.3 + 1.15 temp + 2.5 floor = 5.95 GB.
  assert.equal(diskPlan({ free: 6 * GB, pbfBytes: 2.3 * GB, minFree: 2.5 * GB }).fits, true);
  assert.equal(diskPlan({ free: 5.9 * GB, pbfBytes: 2.3 * GB, minFree: 2.5 * GB }).fits, false);
});

test('verifyStore accepts a store as the builder wrote it', () => {
  const { regionDir } = makeStore();
  const check = verifyStore(regionDir, { region: 'testland' });
  assert.equal(check.ok, true, check.problems.join('; '));
  assert.equal(check.element_count, 3);
  assert.equal(check.tile_count, 3);
});

test('verifyStore names a changed tile, a missing tile and totals that disagree', () => {
  const changed = makeStore();
  const tiles = fs.readdirSync(path.join(changed.regionDir, 'tiles'));
  fs.writeFileSync(path.join(changed.regionDir, 'tiles', tiles[0]), '[]');
  assert.match(verifyStore(changed.regionDir).problems.join(';'), /hash differs/);

  const missing = makeStore();
  fs.rmSync(path.join(missing.regionDir, 'tiles', fs.readdirSync(path.join(missing.regionDir, 'tiles'))[0]));
  assert.match(verifyStore(missing.regionDir).problems.join(';'), /missing/);

  const totals = makeStore();
  const manifestPath = path.join(totals.regionDir, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  fs.writeFileSync(manifestPath, JSON.stringify({ ...manifest, element_count: 4, tile_count: 2 }));
  const problems = verifyStore(totals.regionDir).problems.join(';');
  assert.match(problems, /element_count 4, inventory 3/);
  assert.match(problems, /tile_count 2, inventory 3/);

  assert.equal(verifyStore(makeStore().regionDir, { region: 'elsewhere' }).ok, false);
});

// A Geofabrik stand-in: serves a fake extract, its MD5 and a boundary file.
function fakeGeofabrik({ pbf = Buffer.from('fake pbf bytes'), md5 = null, size = null } = {}) {
  const sum = md5 || createHash('md5').update(pbf).digest('hex');
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push(`${options.method || 'GET'} ${url}`);
    if (options.method === 'HEAD') return new Response(null, { status: 200, headers: { 'content-length': String(size ?? pbf.length) } });
    if (url.endsWith('.md5')) return new Response(`${sum}  x-latest.osm.pbf\n`);
    if (url.endsWith('.poly')) return new Response('testland\n1\n 14.3 45.9\n 14.7 45.9\n 14.7 46.2\nEND\nEND\n');
    return new Response(pbf);
  };
  return { fetchImpl, calls };
}

test('refreshRegion builds, deletes the extract and checks the new store', async () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'osm-refresh-out-'));
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'osm-refresh-work-'));
  const { fetchImpl } = fakeGeofabrik();
  let seen = null;
  const build = async ({ pbf, poly, region, out: buildOut }) => {
    seen = { pbf: fs.readFileSync(pbf, 'utf8'), poly: fs.existsSync(poly) };
    writeExtractStore({ outDir: buildOut, region, dataTimestamp: '2026-11-23T21:00:00Z', coverage: COVERAGE, elements: elements() });
    return { seconds: 1, lowest_free_gb: 5 };
  };
  const result = await refreshRegion({ region: 'testland', geofabrik: 'europe/testland' }, { out, work, minFree: 0, fetchImpl, build });
  assert.equal(result.status, 'ok', JSON.stringify(result));
  assert.deepEqual(seen, { pbf: 'fake pbf bytes', poly: true });
  assert.equal(result.element_count, 3);
  assert.equal(fs.existsSync(path.join(work, 'testland')), false, 'the extract is deleted after the build');
});

test('refreshRegion refuses a download whose MD5 differs and leaves nothing behind', async () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'osm-refresh-out-'));
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'osm-refresh-work-'));
  const { fetchImpl } = fakeGeofabrik({ md5: '0'.repeat(32) });
  let built = false;
  const result = await refreshRegion({ region: 'testland', geofabrik: 'europe/testland' }, {
    out, work, minFree: 0, fetchImpl, build: async () => { built = true; },
  });
  assert.equal(result.status, 'failed');
  assert.match(result.error, /MD5/);
  assert.equal(built, false);
  assert.equal(fs.existsSync(path.join(work, 'testland')), false);
});

test('refreshRegion skips a region that would not fit on the disk, before downloading', async () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'osm-refresh-out-'));
  const { fetchImpl, calls } = fakeGeofabrik({ size: 1024 * 1024 * GB });
  const result = await refreshRegion({ region: 'testland', geofabrik: 'europe/testland' }, { out, work: out, fetchImpl, build: async () => {} });
  assert.equal(result.status, 'skipped_disk');
  assert.deepEqual(calls, ['HEAD https://download.geofabrik.de/europe/testland-latest.osm.pbf']);
});

test('a failed build keeps the old store and clears what the build left', async () => {
  const { out, regionDir } = makeStore();
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'osm-refresh-work-'));
  const before = fs.readFileSync(path.join(regionDir, 'manifest.json'), 'utf8');
  const { fetchImpl } = fakeGeofabrik();
  const build = async ({ out: buildOut }) => {
    fs.mkdirSync(path.join(buildOut, '.build-tmp'));
    fs.mkdirSync(path.join(buildOut, '.testland.building-1-2'));
    throw new Error('build stopped: free space fell to 2.40 GB');
  };
  const result = await refreshRegion({ region: 'testland', geofabrik: 'europe/testland' }, { out, work, minFree: 0, fetchImpl, build });
  assert.equal(result.status, 'failed');
  assert.match(result.error, /free space/);
  assert.equal(fs.readFileSync(path.join(regionDir, 'manifest.json'), 'utf8'), before);
  assert.deepEqual(fs.readdirSync(out), ['testland']);
  removeBuildLeftovers(out, 'testland');
  assert.deepEqual(fs.readdirSync(out), ['testland']);
});

test('a builder interrupted after retiring its previous output cannot erase the held store', async () => {
  const { out, regionDir } = makeStore();
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'osm-refresh-interrupted-'));
  const before = fs.readFileSync(path.join(regionDir, 'manifest.json'), 'utf8');
  const { fetchImpl } = fakeGeofabrik();
  const build = async ({ out: buildOut, region }) => {
    const previous = path.join(buildOut, region);
    if (fs.existsSync(previous)) {
      fs.renameSync(previous, path.join(buildOut, `.${region}.retired-123-456`));
    }
    throw new Error('builder killed between retiring and publishing');
  };
  const result = await refreshRegion({ region: 'testland', geofabrik: 'europe/testland' },
    { out, work, minFree: 0, fetchImpl, build });
  assert.equal(result.status, 'failed');
  assert.equal(fs.existsSync(path.join(regionDir, 'manifest.json')), true,
    'interrupted builder must not erase the previously held store');
  assert.equal(fs.readFileSync(path.join(regionDir, 'manifest.json'), 'utf8'), before);
  assert.equal(verifyStore(regionDir).ok, true);
});
