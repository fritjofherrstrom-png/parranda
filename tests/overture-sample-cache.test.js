'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createSourceCache, DEFAULT_TTL_MS } = require('../server/place-candidates/source-cache');

const KEY = '51.5074456,-0.1277653:r5:c0.95';
const RELEASE = '2026-09-23.1';
const QUERY_HASH = 'a'.repeat(64);
const hash = rows => crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex');
const asset = (release = RELEASE) => ({ path: `s3://overturemaps-us-west-2/release/${release}/theme=places/type=place/part-00001-example.zstd.parquet`, etag: '"revision-a"', length: 128 });
const rows = () => [{ id: 'overture-one', name: 'A park', type: 'park', lat: 51.507, lng: -0.128 }];
function accepted(records = rows(), overrides = {}) {
  Object.defineProperty(records, 'source_receipt', { value: {
    version: 1, release: RELEASE, queryHash: QUERY_HASH, assets: [asset()],
    acquiredAt: 1000, verifiedAt: 1000, recordsHash: hash(records), ...overrides,
  } });
  return records;
}
function setup(options = {}) {
  const { createOvertureSampleCache } = require('../server/place-candidates/overture-sample-cache');
  const clock = { time: 1000 };
  const raw = createSourceCache({ ttlMs: 100, now: () => clock.time, ...options });
  const cache = createOvertureSampleCache({ cache: raw, now: () => clock.time });
  return { raw, cache, clock, createOvertureSampleCache };
}
function envelope(records = rows(), receipt = accepted(records).source_receipt) {
  return { version: 1, cacheKey: KEY, records, receipt };
}

test('accepted source receipts survive disk restart with ordinary TTL and a private receipt', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'parranda-overture-sample-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const { createOvertureSampleCache } = require('../server/place-candidates/overture-sample-cache');
  let time = 1000;
  const raw = createSourceCache({ dir, namespace: 'overture-v6', now: () => time });
  const cache = createOvertureSampleCache({ cache: raw, now: () => time });
  const produced = accepted();
  await cache.get(KEY, async () => produced);
  assert.equal(raw.inspect(KEY).expiresAt, 1000 + DEFAULT_TTL_MS);
  const restarted = createOvertureSampleCache({
    cache: createSourceCache({ dir, namespace: 'overture-v6', now: () => time }), now: () => time,
  });
  const result = await restarted.get(KEY, () => { throw new Error('fresh receipt reacquired'); });
  assert.deepEqual(result, rows());
  assert.deepEqual(result.source_receipt, produced.source_receipt);
  assert.equal(Object.getOwnPropertyDescriptor(result, 'source_receipt').enumerable, false);
  assert.equal(JSON.stringify(result).includes('source_receipt'), false);
  assert.equal(restarted.previous(KEY), null);
});

test('expired samples require the original receipt before revalidation can renew their TTL', async () => {
  const { raw, cache, clock } = setup();
  await cache.get(KEY, async () => accepted());
  clock.time = 1100;
  assert.equal(cache.peek(KEY), null);
  const previous = cache.previous(KEY);
  assert.deepEqual(previous.records, rows());
  assert.equal(previous.receipt.acquiredAt, 1000);
  let checks = 0;
  const result = await cache.get(KEY, async () => {
    checks++;
    return accepted([...previous.records], { ...previous.receipt, verifiedAt: clock.time });
  });
  assert.equal(checks, 1);
  assert.equal(result.source_receipt.acquiredAt, 1000);
  assert.equal(result.source_receipt.verifiedAt, 1100);
  assert.equal(result.source_receipt.recordsHash, previous.receipt.recordsHash);
  assert.equal(raw.inspect(KEY).expiresAt, 1200);
});

test('changed releases replace an expired sample only after the new producer succeeds', async () => {
  const { cache, clock } = setup();
  await cache.get(KEY, async () => accepted());
  clock.time = 1101;
  let finish;
  const acquisition = cache.get(KEY, () => new Promise(resolve => { finish = resolve; }));
  assert.equal(cache.peek(KEY), null);
  const next = [{ ...rows()[0], id: 'overture-new', name: 'New park' }];
  finish(accepted(next, { release: '2026-10-21.0', assets: [asset('2026-10-21.0')], acquiredAt: 1101, verifiedAt: 1101 }));
  assert.equal((await acquisition)[0].id, 'overture-new');
  assert.equal(cache.peek(KEY).source_receipt.release, '2026-10-21.0');
});

test('failed renewal never serves expired rows or extends their expiry even when stale options are requested', async () => {
  const { raw, cache, clock } = setup();
  await cache.get(KEY, async () => accepted());
  const prior = raw.inspect(KEY);
  clock.time = 1200;
  let calls = 0;
  await assert.rejects(cache.get(KEY, async () => { calls++; throw new Error('HEAD unavailable'); }, {
    staleIfErrorMs: 10000,
  }), /HEAD unavailable/);
  assert.equal(calls, 1);
  assert.equal(cache.peek(KEY), null);
  assert.equal(raw.inspect(KEY).expiresAt, prior.expiresAt);
  assert.equal(cache.previous(KEY).receipt.verifiedAt, 1000);
  const failed = Object.defineProperty([], 'source_error', { value: 'fetch_error' });
  assert.equal(await cache.get(KEY, async () => failed), failed);
  assert.equal(raw.inspect(KEY).expiresAt, prior.expiresAt);
});

test('a fresh bare legacy array is never accepted as version-bound evidence', async () => {
  const { raw, cache, clock } = setup();
  raw.set(KEY, rows());
  assert.equal(cache.peek(KEY), null);
  assert.equal(cache.previous(KEY), null);
  let calls = 0;
  const fresh = await cache.get(KEY, async () => { calls++; return accepted(); });
  assert.equal(calls, 1);
  assert.equal(fresh[0].id, 'overture-one');
  clock.time = 1200;
  assert.ok(cache.previous(KEY));
});

test('malformed, wrong-window and incomplete receipts never become fresh or reusable', async t => {
  const bad = [
    ['wrong envelope version', value => { value.version = 2; }],
    ['wrong cache key', value => { value.cacheKey = 'another-window'; }],
    ['wrong receipt version', value => { value.receipt.version = 2; }],
    ['bad row hash', value => { value.receipt.recordsHash = 'b'.repeat(64); }],
    ['bad query hash', value => { value.receipt.queryHash = 'unbound'; }],
    ['unknown release', value => { value.receipt.release = 'latest'; }],
    ['future verification', value => { value.receipt.verifiedAt = 1001; }],
    ['verification before acquisition', value => { value.receipt.acquiredAt = 1001; }],
    ['weak ETag', value => { value.receipt.assets[0].etag = 'W/"revision-a"'; }],
    ['unquoted ETag', value => { value.receipt.assets[0].etag = 'revision-a'; }],
    ['truncated parquet', value => { value.receipt.assets[0].length = 11; }],
    ['wrong release asset', value => { value.receipt.assets[0].path = asset('2026-10-21.0').path; }],
    ['off-provider asset', value => { value.receipt.assets[0].path = 'https://arbitrary.example/places.parquet'; }],
    ['duplicate asset', value => { value.receipt.assets.push({ ...value.receipt.assets[0] }); }],
    ['too many assets', value => { value.receipt.assets = Array.from({ length: 65 }, (_, i) => ({ ...asset(), path: asset().path.replace('example', `file${i}`) })); }],
    ['nonempty rows without assets', value => { value.receipt.assets = []; }],
    ['out of scope shape', value => { value.records[0].lat = 91; value.receipt.recordsHash = hash(value.records); }],
    ['too many records', value => { value.records = Array.from({ length: 601 }, (_, i) => ({ ...rows()[0], id: `place-${i}` })); value.receipt.recordsHash = hash(value.records); }],
  ];
  for (const [name, corrupt] of bad) await t.test(name, () => {
    const { raw, cache, clock } = setup();
    const value = JSON.parse(JSON.stringify(envelope()));
    corrupt(value);
    raw.set(KEY, value);
    assert.equal(cache.peek(KEY), null);
    clock.time = 1200;
    assert.equal(cache.previous(KEY), null);
  });
});

test('a source-specific receipt validator rejects a mismatched query for this cache key', async () => {
  const { raw, clock, createOvertureSampleCache } = setup();
  raw.set(KEY, envelope());
  let seen;
  const cache = createOvertureSampleCache({ cache: raw, now: () => clock.time,
    validateReceipt: (receipt, key) => { seen = [receipt.queryHash, key]; return false; },
  });
  assert.equal(cache.peek(KEY), null);
  assert.deepEqual(seen, [QUERY_HASH, KEY]);
  clock.time = 1200;
  assert.equal(cache.previous(KEY), null);
});

test('concurrent misses share one acquisition and aborted producers cannot persist a late sample', async () => {
  const { raw, cache } = setup();
  const owner = new AbortController();
  let finish, calls = 0;
  const producer = () => { calls++; return new Promise(resolve => { finish = resolve; }); };
  const first = cache.get(KEY, producer, { signal: owner.signal });
  const second = cache.get(KEY, producer, { signal: owner.signal });
  assert.equal(calls, 1);
  owner.abort();
  finish(accepted());
  await Promise.all([first, second]);
  assert.equal(raw.inspect(KEY), null);
  assert.equal(cache.peek(KEY), null);
});

test('private source arrays without receipts pass through but cannot populate the verified cache', async () => {
  const { raw, cache } = setup();
  const fixture = rows();
  assert.equal(await cache.get(KEY, async () => fixture), fixture);
  assert.equal(raw.inspect(KEY), null);
  assert.equal(cache.peek(KEY), null);
  assert.equal(cache.previous(KEY), null);
});

test('a complete successful empty sample remains a fresh empty answer after restart', async () => {
  const { raw, cache, createOvertureSampleCache } = setup();
  const empty = accepted([], { assets: [] });
  await cache.get(KEY, async () => empty);
  const restarted = createOvertureSampleCache({ cache: raw, now: () => 1000 });
  assert.deepEqual(await restarted.get(KEY, () => { throw new Error('verified absence reacquired'); }), []);
  assert.equal(restarted.peek(KEY).source_receipt.recordsHash, '4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945');
});

test('a resident expired web sample observes a newer worker renewal on their shared disk', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'parranda-shared-renewal-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const { createOvertureSampleCache } = require('../server/place-candidates/overture-sample-cache');
  let time = 1000;
  const make = () => createOvertureSampleCache({
    cache: createSourceCache({ namespace: 'shared-v6', dir, ttlMs: 100, now: () => time }), now: () => time,
  });
  const web = make(), worker = make();
  await web.get(KEY, async () => accepted());
  time = 1101;
  await worker.get(KEY, async () => accepted([{ ...rows()[0], id: 'renewed-worker-place' }], { acquiredAt: 1101, verifiedAt: 1101 }));
  assert.equal(web.peek(KEY)?.[0]?.id, 'renewed-worker-place');
  const value = await web.get(KEY, async () => { throw new Error('fresh shared evidence must not trigger reacquisition'); });
  assert.equal(value[0].id, 'renewed-worker-place');
});
