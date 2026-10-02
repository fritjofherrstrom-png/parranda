const test = require('node:test');
const assert = require('node:assert/strict');
const { createPlannerLifecycle, lifecycleLoader } = require('../server/planner/cold-lifecycle');
const { createBackgroundSource, SOURCE_COMPLETION } = require('../server/place-candidates/background-source');
const { createSourceCache } = require('../server/place-candidates/source-cache');
const { composeOpenDataLoaders, createOpenDataLoader } = require('../server/place-candidates/open-data-loader');
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

test('cold source shares one acquisition, exposes pending privately, and serves warm without work', async () => {
  const work = deferred(); let calls = 0;
  const source = createBackgroundSource({ cache: createSourceCache(), keyFor: () => 'anchor', load: () => { calls++; return work.promise; } });
  const a = source.load({ lat: 1, lng: 2 });
  const b = source.load({ lat: 1, lng: 2 });
  assert.equal(calls, 1);
  assert.equal(JSON.stringify(a), '[]');
  work.resolve([{ id: 'trusted' }]);
  await a[SOURCE_COMPLETION];
  assert.deepEqual(await b[SOURCE_COMPLETION], [{ id: 'trusted' }]);
  assert.deepEqual(source.load({}), [{ id: 'trusted' }]);
  assert.equal(calls, 1);
});

test('a shared background producer stops only after every lifecycle consumer cancels', async () => {
  const first = new AbortController();
  const second = new AbortController();
  let providerAborted = false;
  const source = createBackgroundSource({
    cache: createSourceCache(),
    keyFor: () => 'shared-anchor',
    load: (anchor) => new Promise((_resolve, reject) => {
      anchor.signal.addEventListener('abort', () => {
        providerAborted = true;
        reject(new Error('provider_cancelled'));
      }, { once: true });
    }),
  });
  const a = source.load({ lat: 1, lng: 2 }, { signal: first.signal });
  const b = source.load({ lat: 1, lng: 2 }, { signal: second.signal });

  first.abort();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(providerAborted, false, 'the second lifecycle still owns the shared work');

  second.abort();
  await a[SOURCE_COMPLETION];
  assert.equal(providerAborted, true);
  assert.equal(await b[SOURCE_COMPLETION].then(value => value.source_error), 'fetch_error');
});

test('pending polls continue the same server execution; neither token nor public fields supply candidates', async () => {
  const jobs = createPlannerLifecycle(); const work = deferred(); let executions = 0;
  const first = await jobs.start(async context => {
    executions++; context.warming(); await work.promise;
    return { status: 200, body: { days: [{ trusted: true }] } };
  });
  assert.equal(first.status, 202);
  const token = first.body.planner_lifecycle.token;
  assert.equal(jobs.read('fake').status, 410);
  assert.equal(jobs.read(token).status, 202);
  assert.equal(executions, 1);
  work.resolve(); await new Promise(r => setImmediate(r));
  assert.deepEqual(jobs.read(token).body, { days: [{ trusted: true }] });
  assert.equal(executions, 1);
  jobs.cancel(token);
  assert.equal(jobs.read(token).status, 410);
});

test('warm completion is immediate and emits no pending contract', async () => {
  const jobs = createPlannerLifecycle();
  const result = await jobs.start(async () => ({ status: 200, body: { days: [] } }));
  assert.deepEqual(result, { status: 200, body: { days: [] } });
});

test('deadline and cancellation are terminal and late work cannot publish a route', async () => {
  const work = deferred();
  const jobs = createPlannerLifecycle({ deadlineMs: 20 });
  const first = await jobs.start(async context => { context.warming(); await work.promise; return { status: 200, body: { route: 'late' } }; });
  const token = first.body.planner_lifecycle.token;
  await new Promise(r => setTimeout(r, 30));
  assert.equal(jobs.read(token).body.error, 'supply_wait_expired');
  work.resolve(); await new Promise(r => setImmediate(r));
  assert.equal(jobs.read(token).body.error, 'supply_wait_expired');
});

test('pending work still occupies capacity after the first HTTP response', async () => {
  const jobs = createPlannerLifecycle({ maxActive: 1 }); const work = deferred();
  const first = await jobs.start(async context => { context.warming(); await work.promise; return { status: 200, body: {} }; });
  assert.equal(first.status, 202);
  assert.equal((await jobs.start(() => assert.fail('must not execute'))).status, 429);
  jobs.cancel(first.body.planner_lifecycle.token);
  assert.equal((await jobs.start(() => assert.fail('still running'))).status, 429);
  work.resolve();
});

test('cancelling the lifecycle aborts its sole background producer and never caches late work', async () => {
  const cache = createSourceCache();
  let providerAborted = false;
  const source = createBackgroundSource({
    cache,
    keyFor: () => 'cancelled-anchor',
    load: (anchor) => new Promise((_resolve, reject) => {
      anchor.signal.addEventListener('abort', () => {
        providerAborted = true;
        reject(new Error('provider_cancelled'));
      }, { once: true });
    }),
  });
  const jobs = createPlannerLifecycle({ maxActive: 1 });
  const first = await jobs.start(async context => {
    const load = lifecycleLoader(request => source.load(request, request), context);
    await load({ lat: 1, lng: 2 });
    return { status: 200, body: { days: [{ id: 'must-not-publish' }] } };
  });
  assert.equal(first.status, 202);

  jobs.cancel(first.body.planner_lifecycle.token);
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(providerAborted, true);
  assert.equal(cache.peek('cancelled-anchor'), null);
  const recovered = await jobs.start(async () => ({ status: 200, body: { days: [] } }));
  assert.equal(recovered.status, 200);
});

test('server also enforces the poll ceiling; a client cannot extend the lifecycle', async () => {
  const jobs = createPlannerLifecycle(); const work = deferred();
  const first = await jobs.start(async context => { context.warming(); await work.promise; return { status: 200, body: {} }; });
  const token = first.body.planner_lifecycle.token;
  for (let i = 0; i < 20; i++) assert.equal(jobs.read(token).status, 202);
  assert.equal(jobs.read(token).body.error, 'supply_wait_expired');
  work.resolve();
});

test('completed retained results yield to new work instead of creating false busy', async () => {
  const jobs = createPlannerLifecycle();
  let oldestToken;
  for (let i = 0; i < 32; i++) {
    const first = await jobs.start(async context => {
      context.warming();
      return { status: 200, body: { days: [{ id: i }] } };
    });
    if (i === 0) oldestToken = first.body.planner_lifecycle.token;
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(jobs.read(first.body.planner_lifecycle.token).status, 200);
  }
  const next = await jobs.start(async () => ({ status: 200, body: { days: [] } }));
  assert.equal(next.status, 200);
  assert.equal(jobs.read(oldestToken).status, 410);
});

test('healthy empty acquisition caches absence; failed acquisition never poisons the cache', async () => {
  let calls = 0;
  const cache = createSourceCache();
  const source = createBackgroundSource({ cache, keyFor: () => 'one', load: async () => { calls++; if (calls === 1) throw new Error('offline'); return []; } });
  assert.equal((await source.load({})[SOURCE_COMPLETION]).source_error, 'fetch_error');
  assert.deepEqual(await source.load({})[SOURCE_COMPLETION], []);
  assert.deepEqual(source.load({}), []);
  assert.equal(calls, 2);
});

test('warm supply preserves cached independent families without any live load', async () => {
  const records = Array.from({ length: 15 }, (_, i) => ({ id: `directory-${i}`, type: i % 2 ? 'cafe' : 'restaurant', lat: 1, lng: 2 }));
  const primary = () => assert.fail('live OSM');
  primary.readCached = () => [{ id: 'osm-cultural', type: 'museum', lat: 1, lng: 2 }];
  const directory = { eager: true, load: () => assert.fail('live directory'), readCached: () => records };
  const official = { eager: true, primaryRescue: false, load: () => assert.fail('live NAPI'), readCached: () => [{ id: 'official-1', type: 'restaurant', lat: 1, lng: 2 }] };
  const result = await composeOpenDataLoaders(primary, null, directory, official)({ lat: 1, lng: 2, preferCachedSupply: true });
  assert.equal(result.length, 17);
  assert.ok(result.some(row => row.id === 'osm-cultural'));
  assert.ok(result.some(row => row.id === 'official-1'));
});

test('the cached fast path acquires instead of answering when cached evidence misses a requested intent', async () => {
  // A cached Overpass answer for this exact request plus varied rows, but no
  // second-hand place: answering from cache would never ask the cold directory.
  const cached = Array.from({ length: 13 }, (_, i) => ({ id: `osm-${i}`, type: ['museum', 'park', 'restaurant'][i % 3], lat: 1, lng: 2 + i / 1000 }));
  let primaryReads = 0;
  const primary = () => { primaryReads++; return cached; };
  primary.readCached = () => cached;
  let directoryLoads = 0;
  const directory = { eager: true, load: () => { directoryLoads++; return []; }, readCached: () => [] };
  const result = await composeOpenDataLoaders(primary, null, directory)({
    lat: 1, lng: 2, requestedIntents: ['second_hand'], preferCachedSupply: true,
  });
  assert.equal(directoryLoads, 1, 'the cold directory is asked for the missing intent');
  assert.equal(primaryReads, 1, 'the primary is re-read once (a cache hit for the real Overpass loader)');
  assert.equal(result.length, 13);
});

test('the cached fast path acquires when the cached reservoir cannot span the requested walk', async () => {
  const cached = Array.from({ length: 13 }, (_, i) => ({ id: `osm-${i}`, type: ['museum', 'park', 'restaurant'][i % 3], lat: 1, lng: 2 }));
  const primary = () => cached;
  primary.readCached = () => cached;
  let directoryLoads = 0;
  const directory = { eager: true, load: () => { directoryLoads++; return []; }, readCached: () => [] };
  await composeOpenDataLoaders(primary, null, directory)({
    lat: 1, lng: 2, preferCachedSupply: true,
    walkingTargetBand: { targetKm: 9, floorKm: 5.4, ceilingKm: 10.62 },
  });
  assert.equal(directoryLoads, 1, 'a single-point reservoir cannot answer a 9 km request from cache');
});

test('cached background rows alone never answer for a primary whose cache has no entry', async () => {
  // Warm Wikidata-like corroboration (three categories) beside a cold Overpass
  // cache: the read-only path must not return the background rows alone.
  const background = Array.from({ length: 16 }, (_, i) => ({ id: `wikidata-${i}`, type: ['museum', 'park', 'market'][i % 3], lat: 1, lng: 2 }));
  let overpassCalls = 0;
  const primary = createOpenDataLoader({
    fetcher: async () => { overpassCalls++; return { ok: true, json: async () => ({ elements: [] }) }; },
    cache: createSourceCache(),
  });
  const wikidata = { eager: false, load: () => background, readCached: () => background };
  const result = await composeOpenDataLoaders(primary, wikidata)({ lat: 1, lng: 2, preferCachedSupply: true });
  assert.ok(overpassCalls > 0, 'the map source was actually asked');
  assert.equal(result.length, 16, 'and the background rows still join the composition');
  assert.notEqual(result.loader_metadata?.primary_collection, 'cached_supply');
});

test('legacy rescue still observes an acquisition completed while the primary was running', async () => {
  const work = deferred(); const primary = deferred();
  const source = createBackgroundSource({ cache: createSourceCache(), keyFor: () => 'one', load: () => work.promise });
  const resultPromise = composeOpenDataLoaders(() => primary.promise, null, source)({ lat: 1, lng: 2 });
  work.resolve([{ id: 'arrived' }]);
  await new Promise(r => setImmediate(r));
  primary.resolve(Object.assign([], { loader_status: 'error_failed_closed', loader_error: 'fetch_error' }));
  const result = await resultPromise;
  assert.equal(result.loader_status, 'loaded:1');
  assert.equal(result[0].id, 'arrived');
});

// Control source completion time, not the clock of a provider-backed QA run.
const flushCompletion = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
async function pendingSupplyReplay({ primaryRows = [] } = {}) {
  const work = deferred();
  const cache = createSourceCache();
  let primaryCalls = 0, acquisitions = 0, providerAborted = false;
  const source = createBackgroundSource({ cache, keyFor: () => 'late-window', load: anchor => {
    acquisitions++;
    return new Promise((resolve, reject) => {
      anchor.signal.addEventListener('abort', () => {
        providerAborted = true;
        reject(new Error('provider_cancelled'));
      }, { once: true });
      work.promise.then(resolve, reject);
    });
  } });
  const primary = () => {
    primaryCalls++;
    return Object.assign([...primaryRows], {
      loader_status: primaryRows.length ? `loaded:${primaryRows.length}` : 'error_failed_closed',
      loader_error: primaryRows.length ? null : 'http_non_200',
    });
  };
  // Include the reviewed-source wrapper used in the deployed app.
  const loader = composeOpenDataLoaders(composeOpenDataLoaders(primary, null, source), { load: async () => [] });
  const jobs = createPlannerLifecycle();
  const first = await jobs.start(async context => {
    const load = lifecycleLoader(loader, context);
    const rows = await load({ lat: 1, lng: 2, requestedIntents: ['second_hand'] });
    return { status: 200, body: { ids: rows.map(row => row.id), collection: rows.loader_metadata } };
  });
  return { work, cache, jobs, token: first.body.planner_lifecycle.token,
    counts: () => ({ primaryCalls, acquisitions, providerAborted }) };
}

test('empty supply keeps its original acquisition past the composition reserve and consumes late cached rows', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 0 });
  const { work, cache, jobs, token, counts } = await pendingSupplyReplay();
  for (const advance of [8000, 8000, 8000, 8000, 8000, 5000]) {
    t.mock.timers.tick(advance); await flushCompletion();
  }
  assert.equal(jobs.read(token).status, 202, 'an empty 45s snapshot must not finalize the plan');
  t.mock.timers.tick(1000);
  work.resolve([1, 2, 3].map(i => ({ id: `late-${i}`, type: 'vintage-shop', lat: 1 + i / 1000, lng: 2, tags: ['second_hand'] })));
  await flushCompletion();
  assert.equal(cache.peek('late-window').length, 3, 'original acquisition has actually completed and cached supply');
  const final = jobs.read(token);
  assert.equal(final.status, 200);
  assert.deepEqual(final.body.ids, ['late-1', 'late-2', 'late-3']);
  assert.equal(final.body.collection.source_completion.status, 'complete');
  assert.equal(final.body.collection.source_completion.pending, 0);
  assert.deepEqual(counts(), { primaryCalls: 1, acquisitions: 1, providerAborted: false });
});

test('empty supply still stops at the original 60s deadline and cancels its pending producer', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 0 });
  const { work, cache, jobs, token, counts } = await pendingSupplyReplay();
  for (const advance of [8000, 8000, 8000, 8000, 8000, 5000]) {
    t.mock.timers.tick(advance); await flushCompletion();
  }
  assert.equal(jobs.read(token).status, 202);
  t.mock.timers.tick(15000); await flushCompletion();
  assert.equal(jobs.read(token).status, 503);
  assert.equal(jobs.read(token).body.error, 'supply_wait_expired');
  assert.deepEqual(counts(), { primaryCalls: 1, acquisitions: 1, providerAborted: true });
  work.resolve([{ id: 'too-late', type: 'vintage-shop', lat: 1, lng: 2 }]);
  await flushCompletion();
  assert.equal(cache.peek('late-window'), null);
  assert.equal(jobs.read(token).body.error, 'supply_wait_expired', 'late rows cannot replace an expired plan');
});

test('nonempty partial supply retains the composition reserve even when a requested interest is missing', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 0 });
  const { work, jobs, token, counts } = await pendingSupplyReplay({ primaryRows: [
    { id: 'held-museum', type: 'museum', lat: 1, lng: 2 },
    { id: 'held-park', type: 'park', lat: 1.001, lng: 2 },
  ] });
  for (const advance of [8000, 8000, 8000, 8000, 8000, 5000]) {
    t.mock.timers.tick(advance); await flushCompletion();
  }
  const final = jobs.read(token);
  assert.equal(final.status, 200);
  assert.deepEqual(final.body.ids, ['held-museum', 'held-park']);
  assert.equal(final.body.collection.source_completion.reason, 'bounded_lifecycle_snapshot');
  assert.equal(final.body.collection.source_completion.pending, 1);
  work.resolve([]); await flushCompletion();
  assert.equal(jobs.read(token).body.collection.source_completion.pending, 1, 'published partial result stays immutable');
  assert.equal(counts().acquisitions, 1);
});
