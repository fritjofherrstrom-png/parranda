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

// A walking-directions URL across the day's stops in visit order. Returns null
// when there are fewer than 2 coord-bearing stops.
export function mapsWalkingRouteUrl(stops) {
  const pts = (Array.isArray(stops) ? stops : []).filter(
    (s) => s && Number.isFinite(s.lat) && Number.isFinite(s.lng),
  );
  if (pts.length < 2) return null;

  let chosen = pts;
  if (pts.length > MAX_WAYPOINTS + 2) {
    const first = pts[0];
    const last = pts[pts.length - 1];
    const middle = pts.slice(1, -1);
    const step = middle.length / MAX_WAYPOINTS;
    const sampled = [];
    for (let i = 0; i < MAX_WAYPOINTS; i += 1) sampled.push(middle[Math.floor(i * step)]);
    chosen = [first, ...sampled, last];
  }

  const origin = chosen[0];
  const destination = chosen[chosen.length - 1];
  const waypoints = chosen.slice(1, -1);
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
