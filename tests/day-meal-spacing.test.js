'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const { record, compose } = require('./helpers/day-composition-fixtures');
const { isMeal, mealsSeparable } = require('../server/planner/day-composition-policy');

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
