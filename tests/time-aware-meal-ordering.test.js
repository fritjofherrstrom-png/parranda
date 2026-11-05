'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { compose, record, rows } = require('./helpers/day-composition-fixtures');
const DATE = '2026-10-27', preferences = ['food', 'second_hand', 'green'];
const supply = ({ unknown = false, lunch = true } = {}) => [
  ...(lunch ? [record('lunch', 'restaurant', 3, unknown ? {} : { opening_hours: 'Mo-Su 11:00-15:00' })] : []),
  record('dinner', 'restaurant', 8, unknown ? {} : { opening_hours: 'Mo-Su 18:00-23:00' }),
  ...rows('shop', 'vintage-shop', 4, 0), ...rows('park', 'park', 4, 6),
];
const day = (records = supply(), overrides = {}) => compose(records, preferences, {
  date: DATE, todayIsoDate: DATE, clock: () => new Date('2026-10-27T11:45:00Z'),
  preferencePriority: preferences, ...overrides,
});

test('trusted local midday Food-first Full puts the available lunch first and the distinct dinner last', async () => {
  const output = await day();
  assert.equal(output.experiment.context.time.now, DATE + 'T12:45:00');
  assert.equal(output.stops.length, 6);
  assert.equal(output.stops[0].id, 'lunch');
  assert.equal(output.stops.at(-1).id, 'dinner');
  assert.deepEqual(output.stops[0].selected_day_hours.windows, [{ opens: '11:00', closes: '15:00' }]);
  assert.deepEqual(output.stops.at(-1).selected_day_hours.windows, [{ opens: '18:00', closes: '23:00' }]);
  assert.equal(output.stops[0].daypart, 'midday');
  assert.equal(output.stops.at(-1).daypart, 'evening');
  assert.equal(output.experiment.walking_validation.valid, true);
  assert.equal(output.stops[0].open_now, undefined, 'ordering cannot mint open-now proof');
});

test('trusted evening Food-first starts with dinner without resurrecting the already closed lunch', async () => {
  const output = await day(supply(), { clock: () => new Date('2026-10-27T18:15:00Z') });
  assert.equal(output.stops[0].id, 'dinner');
  assert.ok(!output.stops.some(stop => stop.id === 'lunch'));
  assert.equal(output.stops.filter(stop => stop.covered_preferences.includes('food')).length, 1);
});

test('a dinner-only source window cannot become a lunch-first stop', async () => {
  const output = await day(supply({ lunch: false }));
  assert.notEqual(output.stops[0].id, 'dinner');
  assert.equal(output.stops.at(-1).id, 'dinner');
});

test('unknown hours permit meal proposals without manufacturing current availability or known hours', async () => {
  const output = await day(supply({ unknown: true }));
  assert.equal(output.stops[0].type, 'restaurant');
  assert.equal(output.stops.at(-1).type, 'restaurant');
  assert.notEqual(output.stops[0].id, output.stops.at(-1).id);
  for (const stop of output.stops.filter(stop => stop.type === 'restaurant')) {
    assert.equal(stop.selected_day_hours?.status === 'known', false);
    assert.equal(stop.open_now, undefined);
  }
  assert.equal(output.route.anchored_to_local_time, false);
});

test('a future day does not inherit the current hour as lunch urgency', async () => {
  const a = await day(supply(), { date: '2026-10-28' });
  const b = await day(supply(), { date: '2026-10-28', clock: () => new Date('2026-10-27T18:15:00Z') });
  assert.equal(a.experiment.context.time.requested_date_is_today, false);
  assert.deepEqual(a.stops.map(s => s.id), b.stops.map(s => s.id));
});

test('unknown timezone and unranked Food retain the established ordering', async () => {
  const unranked = await day(supply(), { preferencePriority: [] });
  const unknown = await day(supply(), { trustedTimezone: null });
  assert.equal(unknown.experiment.context.time.timezone_known, false);
  assert.notEqual(unknown.stops[0].id, 'lunch');
  assert.notEqual(unranked.stops[0].id, 'lunch');
});

test('a known lunch-only meal is never labelled as an evening meal', async () => {
  const records = supply().map(row => row.id === 'dinner' ? { ...row, opening_hours: 'Mo-Su 11:00-15:00' } : row);
  const output = await day(records);
  assert.ok(output.stops.filter(s => s.type === 'restaurant').every(s => s.daypart !== 'evening'));
});

test('time-aware ordering preserves an explicit pin without admitting a closed meal', async () => {
  const records = [...supply(), record('closed-food', 'restaurant', 1, { opening_hours: 'Mo-Su off' })];
  const output = await day(records, { pinnedStopIds: ['shop-0'] });
  assert.ok(output.stops.some(s => s.id === 'shop-0'));
  assert.ok(!output.stops.some(s => s.id === 'closed-food'));
  assert.equal(output.stops[0].id, 'lunch');
  assert.equal(output.stops.at(-1).id, 'dinner');
});

test('an explicit retained manual order is not replaced by the meal heuristic', async () => {
  const original = await day(supply(), { preferencePriority: [] });
  const ids = original.stops.map(s => s.id), retained = ids.slice(1);
  const output = await day(supply(), { dayEdit: { version: 1, action: 'remove', candidate_id: ids[0],
    retained_candidate_ids: retained, target_stop_count: retained.length, slot_index: 0,
    replacement_preference: null, removed_candidate_ids: [ids[0]] } });
  assert.equal(output.experiment.day_edit.status, 'applied');
  assert.deepEqual(output.stops.map(s => s.id), retained);
});

test('scarce Food-only supply is not duplicated or filled with other interests', async () => {
  const output = await day(supply().slice(0, 2), { preferences: ['food'], preferencePriority: ['food'] });
  assert.equal(output.stops.length, 2);
  assert.deepEqual(new Set(output.stops.map(s => s.id)), new Set(['lunch', 'dinner']));
  assert.ok(output.stops.every(s => s.covered_preferences.includes('food')));
});

test('meal ordering cannot buy a new walk beyond the existing geometry tolerance', () => {
  const { orderBalancedDay } = require('../server/planner/day-composition-policy');
  const stops = [
    { id: 'near', coveredPreferences: ['green'] },
    { id: 'lunch', coveredPreferences: ['food'] },
    { id: 'shop', coveredPreferences: ['second_hand'] },
  ];
  const km = candidate => candidate[0].id === 'lunch' ? 5 : 1;
  const result = orderBalancedDay({ stops, geometry: { estimatedKm: 1 }, geometryFor: candidate => ({ estimatedKm: km(candidate) }),
    chainKm: () => 1, preferences, preferencePriority: preferences,
    mealContext: { date: DATE, nowLocalIso: DATE + 'T12:45:00', fullDay: true } });
  assert.equal(result.stops[0].id, 'near');
  assert.equal(result.geometry.estimatedKm, 1);
});

test('partial Food fit and a coffee-only cafe do not acquire a meal slot', () => {
  const { createMealOrderPolicy } = require('../server/planner/meal-ordering');
  const cafe = { id: 'coffee', type: 'cafe', coveredPreferences: ['coffee'], partialPreferences: ['food'] };
  assert.equal(createMealOrderPolicy([cafe], { date: DATE, nowLocalIso: DATE + 'T12:45:00', fullDay: true }), null);
});

for (const majority of ['lunch', 'dinner']) test(`bounded meal selection retains the complementary meal among several ${majority}-only places`, async () => {
  const hours = { lunch: 'Mo-Su 11:00-15:00', dinner: 'Mo-Su 18:00-23:00' };
  const complement = majority === 'lunch' ? 'dinner' : 'lunch';
  const records = [...Array.from({ length: 3 }, (_, i) => record(`${majority}-${i}`, 'restaurant', 3, { opening_hours: hours[majority] })),
    record(`z-${complement}`, 'restaurant', 3, { opening_hours: hours[complement] }),
    ...rows('shop', 'vintage-shop', 4), ...rows('park', 'park', 4, 6)];
  const control = await day(records, { pinnedStopIds: [`z-${complement}`] });
  const output = await day(records);
  assert.equal(output.stops.length, 6);
  assert.ok(output.stops.some(s => s.id === `z-${complement}`));
  assert.ok(output.stops[0].id.includes('lunch'));
  assert.ok(output.stops.at(-1).id.includes('dinner'));
  assert.equal(output.experiment.walking_validation.valid, true);
  assert.ok(output.route.estimated_km <= control.route.estimated_km + .1);
});

test('releasing an intentionally empty extent cannot turn missing supply into an intentional empty success', async () => {
  const output = await day([], { dayEdit: { version: 1, action: 'remove', candidate_id: 'old',
    retained_candidate_ids: [], target_stop_count: 0, slot_index: 0, replacement_preference: null,
    removed_candidate_ids: ['old'], preserve_retained: false, release_extent: true } });
  assert.notEqual(output.experiment.promotion?.promote, true);
  assert.equal(output.stops.length, 0);
  assert.notEqual(output.experiment.manual_edit_published, true);
});

test('Food as the sole explicit interest also retains the feasible complementary dinner', async () => {
  const records = [...Array.from({ length: 6 }, (_, i) => record(`lunch-${i}`, 'restaurant', 3, { opening_hours: 'Mo-Su 11:00-15:00' })),
    record('z-dinner', 'restaurant', 3, { opening_hours: 'Mo-Su 18:00-23:00' })];
  const output = await day(records, { preferences: ['food'], preferencePriority: ['food'] });
  assert.equal(output.stops.length, 6);
  assert.equal(output.stops.at(-1).id, 'z-dinner');
  assert.ok(output.stops.every(s => s.covered_preferences.includes('food')));
});
