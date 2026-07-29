/**
 * Project engine geometry onto the route the product actually presents.
 *
 * A typed-place anchor is a search centre, not a user start/end point. The
 * engine may use it internally for candidate selection, while this pure helper
 * makes the public route fields describe the selected stop chain only. Explicit
 * coordinate / near-me routes do not call this helper and keep their real
 * user-owned anchor.
 */

function projectRouteToSelectedStopChain(route) {
  if (!route || typeof route !== "object") return route;
  const stops = (Array.isArray(route.main_stops) ? route.main_stops : []).filter(
    (stop) => stop && Number.isFinite(stop.lat) && Number.isFinite(stop.lng),
  );
  if (stops.length < 2) return route;

  const originalPoints = finitePoints(route.map_route_points);
  const firstPointIndex = nearestPointIndex(originalPoints, stops[0], 0);
  const lastPointIndex = nearestPointIndex(
    originalPoints,
    stops[stops.length - 1],
    Math.max(0, firstPointIndex),
  );
  const originalLegs = Array.isArray(route.legs) ? route.legs : [];
  const canSliceLegs =
    firstPointIndex >= 0 &&
    lastPointIndex > firstPointIndex &&
    originalLegs.length === Math.max(0, originalPoints.length - 1);
  const legs = canSliceLegs
    ? originalLegs.slice(firstPointIndex, lastPointIndex)
    : buildStopChainLegs(stops);
  const estimatedKm = Number(
    legs.reduce(
      (sum, leg) => sum + (Number.isFinite(leg?.distance_km) ? leg.distance_km : 0),
      0,
    ).toFixed(1),
  );
  const walkMinutes = legs
    .map((leg) => leg?.estimated_walk_minutes)
    .filter(Number.isFinite);
  const legDistances = legs.map((leg) => leg?.distance_km).filter(Number.isFinite);
  const stopRoutePoints = stops.map((stop, index) => ({
    label: stop.label || stop.name || null,
    lat: stop.lat,
    lng: stop.lng,
    role: index === 0 ? "first-stop" : "stop",
  }));
  const path = slicePathBetweenStops(route.map_path_points, stops[0], stops[stops.length - 1]);

  return {
    ...route,
    estimated_km: estimatedKm,
    start_label: stopRoutePoints[0].label,
    end_label: stopRoutePoints[stopRoutePoints.length - 1].label,
    route_shape: "arc",
    map_route_points: stopRoutePoints,
    map_path_points: path.length > 1
      ? path
      : stopRoutePoints.map(({ lat, lng }) => ({ lat, lng })),
    legs,
    longest_leg_km: legDistances.length ? Math.max(...legDistances) : null,
    longest_leg_minutes: walkMinutes.length ? Math.max(...walkMinutes) : null,
    average_leg_minutes: walkMinutes.length
      ? Number((walkMinutes.reduce((sum, minutes) => sum + minutes, 0) / walkMinutes.length).toFixed(1))
      : null,
    geo_fit_note: null,
    anchor_zone: null,
    public_route_scope: "selected_stop_chain",
  };
}

function finitePoints(value) {
  return (Array.isArray(value) ? value : []).filter(
    (point) => point && Number.isFinite(point.lat) && Number.isFinite(point.lng),
  );
}

function nearestPointIndex(points, target, startIndex = 0) {
  if (!Array.isArray(points) || !points.length || !target) return -1;
  const targetLabel = String(target.label || target.name || "").trim();
  if (targetLabel) {
    for (let index = Math.max(0, startIndex); index < points.length; index += 1) {
      if (String(points[index]?.label || points[index]?.name || "").trim() === targetLabel) {
        return index;
      }
    }
  }
  let bestIndex = -1;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let index = Math.max(0, startIndex); index < points.length; index += 1) {
    const point = points[index];
    const distance = (point.lat - target.lat) ** 2 + (point.lng - target.lng) ** 2;
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  }
  return bestIndex;
}

function slicePathBetweenStops(pathPoints, firstStop, lastStop) {
  const points = finitePoints(pathPoints);
  const firstIndex = nearestPointIndex(points, firstStop, 0);
  const lastIndex = nearestPointIndex(points, lastStop, Math.max(0, firstIndex));
  return firstIndex >= 0 && lastIndex > firstIndex ? points.slice(firstIndex, lastIndex + 1) : [];
}

function buildStopChainLegs(stops) {
  const legs = [];
  for (let index = 1; index < stops.length; index += 1) {
    const distanceKm = Number((haversineKm(stops[index - 1], stops[index]) * 1.22).toFixed(1));
    legs.push({
      from_label: stops[index - 1].label || stops[index - 1].name || null,
      to_label: stops[index].label || stops[index].name || null,
      distance_km: distanceKm,
      estimated_walk_minutes: Math.max(2, Math.round(distanceKm * 12)),
    });
  }
  return legs;
}

function haversineKm(first, second) {
  const toRad = (value) => (value * Math.PI) / 180;
  const dLat = toRad(second.lat - first.lat);
  const dLng = toRad(second.lng - first.lng);
  const lat1 = toRad(first.lat);
  const lat2 = toRad(second.lat);
  const hav =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.atan2(Math.sqrt(hav), Math.sqrt(1 - hav));
}

module.exports = { projectRouteToSelectedStopChain };
