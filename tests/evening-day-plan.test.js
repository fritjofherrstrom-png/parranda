const test = require('node:test');
const assert = require('node:assert/strict');
const { buildApp } = require('../server/app');
const { externalRecord, makeLoader, requestJson } = require('./helpers/planner-reservoir-compare');
const { buildRouteDaypartHonesty } = require('../server/planner/agnostic-route-output');

// Engine review, 25 Oct 2026: at 20:03 "today" in Göteborg kept a museum and a
// gallery whose hours were unknown, and the whole day read as "not anchored to
// now". An evening plan for today keeps what fits tonight (meals, views) and
// leaves requested daytime experiences for tomorrow, saying so.
const DATE = '2026-10-01'; // a Thursday
const base = { lat: 55.6, lng: 13.0 };
const EVENING = '2026-10-01T18:30:00Z'; // 20:30 in Stockholm

const place = (id, type, tags, i, extra = {}) => ({
  ...externalRecord(id, `Source ${id}`, type, base.lat + i * 0.0012, base.lng + (i % 2) * 0.0008, tags), ...extra });
const day = (restaurantExtra = {}) => [
  place('museum', 'museum', ['museum'], 0),
  place('gallery', 'gallery', ['gallery'], 1),
  place('restaurant', 'restaurant', ['restaurant'], 2, restaurantExtra),
  place('bistro', 'restaurant', ['restaurant'], 3),
  place('lookout', 'viewpoint', ['viewpoint'], 4),
  place('statue', 'monument', ['monument'], 5),
];

async function compose({ preferences, records = day(), date = DATE }) {
  const server = buildApp({
    openDataLoader: makeLoader(records),
    weatherProvider: async () => null,
    clock: () => new Date(EVENING),
    placeResolver: async () => [{ label: 'Fixture place', ...base, confidence: 'high', provenance: 'test_resolver',
      timezone: 'Europe/Stockholm' }],
  }).listen(0);
  try {
    const response = await requestJson(server, { path: '/api/route-recommendations?lang=sv', body: {
      place: 'Fixture place', dates: [date], preferences, day_rhythm: 'balanced', leg_pacing: 'balanced',
      distance_mode: 'no_limit', start: { type: 'auto' }, end: { type: 'auto' }, home_base: { type: 'auto' },
      experimental_agnostic_route_output: 1, include_external_candidates: 1, agnostic_engine_compose: 1,
    } });
    assert.equal(response.status, 200);
    const route = response.body.days[0]?.primary_route;
    assert.ok(route, JSON.stringify(response.body).slice(0, 2000));
    return route;
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}
const summary = route => JSON.stringify({ stops: route.main_stops.map(s => `${s.id}:${s.role}:${s.daypart}`),
  anchored: route.anchored_to_local_time, deferred: route.deferred_preferences, caveats: route.caveats });

test('at 20:30 a day for food, culture and views is planned for tonight and leaves culture for tomorrow', async () => {
  const route = await compose({ preferences: ['food', 'culture', 'views'] });
  const roles = route.main_stops.map(stop => stop.role);
  assert.ok(!roles.includes('culture_stop'), summary(route));
  assert.ok(roles.includes('food_anchor') && roles.includes('scenic_anchor'), summary(route));
  assert.ok(route.main_stops.every(stop => stop.daypart === 'evening'), summary(route));
  assert.equal(route.anchored_to_local_time, true);
  assert.deepEqual(route.deferred_preferences, ['museums']);
  assert.ok(route.caveats.includes('day_anchored_to_current_time'), summary(route));
  assert.ok(route.caveats.includes('daytime_picks_left_for_tomorrow'), summary(route));
  assert.ok(!route.caveats.includes('daypart_arc_precedes_local_time'), summary(route));
});

test('an evening that would serve nothing the reader asked for keeps the full day and its note', async () => {
  const route = await compose({ preferences: ['culture'] });
  assert.ok(route.main_stops.some(stop => stop.role === 'culture_stop'), summary(route));
  assert.equal(route.anchored_to_local_time, false);
  assert.equal(route.deferred_preferences, undefined);
  assert.ok(route.caveats.includes('daypart_arc_precedes_local_time'), summary(route));
  assert.ok(!route.caveats.includes('daytime_picks_left_for_tomorrow'), summary(route));
});

test('a restaurant whose own hours end before tonight is not planned for tonight', async () => {
  const route = await compose({ preferences: ['food', 'culture', 'views'], records: day({ opening_hours: 'Th 11:00-15:00' }) });
  const ids = route.main_stops.map(stop => stop.id);
  assert.ok(!ids.includes('restaurant'), summary(route));
  assert.ok(ids.includes('bistro'), summary(route));
  assert.equal(route.anchored_to_local_time, true);
});

test('tomorrow, planned in the evening, keeps its full day', async () => {
  const route = await compose({ preferences: ['food', 'culture', 'views'], date: '2026-10-02' });
  assert.ok(route.main_stops.some(stop => stop.role === 'culture_stop'), summary(route));
  assert.equal(route.deferred_preferences, undefined);
  assert.ok(!route.caveats.includes('daytime_picks_left_for_tomorrow'), summary(route));
});

test('only an anchored evening carries what it left for tomorrow', () => {
  const anchored = buildRouteDaypartHonesty({ daypartArc: [], currentTimeBand: 'evening', anchoredToLocalTime: true,
    trimmedDayparts: ['midday'], deferredPreferences: ['museums', 'museums'] });
  assert.deepEqual(anchored.deferred_preferences, ['museums']);
  assert.deepEqual(anchored.caveats, ['day_anchored_to_current_time', 'daytime_picks_left_for_tomorrow']);
  const unanchored = buildRouteDaypartHonesty({ daypartArc: [], currentTimeBand: 'evening', deferredPreferences: ['museums'] });
  assert.equal(unanchored.deferred_preferences, undefined);
  assert.ok(!unanchored.caveats.includes('daytime_picks_left_for_tomorrow'));
});
