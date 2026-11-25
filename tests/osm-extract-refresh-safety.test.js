'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { writeExtractStore } = require('../scripts/build-osm-extract');
const { refreshRegion, verifyStore, removeBuildLeftovers } = require('../scripts/refresh-osm-extracts');

const ENTRY = { region: 'testland', geofabrik: 'europe/testland' };
const COVERAGE = [{ outer: [[14, 45], [15, 45], [15, 47], [14, 47]], holes: [] }];
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'osm-refresh-safety-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const out = path.join(root, 'out'), work = path.join(root, 'work');
  fs.mkdirSync(out); fs.mkdirSync(work);
  write({ out, region: ENTRY.region });
  const regionDir = path.join(out, ENTRY.region);
  return { out, work, regionDir, before: fs.readFileSync(path.join(regionDir, 'manifest.json'), 'utf8') };
}
function write({ out, region }) {
  return writeExtractStore({ outDir: out, region, dataTimestamp: '2026-11-23T21:00:00Z', coverage: COVERAGE,
    elements: [{ type: 'node', id: 1, lat: 46.05, lon: 14.5, tags: { name: 'Fixture museum', tourism: 'museum' } }] });
}
function fakeFetch() {
  const pbf = Buffer.from('controlled test bytes');
  const md5 = createHash('md5').update(pbf).digest('hex');
  return async (url, options = {}) => {
    if (options.method === 'HEAD') return new Response(null, { headers: { 'content-length': String(pbf.length) } });
    if (url.endsWith('.md5')) return new Response(md5);
    if (url.endsWith('.poly')) return new Response('controlled boundary; the injected fixture builder does not parse it');
    return new Response(pbf);
  };
}
function unchanged(f) {
  assert.equal(fs.readFileSync(path.join(f.regionDir, 'manifest.json'), 'utf8'), f.before);
  assert.equal(verifyStore(f.regionDir).ok, true);
}

test('sharing output and download roots cannot delete the published region or unrelated retired data', async t => {
  const f = fixture(t);
  const retired = path.join(f.out, '.testland.retired-unrelated');
  fs.mkdirSync(retired); fs.writeFileSync(path.join(retired, 'keep'), 'not owned by this attempt');
  const result = await refreshRegion(ENTRY, { out: f.out, work: f.out, minFree: 0,
    fetchImpl: fakeFetch(), build: async options => { write(options); return { seconds: 0 }; } });
  assert.equal(result.status, 'ok', JSON.stringify(result));
  assert.equal(verifyStore(f.regionDir).ok, true);
  assert.equal(fs.readFileSync(path.join(retired, 'keep'), 'utf8'), 'not owned by this attempt');
  assert.deepEqual(fs.readdirSync(f.out).sort(), ['.testland.retired-unrelated', 'testland']);
});

test('verification refuses the new staged generation before replacing the held generation', async t => {
  const f = fixture(t);
  const result = await refreshRegion(ENTRY, { out: f.out, work: f.work, minFree: 0, fetchImpl: fakeFetch(),
    build: async options => {
      write(options);
      const p = path.join(options.out, ENTRY.region, 'manifest.json');
      const m = JSON.parse(fs.readFileSync(p, 'utf8'));
      fs.writeFileSync(p, JSON.stringify({ ...m, tile_count: m.tile_count + 1 }));
      return { seconds: 0 };
    } });
  assert.equal(result.status, 'store_invalid');
  unchanged(f);
  assert.deepEqual(fs.readdirSync(f.out), ['testland']);
});

test('failed final promotion restores the prior generation and removes only owned staging data', async t => {
  const f = fixture(t), rename = fs.renameSync.bind(fs);
  let interrupted = false;
  t.mock.method(fs, 'renameSync', (from, to) => {
    if (!interrupted && to === f.regionDir && path.basename(from) === ENTRY.region) {
      interrupted = true;
      throw new Error('injected final promotion failure');
    }
    return rename(from, to);
  });
  const result = await refreshRegion(ENTRY, { out: f.out, work: f.work, minFree: 0, fetchImpl: fakeFetch(),
    build: async options => { write(options); return { seconds: 0 }; } });
  assert.equal(interrupted, true, 'the real parent promotion must be reached');
  assert.equal(result.status, 'failed');
  assert.match(result.error, /injected final promotion failure/);
  unchanged(f);
  assert.deepEqual(fs.readdirSync(f.out), ['testland']);
});

test('leftover cleanup never removes the sole retired complete generation', t => {
  const f = fixture(t), retired = path.join(f.out, '.testland.retired-123-456');
  fs.renameSync(f.regionDir, retired);
  removeBuildLeftovers(f.out, ENTRY.region);
  assert.equal(fs.readFileSync(path.join(retired, 'manifest.json'), 'utf8'), f.before);
  assert.equal(verifyStore(retired).ok, true);
});

test('CLI rejects a negative free-space floor before any real region download', t => {
  const f = fixture(t);
  const result = spawnSync(process.execPath, [path.join(__dirname, '../scripts/refresh-osm-extracts.js'),
    '--out', f.out, '--work', f.work, '--regions', 'sweden', '--min-free-gb', '-1', '--dry-run'], { encoding: 'utf8' });
  assert.notEqual(result.status, 0, 'negative free-space floor must not disable the disk watchdog');
  assert.match(result.stderr, /min-free-gb/);
  unchanged(f);
});
