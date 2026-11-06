const test = require('node:test');
const assert = require('node:assert/strict');
const { buildApp } = require('../server/app');
const { externalRecord, makeLoader, requestJson } = require('./helpers/planner-reservoir-compare');
const { buildRouteDaypartHonesty } = require('../server/planner/agnostic-route-output');
const { ROLE_LAST_DAYPART, daypartSlotForRole, knownLastDaypartForRole, timeBandRank } =
  require('../server/planner/agnostic-route-ordering');

// 5 Nov 2026: the note that a day is not anchored to now read each stop's
// place in the day's arc as the only time its experience fits. At 15:30 a day
// with museums (a "midday" role in the arc) said so, and at 20:30 so did a day
// of dinner and a view.
const DATE = '2026-10-01';
const base = { lat: 55.6, lng: 13.0 };
const AFTERNOON = '2026-10-01T13:30:00Z'; // 15:30 in Stockholm
const EVENING = '2026-10-01T18:30:00Z'; // 20:30 in Stockholm

const place = (id, type, tags, i) => externalRecord(id, `Source ${id}`, type, base.lat + i * 0.0012, base.lng + (i % 2) * 0.0008, tags);
const DAYTIME_DAY = [
  place('museum', 'museum', ['museum'], 0),
  place('gallery', 'gallery', ['gallery'], 1),
  place('restaurant', 'restaurant', ['restaurant'], 2),
  place('bistro', 'restaurant', ['restaurant'], 3),
  place('lookout', 'viewpoint', ['viewpoint'], 4),
  place('statue', 'monument', ['monument'], 5),
];
const EVENING_DAY = [
  place('restaurant', 'restaurant', ['restaurant'], 0),
  place('bistro', 'restaurant', ['restaurant'], 1),
  place('lookout', 'viewpoint', ['viewpoint'], 2),
  place('quay', 'viewpoint', ['viewpoint'], 3),
];

async function compose({ clock, preferences, records }) {
  const server = buildApp({
    openDataLoader: makeLoader(records),
    weatherProvider: async () => null,
    clock: () => new Date(clock),
    placeResolver: async () => [{ label: 'Fixture place', ...base, confidence: 'high', provenance: 'test_resolver',
      timezone: 'Europe/Stockholm' }],
  }).listen(0);
  try {
    const response = await requestJson(server, { path: '/api/route-recommendations?lang=sv', body: {
      place: 'Fixture place', dates: [DATE], preferences, day_rhythm: 'balanced', leg_pacing: 'balanced',
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

// The note may only become quieter where a role still fits: a window that
// ended before the role's arc slot would call a stop past that the arc did not.
test('no role is read as past earlier than its place in the arc', () => {
  for (const [role, last] of Object.entries(ROLE_LAST_DAYPART)) {
    assert.ok(timeBandRank(last) >= daypartSlotForRole(role), `${role} ends at ${last}, before its arc slot`);
  }
  assert.equal(knownLastDaypartForRole('unknown_role'), null, 'an unknown role has no daypart of its own');
});

test('the note reads each stop by the last daypart its role still fits', () => {
  const at = (band, stopRoles) => buildRouteDaypartHonesty({ daypartArc: [], currentTimeBand: band, stopRoles }).caveats;
  assert.deepEqual(at('afternoon', ['culture_stop', 'food_anchor', 'scenic_anchor']), [], 'a museum and a view in the afternoon');
  assert.deepEqual(at('evening', ['scenic_anchor', 'food_anchor', 'evening_bar_option']), [], 'an evening walk, dinner and a bar');
  assert.deepEqual(at('evening', ['culture_stop', 'food_anchor', 'scenic_anchor']), ['daypart_arc_precedes_local_time'],
    'a museum at 20:30 still says so');
  assert.deepEqual(at('afternoon', ['market_stop', 'food_anchor']), ['daypart_arc_precedes_local_time'],
    'a market after midday still says so');
});

test('an afternoon day keeps its museum and does not call it past', async () => {
  const route = await compose({ clock: AFTERNOON, preferences: ['food', 'culture', 'views'], records: DAYTIME_DAY });
  const roles = route.main_stops.map(stop => stop.role);
  assert.ok(roles.includes('culture_stop'), JSON.stringify(roles));
  assert.equal(route.current_local_time_band, 'afternoon');
  assert.ok(!route.caveats.includes('daypart_arc_precedes_local_time'), JSON.stringify({ roles, caveats: route.caveats }));
});

test('dinner and a view at 20:30 read as tonight, not as a day already past', async () => {
  const route = await compose({ clock: EVENING, preferences: ['food', 'views'], records: EVENING_DAY });
  const roles = route.main_stops.map(stop => stop.role);
  assert.ok(roles.includes('food_anchor') && roles.includes('scenic_anchor'), JSON.stringify(roles));
  assert.equal(route.current_local_time_band, 'evening');
  assert.ok(!route.caveats.includes('daypart_arc_precedes_local_time'), JSON.stringify({ roles, caveats: route.caveats }));
});

test('a museum requested at 20:30 with unknown hours still says the day is not anchored', async () => {
  const route = await compose({ clock: EVENING, preferences: ['culture'], records: DAYTIME_DAY });
  assert.equal(route.anchored_to_local_time, false);
  assert.ok(route.caveats.includes('daypart_arc_precedes_local_time'), JSON.stringify(route.caveats));
});
