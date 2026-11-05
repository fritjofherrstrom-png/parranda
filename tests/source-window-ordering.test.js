'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { orderBalancedDay } = require('../server/planner/day-composition-policy');
const { compose, record, rows } = require('./helpers/day-composition-fixtures');
const known = (...windows) => ({ status: 'known', all_day: false,
  windows: windows.map(([opens, closes]) => ({ opens, closes })) });
const stop = (id, hours) => ({ id, coveredPreferences: ['museums'], selectedDayHours: hours });
function order(stops, extra = {}) {
  return orderBalancedDay({ stops, geometry: { estimatedKm: 1 },
    geometryFor: () => ({ estimatedKm: 1 }), chainKm: () => 1,
    preferences: ['culture'], ...extra });
}

test('known disjoint source windows order visits chronologically even for one non-food preference', () => {
  const late = stop('late-museum', known(['18:00', '22:00']));
  const early = stop('early-museum', known(['10:00', '13:00']));
  const result = order([late, early]);
  assert.deepEqual(result.stops.map(s => s.id), ['early-museum', 'late-museum']);
  assert.equal(result.changed, true);
  assert.equal(result.stops[0], early, 'source objects and their facts are not annotated or upgraded');
});

for (const [name, hours] of [
  ['unknown', { status: 'unknown', all_day: false, windows: [] }],
  ['all-day', { status: 'known', all_day: true, windows: [] }],
  ['overlapping', known(['10:00', '20:00'])],
  ['split around the other visit', known(['09:00', '11:00'], ['18:00', '23:00'])],
  ['partly malformed', known(['09:00', '11:00'], ['bad', '23:00'])],
  ['unsupported cross-midnight', known(['22:00', '02:00'])],
]) test(`${name} hours do not invent a before/after constraint`, () => {
  const stops = [stop('a', hours), stop('b', known(['12:00', '14:00']))];
  assert.deepEqual(order(stops).stops.map(s => s.id), ['a', 'b']);
  assert.deepEqual(order([...stops].reverse()).stops.map(s => s.id), ['b', 'a'], 'neither orientation invents an ordering edge');
});

test('strict retained manual order takes precedence over source-window suggestions', () => {
  const stops = [stop('late', known(['18:00', '23:00'])), stop('early', known(['11:00', '15:00']))];
  const result = order(stops, { dayEdit: { action: 'remove', retained_candidate_ids: ['late', 'early'] } });
  assert.deepEqual(result.stops.map(s => s.id), ['late', 'early']);
});

test('source-window ordering cannot buy a walk beyond either existing geometry tolerance', () => {
  const stops = [stop('late', known(['18:00', '23:00'])), stop('early', known(['11:00', '15:00']))];
  for (const expensive of ['chain', 'geometry']) {
    const distance = candidate => candidate[0].id === 'early' ? 5 : 1;
    const result = order(stops, { chainKm: expensive === 'chain' ? distance : () => 1,
      geometryFor: candidate => ({ estimatedKm: expensive === 'geometry' ? distance(candidate) : 1 }) });
    assert.deepEqual(result.stops.map(s => s.id), ['late', 'early']);
    assert.equal(result.geometry.estimatedKm, 1);
  }
});

test('more than six stops retain the bounded ordering contract', () => {
  const stops = Array.from({ length: 7 }, (_, i) => stop(String(i), known([`${18-i}:00`, `${19-i}:00`])));
  for (const item of stops) Object.defineProperty(item, 'selectedDayHours', { get() { throw new Error('over-bound facts must not be inspected'); } });
  assert.deepEqual(order(stops).stops.map(s => s.id), stops.map(s => s.id));
});

const records = () => [record('lunch', 'restaurant', 3, { opening_hours: 'Mo-Su 11:00-15:00' }),
  record('dinner', 'restaurant', 8, { opening_hours: 'Mo-Su 18:00-23:00' }),
  ...rows('shop', 'vintage-shop', 4), ...rows('park', 'park', 4, 6)];
const preferences = ['food', 'second_hand', 'green'];
for (const [name, date, priority] of [
  ['unranked today', '2026-10-27', []],
  ['Food first on a future day', '2026-10-28', preferences],
]) test(`real composition keeps lunch before dinner: ${name}`, async () => {
  const output = await compose(records(), preferences, { date, todayIsoDate: '2026-10-27',
    clock: () => new Date('2026-10-27T11:45:00Z'), preferencePriority: priority });
  const ids = output.stops.map(s => s.id);
  assert.ok(ids.includes('lunch') && ids.includes('dinner'), 'both existing admitted meals are present');
  assert.ok(ids.indexOf('lunch') < ids.indexOf('dinner'), `source-owned lunch window must precede dinner: ${ids}`);
  assert.equal(output.experiment.walking_validation.valid, true);
  assert.ok(output.route.estimated_km <= 0.5, 'the correction stays in the existing compact walk');
  assert.ok(output.stops.every(s => s.open_now === undefined));
  if (date === '2026-10-28') {
    const laterClock = await compose(records(), preferences, { date, todayIsoDate: '2026-10-27',
      clock: () => new Date('2026-10-27T18:15:00Z'), preferencePriority: priority });
    assert.deepEqual(laterClock.stops.map(s => s.id), ids, 'future ordering never borrows the planning hour');
    assert.notEqual(output.route.anchored_to_local_time, true);
  }
});


test('already normalized four-window evidence cannot pretend an omitted later opening does not exist', () => {
  const { normalizeSelectedDayHoursFact } = require('../server/place-candidates/opening-hours');
  const complete = known(['06:00', '07:00'], ['08:00', '09:00'], ['10:00', '11:00'], ['12:00', '13:00'], ['20:00', '21:00']);
  const normalized = normalizeSelectedDayHoursFact(complete);
  assert.equal(normalized.windows.length, 4, 'the existing upstream contract can already have capped this fact');
  for (const hours of [complete, normalized]) {
    const stops = [stop('middle', known(['14:00', '15:00'])), stop('split', hours)];
    assert.deepEqual(order(stops).stops.map(s => s.id), ['middle', 'split']);
  }
});

test('real composition does not order from a four-window truncation of a later opening', async () => {
  const output = await compose([record('middle', 'museum', 1, { opening_hours: 'Mo-Su 14:00-15:00' }),
    record('split', 'museum', 8, { opening_hours: 'Mo-Su 06:00-07:00,08:00-09:00,10:00-11:00,12:00-13:00,20:00-21:00' })], ['culture']);
  assert.deepEqual(output.stops.map(s => s.id), ['middle', 'split']);
  assert.equal(output.experiment.walking_validation.valid, true);
});
