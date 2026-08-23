"use strict";

/**
 * A pin has to be affordable against the day that is actually PUBLISHED.
 *
 * The first version of this guard scored an unordered array before bridge
 * insertion, which is a route no user ever sees. Independent review produced
 * both failure directions against real fixtures:
 *
 *   feasible pin refused   base 4.0km, provisional 6.9km, finished 4.2km, ceiling 4.72
 *   over-ceiling accepted  base 3.7km, provisional 4.7km, finished 5.3km, ceiling 4.72
 *
 * Both disappear once the decision is expressed in terms of finalised routes,
 * which is all this module knows how to talk about.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  pinDropOrder,
  settlePinsWithinWalkingBudget,
  withinBudget,
} = require("../server/planner/pin-walking-budget");

const day = (km, stopIds = []) => ({
  route: { estimated_km: km, main_stops: stopIds.map((id) => ({ id })) },
});
const CEILING = 4.72; // a 4km request

test("a finished route inside the ceiling is affordable", () => {
  assert.equal(withinBudget({ withPins: day(4.2), baseline: day(4.0), ceilingKm: CEILING }), true);
});

test("a finished route over the ceiling is not, however it got there", () => {
  assert.equal(withinBudget({ withPins: day(5.3), baseline: day(3.7), ceilingKm: CEILING }), false);
});

test("an already-over-budget baseline is not blamed on the pins", () => {
  // Independent review: base 16.3km, with pin 21.1km, target 4km — the pin was
  // honoured and the walk reported valid because an over-budget baseline
  // short-circuited the whole check. Not blaming the pins for the 16.3 is
  // right; letting them add 4.8 on top is not.
  assert.equal(withinBudget({ withPins: day(16.3), baseline: day(16.3), ceilingKm: CEILING }), true);
  assert.equal(withinBudget({ withPins: day(21.1), baseline: day(16.3), ceilingKm: CEILING }), false);
});

test("no route at all is not a budget question", () => {
  // Dropping further pins cannot conjure a route, and the caller reports them
  // unhonoured either way.
  assert.equal(withinBudget({ withPins: day(null), baseline: day(4.0), ceilingKm: CEILING }), true);
});

// --------------------------------------------------------------------------
// Drop order and termination.
// --------------------------------------------------------------------------

const ORIGIN = { lat: 41.9, lng: 12.49 };
const CANDIDATES = [
  { id: "near", lat: 41.9005, lng: 12.49 },
  { id: "mid", lat: 41.905, lng: 12.49 },
  { id: "far", lat: 41.94, lng: 12.49 },
];

test("the farthest pin is dropped first, deterministically", () => {
  // Distance from the anchor is what makes a day unaffordable, so shedding the
  // farthest converges instead of discarding commitments at random.
  assert.deepEqual(pinDropOrder(["near", "mid", "far"], ORIGIN, CANDIDATES), ["far", "mid", "near"]);
  assert.deepEqual(pinDropOrder(["far", "near", "mid"], ORIGIN, CANDIDATES), ["far", "mid", "near"]);
});

test("pins with no coordinates sort first, and ties break on id", () => {
  const withUnknown = [...CANDIDATES, { id: "ghost" }];
  assert.equal(pinDropOrder(["near", "ghost"], ORIGIN, withUnknown)[0], "ghost");
  const twins = [{ id: "b", lat: 41.905, lng: 12.49 }, { id: "a", lat: 41.905, lng: 12.49 }];
  assert.deepEqual(pinDropOrder(["b", "a"], ORIGIN, twins), pinDropOrder(["a", "b"], ORIGIN, twins));
});

test("the loop shrinks the pin set and terminates within pins + 1 finalisations", async () => {
  const calls = [];
  // Never satisfiable: every finalisation comes back over the ceiling, so the
  // loop must exhaust the pins rather than spin.
  const finalize = async (pins) => {
    calls.push([...pins]);
    return day(pins.length ? 99 : 4.0, pins);
  };
  const pins = ["near", "mid", "far"];
  const first = await finalize(pins);
  await settlePinsWithinWalkingBudget({
    finalize,
    withPins: first,
    pins,
    walkingKmTarget: 4,
    origin: ORIGIN,
    sourceCandidates: CANDIDATES,
  });

  const pinned = calls.filter((c) => c.length);
  assert.ok(pinned.length <= pins.length + 1, `at most ${pins.length + 1} pinned runs, got ${pinned.length}`);
  for (let i = 1; i < pinned.length; i += 1) {
    assert.ok(pinned[i].length < pinned[i - 1].length, "the pin set strictly shrinks every iteration");
  }
  assert.ok(calls.some((c) => c.length === 0), "the pin-less baseline is finalised for comparison");
});

test("it settles on the largest affordable pin set, not the first one tried", async () => {
  // Only the far pin is unaffordable. The near ones must survive.
  const finalize = async (pins) => (pins.includes("far") ? day(9.9, pins) : day(4.1, pins));
  const pins = ["near", "mid", "far"];
  const settled = await settlePinsWithinWalkingBudget({
    finalize,
    withPins: await finalize(pins),
    pins,
    walkingKmTarget: 4,
    origin: ORIGIN,
    sourceCandidates: CANDIDATES,
  });
  assert.deepEqual(
    settled.route.main_stops.map((s) => s.id),
    ["near", "mid"],
    "the affordable commitments are kept; only the farthest is shed",
  );
});

test("an affordable set is published untouched, with no extra work beyond the baseline", async () => {
  const calls = [];
  const finalize = async (pins) => { calls.push([...pins]); return day(4.2, pins); };
  const pins = ["near", "mid"];
  const first = await finalize(pins);
  calls.length = 0;
  const settled = await settlePinsWithinWalkingBudget({
    finalize, withPins: first, pins, walkingKmTarget: 4, origin: ORIGIN, sourceCandidates: CANDIDATES,
  });
  assert.equal(settled, first, "the already-finalised day is returned as-is");
  assert.deepEqual(calls, [[]], "only the pin-less baseline is finalised, nothing re-run");
});

test("no walking ceiling means no budget rule at all", async () => {
  const finalize = async () => { throw new Error("must not finalise again"); };
  const first = day(99, ["far"]);
  for (const args of [
    { walkingKmTarget: 4, distanceMode: "no_limit" },
    { walkingKmTarget: null },
  ]) {
    const settled = await settlePinsWithinWalkingBudget({
      finalize, withPins: first, pins: ["far"], origin: ORIGIN, sourceCandidates: CANDIDATES, ...args,
    });
    assert.equal(settled, first);
  }
});
