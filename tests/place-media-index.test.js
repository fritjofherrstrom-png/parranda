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
