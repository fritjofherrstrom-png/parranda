"use strict";
const test = require('node:test');
const assert = require('node:assert/strict');
const { createOpenDataLoader, mapOverpassResponse } = require('../server/place-candidates/open-data-loader');
const { composeAgnosticRouteOutput } = require('../server/planner/agnostic-route-output');

// A bounded, already-acquired mixed source response. The wrong category cut
// loses six feasible requested experiences before the real gates/engine see
// them. Only the provider transport is controlled; no role/API output is faked.
const categories = [
  ['scenic', 'tourism', 'viewpoint'], ['green', 'leisure', 'park'],
  ['swimming', 'natural', 'beach'], ['second_hand', 'shop', 'second_hand'],
  ['food', 'amenity', 'restaurant'], ['coffee', 'amenity', 'cafe'],
  ['bars', 'amenity', 'bar'], ['culture', 'tourism', 'museum'],
  ['markets', 'amenity', 'marketplace'],
];
const names = ['Alder', 'Birch', 'Cedar', 'Dogwood', 'Elm', 'Fir', 'Ginkgo', 'Hazel'];
function response(corroborated = true) {
  return { elements: categories.flatMap(([intent, key, value], c) => names.map((name, i) => ({
    type: 'node', id: 810000 + c * 100 + i, lat: 55.6 + i * 0.001, lon: 13 + c * 0.0001,
    tags: { name: `${name} ${intent}`, [key]: value, opening_hours: 'Mo-Su 09:00-22:00',
      ...(corroborated ? { wikidata: `Q${810000 + c * 100 + i}` } : {}) },
  }))) };
}
async function compose(preferences, dayRhythm, { corroborated = true } = {}) {
  let calls = 0;
  const loader = createOpenDataLoader({ fetcher: async () => { calls++; return { ok: true, json: async () => response(corroborated) }; } });
  const result = await composeAgnosticRouteOutput({ coords: { lat: 55.6, lng: 13 },
    baselineResult: { days: [] }, externalRequested: true, openDataLoader: loader,
    date: '2026-10-22', todayIsoDate: '2026-10-14', trustedTimezone: 'Europe/Stockholm',
    timezone: 'Europe/Stockholm', clock: () => new Date('2026-10-14T08:00:00Z'),
    synthesizeVia: 'engine', distanceMode: 'no_limit', dayRhythm, preferences,
    weatherProvider: async () => ({ condition: 'sun', source: 'controlled', stale: false }),
  });
  return { route: result.result.days[0]?.primary_route, experiment: result.experiment, calls };
}
for (const intent of ['second_hand', 'coffee', 'culture', 'green', 'food', 'bars', 'scenic', 'markets']) {
  test(`an acquired rich ${intent} pool survives the source cut for Balanced and Full`, async () => {
    const calm = await compose([intent], 'calm'), balanced = await compose([intent], 'balanced'), full = await compose([intent], 'full');
    assert.equal(calm.route?.main_stops.length, 4, 'Calm keeps the lighter density on the same factual supply');
    assert.equal(balanced.route?.main_stops.length, 5, 'Balanced can spend its density on the requested interest');
    assert.equal(full.route?.main_stops.length, 6, 'Full can use six existing gated matching places');
    assert.equal(full.route.day_profile, 'peak');
    assert.equal(balanced.route.day_profile, 'variation');
    assert.ok(full.route.main_stops.every(s => s.covered_preferences.includes(intent === 'culture' ? 'museums' : intent)));
    assert.equal(new Set(full.route.main_stops.map(s => s.id)).size, 6);
    assert.ok(full.route.main_stops.every(s => s.selected_day_hours?.windows?.[0]?.closes === '22:00'));
    assert.equal(full.route.trust_summary.human_verified, false);
    assert.equal(full.calls, 1, 'focus preservation must not require another provider attempt');
  });
}
test('two interests preserve depth and each requested interest without unrelated filler', async () => {
  const { route } = await compose(['second_hand', 'culture'], 'full');
  assert.equal(route?.main_stops.length, 6);
  assert.ok(route.main_stops.some(s => s.type === 'vintage-shop'));
  assert.ok(route.main_stops.some(s => s.type === 'museum'));
  assert.ok(route.main_stops.every(s => ['vintage-shop', 'museum'].includes(s.type)));
});
test('preserving acquired interest depth never corroborates single-family records', async () => {
  for (const intent of ['second_hand', 'coffee', 'culture']) {
    const { route } = await compose([intent], 'full', { corroborated: false });
    assert.equal(route?.main_stops.length, 6, 'single-family admission can fill the requested rhythm without adding source evidence');
    assert.ok(route.main_stops.every(stop => stop.trust?.confidence === 'low' &&
      stop.provenance?.attribution?.length === 1 && stop.provenance?.corroborated_by_external === false));
    assert.equal(route.trust_summary.human_verified, false);
  }
});

test('regional source partitioning preserves requested depth in its selected cluster', async () => {
  const { deriveSecondaryAnchors } = require('../server/place-candidates/spatial-scope');
  const scope = { source: 'test_resolver', kind: 'region', bounds: { south: 55.3, north: 55.9, west: 12.85, east: 13.15 } };
  const secondary = deriveSecondaryAnchors(scope, { lat: 55.6, lng: 13 })[0];
  let calls = 0;
  const loader = createOpenDataLoader({ fetcher: async () => {
    calls++;
    return { ok: true, json: async () => calls < 3 ? { elements: [] } : {
      elements: response().elements.map(row => ({ ...row, lat: secondary.lat + row.lat - 55.6, lon: secondary.lng + row.lon - 13 })),
    } };
  } });
  const rows = await loader({ lat: 55.6, lng: 13, requestedIntents: ['coffee'], dayRhythm: 'calm', anchorMode: 'place', spatialScope: scope });
  assert.equal(calls, 3, 'same existing primary, expansion and bounded regional acquisition');
  assert.equal(rows.filter(row => row.type === 'cafe').length, 8);
  assert.ok(rows.every(row => Math.abs(row.lat - secondary.lat) < .02), 'do not mix the primary and regional clusters');
});

test('closed strong matches cannot crowd viable assessed partial matches out of the source cut', async () => {
  const elements = [
    ...Array.from({ length: 25 }, (_, i) => ({ type: 'node', id: 930000 + i, lat: 55.6 + i * .00001, lon: 13,
      tags: { name: `Closed Restaurant ${i}`, amenity: 'restaurant', opening_hours: 'Mo-Su off', wikidata: `Q${930000 + i}` } })),
    ...response().elements.filter(row => row.tags.amenity === 'cafe'),
  ];
  const rows = mapOverpassResponse({ elements }, 25, { origin: { lat: 55.6, lng: 13 }, requestedIntents: ['food'],
    availabilityWindow: { weekday: 4, startMinute: 540, endMinute: 1320 } });
  assert.equal(rows.filter(row => row.type === 'cafe').length, 8, 'known closed primary fits must not erase useful source evidence');
  const output = await composeAgnosticRouteOutput({ coords: { lat: 55.6, lng: 13 }, baselineResult: { days: [] },
    externalRequested: true, openDataLoader: async () => rows, date: '2026-10-22', todayIsoDate: '2026-10-14',
    trustedTimezone: 'Europe/Stockholm', timezone: 'Europe/Stockholm', clock: () => new Date('2026-10-14T08:00:00Z'),
    synthesizeVia: 'engine', distanceMode: 'no_limit', dayRhythm: 'full', preferences: ['food'],
    weatherProvider: async () => ({ condition: 'sun', source: 'controlled', stale: false }),
  });
  const stops = output.result.days[0]?.primary_route?.main_stops;
  assert.ok(stops?.length);
  assert.ok(stops.every(s => s.type === 'cafe' && s.partial_preferences.includes('food') && !s.covered_preferences.includes('food')),
    'retain the assessed partial label; no closed restaurant or upgraded match');
});
