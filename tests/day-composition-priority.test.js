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

// Contract: priority steers a day's content, never its visit order, and raising
// an interest never costs it an exact stop on the same candidates under the
// same fact, hours and walking gates. There is no absolute per-interest quota.
const frozen = (prefix, rows) => rows.map(([type, lat, lng], index) => record(`${prefix}${index}`, type, 0, { lat, lng }));
// Frozen offline supplies where unranked Food/Culture/Views composed three
// culture stops and Culture first composed two (staging Barcelona did the same).
const CULTURE_DROP = [
  frozen('a', [['museum', 55.591468, 12.986744], ['gallery', 55.607227, 13.008997], ['viewpoint', 55.592759, 13.009342],
    ['gallery', 55.603596, 12.992732], ['museum', 55.609529, 12.987850], ['castle', 55.601585, 13.002495],
    ['theatre', 55.591096, 12.989684], ['gallery', 55.609959, 13.009402], ['museum', 55.591354, 13.009118],
    ['castle', 55.599765, 13.001776], ['museum', 55.607043, 12.998410], ['bar', 55.592630, 13.006986],
    ['restaurant', 55.595469, 12.989049], ['cafe', 55.594086, 13.006889], ['restaurant', 55.595930, 13.011076]]),
  frozen('b', [['museum', 55.599058, 13.014393], ['cafe', 55.601625, 13.014458], ['theatre', 55.602040, 13.004108],
    ['cinema', 55.593531, 12.994941], ['castle', 55.608177, 12.996310], ['cinema', 55.599008, 13.001996],
    ['viewpoint', 55.600152, 13.013104], ['museum', 55.600372, 13.000046], ['gallery', 55.594728, 12.993687],
    ['museum', 55.609545, 12.985699]]),
];
const INTENT = { food: 'food', culture: 'museums', views: 'scenic' };
const SELECTION = ['food', 'culture', 'views'];
const exactStops = (output, key) => output.stops.filter(stop => stop.covered_preferences.includes(INTENT[key])).length;

test('raising Culture first never composes fewer culture stops than the unranked day on the same supply', async () => {
  for (const supply of CULTURE_DROP) {
    const neutral = await compose(structuredClone(supply), SELECTION, { dayRhythm: 'balanced' });
    const cultureFirst = await compose(structuredClone(supply), SELECTION,
      { dayRhythm: 'balanced', preferencePriority: ['culture', 'food', 'views'] });
    assert.ok(exactStops(cultureFirst, 'culture') >= exactStops(neutral, 'culture'),
      `culture ${exactStops(neutral, 'culture')} -> ${exactStops(cultureFirst, 'culture')}: ${cultureFirst.stops.map(stop => stop.type)}`);
  }
});

test('every one-step promotion keeps or adds exact stops for the raised interest, with gates intact', async () => {
  const parks = () => {
    const supply = [...rows('meal', 'restaurant'), ...rows('mus', 'museum', 6, 6), ...rows('park', 'park', 6, 12)];
    supply.find(row => row.id === 'mus-0').opening_hours = 'Mo-Su off';
    return supply;
  };
  const permutations = values => values.length <= 1 ? [values]
    : values.flatMap((value, index) => permutations([...values.slice(0, index), ...values.slice(index + 1)]).map(rest => [value, ...rest]));
  for (const supply of [parks, () => CULTURE_DROP[0], () => CULTURE_DROP[1]]) {
    for (const dayRhythm of ['calm', 'balanced']) {
      const days = new Map();
      const day = async priority => {
        if (!days.has(priority.join())) days.set(priority.join(), await compose(structuredClone(supply()), SELECTION, { dayRhythm, preferencePriority: priority }));
        return days.get(priority.join());
      };
      const steps = SELECTION.map(key => [[], [key, ...SELECTION.filter(other => other !== key)], key]);
      for (const order of permutations(SELECTION)) {
        for (let index = 1; index < order.length; index += 1) {
          const raised = [...order];
          [raised[index - 1], raised[index]] = [raised[index], raised[index - 1]];
          steps.push([order, raised, order[index]]);
        }
      }
      for (const [before, after, key] of steps) {
        const from = await day(before);
        const to = await day(after);
        assert.ok(exactStops(to, key) >= exactStops(from, key),
          `${dayRhythm}: raising ${key} (${before} -> ${after}) lost a stop: ${from.stops.map(stop => stop.id)} -> ${to.stops.map(stop => stop.id)}`);
        for (const stop of to.stops) {
          assert.notEqual(stop.id, 'mus-0', 'priority never admits a venue closed on the day');
          if (stop.type === 'park') {
            assert.ok(!stop.covered_preferences.includes('scenic') && stop.partial_preferences.includes('scenic'),
              'a park stays a partial view, never verified Views');
          }
        }
      }
    }
  }
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

test('an interest the place cannot serve exactly takes no rank and lends no weight', async () => {
  // Parks only: Views has no exact place here. Ranked Views, Culture, Food used
  // to give Culture the second-place weight against Food's third and compose an
  // extra museum, which then vanished when Culture moved up to first.
  const parks = () => [...rows('meal', 'restaurant'), ...rows('mus', 'museum', 6, 6), ...rows('park', 'park', 6, 12)];
  const day = priority => compose(parks(), SELECTION, { dayRhythm: 'balanced', preferencePriority: priority });
  const neutral = await day([]);
  const viewsFirst = await day(['views', 'culture', 'food']);
  const cultureUp = await day(['culture', 'food', 'views']);
  assert.ok(exactStops(viewsFirst, 'culture') <= exactStops(neutral, 'culture'),
    `Views first lent its weight to Culture: ${viewsFirst.stops.map(stop => stop.type)}`);
  assert.ok(exactStops(cultureUp, 'culture') >= exactStops(viewsFirst, 'culture'),
    `moving Culture up lost a stop: ${viewsFirst.stops.map(stop => stop.type)} -> ${cultureUp.stops.map(stop => stop.type)}`);
  assert.ok(viewsFirst.stops.some(stop => stop.type === 'park' && stop.partial_preferences.includes('scenic')),
    'the park is still there as a partial view');
});
