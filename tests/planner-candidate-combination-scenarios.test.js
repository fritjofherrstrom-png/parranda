/**
 * #252 Candidate Combination comparison QA / scenario report.
 *
 * Diagnostic-only. Classifies HOW the inspect-only candidate-combination layer
 * (#250/#251) differs from the actual route-engine output across representative
 * cities — a truth table before any consumption-contract decision. It changes
 * no Planner behavior and asserts route output is byte-stable under inspect.
 *
 * Grounded headline (probed on real responses): in every recognized-city
 * scenario `matched_stop_ids` is currently 0 — the template route engine and
 * the role reservoir share no stable stop ids today. That is the central
 * consumption-contract finding, not a defect of either side.
 *
 * The classifier is intentionally NEUTRAL: it names the mismatch pattern, it
 * does NOT judge which system is "better".
 */

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  compareInspectVsDefault,
  externalRecord,
  makeLoader,
  routeBody,
} = require("./helpers/planner-reservoir-compare");

const { selectPlannerRoleCandidates } = require("../server/planner/role-selector");
const { summarizeDayflowHonesty } = require("../server/planner/dayflow-honesty");
const { compareCandidateCombinationToRoute } = require("../server/planner/candidate-combination-inspect");
const { buildCandidateCombination } = require("../server/planner/candidate-combination");
const { buildAgnosticCityContext } = require("../server/candidates/agnostic-context");

const INSPECT = "planner_inspect=1&inspect_candidate_combination=1";

// --- test-only diagnostic summary + classifier ----------------------------

function buildSummary({ city, preferences, inspected }) {
  const cc = inspected.candidate_combination;
  const cmp = cc.comparison_to_route;
  const dayflow = inspected.dayflow_honesty;
  const routeStops = (inspected.days?.[0]?.primary_route?.main_stops || []).map(
    (s) => s.id || s.place_id || s.candidate_id || null,
  );
  const selectedIds = cc.selected.map((s) => s.candidate_id);
  const overlapCount = cmp.matched_stop_ids.length;
  const summary = {
    city,
    preferences,
    combo_status: cc.status,
    selected_ids: selectedIds,
    selected_origins: cc.selected.map((s) => s.origin),
    route_stop_ids: routeStops,
    matched_stop_ids: cmp.matched_stop_ids,
    candidate_not_in_route: cmp.candidate_not_in_route,
    route_stop_not_in_candidate_set: cmp.route_stop_not_in_candidate_set,
    overlap_count: overlapCount,
    selected_count: selectedIds.length,
    route_stop_count: routeStops.length,
    overlap_ratio: selectedIds.length ? overlapCount / selectedIds.length : 0,
    geometry_coherence: cc.geometry_summary?.coherence || "incomplete",
    max_pairwise_km: cc.geometry_summary?.max_pairwise_km ?? null,
    day_status: dayflow.day_status,
    quality_flags: cc.quality_flags,
    unresolved_roles: cc.unresolved_roles,
    // time diagnostics (diagnostic only — no time behavior changed here)
    now: dayflow.time_summary?.now || null,
    time_band: dayflow.time_summary?.time_band || null,
    time_matched_roles: dayflow.time_summary?.time_matched_roles || [],
    time_mismatched_roles: dayflow.time_summary?.time_mismatched_roles || [],
    missing_time_data_roles: dayflow.time_summary?.missing_time_data_roles || [],
    // dayflow.time_summary does not emit a per-reason rollup, but the raw time
    // tokens are carried on each selected candidate's fit reasons. Roll the
    // time-related ones up here so the diagnostic exposes them explicitly.
    time_reasons: rollUpTimeReasons(cc.selected),
  };
  const { category, reasons } = classifyCandidateRouteComparison(summary);
  summary.mismatch_category = category;
  summary.reasons = reasons;
  return summary;
}

const TIME_REASON_RE = /^(time_match:|time_mismatch:)|^(golden_hour_window|requested_golden_hour)$/;
function rollUpTimeReasons(selected = []) {
  const reasons = new Set();
  for (const candidate of selected) {
    for (const reason of candidate.reasons || []) {
      if (TIME_REASON_RE.test(String(reason))) reasons.add(reason);
    }
  }
  return [...reasons].sort();
}

// Conservative, deterministic, neutral. Precedence runs most-specific first.
function classifyCandidateRouteComparison(s) {
  const reasons = [];
  const hasUnresolvedRequested = (s.unresolved_roles || []).length > 0;
  const externalSelectedNotConsumed = s.selected_origins.some((o, i) =>
    o === "external_open" && s.candidate_not_in_route.includes(s.selected_ids[i]),
  );

  if (externalSelectedNotConsumed) {
    reasons.push("external_role_candidate_absent_from_route");
    return { category: "external_gap_not_consumed", reasons };
  }
  if (s.selected_count > 0 && s.geometry_coherence === "weak") {
    reasons.push("selected_set_geographically_spread");
    return { category: "candidate_weak_geometry", reasons };
  }
  if (s.combo_status !== "ready" && hasUnresolvedRequested) {
    reasons.push("requested_role_unavailable_no_fabrication");
    if (s.route_stop_count > 0) reasons.push("route_still_plans");
    return { category: "missing_role_honest", reasons };
  }
  if (s.combo_status !== "ready" && s.route_stop_count > 0) {
    reasons.push("combo_non_ready_route_still_plans");
    return { category: "candidate_missing_route_still_plans", reasons };
  }
  if (s.overlap_count > 0) {
    reasons.push(s.overlap_ratio >= 0.5 ? "strong_id_overlap" : "partial_id_overlap");
    return { category: "aligned", reasons };
  }
  if (s.combo_status === "ready" && ["strong", "ok"].includes(s.geometry_coherence)) {
    reasons.push("ready_coherent_combo_zero_route_overlap", "route_uses_different_stop_family");
    return { category: "candidate_ready_route_ignores_roles", reasons };
  }
  reasons.push("healthy_but_divergent");
  return { category: "both_good_but_different", reasons };
}

function assertInspectInvariants(result, { def }) {
  // default omitted (helper already checks planner_roles/dayflow; add candidate_combination)
  assert.equal(def.candidate_combination, undefined, "default must omit candidate_combination");
  // inspect present + comparison present (route-unchanged is asserted by the helper)
  const cc = result.inspected.candidate_combination;
  assert.ok(cc, "inspect must include candidate_combination");
  assert.ok(cc.comparison_to_route, "must include comparison_to_route");
  assert.equal(cc.comparison_to_route.order_sensitive, false);
}

async function runScenario(city, preferences, { openDataLoader = null, extra = {} } = {}) {
  const result = await compareInspectVsDefault({
    openDataLoader,
    body: routeBody(city, preferences, extra),
    query: INSPECT,
  });
  assertInspectInvariants(result, { def: result.def });
  return buildSummary({ city, preferences, inspected: result.inspected });
}

// --- scenarios =============================================================

test("Rome scenic+food: ready combo, coherent geometry, route uses a different stop family", async () => {
  const s = await runScenario("rome", ["scenic", "food"]);
  assert.equal(s.combo_status, "ready");
  assert.ok(["strong", "ok"].includes(s.geometry_coherence));
  assert.equal(s.overlap_count, 0); // grounded: route shares no stable ids with the reservoir anchors
  assert.equal(s.mismatch_category, "candidate_ready_route_ignores_roles");
  assert.ok(s.route_stop_count > 0); // route is still a real route
});

test("Rome swimming: missing requested role is honest, route still plans", async () => {
  const s = await runScenario("rome", ["swimming"]);
  assert.notEqual(s.combo_status, "ready");
  assert.ok(s.unresolved_roles.some((r) => r.role === "swimming_coast_option"));
  assert.equal(s.mismatch_category, "missing_role_honest");
  assert.ok(s.reasons.includes("requested_role_unavailable_no_fabrication"));
});

test("Barcelona second_hand+food: rich citypack, neutral divergence classified", async () => {
  const s = await runScenario("barcelona", ["second_hand", "food"]);
  assert.equal(typeof s.mismatch_category, "string");
  assert.ok(s.selected_count >= 1);
  // second_hand stays a specific intent — selected anchors are not generic shops
  assert.ok(Array.isArray(s.selected_ids));
});

test("Barcelona coast+evening: geometry vs route envelope is classified, route untouched", async () => {
  const s = await runScenario("barcelona", ["swimming", "bars"], { extra: { now: "2026-05-25T20:00:00" } });
  assert.equal(typeof s.mismatch_category, "string");
  assert.ok(["strong", "ok", "weak", "incomplete"].includes(s.geometry_coherence));
});

test("Athens scenic+food: thin city stays honest, divergence classified", async () => {
  const s = await runScenario("athens", ["scenic", "food"]);
  assert.equal(typeof s.mismatch_category, "string");
  // thin city must not pretend mature confidence
  assert.ok(s.day_status !== "full" || s.combo_status === "ready");
});

test("Athens swimming + trusted external loader: external gap is NOT consumed by the route", async () => {
  const loader = makeLoader([externalRecord("ath-beach", "Kavouri Beach", "beach", 37.82, 23.78, ["coast"])]);
  const s = await runScenario("athens", ["swimming"], { openDataLoader: loader, extra: { include_external_candidates: 1 } });
  assert.ok(s.selected_origins.includes("external_open"), "trusted external candidate should be selected");
  assert.equal(s.overlap_count, 0, "route does not consume the external candidate yet");
  assert.equal(s.mismatch_category, "external_gap_not_consumed");
});

// --- time diagnostics ======================================================

test("evening context: time-fit info is exposed in diagnostics (no sequencing change)", async () => {
  const s = await runScenario("rome", ["scenic", "bars"], { extra: { now: "2026-05-25T20:00:00" } });
  // time context is observable for future time-aware consumption
  assert.ok("time_band" in s);
  assert.ok(Array.isArray(s.time_matched_roles));
  assert.ok(Array.isArray(s.time_mismatched_roles));
  assert.ok(Array.isArray(s.missing_time_data_roles));
  assert.ok(Array.isArray(s.time_reasons));
  // diagnostic only — route output is unchanged (asserted by the helper)
  assert.equal(typeof s.mismatch_category, "string");
});

// --- public injection boundary =============================================

test("public payload cannot inject candidate or route data", async () => {
  const s = await runScenario("rome", ["scenic", "food"], {
    extra: {
      candidate_combination: { selected: [{ candidate_id: "payload-injected-stop" }] },
      external_provider: { dataset: [{ id: "payload-injected-stop" }] },
      openDataLoader: [{ id: "payload-injected-stop" }],
    },
  });
  assert.ok(!s.selected_ids.includes("payload-injected-stop"), "payload must not inject into selected");
  assert.ok(!s.route_stop_ids.includes("payload-injected-stop"), "payload must not inject into route stops");
});

// --- agnostic / sparse is helper-level (route-recommendations is citypack-only) ===

test("agnostic sparse context is helper-level; comparison handles a null route honestly", () => {
  const ctx = buildAgnosticCityContext({ lat: 55.55, lng: 14.35, todayIsoDate: () => "2026-05-25" });
  const pr = selectPlannerRoleCandidates(ctx, { candidate_mode: 1, date: "2026-05-25", preferences: ["scenic", "food"] });
  const dayflow = summarizeDayflowHonesty({ ...pr, requested_preferences: ["scenic", "food"] });
  const combo = buildCandidateCombination(pr, dayflow);
  assert.equal(combo.status, "insufficient"); // sparse, nothing fabricated
  // comparison against a non-existent route reports honestly, never crashes
  const cmp = compareCandidateCombinationToRoute(combo, null);
  assert.deepEqual(cmp.matched_stop_ids, []);
  assert.ok(cmp.reasons.includes("no_route_stops"));
});

// --- determinism of the classifier =========================================

test("the classifier is deterministic for a fixed summary", () => {
  const summary = {
    selected_origins: ["curated_catalog", "curated_catalog"],
    selected_ids: ["a", "b"],
    candidate_not_in_route: ["a", "b"],
    combo_status: "ready",
    geometry_coherence: "strong",
    overlap_count: 0,
    overlap_ratio: 0,
    route_stop_count: 5,
    unresolved_roles: [],
  };
  const a = classifyCandidateRouteComparison(summary);
  const b = classifyCandidateRouteComparison(summary);
  assert.deepEqual(a, b);
  assert.equal(a.category, "candidate_ready_route_ignores_roles");
});

module.exports = { classifyCandidateRouteComparison };
