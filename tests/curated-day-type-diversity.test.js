'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const catalog = require('../server/cities/barcelona/catalog');
const { nearbyCuratedSupply } = require('../server/planner/nearby-curated-supply');
const { matchCandidateToIntent } = require('../server/candidates/intent-vocabulary');
const { composeAgnosticRouteOutput } = require('../server/planner/agnostic-route-output');

// Real versioned catalog records, controlled offline date/context. This is not
// full public-source, Live, weather or network walking-provider acceptance.
const COORDS = { lat: 41.3825802, lng: 2.177073 };
const DATE = '2026-11-25';

function supply() {
  return nearbyCuratedSupply({
    configs: { barcelona: { key: 'barcelona', label: 'Barcelona', visibility: 'beta', catalog, routing: {} } },
    anchor: COORDS,
    date: DATE,
  });
}

async function compose(curatedCandidates, extra = {}) {
  return composeAgnosticRouteOutput({
    coords: COORDS,
    spatialScope: {
      kind: 'settlement', source: 'nominatim_bounds',
      width_km: 14.67, height_km: 16.78, diagonal_km: 22.29,
      collection_mode: 'regional_bounded',
      bounds: { south: 41.3170354, north: 41.4679135, west: 2.0524977, east: 2.2283555 },
    },
    anchorMode: 'place',
    placeLabel: 'Barcelona',
    baselineResult: { days: [] },
    externalRequested: true,
    openDataLoader: async () => [],
    curatedCandidates,
    date: DATE,
    todayIsoDate: '2026-11-24',
    timezone: 'Europe/Madrid',
    trustedTimezone: 'Europe/Madrid',
    clock: () => new Date('2026-11-24T12:25:00Z'),
    weatherProvider: async () => null,
    synthesizeVia: 'engine',
    distanceMode: 'no_limit',
    dayRhythm: 'balanced',
    preferences: ['culture'],
    ...extra,
  });
}

function physicalStops(output) {
  return output.result.days[0].primary_route.main_stops.filter(stop => stop.is_live_event !== true);
}

test('rich broad-Culture supply retains different sourced place types through real publication', async (t) => {
  const candidates = supply();
  assert.equal(candidates.length, 102, 'real-catalog replay precondition');
  assert.equal(candidates.filter(candidate => matchCandidateToIntent(candidate, 'museums').level === 'strong').length, 52);
  const output = await compose(candidates);
  const stops = physicalStops(output);
  assert.equal(stops.length, 5, 'variety must not be manufactured by reducing day depth');
  assert.ok(stops.every(stop => stop.covered_preferences.includes('museums')), 'preserve strong broad Culture coverage');
  assert.ok(new Set(stops.map(stop => stop.type)).size >= 4,
    'equal-ranked source types must survive the pre-composition cut instead of publishing only three types');
  assert.ok(stops.some(stop => stop.type === 'museum'), 'this actual equal-rank supply includes a viable museum, without a universal museum quota');
  assert.ok(stops.some(stop => stop.type === 'music'), 'Culture remains broad, including music');
  assert.ok(stops.some(stop => stop.type === 'shop'), 'source-supported craft culture remains');
  const byId = new Map(candidates.map(candidate => [candidate.id, candidate]));
  for (const stop of stops) {
    const source = byId.get(stop.id);
    assert.ok(source, 'every published stop comes from supplied real catalog');
    assert.equal(stop.type, source.type, 'do not relabel places to fabricate variety');
    assert.equal(stop.lat, source.lat);
    assert.equal(stop.lng, source.lng);
  }
  t.diagnostic(JSON.stringify({ scope: 'real catalog offline replay; not public',
    stops: stops.map(stop => ({ id: stop.id, label: stop.label, type: stop.type })),
    estimated_km: output.result.days[0].primary_route.estimated_km }));
});

test('real catalog publication is stable when the same supplied facts are reversed', async () => {
  const forward = physicalStops(await compose(supply()));
  const reversed = physicalStops(await compose(supply().reverse()));
  assert.deepEqual(reversed.map(stop => stop.id), forward.map(stop => stop.id));
  assert.deepEqual(reversed.map(stop => [stop.type, stop.lat, stop.lng, stop.covered_preferences]),
    forward.map(stop => [stop.type, stop.lat, stop.lng, stop.covered_preferences]));
});

test('real Picasso pin preserves the established published commitment path', async () => {
  const stops = physicalStops(await compose(supply(), { pinnedStopIds: ['museu-picasso'] }));
  assert.deepEqual(stops.map(stop => stop.id),
    ['la-manual-alpargatera', 'harlem-jazz-club', 'museu-picasso', 'el-xampanyet', 'cal-pep']);
  assert.equal(stops.length, 5);
  assert.ok(stops.every(stop => stop.covered_preferences.includes('museums')));
});
