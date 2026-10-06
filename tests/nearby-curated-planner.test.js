const test = require('node:test');
const assert = require('node:assert/strict');
const { buildApp } = require('../server/app');
const { requestJson } = require('./helpers/planner-reservoir-compare');
const input = {
  lat: 41.3786, lng: 2.1618, dates: ['2026-10-06'], preferences: ['food', 'coffee'],
  day_rhythm: 'balanced', experimental_agnostic_route_output: true,
  agnostic_engine_compose: true, include_external_candidates: true,
};
async function setup(t, loader = async () => Object.assign([], { loader_status: 'error_failed_closed', loader_error: 'fixture_outage' }), extra = {}) {
  const server = buildApp({ openDataLoader: loader, eventSupply: null, reviewedPlaceSource: null,
    placeResolver: null, weatherProvider: async () => null, ...extra }).listen(0);
  t.after(() => { server.close(); server.closeAllConnections(); });
  return async body => (await requestJson(server, { path: '/api/route-recommendations?lang=en', body })).body;
}
test('coordinate Planner can compose food and coffee from nearby curated supply during an external outage', async t => {
  const request = await setup(t);
  const body = await request(input);
  const stops = body.days?.[0]?.primary_route?.main_stops || [];
  assert.ok(stops.length >= 2, JSON.stringify(body.agnostic_route_output_experiment));
  const coverage = body.agnostic_route_output_experiment.constraint_negotiation.preference_coverage;
  assert.ok(coverage.covered_preferences.includes('food'));
  assert.ok(coverage.covered_preferences.includes('coffee'));
  assert.ok(stops.every(stop => stop.origin === 'curated_catalog'));
  assert.equal(body.agnostic_route_output_experiment.source_status.error, 'fixture_outage');
});
test('coordinates outside every catalog cannot obtain curated supply through public city/context fields', async t => {
  const request = await setup(t);
  const body = await request({ ...input, lat: 48.5, lng: 8.5, place: 'Barcelona',
    curated_candidates: [{ id: 'injected', lat: 48.5, lng: 8.5, type: 'restaurant' }],
    place_context: { city: 'barcelona' } });
  assert.ok(!body.days?.some(day => day.primary_route));
  assert.equal(body.agnostic_route_output_experiment.source_status.status, 'error_failed_closed');
});

test('the same coordinate path uses another registered catalog and respects dismissals', async t => {
  const request = await setup(t);
  const body = await request({ ...input, lat: 41.889, lng: 12.47 });
  const stops = body.days?.[0]?.primary_route?.main_stops || [];
  assert.ok(stops.length >= 2);
  assert.ok(stops.every(stop => stop.origin === 'curated_catalog' && stop.trust.human_verified && !stop.provisional));
  const excluded = stops.map(stop => stop.id);
  const next = await request({ ...input, lat: 41.889, lng: 12.47, excluded_candidate_ids: excluded });
  assert.ok((next.days?.[0]?.primary_route?.main_stops || []).every(stop => !excluded.includes(stop.id)));
});

test('nearby catalog selection is geographic, omits structural/closed places and preserves original provenance', () => {
  const { nearbyCuratedSupply } = require('../server/planner/nearby-curated-supply');
  const config = { key: 'unrelated-fixture', label: 'Fixture catalog', visibility: 'beta',
    routing: { areaDefinitions: {} }, catalog: { allItems: [
      { id: 'local', name: 'Local cafe', kind: 'cafe', lat: 48.5, lng: 8.5 },
      { id: 'closed', name: 'Closed cafe', kind: 'cafe', lat: 48.501, lng: 8.5, closedWeekdays: [2] },
      { id: 'distant', name: 'Distant cafe', kind: 'cafe', lat: 49, lng: 8.5 },
      { id: 'structural', name: 'Area', kind: 'district', lat: 48.5, lng: 8.5 },
    ] } };
  const rows = nearbyCuratedSupply({ configs: { arbitrary: config }, anchor: { lat: 48.5, lng: 8.5 }, date: '2026-10-06' });
  assert.deepEqual(rows.map(row => row.id), ['local']);
  assert.equal(rows[0].city, config.key);
  assert.equal(rows[0].source.id, 'unrelated-fixture-catalog');
  assert.equal(rows[0].city_pack_owned, true);
});

test('modern any-place preferences remain focused after adding curated supply', async t => {
  const request = await setup(t);
  const body = await request({ ...input, preferences: ['coffee'] });
  const stops = body.days?.[0]?.primary_route?.main_stops || [];
  assert.ok(stops.length >= 2);
  assert.ok(stops.every(stop => [...stop.covered_preferences, ...stop.partial_preferences].includes('coffee')));
  assert.ok(stops.every(stop => !stop.id.includes('route-anchor')));
});

test('legacy any-place kilometer requests keep their prior source-only behavior', async t => {
  const request = await setup(t);
  const { day_rhythm, ...legacy } = input;
  const body = await request({ ...legacy, city: "unknown-fixture", walking_km_target: 4 });
  assert.ok(!body.days?.some(day => day.primary_route));
  assert.ok(body.agnostic_route_output_experiment.eligibility.blockers.includes('loader_error'));
});


test('explicit coffee survives afternoon heuristics without inventing opening hours or anchoring', async t => {
  const request = await setup(t, undefined, {
    weatherProvider: async () => ({ condition: 'sun', maxTemp: 20,
      timezone_resolution: { timezone: 'Europe/Madrid', timezone_source: 'weather_provider_auto', utc_offset_seconds: 7200 } }),
    clock: () => new Date('2026-10-06T11:30:00Z'),
  });
  const body = await request(input);
  const route = body.days?.[0]?.primary_route;
  assert.ok(route);
  assert.ok(body.agnostic_route_output_experiment.constraint_negotiation.preference_coverage.covered_preferences.includes('coffee'));
  assert.equal(route.anchored_to_local_time, false);
  assert.ok(route.main_stops.filter(stop => stop.covered_preferences.includes('coffee')).every(stop => !stop.selected_day_hours));
});
