const assert = require("node:assert/strict");
const test = require("node:test");

const { buildAgnosticRouteOrdering } = require("../server/planner/agnostic-route-ordering");

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

test("proximity sequence reorders stable geocoded stops without mutating input", () => {
  const input = body([
    stop("a", "food_anchor", 41.9, 12.49),
    stop("c", "scenic_anchor", 41.92, 12.49),
    stop("b", "coffee_fika_stop", 41.901, 12.49),
  ]);

  const out = buildAgnosticRouteOrdering({ adaptedBody: input });

  assert.equal(out.ordering.applied, true);
  assert.equal(out.ordering.changed, true);
  assert.equal(out.ordering.source, "trusted_candidate_pool+role_order+proximity_sequence");
  assert.deepEqual(out.ordering.original_stop_ids, ["a", "c", "b"]);
  assert.deepEqual(out.ordering.ordered_stop_ids, ["a", "b", "c"]);
  assert.deepEqual(out.adaptedBody.stop_ids, ["a", "b", "c"]);
  assert.deepEqual(out.adaptedBody.target_roles, ["food_anchor", "coffee_fika_stop", "scenic_anchor"]);

  assert.deepEqual(input.stop_ids, ["a", "c", "b"], "input stop_ids unchanged");
  assert.deepEqual(input.stops.map((s) => s.candidate_id), ["a", "c", "b"], "input stops unchanged");
});

test("already-local candidate order is preserved", () => {
  const input = body([
    stop("a", "food_anchor", 41.9, 12.49),
    stop("b", "coffee_fika_stop", 41.901, 12.49),
    stop("c", "scenic_anchor", 41.902, 12.49),
  ]);

  const out = buildAgnosticRouteOrdering({ adaptedBody: input });

  assert.equal(out.ordering.applied, false);
  assert.equal(out.ordering.changed, false);
  assert.deepEqual(out.ordering.ordered_stop_ids, ["a", "b", "c"]);
  assert.ok(out.ordering.reasons.includes("candidate_role_order_already_local"));
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
