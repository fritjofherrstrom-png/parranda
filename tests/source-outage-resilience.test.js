const test = require('node:test');
const assert = require('node:assert/strict');
const { createBackgroundSource, SOURCE_COMPLETION } = require('../server/place-candidates/background-source');
const { createSourceCache } = require('../server/place-candidates/source-cache');
const { composeOpenDataLoaders, createOpenDataLoader, createOvertureBackgroundSource } = require('../server/place-candidates/open-data-loader');
const { createOvertureSource } = require('../server/place-candidates/overture-source');
const { lifecycleLoader } = require('../server/planner/cold-lifecycle');
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const failedPrimary = () => Object.assign([], { loader_status: 'error_failed_closed', loader_error: 'http_non_200' });

test('cold optional fallback joins the failed primary execution without a second acquisition', async () => {
  const work = deferred(); let calls = 0;
  const fallback = createBackgroundSource({ cache: createSourceCache(), keyFor: a => `${a.lat},${a.lng}`,
    eager: false, waitForCompletion: false, load: () => { calls++; return work.promise; } });
  const loader = composeOpenDataLoaders(failedPrimary, fallback);
  const result = await loader({ lat: 51.5117, lng: -0.124, requestedIntents: ['museums'] });
  assert.ok(result[SOURCE_COMPLETION], 'a cold fallback must not finalize loader_error while its own original acquisition is pending');
  work.resolve([{ id: 'wikidata-Q1', type: 'museum', lat: 51.512, lng: -0.124 }]);
  const ready = await result[SOURCE_COMPLETION];
  assert.equal(ready.length, 1);
  assert.equal(ready.loader_status, 'loaded:1');
  assert.equal(calls, 1);
  const warm = await loader({ lat: 51.5117, lng: -0.124 });
  assert.equal(warm.length, 1);
  assert.equal(calls, 1);
});

test('completed rescue retains the primary outage instead of reporting healthy food supply', async () => {
  const work = deferred();
  const fallback = createBackgroundSource({ cache: createSourceCache(), keyFor: () => 'one', load: () => work.promise });
  const result = await composeOpenDataLoaders(failedPrimary, null, fallback)({ lat: 1, lng: 2 });
  assert.ok(result[SOURCE_COMPLETION]);
  work.resolve([{ id: 'directory-food', type: 'restaurant', lat: 1, lng: 2 }]);
  const ready = await result[SOURCE_COMPLETION];
  assert.equal(ready.loader_status, 'loaded:1');
  assert.equal(ready.loader_error, 'http_non_200');
});

test('failed empty fallback with a genuine empty primary is not healthy empty supply', async () => {
  const failure = Object.defineProperty([], 'source_error', { value: 'fetch_error' });
  const primary = () => Object.assign([], { loader_status: 'loaded:0', loader_error: null });
  const result = await composeOpenDataLoaders(primary, null, { load: () => failure })({ lat: 1, lng: 2 });
  assert.equal(result.loader_status, 'error_failed_closed');
  assert.equal(result.loader_error, 'fetch_error');
});

test('eager failed source is not silently acquired twice inside an outage composition', async () => {
  let calls = 0;
  const source = { eager: true, load: () => { calls++; return Object.defineProperty([], 'source_error', { value: 'fetch_error' }); } };
  const result = await composeOpenDataLoaders(failedPrimary, null, source)({ lat: 1, lng: 2 });
  assert.equal(calls, 1);
  assert.equal(result.loader_status, 'error_failed_closed');
});

test('throwing eager fallback fails closed once rather than becoming healthy empty supply', async () => {
  for (const asynchronous of [false, true]) {
    let calls = 0;
    const source = { eager: true, load: () => { calls++; if (asynchronous) return Promise.reject(new Error('secret provider detail')); throw new Error('secret provider detail'); } };
    const primary = () => Object.assign([], { loader_status: 'loaded:0' });
    const result = await composeOpenDataLoaders(primary, null, source)({ lat: 1, lng: 2 });
    assert.equal(result.loader_status, 'error_failed_closed');
    assert.equal(result.loader_error, 'fetch_error');
    assert.equal(calls, 1);
    assert.ok(!JSON.stringify(result.loader_metadata).includes('secret'));
  }
});

// Characterization guards exercise the actual directory ingestion and selection,
// never a fabricated candidate injected past its source contract.
function foodRow(anchor, overrides = {}) {
  return { id: '12345678-1234-1234-1234-123456789abc', name: 'Source-owned restaurant',
    category: 'thai_restaurant', category_hierarchy: ['restaurant', 'thai_restaurant'],
    confidence: 0.99, operating_status: 'open', licenses: ['CC0-1.0'],
    lat: anchor.lat + 0.001, lng: anchor.lng, ...overrides };
}
const anchors = [
  { lat: 51.5117, lng: -0.124 },
  { lat: 59.8586, lng: 17.6389 },
  { lat: 45.764, lng: 4.8357 },
];
for (const anchor of anchors) test(`Overpass outage consumes authoritative Overture food cold and warm at ${anchor.lat},${anchor.lng}`, async () => {
  const work = deferred(); let queries = 0, primaryCalls = 0;
  const raw = createOvertureSource({ releaseResolver: async () => '2026-08-19.0', queryRows: () => { queries++; return work.promise; } });
  const directory = createOvertureBackgroundSource({ source: raw, cache: createSourceCache() });
  const primary = createOpenDataLoader({ cache: createSourceCache(), fetcher: async () => { primaryCalls++; return { ok: false }; } });
  const loader = composeOpenDataLoaders(primary, null, directory);
  const request = { ...anchor, requestedIntents: ['food'] };
  const pending = await loader(request);
  assert.ok(pending[SOURCE_COMPLETION]);
  work.resolve([foodRow(anchor)]);
  const cold = await pending[SOURCE_COMPLETION];
  assert.equal(cold.length, 1);
  assert.equal(cold[0].type, 'restaurant');
  assert.equal(cold[0].id, 'overture-12345678-1234-1234-1234-123456789abc');
  assert.equal(cold[0].lat, anchor.lat + 0.001);
  assert.equal(cold[0].lng, anchor.lng);
  assert.deepEqual(cold[0].sources.map(s => [s.provider, s.family, s.tier, s.license]), [['overture', 'open_directory', 'inferred', 'CC0-1.0']]);
  assert.deepEqual(cold.loader_metadata.selected_profile.requested_intents_covered, ['food']);
  assert.equal(cold.loader_error, 'http_non_200');
  const warm = await loader(request);
  assert.equal(warm[0].id, cold[0].id);
  assert.equal(queries, 1);
  assert.equal(primaryCalls, 2, 'a failed primary is not cached as a genuine empty success');
});

test('directory ingestion never manufactures food from names, invalid identities, untrusted categories or geography', async () => {
  const anchor = anchors[0];
  const rows = [foodRow(anchor, { category: 'future_restaurant', category_hierarchy: ['restaurant', 'future_restaurant'] }),
    foodRow(anchor, { id: 'invalid' }), foodRow(anchor, { lat: null }),
    foodRow(anchor, { confidence: 0.9 }), foodRow(anchor, { licenses: [] }),
    foodRow(anchor, { lat: anchor.lat + 1 }), foodRow(anchor, { operating_status: 'permanently_closed' }),
    foodRow(anchor, { category: 'museum', category_hierarchy: ['museum'] })];
  const source = createOvertureSource({ releaseResolver: async () => '2026-08-19.0', queryRows: async () => rows });
  const result = await source(anchor);
  assert.equal(result.length, 1);
  assert.equal(result[0].type, 'museum', 'a food-looking name is not authoritative food classification');
});

test('healthy primary leaves optional fallback nonblocking but retains its single original cache warm', async () => {
  const work = deferred(); let calls = 0;
  const optional = createBackgroundSource({ cache: createSourceCache(), keyFor: () => 'one',
    eager: false, waitForCompletion: false, load: () => { calls++; return work.promise; } });
  const result = await composeOpenDataLoaders(() => [{ id: 'osm-1', type: 'museum' }], optional)({ lat: 1, lng: 2 });
  assert.equal(result.length, 1);
  assert.equal(result[SOURCE_COMPLETION], undefined);
  work.resolve([{ id: 'wiki-1', type: 'park' }]);
  await new Promise(r => setImmediate(r));
  assert.equal(optional.readCached({}, {}).length, 1);
  assert.equal(calls, 1);
});

test('genuine empty directory acquisition remains healthy empty and is cached', async () => {
  let queries = 0;
  const raw = createOvertureSource({ releaseResolver: async () => '2026-08-19.0', queryRows: async () => { queries++; return []; } });
  const directory = createOvertureBackgroundSource({ source: raw, cache: createSourceCache() });
  const loader = composeOpenDataLoaders(() => Object.assign([], { loader_status: 'loaded:0' }), null, directory);
  const initial = await loader(anchors[1]);
  const result = initial[SOURCE_COMPLETION] ? await initial[SOURCE_COMPLETION] : initial;
  assert.equal(result.loader_status, 'loaded:0');
  assert.equal(result.loader_error, null);
  const warm = await loader(anchors[1]);
  assert.equal(warm.loader_status, 'loaded:0');
  assert.equal(queries, 1);
});

test('failed directory release is not cached and a later execution can recover food without an internal retry', async () => {
  let releases = 0, queries = 0;
  const anchor = anchors[1];
  const raw = createOvertureSource({ releaseResolver: async () => ++releases === 1 ? null : '2026-08-19.0',
    queryRows: async () => { queries++; return [foodRow(anchor)]; } });
  const directory = createOvertureBackgroundSource({ source: raw, cache: createSourceCache() });
  const primary = () => Object.assign([], { loader_status: 'loaded:0' });
  const loader = composeOpenDataLoaders(primary, null, directory);
  const initial = await loader(anchor);
  const failed = initial[SOURCE_COMPLETION] ? await initial[SOURCE_COMPLETION] : initial;
  assert.equal(failed.loader_status, 'error_failed_closed');
  assert.equal(releases, 1);
  assert.equal(queries, 0);
  const next = await loader(anchor);
  const ready = next[SOURCE_COMPLETION] ? await next[SOURCE_COMPLETION] : next;
  assert.equal(ready[0].type, 'restaurant');
  assert.equal(releases, 2);
  assert.equal(queries, 1);
});

test('concurrent generations coalesce original primary and directory jobs without mixing coordinate windows', async () => {
  const anchor = anchors[2], work = deferred(); let queries = 0, overpassCalls = 0;
  const raw = createOvertureSource({ releaseResolver: async () => '2026-08-19.0', queryRows: () => { queries++; return work.promise; } });
  const directory = createOvertureBackgroundSource({ source: raw, cache: createSourceCache() });
  const overpassWork = deferred();
  const primary = createOpenDataLoader({ cache: createSourceCache(), fetcher: () => { overpassCalls++; return overpassWork.promise; } });
  const loader = composeOpenDataLoaders(primary, null, directory);
  const a = loader(anchor), b = loader(anchor);
  overpassWork.resolve({ ok: false });
  const [first, second] = await Promise.all([a, b]);
  work.resolve([foodRow(anchor)]);
  const [one, two] = await Promise.all([first[SOURCE_COMPLETION], second[SOURCE_COMPLETION]]);
  assert.deepEqual(one.map(r => r.id), two.map(r => r.id));
  assert.equal(queries, 1);
  assert.equal(overpassCalls, 1);
  assert.deepEqual(directory.readCached(anchors[0], {}), []);
});

test('failed primary lifecycle awaits cold optional supply within the same generation', async () => {
  const work = deferred(); let calls = 0, warming = 0;
  const optional = createBackgroundSource({ cache: createSourceCache(), keyFor: () => 'one', eager: false,
    waitForCompletion: false, load: () => { calls++; return work.promise; } });
  const controller = new AbortController();
  const load = lifecycleLoader(composeOpenDataLoaders(failedPrimary, optional), {
    signal: controller.signal, deadline: Date.now() + 1000, warming: () => { warming++; },
  }, { partialWaitMs: 100, reserveMs: 0 });
  const result = load({ lat: 1, lng: 2 });
  await new Promise(r => setImmediate(r));
  assert.equal(warming, 1);
  work.resolve([{ id: 'wiki-1', type: 'park', lat: 1, lng: 2 }]);
  assert.equal((await result)[0].id, 'wiki-1');
  assert.equal(calls, 1);
});
