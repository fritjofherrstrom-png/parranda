/**
 * The any-place alpha honesty classifier. Asserts the STATUS enum and the gated
 * DATA (safe `days` length), never user-facing copy — so a fallback baseline city
 * day can never be shown as the typed place's success.
 */

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  classifyAnywhereResult,
  isComposedStatus,
  safeResponseFor,
  shouldRetryTransientSource,
} = require("../anywhere-render-decision");

const agnosticStructure = (areaCount = 2) => ({
  provenance: "agnostic_anchor",
  area_count: areaCount,
  district_day: { areas: [{ stop_ids: ["a", "b"] }], legs: [], covered_intents: ["food"], missing_intents: [] },
});

test("a replaced agnostic day → composed (and the day survives the data gate)", () => {
  const res = { days: [{ experimental_agnostic_route_applied: true, primary_route: {} }], place_structure: agnosticStructure() };
  const cls = classifyAnywhereResult(res, { place: "Genoa" });
  assert.equal(cls.status, "composed");
  assert.equal(safeResponseFor(res, cls).days.length, 1, "composed keeps the day");
});

test("a synthesized agnostic day (markers) → composed", () => {
  const res = {
    days: [{ experimental_agnostic_day: true, source: "agnostic_route_output_experiment" }],
    place_structure: agnosticStructure(1),
  };
  assert.equal(classifyAnywhereResult(res, { place: "Nantes" }).status, "composed");
});

test("agnostic structure but no composed day → structure_only, and days are emptied", () => {
  const res = { days: [{ date: "2026-06-23", primary_route: {} }], place_structure: agnosticStructure(3) };
  const cls = classifyAnywhereResult(res, { place: "Porto" });
  assert.equal(cls.status, "structure_only");
  assert.equal(cls.hasStructure, true);
  const safe = safeResponseFor(res, cls);
  assert.equal(safe.days.length, 0, "structure_only must not pass any day to rendering");
  assert.ok(safe.place_structure, "structure is preserved for the district panel");
});

test("a FALLBACK baseline city structure (no agnostic provenance) is NOT trusted → unavailable", () => {
  // The ambiguous/blocked case: the response carries the fallback CITY's structure
  // (no provenance) and a baseline day. It must never read as the typed place.
  const res = {
    days: [{ date: "2026-06-23", primary_route: { id: "baseline" } }],
    place_structure: { area_count: 12, district_day: { areas: [{ stop_ids: ["x"] }] } }, // NO provenance
  };
  const cls = classifyAnywhereResult(res, { place: "Valencia" });
  assert.equal(cls.status, "unavailable");
  assert.equal(cls.hasStructure, false);
  assert.equal(safeResponseFor(res, cls).days.length, 0, "the baseline day is dropped");
});

test("no day and no structure → unavailable", () => {
  assert.equal(classifyAnywhereResult({ days: [] }, { place: "Nowhere" }).status, "unavailable");
  assert.equal(classifyAnywhereResult({}, { place: "Nowhere" }).status, "unavailable");
});

test("placeLabel prefers the resolved anchor label, falls back to the typed place", () => {
  const resolved = {
    days: [{ experimental_agnostic_route_applied: true }],
    place_structure: agnosticStructure(),
    agnostic_route_output_experiment: { intake: { resolved: { label: "Porto, Portugal" } } },
  };
  assert.equal(classifyAnywhereResult(resolved, { place: "Porto" }).placeLabel, "Porto, Portugal");
  assert.equal(classifyAnywhereResult({ days: [] }, { place: "Porto" }).placeLabel, "Porto");
});

test("a RESOLVED place with real loaded places below the route threshold reads as sparse supply", () => {
  // Shape from a live capture: remote coordinates resolve (explicit), the
  // trusted loader finds 3 real places, and the calibration/promotion carry the
  // below-threshold cap. The classifier surfaces the trusted evidence so the UI
  // can say "found 3 real places — not enough" instead of implying nothing was
  // found.
  const sparse = {
    days: [],
    agnostic_route_output_experiment: {
      intake: { status: "resolved", resolved: { label: null, lat: 57.99, lng: 16.31, confidence: "explicit" } },
      candidate_readiness: { real_place_count: 3, coordinate_ready_real_place_count: 3 },
      readiness_calibration: {
        status: "thin_usable",
        level: "low",
        caps: ["experimental_agnostic_route", "capped_by_below_planner_candidate_threshold"],
      },
      promotion: { promote: false, blocked_caps: ["capped_by_below_planner_candidate_threshold"] },
    },
  };
  const cls = classifyAnywhereResult(sparse, { place: "your position" });
  assert.equal(cls.status, "unavailable");
  assert.equal(cls.unavailableReason, "sparse_supply");
  assert.equal(cls.realPlaceCount, 3);

  // The explicit blocker token is equally valid scarcity evidence on its own.
  const viaBlocker = {
    days: [],
    agnostic_route_output_experiment: {
      intake: { status: "resolved" },
      candidate_readiness: { real_place_count: 2 },
      readiness_blockers: ["insufficient_geocoded_candidates"],
    },
  };
  assert.equal(classifyAnywhereResult(viaBlocker, { place: "Nowhere" }).unavailableReason, "sparse_supply");
});

test("a resolved place blocked on WALKING/GEOMETRY is never described as sparse supply", () => {
  // Codex review note on this branch: plenty of candidates + a walking or
  // geometry failure must keep the default honest-absence copy — calling it
  // "too few places" would misdescribe the failure. No scarcity token → no
  // sparse claim, regardless of the positive count.
  const walkingBlocked = {
    days: [],
    agnostic_route_output_experiment: {
      intake: { status: "resolved", resolved: { label: "Genoa", confidence: "medium" } },
      candidate_readiness: { real_place_count: 10, coordinate_ready_real_place_count: 10 },
      readiness_blockers: ["walking_route_unavailable", "walking_budget_exceeded"],
      eligibility: { eligible: false, blockers: ["incomplete_geometry"] },
      readiness_calibration: { status: "blocked", level: "unavailable", caps: ["experimental_agnostic_route"] },
      promotion: { promote: false, blocked_caps: [] },
    },
  };
  const cls = classifyAnywhereResult(walkingBlocked, { place: "Genoa" });
  assert.equal(cls.status, "unavailable");
  assert.equal(cls.unavailableReason, undefined);
  assert.equal(cls.realPlaceCount, undefined);
});

test("sparse supply is NEVER claimed without resolved intake + a positive trusted count", () => {
  const unresolved = {
    days: [],
    agnostic_route_output_experiment: {
      intake: { status: "unresolved", blockers: ["unresolved_place"] },
      candidate_readiness: { real_place_count: 3 },
    },
  };
  assert.equal(classifyAnywhereResult(unresolved, { place: "Nowhere" }).unavailableReason, undefined, "unresolved places keep the default honest-absence copy");

  const loaderFailed = {
    days: [],
    agnostic_route_output_experiment: {
      intake: { status: "resolved" },
      source_status: { status: "error_failed_closed" },
      candidate_readiness: { real_place_count: 0 },
    },
  };
  assert.equal(classifyAnywhereResult(loaderFailed, { place: "Berlin" }).unavailableReason, undefined, "a loader failure is the transient-retry path, not sparse evidence");

  const composed = {
    days: [{ experimental_agnostic_route_applied: true }],
    place_structure: agnosticStructure(),
    agnostic_route_output_experiment: {
      intake: { status: "resolved" },
      candidate_readiness: { real_place_count: 25 },
    },
  };
  assert.equal(classifyAnywhereResult(composed, { place: "Lyon" }).unavailableReason, undefined, "composed days never carry an unavailable reason");
});

test("only an explicit transient source failure after resolved intake gets one retry", () => {
  const transient = {
    days: [],
    agnostic_route_output_experiment: {
      intake: { status: "resolved" },
      source_status: { status: "error_failed_closed" },
    },
  };
  assert.equal(shouldRetryTransientSource(transient), true);

  const provenEmpty = {
    days: [],
    agnostic_route_output_experiment: {
      intake: { status: "resolved" },
      source_status: { status: "loaded:0" },
    },
  };
  assert.equal(shouldRetryTransientSource(provenEmpty), false, "proven empty data must stay honest");

  const ambiguous = {
    days: [],
    agnostic_route_output_experiment: {
      intake: { status: "unresolved", blockers: ["ambiguous_place"] },
      source_status: { status: "error_failed_closed" },
    },
  };
  assert.equal(shouldRetryTransientSource(ambiguous), false, "an unresolved anchor must never be retried as trusted");

  const composed = {
    days: [{ experimental_agnostic_day: true }],
    agnostic_route_output_experiment: {
      intake: { status: "resolved" },
      source_status: { status: "error_failed_closed" },
    },
  };
  assert.equal(shouldRetryTransientSource(composed), false, "a composed result does not need source recovery");
});

// --------------------------------------------------------------------------
// Slice 01 — a day the server published WITH limitations is still a day.
//
// The data gate used to pass only status "composed". A limited day must reach
// the render contract with its stops intact; only the label differs.
// --------------------------------------------------------------------------

function limitedResponse(caps) {
  return {
    days: [{
      experimental_agnostic_route_applied: true,
      primary_route: { main_stops: [{ id: "a" }, { id: "b" }] },
    }],
    agnostic_route_output_experiment: {
      promotion: { readiness: "promotable_limited", qualifying_caps: caps },
    },
  };
}

test("a limited day classifies as composed_limited and keeps its stops", () => {
  const response = limitedResponse(["capped_by_thin_day"]);
  const classification = classifyAnywhereResult(response, { place: "Somewhere" });

  assert.equal(classification.status, "composed_limited");
  assert.deepEqual(classification.limitations, ["capped_by_thin_day"]);

  // The data gate must not empty it.
  const safe = safeResponseFor(response, classification);
  assert.equal(safe.days.length, 1);
  assert.equal(safe.days[0].primary_route.main_stops.length, 2);
});

test("an unlimited promoted day still classifies as composed", () => {
  const response = {
    days: [{ experimental_agnostic_route_applied: true, primary_route: { main_stops: [{ id: "a" }] } }],
    agnostic_route_output_experiment: { promotion: { readiness: "promotable", qualifying_caps: [] } },
  };
  const classification = classifyAnywhereResult(response, { place: "Somewhere" });

  assert.equal(classification.status, "composed");
  assert.deepEqual(classification.limitations, []);
  assert.equal(safeResponseFor(response, classification).days.length, 1);
});

test("a withheld day is still emptied — grading never publishes a refused route", () => {
  const response = {
    days: [],
    agnostic_route_output_experiment: {
      promotion: { readiness: "non_promotable", disqualifying_caps: ["capped_by_requested_intent_unmet"] },
    },
  };
  const classification = classifyAnywhereResult(response, { place: "Somewhere" });

  assert.notEqual(classification.status, "composed");
  assert.notEqual(classification.status, "composed_limited");
  assert.deepEqual(safeResponseFor(response, classification).days, []);
});

test("both composed statuses are recognised by the shared composed-family test", () => {
  assert.equal(isComposedStatus("composed"), true);
  assert.equal(isComposedStatus("composed_limited"), true);
  assert.equal(isComposedStatus("structure_only"), false);
  assert.equal(isComposedStatus("unavailable"), false);
});
