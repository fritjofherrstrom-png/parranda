'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { createSourceCache } = require('../server/place-candidates/source-cache');
const { createOpenDataLoader } = require('../server/place-candidates/open-data-loader');

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const PLACE = { lat: 41.9, lng: 12.5, dayRhythm: 'balanced', anchorMode: 'place' };
const windowAt = startMinute => ({ weekday: 6, startMinute, endMinute: 1440 });
const KINDS = [{ amenity: 'restaurant' }, { amenity: 'cafe' }, { tourism: 'museum' }, { leisure: 'park' }, { amenity: 'bar' }];
const answer = () => ({ ok: true, status: 200, json: async () => ({ elements: Array.from({ length: 20 }, (_, i) => ({
  type: 'node', id: i + 1, lat: PLACE.lat + i * 0.0004, lon: PLACE.lng,
  tags: { name: `Place ${i}`, ...KINDS[i % KINDS.length] },
})) }) });

test('producer-owned expiry can shorten a projection lifetime but never extend the configured TTL', async () => {
  let now = 1000;
  const cache = createSourceCache({ namespace: 'projection-expiry', ttlMs: 6000, now: () => now });
  await cache.get('short', async () => ({ id: 'source-a', sourceExpiresAt: 2000 }), {
    expiresAt: value => value.sourceExpiresAt,
  });
  assert.equal(cache.inspect('short').expiresAt, 2000);
  now = 2001;
  assert.equal(cache.peek('short'), null, 'peek and disk consumers must see the same original expiry');
  await cache.get('long', async () => ({ sourceExpiresAt: 100_000 }), {
    expiresAt: value => value.sourceExpiresAt,
  });
  assert.equal(cache.inspect('long').expiresAt, now + 6000, 'source expiry cannot raise the operator TTL');
  await cache.get('ordinary', async () => ({ id: 'unrelated-source' }));
  assert.equal(cache.inspect('ordinary').expiresAt, now + 6000, 'existing consumers keep the same default');
});

for (const fileBacked of [false, true]) {
  test(`reselecting a fresh raw answer does not renew its expiry (${fileBacked ? 'disk restart' : 'memory'})`, async t => {
    const dir = fileBacked ? fs.mkdtempSync(path.join(os.tmpdir(), 'parranda-query-expiry-')) : null;
    if (dir) t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const state = { now: 1_000_000_000_000, calls: 0, queries: [], fail: false };
    const open = () => {
      const cache = createSourceCache({ namespace: 'overpass', ttlMs: 6 * HOUR, dir, now: () => state.now });
      const loader = createOpenDataLoader({ cache, staleIfErrorMs: 7 * DAY, now: () => state.now,
        fetcher: async (_url, init) => {
          state.calls += 1;
          state.queries.push(decodeURIComponent(init.body.replace(/^data=/, '')));
          return state.fail ? { ok: false, status: 500, headers: { get: () => null } } : answer();
        } });
      return { cache, loader };
    };
    let { cache, loader } = open();
    const original = await loader({ ...PLACE, availabilityWindow: windowAt(600) });
    assert.ok(original.length > 0, 'precondition: an actual healthy map answer was stored');
    const firstQueryKey = `query-v2:${createHash('sha256').update(state.queries[0]).digest('hex')}`;
    const originalExpiry = cache.inspect(firstQueryKey).expiresAt;

    state.now = originalExpiry - 60_000;
    const beforeWarm = state.calls;
    const reselected = await loader({ ...PLACE, availabilityWindow: windowAt(601) });
    assert.equal(state.calls, beforeWarm, 'the still-fresh raw answer is reused without acquisition');
    assert.equal(reselected.loader_error, null);
    assert.equal(cache.inspect(firstQueryKey).expiresAt, originalExpiry, 'projection does not touch the source entry');
    if (fileBacked) ({ cache, loader } = open());

    state.now = originalExpiry + 1000;
    state.fail = true;
    const beforeExpired = state.calls;
    assert.equal((await loader.readCached(PLACE, { availabilityWindow: windowAt(601) })).length, 0,
      'the fast peek path must not retain the reselected answer after the source expires');
    assert.equal(loader.readNeighbouring(PLACE, { availabilityWindow: windowAt(602) }), null,
      'an index must not lend the expired projection to another request');
    assert.equal(state.calls, beforeExpired, 'these cache-only reads do not acquire');
    const expired = await loader({ ...PLACE, availabilityWindow: windowAt(601) });
    assert.equal(expired.loader_error, 'stale_cache_refresh_failed',
      'the selected-window cache must not call an expired source answer fresh');
    assert.ok(state.calls > beforeExpired, 'expiry refreshes the actual source instead of replaying a renewed projection');
    assert.deepEqual(expired.loader_metadata.cache, {
      served_stale: true, stale_age_seconds: 1, refresh_reason: 'http_non_200',
    });
    assert.deepEqual(expired.map(row => row.id).sort(), original.map(row => row.id).sort());
    assert.equal(cache.inspect(firstQueryKey).expiresAt, originalExpiry, 'fallback never renews the original expiry');
    state.now = originalExpiry + 7 * DAY + 1000;
    const outsideStaleWindow = await loader({ ...PLACE, availabilityWindow: windowAt(601) });
    assert.equal(outsideStaleWindow.length, 0, 'the derived cache cannot extend the original stale allowance either');
    assert.equal(outsideStaleWindow.loader_error, 'http_non_200');
  });
}

test('an opaque cache without expiry inspection keeps request-only caching', async () => {
  const { inspect: _inspect, ...opaque } = createSourceCache({ namespace: 'overpass' });
  let calls = 0;
  const loader = createOpenDataLoader({ cache: opaque, fetcher: async () => { calls += 1; return answer(); } });
  await loader({ ...PLACE, availabilityWindow: windowAt(600) });
  const firstReads = calls;
  const second = await loader({ ...PLACE, availabilityWindow: windowAt(601) });
  assert.ok(calls > firstReads, 'raw reuse needs an inspectable source expiry');
  assert.ok(second.length > 0, 'an opaque cache still permits the ordinary successful request');
  const beforeRepeat = calls;
  assert.ok((await loader.readCached(PLACE, { availabilityWindow: windowAt(601) })).length > 0);
  assert.equal(calls, beforeRepeat, 'ordinary request-level caching still works');
});
