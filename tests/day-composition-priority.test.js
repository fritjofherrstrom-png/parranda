'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { compose, record, rows } = require('./helpers/day-composition-fixtures');
const { mapPlannerReservoirToSourceCandidates } = require('../server/planner/agnostic-engine-compose');

// Fail any accidental acquisition: every source and service is an offline fixture.
const originalFetch = global.fetch;
test.before(() => { global.fetch = async () => { throw new Error('unexpected network'); }; });
test.after(() => { global.fetch = originalFetch; });

test('rich Food + Second hand Full selects experiences instead of four restaurant fillers', async () => {
  const food = ['restaurant', 'pizza', 'street-food', 'trattoria', 'bistro', 'taverna']
    .map((type, index) => record(`meal-${index}`, type, index));
  const output = await compose([...food, ...rows('shop', 'vintage-shop')], ['food', 'second_hand']);
  assert.equal(output.stops.length, 6);
  const meals = output.stops.filter(stop => stop.covered_preferences.includes('food'));
  assert.ok(meals.length <= 2, `rich mixed day had ${meals.length} meal stops: ${output.stops.map(s => s.id)}`);
  assert.ok(output.stops.filter(stop => stop.type === 'vintage-shop').length >= 4);
});

test('rhythm reservoir leaves depth for every requested role, not just the first food role', () => {
  const specs = [['food_anchor', 'food', 'restaurant'], ['culture_stop', 'museums', 'museum'],
    ['scenic_anchor', 'scenic', 'viewpoint']];
  const roles = specs.map(([role, intent, type]) => ({ role, requested: true, slot: 'stop',
    candidates: Array.from({ length: 6 }, (_, index) => ({
      candidate_id: `${role}-${index}`, label: `${role}-${index}`, type,
      coordinates: { lat: 55.6 + index * 0.00015, lng: 13 },
      candidate_status: 'usable', planner_usable: true, confidence: 'medium', origin: 'external_open',
      covered_preferences: [intent], partial_preferences: [], availability: { eligible: true },
      provenance: { source_tier: 'inferred', human_verified: false, attribution: [{ provider_id: 'osm', url: 'https://www.openstreetmap.org/node/1' }] },
    })),
  }));
  const selected = roles.map(entry => ({ role: entry.role, ...entry.candidates[0] }));
  const result = mapPlannerReservoirToSourceCandidates({ selected,
    plannerRoles: { roles, requested_preferences: ['food', 'museums', 'scenic'] },
    dayRhythm: 'full', includeCapacityFrontier: false });
  assert.equal(result.length, 12);
  for (const entry of roles) assert.ok(result.filter(candidate => candidate.role === entry.role).length >= 3,
    `reservoir starved ${entry.role}: ${result.map(candidate => candidate.role)}`);
});

test('mixed-day order separates consecutive meals when the alternative is a geometry tie', async () => {
  const records = [...rows('pizza', 'pizza'), ...rows('shop', 'vintage-shop')];
  const output = await compose(records, ['food', 'second_hand']);
  assert.equal(output.stops.length, 6);
  assert.equal(output.stops.filter(stop => stop.type === 'pizza').length, 2);
  for (let index = 1; index < output.stops.length; index += 1) {
    assert.ok(!(output.stops[index - 1].type === 'pizza' && output.stops[index].type === 'pizza'),
      `adjacent meal stops: ${output.stops.map(stop => stop.id)}`);
  }
});

test('reversing explicit two-interest priorities reverses day weight, not visit order', async () => {
  const records = [...rows('culture', 'museum'), ...rows('view', 'viewpoint')];
  const cultureFirst = await compose(records, ['culture', 'views'], { preferencePriority: ['culture', 'views'] });
  const viewsFirst = await compose(records, ['culture', 'views'], { preferencePriority: ['views', 'culture'] });
  const count = (output, type) => output.stops.filter(stop => stop.type === type).length;
  assert.equal(cultureFirst.stops.length, 6);
  assert.equal(viewsFirst.stops.length, 6);
  assert.ok(count(cultureFirst, 'museum') > count(viewsFirst, 'museum'),
    `priority ignored: ${count(cultureFirst, 'museum')} vs ${count(viewsFirst, 'museum')} museums`);
  assert.ok(count(viewsFirst, 'viewpoint') > count(cultureFirst, 'viewpoint'));
});

test('a picked prefix ranks only the picks; unpicked interests keep equal weight', async () => {
  // Views exists only as parks here. Re-picking Views alone used to expand to
  // Views, Culture, Food by selection order and composed an extra museum.
  const supply = () => [...rows('meal', 'restaurant'), ...rows('mus', 'museum', 6, 6), ...rows('park', 'park', 6, 12)];
  const preferences = ['culture', 'food', 'views'];
  const count = (output, type) => output.stops.filter(stop => stop.type === type).length;
  const neutral = await compose(supply(), preferences, { dayRhythm: 'balanced' });
  const viewsPicked = await compose(supply(), preferences, { dayRhythm: 'balanced', preferencePriority: ['views'] });
  assert.ok(count(viewsPicked, 'museum') <= count(neutral, 'museum'),
    `Views alone spilled its weight to Culture: ${neutral.stops.map(stop => stop.type)} -> ${viewsPicked.stops.map(stop => stop.type)}`);
});
