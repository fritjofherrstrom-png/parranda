/**
 * Presentation-only bridge between the authoritative primary route and the
 * broader district candidate structure. It never promotes candidates into the
 * route: suggestions are deduped, distance-bounded context around real route
 * stops and remain separate from Maps directions.
 */

const EARTH_RADIUS_KM = 6371;

const PLANNER_INTENT_ALIASES = Object.freeze({
  scenic: "views",
  coffee: "fika",
  bars: "nightlife",
  vintage: "second_hand",
});

function text(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizedName(stop) {
  const name = text(stop && (stop.label || stop.name));
  return name ? name.toLocaleLowerCase().replace(/\s+/g, " ") : null;
}

function stableIds(stop) {
  return [stop && stop.id, stop && stop.place_id, stop && stop.candidate_id]
    .filter((value) => value != null && String(value).trim())
    .map((value) => String(value).trim());
}

function coordinates(stop) {
  if (!stop || !Number.isFinite(stop.lat) || !Number.isFinite(stop.lng)) return null;
  return { lat: stop.lat, lng: stop.lng };
}

function distanceKm(a, b) {
  const first = coordinates(a);
  const second = coordinates(b);
  if (!first || !second) return null;
  const toRad = (degrees) => (degrees * Math.PI) / 180;
  const dLat = toRad(second.lat - first.lat);
  const dLng = toRad(second.lng - first.lng);
  const lat1 = toRad(first.lat);
  const lat2 = toRad(second.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

function localFeelRank(stop) {
  if (Number.isFinite(stop && stop.local_feel_rank)) {
    return Math.max(0, Math.min(3, stop.local_feel_rank));
  }
  return stop && stop.chain === true ? 2 : 0;
}

/**
 * Returns optional context near the route, never route stops.
 *
 * - exact stable-id or normalized-name matches with route stops are excluded;
 * - candidates must have coordinates and be within maxDistanceKm of a route stop;
 * - at most one suggestion is shown per route stop, preventing one dense area
 *   from taking over the day;
 * - explicit local-feel evidence is preferred before proximity; branded chains
 *   remain available as sparse fallback rather than being banned;
 * - final output order follows route order, then stable source order.
 */
export function buildRouteContextSuggestions(routeStops, areas, options = {}) {
  const route = (Array.isArray(routeStops) ? routeStops : []).filter((stop) => coordinates(stop));
  if (!route.length) return [];

  const limit = Math.max(0, Math.min(Number.isInteger(options.limit) ? options.limit : 3, 6));
  const maxDistanceKm = Number.isFinite(options.maxDistanceKm) ? Math.max(0, options.maxDistanceKm) : 1.5;
  if (!limit) return [];

  const routeIds = new Set(route.flatMap(stableIds));
  const routeNames = new Set(route.map(normalizedName).filter(Boolean));
  const seenIds = new Set();
  const seenNames = new Set();
  const candidates = [];

  (Array.isArray(areas) ? areas : []).forEach((area, areaIndex) => {
    (Array.isArray(area && area.stops) ? area.stops : []).forEach((stop, sourceIndex) => {
      const name = normalizedName(stop);
      const ids = stableIds(stop);
      if (!name || !coordinates(stop)) return;
      if (ids.some((id) => routeIds.has(id)) || routeNames.has(name)) return;
      if (ids.some((id) => seenIds.has(id)) || seenNames.has(name)) return;

      let nearest = null;
      route.forEach((routeStop, routeIndex) => {
        const km = distanceKm(stop, routeStop);
        if (km == null || (nearest && nearest.distance_km <= km)) return;
        nearest = { route_stop_index: routeIndex, route_stop: routeStop, distance_km: km };
      });
      if (!nearest || nearest.distance_km > maxDistanceKm) return;

      ids.forEach((id) => seenIds.add(id));
      seenNames.add(name);
      candidates.push({
        ...stop,
        area_index: areaIndex,
        source_index: sourceIndex,
        daypart_hint: area && area.daypart_hint ? area.daypart_hint : null,
        covers: Array.isArray(area && area.covers) ? area.covers.slice() : [],
        route_stop_index: nearest.route_stop_index,
        route_stop_name: text(nearest.route_stop && (nearest.route_stop.label || nearest.route_stop.name)),
        distance_km: nearest.distance_km,
      });
    });
  });

  candidates.sort((a, b) =>
    localFeelRank(a) - localFeelRank(b) ||
    a.route_stop_index - b.route_stop_index ||
    a.distance_km - b.distance_km ||
    a.area_index - b.area_index ||
    a.source_index - b.source_index ||
    String(a.id || a.name).localeCompare(String(b.id || b.name)),
  );

  const usedRouteStops = new Set();
  const selected = [];
  for (const candidate of candidates) {
    if (usedRouteStops.has(candidate.route_stop_index)) continue;
    usedRouteStops.add(candidate.route_stop_index);
    selected.push(candidate);
    if (selected.length >= limit) break;
  }
  return selected.sort((a, b) =>
    a.route_stop_index - b.route_stop_index ||
    a.distance_km - b.distance_km ||
    a.area_index - b.area_index ||
    a.source_index - b.source_index ||
    String(a.id || a.name).localeCompare(String(b.id || b.name)),
  );
}

export function walkingDistanceLabel(km, lang = "en") {
  if (!Number.isFinite(km) || km < 0) return "";
  if (km < 0.1) return lang === "sv" ? "< 0,1 km" : "< 0.1 km";
  const rounded = Math.round(km * 10) / 10;
  return `${lang === "sv" ? String(rounded).replace(".", ",") : rounded} km`;
}

/**
 * Coverage truth for a composed route. District/place structure is a broader
 * candidate universe and must not be used to claim what the selected route
 * covers or misses.
 */
export function routePreferenceCoverage(routeStops, requestedPreferences) {
  const requested = [];
  for (const value of Array.isArray(requestedPreferences) ? requestedPreferences : []) {
    if (typeof value !== "string" || !value.trim()) continue;
    const normalized = PLANNER_INTENT_ALIASES[value.trim()] || value.trim();
    if (!requested.includes(normalized)) requested.push(normalized);
  }

  const covered = new Set();
  let hasCoverageEvidence = false;
  for (const stop of Array.isArray(routeStops) ? routeStops : []) {
    if (!Array.isArray(stop && stop.covered_preferences)) continue;
    hasCoverageEvidence = true;
    for (const value of stop.covered_preferences) {
      if (typeof value !== "string" || !value.trim()) continue;
      covered.add(PLANNER_INTENT_ALIASES[value.trim()] || value.trim());
    }
  }

  return {
    has_coverage_evidence: hasCoverageEvidence,
    covered_preferences: requested.filter((value) => covered.has(value)),
    missing_preferences: hasCoverageEvidence ? requested.filter((value) => !covered.has(value)) : [],
  };
}
