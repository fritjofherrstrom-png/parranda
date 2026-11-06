'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildApp } = require('../server/app');
const { requestJson } = require('./helpers/planner-reservoir-compare');
const { record, rows, anchor } = require('./helpers/day-composition-fixtures');

async function fixture(t) {
  let loads = 0;
  const records = [...rows('museum', 'museum', 7),
    record('indian', 'restaurant', 8, { name: 'River Kitchen', search_facets: { cuisines: ['indian'] } }),
    record('name-only', 'restaurant', 9, { name: 'Indian Palace' }),
    record('closed', 'restaurant', 10, { name: 'Closed Kitchen', opening_hours: 'Mo-Su off', search_facets: { cuisines: ['indian'] } })];
  const server = buildApp({ openDataLoader: async () => { loads++; return structuredClone(records); },
    sourceCatalog: null, reviewedPlaceSource: null, placeResolver: null,
    eventSupply: async () => ({ coverage: 'covered', selected_date: '2026-10-22', tonight: [], this_week: [] }),
    clock: () => new Date('2026-10-16T08:00:00Z'),
    weatherProvider: async () => ({ condition: 'sun', timezone_resolution: { timezone: 'Europe/Stockholm', timezone_source: 'weather_provider_auto', utc_offset_seconds: 7200 } }),
  }).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  return { loads: () => loads, request: extra => requestJson(server, { path: '/api/route-recommendations?lang=en', body: {
    ...anchor, dates: ['2026-10-22'], preferences: ['culture'], day_rhythm: 'balanced',
    experimental_agnostic_route_output: 1, include_external_candidates: 1, agnostic_engine_compose: true, ...extra,
  } }) };
}
test('HTTP search uses admitted local supply and does not change the ordinary day', async t => {
  const f = await fixture(t);
  const baseline = await f.request({});
  const baselineLoads = f.loads();
  const result = await f.request({ day_place_search: { query: 'indiskt' } });
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.days, baseline.body.days);
  assert.equal(baseline.body.day_place_search, undefined);
  assert.deepEqual(result.body.day_place_search.items.map(x => x.id), ['indian']);
  assert.equal(result.body.day_place_search.items[0].hours_status, 'unknown');
  assert.equal(f.loads() - baselineLoads, baselineLoads, 'search keeps the existing acquisition budget');
});
test('HTTP search rejects malformed intent before acquisition and ignores public source facts', async t => {
  const f = await fixture(t);
  for (const value of [{ query: 'x'.repeat(81) }, { query: '' }, 'indiskt', { query: 'indiskt', candidates: [{ id: 'injected' }] }]) {
    const result = await f.request({ day_place_search: value });
    assert.equal(result.status, 400);
    assert.equal(result.body.error, 'invalid_day_place_search');
  }
  assert.equal(f.loads(), 0);
  const result = await f.request({ day_place_search: { query: 'invented' }, candidates: [{ id: 'invented', label: 'invented', search_facets: { cuisines: ['indian'] } }] });
  assert.deepEqual(result.body.day_place_search.items, []);
});
test('HTTP search honours dismissals and never turns an unresolved place into city fallback results', async t => {
  const f = await fixture(t);
  const excluded = await f.request({ day_place_search: { query: 'indiskt' }, excluded_candidate_ids: ['indian'] });
  assert.deepEqual(excluded.body.day_place_search.items, []);
  const unresolved = await f.request({ lat: undefined, lng: undefined, place_query: 'Unresolvable', day_place_search: { query: 'indiskt' } });
  assert.ok(!unresolved.body.day_place_search?.items?.length);
});
