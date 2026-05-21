const { buildRouteTemplateCandidates } = require("../route-candidates/route-template-provider");

function buildPlannerRouteCandidateShadowDiagnostics({
  cityConfig,
  plannerResult,
  includeAlternatives = false,
} = {}) {
  if (!cityConfig || typeof cityConfig !== "object") {
    throw new Error("buildPlannerRouteCandidateShadowDiagnostics requires a city config");
  }

  const routeCandidates = buildRouteTemplateCandidates(cityConfig);
  const routeCandidateById = new Map(routeCandidates.map((candidate) => [candidate.id, candidate]));
  const days = Array.isArray(plannerResult?.days) ? plannerResult.days : [];

  return {
    city: cityConfig.key,
    route_candidate_count: routeCandidates.length,
    days: days.map((day, index) => ({
      date: day?.date || null,
      day_index: index,
      primary_route: comparePlannerRouteToRouteCandidate(day?.primary_route, routeCandidateById),
      alternatives: includeAlternatives
        ? (day?.alternatives || []).map((route) =>
            comparePlannerRouteToRouteCandidate(route, routeCandidateById),
          )
        : [],
    })),
  };
}

function comparePlannerRouteToRouteCandidate(plannerRoute, routeCandidateById) {
  const selectedRouteId = normalizeString(plannerRoute?.id);
  const routeCandidate = selectedRouteId ? routeCandidateById.get(selectedRouteId) || null : null;
  const plannerStops = Array.isArray(plannerRoute?.main_stops) ? plannerRoute.main_stops : [];
  const plannerStopIds = normalizeIdList(plannerStops.map((stop) => stop?.id));
  const candidateStops = Array.isArray(routeCandidate?.stops) ? routeCandidate.stops : [];
  const userFacingStops = candidateStops.filter((stop) => stop.is_user_facing === true);
  const structuralStops = candidateStops.filter((stop) => stop.is_user_facing === false);
  const routeCandidateUserFacingStopIds = normalizeIdList(
    userFacingStops.map((stop) => stop.candidate_id),
  );
  const unresolvedStops = extractUnresolvedStops(routeCandidate);
  const stopCountParity = Boolean(routeCandidate) && plannerStops.length === userFacingStops.length;
  const userFacingStopIdsMatch =
    Boolean(routeCandidate) && orderedListsEqual(plannerStopIds, routeCandidateUserFacingStopIds);
  const mismatchReasons = buildMismatchReasons({
    selectedRouteId,
    routeCandidate,
    plannerStopCount: plannerStops.length,
    routeCandidateUserFacingStopCount: userFacingStops.length,
    stopCountParity,
    userFacingStopIdsMatch,
    unresolvedStops,
  });
  const warnings = routeCandidate?.warnings || [];
  const limitations = routeCandidate?.limitations || [];
  const readiness = resolveSelectedRouteReadiness({
    routeCandidate,
    stopCountParity,
    unresolvedStops,
    warnings,
    limitations,
    mismatchReasons,
  });

  return {
    selected_route_id: selectedRouteId || null,
    matching_route_candidate_id: routeCandidate?.id || null,
    planner_stop_count: plannerStops.length,
    route_candidate_stop_count: candidateStops.length,
    route_candidate_user_facing_stop_count: userFacingStops.length,
    route_candidate_structural_stop_count: structuralStops.length,
    stop_count_parity: stopCountParity,
    planner_stop_ids: plannerStopIds,
    route_candidate_user_facing_stop_ids: routeCandidateUserFacingStopIds,
    user_facing_stop_ids_match: userFacingStopIdsMatch,
    unresolved_stops: unresolvedStops,
    warnings,
    limitations,
    readiness,
    mismatch_reasons: mismatchReasons,
  };
}

function resolveSelectedRouteReadiness({
  routeCandidate,
  stopCountParity,
  unresolvedStops,
  warnings,
  limitations,
  mismatchReasons,
}) {
  if (!routeCandidate || !stopCountParity || unresolvedStops.length) {
    return "needs_review";
  }
  const hardMismatchReasons = mismatchReasons.filter((reason) => reason !== "user_facing_stop_ids_differ");
  if (hardMismatchReasons.length) {
    return "needs_review";
  }
  if (warnings.length || limitations.length || mismatchReasons.length) {
    return "ready_with_warnings";
  }
  return "ready";
}

function buildMismatchReasons({
  selectedRouteId,
  routeCandidate,
  plannerStopCount,
  routeCandidateUserFacingStopCount,
  stopCountParity,
  userFacingStopIdsMatch,
  unresolvedStops,
}) {
  const reasons = [];

  if (!selectedRouteId) {
    reasons.push("missing_selected_route_id");
  }
  if (selectedRouteId && !routeCandidate) {
    reasons.push("no_matching_route_candidate");
  }
  if (routeCandidate && !stopCountParity) {
    reasons.push(
      `stop_count_mismatch:planner=${plannerStopCount}:route_candidate_user_facing=${routeCandidateUserFacingStopCount}`,
    );
  }
  if (routeCandidate && stopCountParity && !userFacingStopIdsMatch) {
    reasons.push("user_facing_stop_ids_differ");
  }
  unresolvedStops.forEach((stopId) => {
    reasons.push(`unresolved_template_stop:${stopId}`);
  });

  return reasons;
}

function extractUnresolvedStops(routeCandidate) {
  return (routeCandidate?.warnings || []).flatMap((warning) => {
    if (!warning.startsWith("unresolved_template_stops:")) {
      return [];
    }
    return warning
      .replace("unresolved_template_stops:", "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
  });
}

function normalizeIdList(values = []) {
  return values.map((value) => normalizeString(value)).filter(Boolean);
}

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function orderedListsEqual(left = [], right = []) {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((value, index) => value === right[index]);
}

module.exports = {
  buildPlannerRouteCandidateShadowDiagnostics,
  comparePlannerRouteToRouteCandidate,
};
