/**
 * #253 route-candidate adapter experiment — unit + inspect/scenario tests.
 *
 * The adapter is DIAGNOSTIC only: it must never mutate inputs, claim walking
 * time, call itself a route, or change default Planner output.
 */

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  buildRouteCandidateAdapterInspect,
  buildRouteCandidateFromCandidateCombination,
  compareAdaptedCandidateToPrimaryRoute,
} = require("../server/planner/candidate-combination-route-adapter");

const {
  compareInspectVsDefault,
  externalRecord,
  makeLoader,
  routeBody,
} = require("./helpers/planner-reservoir-compare");

// --- fixtures (mirror #250/#251 candidate_combination shape) ---------------

function sel(role, id, over = {}) {
  return {
    role,
    candidate_id: id,
    label: over.label || id,
    candidate_status: over.candidate_status || "filled",
    planner_usable: over.planner_usable ?? true,
    origin: over.origin || "curated_catalog",
    confidence: over.confidence || "high",
    coordinates: "coordinates" in over ? over.coordinates : { lat: 41.9, lng: 12.49 },
    also_covers: over.also_covers || [],
    reasons: over.reasons || ["covers:scenic"],
  };
}

function combo(over = {}) {
  return {
    status: over.status || "ready",
    selected: over.selected || [sel("scenic_anchor", "v1"), sel("food_anchor", "r1", { coordinates: { lat: 41.901, lng: 12.491 } })],
    unresolved_roles: over.unresolved_roles || [],
    duplicate_role_coverage: over.duplicate_role_coverage || [],
    geometry_summary: over.geometry_summary || { coherence: "ok", max_pairwise_km: 0.5, candidate_count: 2, geocoded_count: 2 },
    quality_flags: over.quality_flags || [],
    reasons: over.reasons || ["status:ready"],
  };
}

function route(stopIds) {
  return { id: "primary-route-1", main_stops: stopIds.map((id) => ({ id })) };
}

function adapt(c, r, city = "rome") {
  return buildRouteCandidateAdapterInspect({ city, candidateCombination: c, route: r, context: {} });
}

// --- unit ------------------------------------------------------------------

test("1. builds an adapted candidate from a ready combination", () => {
  const out = adapt(combo(), route(["x", "y"]));
  assert.equal(out.status, "available");
  assert.equal(out.source, "candidate_combination");
  assert.equal(out.candidate.stops.length, 2);
});

test("2. preserves selected stable ids", () => {
  const out = adapt(combo(), route(["x"]));
  assert.deepEqual(out.candidate.stop_ids, ["v1", "r1"]);
});

test("3. preserves role mapping", () => {
  const out = adapt(combo(), route(["x"]));
  assert.deepEqual(out.candidate.target_roles, ["scenic_anchor", "food_anchor"]);
});

test("4. preserves unresolved roles", () => {
  const out = adapt(combo({ status: "partial", unresolved_roles: [{ role: "food_anchor", reason: "no_candidate" }], selected: [sel("scenic_anchor", "v1")] }), route(["x"]));
  assert.deepEqual(out.candidate.unresolved_roles, [{ role: "food_anchor", reason: "no_candidate" }]);
});

test("5. preserves geometry summary", () => {
  const g = { coherence: "strong", max_pairwise_km: 0.3, candidate_count: 2, geocoded_count: 2 };
  const out = adapt(combo({ geometry_summary: g }), route(["x"]));
  assert.deepEqual(out.candidate.geometry_summary, g);
});

test("6. marks output as experimental / diagnostic", () => {
  const out = adapt(combo(), route(["x"]));
  assert.equal(out.experimental, true);
  assert.equal(out.candidate.experimental, true);
  assert.equal(out.candidate.order_confidence, "diagnostic_only");
  assert.equal(out.candidate.order_source, "role_order");
});

test("7. produces no walking-time / eta claims", () => {
  const out = adapt(combo(), route(["x"]));
  const json = JSON.stringify(out);
  for (const banned of ["walking_time", "travel_time", "eta", "duration_min", "minutes"]) {
    assert.ok(!json.includes(banned), `must not claim ${banned}`);
  }
});

test("8. never calls itself a route / day plan", () => {
  const out = adapt(combo(), route(["x"]));
  assert.match(out.candidate.label, /diagnostic/i);
  assert.ok(!/itinerary|day plan|day_plan/i.test(out.candidate.label));
  // status vocabulary is adapter-specific, not "route"
  assert.ok(["available", "partial", "unavailable"].includes(out.status));
});

test("9. does not mutate input objects", () => {
  const c = combo();
  const r = route(["x", "y"]);
  const snapC = JSON.stringify(c);
  const snapR = JSON.stringify(r);
  adapt(c, r);
  assert.equal(JSON.stringify(c), snapC);
  assert.equal(JSON.stringify(r), snapR);
});

test("10. missing coordinates → incomplete geometry, not route-ready", () => {
  const out = adapt(
    combo({
      selected: [sel("scenic_anchor", "v1"), sel("food_anchor", "r1", { coordinates: null })],
      geometry_summary: { coherence: "incomplete", max_pairwise_km: 0, candidate_count: 2, geocoded_count: 1 },
    }),
    route(["x"]),
  );
  assert.ok(out.scoring_probe.blockers.includes("missing_coordinates"));
  assert.equal(out.scoring_probe.recommendation, "needs_geometry_validation");
});

test("11. duplicate role coverage is flagged conservatively", () => {
  const dup = sel("scenic_anchor", "rooftop");
  const out = adapt(
    combo({
      selected: [dup, { ...dup, role: "evening_bar_option" }],
      duplicate_role_coverage: [{ candidate_id: "rooftop", roles: ["scenic_anchor", "evening_bar_option"] }],
    }),
    route(["x"]),
  );
  assert.ok(out.scoring_probe.blockers.includes("duplicate_role_coverage"));
  assert.ok(out.scoring_probe.negative_signals.includes("single_candidate_multi_role"));
});

test("12. empty selected → unavailable", () => {
  const out = adapt(combo({ status: "insufficient", selected: [] }), route(["x"]));
  assert.equal(out.status, "unavailable");
  assert.equal(out.candidate.stop_ids.length, 0);
  assert.equal(out.scoring_probe.recommendation, "not_route_ready");
});

test("compare: external gap-fill not consumed by route is detected", () => {
  const c = combo({ selected: [sel("swimming_coast_option", "ext-beach", { origin: "external_open" })] });
  const out = adapt(c, route(["garbatella", "testaccio"]));
  assert.equal(out.comparison_to_primary_route.overlap_count, 0);
  assert.ok(out.scoring_probe.positive_signals.includes("trusted_external_gap_fill"));
  assert.ok(out.scoring_probe.negative_signals.includes("external_not_consumed"));
});

test("compare: a null route reports honestly without crashing", () => {
  const cmp = compareAdaptedCandidateToPrimaryRoute({ adaptedCandidate: buildRouteCandidateFromCandidateCombination({ city: "x", candidateCombination: combo() }), route: null });
  assert.deepEqual(cmp.matched_stop_ids, []);
  assert.ok(cmp.reasons.includes("no_primary_route"));
});

test("agnostic coordinate-only context: adapter can represent trusted external candidates without a route", () => {
  const out = buildRouteCandidateAdapterInspect({
    city: "agnostic",
    candidateCombination: combo({
      selected: [
        sel("food_anchor", "osm-malmo-food-1", {
          label: "Agnostic food candidate",
          origin: "external_open",
          confidence: "medium",
          coordinates: { lat: 55.605, lng: 13.003 },
        }),
      ],
      geometry_summary: {
        coherence: "ok",
        max_pairwise_km: 0,
        candidate_count: 1,
        geocoded_count: 1,
      },
      quality_flags: ["source_backed_only"],
    }),
    route: null,
    context: { origin: { lat: 55.605, lng: 13.003 } },
  });

  assert.equal(out.status, "available");
  assert.deepEqual(out.candidate.stop_ids, ["osm-malmo-food-1"]);
  assert.equal(out.candidate.stops[0].origin, "external_open");
  assert.equal(out.comparison_to_primary_route.primary_route_id, null);
  assert.ok(out.comparison_to_primary_route.reasons.includes("no_primary_route"));
  assert.equal(out.scoring_probe.comparable, false);
  assert.ok(out.scoring_probe.blockers.includes("no_primary_route"));
});

test("determinism: same input → same adapter output", () => {
  const c = combo();
  const r = route(["x", "y"]);
  assert.deepEqual(adapt(c, r), adapt(c, r));
});

// --- API / inspect ---------------------------------------------------------

const ADAPTER = "planner_inspect=1&inspect_route_candidate_adapter=1";

test("default route output omits all inspect sidecars including the adapter", async () => {
  const { def } = await compareInspectVsDefault({ body: routeBody("rome", ["scenic", "food"]), query: ADAPTER });
  assert.equal(def.planner_roles, undefined);
  assert.equal(def.dayflow_honesty, undefined);
  assert.equal(def.candidate_combination, undefined);
  assert.equal(def.route_candidate_adapter, undefined);
});

test("adapter flag attaches the experimental adapter (route unchanged)", async () => {
  const { inspected } = await compareInspectVsDefault({ body: routeBody("rome", ["scenic", "food"]), query: ADAPTER });
  const rca = inspected.route_candidate_adapter;
  assert.ok(rca, "adapter present under flag");
  assert.equal(rca.experimental, true);
  assert.ok(rca.comparison_to_primary_route);
  assert.ok(rca.scoring_probe);
  // adapter flag alone does not leak candidate_combination
  assert.equal(inspected.candidate_combination, undefined);
});

test("Rome scenic+food: adapter available, zero primary overlap, A/B-scoring candidate", async () => {
  const { inspected } = await compareInspectVsDefault({ body: routeBody("rome", ["scenic", "food"]), query: ADAPTER });
  const rca = inspected.route_candidate_adapter;
  assert.equal(rca.status, "available");
  assert.equal(rca.comparison_to_primary_route.overlap_count, 0);
  assert.equal(rca.scoring_probe.recommendation, "candidate_for_ab_route_scoring");
});

test("Rome swimming: adapter unavailable, not route-ready, route still plans", async () => {
  const { inspected } = await compareInspectVsDefault({ body: routeBody("rome", ["swimming"]), query: ADAPTER });
  const rca = inspected.route_candidate_adapter;
  assert.equal(rca.status, "unavailable");
  assert.equal(rca.scoring_probe.recommendation, "not_route_ready");
  assert.ok(inspected.days?.[0]?.primary_route, "route still produced");
});

test("Athens swimming + trusted external loader: adapter shows the gap is now consumed by the preview route", async () => {
  // Evolved by feat/athens-preview-planner-preference-driven: the source-backed
  // swimming beach now composes into primary_route (preview preference-driven
  // composition), so the adapter observes OVERLAP with the route — the candidate
  // is already consumed, not an open gap to forward to A/B scoring. The adapter
  // stays strictly diagnostic; it just reports a different, honest state.
  const loader = makeLoader([externalRecord("ath-beach", "Kavouri Beach", "beach", 37.82, 23.78, ["coast"])]);
  const { inspected } = await compareInspectVsDefault({
    openDataLoader: loader,
    body: routeBody("athens", ["swimming"], { include_external_candidates: 1 }),
    query: `${ADAPTER}&include_external_candidates=1`,
  });
  const rca = inspected.route_candidate_adapter;
  assert.ok(rca.candidate.stops.some((s) => s.origin === "external_open"));
  assert.equal(rca.comparison_to_primary_route.overlap_count, 1);
  assert.ok(rca.scoring_probe.positive_signals.includes("target_roles_covered"));
  assert.equal(rca.scoring_probe.recommendation, "inspect_only");
});

test("public payload cannot inject adapter / candidate / route data", async () => {
  const { inspected } = await compareInspectVsDefault({
    body: routeBody("rome", ["scenic", "food"], {
      route_candidate_adapter: { candidate: { stop_ids: ["payload-injected-stop"] } },
      candidate_combination: { selected: [{ candidate_id: "payload-injected-stop" }] },
      external_provider: { dataset: [{ id: "payload-injected-stop" }] },
      openDataLoader: [{ id: "payload-injected-stop" }],
    }),
    query: ADAPTER,
  });
  const rca = inspected.route_candidate_adapter;
  assert.ok(!rca.candidate.stop_ids.includes("payload-injected-stop"));
  const routeIds = (inspected.days?.[0]?.primary_route?.main_stops || []).map((s) => s.id);
  assert.ok(!routeIds.includes("payload-injected-stop"));
});
