const assert = require("node:assert/strict");
const test = require("node:test");

const {
  compareCandidateCombinationToRoute,
} = require("../server/planner/candidate-combination-inspect");
const {
  compareInspectVsDefault,
  routeBody,
  primaryRouteShape,
} = require("./helpers/planner-reservoir-compare");

test("default route output omits candidate combination inspect data", async () => {
  const { def } = await compareInspectVsDefault({
    body: routeBody("athens", ["scenic", "food"]),
    query: "planner_inspect=1",
  });

  assert.equal(def.candidate_combination, undefined);
  assert.equal(def.planner_roles, undefined);
  assert.equal(def.dayflow_honesty, undefined);
});

test("candidate combination inspect flag exposes diagnostic sidecar", async () => {
  const { inspected } = await compareInspectVsDefault({
    body: routeBody("athens", ["scenic", "food"]),
    query: "planner_inspect=1&inspect_candidate_combination=1",
  });

  assert.ok(inspected.planner_roles);
  assert.ok(inspected.dayflow_honesty);
  assert.ok(inspected.candidate_combination);
  assert.equal(typeof inspected.candidate_combination.status, "string");
  assert.ok(Array.isArray(inspected.candidate_combination.selected));
  assert.ok(inspected.candidate_combination.geometry_summary);
  assert.ok(inspected.candidate_combination.comparison_to_route);
  assert.equal(inspected.candidate_combination.comparison_to_route.order_sensitive, false);
});

test("comma inspect flag can request planner roles and candidate combination together", async () => {
  const { inspected } = await compareInspectVsDefault({
    body: routeBody("rome", ["scenic", "food"]),
    query: "inspect=planner_roles,candidate_combination",
  });

  assert.ok(inspected.planner_roles);
  assert.ok(inspected.dayflow_honesty);
  assert.ok(inspected.candidate_combination);
});

test("candidate combination inspect does not mutate route identity, stops, or order", async () => {
  const { def, inspected } = await compareInspectVsDefault({
    body: routeBody("barcelona", ["second_hand", "food"]),
    query: "planner_inspect=1&inspect_candidate_combination=1",
  });

  assert.deepEqual(primaryRouteShape(inspected), primaryRouteShape(def));
});

test("candidate combination comparison reports deterministic route mismatch", async () => {
  const { inspected } = await compareInspectVsDefault({
    body: routeBody("rome", ["scenic", "food"]),
    query: "planner_inspect=1&inspect_candidate_combination=1",
  });
  const comparison = inspected.candidate_combination.comparison_to_route;

  assert.ok(Array.isArray(comparison.matched_stop_ids));
  assert.ok(comparison.candidate_not_in_route.length > 0);
  assert.ok(comparison.route_stop_not_in_candidate_set.length > 0);
  assert.ok(comparison.reasons.includes("selected_candidates_outside_route"));
  assert.ok(comparison.reasons.includes("route_has_stops_outside_candidate_set"));
});

test("public candidate_combination payload does not inject selected candidates", async () => {
  const { inspected } = await compareInspectVsDefault({
    body: routeBody("athens", ["swimming"], {
      candidate_combination: {
        selected: [{ candidate_id: "payload-injected-beach" }],
      },
      external_provider: {
        dataset: [{ id: "payload-injected-beach", name: "Payload Beach" }],
      },
      openDataLoader: [{ id: "payload-injected-beach" }],
    }),
    query: "planner_inspect=1&inspect_candidate_combination=1&include_external_candidates=1",
  });

  const selectedIds = inspected.candidate_combination.selected.map((candidate) => candidate.candidate_id);
  assert.equal(selectedIds.includes("payload-injected-beach"), false);
  assert.ok(inspected.planner_roles.source_status.some((status) => status.status === "no_loader_configured"));
});

test("comparison detects stable id overlap without fuzzy matching", () => {
  const comparison = compareCandidateCombinationToRoute(
    {
      selected: [
        { candidate_id: "shared-stop", label: "Shared Stop" },
        { candidate_id: "candidate-only", label: "Candidate Only" },
      ],
    },
    {
      main_stops: [
        { id: "shared-stop", label: "Shared Stop" },
        { id: "route-only", label: "Route Only" },
      ],
    },
  );

  assert.deepEqual(comparison.matched_stop_ids, ["shared-stop"]);
  assert.deepEqual(comparison.candidate_not_in_route, ["candidate-only"]);
  assert.deepEqual(comparison.route_stop_not_in_candidate_set, ["route-only"]);
  assert.equal(comparison.order_sensitive, false);
});

test("comparison reports missing ids and never fabricates a proximity/name match", () => {
  const comparison = compareCandidateCombinationToRoute(
    {
      selected: [
        { label: "Same Name", coordinates: { lat: 41.9, lng: 12.5 } },
      ],
    },
    {
      main_stops: [
        { label: "Same Name", coordinates: { lat: 41.9, lng: 12.5 } },
      ],
    },
  );

  assert.deepEqual(comparison.matched_stop_ids, []);
  assert.ok(comparison.reasons.includes("candidate_ids_missing"));
  assert.ok(comparison.reasons.includes("route_stop_ids_missing"));
});

test("malformed planner roles fail safely when combination inspect is requested", async () => {
  const comparison = compareCandidateCombinationToRoute(null, { main_stops: [{ id: "route-stop" }] });

  assert.deepEqual(comparison.matched_stop_ids, []);
  assert.deepEqual(comparison.route_stop_not_in_candidate_set, ["route-stop"]);
  assert.ok(comparison.reasons.includes("no_selected_candidates"));
});
