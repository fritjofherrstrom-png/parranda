'use strict';
// A typed place's centre is a search point, not a place the reader walks from
// or back to: the published day is the stop chain alone (see
// server/planner/route-public-geometry.js). The stops must therefore be ordered
// for that chain. Ordering them as a loop through the hidden centre gave a
// published day of museums 100 m apart split by a 2.6 km detour.
const test = require('node:test');
const assert = require('node:assert/strict');
const { optimizeStopOrder } = require('../server/route-engine');
const { anchor, record, compose } = require('./helpers/day-composition-fixtures');

// Frozen field geometry (five museums of one city on 25 Nov 2026, as published
// by staging at 7325f240), kept as offsets from the typed place's centre and
// translated to the unrelated fixture anchor with distances preserved.
const FIELD_LAT = 41.3825802;
const OFFSETS = [
  ['a', 0.002524, 0.004128],
  ['b', 0.020181, 0.017361],
  ['c', 0.002407, 0.003242],
  ['d', -0.013936, -0.016989],
  ['e', 0.009041, -0.013409],
];
const lngScale = Math.cos((FIELD_LAT * Math.PI) / 180) / Math.cos((anchor.lat * Math.PI) / 180);
const place = ([id, dLat, dLng]) => ({ id, name: id, lat: anchor.lat + dLat, lng: anchor.lng + dLng * lngScale });
const STOPS = OFFSETS.map(place);

const km = (a, b) => {
  const r = (x) => (x * Math.PI) / 180;
  const h = Math.sin(r(b.lat - a.lat) / 2) ** 2 +
    Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lng - a.lng) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
};
const chainKm = (stops) => stops.slice(1).reduce((sum, stop, i) => sum + km(stops[i], stop), 0);
const permutations = (items) => items.length <= 1 ? [items]
  : items.flatMap((item, i) => permutations([...items.slice(0, i), ...items.slice(i + 1)]).map((rest) => [item, ...rest]));
const shortestChainKm = (stops) => Math.min(...permutations(stops).map(chainKm));
const order = (options) => optimizeStopOrder(STOPS, 'loop', anchor, anchor, null, null, 6, 'no_limit', 'balanced', 'en', options);

test('a hidden centre orders the stops for the chain the reader walks', () => {
  const loop = order({ preferNearbyStart: true });
  const chain = order({ preferNearbyStart: true, orderOnStopChain: true });
  assert.ok(chainKm(chain.orderedStops) < chainKm(loop.orderedStops) - 1,
    `chain ${chainKm(chain.orderedStops).toFixed(2)} km vs loop ${chainKm(loop.orderedStops).toFixed(2)} km`);
  assert.ok(chainKm(chain.orderedStops) <= shortestChainKm(STOPS) + 0.05, 'within rounding of the shortest chain');
  const ids = chain.orderedStops.map((stop) => stop.id);
  assert.equal(Math.abs(ids.indexOf('a') - ids.indexOf('c')), 1, 'the two museums 100 m apart are visited together');
  assert.deepEqual(new Set(ids), new Set(OFFSETS.map(([id]) => id)), 'no stop is added or lost');
  assert.ok(Number.isFinite(chain.geometry.objective), 'the loop geometry is still returned for later passes');
});

test('the chain order is deterministic and walks from the end nearer the centre', () => {
  const one = order({ preferNearbyStart: true, orderOnStopChain: true }).orderedStops.map((stop) => stop.id);
  const two = order({ preferNearbyStart: true, orderOnStopChain: true }).orderedStops.map((stop) => stop.id);
  assert.deepEqual(one, two);
  const first = STOPS.find((stop) => stop.id === one[0]);
  const last = STOPS.find((stop) => stop.id === one.at(-1));
  assert.ok(km(anchor, first) <= km(anchor, last), 'of the two directions, the one starting nearer the centre');
});

test('without the option the established loop order is unchanged', () => {
  for (const options of [undefined, {}, { preferNearbyStart: true }, { orderOnStopChain: 'true' }]) {
    assert.deepEqual(order(options).orderedStops.map((stop) => stop.id),
      order(options && options.preferNearbyStart ? { preferNearbyStart: true } : undefined).orderedStops.map((stop) => stop.id));
  }
});

test('a typed place publishes its museums in the shortest walking order', async () => {
  const records = OFFSETS.map(([id, dLat, dLng]) => record(id, 'museum', 0, {
    lat: anchor.lat + dLat, lng: anchor.lng + dLng * lngScale,
  }));
  const { stops } = await compose(records, ['culture'], { anchorMode: 'place', dayRhythm: 'balanced' });
  assert.ok(stops.length >= 4, `a day is published (${stops.length} stops)`);
  assert.ok(chainKm(stops) <= shortestChainKm(stops) + 0.05,
    `published ${chainKm(stops).toFixed(2)} km, shortest ${shortestChainKm(stops).toFixed(2)} km: ${stops.map((s) => s.id).join(' → ')}`);
});

test('a reader-owned start keeps ordering from that start', async () => {
  const records = OFFSETS.map(([id, dLat, dLng]) => record(id, 'museum', 0, {
    lat: anchor.lat + dLat, lng: anchor.lng + dLng * lngScale,
  }));
  const placeDay = await compose(records, ['culture'], { anchorMode: 'place', dayRhythm: 'balanced' });
  const coordinateDay = await compose(records, ['culture'], { anchorMode: 'coordinates', dayRhythm: 'balanced' });
  assert.ok(coordinateDay.stops.length >= 4);
  assert.notEqual(coordinateDay.route.public_route_scope, 'selected_stop_chain', 'the reader’s own start stays in the route');
  assert.ok(placeDay.route.public_route_scope === 'selected_stop_chain');
});
