'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createPlaceMedia, getPlaceMedia, setPlaceMediaForTests } = require('../server/place-media');
const { createWikimediaClient } = require('../server/place-media/wikimedia-client');
const { createFixtureFetcher } = require('./helpers/place-media-fixtures');

function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'place-media-index-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
async function fixtureRecords(qids) {
  return createWikimediaClient({ fetcher: createFixtureFetcher().fetcher, clock: () => Date.parse('2026-11-24T10:00:00Z') }).fetchRecords(qids);
}

test('loads index and learned records; learned lines win; broken lines are skipped and counted', async t => {
  const dir = tempDir(t);
  const records = await fixtureRecords(['Q1331646', 'Q1506922']);
  const medelhavs = records.get('Q1331646');
  fs.writeFileSync(path.join(dir, 'index-v1.jsonl'), [
    JSON.stringify(medelhavs), JSON.stringify(records.get('Q1506922')), '{not json', JSON.stringify({ v: 2, qid: 'Q1' }),
    JSON.stringify({ ...medelhavs, qid: 'Q2', photo: { ...medelhavs.photo, file_page_url: 'https://evil.example/x' } }), '',
  ].join('\n'));
  const newer = { ...medelhavs, checked_on: '2026-11-25', subtitle: { en: 'museum in central Stockholm' } };
  fs.writeFileSync(path.join(dir, 'learned-v1.jsonl'), `${JSON.stringify(newer)}\n`);
  const service = createPlaceMedia({ dir, fetcher: async () => { throw new Error('no network'); } });
  assert.equal(service.peek('Q1331646').checked_on, '2026-11-25');
  assert.ok(service.peek('Q1506922'));
  assert.equal(service.peek('Q2'), undefined);
  assert.equal(service.peek('nope'), undefined);
  const health = service.health();
  assert.equal(health.index_records, 2);
  assert.equal(health.learned_records, 1);
  assert.equal(health.load_skipped, 3);
  assert.deepEqual(service.byMediaId(medelhavs.photo.media_id), medelhavs.photo);
  assert.equal(service.byMediaId('0'.repeat(40)), undefined);
  assert.equal(service.byMediaId('../../etc'), undefined);
});

test('ensure dedupes concurrent lookups and persists to learned-v1.jsonl', async t => {
  const dir = tempDir(t);
  const { fetcher, calls } = createFixtureFetcher({ delayMs: 5 });
  const service = createPlaceMedia({ dir, fetcher });
  await Promise.all([service.ensure(['Q1331646', 'Q1506922']), service.ensure(['Q1331646']), service.ensure(['Q1506922', 'bogus'])]);
  assert.equal(calls.filter(c => c.url.includes('wbgetentities')).length, 1, 'one upstream entity call');
  await service.ensure(['Q1331646']);
  assert.equal(calls.filter(c => c.url.includes('wbgetentities')).length, 1, 'known records are not asked again');
  await service.flush();
  const reloaded = createPlaceMedia({ dir, fetcher: async () => { throw new Error('offline'); } });
  assert.deepEqual(reloaded.peek('Q1331646'), service.peek('Q1331646'));
  assert.ok(reloaded.byMediaId(service.peek('Q1506922').photo.media_id));
  assert.equal(service.health().persisted, 2);
});

test('an aborted signal stops the wait, not the fetch', async t => {
  const dir = tempDir(t);
  const service = createPlaceMedia({ dir, fetcher: createFixtureFetcher({ delayMs: 30 }).fetcher });
  const controller = new AbortController();
  const waiting = service.ensure(['Q1331646'], { signal: controller.signal });
  controller.abort();
  await waiting;
  assert.equal(service.peek('Q1331646'), undefined);
  await service.ensure(['Q1331646']);
  assert.ok(service.peek('Q1331646'));
});

test('upstream failures back off instead of hammering', async t => {
  const dir = tempDir(t);
  let now = Date.parse('2026-11-24T10:00:00Z');
  let sent = 0;
  const service = createPlaceMedia({ dir, clock: () => now, fetcher: async () => { sent += 1; throw new Error('down'); } });
  await service.ensure(['Q1331646']);
  assert.equal(sent, 1);
  await service.ensure(['Q1331646']);
  assert.equal(sent, 1, 'within the back-off');
  now += 5 * 60 * 1000 + 1;
  await service.ensure(['Q1331646']);
  assert.equal(sent, 2);
  assert.equal(service.peek('Q1331646'), undefined);
  assert.ok(service.health().fetch_failures >= 1 || service.health().backing_off >= 1);
});

test('getPlaceMedia follows PARRANDA_PLACE_MEDIA_DIR; setPlaceMediaForTests overrides it', t => {
  const saved = process.env.PARRANDA_PLACE_MEDIA_DIR;
  t.after(() => {
    setPlaceMediaForTests(undefined);
    if (saved === undefined) delete process.env.PARRANDA_PLACE_MEDIA_DIR; else process.env.PARRANDA_PLACE_MEDIA_DIR = saved;
  });
  setPlaceMediaForTests(undefined);
  delete process.env.PARRANDA_PLACE_MEDIA_DIR;
  assert.equal(getPlaceMedia(), null);
  const dir = tempDir(t);
  process.env.PARRANDA_PLACE_MEDIA_DIR = dir;
  const service = getPlaceMedia();
  assert.equal(service.dir, dir);
  assert.equal(getPlaceMedia(), service, 'singleton');
  setPlaceMediaForTests(null);
  assert.equal(getPlaceMedia(), null, 'forced off');
  const fake = { peek() {} };
  setPlaceMediaForTests(fake);
  assert.equal(getPlaceMedia(), fake);
});

// Hermes #715 F1: a shared day keeps the photo it was published with after the
// index changes; F1b: a photo two records use stays current while one uses it.
const { appendRetainedPhotos, RETAINED_FILE, RETAIN_MS } = require('../server/place-media');

test('a photo dropped by an index rebuild stays servable for live shares (fresh instance)', async t => {
  const dir = tempDir(t);
  const records = await fixtureRecords(['Q1331646', 'Q1506922']);
  const medelhavs = records.get('Q1331646');
  const photoA = medelhavs.photo;
  const photoB = records.get('Q1506922').photo;
  assert.notEqual(photoA.media_id, photoB.media_id);
  fs.writeFileSync(path.join(dir, 'index-v1.jsonl'), `${JSON.stringify(medelhavs)}\n`);
  const before = createPlaceMedia({ dir, fetcher: async () => { throw new Error('offline'); } });
  assert.deepEqual(before.byMediaId(photoA.media_id), photoA);
  // Rebuild: the same QID now has photo B; the builder retires A.
  assert.equal(appendRetainedPhotos(dir, [photoA]), 1);
  fs.writeFileSync(path.join(dir, 'index-v1.jsonl'), `${JSON.stringify({ ...medelhavs, photo: photoB })}\n`);
  const after = createPlaceMedia({ dir, fetcher: async () => { throw new Error('offline'); } });
  assert.deepEqual(after.peek('Q1331646').photo, photoB, 'new days get the new photo');
  assert.deepEqual(after.byMediaId(photoA.media_id), photoA, 'shares published with A still load A');
  assert.deepEqual(after.byMediaId(photoB.media_id), photoB);
  assert.equal(after.health().retained_photos, 1);
});

test('a retired photo is forgotten once it is older than any share can be', async t => {
  const dir = tempDir(t);
  const records = await fixtureRecords(['Q1331646']);
  const photoA = records.get('Q1331646').photo;
  const retiredAt = Date.parse('2026-11-01T00:00:00Z');
  appendRetainedPhotos(dir, [photoA], retiredAt);
  const fresh = createPlaceMedia({ dir, clock: () => retiredAt + RETAIN_MS - 1, fetcher: async () => { throw new Error('offline'); } });
  assert.deepEqual(fresh.byMediaId(photoA.media_id), photoA);
  const late = createPlaceMedia({ dir, clock: () => retiredAt + RETAIN_MS + 1, fetcher: async () => { throw new Error('offline'); } });
  assert.equal(late.byMediaId(photoA.media_id), undefined);
  // Broken retained lines never become servable ids.
  fs.appendFileSync(path.join(dir, RETAINED_FILE), `${JSON.stringify({ v: 1, retired_at: '2026-11-24T00:00:00Z', photo: { ...photoA, media_id: 'nope' } })}\n{bad\n`);
  assert.doesNotThrow(() => createPlaceMedia({ dir, fetcher: async () => { throw new Error('offline'); } }));
});

test('a photo two places use stays current when one of them gets another photo', async t => {
  const dir = tempDir(t);
  const records = await fixtureRecords(['Q1331646', 'Q1506922']);
  const medelhavs = records.get('Q1331646');
  const other = records.get('Q1506922');
  const shared = medelhavs.photo;
  fs.writeFileSync(path.join(dir, 'index-v1.jsonl'),
    `${JSON.stringify(medelhavs)}\n${JSON.stringify({ ...other, photo: shared })}\n`);
  // The later learned record moves the second place to its own photo.
  fs.writeFileSync(path.join(dir, 'learned-v1.jsonl'), `${JSON.stringify(other)}\n`);
  const service = createPlaceMedia({ dir, fetcher: async () => { throw new Error('offline'); } });
  assert.deepEqual(service.peek('Q1331646').photo, shared);
  assert.deepEqual(service.byMediaId(shared.media_id), shared, 'still used by Q1331646');
  assert.deepEqual(service.byMediaId(other.photo.media_id), other.photo);
});
