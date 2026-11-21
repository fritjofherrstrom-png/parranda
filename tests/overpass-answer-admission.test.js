'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createSourceCache } = require('../server/place-candidates/source-cache');
const { createHash } = require('node:crypto');
const { createOpenDataLoader, mapOsmElement } = require('../server/place-candidates/open-data-loader');

const PLACE = { lat: 41.9, lng: 12.5, anchorMode: 'place', dayRhythm: 'calm' };
const windowAt = startMinute => ({ weekday: 6, startMinute, endMinute: 1440 });
const KINDS = [{ amenity: 'restaurant' }, { amenity: 'cafe' }, { tourism: 'museum' }, { leisure: 'park' }, { amenity: 'bar' }];
const elements = () => Array.from({ length: 20 }, (_, i) => ({
  type: 'node', id: 501 + i, lat: PLACE.lat + i * 0.0003, lon: PLACE.lng,
  tags: { name: `Admission fixture ${i}`, ...KINDS[i % KINDS.length] },
}));

test('a partial success-200 answer is not admitted as healthy or replayed without its remark', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'parranda-overpass-admission-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const cache = createSourceCache({ namespace: 'overpass', dir });
  let partial = true, calls = 0;
  const loader = createOpenDataLoader({ cache, endpoint: 'https://fixture.invalid/overpass',
    fetcher: async () => {
      calls += 1;
      return { ok: true, status: 200, json: async () => partial
        ? { remark: 'runtime error: controlled incomplete query', elements: elements() }
        : { elements: elements() } };
    } });
  const rejected = await loader({ ...PLACE, availabilityWindow: windowAt(600) });
  assert.equal(rejected.loader_status, 'error_failed_closed',
    'HTTP success does not attest a complete map answer when the provider reports a runtime error');
  assert.equal(rejected.length, 0, 'partial positive facts must not become a healthy complete selection');
  assert.ok(rejected.loader_error, 'the semantic provider failure is retained as a bounded error token');
  assert.deepEqual(fs.readdirSync(path.join(dir, 'overpass')), [], 'neither raw nor selected positive/empty evidence is persisted');

  partial = false;
  const beforeRecovery = calls;
  const recovered = await loader({ ...PLACE, availabilityWindow: windowAt(601) });
  assert.ok(calls > beforeRecovery, 'the bad answer must not suppress a new acquisition across windows');
  assert.equal(recovered.loader_error, null);
  assert.ok(recovered.length > 0);
  const beforeReuse = calls;
  const reused = await loader({ ...PLACE, availabilityWindow: windowAt(602) });
  assert.equal(calls, beforeReuse, 'a complete nonempty answer still has normal raw-query reuse');
  assert.deepEqual(reused.map(row => row.id).sort(), recovered.map(row => row.id).sort());
});

test('legacy raw answers cannot bypass the complete-envelope admission contract', async () => {
  let firstQuery;
  const probe = createOpenDataLoader({ endpoint: 'https://fixture.invalid/overpass', fetcher: async (_url, init) => {
    firstQuery ??= decodeURIComponent(init.body.replace(/^data=/, ''));
    return { ok: true, json: async () => ({ elements: elements() }) };
  } });
  await probe({ ...PLACE, availabilityWindow: windowAt(600) });
  const cache = createSourceCache({ namespace: 'overpass' });
  // Actual pre-admission raw format. Its remark/error was already discarded:
  // a later reader cannot reconstruct proof that this was a complete answer.
  const legacyKey = `query-v1:${createHash('sha256').update(firstQuery).digest('hex')}`;
  cache.set(legacyKey, { elements: elements() });
  let calls = 0;
  const loader = createOpenDataLoader({ cache, endpoint: 'https://fixture.invalid/overpass',
    fetcher: async () => { calls += 1; return { ok: true, json: async () => ({ elements: elements() }) }; } });
  const result = await loader({ ...PLACE, availabilityWindow: windowAt(600) });
  assert.ok(calls > 0, 'an unvalidated raw-v1 record must not be silently grandfathered in');
  assert.ok(result.length > 0);
  assert.equal(result.loader_error, null);
  assert.ok(cache.inspect(legacyKey), 'old evidence is preserved, not rewritten with new authority');
});

test('legacy selected and neighbouring entries do not survive as newly admitted evidence', async () => {
  const cache = createSourceCache({ namespace: 'overpass' });
  // Literal former request/index formats for this verified fixture tuple.
  const oldKey = 'q2:v10:41.900,12.500:r1.5:w6.600.1440:l25:mplace:iall:tnone:snone';
  const oldIndex = 'q2:v10-evidence:41.900,12.500:l25:mplace:snone';
  cache.set(oldKey, { records: elements().map(mapOsmElement), status: 'loaded:20', error: null, metadata: null });
  cache.set(oldIndex, [{ key: oldKey, target_km: null, radius_km: 1.5 }]);
  let calls = 0;
  const loader = createOpenDataLoader({ cache, endpoint: 'https://fixture.invalid/overpass',
    fetcher: async () => { calls += 1; return { ok: true, json: async () => ({ elements: elements() }) }; } });
  assert.equal((await loader.readCached(PLACE, { availabilityWindow: windowAt(600) })).length, 0,
    'fast peek must not promote a legacy selection that lost its response envelope');
  assert.equal(loader.readNeighbouring(PLACE, { availabilityWindow: windowAt(601) }), null);
  const result = await loader({ ...PLACE, availabilityWindow: windowAt(600) });
  assert.ok(calls > 0, 'normal get must acquire a newly validated answer as well');
  assert.equal(result.loader_error, null);
  assert.ok(result.length > 0);
  assert.ok(cache.inspect(oldKey), 'the legacy entry is not relabelled or deleted');
});

test('error-shaped collection members do not become healthy empty map evidence', async () => {
  const loader = createOpenDataLoader({ cache: createSourceCache({ namespace: 'overpass' }),
    endpoint: 'https://fixture.invalid/overpass',
    fetcher: async () => ({ ok: true, json: async () => ({ elements: [{ status: 'upstream_failed' }] }) }) });
  const result = await loader(PLACE);
  assert.equal(result.loader_status, 'error_failed_closed', 'a nonempty non-OSM collection is not a genuine empty result');
  assert.equal(result.length, 0);
});

test('malformed/error success-200 envelopes never attest healthy absence', async t => {
  const cases = [
    ['null', null], ['array', []], ['string', 'failed'], ['missing collection', {}],
    ['null collection', { elements: null }], ['wrong collection type', { elements: 'failed' }],
    ['null member', { elements: [null] }], ['untyped object', { elements: [{}] }],
    ['mixed malformed collection', { elements: [elements()[0], null] }],
    ['error with empty collection', { error: 'failed', elements: [] }],
    ['remark with empty collection', { remark: 'runtime error: controlled failure', elements: [] }],
    ['malformed remark', { remark: 12, elements: [] }],
  ];
  for (const [label, payload] of cases) await t.test(label, async () => {
    let calls = 0;
    const loader = createOpenDataLoader({ cache: createSourceCache({ namespace: 'overpass' }),
      endpoint: 'https://fixture.invalid/overpass', fetcher: async () => {
        calls += 1; return { ok: true, json: async () => payload };
      } });
    const result = await loader(PLACE);
    assert.equal(result.loader_status, 'error_failed_closed');
    assert.equal(result.loader_error, 'invalid_response');
    assert.equal(result.length, 0);
    const before = calls;
    await loader(PLACE);
    assert.ok(calls > before, 'an invalid envelope is not cached as healthy emptiness');
  });
});

test('a genuine empty answer stays a healthy empty selection without mirror failover', async () => {
  let calls = 0;
  const targets = [];
  const loader = createOpenDataLoader({ cache: createSourceCache({ namespace: 'overpass' }),
    endpoints: ['https://fixture-a.invalid/overpass', 'https://fixture-b.invalid/overpass'],
    fetcher: async url => { calls += 1; targets.push(url); return { ok: true, json: async () => ({ elements: [] }) }; } });
  const first = await loader(PLACE);
  assert.equal(first.loader_status, 'loaded:0');
  assert.equal(first.loader_error, null);
  assert.ok(targets.length > 0 && targets.every(url => url === 'https://fixture-a.invalid/overpass'),
    'legitimate empty may widen within policy but never fails over to another mirror');
  const initialCalls = calls;
  const second = await loader(PLACE);
  assert.equal(second.loader_status, 'loaded:0');
  assert.equal(second.loader_error, null);
  assert.equal(calls, initialCalls, 'the existing selected-empty cache contract is preserved');
});

test('semantic refresh failure preserves a labelled complete stale answer without renewing it', async () => {
  const HOUR = 60 * 60 * 1000;
  let now = 1_000_000_000_000, partial = false, query;
  const cache = createSourceCache({ namespace: 'overpass', now: () => now });
  const loader = createOpenDataLoader({ cache, now: () => now, staleIfErrorMs: 7 * 24 * HOUR,
    endpoint: 'https://fixture.invalid/overpass', fetcher: async (_url, init) => {
      query ??= decodeURIComponent(init.body.replace(/^data=/, ''));
      return { ok: true, json: async () => partial
        ? { remark: 'runtime error: controlled incomplete refresh', elements: elements() }
        : { elements: elements() } };
    } });
  const first = await loader({ ...PLACE, availabilityWindow: windowAt(600) });
  const key = `query-v2:${createHash('sha256').update(query).digest('hex')}`;
  const expiry = cache.inspect(key).expiresAt;
  now += 7 * HOUR;
  partial = true;
  const stale = await loader({ ...PLACE, availabilityWindow: windowAt(601) });
  assert.deepEqual(stale.map(row => row.id).sort(), first.map(row => row.id).sort());
  assert.equal(stale.loader_error, 'stale_cache_refresh_failed');
  assert.deepEqual(stale.loader_metadata.cache, {
    served_stale: true, stale_age_seconds: 3600, refresh_reason: 'invalid_response',
  });
  assert.equal(cache.inspect(key).expiresAt, expiry);
});

test('an invalid envelope can fail over only within the configured mirror set', async () => {
  const targets = [];
  const loader = createOpenDataLoader({ cache: createSourceCache({ namespace: 'overpass' }),
    endpoints: ['https://fixture-a.invalid/overpass', 'https://fixture-b.invalid/overpass'],
    fetcher: async url => {
      targets.push(url);
      return { ok: true, json: async () => url.includes('fixture-a')
        ? { error: 'controlled failure', elements: elements() } : { elements: elements() } };
    } });
  const result = await loader({ ...PLACE, availabilityWindow: windowAt(600) });
  assert.ok(result.length > 0);
  assert.equal(result.loader_error, null);
  assert.deepEqual(targets, ['https://fixture-a.invalid/overpass', 'https://fixture-b.invalid/overpass']);
  await loader({ ...PLACE, availabilityWindow: windowAt(601) });
  assert.equal(targets.length, 2, 'complete recovery is normally reusable');
});
