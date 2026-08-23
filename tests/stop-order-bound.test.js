"use strict";

/**
 * The stop-order optimizer enumerates permutations, and permuteStops
 * MATERIALISES every one of them, so memory binds before time. Measured on the
 * Node the suite runs under: 8 stops = 40,320 orders (~40ms), 9 = 362,880
 * (~230ms), 10 = 3,628,800 (~3s), 11 = 39,916,800 -> the heap is exhausted and
 * the process is killed outright.
 *
 * Composed days sat well inside that range until commitments arrived: a pin
 * joins the selection on top of whatever the chooser already picked, so the
 * optimizer's input stopped being bounded by the stop budget alone. The
 * guarantee therefore has to hold on the optimizer's ACTUAL input — capping the
 * pin count would leave the same cliff reachable by ordinary stops.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  MAX_EXHAUSTIVE_STOP_ORDER,
  optimizeStopOrder,
  permuteStops,
} = require("../server/route-engine");

const stopsAt = (count, spread = 0.004) =>
  Array.from({ length: count }, (_, i) => ({
    id: `stop-${i}`,
    name: `Stop ${i}`,
    // A deliberately unhelpful initial order: every other stop sits far from
    // its neighbour, so a do-nothing "optimizer" would score badly.
    lat: 41.9 + (i % 2 === 0 ? i : count - i) * spread,
    lng: 12.49 + (i % 3) * spread,
  }));

const START = { lat: 41.9, lng: 12.49, label: "start" };
const order = (result) => result.orderedStops.map((stop) => stop.id);

function optimize(stops) {
  return optimizeStopOrder(stops, "loop", START, START, null, null, 6, "soft_target", "balanced", "en");
}


test("the optimizer never enumerates above the safe exhaustive range", () => {
  // The guarantee is a refusal, not a convention: a future caller that reaches
  // permuteStops directly with a runaway input must fail loudly rather than
  // take the process down.
  assert.doesNotThrow(() => permuteStops(stopsAt(MAX_EXHAUSTIVE_STOP_ORDER)));
  assert.throws(
    () => permuteStops(stopsAt(MAX_EXHAUSTIVE_STOP_ORDER + 1)),
    /permuteStops_refused_above_8/,
  );
});

test("an oversized stop set is ordered without enumerating it", () => {
  // 20 stops is 2.4e18 permutations. Before the bound this call did not return
  // slowly — it exhausted the heap and killed the runner.
  const stops = stopsAt(20);
  const result = optimize(stops);

  assert.equal(result.orderedStops.length, 20, "every stop handed in comes back out");
  assert.deepEqual(
    [...order(result)].sort(),
    [...stops.map((s) => s.id)].sort(),
    "the same stops, only reordered — nothing is dropped to fit the optimizer",
  );
  assert.ok(Number.isFinite(result.geometry.objective), "a real geometry, not a stub");
});

test("the oversized path is deterministic", () => {
  // No clock and no randomness: the same request must always produce the same
  // day, or a reload silently reshuffles the user's itinerary.
  const a = optimize(stopsAt(14));
  const b = optimize(stopsAt(14));
  assert.deepEqual(order(a), order(b));
  assert.equal(a.geometry.objective, b.geometry.objective);
});

test("the fallback actually orders, rather than returning its input", () => {
  // A bound that just handed the input back would satisfy every assertion above
  // while quietly making long days worse than short ones. Two different
  // arrangements of the SAME stops must converge on the same objective — a
  // no-op cannot do that, because it would simply return each arrangement.
  const stops = stopsAt(12);
  const rotated = [...stops.slice(5), ...stops.slice(0, 5)];

  const a = optimize(stops);
  const b = optimize(rotated);

  assert.notDeepEqual(order(a), stops.map((s) => s.id), "the input order was not simply returned");
  assert.equal(
    a.geometry.objective,
    b.geometry.objective,
    "the same stop set reaches the same objective however it arrives",
  );
});

test("inside the safe range the exhaustive search still runs", () => {
  // The bound must not quietly change the day for the sizes real requests
  // actually produce.
  const stops = stopsAt(6);
  const result = optimize(stops);
  const brute = permuteStops(stops)
    .map((candidate) => optimizeStopOrder(candidate, "loop", START, START, null, null, 6, "soft_target", "balanced", "en"))
    .reduce((best, cur) => (best === null || cur.geometry.objective < best.geometry.objective ? cur : best), null);
  assert.equal(result.geometry.objective, brute.geometry.objective, "still the true optimum");
});
