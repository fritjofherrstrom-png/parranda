/**
 * Explicit Maps handoff for the remaining published walk, not a new day.
 * Current GPS is memory-only. No route, visit history or saved state is changed.
 * A fix near a station offers a choice; it never proves earlier visits.
 */
import { distanceKm } from './line-progress.mjs';
import { mapsWalkingRouteParts } from './maps-links.mjs';

const AT_STATION_KM = 0.12;
const MAX_FIX_AGE_MS = 60000;
// Same bounded clock tolerance as the existing useFollowPosition session.
const FUTURE_FIX_TOLERANCE_MS = 5000;

function finitePoint(point) {
  return point && Number.isFinite(point.lat) && Math.abs(point.lat) <= 90
    && Number.isFinite(point.lng) && Math.abs(point.lng) <= 180;
}

export function buildWalkingContinuation({
  stops, position, enabled = false, destination = null, now = Date.now(),
} = {}) {
  if (enabled !== true || !Array.isArray(stops) || stops.length < 2
      || !stops.every(finitePoint) || !finitePoint(position)
      || !Number.isFinite(position.accuracy) || position.accuracy < 0 || position.accuracy > 120
      || !Number.isFinite(position.timestamp) || !Number.isFinite(now)
      || position.timestamp < now - MAX_FIX_AGE_MS
      || position.timestamp > now + FUTURE_FIX_TOLERANCE_MS
      || (destination !== null && !finitePoint(destination))) return null;

  // Never cut a prefix from a straight-line segment or an ambiguous station
  // cluster. A nearby station plus the reader's explicit action selects the
  // continuation; the current station itself remains part of that walk.
  const nearby = stops.map((stop, index) => ({ stop, index }))
    .filter(({ stop }) => distanceKm(position, stop) <= AT_STATION_KM);
  if (nearby.length !== 1 || nearby[0].index === 0) return null;
  const { stop, index } = nearby[0];
  const remaining = stops.slice(index);
  if (remaining.length === 1 && (!destination ||
      (stop.lat === destination.lat && stop.lng === destination.lng))) return null;
  const parts = mapsWalkingRouteParts(remaining, {
    origin: { lat: position.lat, lng: position.lng }, destination,
  });
  if (!parts.length) return null;
  return { fromIndex: index, fromStop: stop, parts };
}
