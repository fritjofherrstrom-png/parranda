const test = require('node:test');
const assert = require('node:assert/strict');
const { buildApp } = require('../server/app');
const { createSourceCache } = require('../server/place-candidates/source-cache');
const { createBackgroundSource } = require('../server/place-candidates/background-source');
const { composeOpenDataLoaders } = require('../server/place-candidates/open-data-loader');
const { externalRecord, mockStableWeatherFetch } = require('./helpers/planner-reservoir-compare');
const liveFetch = global.fetch;
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const input = {
  place: 'Test municipality', dates: ['2026-10-10'], preferences: ['food', 'views'], walking_km_target: 4,
  experimental_agnostic_route_output: true, agnostic_engine_compose: true, include_external_candidates: true,
};
const anchor = { lat: 48.5, lng: 8.5 };
const rows = ['restaurant', 'cafe', 'viewpoint'].flatMap((type, group) => Array.from({ length: 10 }, (_, i) =>
  externalRecord(`${type}-${i}`, `Local ${type} ${i}`, type, anchor.lat + (group + 1) * .001 + i * .0001, anchor.lng + i * .0001,
    [type === 'restaurant' ? 'mat' : type === 'cafe' ? 'fika' : 'utsikt'])));

async function setup(t) {
  global.fetch = mockStableWeatherFetch();
  const work = deferred(); let acquisitions = 0; let primary = 0; let resolves = 0;
  const source = createBackgroundSource({ cache: createSourceCache(), keyFor: () => 'fixed-window', load: () => { acquisitions++; return work.promise; } });
  const loader = composeOpenDataLoaders(async () => { primary++; return Object.assign([], { loader_status: 'error_failed_closed', loader_error: 'fetch_error' }); }, null, source);
  const server = buildApp({
    openDataLoader: loader, eventSupply: null, reviewedPlaceSource: null,
    placeResolver: async () => { resolves++; return [{ ...anchor, label: 'Test municipality', confidence: 'high', provenance: { provider: 'fixture' } }]; },
  }).listen(0);
  t.after(() => { server.close(); server.closeAllConnections(); global.fetch = liveFetch; work.resolve([]); });
  async function request(body, { path = '/api/route-recommendations?lang=sv', legacy = false, method = 'POST' } = {}) {
    const res = await liveFetch(`http://127.0.0.1:${server.address().port}${path}`, {
      method, headers: { 'Content-Type': 'application/json', ...(legacy ? {} : { Prefer: 'respond-async' }) }, body: JSON.stringify(body),
    });
    return { status: res.status, body: res.status === 204 ? null : await res.json() };
  }
  return { work, request, counts: () => ({ acquisitions, primary, resolves }) };
}

test('legacy cold loss versus one-submission pending→trusted route; no re-resolve or provider replay', async t => {
  const { request, work, counts } = await setup(t);
  const old = await request(input, { legacy: true });
  assert.equal(old.status, 200);
  assert.equal(old.body.agnostic_route_output_experiment.source_status.status, 'error_failed_closed');
  assert.ok(!old.body.days?.some(day => day.primary_route));
  const start = await request(input);
  assert.equal(start.status, 202);
  const token = start.body.planner_lifecycle.token;
  const before = counts();
  const pending = await request({ token, lat: 0, lng: 0, trusted_supply: rows }, { path: '/api/planner-status' });
  assert.equal(pending.status, 202);
  assert.deepEqual(counts(), before);
  work.resolve(rows);
  let final;
  for (let i = 0; i < 15; i++) {
    final = await request({ token }, { path: '/api/planner-status' });
    if (final.status !== 202) break;
    await new Promise(r => setTimeout(r, 10));
  }
  assert.equal(final.status, 200, JSON.stringify(final.body));
  assert.ok(final.body.days?.[0]?.primary_route, JSON.stringify(final.body.agnostic_route_output_experiment));
  assert.equal(final.body.days[0].date, input.dates[0]);
  assert.deepEqual(counts(), before, 'both composer and structure reuse the same source snapshot');
  assert.equal(counts().acquisitions, 1);
  assert.ok(!JSON.stringify(final.body).includes('trustedSourceCompletion'));
  const warmBefore = counts();
  const warm = await request({ ...input, ...anchor, place: undefined });
  assert.equal(warm.status, 200);
  assert.ok(warm.body.days[0].primary_route);
  assert.deepEqual(counts(), warmBefore, 'warm coordinate request performs no source or resolver network work');
});

test('provider failure ends honestly and cannot become another live attempt through rescue', async t => {
  const { request, work, counts } = await setup(t);
  const start = await request(input);
  assert.equal(start.status, 202);
  const failed = []; Object.defineProperty(failed, 'source_error', { value: 'fetch_error' });
  work.resolve(failed);
  await new Promise(r => setTimeout(r, 20));
  const final = await request({ token: start.body.planner_lifecycle.token }, { path: '/api/planner-status' });
  assert.equal(final.status, 200);
  assert.equal(final.body.agnostic_route_output_experiment.source_status.status, 'error_failed_closed');
  assert.ok(!final.body.days?.some(day => day.primary_route));
  assert.deepEqual(counts(), { acquisitions: 1, primary: 1, resolves: 1 });
});

test('unresolved anchor is final; public pending/status fields cannot start trusted work', async t => {
  const { request, counts } = await setup(t);
  const result = await request({ ...input, place: undefined, warm_pending: true, planner_lifecycle: { state: 'warm_pending' } });
  assert.equal(result.status, 200);
  assert.equal(result.body.agnostic_route_output_experiment.source_status.status, 'no_anchor');
  assert.deepEqual(counts(), { acquisitions: 0, primary: 0, resolves: 0 });
});
