/**
 * Agnostic route-output EXPERIMENT (#259) — flag-gated route mutation/synthesis.
 *
 * This is the first step from observability to capability on
 * /api/route-recommendations: behind an explicit experiment flag, a
 * coordinate-only / non-citypack ("any-place") request can RETURN an
 * experimental route built from trusted source-backed candidates — or, when
 * strict eligibility fails, honest blockers and no route.
 *
 * Hard rules:
 *   - Mutation/synthesis happens ONLY when the caller passes the explicit
 *     experiment flag (gated in app.js, NEVER by `inspect=`).
 *   - The baseline result object is never mutated in place: we deep-clone first.
 *   - Trusted candidates come ONLY from the server-injected openDataLoader. The
 *     public request payload can never inject candidates (fail-closed).
 *   - No named-city or narrow-intent branching: the agnostic context is built
 *     purely from coordinates.
 *   - The experimental route is honest: candidate role order can seed a small
 *     proximity sequence, but only inside this flag-gated experiment and only
 *     when the produced order passes walking-budget validation. It still
 *     surfaces walking distance/minute ESTIMATES and may carry a bounded
 *     selected-local-day source-hours fact — never raw schedules, current-open
 *     state, a live arrival time, or "better/optimal/fastest/shortest" claims.
 *
 * Pure except for the awaited trusted loader + injectable walking router.
 * Deterministic given its inputs.
 */

const { buildAgnosticCityContext } = require("../candidates/agnostic-context");
const { buildProviderSpecs } = require("../candidates/candidate-pool");
const { selectPlannerRoleCandidates } = require("./role-selector");
const { summarizeDayflowHonesty } = require("./dayflow-honesty");
const { buildCandidateCombinationInspect } = require("./candidate-combination-inspect");
const { resolveAgnosticCandidateReachPolicy } = require("./candidate-reach-policy");
const { buildRouteCandidateFromCandidateCombination } = require("./candidate-combination-route-adapter");
const { assessCityCandidateReadiness } = require("../place-candidates/readiness");
const {
  buildSelectedDayHoursFact,
  buildLocalDayAvailabilityWindow,
  evaluateOpeningHoursForWindow,
  normalizeSelectedDayHoursFact,
} = require("../place-candidates/opening-hours");
const { validateAgnosticWalkingOrder } = require("./agnostic-route-walking-validation");
const { buildAgnosticRouteOrdering, daypartForRole, timeBandRank } = require("./agnostic-route-ordering");
const { resolveAgnosticContext, collectInfluenceReasons } = require("./agnostic-route-context");
const { buildDayflowContext } = require("./dayflow-context");
const { calibrateAgnosticRouteReadiness } = require("./agnostic-route-readiness-calibration");
const { generateAgnosticRecommendations } = require("../route-engine");
const {
  buildAgnosticEngineCityConfig,
  mapPlannerReservoirToSourceCandidates,
} = require("./agnostic-engine-compose");

// A route needs at least an ordered pair of geocoded, stable-id stops. Fewer
// than this is honestly "not a route".
const MIN_VIABLE_GEOCODED_STOPS = 2;
// Geometry coherence that is honest enough to present an (unvalidated) order.
const ACCEPTABLE_COHERENCE = new Set(["strong", "ok"]);

// Loader status → explicit, honest blocker. Mirrors the #257 diagnostic mapping
// so HTTP and diagnostics never drift.
const LOADER_BLOCKERS = Object.freeze({
  no_loader_configured: "no_trusted_loader",
  no_anchor: "no_anchor_for_trusted_fetch",
  error_failed_closed: "loader_error",
  "loaded:0": "no_usable_trusted_records",
  skipped: "external_candidates_not_requested",
});

/**
 * Resolve trusted server-side candidate records. The public payload is never
 * consulted here — only the injected openDataLoader. Fail-closed: any
 * missing/empty/error state becomes an explicit status, never a throw.
 */
async function resolveTrustedHelpers({
  externalRequested,
  openDataLoader,
  anchor,
  requestedIntents = [],
  anchorMode = "unknown",
  spatialScope = null,
}) {
  const baseStatus = {
    status: "skipped",
    external_candidates_requested: Boolean(externalRequested),
    anchor: anchor || null,
  };
  if (!externalRequested) {
    return { helpers: {}, sourceStatus: baseStatus };
  }
  if (typeof openDataLoader !== "function") {
    return { helpers: {}, sourceStatus: { ...baseStatus, status: "no_loader_configured" } };
  }
  if (!anchor) {
    return { helpers: {}, sourceStatus: { ...baseStatus, status: "no_anchor" } };
  }
  try {
    const records = await openDataLoader({
      ...anchor,
      requestedIntents: Array.isArray(requestedIntents) ? requestedIntents : [],
      anchorMode: normalizeAnchorMode(anchorMode),
      spatialScope,
    });
    const loaderStatus = typeof records?.loader_status === "string" ? records.loader_status : null;
    const loaderError = records?.loader_error || null;
    const collection = sanitizeLoaderCollectionMetadata(records?.loader_metadata);
    if (loaderStatus === "error_failed_closed") {
      return {
        helpers: {},
        sourceStatus: { ...baseStatus, status: "error_failed_closed", error: loaderError, ...(collection ? { collection } : {}) },
      };
    }
    if (!Array.isArray(records) || records.length === 0) {
      return {
        helpers: {},
        sourceStatus: { ...baseStatus, status: "loaded:0", error: loaderError, ...(collection ? { collection } : {}) },
      };
    }
    return {
      helpers: { external_provider: { dataset: records } },
      sourceStatus: {
        ...baseStatus,
        status: `loaded:${records.length}`,
        error: loaderError,
        ...(collection ? { collection } : {}),
      },
    };
  } catch (_error) {
    return { helpers: {}, sourceStatus: { ...baseStatus, status: "error_failed_closed", error: "fetch_error" } };
  }
}

function normalizeAnchorMode(value) {
  return ["coordinates", "place"].includes(String(value)) ? String(value) : "unknown";
}

function sanitizeLoaderCollectionMetadata(value) {
  if (!value || typeof value !== "object") return null;
  const profile = (input) => {
    if (!input || typeof input !== "object") return null;
    return {
      record_count: Number.isFinite(input.record_count) ? input.record_count : 0,
      category_count: Number.isFinite(input.category_count) ? input.category_count : 0,
      requested_intent_count: Number.isFinite(input.requested_intent_count) ? input.requested_intent_count : 0,
      requested_intents_covered: sanitizeTokens(input.requested_intents_covered),
      requested_intents_partial: sanitizeTokens(input.requested_intents_partial),
      requested_intents_missing: sanitizeTokens(input.requested_intents_missing),
    };
  };
  return {
    base_radius_km: finiteOrNull(value.base_radius_km),
    selected_radius_km: finiteOrNull(value.selected_radius_km),
    attempted_radius_km: finiteOrNull(value.attempted_radius_km),
    expansion_applied: value.expansion_applied === true,
    expansion_trigger: safeToken(value.expansion_trigger),
    selection_reason: safeToken(value.selection_reason),
    anchor_mode: normalizeAnchorMode(value.anchor_mode),
    requested_intents: sanitizeTokens(value.requested_intents),
    expansion_query_intents: sanitizeTokens(value.expansion_query_intents),
    initial_profile: profile(value.initial_profile),
    selected_profile: profile(value.selected_profile),
    spatial_scope: sanitizeSpatialScopeSummary(value.spatial_scope),
    regional_scout: sanitizeRegionalScout(value.regional_scout),
  };
}

function sanitizeSpatialScopeSummary(value) {
  if (!value || typeof value !== "object") return null;
  return {
    source: safeToken(value.source),
    kind: safeToken(value.kind),
    collection_mode: safeToken(value.collection_mode),
    diagonal_km: finiteOrNull(value.diagonal_km),
  };
}

function sanitizeRegionalScout(value) {
  if (!value || typeof value !== "object") return null;
  return {
    attempted: value.attempted === true,
    status: safeToken(value.status),
    reason: safeToken(value.reason),
    selected_anchor: safeToken(value.selected_anchor),
    cluster_count: Number.isFinite(value.cluster_count) ? value.cluster_count : 0,
    clusters: (Array.isArray(value.clusters) ? value.clusters : []).slice(0, 2).map((cluster) => ({
      id: safeToken(cluster?.id),
      record_count: Number.isFinite(cluster?.record_count) ? cluster.record_count : 0,
      requested_intents_covered: sanitizeTokens(cluster?.requested_intents_covered),
      requested_intents_missing: sanitizeTokens(cluster?.requested_intents_missing),
    })),
  };
}

function finiteOrNull(value) {
  return Number.isFinite(value) ? value : null;
}

function safeToken(value) {
  return typeof value === "string" && /^[a-z0-9_:-]{1,80}$/.test(value) ? value : null;
}

function sanitizeTokens(values) {
  return [...new Set((Array.isArray(values) ? values : []).map(safeToken).filter(Boolean))].slice(0, 12);
}

function safeAssessReadiness(cityConfig, options) {
  try {
    return assessCityCandidateReadiness(cityConfig, options);
  } catch (_error) {
    return null;
  }
}

function admitExperimentalInferredExternalCandidate({ candidate, derived, gates } = {}) {
  const hasCoords = Number.isFinite(candidate?.lat) && Number.isFinite(candidate?.lng);
  const attribution = collectCandidateAttribution(candidate);
  const sourceTier = String(candidate?.trust?.source_tier || "").toLowerCase();
  const external = candidate?.candidate_origin === "external_open" || candidate?.city_pack_owned === false;
  const sourceBacked = attribution.length > 0;
  if (!external || sourceTier !== "inferred" || !hasCoords || !hasText(candidate?.label) || !sourceBacked) {
    return { allowed: false };
  }
  const gateReasons = Array.isArray(gates?.reasons) ? gates.reasons : [];
  const reasons = dedupe([
    "experimental_inferred_external_admission",
    "source_backed_external_candidate",
    "has_coordinates",
    ...gateReasons,
  ]);
  if (candidate?.trust?.human_verified !== true && Number(derived?.provenance_diversity || 0) < 2) {
    reasons.push("blocked_promotion_uncorroborated");
  }
  if (String(derived?.existence_confidence || "") === "low") {
    reasons.push("low_existence_confidence");
  }
  return {
    allowed: true,
    policy: "experimental_inferred_external",
    reasons: dedupe(reasons),
    gate_reasons: gateReasons,
  };
}

function collectCandidateAttribution(candidate) {
  const evidence = Array.isArray(candidate?.evidence) ? candidate.evidence : [];
  return evidence
    .map((item) => item && item.source_ref)
    .filter((ref) => ref && (hasText(ref.provider_id) || hasText(ref.url) || hasText(ref.label)));
}

function hasText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Decide whether a trusted candidate combination is eligible to BECOME the
 * returned route. Hard blockers prevent mutation; caveats accompany a produced
 * route. Readiness (#place-candidates/readiness thresholds) is surfaced as an
 * honest caveat, not a hard block — the produced route is always experimental.
 */
function evaluateEligibility({
  externalRequested,
  sourceStatus,
  adaptedBody,
  candidateReadiness,
  engineSourceCandidates = null,
  plannerRoles = null,
  candidateCombination = null,
}) {
  const blockers = [];
  // Walking-order honesty is decided downstream by the #261 walking-budget
  // validation step — not pre-asserted here.
  const caveats = [];
  const checks = {};

  checks.external_candidates_requested = Boolean(externalRequested);
  if (!externalRequested) {
    blockers.push("external_candidates_not_requested");
  }

  const loaderStatus = (sourceStatus && sourceStatus.status) || "skipped";
  checks.trusted_loader_status = loaderStatus;
  const loaderBlocker = LOADER_BLOCKERS[loaderStatus];
  // Avoid a duplicate "external_candidates_not_requested" when we already added
  // it above (loaderStatus stays "skipped" when external wasn't requested).
  if (externalRequested && loaderBlocker) {
    blockers.push(loaderBlocker);
  }

  const stops = Array.isArray(adaptedBody?.stops) ? adaptedBody.stops : [];
  const combinationGeocodedStops = stops.filter(
    (stop) =>
      stop &&
      stop.candidate_id &&
      stop.coordinates &&
      Number.isFinite(stop.coordinates.lat) &&
      Number.isFinite(stop.coordinates.lng),
  );
  const engineGeocodedStops = (Array.isArray(engineSourceCandidates) ? engineSourceCandidates : []).filter(
    (candidate) =>
      candidate && candidate.id && Number.isFinite(candidate.lat) && Number.isFinite(candidate.lng),
  );
  const geocodedStops = engineGeocodedStops.length ? engineGeocodedStops : combinationGeocodedStops;
  const geocodedCount = geocodedStops.length;
  const coherence = (adaptedBody?.geometry_summary && adaptedBody.geometry_summary.coherence) || "incomplete";
  const reachExcludedCount = Number(plannerRoles?.reach_policy?.excluded_candidate_count) || 0;
  const outsideOriginReach =
    (Array.isArray(candidateCombination?.reasons) &&
      candidateCombination.reasons.includes("no_combination_within_origin_reach")) ||
    (reachExcludedCount > 0 && geocodedCount < MIN_VIABLE_GEOCODED_STOPS);
  checks.geocoded_stop_count = geocodedCount;
  checks.combination_geocoded_stop_count = combinationGeocodedStops.length;
  if (engineGeocodedStops.length) checks.engine_reservoir_geocoded_stop_count = engineGeocodedStops.length;
  checks.geometry_coherence = coherence;
  if (outsideOriginReach) checks.candidate_cluster_within_origin_reach = false;
  if (geocodedCount < MIN_VIABLE_GEOCODED_STOPS) {
    blockers.push("insufficient_geocoded_candidates");
  }
  if (outsideOriginReach) {
    blockers.push("candidate_cluster_outside_origin_reach");
  } else if (!ACCEPTABLE_COHERENCE.has(coherence)) {
    blockers.push(coherence === "incomplete" ? "incomplete_geometry" : "weak_geometry");
  }

  // Readiness reuse — honest SOFT caveat. A real, coherent trusted pair still
  // produces an (experimental) route, but we never hide that the place is below
  // the planner-candidate readiness bar.
  checks.can_support_planner = candidateReadiness ? Boolean(candidateReadiness.can_support_planner) : null;
  checks.real_place_count = candidateReadiness ? candidateReadiness.real_place_count ?? null : null;
  checks.coordinate_coverage = candidateReadiness ? candidateReadiness.coordinate_coverage ?? null : null;
  checks.candidate_pipeline = buildCandidatePipelineChecks({
    candidateReadiness,
    plannerRoles,
    candidateCombination,
    combinationGeocodedCount: combinationGeocodedStops.length,
    engineGeocodedCount: engineGeocodedStops.length,
  });
  if (plannerRoles?.reach_policy) {
    checks.candidate_reach_policy = {
      policy: plannerRoles.reach_policy.policy,
      max_origin_distance_km: plannerRoles.reach_policy.max_origin_distance_km,
      scope_kind: plannerRoles.reach_policy.scope_kind,
    };
  }
  if (candidateReadiness && candidateReadiness.can_support_planner === false) {
    caveats.push("below_planner_candidate_threshold");
  }

  return {
    eligible: blockers.length === 0,
    blockers: dedupe(blockers),
    caveats: dedupe(caveats),
    checks,
  };
}

function buildCandidatePipelineChecks({
  candidateReadiness,
  plannerRoles,
  candidateCombination,
  combinationGeocodedCount,
  engineGeocodedCount,
}) {
  const pipeline = plannerRoles?.pipeline_summary || {};
  return {
    coordinate_ready_real_place_count: candidateReadiness?.coordinate_ready_real_place_count ?? null,
    identity_resolved_candidate_count: pipeline.identity_resolved_candidate_count ?? null,
    eligible_pool_candidate_count: pipeline.eligible_pool_candidate_count ?? null,
    rejected_candidate_count: pipeline.rejected_candidate_count ?? null,
    availability_evaluated_candidate_count: pipeline.availability_evaluated_candidate_count ?? null,
    availability_excluded_candidate_count: pipeline.availability_excluded_candidate_count ?? null,
    availability_unresolved_candidate_count: pipeline.availability_unresolved_candidate_count ?? null,
    role_relevant_candidate_count: pipeline.role_relevant_candidate_count ?? null,
    role_surface_candidate_count: pipeline.role_surface_candidate_count ?? null,
    ...(plannerRoles?.reach_policy
      ? {
          reach_eligible_candidate_count: plannerRoles.reach_policy.eligible_candidate_count,
          reach_excluded_candidate_count: plannerRoles.reach_policy.excluded_candidate_count,
        }
      : {}),
    combination_selected_candidate_count: Array.isArray(candidateCombination?.selected)
      ? candidateCombination.selected.length
      : null,
    combination_geocoded_stop_count: combinationGeocodedCount,
    engine_reservoir_geocoded_stop_count: engineGeocodedCount || 0,
  };
}

/**
 * Build the experimental primary_route from the adapted candidate body. It stays
 * clearly experimental. Without #261 walking validation it omits geometry/timing;
 * after validation it uses the existing route-result walking fields (`legs`,
 * `map_path_points`) and bounded selected-day source hours while still avoiding
 * raw schedules, current-open-state, or live-arrival claims.
 */
function buildExperimentalPrimaryRoute({ cityKey, adaptedBody, walkingValidation = null, routeOrdering = null, currentTimeBand = null, anchoredToLocalTime = false, trimmedDayparts = [] }) {
  const inputStops = Array.isArray(adaptedBody?.stops) ? adaptedBody.stops : [];
  const stops = inputStops.map((stop) => {
    const selectedDayHours = normalizeSelectedDayHoursFact(stop.selected_day_hours);
    return {
      id: stop.candidate_id || null,
      label: stop.label || null,
      role: stop.role || null,
      origin: stop.origin || null,
      confidence: stop.confidence || null,
      // #275 — honest daypart label (morning…evening), approximate arc position,
      // NOT a scheduled clock time. Derived from the same role→slot map ordering
      // uses, so the label always matches the sequence.
      daypart: daypartForRole(stop.role || null),
      lat: stop.coordinates && Number.isFinite(stop.coordinates.lat) ? stop.coordinates.lat : null,
      lng: stop.coordinates && Number.isFinite(stop.coordinates.lng) ? stop.coordinates.lng : null,
      ...(selectedDayHours?.status === "known" ? { selected_day_hours: selectedDayHours } : {}),
    };
  });
  const stopIds = stops.map((stop) => stop.id).filter(Boolean);
  const gateDiagnostics = inputStops
    .map((stop) => buildGateDiagnostic(stop))
    .filter(Boolean);

  const base = {
    id: `agnostic-experimental:${cityKey || "agnostic"}:${[...stopIds].sort().join("+") || "empty"}`,
    experimental: true,
    experimental_agnostic_route: true,
    source: "trusted_candidate_pool",
    // Neutral, honest title — no city name, no "better/best/optimal/fastest".
    title: "Experimental any-place candidate route",
    // Order is whatever trusted candidate order the caller supplied: candidate
    // role order by default, or the flag-gated proximity sequence after it has
    // passed walking-budget validation. Validation itself never reorders.
    main_stops: stops,
    target_roles: Array.isArray(adaptedBody?.target_roles) ? adaptedBody.target_roles : [],
    unresolved_roles: Array.isArray(adaptedBody?.unresolved_roles) ? adaptedBody.unresolved_roles : [],
    geometry_summary: adaptedBody?.geometry_summary || null,
    trust_summary: adaptedBody?.trust_summary || null,
    gate_diagnostics: gateDiagnostics,
    route_ordering: sanitizeRouteOrdering(routeOrdering),
  };

  // #261/#265 — when the supplied candidate order passed walking-budget
  // validation, surface honest walking distance/minute ESTIMATES (heuristic or
  // OSRM, never a live arrival time). The supplied order may be original role
  // order or the #265 proximity sequence; validation checked it, it did not
  // optimize it.
  if (walkingValidation && walkingValidation.valid && walkingValidation.result) {
    const wr = walkingValidation.result;
    const totalWalkMinutes = (Array.isArray(wr.legs) ? wr.legs : []).reduce(
      (sum, leg) => sum + (Number.isFinite(leg && leg.estimated_walk_minutes) ? leg.estimated_walk_minutes : 0),
      0,
    );
    const caveats = ["experimental"];
    if (wr.source !== "osrm" || wr.fallbackUsed) caveats.push("heuristic_walking_estimate");
    if (wr.fallbackUsed) caveats.push("walking_router_fallback_used");
    if (routeOrdering && routeOrdering.applied) caveats.push("experimental_daypart_sequence");
    // #275 — daypart-arc honesty. The arc is the ordered list of stop dayparts.
    // When the trusted current local band is known and sits AFTER the arc's
    // earliest daypart, the day leads with an already-past part of the day —
    // surface that honestly rather than pretending it is anchored to "now".
    const daypartHonesty = buildRouteDaypartHonesty({
      daypartArc: stops.map((stop) => stop.daypart),
      currentTimeBand,
      anchoredToLocalTime,
      trimmedDayparts,
    });
    caveats.push(...daypartHonesty.caveats);
    return {
      ...base,
      summary:
        "Experimental route composed from trusted source-backed candidates. The stop order follows a rough daypart rhythm and has been validated against a walking budget; walking distances and minutes are estimates, not a live arrival time.",
      order_source:
        routeOrdering && routeOrdering.applied
          ? routeOrdering.source || "trusted_candidate_pool+daypart_rhythm+proximity_sequence"
          : "trusted_candidate_pool+candidate_role_order",
      order_confidence: "walking_budget_validated",
      routing_source: wr.source || "heuristic",
      estimated_km: wr.estimatedKm,
      estimated_walk_minutes: totalWalkMinutes,
      legs: wr.legs,
      map_path_points: wr.pathPoints,
      ...daypartHonesty,
      caveats,
    };
  }

  // Fallback (no validation supplied): the pre-#261 unvalidated shape.
  const hasSelectedDayHours = stops.some((stop) => Boolean(stop.selected_day_hours));
  return {
    ...base,
    summary:
      "Experimental route composed from trusted source-backed candidates. Stop order is unvalidated; no walking time or current opening state is implied.",
    order_source: "candidate_role_order",
    order_confidence: "unvalidated",
    routing_source: "none",
    caveats: [
      "walking_order_unvalidated",
      "no_walking_time",
      hasSelectedDayHours ? "selected_day_hours_not_live" : "no_opening_hours",
      "experimental",
    ],
  };
}

function sanitizeRouteOrdering(ordering) {
  if (!ordering || typeof ordering !== "object") return null;
  return {
    applied: Boolean(ordering.applied),
    changed: Boolean(ordering.changed),
    source: ordering.source || null,
    confidence: ordering.confidence || null,
    original_stop_ids: Array.isArray(ordering.original_stop_ids) ? ordering.original_stop_ids : [],
    ordered_stop_ids: Array.isArray(ordering.ordered_stop_ids) ? ordering.ordered_stop_ids : [],
    reasons: Array.isArray(ordering.reasons) ? ordering.reasons : [],
    fallback_used: Boolean(ordering.fallback_used),
    fallback_reason: ordering.fallback_reason || null,
    failed_sequence_validation: ordering.failed_sequence_validation || null,
  };
}

// #276 — anchor the day to the trusted current local band by dropping stops
// whose daypart is already fully past. Conservative: never thins the day below
// two stops, and if anchoring would, keeps the full arc untouched (the caller
// then preserves the #275 not-anchored caveat). Only the caller decides WHEN to
// call this (today-dated requests with a known timezone) — this is pure.
function anchorAdaptedBodyToCurrentBand(adaptedBody, currentRank) {
  const stops = Array.isArray(adaptedBody?.stops) ? adaptedBody.stops : [];
  const kept = [];
  const trimmedDayparts = [];
  for (const stop of stops) {
    const daypart = daypartForRole(stop.role || null);
    const rank = timeBandRank(daypart);
    if (rank !== null && rank < currentRank) {
      if (!trimmedDayparts.includes(daypart)) trimmedDayparts.push(daypart);
    } else {
      kept.push(stop);
    }
  }
  if (kept.length < 2 || kept.length === stops.length) {
    return { anchored: false, adaptedBody, trimmedDayparts: [] };
  }
  return {
    anchored: true,
    trimmedDayparts,
    adaptedBody: {
      ...adaptedBody,
      stops: kept,
      stop_ids: kept.map((s) => s.candidate_id || s.id || s.place_id).filter(Boolean),
      target_roles: kept.map((s) => s.role).filter(Boolean),
    },
  };
}

// Engine-compose equivalent of #276. Trim the trusted source reservoir BEFORE
// route composition so geometry, legs, and walking truth are recomputed over the
// actual time-appropriate stops. If fewer than two candidates remain, keep the
// full reservoir and let the shared honesty fields explain that the full-day arc
// precedes local time rather than fabricating a thin route.
function anchorSourceCandidatesToCurrentBand(sourceCandidates, currentRank) {
  const candidates = Array.isArray(sourceCandidates) ? sourceCandidates : [];
  const kept = [];
  const trimmedDayparts = [];
  for (const candidate of candidates) {
    const role = candidate?.role || (Array.isArray(candidate?.route_roles) ? candidate.route_roles[0] : null);
    const daypart = daypartForRole(role || null);
    const rank = timeBandRank(daypart);
    if (rank !== null && rank < currentRank) {
      if (!trimmedDayparts.includes(daypart)) trimmedDayparts.push(daypart);
    } else {
      kept.push(candidate);
    }
  }
  if (kept.length < 2 || kept.length === candidates.length) {
    return { anchored: false, candidates, trimmedDayparts: [] };
  }
  return { anchored: true, candidates: kept, trimmedDayparts };
}

function buildRouteDaypartHonesty({
  daypartArc,
  currentTimeBand = null,
  anchoredToLocalTime = false,
  trimmedDayparts = [],
} = {}) {
  const arc = (Array.isArray(daypartArc) ? daypartArc : []).filter(Boolean);
  const currentRank = timeBandRank(currentTimeBand);
  const earliestRank = arc.length ? timeBandRank(arc[0]) : null;
  const caveats = [];
  if (anchoredToLocalTime) caveats.push("day_anchored_to_current_time");
  if (!anchoredToLocalTime && currentRank !== null && earliestRank !== null && earliestRank < currentRank) {
    caveats.push("daypart_arc_precedes_local_time");
  }
  return {
    daypart_arc: arc,
    current_local_time_band: currentRank !== null ? currentTimeBand : null,
    anchored_to_local_time: Boolean(anchoredToLocalTime),
    trimmed_dayparts: Array.isArray(trimmedDayparts) ? [...new Set(trimmedDayparts.filter(Boolean))] : [],
    caveats,
  };
}

function buildGateDiagnostic(stop) {
  const admission = stop?.experimental_admission;
  const admitted = Boolean(admission && admission.allowed === true);
  const localFeelReasons = Array.isArray(stop?.local_feel_reasons) ? stop.local_feel_reasons : [];
  // #272 — a gate-passing external candidate can still be a chain or a
  // secondary-type pick; surface that honestly on any selected stop that has a
  // local-feel signal, not only experimentally admitted ones. Stops with
  // neither admission nor a local-feel signal stay out of the diagnostics list
  // (today's behavior).
  if (!admitted && !localFeelReasons.length) return null;
  const diagnostic = {
    candidate_id: stop.candidate_id || null,
    role: stop.role || null,
  };
  if (admitted) {
    diagnostic.policy = admission.policy || "experimental_inferred_external";
    diagnostic.reasons = Array.isArray(admission.reasons) ? admission.reasons : [];
    diagnostic.gate_reasons = Array.isArray(admission.gate_reasons) ? admission.gate_reasons : [];
  }
  if (localFeelReasons.length) diagnostic.local_feel_reasons = localFeelReasons;
  return diagnostic;
}

/**
 * A minimal, clearly-experimental day for an unknown/non-citypack place whose
 * baseline returned `days: []`. It intentionally does NOT mimic a finalized
 * Planner day: no date_signals, no dayflow_context, no alternatives.
 */
function buildExperimentalDay({ date, primaryRoute }) {
  return {
    date: date || null,
    experimental: true,
    experimental_agnostic_day: true,
    source: "agnostic_route_output_experiment",
    note: "Experimental any-place candidate day — not a finalized Parranda planner day.",
    primary_route: primaryRoute,
    alternatives: [],
  };
}

/**
 * Deep-clone the baseline result, then either replace days[0].primary_route or
 * synthesize a minimal experimental first day. The original is never mutated.
 */
function applyRouteMutation({ baselineResult, primaryRoute, date }) {
  const clone = deepClone(baselineResult);
  const days = Array.isArray(clone.days) ? clone.days : [];

  if (days[0] && days[0].primary_route) {
    days[0].primary_route = primaryRoute;
    days[0].experimental_agnostic_route_applied = true;
    clone.days = days;
  } else {
    clone.days = [buildExperimentalDay({ date, primaryRoute }), ...days.slice(1)];
  }
  return clone;
}

/**
 * Build the public root for an engaged any-place experiment.
 *
 * The normal Planner baseline may come from the default city when no `city` was
 * supplied. That baseline remains useful inside the experiment's comparison
 * block, but it must never survive as the public any-place result. In
 * particular, a non-promoted experiment has no public day, and a promoted route
 * must not inherit the fallback city's identity, home base, or readiness.
 */
function buildAgnosticPublicResult({
  result,
  routeApplied = false,
  requestedCity = null,
  cityFallbackUsed = false,
} = {}) {
  const publicResult = deepClone(result || {});
  publicResult.city = requestedCity || null;
  publicResult.requested_city = requestedCity || null;
  publicResult.city_fallback_used = Boolean(requestedCity && cityFallbackUsed);
  publicResult.resolved_home_base = null;
  publicResult.resolved_start = null;
  publicResult.resolved_end = null;
  publicResult.readiness = null;
  if (!routeApplied) {
    publicResult.days = [];
  }
  return publicResult;
}

function buildExperimentBlock({
  routeMutation,
  eligibility,
  baselineResult,
  candidateReadiness,
  experimentalRoute,
  sourceStatus,
  walkingValidation = null,
  routeOrdering = null,
  context = null,
  dayflowContextPresent = false,
  requestedDate = null,
}) {
  const baselineDay = baselineResult && Array.isArray(baselineResult.days) ? baselineResult.days[0] : null;
  const block = {
    experimental: true,
    route_mutation: routeMutation,
    selected_variant: routeMutation ? "experimental_agnostic" : "baseline",
    source: "trusted_candidate_pool",
    source_status: sourceStatus || null,
    eligibility,
    baseline: {
      had_primary_route: Boolean(baselineDay && baselineDay.primary_route),
      primary_route: (baselineDay && baselineDay.primary_route) || null,
      readiness: (baselineResult && baselineResult.readiness) || null,
    },
    candidate_readiness: candidateReadiness || null,
    experimental_route: routeMutation ? experimentalRoute : null,
    readiness_blockers: eligibility.blockers,
    caveats: eligibility.caveats,
  };
  block.readiness_calibration = calibrateAgnosticRouteReadiness({
    routeMutation,
    eligibility,
    candidateReadiness,
    experimentalRoute,
    sourceStatus,
    walkingValidation,
    routeOrdering,
    context,
    dayflowContextPresent,
    requestedDate,
  });
  return block;
}

function buildBlockedAgnosticRouteOutputExperiment({ baselineResult, blocker, sourceStatus = null }) {
  return buildExperimentBlock({
    routeMutation: false,
    eligibility: {
      eligible: false,
      blockers: [blocker],
      caveats: [],
      checks: {},
    },
    baselineResult,
    candidateReadiness: null,
    experimentalRoute: null,
    sourceStatus,
  });
}

/**
 * Compose the agnostic route-output experiment.
 *
 * @returns {Promise<{ result: object, experiment: object }>} `result` is the
 *   baseline (unchanged) when not eligible, or a deep-cloned mutated/synthesized
 *   result when eligible. `experiment` is the top-level diagnostics block.
 */
async function composeAgnosticRouteOutput({
  coords,
  baselineResult,
  externalRequested = false,
  openDataLoader = null,
  preferences = [],
  lens = null,
  date = null,
  todayIsoDate = null,
  timezone = "UTC",
  lang = "en",
  walkingRouter = null,
  walkingConfig = null,
  walkingBudget = null,
  walkingKmTarget = null,
  // #262 — trusted context seams. Public payload weather is NEVER trusted; the
  // weather/time context comes only from these server-injected sources.
  weatherProvider = null,
  clock = null,
  trustedTimezone = null,
  placeLabel = null,
  anchorMode = "unknown",
  spatialScope = null,
  // Synthesis backend. "engine" routes the admitted candidates through the
  // route engine's own agnostic_compose (the convergence path); "legacy" keeps
  // the in-module experimental synthesizer (default, so existing callers/tests
  // are unchanged). The legacy synthesizer is staged for removal once the engine
  // path is proven in production.
  synthesizeVia = "legacy",
}) {
  const agnosticLabel = safeAgnosticPlaceLabel(placeLabel);
  const agnosticContext = buildAgnosticCityContext({
    lat: coords.lat,
    lng: coords.lng,
    ...(agnosticLabel ? { label: agnosticLabel } : {}),
    timezone: timezone || "UTC",
    todayIsoDate: typeof todayIsoDate === "function" ? todayIsoDate : todayIsoDate || undefined,
  });
  const origin = { lat: coords.lat, lng: coords.lng };
  const effectiveDate = date || agnosticContext.todayIsoDate();

  const { helpers, sourceStatus } = await resolveTrustedHelpers({
    externalRequested,
    openDataLoader,
    anchor: origin,
    requestedIntents: preferences,
    anchorMode,
    spatialScope,
  });

  // #262 / correction #5 — only resolve trusted context (which may fetch weather)
  // when we will actually run trusted candidate selection. When a hard blocker is
  // already known (no external opt-in, or the loader skipped/empty/errored), skip
  // the weather call; context is never an eligibility substitute.
  const loaderStatus = (sourceStatus && sourceStatus.status) || "skipped";
  const willRunTrustedSelection =
    Boolean(externalRequested) && typeof loaderStatus === "string" && loaderStatus.startsWith("loaded:") && loaderStatus !== "loaded:0";
  const ctx = willRunTrustedSelection
    ? await resolveAgnosticContext({
        coords,
        date: effectiveDate,
        trustedTimezone,
        weatherProvider,
        clock,
        lang,
        cityLabel: agnosticContext.label,
      })
    : null;

  const rolePayload = {
    city: agnosticContext.key,
    date: effectiveDate,
    preferences: Array.isArray(preferences) ? preferences : [],
    lens: lens || null,
    // Trusted weather only — payload weather is never consulted.
    weather: ctx ? ctx.weather || null : null,
    origin,
    // Trusted time only, in the candidate-pool's expected payload format
    // (`hour` number + ISO `now`), and only when the timezone is known.
    ...(ctx && ctx.timezoneKnown ? { hour: ctx.hour, now: ctx.now } : {}),
    // Signal the engine's external opt-in so the source-backed provider runs.
    include_external_candidates: externalRequested ? 1 : undefined,
    candidate_sources: externalRequested ? "open" : undefined,
  };

  // #262 — time-of-day may influence selection ONLY when a trusted timezone is
  // known. Otherwise, explicitly disable the candidate-pool's fallback now/time
  // context so it never synthesizes a midday band that would tilt scoring. This
  // applies only to this flag-gated agnostic path (default citypack/blitz flows
  // never pass through here, so their time behavior is untouched).
  const trustedTimeKnown = Boolean(ctx && ctx.timezoneKnown);
  const availabilityWindow = trustedTimeKnown
    ? buildLocalDayAvailabilityWindow({ requestedDate: effectiveDate, nowLocalIso: ctx.now })
    : null;
  const availabilityHelpers = availabilityWindow
    ? {
        evaluateCandidateAvailability: ({ candidate }) => {
          if (typeof candidate?.opening_hours !== "string") return null;
          const availability = evaluateOpeningHoursForWindow(candidate.opening_hours, availabilityWindow);
          const selectedDayHours = buildSelectedDayHoursFact(candidate.opening_hours, availabilityWindow);
          return selectedDayHours
            ? { ...availability, selected_day_hours: selectedDayHours }
            : availability;
        },
      }
    : {};
  const candidateReachPolicy = resolveAgnosticCandidateReachPolicy({ anchorMode, spatialScope });
  const selectionHelpers = trustedTimeKnown
    ? {
        ...helpers,
        ...availabilityHelpers,
        ...(candidateReachPolicy ? { candidateReachPolicy } : {}),
        experimentalAdmitCandidate: admitExperimentalInferredExternalCandidate,
      }
    : {
        ...helpers,
        ...(candidateReachPolicy ? { candidateReachPolicy } : {}),
        experimentalAdmitCandidate: admitExperimentalInferredExternalCandidate,
        resolveNowContext: (cfg, pl) => ({
          date: (pl && pl.date) || cfg.todayIsoDate(),
          hour: null,
          weekday: null,
          now_iso: null,
        }),
        resolveTimeBand: () => null,
      };

  const plannerRoles = selectPlannerRoleCandidates(agnosticContext, rolePayload, selectionHelpers);
  const dayflowHonesty = summarizeDayflowHonesty(plannerRoles);
  const candidateCombination = buildCandidateCombinationInspect({
    plannerRoles,
    dayflowHonesty,
    route: null,
    options: {
      origin,
      // Exact coordinates and local place scopes keep the composed day within
      // walking reach of the trusted anchor. Resolver-attested municipality or
      // region scopes deliberately retain wider flexibility for rural/regional
      // discovery where a useful day need not sit in one town centre.
      ...(candidateReachPolicy
        ? { maxOriginDistanceKm: candidateReachPolicy.max_origin_distance_km }
        : {}),
    },
  });
  const adapted = buildRouteCandidateFromCandidateCombination({
    city: agnosticContext.key,
    candidateCombination,
  });
  const adaptedBody = adapted && adapted.body ? adapted.body : {};
  const engineSourceCandidates = synthesizeVia === "engine"
    ? mapPlannerReservoirToSourceCandidates({
        selected: (candidateCombination && candidateCombination.selected) || [],
        plannerRoles,
        city: agnosticContext.key,
      })
    : null;

  // #262 — the trusted-context surface (or a cheap "skipped" marker when a hard
  // blocker meant no trusted selection ran). When context ran, explain how it
  // influenced composition via the SELECTED candidates' weather/time fit reasons.
  const contextBlock = ctx ? ctx.contextBlock : buildSkippedContextBlock({ loaderStatus, externalRequested });
  if (ctx) {
    const influence = collectInfluenceReasons(plannerRoles, candidateCombination);
    contextBlock.influence.weather_fit_reasons = influence.weather;
    contextBlock.influence.time_fit_reasons = influence.time;
    if (plannerRoles.availability_summary) {
      const summary = plannerRoles.availability_summary;
      contextBlock.influence.opening_hours_fed_into_selection = summary.evaluated_candidate_count > 0;
      contextBlock.influence.opening_hours_excluded_candidate_count = summary.excluded_candidate_count;
      contextBlock.influence.opening_hours_unresolved_candidate_count = summary.unresolved_candidate_count;
    }
  }

  const providerSpecs = buildProviderSpecs({
    externalEnabled: Boolean(externalRequested),
    externalOptions: helpers.external_provider || null,
    now: effectiveDate,
  });
  const candidateReadiness = safeAssessReadiness(agnosticContext, { providerSpecs });

  const eligibility = evaluateEligibility({
    externalRequested,
    sourceStatus,
    adaptedBody,
    candidateReadiness,
    engineSourceCandidates,
    plannerRoles,
    candidateCombination,
  });

  if (!eligibility.eligible) {
    const experiment = buildExperimentBlock({
      routeMutation: false,
      eligibility,
      baselineResult,
      candidateReadiness,
      experimentalRoute: null,
      sourceStatus,
      context: contextBlock,
      requestedDate: effectiveDate,
    });
    experiment.context = contextBlock;
    return { result: baselineResult, experiment };
  }

  // Local-time comparison is meaningful only for a today-dated request with a
  // trusted timezone. The same context drives both synthesis backends so the
  // promoted engine route cannot lose the legacy path's honesty contract.
  const trustedBand = ctx && ctx.timezoneKnown ? ctx.timeBand : null;
  const trustedBandRank = timeBandRank(trustedBand);
  const isTodayRequest = Boolean(
    ctx && ctx.timezoneKnown && typeof ctx.now === "string" && effectiveDate === ctx.now.slice(0, 10),
  );
  const routeCurrentBand = isTodayRequest ? trustedBand : null;

  // Convergence path: synthesize the route through the engine's own
  // agnostic_compose instead of the in-module experimental synthesizer. The
  // admitted candidates become the engine's source candidates; the engine owns
  // geometry/ordering/walking-truth and the honesty markers. Daypart rhythm
  // (#274–278) is preserved as a label, not the sequencer (follow-up promotes it
  // into compose ordering).
  if (synthesizeVia === "engine") {
    return composeAgnosticRouteViaEngine({
      agnosticContext,
      origin,
      effectiveDate,
      plannerRoles,
      candidateCombination,
      sourceCandidates: engineSourceCandidates,
      eligibility,
      candidateReadiness,
      sourceStatus,
      contextBlock,
      ctx,
      baselineResult,
      walkingKmTarget: Number.isFinite(walkingKmTarget) ? walkingKmTarget : undefined,
      preferences,
      timezone: contextBlock?.time?.timezone || timezone,
      lang,
      currentTimeBand: routeCurrentBand,
      currentTimeBandRank: isTodayRequest ? trustedBandRank : null,
      // Pass ONLY the resolver-attested label (may be null). The prose builder
      // must fall back to neutral, never to agnosticContext.label — which is the
      // "Nearby" geometry placeholder, not a real place name.
      placeLabel: agnosticLabel,
    });
  }

  // #276 — time-anchored selection. ONLY for a today-dated request with a
  // trusted timezone: drop stops whose daypart is already fully past so the day
  // starts at "now" instead of always at the morning. A future-dated request is
  // a plan — keep the full arc untouched. Conservative: anchoring never thins
  // the day below two stops (else the full arc is kept + the #275 caveat stands).
  let workingBody = adaptedBody;
  let anchoredToLocalTime = false;
  let trimmedDayparts = [];
  if (isTodayRequest && trustedBandRank !== null) {
    const anchored = anchorAdaptedBodyToCurrentBand(adaptedBody, trustedBandRank);
    if (anchored.anchored) {
      workingBody = anchored.adaptedBody;
      anchoredToLocalTime = true;
      trimmedDayparts = anchored.trimmedDayparts;
    }
  }
  // The arc-vs-now caveat (#275) is only meaningful for a today-dated request:
  // for a future plan, leading with the morning is correct, not "already past".
  // The route candidate arrives in role order. For the flag-gated experiment we
  // may apply a conservative daypart-rhythm sequence, then validate that produced
  // order against walking budgets before any mutation. If the sequence fails
  // but the original role order validates, fall back to the original order.
  const orderingAttempt = buildAgnosticRouteOrdering({ adaptedBody: workingBody });
  let finalAdaptedBody = orderingAttempt.adaptedBody;
  let routeOrdering = orderingAttempt.ordering;
  let walking = await validateAgnosticWalkingOrder({
    stops: toWalkingStops(finalAdaptedBody),
    walkingRouter,
    walkingConfig: walkingConfig || {},
    budget: walkingBudget || {},
    targetKm: walkingKmTarget,
  });

  if (!walking.valid && routeOrdering && routeOrdering.applied) {
    const failedSequenceValidation = { valid: walking.valid, blockers: walking.blockers, checks: walking.checks };
    // Fall back to the (anchored) role order, not the full pre-anchor set.
    const originalWalking = await validateAgnosticWalkingOrder({
      stops: toWalkingStops(workingBody),
      walkingRouter,
      walkingConfig: walkingConfig || {},
      budget: walkingBudget || {},
      targetKm: walkingKmTarget,
    });
    if (originalWalking.valid) {
      finalAdaptedBody = workingBody;
      walking = originalWalking;
      routeOrdering = {
        ...routeOrdering,
        applied: false,
        changed: false,
        source: "trusted_candidate_pool+candidate_role_order",
        confidence: "role_order_fallback",
        ordered_stop_ids: routeOrdering.original_stop_ids,
        fallback_used: true,
        fallback_reason: "daypart_sequence_failed_walking_validation",
        failed_sequence_validation: failedSequenceValidation,
        reasons: dedupe([...(routeOrdering.reasons || []), "fallback_to_candidate_role_order"]),
      };
    } else {
      walking = {
        ...originalWalking,
        blockers: dedupe([...(walking.blockers || []), ...(originalWalking.blockers || [])]),
      };
      routeOrdering = {
        ...routeOrdering,
        failed_sequence_validation: failedSequenceValidation,
      };
    }
  }

  const walkingSummary = { valid: walking.valid, blockers: walking.blockers, checks: walking.checks };

  if (!walking.valid) {
    // Trusted candidates were eligible, but their existing order failed walking
    // validation → no route. Baseline unchanged; explicit walking blockers.
    const walkingFailedEligibility = {
      ...eligibility,
      eligible: false,
      blockers: dedupe([...eligibility.blockers, ...walking.blockers]),
    };
    const experiment = buildExperimentBlock({
      routeMutation: false,
      eligibility: walkingFailedEligibility,
      baselineResult,
      candidateReadiness,
      experimentalRoute: null,
      sourceStatus,
      walkingValidation: walkingSummary,
      routeOrdering: sanitizeRouteOrdering(routeOrdering),
      context: contextBlock,
      requestedDate: effectiveDate,
    });
    experiment.walking_validation = walkingSummary;
    experiment.route_ordering = sanitizeRouteOrdering(routeOrdering);
    experiment.context = contextBlock;
    return { result: baselineResult, experiment };
  }

  const experimentalRoute = buildExperimentalPrimaryRoute({
    cityKey: agnosticContext.key,
    adaptedBody: finalAdaptedBody,
    walkingValidation: walking,
    routeOrdering,
    // #275/#276 — the band is comparison-relevant ONLY for a today-dated request
    // (null for a future plan or unknown tz, so no spurious not-anchored caveat).
    currentTimeBand: routeCurrentBand,
    // #276 — whether the day was trimmed to start at the current local band.
    anchoredToLocalTime,
    trimmedDayparts,
  });
  const mutated = applyRouteMutation({ baselineResult, primaryRoute: experimentalRoute, date: effectiveDate });

  // #262 — attach an honest day-level dayflow read when the trusted weather is
  // dayflow-relevant (buildDayflowContext returns null on boring weather). Live
  // is always empty for any-place context (no trusted live source).
  if (ctx && ctx.weather && mutated.days && mutated.days[0]) {
    const dayflow = buildDayflowContext({
      weather: ctx.weather,
      liveEvents: [],
      primaryRoute: experimentalRoute,
      date: effectiveDate,
      cityConfig: agnosticContext,
      lang,
    });
    if (dayflow) {
      mutated.days[0].dayflow_context = dayflow;
    }
  }
  const dayflowContextPresent = Boolean(mutated.days && mutated.days[0] && mutated.days[0].dayflow_context);

  const experiment = buildExperimentBlock({
    routeMutation: true,
    eligibility,
    baselineResult,
    candidateReadiness,
    experimentalRoute,
    sourceStatus,
    walkingValidation: walkingSummary,
    routeOrdering: sanitizeRouteOrdering(routeOrdering),
    context: contextBlock,
    dayflowContextPresent,
    requestedDate: effectiveDate,
  });
  experiment.walking_validation = walkingSummary;
  experiment.route_ordering = sanitizeRouteOrdering(routeOrdering);
  experiment.context = contextBlock;
  return {
    result: mutated,
    experiment,
  };
}

// Convergence synthesizer: route the admitted candidates through the route
// engine's own agnostic_compose. The engine owns geometry/ordering/walking-truth
// and stamps the honesty markers (routing_source "agnostic_compose",
// confidence "low", provisional stops). Calibration + the experiment block are
// computed the same way as the legacy path, so the promotion gate and inspect
// surfaces see an identical shape.
async function composeAgnosticRouteViaEngine({
  agnosticContext,
  origin,
  effectiveDate,
  plannerRoles,
  candidateCombination,
  sourceCandidates: suppliedSourceCandidates,
  eligibility,
  candidateReadiness,
  sourceStatus,
  contextBlock,
  baselineResult,
  walkingKmTarget,
  preferences,
  timezone,
  lang,
  currentTimeBand = null,
  currentTimeBandRank = null,
  placeLabel,
}) {
  const sourceCandidates = Array.isArray(suppliedSourceCandidates)
    ? suppliedSourceCandidates
    : mapPlannerReservoirToSourceCandidates({
        selected: (candidateCombination && candidateCombination.selected) || [],
        plannerRoles,
        city: agnosticContext.key,
      });
  const timeAnchoring = Number.isInteger(currentTimeBandRank)
    ? anchorSourceCandidatesToCurrentBand(sourceCandidates, currentTimeBandRank)
    : { anchored: false, candidates: sourceCandidates, trimmedDayparts: [] };

  async function runEngine(candidates) {
    const engineCityConfig = buildAgnosticEngineCityConfig({
      anchor: origin,
      sourceCandidates: candidates,
      timezone: timezone || "UTC",
      todayIsoDate: agnosticContext.todayIsoDate,
      label: safeAgnosticPlaceLabel(placeLabel) || agnosticContext.label,
      key: agnosticContext.key,
      dayProfile: (Number.isFinite(walkingKmTarget) ? walkingKmTarget : 6) <= 4 ? "light" : "peak",
    });
    const engineResult = await generateAgnosticRecommendations({
      cityConfig: engineCityConfig,
      dates: [effectiveDate],
      start: { type: "auto" },
      end: { type: "auto" },
      walkingKmTarget: Number.isFinite(walkingKmTarget) ? walkingKmTarget : 6,
      preferences: Array.isArray(preferences) ? preferences : [],
      lang,
    });
    return sanitizeAgnosticEngineDay({
      day: (engineResult && Array.isArray(engineResult.days) && engineResult.days[0]) || null,
      // Route PROSE uses the attested label or neutral fallback — never the
      // "Nearby" geometry placeholder from the coordinates-only config.
      placeLabel: safeAgnosticPlaceLabel(placeLabel),
      lang,
    });
  }

  let anchoredToLocalTime = timeAnchoring.anchored;
  let trimmedDayparts = timeAnchoring.trimmedDayparts;
  let engineDay = await runEngine(timeAnchoring.candidates);
  let engineRoute = (engineDay && engineDay.primary_route) || null;
  if (!engineRoute && anchoredToLocalTime) {
    // A smaller time-anchored reservoir may still fail the engine's independent
    // geometry/readiness checks. Keep the full-day route if it is viable, but do
    // not claim it is anchored; the caveat below makes that limitation explicit.
    engineDay = await runEngine(sourceCandidates);
    engineRoute = (engineDay && engineDay.primary_route) || null;
    anchoredToLocalTime = false;
    trimmedDayparts = [];
  }

  if (engineRoute) {
    const daypartHonesty = buildRouteDaypartHonesty({
      daypartArc: engineRoute.daypart_arc,
      currentTimeBand,
      anchoredToLocalTime,
      trimmedDayparts,
    });
    Object.assign(engineRoute, daypartHonesty, {
      caveats: dedupe([...(Array.isArray(engineRoute.caveats) ? engineRoute.caveats : []), ...daypartHonesty.caveats]),
    });
  }

  // No coherent walk (engine returns < 2 viable stops → null route). Honest
  // empty; baseline unchanged, explicit thin blocker.
  if (!engineRoute) {
    const thinEligibility = {
      ...eligibility,
      eligible: false,
      blockers: dedupe([...(eligibility.blockers || []), "agnostic_compose_too_thin"]),
    };
    const experiment = buildExperimentBlock({
      routeMutation: false,
      eligibility: thinEligibility,
      baselineResult,
      candidateReadiness,
      experimentalRoute: null,
      sourceStatus,
      context: contextBlock,
      requestedDate: effectiveDate,
    });
    experiment.context = contextBlock;
    experiment.synthesized_via = "agnostic_compose_engine";
    return { result: baselineResult, experiment };
  }

  // Engine geometry owns the actual stop order. Daypart rhythm (#274–278) is a
  // label here, not the sequencer — promoting it into compose ordering is a
  // follow-up, so we record the intent honestly rather than fabricate an arc.
  const routeOrdering = {
    source: "engine_geometry",
    applied: false,
    changed: false,
    confidence: "engine_compose",
    daypart_arc: null,
    reasons: ["engine_geometry_ordering", "daypart_promotion_pending"],
  };
  // The engine only returns a route after its own walking-truth pass, so a
  // present route is walking-coherent. We do not claim a budget check the engine
  // did not run; the source string marks where validation came from.
  const walkingSummary = {
    valid: true,
    blockers: [],
    checks: { walking_source: engineRoute.routing_source || "agnostic_compose" },
  };
  const dayflowContextPresent = Boolean(engineDay.dayflow_context);

  const experiment = buildExperimentBlock({
    routeMutation: true,
    eligibility,
    baselineResult,
    candidateReadiness,
    experimentalRoute: engineRoute,
    sourceStatus,
    walkingValidation: walkingSummary,
    routeOrdering,
    context: contextBlock,
    dayflowContextPresent,
    requestedDate: effectiveDate,
  });
  experiment.walking_validation = walkingSummary;
  experiment.route_ordering = routeOrdering;
  experiment.context = contextBlock;
  experiment.synthesized_via = "agnostic_compose_engine";

  const result = applyRouteMutation({ baselineResult, primaryRoute: engineRoute, date: effectiveDate });
  // scrubAgnosticAppliedDay is the single owner of the promoted day's fallback-
  // sensitive fields (date_signals, alternatives, live_events, dayflow_context).
  scrubAgnosticAppliedDay(result, engineDay);

  return { result, experiment };
}

function sanitizeAgnosticEngineDay({ day, placeLabel, lang }) {
  if (!day || typeof day !== "object") return day;
  const cleaned = deepClone(day);
  cleaned.date_signals = [];
  if (cleaned.primary_route) {
    cleaned.primary_route = sanitizeAgnosticEngineRoute({
      route: cleaned.primary_route,
      placeLabel,
      lang,
    });
  }
  return cleaned;
}

function sanitizeAgnosticEngineRoute({ route, placeLabel, lang }) {
  if (!route || typeof route !== "object") return route;
  const cleaned = deepClone(route);
  const prose = buildAgnosticRouteProse({ placeLabel, lang });
  cleaned.title = prose.title;
  cleaned.summary = prose.summary;
  cleaned.why_recommended = prose.why_recommended;
  cleaned.agnostic_route_prose = true;
  return cleaned;
}

function scrubAgnosticAppliedDay(result, engineDay) {
  if (!result || !Array.isArray(result.days) || !result.days[0]) return;
  const day = result.days[0];
  // applyRouteMutation only REPLACES days[0].primary_route; every other day-level
  // field survives from the baseline fallback day. On the any-place path those
  // belong to the fallback CITY (e.g. a Malmö request whose baseline was Rome),
  // so the promoted agnostic day must not carry them until the agnostic engine
  // owns a trusted source for each:
  //   - date_signals: fallback city's seasonal signals ("Sommarkväll i Rom").
  //   - alternatives: fallback city's alternate routes (the engine emits ONE
  //     route, never alternatives, so these are ALWAYS the baseline's).
  //   - live_events: fallback city's per-day events. The CORRECT agnostic events
  //     ride the top-level `live_events` sidecar (geo-keyed to the anchor); this
  //     per-day copy is unconsumed leakage. Delete it, never the sidecar.
  //   - dayflow_context: the fallback city's weather read. The engine-compose
  //     path does not (yet) produce an anchor weather read, so a surviving
  //     baseline dayflow would show the WRONG city's weather (e.g. Rome's "37°"
  //     on a Helsinki day) — the frontend renders it as "Dagens läsning". Use
  //     the engine's when it has one, otherwise DELETE it: an honest absence,
  //     never another place's weather.
  day.date_signals = [];
  day.alternatives = [];
  delete day.live_events;
  if (engineDay && engineDay.dayflow_context) {
    day.dayflow_context = engineDay.dayflow_context;
  } else {
    delete day.dayflow_context;
  }
}

function buildAgnosticRouteProse({ placeLabel, lang }) {
  const sv = String(lang || "").toLowerCase().startsWith("sv");
  const label = safeAgnosticPlaceLabel(placeLabel) || (sv ? "platsen" : "this place");
  return sv
    ? {
        title: `Plan för ${label}`,
        summary: `Byggd från källstödda platser nära ${label}; täckningen kan vara tunnare än i en fullt kurerad Parranda-stad.`,
        why_recommended: `Rutten använder källstödda stopp som matchar dina val nära ${label}, med provisorisk tillit där katalogen är tunn.`,
      }
    : {
        title: `Plan for ${label}`,
        summary: `Built from source-backed places near ${label}; coverage may be thinner than in a fully curated Parranda city.`,
        why_recommended: `The route uses source-backed stops that match your choices near ${label}, with provisional trust where the catalog is thin.`,
      };
}

function safeAgnosticPlaceLabel(value) {
  if (typeof value !== "string") return null;
  // A resolver label is often a full display name ("Malmö, Malmö kommun, Skåne
  // län, Sverige"). Route prose reads as Parranda's own voice, so take just the
  // primary locality (the first comma-segment) — "Plan för Malmö", not the whole
  // administrative chain.
  const cleaned = value.split(",")[0].replace(/\s+/g, " ").trim();
  if (!cleaned) return null;
  return cleaned.slice(0, 80);
}

function toWalkingStops(adaptedBody) {
  return (Array.isArray(adaptedBody?.stops) ? adaptedBody.stops : []).map((stop) => ({
    lat: stop.coordinates && Number.isFinite(stop.coordinates.lat) ? stop.coordinates.lat : null,
    lng: stop.coordinates && Number.isFinite(stop.coordinates.lng) ? stop.coordinates.lng : null,
    label: stop.label || null,
    id: stop.candidate_id || null,
  }));
}

// A cheap context marker for paths where a hard blocker meant we never ran
// trusted selection (so no weather/time was fetched). Honest about the skip.
function buildSkippedContextBlock({ loaderStatus, externalRequested }) {
  const reason = !externalRequested
    ? "external_candidates_not_requested"
    : LOADER_BLOCKERS[loaderStatus] || "context_not_resolved";
  return {
    status: "skipped",
    reason,
    time: {
      timezone: null,
      timezone_known: false,
      timezone_source: null,
      timezone_trust: "unavailable",
      status: "timezone_unavailable",
      now: null,
      time_band: null,
    },
    weather: { status: "skipped", read: null },
    computed_signals: [],
    live: { available: false, reason: "no_any_place_live_source" },
    influence: { weather_fed_into_selection: false, time_fed_into_selection: false, weather_fit_reasons: [], time_fit_reasons: [] },
  };
}

function deepClone(value) {
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value));
}

function dedupe(list) {
  return [...new Set(list)];
}

module.exports = {
  composeAgnosticRouteOutput,
  resolveTrustedHelpers,
  evaluateEligibility,
  buildExperimentalPrimaryRoute,
  buildExperimentalDay,
  applyRouteMutation,
  buildAgnosticPublicResult,
  buildExperimentBlock,
  buildBlockedAgnosticRouteOutputExperiment,
  admitExperimentalInferredExternalCandidate,
  scrubAgnosticAppliedDay,
  MIN_VIABLE_GEOCODED_STOPS,
};
