"use strict";
const test = require('node:test');
const assert = require('node:assert/strict');
const { createBackgroundSource } = require('../server/place-candidates/background-source');
const { createSourceCache } = require('../server/place-candidates/source-cache');
const { composeOpenDataLoaders } = require('../server/place-candidates/open-data-loader');
const { createPlannerLifecycle, lifecycleLoader } = require('../server/planner/cold-lifecycle');

const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const flush = async () => { for (let i = 0; i < 100; i++) await Promise.resolve(); };
const anchor = { lat: 48.5, lng: 8.5 };
const varied = Array.from({ length: 15 }, (_, i) => ({
  id: `directory-${i}`, name: `Visit ${i}`, type: ['museum', 'restaurant', 'park'][i % 3],
  lat: anchor.lat + i * .0001, lng: anchor.lng,
  sources: [{ provider: 'directory', family: 'open_directory', tier: 'inferred' }],
}));

function setup({ rescue = true } = {}) {
  const primary = deferred(), directory = deferred();
  let primaryCalls = 0, acquisitions = 0;
  const source = createBackgroundSource({ cache: createSourceCache(), keyFor: () => 'owned-generation',
    load: () => { acquisitions++; return directory.promise; } });
  source.primaryRescue = rescue;
  const loader = composeOpenDataLoaders(() => { primaryCalls++; return primary.promise; }, null, source, null, { primaryWaitMs: 100 });
  return { primary, directory, loader, counts: () => ({ primaryCalls, acquisitions }) };
}

test('cold directory finishing before the primary bound is usable at that bound, not at primary timeout', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 0 });
  const r = setup(); let result;
  const loading = r.loader(anchor).then(value => { result = value; return value; });
  await flush();
  t.mock.timers.tick(20); r.directory.resolve(varied); await flush();
  t.mock.timers.tick(79); await flush();
  assert.equal(result, undefined, 'the existing primary opportunity is preserved');
  t.mock.timers.tick(1); await flush();
  assert.ok(result, 'a completed adequate cold directory must not remain hidden behind the primary');
  assert.deepEqual(result.map(row => row.id), varied.map(row => row.id));
  assert.equal(result.loader_metadata.primary_collection, 'background_refresh');
  assert.deepEqual(r.counts(), { primaryCalls: 1, acquisitions: 1 });
  r.primary.resolve([{ id: 'late-map' }]); await loading; await flush();
  assert.equal(result.some(row => row.id === 'late-map'), false, 'publication is frozen');
});

test('directory finishing after the primary bound is usable immediately, without restarting that bound', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 0 });
  const r = setup(); let result;
  const loading = r.loader(anchor).then(value => { result = value; return value; });
  await flush(); t.mock.timers.tick(150); await flush();
  assert.equal(result, undefined);
  r.directory.resolve(varied); await flush();
  assert.ok(result, 'the original primary wait has already elapsed');
  r.primary.resolve([]); await loading;
});

test('a primary answering inside the bound retains the ordinary merge and both source families', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 0 });
  const r = setup();
  const loading = r.loader(anchor);
  await flush(); r.directory.resolve(varied); await flush();
  t.mock.timers.tick(30); r.primary.resolve([{ id: 'map', type: 'museum' }]);
  const result = await loading;
  assert.equal(Date.now(), 30);
  assert.ok(result.some(row => row.id === 'map'));
  assert.equal(result.length, 16);
  assert.deepEqual(r.counts(), { primaryCalls: 1, acquisitions: 1 });
});

for (const condition of ['thin', 'failed', 'not_primary_rescue']) test(`cold ${condition} supply cannot pre-empt the primary`, async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 0 });
  const r = setup({ rescue: condition !== 'not_primary_rescue' }); let result;
  const loading = r.loader(anchor).then(value => { result = value; return value; });
  await flush();
  r.directory.resolve(condition === 'thin' ? varied.slice(0, 3) : condition === 'failed'
    ? Object.defineProperty([], 'source_error', { value: 'fetch_error' }) : varied);
  await flush(); t.mock.timers.tick(200); await flush();
  assert.equal(result, undefined);
  r.primary.resolve(Object.assign([], { loader_status: 'loaded:0' })); await loading;
  assert.deepEqual(r.counts(), { primaryCalls: 1, acquisitions: 1 });
  if (condition === 'failed') assert.equal(result.loader_error, 'fetch_error');
});

test('the real cold producer acknowledges pending before the primary settles and rejects late cancelled output', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 0 });
  const r = setup(); const jobs = createPlannerLifecycle(); let first;
  const starting = jobs.start(async context => {
    const rows = await lifecycleLoader(r.loader, context)({ ...anchor, requestedIntents: ['culture'] });
    return { status: 200, body: { ids: rows.map(row => row.id) } };
  }).then(value => { first = value; return value; });
  await flush();
  assert.equal(first?.status, 202, 'acknowledge the existing producer, not an empty completed day');
  const token = first.body.planner_lifecycle.token;
  assert.equal(jobs.read(token).status, 202);
  assert.deepEqual(r.counts(), { primaryCalls: 1, acquisitions: 1 });
  jobs.cancel(token); await flush();
  r.directory.resolve(varied); r.primary.resolve([]); await starting; await flush();
  assert.equal(jobs.read(token).status, 410, 'late completion cannot republish cancelled intent');
});

test('warm cached supply stays a direct response without a new producer', async () => {
  const cache = createSourceCache(); await cache.get('warm', () => varied);
  const source = createBackgroundSource({ cache, keyFor: () => 'warm', load: () => assert.fail('warm must not acquire') });
  const loader = composeOpenDataLoaders(() => [], null, source);
  const jobs = createPlannerLifecycle();
  const result = await jobs.start(async context => ({ status: 200, body: {
    ids: (await lifecycleLoader(loader, context)(anchor)).map(row => row.id),
  } }));
  assert.equal(result.status, 200);
  assert.equal(result.body.ids.length, 15);
});

test('a cold optional corroborator cannot turn a healthy primary response into polling', async () => {
  const work = deferred();
  const source = createBackgroundSource({ cache: createSourceCache(), keyFor: () => 'optional',
    eager: true, waitForCompletion: false, load: () => work.promise });
  const loader = composeOpenDataLoaders(() => varied, source);
  const jobs = createPlannerLifecycle();
  const result = await jobs.start(async context => ({ status: 200, body: {
    ids: (await lifecycleLoader(loader, context)(anchor)).map(row => row.id),
  } }));
  assert.equal(result.status, 200);
  work.resolve([]);
});

test('a same-boundary primary answer uses the ordinary merge including its regional anchor', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 0 });
  const r = setup();
  const loading = r.loader(anchor);
  await flush(); r.directory.resolve(varied); await flush();
  t.mock.timers.tick(100);
  r.primary.resolve(Object.assign([{ id: 'regional-map', type: 'museum' }], {
    loader_metadata: { regional_scout: { selected_anchor_coords: { lat: 48.6, lng: 8.6 } } },
  }));
  const result = await loading;
  assert.ok(result.some(row => row.id === 'regional-map'));
  assert.deepEqual(result.loader_metadata.regional_scout.selected_anchor_coords, { lat: 48.6, lng: 8.6 });
});

test('adequate rescue does not hide another captured source failure', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 0 });
  const primary = deferred();
  const failed = Object.defineProperty([], 'source_error', { value: 'fetch_error' });
  const loader = composeOpenDataLoaders(() => primary.promise,
    { eager: true, load: () => failed }, { eager: true, load: () => varied }, null, { primaryWaitMs: 100 });
  const loading = loader(anchor); await flush(); t.mock.timers.tick(100);
  const result = await loading;
  assert.equal(result.length, 15);
  assert.equal(result.loader_error, 'fetch_error', 'usable partial supply is not proof all sources succeeded');
  primary.resolve([]);
});
