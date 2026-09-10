const test = require('node:test');
const assert = require('node:assert/strict');
const { createPlannerLifecycle } = require('../server/planner/cold-lifecycle');
const { createBackgroundSource, SOURCE_COMPLETION } = require('../server/place-candidates/background-source');
const { createSourceCache } = require('../server/place-candidates/source-cache');
const { composeOpenDataLoaders } = require('../server/place-candidates/open-data-loader');
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
