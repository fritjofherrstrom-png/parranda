/**
 * Where the reader is on the day's line ("Du är här").
 *
 * Pure geometry over the stops' own coordinates, in route order — the same
 * order the line draws. It answers one of four things and never more:
 *
 *   - { state: "at", index }                  within reach of a station;
 *   - { state: "toward", next, toNextKm }     on the way; `next` is the next
 *                                             station, everything before it
 *                                             is behind the reader;
 *   - { state: "off" }                        too far from the line to say;
 *   - null                                    nothing to measure against.
 *
 * The walk between stations is not a street path Parranda computed (the map
 * draws it dotted for the same reason), so "toward" is read from the closest
 * straight segment, and a reader far from every segment is "off" rather than
 * assigned to one. Positions are used here and nowhere else: this module
 * keeps, stores and sends nothing.
 */

const EARTH_KM = 6371;

function finitePoint(point) {
  return point && Number.isFinite(point.lat) && Number.isFinite(point.lng);
}

/** Great-circle distance in km. */
export function distanceKm(a, b) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * The closest point on segment a→b to p, in a local flat projection (fine at
 * walking scale). Returns the segment parameter t in [0, 1] and the distance.
 */
function projectOnSegment(p, a, b) {
  const kx = Math.cos(((a.lat + b.lat) / 2) * (Math.PI / 180));
  const ax = a.lng * kx, ay = a.lat;
  const bx = b.lng * kx, by = b.lat;
  const px = p.lng * kx, py = p.lat;
  const dx = bx - ax, dy = by - ay;
  const lengthSq = dx * dx + dy * dy;
  const raw = lengthSq === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / lengthSq;
  const t = Math.max(0, Math.min(1, raw));
  const closest = { lat: ay + t * dy, lng: (ax + t * dx) / kx };
  return { t, raw, km: distanceKm(p, closest) };
}

/**
 * @param {Array<{lat?: number, lng?: number}>} stations the stops, in route order
 * @param {{lat: number, lng: number} | null | undefined} position
 * @param {{ atStationKm?: number, offLineKm?: number }} [options]
 */
export function lineProgress(stations, position, { atStationKm = 0.12, offLineKm = 1.5 } = {}) {
  if (!finitePoint(position) || !Array.isArray(stations)) return null;
  const placed = stations
    .map((station, index) => ({ station, index }))
    .filter(({ station }) => finitePoint(station));
  if (placed.length === 0) return null;

  let nearest = null;
  for (const entry of placed) {
    const km = distanceKm(position, entry.station);
    if (!nearest || km < nearest.km) nearest = { ...entry, km };
  }
  if (nearest.km <= atStationKm) return { state: "at", index: nearest.index };
  if (placed.length === 1) return nearest.km <= offLineKm ? { state: "toward", next: nearest.index, toNextKm: nearest.km } : { state: "off" };

  let best = null;
  for (let i = 0; i < placed.length - 1; i += 1) {
    const from = placed[i];
    const to = placed[i + 1];
    const projected = projectOnSegment(position, from.station, to.station);
    if (!best || projected.km < best.km) best = { from, to, ...projected };
  }
  if (best.km > offLineKm) return { state: "off" };
  // Before the segment's start, the reader is still heading to its first
  // station; otherwise to its second.
  const next = best.raw <= 0 ? best.from : best.to;
  return { state: "toward", next: next.index, toNextKm: distanceKm(position, next.station) };
}
