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
  MAX_SHED_ATTEMPTS,
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

test("losing the route entirely is not an acceptable settlement", () => {
  // The first version of this rule accepted any pin set that produced no route,
  // on the reasoning that shedding cannot conjure one. That is only true when
  // the request composes nothing WITHOUT the pins either. When the baseline
  // does compose, the commitments are what broke it, and a smaller set of them
  // would still have left the user with a day.
  assert.equal(withinBudget({ withPins: day(null), baseline: day(4.0), ceilingKm: CEILING }), false);
  // Nothing either way: that is the day, and the pins are not to blame.
  assert.equal(withinBudget({ withPins: day(null), baseline: day(null), ceilingKm: CEILING }), true);
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
  assert.deepEqual(pinDropOrder(["b", "a"], ORIGIN, twins), ["a", "b"]);
  assert.deepEqual(pinDropOrder(["a", "b"], ORIGIN, twins), ["a", "b"]);
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

test("shedding stops as soon as the set is affordable", async () => {
  // Only the far pin is unaffordable, and it is shed first, so the near ones
  // survive. Note what this does NOT claim: the result is the first affordable
  // set reached by dropping farthest-first, not a search for the largest
  // affordable subset. Dropping a nearer pin might occasionally retain one
  // more, but finding that would mean finalising combinations rather than a
  // chain, and every finalisation is a full compose.
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
  assert.deepEqual(settled.route, first.route, "the already-finalised day is what is published");
  assert.deepEqual(settled.shedForBudget, [], "and the walk refused nothing");
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
    assert.deepEqual(settled.route, first.route);
    // Nothing was asked of the walk, so the walk cannot be blamed for anything.
    assert.deepEqual(settled.shedForBudget, []);
  }
});

test("a pin set that composes no route at all keeps shedding", async () => {
  // A day is worth more than a commitment. If the pins break composition
  // outright while a smaller set would still have produced something, handing
  // back the empty result gives the user nothing — and it reports every pin
  // unhonoured anyway, so nothing is gained by stopping early.
  const finalize = async (pins) => {
    if (pins.includes("far")) return { route: null };
    return day(4.1, pins);
  };
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
    "the commitments that still leave a day standing are kept",
  );
});

test("a request that composes nothing either way is not blamed on the pins", async () => {
  // No route with them and no route without them: shedding cannot conjure one,
  // and the honest outcome is the empty day the request would have produced
  // anyway.
  let calls = 0;
  const finalize = async () => { calls += 1; return { route: null }; };
  const withPins = await finalize();
  calls = 0;
  const settled = await settlePinsWithinWalkingBudget({
    finalize,
    withPins,
    pins: ["near", "mid", "far"],
    walkingKmTarget: 4,
    origin: ORIGIN,
    sourceCandidates: CANDIDATES,
  });
  assert.equal(settled.route, null);
  assert.equal(calls, 1, "only the baseline is finalised — no pointless shedding");
});

test("shedding is bounded, however many commitments a request carries", async () => {
  // Every finalisation is a full compose — ordering, bridge insertion, capacity
  // repair, event weave — and can reach the engine several times. Measured
  // end-to-end before this ceiling: twelve unaffordable pins cost 13 engine
  // runs and ~2s of event-loop time, against 2 runs and ~54ms for the same
  // request with none. That is reachable from one public request, so the chain
  // is bounded independently of the pin limit.
  const calls = [];
  const finalize = async (pins) => {
    calls.push([...pins]);
    return day(pins.length ? 99 : 4.0, pins);
  };
  const pins = Array.from({ length: 12 }, (_, i) => `far-${i}`);
  const candidates = pins.map((id, i) => ({ id, lat: 41.9 + 0.02 + i * 0.0006, lng: 12.49 }));

  const first = await finalize(pins);
  calls.length = 0;
  const settled = await settlePinsWithinWalkingBudget({
    finalize,
    withPins: first,
    pins,
    walkingKmTarget: 4,
    origin: { lat: 41.9, lng: 12.49 },
    sourceCandidates: candidates,
  });

  assert.ok(
    calls.length <= MAX_SHED_ATTEMPTS + 1,
    `at most ${MAX_SHED_ATTEMPTS} sheds plus the baseline, got ${calls.length}`,
  );
  // Giving up returns the pin-less day, so every commitment reports unhonoured
  // — the same answer shedding to the end would have produced, at a fraction of
  // the cost.
  assert.deepEqual(settled.route.main_stops, [], "the pin-less baseline is what is published");
});

test("the bound does not fire for a set that settles quickly", async () => {
  // A near-affordable day must not be penalised by a ceiling meant for
  // wholesale-unaffordable ones.
  const finalize = async (pins) => (pins.includes("far") ? day(99, pins) : day(4.1, pins));
  const pins = ["near", "mid", "far"];
  const settled = await settlePinsWithinWalkingBudget({
    finalize,
    withPins: await finalize(pins),
    pins,
    walkingKmTarget: 4,
    origin: ORIGIN,
    sourceCandidates: CANDIDATES,
  });
  assert.deepEqual(settled.route.main_stops.map((s) => s.id), ["near", "mid"]);
});

test("the walk names exactly the commitments it refused", async () => {
  // The caller reports WHY a pin went unmet, and only this rule knows which
  // refusals were the walk's doing rather than the composer's.
  const finalize = async (pins) => (pins.includes("far") ? day(99, pins) : day(4.1, pins));
  const pins = ["near", "mid", "far"];
  const settled = await settlePinsWithinWalkingBudget({
    finalize,
    withPins: await finalize(pins),
    pins,
    walkingKmTarget: 4,
    origin: ORIGIN,
    sourceCandidates: CANDIDATES,
  });
  assert.deepEqual(settled.shedForBudget, ["far"], "only the one the walk could not absorb");
  assert.deepEqual(settled.route.main_stops.map((s) => s.id), ["near", "mid"]);
});

test("the walk never claims an unknown pin as a budget refusal", async () => {
  const finalize = async (pins) => (pins.includes("far") ? day(99, pins) : day(4.1, pins));
  const settled = await settlePinsWithinWalkingBudget({
    finalize,
    withPins: await finalize(["ghost", "far"]),
    pins: ["ghost", "far"],
    walkingKmTarget: 4,
    origin: ORIGIN,
    sourceCandidates: CANDIDATES,
  });

  assert.deepEqual(
    settled.shedForBudget,
    ["far"],
    "only a candidate actually offered to composition can be refused by its walking budget",
  );
});

test("unknown pins cannot consume the bounded shed attempts before an offered pin", async () => {
  const ghosts = Array.from({ length: MAX_SHED_ATTEMPTS }, (_, index) => `ghost-${index}`);
  const pins = [...ghosts, "far"];
  const finalize = async (activePins) => (
    activePins.includes("far") ? day(99, ["far"]) : day(4.0, [])
  );
  const settled = await settlePinsWithinWalkingBudget({
    finalize,
    withPins: await finalize(pins),
    pins,
    walkingKmTarget: 4,
    origin: ORIGIN,
    sourceCandidates: [CANDIDATES.find((candidate) => candidate.id === "far")],
  });

  assert.deepEqual(settled.shedForBudget, ["far"]);
  assert.deepEqual(settled.route.main_stops, [], "the affordable pin-less route is published");
});

test("giving up attributes every surviving pin to the walk as well", async () => {
  // The pin-less day is published, so the pins still standing were refused by
  // the walk just as surely as the ones already shed. Saying otherwise would
  // blame the composer for a decision the budget made.
  const finalize = async (pins) => day(pins.length ? 99 : 4.0, pins);
  const pins = Array.from({ length: 12 }, (_, i) => `far-${i}`);
  const candidates = pins.map((id, i) => ({ id, lat: 41.9 + 0.02 + i * 0.0006, lng: 12.49 }));
  const settled = await settlePinsWithinWalkingBudget({
    finalize,
    withPins: await finalize(pins),
    pins,
    walkingKmTarget: 4,
    origin: { lat: 41.9, lng: 12.49 },
    sourceCandidates: candidates,
  });
  assert.deepEqual([...settled.shedForBudget].sort(), [...pins].sort());
});
