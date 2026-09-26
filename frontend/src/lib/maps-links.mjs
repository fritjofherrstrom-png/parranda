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

// Google documents at most three intermediate waypoints on mobile browsers.
// Use that portable limit on every device; never sample away published stops.
// https://developers.google.com/maps/documentation/urls/get-started#directions-action
const MAX_WAYPOINTS = 3;

function validCoord(value) {
  return value && Number.isFinite(value.lat) && Math.abs(value.lat) <= 90
    && Number.isFinite(value.lng) && Math.abs(value.lng) <= 180;
}

function sameCoord(a, b) {
  return validCoord(a) && validCoord(b) && a.lat === b.lat && a.lng === b.lng;
}

function walkingUrl(points) {
  const origin = points[0];
  const destination = points[points.length - 1];
  const waypoints = points.slice(1, -1);
  const params = new URLSearchParams();
  params.set("api", "1");
  params.set("origin", `${origin.lat},${origin.lng}`);
  params.set("destination", `${destination.lat},${destination.lng}`);
  if (waypoints.length) params.set("waypoints", waypoints.map((w) => `${w.lat},${w.lng}`).join("|"));
  params.set("travelmode", "walking");
  return `${MAPS}/dir/?${params.toString()}`;
}

// Every published stop must be locatable. Parts share their boundary point and
// preserve intermediate revisits and woven events. Adjacent identical points
// need no walking leg. A typed-place discovery anchor is not an implicit start;
// callers pass the published near-me anchor explicitly when appropriate.
//
// Each part says where it starts and ends — `{ kind: "origin" | "stop" |
// "destination", point, index? }`, with `index` into `stops` — and which stops
// it newly reaches (`stopIndexes`; a boundary stop belongs to the part that
// arrives at it), so a caller can name a part instead of numbering it.
export function mapsWalkingRouteParts(stops, options = {}) {
  if (!Array.isArray(stops) || stops.length === 0 || !stops.every(validCoord)) return [];
  if (options.origin != null && !validCoord(options.origin)) return [];
  if (options.destination != null && !validCoord(options.destination)) return [];
  const sequence = [
    ...(options.origin ? [{ kind: "origin", point: options.origin }] : []),
    ...stops.map((point, index) => ({ kind: "stop", point, index })),
    ...(options.destination ? [{ kind: "destination", point: options.destination }] : []),
  ];
  const entries = sequence.filter((entry, i) => i === 0 || !sameCoord(entry.point, sequence[i - 1].point));
  const parts = [];
  for (let i = 0; i < entries.length - 1; i += MAX_WAYPOINTS + 1) {
    const slice = entries.slice(i, i + MAX_WAYPOINTS + 2);
    parts.push({
      url: walkingUrl(slice.map((entry) => entry.point)),
      from: slice[0],
      to: slice[slice.length - 1],
      stopIndexes: slice
        .filter((entry, k) => entry.kind === "stop" && !(i > 0 && k === 0))
        .map((entry) => entry.index),
    });
  }
  return parts;
}

export function mapsWalkingRouteUrls(stops, options = {}) {
  return mapsWalkingRouteParts(stops, options).map((part) => part.url);
}

// Compatibility helper for callers that can present exactly one link. Never
// return a partial route under a whole-route label.
export function mapsWalkingRouteUrl(stops, options = {}) {
  const urls = mapsWalkingRouteUrls(stops, options);
  return urls.length === 1 ? urls[0] : null;
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
