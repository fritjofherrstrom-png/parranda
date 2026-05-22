const { buildRouteTemplateCandidates } = require("../route-candidates/route-template-provider");
const { getRouteLineage } = require("../route-engine");

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
  const routeLineage = getRouteLineage(plannerRoute) || plannerRoute || {};
  const selectedRouteId = normalizeString(plannerRoute?.id);
  const sourceTemplateId = normalizeString(routeLineage.source_template_id) || selectedRouteId;
  const routeCandidate = sourceTemplateId ? routeCandidateById.get(sourceTemplateId) || null : null;
  const plannerStops = Array.isArray(plannerRoute?.main_stops) ? plannerRoute.main_stops : [];
  const plannerStopIds = normalizeIdList(plannerStops.map((stop) => stop?.id));
  const candidateStops = Array.isArray(routeCandidate?.stops) ? routeCandidate.stops : [];
  const userFacingStops = candidateStops.filter((stop) => stop.is_user_facing === true);
  const structuralStops = candidateStops.filter((stop) => stop.is_user_facing === false);
  const routeCandidateUserFacingStopIds = normalizeIdList(
    userFacingStops.map((stop) => stop.candidate_id),
  );
  const templateStopIds =
    normalizeIdList(routeLineage.template_stop_ids).length
      ? normalizeIdList(routeLineage.template_stop_ids)
      : routeCandidateUserFacingStopIds;
  const realizedStopIds =
    normalizeIdList(routeLineage.realized_stop_ids).length
      ? normalizeIdList(routeLineage.realized_stop_ids)
      : plannerStopIds;
  const realizedRouteId = normalizeString(routeLineage.realized_route_id) || null;
  const realizationKind = normalizeString(routeLineage.realization_kind) || null;
  const templateStopIdSet = new Set(templateStopIds);
  const realizedStopIdSet = new Set(realizedStopIds);
  const missingTemplateStops = templateStopIds.filter(
    (stopId) => !realizedStopIdSet.has(stopId),
  );
  const extraRealizedStops = realizedStopIds.filter(
    (stopId) => !templateStopIdSet.has(stopId),
  );
  const unresolvedStops = extractUnresolvedStops(routeCandidate);
  const stopCountParity = Boolean(routeCandidate) && plannerStops.length === userFacingStops.length;
  const userFacingStopIdsMatch =
    Boolean(routeCandidate) && orderedListsEqual(plannerStopIds, routeCandidateUserFacingStopIds);
  const userFacingStopIdSetMatch =
    Boolean(routeCandidate) && missingTemplateStops.length === 0 && extraRealizedStops.length === 0;
  const templateMatchStatus =
    normalizeString(routeLineage.template_match_status) ||
    inferTemplateMatchStatus({
      sourceTemplateId,
      routeCandidate,
      templateStopIds,
      realizedStopIds,
      missingTemplateStops,
      extraRealizedStops,
    });
  const mismatchReasons = buildMismatchReasons({
    selectedRouteId,
    sourceTemplateId,
    routeCandidate,
    plannerStopCount: plannerStops.length,
    routeCandidateUserFacingStopCount: userFacingStops.length,
    stopCountParity,
    userFacingStopIdsMatch,
    userFacingStopIdSetMatch,
    missingTemplateStops,
    extraRealizedStops,
    unresolvedStops,
  });
  const warnings = routeCandidate?.warnings || [];
  const limitations = routeCandidate?.limitations || [];
  const readiness = resolveSelectedRouteReadiness({
    routeCandidate,
    templateMatchStatus,
    unresolvedStops,
    warnings,
    limitations,
    mismatchReasons,
  });

  return {
    selected_route_id: selectedRouteId || null,
    source_template_id: sourceTemplateId || null,
    realized_route_id: realizedRouteId,
    realization_kind: realizationKind,
    template_match_status: templateMatchStatus,
    matching_route_candidate_id: routeCandidate?.id || null,
    planner_stop_count: plannerStops.length,
    route_candidate_stop_count: candidateStops.length,
    route_candidate_user_facing_stop_count: userFacingStops.length,
    route_candidate_structural_stop_count: structuralStops.length,
    stop_count_parity: stopCountParity,
    planner_stop_ids: plannerStopIds,
    route_candidate_user_facing_stop_ids: routeCandidateUserFacingStopIds,
    template_stop_ids: templateStopIds,
    realized_stop_ids: realizedStopIds,
    missing_template_stops: missingTemplateStops,
    extra_realized_stops: extraRealizedStops,
    missing_from_planner: missingTemplateStops,
    extra_in_planner: extraRealizedStops,
    user_facing_stop_ids_match: userFacingStopIdsMatch,
    user_facing_stop_id_set_match: userFacingStopIdSetMatch,
    unresolved_stops: unresolvedStops,
    warnings,
    limitations,
    readiness,
    mismatch_reasons: mismatchReasons,
  };
}

function resolveSelectedRouteReadiness({
  routeCandidate,
  templateMatchStatus,
  unresolvedStops,
  warnings,
  limitations,
  mismatchReasons,
}) {
  if (!routeCandidate || unresolvedStops.length || templateMatchStatus === "generated_or_unknown") {
    return "needs_review";
  }
  const hardMismatchReasons = mismatchReasons.filter((reason) => reason !== "user_facing_stop_ids_differ");
  if (hardMismatchReasons.length && !["reordered", "realized_variant"].includes(templateMatchStatus)) {
    return "needs_review";
  }
  if (warnings.length || limitations.length || mismatchReasons.length) {
    return "ready_with_warnings";
  }
  return "ready";
}

function buildMismatchReasons({
  selectedRouteId,
  sourceTemplateId,
  routeCandidate,
  plannerStopCount,
  routeCandidateUserFacingStopCount,
  stopCountParity,
  userFacingStopIdsMatch,
  userFacingStopIdSetMatch,
  missingTemplateStops,
  extraRealizedStops,
  unresolvedStops,
}) {
  const reasons = [];

  if (!selectedRouteId) {
    reasons.push("missing_selected_route_id");
  }
  if (!sourceTemplateId) {
    reasons.push("missing_source_template_id");
  }
  if (sourceTemplateId && !routeCandidate) {
    reasons.push("no_matching_route_candidate");
  }
  if (routeCandidate && !stopCountParity) {
    reasons.push(
      `stop_count_mismatch:planner=${plannerStopCount}:route_candidate_user_facing=${routeCandidateUserFacingStopCount}`,
    );
  }
  if (routeCandidate && missingTemplateStops.length) {
    reasons.push(`missing_template_stops:${missingTemplateStops.join(",")}`);
  }
  if (routeCandidate && extraRealizedStops.length) {
    reasons.push(`extra_realized_stops:${extraRealizedStops.join(",")}`);
  }
  if (
    routeCandidate &&
    stopCountParity &&
    userFacingStopIdSetMatch &&
    !userFacingStopIdsMatch
  ) {
    reasons.push("user_facing_stop_ids_differ");
  }
  unresolvedStops.forEach((stopId) => {
    reasons.push(`unresolved_template_stop:${stopId}`);
  });

  return reasons;
}

function inferTemplateMatchStatus({
  sourceTemplateId,
  routeCandidate,
  templateStopIds,
  realizedStopIds,
  missingTemplateStops,
  extraRealizedStops,
}) {
  if (!sourceTemplateId || !routeCandidate) {
    return "generated_or_unknown";
  }

  if (missingTemplateStops.length || extraRealizedStops.length) {
    return "realized_variant";
  }

  return orderedListsEqual(templateStopIds, realizedStopIds) ? "exact" : "reordered";
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
