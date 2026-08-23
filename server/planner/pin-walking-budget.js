"use strict";

const { resolveAgnosticWalkingTargetBand } = require("./agnostic-walking-target");

/**
 * How many commitments a day can actually afford.
 *
 * A pin is a request, not a promise, and the thing it has to be affordable
 * against is the day that gets PUBLISHED — after ordering, after bridge
 * insertion, after capacity repair. Scoring anything earlier measures a route
 * that never reaches the user: the first version of this guard scored an
 * unordered array before bridge insertion, which could refuse a pin the
 * finished route would have absorbed, and accept one whose finished route
 * ended over the ceiling anyway.
 *
 * So the rule is expressed entirely in terms of finalised routes:
 *
 *   - Finalise the baseline with NO pins. That is the day the request would
 *     have produced anyway, and it is the only fair thing to judge against.
 *   - If the baseline fits inside the walking ceiling, the day with pins must
 *     fit inside it too.
 *   - If the baseline is already over the ceiling, the ceiling is not what
 *     discriminates — but pins must not make it worse, so they may not increase
 *     the baseline's distance.
 *
 * When a set does not settle, the lowest-priority pin is dropped and the day is
 * finalised again. The set strictly shrinks every iteration, so the loop runs at
 * most `pins.length + 1` times including the first attempt.
 */

/**
 * Deterministic drop order: farthest from the anchor goes first.
 *
 * Distance from the anchor is what actually makes a day unaffordable, so this
 * converges instead of shedding arbitrary commitments, and it is explainable in
 * one sentence — the places nearest you are the ones kept. Ties break on id so
 * two equidistant pins always resolve the same way.
 *
 * @returns {string[]} pins ordered most-droppable first
 */
function pinDropOrder(pins, origin, sourceCandidates) {
  const byId = new Map();
  for (const candidate of Array.isArray(sourceCandidates) ? sourceCandidates : []) {
    if (candidate && candidate.id != null) byId.set(String(candidate.id), candidate);
  }
  // An unknown distance sorts as "farthest": we cannot vouch for it, so it is
  // the first thing shed. A finite sentinel keeps the comparator arithmetic —
  // Infinity minus Infinity is NaN, and a NaN comparator silently corrupts the
  // sort order rather than failing.
  const UNKNOWN = Number.MAX_VALUE;
  const distance = (id) => {
    const candidate = byId.get(String(id));
    if (!candidate || !origin) return UNKNOWN;
    const { lat, lng } = candidate;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return UNKNOWN;
    if (!Number.isFinite(origin.lat) || !Number.isFinite(origin.lng)) return UNKNOWN;
    // Squared planar distance is enough to ORDER candidates around one anchor;
    // this never leaves this module and is never reported as a distance.
    const dLat = lat - origin.lat;
    const dLng = (lng - origin.lng) * Math.cos((origin.lat * Math.PI) / 180);
    return dLat * dLat + dLng * dLng;
  };
  return [...pins].sort((a, b) => {
    const delta = distance(b) - distance(a);
    if (delta !== 0) return delta;
    return String(a).localeCompare(String(b));
  });
}

function routeKm(finalized) {
  const km = finalized?.route?.estimated_km;
  return Number.isFinite(km) ? km : null;
}

/**
 * Does this finalised day afford its pins, judged against the pin-less one?
 */
function withinBudget({ withPins, baseline, ceilingKm }) {
  const pinnedKm = routeKm(withPins);
  const baselineKm = routeKm(baseline);
  // No pinned route at all is not a budget question — the caller reports the
  // pins unhonoured either way, and dropping more cannot conjure a route.
  if (pinnedKm === null) return true;
  if (baselineKm === null) return pinnedKm <= ceilingKm;
  if (baselineKm <= ceilingKm) return pinnedKm <= ceilingKm;
  // Already over the ceiling without any pin: do not blame the commitments for
  // that, but do not let them add to it either.
  return pinnedKm <= baselineKm;
}

/**
 * @param {object} params
 * @param {(pins: string[]) => Promise<object>} params.finalize full publish pipeline
 * @param {object} params.withPins already-finalised day for the full pin set
 * @param {string[]} params.pins requested pin ids
 * @returns {Promise<object>} the finalised day to publish
 */
async function settlePinsWithinWalkingBudget({
  finalize,
  withPins,
  pins,
  walkingKmTarget,
  origin,
  sourceCandidates,
  distanceMode = null,
}) {
  const requested = Array.isArray(pins) ? pins.filter(Boolean).map(String) : [];
  if (!requested.length) return withPins;

  const band = distanceMode === "no_limit" ? null : resolveAgnosticWalkingTargetBand(walkingKmTarget);
  if (!band || !Number.isFinite(band.ceilingKm)) return withPins;

  const baseline = await finalize([]);
  let current = withPins;
  let remaining = requested;
  // Most-droppable first, so each iteration removes the pin most likely to be
  // the reason the day does not fit.
  const dropOrder = pinDropOrder(requested, origin, sourceCandidates);

  for (const drop of dropOrder) {
    if (withinBudget({ withPins: current, baseline, ceilingKm: band.ceilingKm })) return current;
    // Strictly shrinks: `drop` is in `remaining` on every pass, so the set loses
    // one member each time and the loop cannot run more than requested.length
    // times after the first attempt.
    remaining = remaining.filter((id) => id !== drop);
    current = remaining.length ? await finalize(remaining) : baseline;
  }
  // Every pin dropped. `current` is the pin-less baseline, and each unhonoured
  // pin surfaces through the composed day exactly as before.
  return withinBudget({ withPins: current, baseline, ceilingKm: band.ceilingKm }) ? current : baseline;
}

module.exports = {
  pinDropOrder,
  settlePinsWithinWalkingBudget,
  withinBudget,
};
