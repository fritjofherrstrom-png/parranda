const test = require('node:test');
const assert = require('node:assert/strict');
const { buildApp } = require('../server/app');
const { externalRecord, makeLoader, requestJson } = require('./helpers/planner-reservoir-compare');

const DATE = '2026-10-01';
const base = { lat: 55.6, lng: 13.0 };

async function day({ hours = 'Th 08:00-17:00', date = DATE, clock = '2026-10-01T11:33:00Z',
  preferences = ['second_hand', 'fika'], trustedTimezone = true, extra = {} } = {}) {
  const cafe = externalRecord('cafe', 'Source cafe', 'cafe', base.lat, base.lng, ['coffee']);
  if (hours !== null) cafe.opening_hours = hours;
  const records = [cafe, ...[1, 2].map(i => ({
    ...externalRecord(`shop-${i}`, `Source shop ${i}`, 'second_hand', base.lat + i * .001, base.lng, ['second_hand']),
    opening_hours: 'Mo-Su 10:00-20:00',
  }))];
  const server = buildApp({
    openDataLoader: makeLoader(records),
    weatherProvider: async () => null,
    clock: () => new Date(clock),
    placeResolver: async () => [{ label: 'Fixture place', ...base, confidence: 'high', provenance: 'test_resolver',
      ...(trustedTimezone ? { timezone: 'Europe/Stockholm' } : {}) }],
  }).listen(0);
  try {
    const response = await requestJson(server, { path: '/api/route-recommendations?lang=sv', body: {
      place: 'Fixture place', dates: [date], preferences, day_rhythm: 'full', leg_pacing: 'balanced',
      distance_mode: 'no_limit', start: { type: 'auto' }, end: { type: 'auto' }, home_base: { type: 'auto' },
      experimental_agnostic_route_output: 1, include_external_candidates: 1, agnostic_engine_compose: 1,
      ...extra,
    } });
    assert.equal(response.status, 200);
    assert.ok(response.body.days[0]?.primary_route, JSON.stringify(response.body));
    return response.body.days[0].primary_route;
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

test('today at midday retains source-available requested fika with a current daypart and recomputed geometry', async () => {
  const route = await day();
  const cafe = route.main_stops.find(stop => stop.id === 'cafe');
  assert.ok(cafe, 'available selected fika must survive time anchoring');
  assert.equal(cafe.daypart, 'midday');
  assert.equal(route.anchored_to_local_time, true);
  assert.equal(route.current_local_time_band, 'midday');
  assert.ok(!route.daypart_arc.includes('morning'));
  assert.ok(!route.trimmed_dayparts.includes('morning'), 'retimed fika was not trimmed');
  assert.deepEqual(cafe.selected_day_hours.windows, [{ opens: '08:00', closes: '17:00' }]);
  assert.equal(route.legs.length, route.main_stops.length - 1);
  assert.deepEqual(route.map_route_points.map(point => point.label), route.main_stops.map(stop => stop.label));
  assert.ok(!route.caveats.includes('daypart_arc_precedes_local_time'));
});

test('availability later in the remaining day retains fika without claiming open now', async () => {
  const route = await day({ hours: 'Th 15:00-17:00' });
  const cafe = route.main_stops.find(stop => stop.id === 'cafe');
  assert.ok(cafe);
  assert.equal(cafe.daypart, 'midday');
  assert.deepEqual(cafe.selected_day_hours.windows, [{ opens: '15:00', closes: '17:00' }]);
  assert.equal(cafe.open_now, undefined);
});

for (const [label, hours] of [['already closed', 'Th 08:00-12:00'], ['closed day', 'Th off'],
  ['unknown', null], ['unsupported', 'Th by appointment']]) {
  test(`today does not retime ${label} fika using a typical morning role`, async () => {
    const route = await day({ hours, extra: { availability: { eligible: true, status: 'available_in_window' },
      sourceCandidates: [{ id: 'cafe', anchored_daypart: 'midday' }] } });
    assert.equal(route.main_stops.some(stop => stop.id === 'cafe'), false);
  });
}

test('future days retain their full role arc without current-time anchoring', async () => {
  const route = await day({ date: '2026-10-08' });
  assert.equal(route.main_stops.find(stop => stop.id === 'cafe')?.daypart, 'morning');
  assert.equal(route.anchored_to_local_time, false);
  assert.equal(route.current_local_time_band, null);
});

test('unknown timezone cannot retime a requested experience', async () => {
  const route = await day({ trustedTimezone: false });
  assert.equal(route.main_stops.find(stop => stop.id === 'cafe')?.daypart, 'morning');
  assert.equal(route.anchored_to_local_time, false);
});

test('availability never introduces an unselected primary interest', async () => {
  const route = await day({ preferences: ['second_hand'] });
  assert.equal(route.main_stops.some(stop => stop.id === 'cafe'), false);
});

test('at afternoon the same generic anchoring retains available shopping and fika', async () => {
  const route = await day({ clock: '2026-10-01T14:00:00Z' });
  assert.ok(route.main_stops.some(stop => stop.id === 'cafe'));
  assert.ok(route.main_stops.some(stop => stop.id.startsWith('shop-')));
  assert.ok(route.daypart_arc.every(part => part === 'afternoon'));
  assert.equal(route.anchored_to_local_time, true);
});
