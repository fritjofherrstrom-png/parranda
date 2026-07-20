/**
 * Pure builders for Google Maps deep links — testable without a DOM.
 * Coordinates remain the trust gate. When a trusted stop also has a name, the
 * consumer link searches for that real place in its city context instead of
 * opening an anonymous coordinate pin.
 */

const MAPS = "https://www.google.com/maps";

// A single real-place search. Coordinates remain required so an unplaced name
// can never become a fabricated product link; coordinate-only stops retain the
// exact-pin fallback.
export function mapsPlaceUrl(stop, placeContext = null) {
  if (!stop || !Number.isFinite(stop.lat) || !Number.isFinite(stop.lng)) return null;
  const name = firstText(stop.label, stop.name);
  if (!name) return `${MAPS}/search/?api=1&query=${stop.lat},${stop.lng}`;

  const queryParts = uniqueText([
    name,
    firstText(stop.address),
    firstText(stop.area),
    firstText(placeContext),
  ]);
  const params = new URLSearchParams();
  params.set("api", "1");
  params.set("query", queryParts.join(", "));
  return `${MAPS}/search/?${params.toString()}`;
}

function firstText(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function uniqueText(values) {
  const seen = new Set();
  return values.filter((value) => {
    if (!value) return false;
    const key = value.toLocaleLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// The consumer Maps directions URL supports a limited number of waypoints, so a
// long day is sampled down (keeping first + last) rather than truncated.
const MAX_WAYPOINTS = 8; // origin + 8 waypoints + destination = 10 stops

function validCoord(value) {
  return value && Number.isFinite(value.lat) && Number.isFinite(value.lng);
}

function sameCoord(a, b) {
  return validCoord(a) && validCoord(b) && a.lat === b.lat && a.lng === b.lng;
}

function sampleWaypoints(points) {
  if (points.length <= MAX_WAYPOINTS) return points;
  const first = points[0];
  const last = points[points.length - 1];
  const middle = points.slice(1, -1);
  const middleLimit = MAX_WAYPOINTS - 2;
  const step = middle.length / middleLimit;
  const sampled = Array.from({ length: middleLimit }, (_, index) => middle[Math.floor(index * step)]);
  return [first, ...sampled, last];
}

// A walking-directions URL across the day's stops in visit order. A trusted
// explicit origin/destination may frame the stop sequence (near-me uses the
// same anchor for both), while the default path remains first stop -> last stop.
export function mapsWalkingRouteUrl(stops, options = {}) {
  const pts = (Array.isArray(stops) ? stops : []).filter(
    (s) => validCoord(s),
  );
  const explicitOrigin = validCoord(options.origin) ? options.origin : null;
  const explicitDestination = validCoord(options.destination) ? options.destination : null;
  if ((!explicitOrigin || !explicitDestination) && pts.length < 2) return null;
  if (explicitOrigin && explicitDestination && pts.length < 1) return null;

  const origin = explicitOrigin ?? pts[0];
  const destination = explicitDestination ?? pts[pts.length - 1];
  const stopWaypoints = pts.slice(explicitOrigin ? 0 : 1, explicitDestination ? pts.length : -1);
  const waypoints = sampleWaypoints(
    stopWaypoints.filter((point) => !sameCoord(point, origin) && !sameCoord(point, destination)),
  );
  if (sameCoord(origin, destination) && waypoints.length === 0) return null;
  const params = new URLSearchParams();
  params.set("api", "1");
  params.set("origin", `${origin.lat},${origin.lng}`);
  params.set("destination", `${destination.lat},${destination.lng}`);
  if (waypoints.length) params.set("waypoints", waypoints.map((w) => `${w.lat},${w.lng}`).join("|"));
  params.set("travelmode", "walking");
  return `${MAPS}/dir/?${params.toString()}`;
}

// All day stops in visit order (districts flattened, order preserved).
export function dayStops(day) {
  const areas = day && Array.isArray(day.areas) ? day.areas : [];
  return areas.flatMap((a) => (Array.isArray(a.stops) ? a.stops : []));
}

// Route stops in the actual primary route order. This is intentionally separate
// from `dayStops()`: district/day structure can contain contextual candidates
// that are not part of the route the API actually returned.
export function primaryRouteStops(response) {
  const stops = response?.days?.[0]?.primary_route?.main_stops;
  return Array.isArray(stops) ? stops : [];
}
