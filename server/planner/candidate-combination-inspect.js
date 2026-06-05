const { buildCandidateCombination } = require("./candidate-combination");

function buildCandidateCombinationInspect({ plannerRoles, dayflowHonesty, route, options = {} } = {}) {
  try {
    const candidateCombination = buildCandidateCombination(plannerRoles, dayflowHonesty, options);
    return {
      ...candidateCombination,
      comparison_to_route: compareCandidateCombinationToRoute(candidateCombination, route),
    };
  } catch (error) {
    return {
      status: "inspect_failed",
      selected: [],
      unresolved_roles: [],
      duplicate_role_coverage: [],
      geometry_summary: null,
      quality_flags: ["candidate_combination_inspect_failed"],
      reasons: ["candidate_combination_inspect_failed", `error:${error.message}`],
      comparison_to_route: compareCandidateCombinationToRoute(null, route),
    };
  }
}

function compareCandidateCombinationToRoute(candidateCombination, route) {
  const selected = Array.isArray(candidateCombination?.selected) ? candidateCombination.selected : [];
  const routeStops = Array.isArray(route?.main_stops) ? route.main_stops : [];
  const candidateEntries = selected.map((candidate) => ({
    id: firstStableId(candidate, ["candidate_id", "id"]),
    candidate,
  }));
  const routeEntries = routeStops.map((stop) => ({
    id: firstStableId(stop, ["id", "place_id", "candidate_id"]),
    stop,
  }));

  const reasons = [];
  if (candidateEntries.some((entry) => !entry.id)) reasons.push("candidate_ids_missing");
  if (routeEntries.some((entry) => !entry.id)) reasons.push("route_stop_ids_missing");
  if (!selected.length) reasons.push("no_selected_candidates");
  if (!routeStops.length) reasons.push("no_route_stops");

  const candidateIds = new Set(candidateEntries.map((entry) => entry.id).filter(Boolean));
  const routeIds = new Set(routeEntries.map((entry) => entry.id).filter(Boolean));
  const matched = [...candidateIds].filter((id) => routeIds.has(id)).sort();
  const candidateNotInRoute = candidateEntries
    .filter((entry) => entry.id && !routeIds.has(entry.id))
    .map((entry) => entry.id)
    .sort();
  const routeStopNotInCandidateSet = routeEntries
    .filter((entry) => entry.id && !candidateIds.has(entry.id))
    .map((entry) => entry.id)
    .sort();

  if (matched.length) reasons.push("stable_id_overlap");
  if (candidateNotInRoute.length) reasons.push("selected_candidates_outside_route");
  if (routeStopNotInCandidateSet.length) reasons.push("route_has_stops_outside_candidate_set");

  return {
    matched_stop_ids: matched,
    candidate_not_in_route: candidateNotInRoute,
    route_stop_not_in_candidate_set: routeStopNotInCandidateSet,
    order_sensitive: false,
    reasons: [...new Set(reasons)].sort(),
  };
}

function firstStableId(value, keys) {
  for (const key of keys) {
    const id = value?.[key];
    if (typeof id === "string" && id.trim()) return id.trim();
    if (Number.isFinite(id)) return String(id);
  }
  return null;
}

module.exports = {
  buildCandidateCombinationInspect,
  compareCandidateCombinationToRoute,
};
