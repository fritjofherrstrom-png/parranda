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
 *
 * This is a single shedding pass in a fixed order, NOT a search: it returns the
 * first affordable set reached by dropping farthest-first, which is not
 * necessarily the largest affordable subset. Dropping a nearer pin instead
 * might sometimes retain one more commitment, but finding that would mean
 * finalising combinations rather than a chain, and each finalisation is a full
 * compose. The fixed order is the deliberate trade: predictable cost, an
 * outcome the user can predict from the map, and a rule that fits in a
 * sentence.
 */

/**
 * How many times shedding may re-finalise before giving up.
 *
 * Every finalisation is a full compose — ordering, bridge insertion, capacity
 * repair, event weave — and can reach the engine several times. Measured with
 * twelve unaffordable pins against a modest fixture: 13 engine runs and ~2s of
 * event-loop time, against 2 runs and ~54ms for the same request with none.
 * That amplification is reachable from one public request, so the shedding
 * chain gets its own ceiling rather than inheriting the pin limit.
 *
 * Farthest-first converges quickly when a day is nearly affordable; a request
 * still unaffordable after this many sheds is one whose commitments do not fit
 * at all, and the honest answer there is the pin-less day with every pin
 * reported unhonoured — which is what the user would have got by shedding to
 * the end anyway, at several times the cost.
 */
const MAX_SHED_ATTEMPTS = 4;

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
    const aId = String(a);
    const bId = String(b);
    return aId < bId ? -1 : aId > bId ? 1 : 0;
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
  if (pinnedKm === null) {
    // The pins produced no route at all. If the request has no route WITHOUT
    // them either, that is the day, and no amount of shedding changes it. But
    // if the baseline does compose, the commitments are what broke it, and
    // accepting the empty result would hand the user nothing when a smaller
    // set of their choices would still have given them a day.
    return baselineKm === null;
  }
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
 * @returns {Promise<object>} the finalised day to publish, with `shedForBudget`
 *   naming the pins this rule dropped — the caller reports WHY, and only this
 *   function knows which refusals were the walk's doing.
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
  if (!requested.length) return { ...withPins, shedForBudget: [] };

  const band = distanceMode === "no_limit" ? null : resolveAgnosticWalkingTargetBand(walkingKmTarget);
  // No ceiling was asked for, so nothing here can refuse anything. A
  // no_limit request must never be told the walk was the reason.
  if (!band || !Number.isFinite(band.ceilingKm)) return { ...withPins, shedForBudget: [] };

  const baseline = await finalize([]);
  let current = withPins;
  let remaining = requested;
  const offeredIds = new Set(
    (Array.isArray(sourceCandidates) ? sourceCandidates : [])
      .map((candidate) => candidate?.id)
      .filter((id) => id != null && id !== "")
      .map(String),
  );
  // Most-droppable first, so each iteration removes the pin most likely to be
  // the reason the day does not fit. Unknown ids never reached composition and
  // therefore cannot truthfully be attributed to the walking budget.
  const dropOrder = pinDropOrder(requested.filter((id) => offeredIds.has(id)), origin, sourceCandidates);

  const shedForBudget = [];
  let sheds = 0;
  for (const drop of dropOrder) {
    if (withinBudget({ withPins: current, baseline, ceilingKm: band.ceilingKm })) {
      return { ...current, shedForBudget };
    }
    if (sheds >= MAX_SHED_ATTEMPTS) {
      // Giving up publishes the pin-less day, so every pin still standing was
      // refused by the walk just as surely as the ones already shed — provided
      // it was genuinely in the offered candidate set.
      const offeredRemaining = remaining.filter((id) => offeredIds.has(id));
      return { ...baseline, shedForBudget: [...new Set([...shedForBudget, ...offeredRemaining])] };
    }
    // Strictly shrinks: `drop` is in `remaining` on every pass, so the set loses
    // one member each time and the loop cannot run more than requested.length
    // times after the first attempt — and no more than MAX_SHED_ATTEMPTS.
    remaining = remaining.filter((id) => id !== drop);
    shedForBudget.push(drop);
    current = remaining.length ? await finalize(remaining) : baseline;
    sheds += 1;
  }
  // Every pin shed. `current` is the pin-less baseline, and each unhonoured pin
  // surfaces through the composed day exactly as before.
  const settled = withinBudget({ withPins: current, baseline, ceilingKm: band.ceilingKm }) ? current : baseline;
  return { ...settled, shedForBudget };
}

module.exports = {
  MAX_SHED_ATTEMPTS,
  pinDropOrder,
  settlePinsWithinWalkingBudget,
  withinBudget,
};
