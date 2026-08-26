/**
 * Pure frontend contract for the inspectable Live re-query endpoint.
 *
 * The payload may READ the trusted day anchor or primary-route geometry, but it
 * can never describe a route mutation. `near_me` requires coordinates obtained
 * for that Live query and is deliberately separate from the Planner anchor.
 */

export const LIVE_EVENT_QUERY_CONTRACT = "live_event_query_v1";
export const LIVE_EVENT_SCOPES = ["around_place", "near_route", "near_me"];
export const LIVE_EVENT_TIMES = ["tonight", "this_week"];

const MAX_ROUTE_POINTS = 24;
const MAX_PREFERENCES = 12;
const SOURCE_HEALTH_COUNTS = [
  "selected_source_count",
  "responding_source_count",
  "event_bearing_source_count",
  "empty_source_count",
  "failed_source_count",
  "unavailable_source_count",
  "raw_event_count",
  "normalized_event_count",
  "accepted_event_count",
  "surfaced_event_count",
  "rejected_event_count",
];

export function trustedDayAnchor(response) {
  const experiment = response?.agnostic_route_output_experiment;
  return (
    coordinate(experiment?.source_status?.anchor) ||
    coordinate(experiment?.intake?.resolved) ||
    null
  );
}

export function trustedPlaceQuery(response) {
  const query = response?.agnostic_route_output_experiment?.intake?.query;
  if (typeof query !== "string") return null;
  const normalized = query.trim().replace(/\s+/g, " ");
  return normalized && normalized.length <= 200 ? normalized : null;
}

export function boundedRoutePoints(stops, limit = MAX_ROUTE_POINTS) {
  const boundedLimit = Math.max(2, Math.min(MAX_ROUTE_POINTS, Math.floor(Number(limit) || MAX_ROUTE_POINTS)));
  const points = [];
  const seen = new Set();
  for (const stop of Array.isArray(stops) ? stops : []) {
    const point = coordinate(stop);
    if (!point) continue;
    const key = `${point.lat},${point.lng}`;
    if (seen.has(key)) continue;
    seen.add(key);
    points.push(point);
  }
  if (points.length <= boundedLimit) return points;

  // Keep both ends and sample the interior deterministically. The backend owns
  // the final corridor/radius validation; this only prevents an oversized body.
  const first = points[0];
  const last = points[points.length - 1];
  const interior = points.slice(1, -1);
  const slots = boundedLimit - 2;
  const sampled = [];
  for (let index = 0; index < slots; index += 1) {
    sampled.push(interior[Math.floor((index * interior.length) / slots)]);
  }
  return [first, ...sampled, last];
}

export function buildLiveEventQueryPayload({
  scope = "around_place",
  time = "tonight",
  preferences = [],
  response = null,
  routeStops = [],
  nearMeCoords = null,
} = {}) {
  if (!LIVE_EVENT_SCOPES.includes(scope) || !LIVE_EVENT_TIMES.includes(time)) return null;
  const base = {
    scope,
    time,
    preferences: normalizePreferences(preferences),
  };

  if (scope === "near_route") {
    const routePoints = boundedRoutePoints(routeStops);
    return routePoints.length >= 2 ? { ...base, route_points: routePoints } : null;
  }

  const anchor = scope === "near_me" ? coordinate(nearMeCoords) : trustedDayAnchor(response);
  if (!anchor) return null;
  const placeQuery = scope === "around_place" ? trustedPlaceQuery(response) : null;
  return placeQuery ? { ...base, anchor, place_query: placeQuery } : { ...base, anchor };
}

export function acceptedLiveEventQuery(response) {
  if (!response || typeof response !== "object") return null;
  if (response.contract !== LIVE_EVENT_QUERY_CONTRACT) return null;
  if (response.route_mutation !== false || response.day_anchor_mutation !== false) return null;
  if (!response.live_events || typeof response.live_events !== "object") return null;
  if (!Array.isArray(response.live_events.tonight) || !Array.isArray(response.live_events.this_week)) return null;
  if (!completeSourceHealth(response.live_events?.acquisition?.source_health)) return null;
  return response.live_events;
}

function completeSourceHealth(health) {
  if (!health || typeof health !== "object") return false;
  if (typeof health.status !== "string" || typeof health.result !== "string" || !Array.isArray(health.reasons)) {
    return false;
  }
  return SOURCE_HEALTH_COUNTS.every((field) => Number.isInteger(health[field]) && health[field] >= 0);
}

function normalizePreferences(value) {
  const out = [];
  const seen = new Set();
  for (const entry of Array.isArray(value) ? value : []) {
    const preference = typeof entry === "string" ? entry.trim() : "";
    if (!preference || seen.has(preference)) continue;
    seen.add(preference);
    out.push(preference);
    if (out.length >= MAX_PREFERENCES) break;
  }
  return out;
}

function coordinate(value) {
  if (!value || typeof value !== "object") return null;
  const lat = numericPart(value.lat);
  const lng = numericPart(value.lng);
  if (lat === null || lng === null || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

function numericPart(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
