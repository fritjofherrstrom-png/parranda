/**
 * Live-sheet scope×time query building (design handoff §3B, against the
 * server's live_event_query_v1 contract from #390).
 *
 * SEMANTIC FIREWALL: this module only ever produces an EVENTS query. It has no
 * access to — and never returns — the day's anchor or route. The landing's
 * "Use my location" sets the day anchor; the Live sheet's "Near me" is a
 * separate, events-only consent that scopes this query and nothing else. The
 * server echoes route_mutation:false / day_anchor_mutation:false to prove it.
 *
 * Pure + deterministic; no DOM, no fetch — unit-tested directly.
 */

// The server caps route corridors at 24 points and rejects fewer than 2.
const MAX_ROUTE_POINTS = 24;

/** UI time key → the contract's time window. */
export function liveEventsTimeWindow(timeKey) {
  return timeKey === "week" ? "this_week" : "tonight";
}

/**
 * The contextual scope options (handoff annotations):
 *   - a coords-anchored day → a single scope presented as "Near you": the route
 *     stops already surround the captured position, so near_route needs no
 *     re-consent; only if there is no usable route does it fall back to near_me.
 *   - a route present → ["near_route", "near_me"]
 *   - no route → ["around_place", "near_me"]
 * "near_me" is always a fresh, events-only position consent.
 */
export function availableLiveScopes({ coordsAnchoredDay = false, hasRoute = false, routePointCount = 0 } = {}) {
  const routeUsable = hasRoute && routePointCount >= 2;
  if (coordsAnchoredDay) return routeUsable ? ["near_route"] : ["near_me"];
  if (routeUsable) return ["near_route", "near_me"];
  return ["around_place", "near_me"];
}

function finiteCoord(value) {
  return value && Number.isFinite(value.lat) && Number.isFinite(value.lng)
    ? { lat: value.lat, lng: value.lng }
    : null;
}

/**
 * Build the POST body for /api/live-events, or an { error } the caller can turn
 * into honest copy. Coordinates travel in the body only — never a URL — so a
 * position never lands in history or a referrer.
 */
export function buildLiveEventsQuery({ scope, time, anchorCoord = null, routePoints = [], nearMeCoords = null, preferences = [] } = {}) {
  const base = {
    scope,
    time: liveEventsTimeWindow(time),
    preferences: Array.isArray(preferences) ? preferences.filter((p) => typeof p === "string" && p.trim()) : [],
  };

  if (scope === "near_route") {
    const points = (Array.isArray(routePoints) ? routePoints : [])
      .map(finiteCoord)
      .filter(Boolean)
      .slice(0, MAX_ROUTE_POINTS);
    if (points.length < 2) return { error: "near_route_requires_route_points" };
    return { body: { ...base, route_points: points } };
  }

  if (scope === "near_me" || scope === "around_place") {
    const coord = finiteCoord(scope === "near_me" ? nearMeCoords : anchorCoord);
    if (!coord) return { error: scope === "near_me" ? "near_me_requires_position" : "around_place_requires_anchor" };
    return { body: { ...base, anchor: coord } };
  }

  return { error: "invalid_live_event_scope" };
}
