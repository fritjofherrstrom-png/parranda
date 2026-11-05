'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createOvertureSource, mapOvertureRow } = require('../server/place-candidates/overture-source');
const { createOvertureSampleCache, digest, MAX_FALLBACK_AGE_MS } = require('../server/place-candidates/overture-sample-cache');
const { createSourceCache } = require('../server/place-candidates/source-cache');
const { resolveDefaultOpenDataLoader } = require('../server/place-candidates/open-data-loader');
const RELEASE = '2026-09-23.0', ANCHOR = { lat: 40, lng: 12 };
const asset = { path: `s3://overturemaps-us-west-2/release/${RELEASE}/theme=places/type=place/part-books.zstd.parquet`, etag: '"books-v1"', length: 12000 };
// Frozen from the actual base e4021a8 query, not the candidate's compatibility helper.
const PREVIOUS_QUERY_HASH = '4ede1ed60c48f3813d5dfdd6b32a474137e6692e4f75a2e68ef586d4df21d38b';
const failed = () => Object.defineProperty([], 'source_error', { value: 'fetch_error' });
function record(i = 1) {
  return mapOvertureRow({ id: `10000000-0000-0000-0000-${String(i).padStart(12, '0')}`, name: `Кафе ${i}`,
    category: 'coffee_shop', category_hierarchy: ['coffee_shop'], confidence: .99,
    operating_status: null, licenses: ['CC0-1.0'], lat: ANCHOR.lat + i * .0005, lng: ANCHOR.lng });
}
function setup(t, { empty = false, time = 1000, maxFallbackAgeMs } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'parranda-overture-migration-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const clock = { time };
  const source = createOvertureSource({ now: () => clock.time, releaseResolver: async () => { throw Error('controlled_provider_unavailable'); } });
  const key = source.cacheKeyFor(ANCHOR), records = empty ? [] : [record()];
  const prior = { version: 1, cacheKey: key, records, receipt: { version: 1, release: RELEASE,
    queryHash: PREVIOUS_QUERY_HASH, assets: [asset], acquiredAt: time, verifiedAt: time, recordsHash: digest(records) } };
  const options = { dir, namespace: 'overture-v6', ttlMs: 100, now: () => clock.time };
  createSourceCache(options).set(key, prior);
  const raw = createSourceCache(options);
  const cache = createOvertureSampleCache({ cache: raw, now: () => clock.time,
    validateReceipt: source.validateReceipt, validatePreviousReceipt: source.validatePreviousReceipt,
    ...(maxFallbackAgeMs === undefined ? {} : { maxFallbackAgeMs }) });
  return { dir, clock, source, key, prior, raw, cache };
}

for (const expired of [false, true]) test(`actual source failure retains only previous-query positive supply (${expired ? 'expired' : 'fresh old'} disk receipt)`, async t => {
  const { clock, source, key, prior, raw, cache } = setup(t);
  if (expired) clock.time += 200;
  const before = raw.inspect(key);
  assert.equal(source.validateReceipt(prior.receipt, key), false);
  assert.equal(cache.peek(key), null);
  assert.equal(cache.previous(key), null, 'previous query must never enter HEAD-only renewal');
  const result = await cache.get(key, () => source.acquire(ANCHOR));
  assert.deepEqual(result, prior.records, 'approved positive reserve survives the query expansion');
  assert.equal(result.source_error, 'stale_cache_refresh_failed');
  assert.deepEqual(result.source_receipt, prior.receipt);
  assert.equal(result.loader_metadata.cache.query_contract, 'previous');
  assert.equal(result.loader_metadata.cache.served_stale, true);
  assert.equal(result.loader_metadata.cache.stale_age_seconds, Math.floor((clock.time - prior.receipt.verifiedAt) / 1000));
  assert.equal(result[0].opening_hours, undefined);
  assert.deepEqual(raw.inspect(key), before, 'neither receipt nor original expiry may be rewritten');
  assert.equal(cache.peek(key), null);
});

test('thrown refresh error can retain previous positive evidence without suppressing errors absent that evidence', async t => {
  const { cache, key } = setup(t);
  const result = await cache.get(key, async () => { throw Error('controlled_transport_failure'); });
  assert.equal(result.length, 1);
  assert.equal(result.source_error, 'stale_cache_refresh_failed');
  await assert.rejects(cache.get(key + ':other', async () => { throw Error('controlled_transport_failure'); }), /controlled_transport_failure/);
});

test('old negative and successful empty answers cannot borrow previous-query positive supply', async t => {
  const negative = setup(t, { empty: true }), error = failed();
  assert.equal(await negative.cache.get(negative.key, async () => error), error);
  const positive = setup(t), empty = [];
  assert.equal(await positive.cache.get(positive.key, async () => empty), empty);
  const current = createOvertureSource({ now: () => positive.clock.time, releaseResolver: async () => RELEASE,
    assetResolver: async () => [asset.path], queryRows: async () => Object.defineProperty([], 'source_assets', { value: [asset] }) });
  const verifiedEmpty = await positive.cache.get(positive.key, () => current.acquire(ANCHOR));
  assert.deepEqual(verifiedEmpty, []);
  assert.notEqual(verifiedEmpty.source_receipt.queryHash, PREVIOUS_QUERY_HASH);
  assert.equal(current.validateReceipt(verifiedEmpty.source_receipt, positive.key), true);
  assert.deepEqual(positive.cache.peek(positive.key), []);
});

test('unbound hashes, corruption, source drift and another anchor never enter the previous-query fallback', async t => {
  for (const mutate of [
    prior => { prior.receipt.queryHash = 'a'.repeat(64); },
    prior => { prior.receipt.recordsHash = 'a'.repeat(64); },
    prior => { prior.receipt.assets[0].path = prior.receipt.assets[0].path.replace('part-books', 'part-other'); },
    prior => { prior.receipt.assets[0].etag = 'W/"weak"'; },
    prior => { prior.receipt.release = '2026-10-21.0'; },
    prior => { prior.cacheKey = '41.0000000,12.0000000:r5:c0.95'; },
    prior => { prior.receipt.verifiedAt += 1; },
  ]) {
    const fixture = setup(t), broken = structuredClone(fixture.prior);
    mutate(broken); fixture.raw.set(fixture.key, broken);
    const error = failed();
    assert.equal(await fixture.cache.get(fixture.key, async () => error), error);
  }
  for (const differentKey of ['41.0000000,12.0000000:r5:c0.95', '40.0000000,12.0000000:r4:c0.95', '40.0000000,12.0000000:r5:c0.96']) {
    const other = setup(t), error = failed();
    other.raw.set(differentKey, { ...other.prior, cacheKey: differentKey });
    assert.equal(await other.cache.get(differentKey, async () => error), error, 'receipt query hash binds exact anchor and source caps');
  }
});

test('the original verification age and explicit zero fallback remain hard limits across query migration', async t => {
  const fixture = setup(t), error = failed();
  fixture.clock.time += MAX_FALLBACK_AGE_MS;
  assert.equal((await fixture.cache.get(fixture.key, async () => error)).length, 1);
  fixture.clock.time++;
  assert.equal(await fixture.cache.get(fixture.key, async () => error), error);
  const strict = setup(t, { maxFallbackAgeMs: 0 });
  assert.equal(await strict.cache.get(strict.key, async () => error), error);
});

test('an abandoned old refresh cannot publish fallback or overwrite a newer successful generation', async t => {
  const { cache, raw, key, clock } = setup(t), controller = new AbortController();
  let finish;
  const old = cache.get(key, () => new Promise(resolve => { finish = resolve; }), { signal: controller.signal });
  controller.abort();
  const current = createOvertureSource({ now: () => clock.time, releaseResolver: async () => RELEASE,
    assetResolver: async () => [asset.path], queryRows: async () => Object.defineProperty([], 'source_assets', { value: [asset] }) });
  await cache.get(key, () => current.acquire(ANCHOR));
  const published = raw.inspect(key);
  finish(failed());
  await assert.rejects(old, /abort|cancel/i);
  assert.deepEqual(raw.inspect(key), published);
  assert.deepEqual(cache.peek(key), []);
});

test('real loader factory preserves previous-query positive reserve after controlled external failures', async t => {
  const fixture = setup(t, { time: Date.now() - 1000 });
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; return { ok: false, status: 503 }; });
  const loader = resolveDefaultOpenDataLoader({ PARRANDA_OPEN_DATA_LOADER: 'enabled', PARRANDA_OVERTURE_SOURCE: 'enabled',
    PARRANDA_CACHE_DIR: fixture.dir, PARRANDA_SOURCE_CACHE_TTL_MS: '100', PARRANDA_OVERPASS_ENDPOINTS: 'https://controlled.example/overpass' });
  const result = await loader({ ...ANCHOR, requestedIntents: ['fika'] });
  assert.deepEqual(result.map(row => row.id), fixture.prior.records.map(row => row.id));
  assert.equal(result.loader_metadata.cache.served_stale, true);
  assert.equal(result.loader_metadata.cache.query_contract, 'previous');
  assert.ok(calls > 0 && calls <= 4, 'one bounded acquisition through the actual factory, no retry loop');
  assert.equal(result[0].opening_hours, undefined);
});
