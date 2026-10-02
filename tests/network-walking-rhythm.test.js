const test = require('node:test');
const assert = require('node:assert/strict');
const { composeAgnosticRouteOutput } = require('../server/planner/agnostic-route-output');

const origin = { lat: 46, lng: 8 };
const records = Array.from({ length: 6 }, (_, i) => ({
  id: `source-cafe-${i}`, name: `Source cafe ${i}`, type: 'cafe',
  lat: origin.lat + .001 * (i + 1), lng: origin.lng + .001,
  tags: ['coffee'], chain: false,
  sources: [{ provider: 'map', family: 'map', tier: 'inferred',
    url: `https://example.test/cafe/${i}` }],
}));

function compose(rhythm, extra = {}) {
  return composeAgnosticRouteOutput({
    coords: origin, baselineResult: { days: [] }, externalRequested: true,
    openDataLoader: async () => records, preferences: ['fika'],
    date: '2026-10-08', todayIsoDate: () => '2026-10-02',
    weatherProvider: async () => null, walkingKmTarget: null,
    dayRhythm: rhythm, distanceMode: 'no_limit', anchorMode: 'coordinates',
    synthesizeVia: 'engine', ...extra,
  });
}

function provider(cost, calls) {
  return { configured: true, session: () => ({ async route(points) {
    calls.push(structuredClone(points));
    const km = cost(points);
    if (typeof km !== 'number') return km;
    return { status: 'ok', source: 'valhalla_pedestrian', estimatedKm: km,
      legs: points.slice(1).map(() => ({ distance_km: km / (points.length - 1),
        estimated_walk_minutes: km * 12 / (points.length - 1) })),
      pathPoints: points.map(p => ({ lat: p.lat, lng: p.lng })), snapDistances: points.map(() => 0) };
  } }) };
}

for (const rhythm of ['calm', 'balanced', 'full', 'free']) {
  test(`${rhythm}: network detour swaps one comparable fika without a kilometre goal or density change`, async () => {
    const control = (await compose(rhythm)).result.days[0].primary_route;
    const detourStop = control.main_stops[0];
    const calls = [];
    const result = await compose(rhythm, { networkWalkingProvider: provider(points =>
      points.some(p => p.lat === detourStop.lat && p.lng === detourStop.lng) ? 12 : 4.5, calls) });
    const route = result.result.days[0]?.primary_route;
    assert.ok(route, 'a viable comparable network day must be published');
    assert.equal(route.routing_source, 'valhalla_pedestrian');
    assert.equal(route.estimated_km, 4.5);
    assert.equal(route.day_profile, control.day_profile);
    assert.equal(route.main_stops.length, control.main_stops.length);
    const ids = route.main_stops.map(s => s.id);
    assert.equal(ids.includes(detourStop.id), false);
    assert.ok(control.main_stops.slice(1).every(s => ids.includes(s.id)));
    assert.equal(ids.filter(id => !control.main_stops.some(s => s.id === id)).length, 1);
    assert.ok(route.main_stops.every(s => s.covered_preferences.includes('coffee')));
    assert.ok(calls.length > 1 && calls.length <= 4);
    assert.deepEqual(route.map_path_points, route.map_route_points.map(p => ({ lat: p.lat, lng: p.lng })));
    assert.equal(route.legs.reduce((sum, l) => sum + l.distance_km, 0), 4.5);
    assert.equal(result.experiment.constraint_negotiation.walking.status, 'not_requested');
    assert.equal(result.experiment.constraint_negotiation.walking.target_km, null);
  });
}

test('modern network outage cannot choose another identity or add provider retries', async () => {
  let calls = 0;
  const result = await compose('balanced', { networkWalkingProvider: {
    session: () => ({ route: async () => { calls++; return { status: 'unavailable', reason: 'provider_unavailable' }; } }),
  } });
  assert.equal(calls, 1);
  assert.equal(result.result.days.length, 0);
  assert.ok(result.experiment.eligibility.blockers.includes('network_walking_provider_unavailable'));
});

test('modern measured day survives a later operational comparison failure', async () => {
  const calls = [];
  const measured = provider(() => 12, calls).session();
  let attempts = 0;
  const result = await compose('full', { networkWalkingProvider: {
    session: () => ({ route: points => ++attempts === 1 ? measured.route(points)
      : { status: 'unavailable', reason: 'busy' } }),
  } });
  assert.equal(attempts, 2);
  assert.equal(result.result.days[0]?.primary_route.estimated_km, 12);
  assert.equal(result.experiment.eligibility.blockers.some(b => b.startsWith('network_walking_')), false);
});

test('modern pins remain selected and do not introduce a legacy target/reference query', async () => {
  const control = (await compose('full')).result.days[0].primary_route;
  const calls = [];
  const pinned = control.main_stops[0].id;
  const result = await compose('full', { pinnedStopIds: [pinned], networkWalkingProvider: provider(() => 12, calls) });
  assert.ok(result.result.days[0].primary_route.main_stops.some(s => s.id === pinned));
  assert.equal(calls.length, 1);
  assert.equal(result.experiment.constraint_negotiation.walking.target_km, null);
});

test('modern HTTP contract ignores kilometre goals and network alternatives preserve source-backed current-time fika', async () => {
  const { buildApp } = require('../server/app');
  const { requestJson } = require('./helpers/planner-reservoir-compare');
  const closed = { ...records[0], id: 'closed-cafe', lat: origin.lat + .0001,
    opening_hours: 'Fr off' };
  const available = [...records.map(record => ({ ...record, opening_hours: 'Mo-Su 08:00-20:00' })), closed];
  const calls = [];
  let detourStop;
  const server = buildApp({
    openDataLoader: async () => available,
    weatherProvider: async () => null,
    clock: () => new Date('2026-10-02T12:03:00Z'),
    placeResolver: async () => [{ ...origin, label: 'Source fixture', confidence: 'high',
      provenance: 'test_resolver', timezone: 'Europe/Stockholm' }],
    networkWalkingProvider: provider(points => detourStop &&
      points.some(p => p.lat === detourStop.lat && p.lng === detourStop.lng) ? 12 : 4.5, calls),
  }).listen(0);
  const body = {
    place: 'Source fixture', dates: ['2026-10-02'], preferences: ['fika'],
    day_rhythm: 'full', walking_km_target: 100, distance_mode: 'soft_target',
    experimental_agnostic_route_output: 1, include_external_candidates: 1, agnostic_engine_compose: 1,
  };
  try {
    const control = await requestJson(server, { path: '/api/route-recommendations?lang=sv', body });
    assert.equal(control.status, 200);
    const baseline = control.body.days[0].primary_route;
    detourStop = baseline.main_stops[0];
    calls.length = 0;
    const response = await requestJson(server, { path: '/api/route-recommendations?lang=sv', body });
    assert.equal(response.status, 200);
    const route = response.body.days[0].primary_route;
    assert.equal(route.estimated_km, 4.5);
    assert.equal(route.anchored_to_local_time, true);
    assert.equal(route.current_local_time_band, 'midday');
    assert.ok(route.main_stops.every(s => s.daypart === 'midday'));
    assert.ok(route.main_stops.every(s => s.selected_day_hours.windows.length > 0));
    assert.equal(route.day_profile, baseline.day_profile);
    assert.equal(route.main_stops.length, baseline.main_stops.length);
    assert.ok(!route.main_stops.some(s => s.id === detourStop.id));
    assert.ok(baseline.main_stops.slice(1).every(s => route.main_stops.some(next => next.id === s.id)));
    assert.equal(response.body.agnostic_route_output_experiment.constraint_negotiation.walking.target_km, null);
    assert.ok(calls.length > 1 && calls.length <= 4);
    assert.ok(calls.every(points => !points.some(p => p.lat === closed.lat && p.lng === closed.lng)),
      'a cheap closed place must not enter network comparison');
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
