'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const { record, compose } = require('./helpers/day-composition-fixtures');
const { isMeal, mealsSeparable, routeNeedsMealSpacing, acceptMealSpacing } = require('../server/planner/day-composition-policy');

// A second main meal needs its own place in the day. Places are laid out on a
// small grid around the fixture anchor; 0.001° of latitude is about 110 m.
const at = (id, type, dLat, dLng = 0) => ({ ...record(id, type), lat: 55.6 + dLat, lng: 13 + dLng });
const meals = stops => stops.filter(isMeal).map(stop => stop.id);
const adjacentMeals = stops => stops.slice(1).some((stop, index) => isMeal(stop) && isMeal(stops[index]));
const order = stops => stops.map(stop => stop.id).join(' → ');

// The culture is together near the start; the restaurants are a cluster of
// three about 1.1 km away, 120 m apart. Separating two of them means walking
// back across the day.
function clustered() {
  return [
    at('museum', 'museum', -0.003, 0.002), at('gallery-a', 'gallery', 0), at('gallery-b', 'gallery', 0.0016),
    at('gallery-c', 'gallery', 0.001, 0.004), at('garden', 'garden', 0.006, 0.003), at('park', 'park', 0.008, -0.002),
    at('cafe', 'cafe', 0.004), at('rest-a', 'restaurant', 0.01, 0.006), at('rest-b', 'restaurant', 0.0111, 0.006),
    at('rest-c', 'restaurant', 0.0105, 0.0075),
  ];
}
// A restaurant at each end of a line of culture: lunch and dinner can be apart.
function spread() {
  return [
    at('rest-a', 'restaurant', 0), at('gallery-a', 'gallery', 0.003), at('gallery-b', 'gallery', 0.006),
    at('garden', 'garden', 0.009), at('rest-b', 'restaurant', 0.012), at('museum', 'museum', 0.0045, 0.002),
    at('viewpoint', 'viewpoint', 0.0075, 0.002),
  ];
}

for (const preferences of [['culture', 'views', 'food'], ['food', 'culture']]) {
  test(`${preferences.join('+')}: a second meal that cannot have its own place gives way, the day keeps its size`, async () => {
    const day = await compose(clustered(), preferences);
    assert.equal(day.stops.length, 6, order(day.stops));
    assert.equal(meals(day.stops).length, 1, `one meal: ${order(day.stops)}`);
    assert.equal(adjacentMeals(day.stops), false);
    for (const preference of ['food', 'culture']) {
      assert.ok(day.stops.some(stop => stop.covered_preferences.includes(preference === 'culture' ? 'museums' : preference)),
        `${preference} stays covered: ${order(day.stops)}`);
    }
  });
}

test('meals that can be apart keep both, with another stop between them', async () => {
  for (const preferences of [['food', 'culture'], ['culture', 'views', 'food']]) {
    const day = await compose(spread(), preferences);
    assert.equal(meals(day.stops).length, 2, order(day.stops));
    assert.equal(adjacentMeals(day.stops), false, order(day.stops));
  }
});

test('a food-only day keeps its restaurants, side by side if that is where they are', async () => {
  const day = await compose(clustered(), ['food']);
  assert.ok(meals(day.stops).length >= 2, order(day.stops));
});

test('when every candidate day must hold two meals together, the day keeps its stops', async () => {
  // Exactly six places match Food + Culture: four galleries together and two
  // restaurants together 1.1 km away. A shorter day is not the answer.
  const records = [at('gallery-a', 'gallery', 0), at('gallery-b', 'gallery', 0.0016), at('gallery-c', 'gallery', 0.001, 0.004),
    at('gallery-d', 'gallery', 0.002, 0.002), at('rest-a', 'restaurant', 0.01, 0.006), at('rest-b', 'restaurant', 0.0111, 0.006)];
  const day = await compose(records, ['food', 'culture']);
  assert.equal(day.stops.length, 6, order(day.stops));
  assert.deepEqual(meals(day.stops).sort(), ['rest-a', 'rest-b']);
});

test('a pinned second meal is kept even when it cannot have its own place', async () => {
  const day = await compose(clustered(), ['culture', 'views', 'food'], { pinnedStopIds: ['rest-b'] });
  assert.ok(day.stops.some(stop => stop.id === 'rest-b'), order(day.stops));
  assert.ok(meals(day.stops).length >= 1);
});

test('separability is judged on the walk ordering may add, not on stop names', () => {
  const restaurant = (id, dLat, dLng = 0) => ({ ...at(id, 'restaurant', dLat, dLng), covered_preferences: ['food'] });
  const gallery = (id, dLat, dLng = 0) => ({ ...at(id, 'gallery', dLat, dLng), covered_preferences: ['museums'] });
  // On one line: meal, gallery, meal costs nothing extra.
  assert.equal(mealsSeparable([restaurant('a', 0), gallery('g', 0.003), restaurant('b', 0.006)]), true);
  // Both meals together at one end: putting the gallery between them walks back.
  assert.equal(mealsSeparable([gallery('g', 0), restaurant('a', 0.01), restaurant('b', 0.0111)]), false);
  // Three meals in four stops can never all be apart.
  assert.equal(mealsSeparable([restaurant('a', 0), restaurant('b', 0.001), restaurant('c', 0.002), gallery('g', 0.003)]), false);
  // One meal, or none, is always fine.
  assert.equal(mealsSeparable([restaurant('a', 0), gallery('g', 0.01)]), true);
  assert.equal(mealsSeparable([gallery('g', 0), gallery('h', 0.01)]), true);
  // Two meals 80 m apart with a gallery 40 m off the line between them: the
  // separated order adds less than 0.25 km, so ordering may take it.
  assert.equal(mealsSeparable([restaurant('a', 0), restaurant('b', 0.0007), gallery('g', 0.00035, 0.0006)]), true);
});

// Owner decision on #702, 13 Nov 2026: the meal sequence is judged on the
// final route, a second meal already apart there is never removed, the walk is
// never made longer for this rule, and without a confirmed improvement the
// original day is kept whole. These pools come from the before/after evidence
// (docs/evidence/meal-spacing-20261113); main's final days are recorded there.
const { seededPool } = require('./helpers/meal-spacing-pools');

test('a second meal already apart in the final route is never removed', async () => {
  // main: bar → restaurant → bar → restaurant, 6.2 km. The strict rule dropped
  // the second restaurant and walked 8.9 km.
  const day = await compose(seededPool(1), ['food', 'nightlife'], { dayRhythm: 'calm' });
  assert.deepEqual(day.stops.map(stop => stop.id), ['bar-1-2', 'restaurant-1-1', 'bar-1-0', 'restaurant-1-0']);
  assert.equal(day.route.estimated_km, 6.2);
});

test('the meal rule never makes the final walk longer; the original day is kept whole', async () => {
  // main: two adjacent restaurants at the end, 5.4 km. The only day that
  // separated them walked 9.2 km, so the original day stays, unchanged.
  const day = await compose(seededPool(28), ['food', 'fika', 'views'], { dayRhythm: 'full' });
  assert.deepEqual(day.stops.map(stop => stop.id),
    ['cafe-28-0', 'park-28-1', 'park-28-0', 'cafe-28-2', 'restaurant-28-1', 'restaurant-28-3']);
  assert.equal(day.route.estimated_km, 5.4);
});

test('a recomposed day is accepted only as a confirmed whole-route improvement', () => {
  const stop = (id, covered, partial = []) => ({ id, covered_preferences: covered, partial_preferences: partial });
  const meal = id => stop(id, ['food']);
  const art = id => stop(id, ['museums']);
  const route = (stops, km) => ({ main_stops: stops, estimated_km: km });
  const preferences = ['culture', 'food'];
  const base = route([art('g1'), art('g2'), meal('r1'), meal('r2')], 3.0);
  const spaced = route([art('g1'), meal('r1'), art('g2'), art('g3')], 3.0);
  assert.equal(routeNeedsMealSpacing(base, preferences), true);
  assert.equal(acceptMealSpacing({ baseRoute: base, spacedRoute: spaced, preferences }), true, 'apart, same size, same walk');
  assert.equal(acceptMealSpacing({ baseRoute: base, spacedRoute: route(spaced.main_stops, 2.4), preferences }), true, 'a shorter walk');
  const refused = {
    'a longer walk': [base, route(spaced.main_stops, 3.1)],
    'meals still side by side': [base, route([art('g1'), art('g2'), meal('r1'), meal('r3')], 2.0)],
    'a different stop count': [base, route([art('g1'), meal('r1'), art('g2')], 2.0)],
    'culture no longer covered': [base, route([stop('p', ['green']), meal('r1'), stop('q', ['green']), stop('v', ['scenic'])], 2.0)],
    'no walk to compare': [base, route(spaced.main_stops, null)],
    'no recomposed route': [base, null],
  };
  for (const [name, [baseRoute, spacedRoute]] of Object.entries(refused)) {
    assert.equal(acceptMealSpacing({ baseRoute, spacedRoute, preferences }), false, name);
  }
  assert.equal(acceptMealSpacing({ baseRoute: base, spacedRoute: spaced, preferences, pins: ['r2'] }), false, 'a pinned stop is dropped');
  const withApart = route([meal('r0'), art('g1'), art('g2'), meal('r1'), meal('r2')], 3.0);
  assert.equal(acceptMealSpacing({ baseRoute: withApart, spacedRoute: route([art('g1'), meal('r1'), art('g2'), art('g3'), meal('r2')], 2.0), preferences }),
    false, 'a meal that was already apart (r0) is never removed');
  assert.equal(routeNeedsMealSpacing(route([art('g1'), meal('r1'), art('g2'), meal('r2')], 3.0), preferences), false, 'meals already apart');
  assert.equal(routeNeedsMealSpacing(route([meal('r1'), meal('r2')], 1.0), ['food']), false, 'food-only days are never touched');
  assert.equal(routeNeedsMealSpacing(route([art('g1'), art('g2')], 1.0), preferences), false, 'no meals');
});
