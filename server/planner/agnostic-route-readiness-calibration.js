/**
 * Conservative readiness calibration for the flag-gated agnostic route output.
 *
 * This does not make a route more true, ranked, fast, or ready for default
 * Planner use. It only explains how much trust the experimental output has
 * based on already-trusted server-side facts.
 */

const ENVIRONMENT_BLOCKERS = new Set(["no_trusted_loader"]);

const WALKING_BLOCKERS = new Set([
  "walking_route_unavailable",
  "invalid_walking_coordinates",
  "invalid_walking_leg_count",
  "invalid_walking_path_points",
  "walking_validation_failed",
  "walking_budget_exceeded",
  "walking_leg_budget_exceeded",
]);

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
  };

  const reasons = [];
  const caps = ["experimental_agnostic_route"];

  if (isEnvironmentNotWired({ sourceStatus, blockers })) {
    reasons.push("environment_not_wired", "no_trusted_loader");
    return {
      status: "environment_not_wired",
      level: "unavailable",
      summary: "The agnostic route experiment could not run because no trusted candidate loader is wired.",
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
  if (inputs.walking_source === "heuristic" || caveats.includes("heuristic_walking_estimate")) {
    reasons.push("heuristic_walking_estimate");
    caps.push("heuristic_walking_estimate");
  }
  if (inputs.walking_fallback_used) {
    reasons.push("walking_router_fallback_used");
    caps.push("walking_router_fallback_used");
  }

  if (inputs.route_ordering_mode === "trusted_candidate_pool+role_order+proximity_sequence") {
    reasons.push("proximity_ordering_validated");
  } else if (routeOrdering?.fallback_used) {
    reasons.push("role_order_fallback_after_sequence_validation");
    caps.push("route_ordering_fallback");
  }

  if (inputs.timezone_source === "resolver_attested") {
    reasons.push("resolver_attested_timezone");
  } else if (inputs.timezone_source === "weather_provider_auto") {
    reasons.push("weather_provider_auto_timezone");
    caps.push("derived_timezone");
  } else {
    reasons.push("timezone_unavailable");
    caps.push("no_time_context");
  }

  if (inputs.weather_fed_into_selection) reasons.push("weather_context_used");
  if (inputs.time_fed_into_selection) reasons.push("time_context_used");
  if (!inputs.time_fed_into_selection) caps.push("partial_context");

  if (inputs.all_external_stops) {
    reasons.push("source_backed_external_candidates");
    caps.push("external_only_candidates");
  }
  if (inputs.source_family_count !== null && inputs.source_family_count < 2) {
    caps.push("low_source_diversity");
  }
  if (inputs.can_support_planner === false) {
    reasons.push("below_planner_candidate_threshold");
    caps.push("below_planner_candidate_threshold");
  }
  if (inputs.selected_stop_count < 3) {
    caps.push("low_selected_stop_count");
  }
  if (inputs.unresolved_role_count > 0) {
    caps.push("unresolved_roles");
  }
  if (inputs.coordinate_coverage !== null && inputs.coordinate_coverage < 0.8) {
    caps.push("low_coordinate_coverage");
  }

  const thin =
    inputs.can_support_planner === false ||
    inputs.selected_stop_count < 3 ||
    inputs.unresolved_role_count > 0 ||
    inputs.source_family_count === 0 ||
    inputs.coordinate_coverage < 0.8 ||
    caps.includes("no_time_context") ||
    caps.includes("walking_router_fallback_used");

  return {
    status: thin ? "thin_usable" : "usable",
    level: thin ? "low" : "medium",
    summary: thin
      ? "The experimental agnostic route is usable for dogfood, but evidence or context is thin."
      : "The experimental agnostic route is usable for dogfood with conservative readiness caps.",
    reasons: unique(reasons),
    caps: unique(caps),
    inputs,
  };
}

function isEnvironmentNotWired({ sourceStatus, blockers }) {
  return sourceStatus?.status === "no_loader_configured" || blockers.some((blocker) => ENVIRONMENT_BLOCKERS.has(blocker));
}

function blockerReasons(blockers) {
  return blockers.map((blocker) => `blocker:${blocker}`);
}

function countSourceFamilies(candidateReadiness) {
  const byProvider = candidateReadiness?.by_provider;
  if (!byProvider || typeof byProvider !== "object") return null;
  return Object.keys(byProvider).filter((key) => Number(byProvider[key]) > 0).length;
}

function finiteOrNull(value) {
  return Number.isFinite(value) ? value : null;
}

function isExternalStop(stop) {
  const origin = String(stop?.origin || "").toLowerCase();
  return origin.includes("external") || origin.includes("open");
}

function unique(list) {
  return [...new Set((Array.isArray(list) ? list : []).filter(Boolean))];
}

module.exports = {
  calibrateAgnosticRouteReadiness,
};
