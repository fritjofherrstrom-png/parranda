const assert = require("node:assert/strict");
const test = require("node:test");

const {
  buildAgnosticRouteOrdering,
  daypartForRole,
  timeBandRank,
} = require("../server/planner/agnostic-route-ordering");

function stop(id, role, lat, lng) {
  return {
    role,
    candidate_id: id,
    label: id.toUpperCase(),
    origin: "external_open",
    confidence: "medium",
    coordinates: { lat, lng },
  };
}

function body(stops) {
  return {
    id: "cc-adapter:test",
    stops,
    stop_ids: stops.map((s) => s.candidate_id),
    target_roles: stops.map((s) => s.role),
    unresolved_roles: [],
    geometry_summary: { coherence: "ok" },
  };
}

test("daypart-primary sequence orders the day morning → evening", () => {
  // Role-order input (scenic, food, coffee) is daypart-incoherent: coffee should
  // come early, food mid. Daypart reorders to coffee → scenic → food.
  const input = body([
    stop("a", "food_anchor", 41.9, 12.49),
    stop("c", "scenic_anchor", 41.92, 12.49),
    stop("b", "coffee_fika_stop", 41.901, 12.49),
  ]);

  const out = buildAgnosticRouteOrdering({ adaptedBody: input });

  assert.equal(out.ordering.applied, true);
  assert.equal(out.ordering.changed, true);
  assert.equal(out.ordering.source, "trusted_candidate_pool+daypart_rhythm+proximity_sequence");
  assert.ok(out.ordering.reasons.includes("daypart_sequence_applied"));
  assert.ok(out.ordering.reasons.includes("requires_walking_budget_validation"));
  assert.deepEqual(out.ordering.original_stop_ids, ["a", "c", "b"]);
  assert.deepEqual(out.ordering.ordered_stop_ids, ["b", "c", "a"]); // coffee → scenic → food
  assert.deepEqual(out.adaptedBody.target_roles, ["coffee_fika_stop", "scenic_anchor", "food_anchor"]);

  assert.deepEqual(input.stop_ids, ["a", "c", "b"], "input stop_ids unchanged");
  assert.deepEqual(input.stops.map((s) => s.candidate_id), ["a", "c", "b"], "input stops unchanged");
});

test("the Bologna case: proximity would bury the evening bar mid-day — daypart puts it last", () => {
  // Geometry such that a pure nearest-neighbour walk from the scenic anchor goes
  // scenic → bar → food → coffee (bar 2nd, coffee last) — a nonsensical day.
  // Daypart must produce coffee/scenic early, food mid, bar LAST.
  const input = body([
    stop("scenic", "scenic_anchor", 0, 0.0),
    stop("food", "food_anchor", 0, 0.003),
    stop("coffee", "coffee_fika_stop", 0, 0.005),
    stop("bar", "evening_bar_option", 0, 0.001), // geographically nearest to scenic
  ]);

  const out = buildAgnosticRouteOrdering({ adaptedBody: input });
  const seq = out.ordering.ordered_stop_ids;

  assert.equal(out.ordering.applied, true);
  assert.equal(seq[seq.length - 1], "bar", "the evening bar must be the last stop");
  assert.notEqual(seq[seq.length - 1], "coffee", "coffee must not be the last stop");
  // bar must come strictly after food, and food after coffee/scenic.
  assert.ok(seq.indexOf("bar") > seq.indexOf("food"), "bar after food");
  assert.ok(seq.indexOf("food") > seq.indexOf("coffee"), "food after coffee");
  assert.ok(seq.indexOf("food") > seq.indexOf("scenic"), "food after scenic");
});

test("proximity orders stops WITHIN a shared daypart slot", () => {
  // coffee (slot 0) anchors the morning; two scenic stops share slot 1. The
  // scenic nearer to coffee should be visited first even though it appears later
  // in role order — proximity reorders within the slot, and the reason says so.
  const input = body([
    stop("coffee", "coffee_fika_stop", 0, 0.0),
    stop("s_far", "scenic_anchor", 0, 0.02),
    stop("s_near", "scenic_anchor", 0, 0.005),
  ]);

  const out = buildAgnosticRouteOrdering({ adaptedBody: input });

  assert.equal(out.ordering.applied, true);
  assert.ok(out.ordering.reasons.includes("daypart_sequence_applied"));
  assert.ok(out.ordering.reasons.includes("proximity_within_daypart"));
  // coffee first (slot 0), then the nearer scenic, then the far one.
  assert.deepEqual(out.ordering.ordered_stop_ids, ["coffee", "s_near", "s_far"]);
});

test("a role order already in daypart sequence is preserved (no churn)", () => {
  const input = body([
    stop("b", "coffee_fika_stop", 41.9, 12.49),
    stop("c", "scenic_anchor", 41.901, 12.49),
    stop("a", "food_anchor", 41.902, 12.49),
  ]);

  const out = buildAgnosticRouteOrdering({ adaptedBody: input });

  assert.equal(out.ordering.applied, false);
  assert.equal(out.ordering.changed, false);
  assert.deepEqual(out.ordering.ordered_stop_ids, ["b", "c", "a"]);
  assert.ok(out.ordering.reasons.includes("candidate_role_order_already_daypart_coherent"));
});

test("ordering is deterministic across runs", () => {
  const make = () =>
    body([
      stop("a", "food_anchor", 0, 0),
      stop("b", "coffee_fika_stop", 0, 1),
      stop("c", "scenic_anchor", 0, -1),
    ]);

  const first = buildAgnosticRouteOrdering({ adaptedBody: make() });
  const second = buildAgnosticRouteOrdering({ adaptedBody: make() });

  assert.deepEqual(first.ordering.ordered_stop_ids, second.ordering.ordered_stop_ids);
  // coffee (slot 0) first, food (slot 2) last regardless of geometry.
  assert.equal(first.ordering.ordered_stop_ids[0], "b");
  assert.equal(first.ordering.ordered_stop_ids[2], "a");
});

test("small, incomplete, or duplicate candidate sets do not reorder", () => {
  const small = buildAgnosticRouteOrdering({
    adaptedBody: body([stop("a", "food_anchor", 41.9, 12.49), stop("b", "coffee_fika_stop", 41.901, 12.49)]),
  });
  assert.equal(small.ordering.applied, false);
  assert.ok(small.ordering.reasons.includes("stop_count_below_sequence_threshold"));

  const incomplete = buildAgnosticRouteOrdering({
    adaptedBody: body([
      stop("a", "food_anchor", 41.9, 12.49),
      { ...stop("b", "coffee_fika_stop", 41.901, 12.49), coordinates: null },
      stop("c", "scenic_anchor", 41.902, 12.49),
    ]),
  });
  assert.equal(incomplete.ordering.applied, false);
  assert.ok(incomplete.ordering.reasons.includes("incomplete_stable_candidate_coordinates"));

  const duplicate = buildAgnosticRouteOrdering({
    adaptedBody: body([
      stop("a", "food_anchor", 41.9, 12.49),
      stop("a", "coffee_fika_stop", 41.901, 12.49),
      stop("c", "scenic_anchor", 41.902, 12.49),
    ]),
  });
  assert.equal(duplicate.ordering.applied, false);
  assert.ok(duplicate.ordering.reasons.includes("duplicate_candidate_ids"));
});

test("daypartForRole maps roles onto an ordered morning→evening arc (#275)", () => {
  assert.equal(daypartForRole("coffee_fika_stop"), "morning");
  assert.equal(daypartForRole("scenic_anchor"), "midday");
  assert.equal(daypartForRole("culture_stop"), "midday"); // #277 daytime museum/gallery
  assert.equal(daypartForRole("market_stop"), "midday"); // #278 daytime market/flea market
  assert.equal(daypartForRole("green_walk_stop"), "midday");
  assert.equal(daypartForRole("food_anchor"), "afternoon");
  assert.equal(daypartForRole("evening_bar_option"), "evening");
  // unknown roles land in the neutral midday-ish slot, never crash
  assert.equal(daypartForRole("something_new"), "afternoon");
  assert.equal(daypartForRole(null), "afternoon");
});

test("timeBandRank is comparable for day bands and null for night/unknown (#275)", () => {
  assert.ok(timeBandRank("morning") < timeBandRank("midday"));
  assert.ok(timeBandRank("midday") < timeBandRank("afternoon"));
  assert.ok(timeBandRank("afternoon") < timeBandRank("evening"));
  assert.equal(timeBandRank("late"), null); // night → arc reads as the coming day
  assert.equal(timeBandRank("nonsense"), null);
});
