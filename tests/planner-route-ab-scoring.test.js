/**
 * #254 flag-gated A/B route-scoring experiment.
 *
 * Diagnostic only: compares the existing primary route output against the
 * candidate-combination adapter without mutating default route output or
 * claiming the adapted candidate is a real route.
 */

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  buildRouteAbScoringInspect,
} = require("../server/planner/route-ab-scoring");

const {
  compareInspectVsDefault,
  routeBody,
  primaryRouteShape,
} = require("./helpers/planner-reservoir-compare");

function route(stopIds, over = {}) {
  return {
    id: over.id || "primary-route-1",
    title: "Primary route",
    main_stops: stopIds.map((id) => ({ id })),
    why_recommended: ["Matches your preferences"],
    trust_summary: { source_tiers: ["curated"], confidence: "high", human_verified: true, freshness: "fresh" },
    ...over,
  };
}

function adapter(over = {}) {
  return {
    status: "available",
    source: "candidate_combination",
    experimental: true,
    candidate: {
      id: "cc-adapter:rome:a+b",
      experimental: true,
      label: "Candidate-combination adapter (diagnostic, not a route)",
      stop_ids: ["a", "b"],
      target_roles: ["scenic_anchor", "food_anchor"],
      unresolved_roles: [],
      duplicate_role_coverage: [],
      geometry_summary: { coherence: "ok", candidate_count: 2, geocoded_count: 2 },
      trust_summary: { curated_count: 2, external_count: 0, low_confidence_count: 0 },
      quality_flags: [],
    },
    comparison_to_primary_route: {
      primary_route_id: "primary-route-1",
      primary_stop_ids: ["x", "y"],
      adapted_stop_ids: ["a", "b"],
      matched_stop_ids: [],
      overlap_count: 0,
      overlap_ratio: 0,
      reasons: ["adapted_stops_outside_primary", "primary_stops_outside_adapted"],
    },
    scoring_probe: {
      comparable: true,
      blockers: [],
      positive_signals: ["target_roles_covered", "stable_ids_present", "geometry_ok", "curated_candidates"],
      negative_signals: ["zero_primary_overlap"],
      recommendation: "candidate_for_ab_route_scoring",
    },
    ...over,
  };
}

test("scores baseline primary route and candidate adapter without mutating inputs", () => {
  const primary = route(["x", "y"]);
  const candidateAdapter = adapter();
  const before = JSON.stringify({ primary, candidateAdapter });

  const out = buildRouteAbScoringInspect({ city: "rome", primaryRoute: primary, routeCandidateAdapter: candidateAdapter });

  assert.equal(JSON.stringify({ primary, candidateAdapter }), before);
  assert.equal(out.status, "scored");
  assert.equal(out.experimental, true);
  assert.equal(out.route_mutation, false);
  assert.equal(out.variants.baseline_primary.kind, "current_primary_route");
  assert.equal(out.variants.candidate_combination_adapter.kind, "candidate_combination_adapter");
  assert.deepEqual(out.variants.baseline_primary.stop_ids, ["x", "y"]);
  assert.deepEqual(out.variants.candidate_combination_adapter.stop_ids, ["a", "b"]);
});

test("candidate adapter is eligible only when the prior adapter probe recommended A/B scoring", () => {
  const out = buildRouteAbScoringInspect({ city: "rome", primaryRoute: route(["x", "y"]), routeCandidateAdapter: adapter() });
  assert.equal(out.variants.candidate_combination_adapter.eligibility, "eligible_for_ab_scoring");
  assert.ok(out.variants.candidate_combination_adapter.signals.includes("probe:candidate_for_ab_route_scoring"));
  assert.equal(out.decision.mode, "diagnostic_ab_score_only");
  assert.equal(out.decision.selected_variant, "baseline_primary");
});

test("candidate adapter is blocked when geometry/probe blockers are present", () => {
  const out = buildRouteAbScoringInspect({
    city: "rome",
    primaryRoute: route(["x", "y"]),
    routeCandidateAdapter: adapter({
      scoring_probe: {
        comparable: true,
        blockers: ["missing_coordinates"],
        positive_signals: ["target_roles_covered"],
        negative_signals: ["incomplete_coordinates"],
        recommendation: "needs_geometry_validation",
      },
    }),
  });
  assert.equal(out.variants.candidate_combination_adapter.eligibility, "blocked");
  assert.ok(out.variants.candidate_combination_adapter.blockers.includes("probe:missing_coordinates"));
  assert.ok(out.decision.reasons.includes("candidate_not_eligible"));
});

test("never claims walking time or promotes the adapter to a route", () => {
  const out = buildRouteAbScoringInspect({ city: "rome", primaryRoute: route(["x", "y"]), routeCandidateAdapter: adapter() });
  const json = JSON.stringify(out);
  for (const banned of ["walking_time", "travel_time", "eta", "duration_min", "minutes"]) {
    assert.ok(!json.includes(banned), `must not claim ${banned}`);
  }
  assert.equal(out.variants.candidate_combination_adapter.route_claim, false);
});

const AB = "planner_inspect=1&inspect_route_ab_scoring=1";

test("default route output omits A/B scoring sidecar", async () => {
  const { def } = await compareInspectVsDefault({ body: routeBody("rome", ["scenic", "food"]), query: AB });
  assert.equal(def.route_ab_scoring, undefined);
});

test("A/B scoring flag attaches only the scoring sidecar and leaves route output unchanged", async () => {
  const { def, inspected } = await compareInspectVsDefault({ body: routeBody("rome", ["scenic", "food"]), query: AB });
  assert.deepEqual(primaryRouteShape(inspected), primaryRouteShape(def));
  assert.ok(inspected.route_ab_scoring, "flag should attach route_ab_scoring");
  assert.equal(inspected.route_ab_scoring.experimental, true);
  assert.equal(inspected.route_ab_scoring.route_mutation, false);
  assert.equal(inspected.route_candidate_adapter, undefined, "A/B flag should not leak the lower-level adapter sidecar by default");
  assert.equal(inspected.candidate_combination, undefined, "A/B flag should not leak candidate_combination by default");
});

test("public payload cannot inject A/B score, adapter candidate, or selected variant", async () => {
  const { inspected } = await compareInspectVsDefault({
    body: routeBody("rome", ["scenic", "food"], {
      route_ab_scoring: { decision: { selected_variant: "payload_candidate" } },
      route_candidate_adapter: { candidate: { stop_ids: ["payload-injected-stop"] } },
      candidate_combination: { selected: [{ candidate_id: "payload-injected-stop" }] },
    }),
    query: AB,
  });
  assert.equal(inspected.route_ab_scoring.decision.selected_variant, "baseline_primary");
  assert.ok(!inspected.route_ab_scoring.variants.candidate_combination_adapter.stop_ids.includes("payload-injected-stop"));
});
