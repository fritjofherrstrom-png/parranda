'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const { record, compose } = require('./helpers/day-composition-fixtures');
const { isMeal, mealsSeparable, routeNeedsMealSpacing, acceptMealSpacing, acceptMealSpacedFinal } = require('../server/planner/day-composition-policy');

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

// HOLD review on #702, 14 Nov 2026: the swap was chosen before the Live weave
// and the final walking validation, so a day that only looked better could be
// published, or fail and fall back to no day at all. The decision is now made
// on comparable final results, and the meal change is attempted only where
// that final chain needs no walking provider; otherwise nothing changes.
const CLUSTERED_MAIN = ['museum', 'gallery-a', 'gallery-c', 'garden', 'rest-a', 'rest-c'];
function clusteredPool() {
  return [
    at('museum', 'museum', -0.003, 0.002), at('gallery-a', 'gallery', 0), at('gallery-b', 'gallery', 0.0016),
    at('gallery-c', 'gallery', 0.001, 0.004), at('garden', 'garden', 0.006, 0.003), at('park', 'park', 0.008, -0.002),
    at('cafe', 'cafe', 0.004), at('rest-a', 'restaurant', 0.01, 0.006), at('rest-b', 'restaurant', 0.0111, 0.006),
    at('rest-c', 'restaurant', 0.0105, 0.0075),
  ];
}
// A walking router seam for the final chain: legs as the heuristic measures
// them, except for any route through gallery-b (the meal alternative), which
// it walks three times longer or refuses outright.
function walkingRouter(mode, calls) {
  return async points => {
    calls.push(points.map(point => point.label));
    const through = points.some(point => point.label === 'gallery-b');
    if (through && mode === 'refuse') throw new Error('router refused');
    const factor = through && mode === 'longer' ? 3 : 1;
    const legs = points.slice(1).map((point, i) => {
      const km = Number((legKm(points[i], point) * factor).toFixed(1));
      return { from_label: points[i].label, to_label: point.label, distance_km: km, estimated_walk_minutes: Math.round(km * 12) };
    });
    return { source: 'osrm', mode: 'walking', estimatedKm: Number(legs.reduce((sum, leg) => sum + leg.distance_km, 0).toFixed(1)),
      legs, pathPoints: points.map(({ lat, lng }) => ({ lat, lng })) };
  };
}
function legKm(left, right) {
  const rad = d => d * Math.PI / 180;
  const h = Math.sin(rad(right.lat - left.lat) / 2) ** 2 + Math.cos(rad(left.lat)) * Math.cos(rad(right.lat)) * Math.sin(rad(right.lng - left.lng) / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h)) * 1.22;
}
const FINAL_WALK = { walkingConfig: { defaultProvider: 'osrm', transportMode: 'foot' } };

test('an alternative that looks shorter but walks further once validated never replaces the original', async () => {
  const calls = [];
  const day = await compose(clusteredPool(), ['culture', 'views', 'food'], { ...FINAL_WALK, walkingRouter: walkingRouter('longer', calls) });
  assert.deepEqual(day.stops.map(stop => stop.id), CLUSTERED_MAIN, 'the original day is published');
  assert.ok(calls.length > 0 && calls.every(labels => !labels.includes('gallery-b')),
    'no walking-provider call is spent on the alternative');
});

test('when the alternative would fail its final validation, the original day survives whole', async () => {
  const calls = [];
  const day = await compose(clusteredPool(), ['culture', 'views', 'food'], { ...FINAL_WALK, walkingRouter: walkingRouter('refuse', calls) });
  assert.ok(day.route, 'a day is still published, not the baseline fallback');
  assert.deepEqual(day.stops.map(stop => stop.id), CLUSTERED_MAIN);
  assert.equal(day.experiment.eligibility.eligible, true);
});

test('a Live weave that would differ for the alternative keeps the original, with its event', async () => {
  // main's calm Food + Culture day here ends at restaurant-3-2; the meal
  // alternative ends at museum-3-0, 2.85 km away. The evening event sits
  // about 0.5 km beyond restaurant-3-2, so only the original can take it.
  const event = { id: 'ev-meal', title: 'Evening concert', cultural_tier: 'cultural',
    starts_at: '2026-10-22T18:00:00Z', ends_at: '2026-10-22T20:00:00Z', starts_on: '2026-10-22', ends_on: '2026-10-22',
    occurrence_date: '2026-10-22', timezone: 'Europe/Stockholm',
    time_window: { kind: 'daily', starts_on: '2026-10-01', ends_on: '2026-10-31', local_start: '20:00', local_end: '22:00', timezone: 'Europe/Stockholm' },
    source_label: 'Open feed', source_url: 'https://example.org/ev-meal', license: 'CC-BY 4.0', lat: 55.60781, lng: 13.015 };
  const day = await compose(seededPool(3), ['food', 'culture'], { dayRhythm: 'calm',
    eveningEventStructure: { provenance: 'agnostic_anchor', district_day: { areas: [], evening_event: event } } });
  const core = day.stops.filter(stop => stop.is_live_event !== true).map(stop => stop.id);
  assert.deepEqual(core, ['museum-3-1', 'museum-3-0', 'restaurant-3-0', 'restaurant-3-2'], 'main\'s day, kept whole');
  assert.equal(day.stops.filter(stop => stop.is_live_event === true).length, 1, 'with its woven evening event');
});

test('the final acceptance compares only like with like, on the walk that would be published', () => {
  const stop = (id, covered, extra = {}) => ({ id, covered_preferences: covered, ...extra });
  const meal = id => stop(id, ['food']);
  const art = id => stop(id, ['museums']);
  const liveStop = id => stop(id, [], { is_live_event: true, live_occurrence_id: id });
  const route = (stops, km) => ({ main_stops: stops, estimated_km: km });
  const walk = (km, valid = true) => ({ valid, result: { estimatedKm: km } });
  const preferences = ['culture', 'food'];
  const original = { route: route([art('g1'), art('g2'), meal('r1'), meal('r2')], 3.0), weave: null, validation: walk(3.0) };
  const trial = { route: route([art('g1'), meal('r1'), art('g2'), art('g3')], 2.0), weave: null, validation: walk(2.9) };
  assert.equal(acceptMealSpacedFinal({ original, trial, preferences }), true);
  const refused = {
    'longer once validated, though shorter by estimate': { ...trial, validation: walk(3.2) },
    'its final validation fails': { ...trial, validation: walk(2.0, false) },
    'measured differently (no final validation)': { ...trial, validation: null },
    'a Live event woven only into the alternative': { route: route([...trial.route.main_stops, liveStop('live:x')], 2.0),
      weave: { applied: true }, validation: walk(2.9) },
  };
  for (const [name, candidate] of Object.entries(refused)) {
    assert.equal(acceptMealSpacedFinal({ original, trial: candidate, preferences }), false, name);
  }
  const wovenOriginal = { route: route([...original.route.main_stops, liveStop('live:x')], 3.4), weave: { applied: true }, validation: walk(3.4) };
  assert.equal(acceptMealSpacedFinal({ original: wovenOriginal, trial, preferences }), false, 'the original\'s event would be lost');
  assert.equal(acceptMealSpacedFinal({ original: wovenOriginal, preferences,
    trial: { route: route([...trial.route.main_stops, liveStop('live:y')], 3.3), weave: { applied: true }, validation: walk(3.3) } }),
    false, 'a different event');
  assert.equal(acceptMealSpacedFinal({ original: wovenOriginal, preferences,
    trial: { route: route([...trial.route.main_stops, liveStop('live:x')], 3.3), weave: { applied: true }, validation: walk(3.3) } }),
    true, 'the same event on both, a shorter walk');
  assert.equal(acceptMealSpacedFinal({ original: { ...original, validation: walk(3.0, false) }, trial, preferences }), false,
    'an original that fails is never swapped; the existing rejection stands');
});
