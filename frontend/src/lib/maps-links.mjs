/**
 * Pure builders for Google Maps deep links — testable without a DOM.
 * Coordinates are the source of truth (precise); names are for display only.
 * Nothing is ever fabricated: a stop without finite coords yields no link.
 */

const MAPS = "https://www.google.com/maps";

// A single place pin at real coordinates.
export function mapsPlaceUrl(stop) {
  if (!stop || !Number.isFinite(stop.lat) || !Number.isFinite(stop.lng)) return null;
  return `${MAPS}/search/?api=1&query=${stop.lat},${stop.lng}`;
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
