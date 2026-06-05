/**
 * Candidate-combination → route-candidate adapter EXPERIMENT (#253).
 *
 * Diagnostic only. Converts a #250 candidate-combination result into a
 * route-candidate-LIKE shape so it can be compared, by stable id, against the
 * actual primary route — testing the consumption contract surfaced in #252
 * (candidate combination and route output share zero stable ids in
 * representative scenarios).
 *
 * THIS IS NOT A ROUTE. It must never:
 *   - mutate the route result, planner roles, or any input object
 *   - claim walking time, route-order confidence, opening hours, or day-plan quality
 *   - be presented as default / user-facing route output
 *   - assert that the candidate combination is "better" than the route engine
 *
 * It exposes blockers and signals so the NEXT decision (flag-gated A/B route
 * scoring vs geometry calibration vs no consumption) can be made on evidence.
 *
 * Pure / deterministic. No network.
 */

function buildRouteCandidateAdapterInspect({ city, candidateCombination, route, context } = {}) {
  const candidate = buildRouteCandidateFromCandidateCombination({ city, candidateCombination, context });
  const comparison = compareAdaptedCandidateToPrimaryRoute({ adaptedCandidate: candidate, route });
  const scoringProbe = buildScoringProbe({ candidate, comparison });
  return {
    status: candidate.status,
    source: "candidate_combination",
    experimental: true,
    candidate: candidate.body,
    comparison_to_primary_route: comparison,
    scoring_probe: scoringProbe,
  };
}

function buildRouteCandidateFromCandidateCombination({ city, candidateCombination, context } = {}) {
  const cc = candidateCombination && typeof candidateCombination === "object" ? candidateCombination : {};
  const selected = Array.isArray(cc.selected) ? cc.selected : [];
  const geometry = cc.geometry_summary || null;

  // stops preserve the combination's role order — explicitly NOT a walking
  // sequence. order_confidence is diagnostic_only.
  const stops = selected.map((s) => ({
    role: s.role,
    candidate_id: s.candidate_id || null,
    label: s.label || null,
    coordinates: resolveCoords(s.coordinates),
    origin: s.origin || null,
    confidence: s.confidence || null,
  }));
  const stopIds = stops.map((s) => s.candidate_id).filter(Boolean);
  const targetRoles = stops.map((s) => s.role);

  const status = selected.length === 0
    ? "unavailable"
    : cc.status === "ready"
      ? "available"
      : "partial";

  const trustSummary = stops.reduce(
    (acc, s) => {
      if (s.origin === "curated_catalog") acc.curated_count += 1;
      else if (s.origin) acc.external_count += 1;
      if (LOW_CONFIDENCE.has(s.confidence)) acc.low_confidence_count += 1;
      return acc;
    },
    { curated_count: 0, external_count: 0, low_confidence_count: 0 },
  );

  const reasons = [`adapter_status:${status}`, `source_combo_status:${cc.status || "none"}`];
  if (!selected.length) reasons.push("no_selected_candidates");

  return {
    status,
    body: {
      // deterministic diagnostic id — NOT a product route id
      id: `cc-adapter:${city || "city"}:${[...stopIds].sort().join("+") || "empty"}`,
      label: "Candidate-combination adapter (diagnostic, not a route)",
      experimental: true,
      stop_ids: stopIds,
      stops,
      target_roles: targetRoles,
      unresolved_roles: Array.isArray(cc.unresolved_roles) ? cc.unresolved_roles : [],
      duplicate_role_coverage: Array.isArray(cc.duplicate_role_coverage) ? cc.duplicate_role_coverage : [],
      geometry_summary: geometry,
      trust_summary: trustSummary,
      quality_flags: Array.isArray(cc.quality_flags) ? cc.quality_flags : [],
      reasons,
      // order is the reservoir's role order, NOT a real walking sequence
      order_source: "role_order",
      order_confidence: "diagnostic_only",
    },
  };
}

function compareAdaptedCandidateToPrimaryRoute({ adaptedCandidate, route } = {}) {
  const adaptedStopIds = Array.isArray(adaptedCandidate?.body?.stop_ids) ? adaptedCandidate.body.stop_ids : [];
  const routeStops = Array.isArray(route?.main_stops) ? route.main_stops : [];
  const primaryStopIds = routeStops.map((stop) => firstStableId(stop, ["id", "place_id", "candidate_id"])).filter(Boolean);

  const adaptedSet = new Set(adaptedStopIds);
  const primarySet = new Set(primaryStopIds);
  const matched = [...adaptedSet].filter((id) => primarySet.has(id)).sort();
  const adaptedNotInPrimary = [...adaptedSet].filter((id) => !primarySet.has(id)).sort();
  const primaryNotInAdapted = [...primarySet].filter((id) => !adaptedSet.has(id)).sort();

  const reasons = [];
  if (!route) reasons.push("no_primary_route");
  if (!adaptedStopIds.length) reasons.push("no_adapted_stop_ids");
  if (!primaryStopIds.length && route) reasons.push("no_primary_stop_ids");
  if (matched.length) reasons.push("stable_id_overlap");
  if (adaptedNotInPrimary.length) reasons.push("adapted_stops_outside_primary");
  if (primaryNotInAdapted.length) reasons.push("primary_stops_outside_adapted");

  return {
    primary_route_id: (route && (route.id || null)) || null,
    primary_stop_ids: primaryStopIds.slice().sort(),
    adapted_stop_ids: adaptedStopIds.slice().sort(),
    matched_stop_ids: matched,
    adapted_not_in_primary: adaptedNotInPrimary,
    primary_not_in_adapted: primaryNotInAdapted,
    overlap_count: matched.length,
    overlap_ratio: adaptedStopIds.length ? round(matched.length / adaptedStopIds.length) : 0,
    order_sensitive: false,
    reasons: [...new Set(reasons)].sort(),
  };
}

// Minimal DIAGNOSTIC scoring probe — not a production route scorer.
function buildScoringProbe({ candidate, comparison }) {
  const status = candidate.status;
  const body = candidate.body;
  const blockers = [];
  const positive = [];
  const negative = [];

  const geometry = body.geometry_summary || {};
  const hasUnresolved = (body.unresolved_roles || []).length > 0;

  if (!body.stop_ids.length) blockers.push("no_selected_candidates");
  if (hasUnresolved) blockers.push("unresolved_target_roles");
  if (geometry.coherence === "incomplete") blockers.push("missing_coordinates");
  if (geometry.coherence === "weak") blockers.push("weak_geometry");
  if ((body.duplicate_role_coverage || []).length) blockers.push("duplicate_role_coverage");
  if (!comparison.primary_route_id && !comparison.primary_stop_ids.length) blockers.push("no_primary_route");
  if (body.stop_ids.length && !comparison.primary_stop_ids.length) blockers.push("no_stable_ids");

  if (body.target_roles.length && !hasUnresolved) positive.push("target_roles_covered");
  if (body.stop_ids.length && comparison.primary_stop_ids.length) positive.push("stable_ids_present");
  if (["strong", "ok"].includes(geometry.coherence)) positive.push("geometry_ok");
  if (body.trust_summary.curated_count > 0) positive.push("curated_candidates");
  const externalNotConsumed = body.stops.some(
    (s) => s.origin === "external_open" && comparison.adapted_not_in_primary.includes(s.candidate_id),
  );
  if (externalNotConsumed) positive.push("trusted_external_gap_fill");

  if (comparison.primary_stop_ids.length && comparison.overlap_count === 0) negative.push("zero_primary_overlap");
  if (geometry.coherence === "weak") negative.push("geometry_weak");
  if (geometry.coherence === "incomplete") negative.push("incomplete_coordinates");
  if (externalNotConsumed) negative.push("external_not_consumed");
  if ((body.duplicate_role_coverage || []).length) negative.push("single_candidate_multi_role");

  // comparable = a meaningful stable-id A/B can be drawn at all
  const comparable = body.stop_ids.length > 0 && comparison.primary_stop_ids.length > 0;

  let recommendation;
  if (status === "unavailable" || hasUnresolved) {
    recommendation = "not_route_ready";
  } else if (geometry.coherence === "weak" || geometry.coherence === "incomplete") {
    recommendation = "needs_geometry_validation";
  } else if (comparable && status === "available" && (comparison.overlap_count === 0 || externalNotConsumed)) {
    recommendation = "candidate_for_ab_route_scoring";
  } else {
    recommendation = "inspect_only";
  }

  return {
    comparable,
    blockers: [...new Set(blockers)].sort(),
    positive_signals: [...new Set(positive)].sort(),
    negative_signals: [...new Set(negative)].sort(),
    recommendation,
  };
}

// --- helpers ---------------------------------------------------------------

const LOW_CONFIDENCE = new Set(["low", "needs_review", null, undefined]);

function firstStableId(value, keys) {
  for (const key of keys) {
    const id = value?.[key];
    if (typeof id === "string" && id.trim()) return id.trim();
    if (Number.isFinite(id)) return String(id);
  }
  return null;
}

function resolveCoords(value) {
  if (!value || typeof value !== "object") return null;
  if (Number.isFinite(value.lat) && Number.isFinite(value.lng)) return { lat: value.lat, lng: value.lng };
  return null;
}

function round(value) {
  return Number.isFinite(value) ? Math.round(value * 1000) / 1000 : 0;
}

module.exports = {
  buildRouteCandidateAdapterInspect,
  buildRouteCandidateFromCandidateCombination,
  compareAdaptedCandidateToPrimaryRoute,
};
