/**
 * Agnostic route-candidate diagnostics (#257) — INSPECT ONLY.
 *
 * The narrowest safe bridge between trusted source-backed/open-data candidates
 * and the actual returned route: it observes whether a credible source-backed
 * candidate would form a route-candidate-like proposal BESIDE the real route,
 * and whether that candidate represents a gap the route does not contain.
 *
 * It observes and compares — it never selects, promotes, replaces, reorders, or
 * improves the route. Pure / deterministic / no network / no input mutation.
 * Comparison is by stable ids only (no names/labels/coordinates as ids).
 *
 * Fail-closed: if external/source-backed candidates were not explicitly opted
 * into, or the trusted loader is missing / errored / empty, the diagnostic
 * returns an explicit unavailable result rather than fetching or fabricating.
 *
 * It must never imply "better route", "candidate wins", route readiness, ETA,
 * walking time, duration, or opening-hours validity.
 */

const {
  buildRouteCandidateFromCandidateCombination,
  compareAdaptedCandidateToPrimaryRoute,
} = require("./candidate-combination-route-adapter");

function buildAgnosticRouteCandidateDiagnostics({
  city,
  externalRequested = false,
  sourceStatus = null,
  candidateCombination = null,
  primaryRoute = null,
} = {}) {
  const base = {
    status: "unavailable",
    city: city || null,
    experimental: true,
    route_mutation: false,
    source: "trusted_candidate_pool",
    source_status: sourceStatus || null,
    candidate: null,
    comparison_to_route_output: null,
    blockers: [],
    signals: [],
    recommendation: "needs_more_data",
  };

  // Fail-closed #1: external/source-backed candidates must be explicitly opted in.
  if (!externalRequested) {
    return { ...base, blockers: ["external_candidates_not_requested"] };
  }

  // Fail-closed #2: honor the trusted-loader status from resolvePlannerRoleHelpers.
  const loaderStatus = sourceStatus?.status || "skipped";
  const LOADER_BLOCKERS = {
    no_loader_configured: "no_trusted_loader",
    no_anchor: "no_anchor_for_trusted_fetch",
    error_failed_closed: "loader_error",
    "loaded:0": "no_usable_trusted_records",
    skipped: "external_candidates_not_requested",
  };
  if (LOADER_BLOCKERS[loaderStatus]) {
    return { ...base, blockers: [LOADER_BLOCKERS[loaderStatus]] };
  }

  // Build the diagnostic candidate from the trusted candidate combination via
  // the #253 adapter (pure). This is a candidate diagnostic, NOT a route.
  const adapted = buildRouteCandidateFromCandidateCombination({ city, candidateCombination });
  const body = adapted.body;
  if (adapted.status === "unavailable" || !body.stop_ids.length) {
    return { ...base, blockers: ["no_usable_candidates"] };
  }

  const cmp = compareAdaptedCandidateToPrimaryRoute({ adaptedCandidate: adapted, route: primaryRoute });
  const comparison = {
    primary_route_id: cmp.primary_route_id,
    primary_stop_ids: cmp.primary_stop_ids,
    candidate_stop_ids: cmp.adapted_stop_ids,
    matched_stop_ids: cmp.matched_stop_ids,
    candidate_not_in_primary: cmp.adapted_not_in_primary,
    primary_not_in_candidate: cmp.primary_not_in_adapted,
    overlap_count: cmp.overlap_count,
    overlap_ratio: cmp.overlap_ratio,
    order_sensitive: false,
    reasons: cmp.reasons,
  };

  const candidate = {
    status: adapted.status,
    id: body.id,
    label: body.label, // "...diagnostic, not a route"
    stop_ids: body.stop_ids,
    stops: body.stops,
    target_roles: body.target_roles,
    unresolved_roles: body.unresolved_roles,
    geometry_summary: body.geometry_summary,
    trust_summary: body.trust_summary,
    quality_flags: body.quality_flags,
    order_source: "candidate_role_order",
    order_confidence: "diagnostic_only",
    output_contract: "diagnostic_candidate_not_route_json",
  };

  const signals = [];
  const blockers = [];
  const externalIds = new Set(
    body.stops.filter((s) => s.origin === "external_open").map((s) => s.candidate_id).filter(Boolean),
  );
  if (externalIds.size) signals.push("trusted_external_candidate_present");
  if (body.stops.some((s) => s.origin === "curated_catalog")) signals.push("curated_candidates_present");
  // A source-backed GAP = a trusted external candidate that the actual route
  // does not contain. Diagnostic statement only — not "use this candidate".
  const sourceBackedGap = comparison.candidate_not_in_primary.some((id) => externalIds.has(id));
  if (sourceBackedGap) signals.push("source_backed_gap_vs_route");
  if (!primaryRoute) blockers.push("no_primary_route");

  return {
    ...base,
    status: primaryRoute ? "available" : "partial",
    candidate,
    comparison_to_route_output: comparison,
    blockers: [...new Set(blockers)].sort(),
    signals: [...new Set(signals)].sort(),
    recommendation: sourceBackedGap ? "candidate_gap_detected" : "inspect_only",
  };
}

module.exports = { buildAgnosticRouteCandidateDiagnostics };
