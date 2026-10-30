const test = require('node:test');
const assert = require('node:assert/strict');
const { buildApp } = require('../server/app');
const { externalRecord, makeLoader, requestJson } = require('./helpers/planner-reservoir-compare');
const { buildRouteDaypartHonesty } = require('../server/planner/agnostic-route-output');

// Engine review, 25 Oct 2026: at 20:03 on a Sunday, "today" in Göteborg led
// with a museum and a gallery whose hours were unknown, and nothing told the
// reader the day was not anchored to the clock. A balanced day withholds its
// daypart labels, so the arc was empty and the existing caveat never fired.
const DATE = '2026-10-01';
const base = { lat: 55.6, lng: 13.0 };
const EVENING = '2026-10-01T18:30:00Z'; // 20:30 in Stockholm
const MORNING = '2026-10-01T07:30:00Z'; // 09:30 in Stockholm

const place = (id, type, tags, i) => externalRecord(id, `Source ${id}`, type, base.lat + i * 0.0012, base.lng + (i % 2) * 0.0008, tags);
// The reviewed day: food, culture and views, so the balanced order interleaves
// bands and the daypart labels are withheld.
const DAYTIME_DAY = [
  place('museum', 'museum', ['museum'], 0),
  place('gallery', 'gallery', ['gallery'], 1),
  place('restaurant', 'restaurant', ['restaurant'], 2),
  place('bistro', 'restaurant', ['restaurant'], 3),
  place('lookout', 'viewpoint', ['viewpoint'], 4),
  place('statue', 'monument', ['monument'], 5),
];
const DAYTIME_PREFERENCES = ['food', 'culture', 'views'];
const DINNER_AND_BARS = [
  place('restaurant', 'restaurant', ['restaurant'], 0),
  place('bar', 'bar', ['bar'], 1),
  place('pub', 'pub', ['pub'], 2),
  place('bistro', 'restaurant', ['restaurant'], 3),
];

async function compose({ clock, preferences, records, date = DATE }) {
  const server = buildApp({
    openDataLoader: makeLoader(records),
    weatherProvider: async () => null,
    clock: () => new Date(clock),
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

test('an evening day that keeps daytime stops says it is not anchored to now', async () => {
  const route = await compose({ clock: EVENING, preferences: DAYTIME_PREFERENCES, records: DAYTIME_DAY });
  assert.ok(route.main_stops.some(stop => stop.role === 'culture_stop'), JSON.stringify(route.main_stops.map(s => s.role)));
  // The labels stay withheld: an interleaved day must not print a backwards arc.
  assert.deepEqual(route.daypart_arc, []);
  assert.equal(route.current_local_time_band, 'evening');
  assert.equal(route.anchored_to_local_time, false);
  assert.ok(route.caveats.includes('daypart_arc_precedes_local_time'), JSON.stringify(route.caveats));
});

test('dinner and bars in the evening carry no such note; a meal may be dinner', async () => {
  const route = await compose({ clock: EVENING, preferences: ['food', 'nightlife'], records: DINNER_AND_BARS });
  assert.equal(route.current_local_time_band, 'evening');
  assert.ok(!route.caveats.includes('daypart_arc_precedes_local_time'), JSON.stringify({ roles: route.main_stops.map(s => s.role), caveats: route.caveats }));
});

test('the same daytime day in the morning carries no note', async () => {
  const route = await compose({ clock: MORNING, preferences: DAYTIME_PREFERENCES, records: DAYTIME_DAY });
  assert.equal(route.current_local_time_band, 'morning');
  assert.ok(!route.caveats.includes('daypart_arc_precedes_local_time'), JSON.stringify(route.caveats));
});

test('tomorrow, planned in the evening, carries no evening note and keeps its labels withheld', async () => {
  const route = await compose({ clock: EVENING, preferences: DAYTIME_PREFERENCES, records: DAYTIME_DAY, date: '2026-10-02' });
  assert.equal(route.current_local_time_band, null, 'a future day is not read against tonight');
  assert.ok(!route.caveats.includes('daypart_arc_precedes_local_time'), JSON.stringify(route.caveats));
});

// Unit: the note is the only change. Labels stay withheld, an anchored day
// never also "precedes", an arc that is printed is read as before, and a day
// without a current band gets nothing.
test('the evening note changes only the caveat', () => {
  const daytime = ['culture_stop', 'food_anchor', 'scenic_anchor'];
  const withheld = buildRouteDaypartHonesty({ daypartArc: [], currentTimeBand: 'evening', stopRoles: daytime });
  assert.deepEqual(withheld, { daypart_arc: [], current_local_time_band: 'evening', anchored_to_local_time: false,
    trimmed_dayparts: [], caveats: ['daypart_arc_precedes_local_time'] });
  const anchored = buildRouteDaypartHonesty({ daypartArc: [], currentTimeBand: 'evening', stopRoles: daytime,
    anchoredToLocalTime: true, trimmedDayparts: ['midday'] });
  assert.deepEqual(anchored.caveats, ['day_anchored_to_current_time'], 'an anchored day never also precedes');
  const printed = buildRouteDaypartHonesty({ daypartArc: ['evening'], currentTimeBand: 'evening', stopRoles: daytime });
  assert.deepEqual(printed.caveats, [], 'a printed arc is read as before; stop roles are not consulted');
  const future = buildRouteDaypartHonesty({ daypartArc: [], currentTimeBand: null, stopRoles: daytime });
  assert.deepEqual(future.caveats, []);
  const meal = buildRouteDaypartHonesty({ daypartArc: [], currentTimeBand: 'evening', stopRoles: ['food_anchor', 'evening_bar_option', 'unknown_role'] });
  assert.deepEqual(meal.caveats, [], 'a meal may be dinner; an unknown role has no daypart');
});
