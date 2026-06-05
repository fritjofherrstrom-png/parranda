const { getRouteLineage } = require("../route-engine");

function buildRouteOutputDiagnostics({ city, routeResult, includeAlternatives = true } = {}) {
  const days = Array.isArray(routeResult?.days) ? routeResult.days : [];

  return {
    status: days.length ? "available" : "unavailable",
    city: city || routeResult?.city || null,
    experimental: true,
    route_mutation: false,
    days: days.map((day, index) => ({
      date: day?.date || null,
      day_index: index,
      primary_route: summarizeRouteOutput(day?.primary_route, "current_primary_route_json"),
      alternatives: includeAlternatives
        ? (Array.isArray(day?.alternatives) ? day.alternatives : []).map((route) =>
            summarizeRouteOutput(route, "current_alternative_route_json"),
          )
        : [],
    })),
  };
}

function summarizeRouteOutput(route, outputContract) {
  const lineage = getRouteLineage(route) || {};
  const stops = Array.isArray(route?.main_stops) ? route.main_stops : [];
  const stopIds = stops.map(extractStableStopId).filter(Boolean);

  return {
    status: route && typeof route === "object" ? "available" : "unavailable",
    selected_route_id: normalizeString(route?.id),
    source_template_id: normalizeString(lineage.source_template_id),
    realized_route_id: normalizeString(lineage.realized_route_id),
    realization_kind: normalizeString(lineage.realization_kind),
    template_match_status: normalizeString(lineage.template_match_status),
    stop_ids: stopIds,
    stop_count: stops.length,
    has_stable_stop_ids: stops.length > 0 && stopIds.length === stops.length,
    output_contract: outputContract,
    public_route_mutated: false,
  };
}

function extractStableStopId(stop) {
  return firstStableId(stop, ["id", "place_id", "candidate_id"]);
}

function firstStableId(value, keys) {
  for (const key of keys) {
    const id = value?.[key];
    if (typeof id === "string" && id.trim()) return id.trim();
    if (Number.isFinite(id)) return String(id);
  }
  return null;
}

function normalizeString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

module.exports = {
  buildRouteOutputDiagnostics,
  summarizeRouteOutput,
};
