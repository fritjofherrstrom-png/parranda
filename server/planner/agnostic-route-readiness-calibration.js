/**
 * Conservative readiness calibration for the flag-gated agnostic route output.
 *
 * This does not make a route more true, ranked, fast, or ready for default
 * Planner use. It only explains how much trust the experimental output has
 * based on already-trusted server-side facts. Keep this helper post-hoc:
 * evidence in, verdict out.
 */

const ENVIRONMENT_BLOCKERS = new Set(["no_trusted_loader", "place_resolver_unavailable"]);
const NOT_APPLICABLE_BLOCKERS = new Set(["external_candidates_not_requested"]);

const WALKING_BLOCKERS = new Set([
  "walking_route_unavailable",
  "invalid_walking_coordinates",
  "invalid_walking_leg_count",
  "invalid_walking_path_points",
  "walking_validation_failed",
  "walking_budget_exceeded",
  "walking_leg_budget_exceeded",
]);

const CAP_TOKENS = {
  heuristicWalking: "capped_by_heuristic_walking",
  roleOrderFallback: "capped_by_role_order_fallback",
  derivedTimezone: "capped_by_derived_timezone",
  partialContext: "capped_by_partial_context",
  unresolvedRoles: "capped_by_unresolved_roles",
  externalOnlySources: "capped_by_external_only_sources",
  belowPlannerCandidateThreshold: "capped_by_below_planner_candidate_threshold",
  thinDay: "capped_by_thin_day",
  remainingDayShortRoute: "capped_by_remaining_day_short_route",
};

// A produced route with this few stops is a minimal day, not a full one — even
// with strong sources and context it should read thin_usable, never usable.
// (#281: closes the #276 review note — a time-anchored evening day trims to
// food + bar and used to read usable/medium.)
const THIN_DAY_STOP_THRESHOLD = 2;

function calibrateAgnosticRouteReadiness({
  routeMutation = false,
  eligibility = null,
  candidateReadiness = null,
  experimentalRoute = null,
  sourceStatus = null,
  walkingValidation = null,
  routeOrdering = null,
  context = null,
  dayflowContextPresent = false,
  requestedDate = null,
} = {}) {
  const blockers = unique([
    ...(Array.isArray(eligibility?.blockers) ? eligibility.blockers : []),
    ...(Array.isArray(walkingValidation?.blockers) ? walkingValidation.blockers : []),
  ]);
  const caveats = unique([
    ...(Array.isArray(eligibility?.caveats) ? eligibility.caveats : []),
    ...(Array.isArray(experimentalRoute?.caveats) ? experimentalRoute.caveats : []),
  ]);
  const stops = Array.isArray(experimentalRoute?.main_stops) ? experimentalRoute.main_stops : [];
  const contextTime = context?.time || {};
  const contextInfluence = context?.influence || {};
  const walkingChecks = walkingValidation?.checks || {};

  const inputs = {
    loader_status: sourceStatus?.status || null,
    real_place_count: finiteOrNull(candidateReadiness?.real_place_count),
    coordinate_coverage: finiteOrNull(candidateReadiness?.coordinate_coverage),
    can_support_planner:
      typeof candidateReadiness?.can_support_planner === "boolean" ? candidateReadiness.can_support_planner : null,
    selected_stop_count: stops.length,
    unresolved_role_count: Array.isArray(experimentalRoute?.unresolved_roles)
      ? experimentalRoute.unresolved_roles.length
      : null,
    source_family_count: countSourceFamilies(candidateReadiness),
    all_external_stops: stops.length > 0 ? stops.every((stop) => isExternalStop(stop)) : null,
    walking_valid: typeof walkingValidation?.valid === "boolean" ? walkingValidation.valid : null,
    walking_source: walkingChecks.walking_source || experimentalRoute?.routing_source || null,
    walking_fallback_used:
      typeof walkingChecks.fallback_used === "boolean"
        ? walkingChecks.fallback_used
        : caveats.includes("walking_router_fallback_used"),
    route_ordering_mode: routeOrdering?.source || experimentalRoute?.order_source || null,
    timezone_source: contextTime.timezone_source || null,
    timezone_trust: contextTime.timezone_trust || "unavailable",
    time_band: contextTime.time_band || null,
    computed_signal_count: Array.isArray(context?.computed_signals) ? context.computed_signals.length : 0,
    weather_fed_into_selection: Boolean(contextInfluence.weather_fed_into_selection),
    time_fed_into_selection: Boolean(contextInfluence.time_fed_into_selection),
    dayflow_context_present: Boolean(dayflowContextPresent),
    requested_date: typeof requestedDate === "string" ? requestedDate : null,
    current_local_date:
      typeof contextTime.now === "string" && /^\d{4}-\d{2}-\d{2}T/.test(contextTime.now)
        ? contextTime.now.slice(0, 10)
        : null,
  };

  const reasons = [];
  const caps = ["experimental_agnostic_route"];

  if (isEnvironmentNotWired({ sourceStatus, blockers })) {
    reasons.push("environment_not_wired", ...blockers.filter((blocker) => ENVIRONMENT_BLOCKERS.has(blocker)));
    if (!reasons.includes("no_trusted_loader") && sourceStatus?.status === "no_loader_configured") {
      reasons.push("no_trusted_loader");
    }
    return {
      status: "environment_not_wired",
      level: "unavailable",
      summary: "The agnostic route experiment could not run because required trusted infrastructure is not wired.",
      reasons: unique(reasons),
      caps: unique(caps),
      inputs,
    };
  }

  if (!routeMutation && isNotApplicable({ sourceStatus, blockers })) {
    reasons.push(...blockers);
    if (!reasons.length) reasons.push("not_applicable");
    return {
      status: "not_applicable",
      level: "unavailable",
      summary: "No agnostic route-readiness calibration applies to this response.",
      reasons: unique(reasons),
      caps: unique(caps),
      inputs,
    };
  }

  if (!routeMutation) {
    reasons.push(...blockerReasons(blockers));
    if (blockers.some((blocker) => WALKING_BLOCKERS.has(blocker))) {
      reasons.push("walking_validation_blocked_route");
    }
    if (blockers.some((blocker) => blocker.includes("geometry"))) {
      reasons.push("geometry_coherence_blocked_route");
    }
    if (blockers.some((blocker) => blocker.includes("candidate") || blocker.includes("records"))) {
      reasons.push("candidate_supply_blocked_route");
    }
    return {
      status: blockers.length ? "blocked" : "not_applicable",
      level: "unavailable",
      summary: blockers.length
        ? "The agnostic route experiment did not return a route; trusted blockers are listed."
        : "No agnostic route-readiness calibration applies to this response.",
      reasons: unique(reasons.length ? reasons : ["not_applicable"]),
      caps: unique(caps),
      inputs,
    };
  }

  reasons.push("experimental_route_produced");
  if (inputs.walking_valid) reasons.push("walking_validated");
  if (isHeuristicWalking(inputs.walking_source) || caveats.includes("heuristic_walking_estimate")) {
    reasons.push("heuristic_walking_estimate");
    caps.push(CAP_TOKENS.heuristicWalking);
  }
  if (inputs.walking_fallback_used) {
    reasons.push("walking_router_fallback_used");
    caps.push(CAP_TOKENS.heuristicWalking);
  }

  // A sequenced order (daypart rhythm + proximity, #274; or the earlier
  // proximity-only mode) that survived walking validation is a readiness signal;
  // a fall back to raw role order after a sequence attempt is a cap.
  const sequencedOrder =
    typeof inputs.route_ordering_mode === "string" &&
    (inputs.route_ordering_mode.includes("daypart_rhythm") || inputs.route_ordering_mode.includes("proximity_sequence"));
  if (sequencedOrder) {
    reasons.push("daypart_ordering_validated");
  } else if (routeOrdering?.fallback_used) {
    reasons.push("role_order_fallback_after_sequence_validation");
    caps.push(CAP_TOKENS.roleOrderFallback);
  }

  if (inputs.timezone_source === "resolver_attested") {
    reasons.push("resolver_attested_timezone");
  } else if (inputs.timezone_source === "weather_provider_auto") {
    reasons.push("weather_provider_auto_timezone");
    caps.push(CAP_TOKENS.derivedTimezone);
  } else {
    reasons.push("timezone_unavailable");
    caps.push(CAP_TOKENS.partialContext);
  }

  if (inputs.weather_fed_into_selection) reasons.push("weather_context_used");
  if (inputs.time_fed_into_selection) reasons.push("time_context_used");
  if (!inputs.time_fed_into_selection || !inputs.dayflow_context_present || inputs.computed_signal_count === 0) {
    caps.push(CAP_TOKENS.partialContext);
  }

  if (inputs.all_external_stops) {
    reasons.push("source_backed_external_candidates");
    caps.push(CAP_TOKENS.externalOnlySources);
  }
  if (inputs.can_support_planner === false) {
    reasons.push("below_planner_candidate_threshold");
    caps.push(CAP_TOKENS.belowPlannerCandidateThreshold);
  }
  if (inputs.unresolved_role_count > 0) {
    caps.push(CAP_TOKENS.unresolvedRoles);
  }
  if (Number.isFinite(inputs.selected_stop_count) && inputs.selected_stop_count <= THIN_DAY_STOP_THRESHOLD) {
    if (isTrustedRemainingDayRoute(inputs)) {
      reasons.push("remaining_day_short_route");
      caps.push(CAP_TOKENS.remainingDayShortRoute);
    } else {
      reasons.push("thin_day_few_stops");
      caps.push(CAP_TOKENS.thinDay);
    }
  }

  const cappedByTokens = unique(caps.filter((cap) => cap.startsWith("capped_by_")));
  const thin = cappedByTokens.length > 0;

  return {
    status: thin ? "thin_usable" : "usable",
    level: thin ? "low" : "medium",
    summary: thin
      ? "The experimental agnostic route is usable for dogfood, but evidence or context is thin."
      : "The experimental agnostic route is usable for dogfood with no capped readiness reason.",
    reasons: unique(reasons),
    caps: unique(caps),
    inputs,
  };
}

function isTrustedRemainingDayRoute(inputs) {
  return Boolean(
    inputs.selected_stop_count === THIN_DAY_STOP_THRESHOLD &&
      inputs.requested_date &&
      inputs.requested_date === inputs.current_local_date &&
      inputs.time_band === "evening" &&
      inputs.timezone_trust !== "unavailable" &&
      inputs.time_fed_into_selection === true &&
      inputs.walking_valid === true,
  );
}

function isEnvironmentNotWired({ sourceStatus, blockers }) {
  return sourceStatus?.status === "no_loader_configured" || blockers.some((blocker) => ENVIRONMENT_BLOCKERS.has(blocker));
}

function isNotApplicable({ sourceStatus, blockers }) {
  return sourceStatus?.status === "skipped" || blockers.some((blocker) => NOT_APPLICABLE_BLOCKERS.has(blocker));
}

function blockerReasons(blockers) {
  return blockers.map((blocker) => `blocker:${blocker}`);
}

function countSourceFamilies(candidateReadiness) {
  const byProvider = candidateReadiness?.by_provider;
  if (!byProvider || typeof byProvider !== "object") return null;
  return Object.values(byProvider).filter((entry) => {
    const count = entry && typeof entry === "object" ? entry.count : entry;
    return Number(count) > 0;
  }).length;
}

function finiteOrNull(value) {
  return Number.isFinite(value) ? value : null;
}

function isExternalStop(stop) {
  // A provisional source candidate is external/unverified by definition. Engine
  // agnostic_compose stops carry `provisional: true` (via formatMainStop) but no
  // `origin` field, whereas the legacy synthesizer's stops carry an external
  // `origin` — recognize both so an all-source-backed any-place route always
  // trips capped_by_external_only_sources and stays honestly thin_usable, never
  // usable.
  if (stop?.provisional === true) return true;
  const origin = String(stop?.origin || "").toLowerCase();
  return origin.includes("external") || origin.includes("open");
}

function isHeuristicWalking(source) {
  return String(source || "").toLowerCase().includes("heuristic");
}

function unique(list) {
  return [...new Set((Array.isArray(list) ? list : []).filter(Boolean))];
}

module.exports = {
  calibrateAgnosticRouteReadiness,
};
