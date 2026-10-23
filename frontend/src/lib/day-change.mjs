/**
 * What an adjustment changed, stated from the two days themselves.
 *
 * Past arrival the day recomposes on its own when an adjustment settles, so a
 * change must never be silent: the replacement day is shown with one line that
 * says which inputs changed and what the route gained, lost or kept. A change
 * that left the day as it was says that too, which is itself an answer.
 *
 * Everything here is read from the two published days and the inputs each one
 * answered. Nothing is inferred, ranked or explained beyond that.
 *
 * Pure: no DOM, no clock, no network.
 */

import { walkingDistanceLabel } from "./route-context-view.mjs";
import { liveStopChoiceId } from "./live-stop-choice.mjs";


function primaryRoute(entry) {
  return entry?.safeResponse?.days?.[0]?.primary_route ?? null;
}

function routeStops(entry) {
  const stops = primaryRoute(entry)?.main_stops;
  return Array.isArray(stops) ? stops.filter((stop) => stop && typeof stop === "object") : [];
}

// Live visits use the source-issued occurrence, since one series can have
// multiple starts. Ordinary places and legacy stops retain their place id.
function stopIdentity(stop) {
  const occurrence = stop.is_live_event === true && liveStopChoiceId(stop);
  if (occurrence) return `occurrence:${occurrence}`;
  const id = stop.id ?? stop.candidate_id ?? stop.place_id ?? null;
  if (id !== null && String(id).trim()) return `id:${String(id).trim()}`;
  const name = stopName(stop).toLowerCase();
  return name ? `name:${name}` : null;
}

function stopName(stop) {
  return String(stop.label ?? stop.name ?? "").trim();
}

function byIdentity(stops) {
  const index = new Map();
  for (const stop of stops) {
    const key = stopIdentity(stop);
    if (key && !index.has(key)) index.set(key, stop);
  }
  return index;
}

function finiteKm(value) {
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function isDayOffset(value) {
  return value === 0 || value === 1;
}

/**
 * @param {object|null} previous  the saved entry of the day that was on screen
 * @param {object|null} next      the saved entry of the day that replaced it
 */
export function describeDayChange(previous, next, { cause = null, trigger = null } = {}) {
  const beforeStops = routeStops(previous);
  const afterStops = routeStops(next);
  const before = byIdentity(beforeStops);
  const after = byIdentity(afterStops);

  const addedStops = [...after].filter(([key]) => !before.has(key)).map(([, stop]) => stop);
  const added = addedStops.map(stopName).filter(Boolean);
  const removed = [...before].filter(([key]) => !after.has(key)).map(([, stop]) => stopName(stop)).filter(Boolean);
  const keptKeys = [...after.keys()].filter((key) => before.has(key));
  const sameSet = added.length === 0 && removed.length === 0 && before.size === after.size;
  const reordered = sameSet && keptKeys.join("|") !== [...before.keys()].join("|");

  const kmBefore = finiteKm(primaryRoute(previous)?.estimated_km);
  const kmAfter = finiteKm(primaryRoute(next)?.estimated_km);
  const km = kmBefore !== null && kmAfter !== null ? { before: kmBefore, after: kmAfter } : null;
  const kmChanged = km !== null && Math.round(km.before * 10) !== Math.round(km.after * 10);

  const was = previous?.inputs ?? {};
  const now = next?.inputs ?? {};
  const walk =
    typeof was.walkKey === "string" && typeof now.walkKey === "string" && was.walkKey !== now.walkKey
      ? { from: was.walkKey, to: now.walkKey }
      : null;
  const day =
    isDayOffset(was.dayOffset) && isDayOffset(now.dayOffset) && was.dayOffset !== now.dayOffset
      ? { from: was.dayOffset, to: now.dayOffset }
      : null;
  const wasPicks = Array.isArray(was.selected) ? was.selected : [];
  const nowPicks = Array.isArray(now.selected) ? now.selected : [];

  return {
    inputs: {
      walk,
      day,
      picksAdded: nowPicks.filter((key) => !wasPicks.includes(key)),
      picksRemoved: wasPicks.filter((key) => !nowPicks.includes(key)),
    },
    stops: {
      added,
      removed,
      kept: keptKeys.length,
      before: beforeStops.length,
      after: afterStops.length,
      reordered,
    },
    km,
    hasRoute: afterStops.length > 0,
    routeChanged: !sameSet || reordered || kmChanged,
    // A real Live occurrence may arrive in an ordinary adjustment or a separate
    // completion. Compare the published identities, not the response lane.
    cause: cause === "live" || addedStops.some((stop) => stop.is_live_event === true && liveStopChoiceId(stop)) ? "live" : null,
    // What the reader did to get here, when it was not an input change:
    // "recheck" is looking for more places with the same inputs. The line
    // is said under that name; what changed (Live included) is still said.
    trigger: trigger === "recheck" ? "recheck" : null,
  };
}

/**
 * The change as short phrases in the page's language, most specific first:
 * the inputs the user touched, then what the route did. Labels for walks,
 * picks and days come from the caller so this module owns no product copy
 * beyond the connecting words.
 *
 * @param {ReturnType<typeof describeDayChange>} change
 * @param {{ lang?: string, walkLabel?: (key: string) => string, pickLabel?: (key: string) => string, dayLabel?: (offset: 0 | 1) => string }} [labels]
 * @returns {string[]}
 */
export function dayChangeSegments(change, { lang = "en", walkLabel = (key) => key, pickLabel = (key) => key, dayLabel = (offset) => String(offset) } = {}) {
  if (!change) return [];
  const sv = lang === "sv";
  const segments = [];
  const { inputs, stops, km } = change;

  if (change.cause === "live") segments.push(sv ? "Live: evenemang tillagt" : "Live: event added");

  if (inputs.walk) segments.push(`${walkLabel(inputs.walk.from)} → ${walkLabel(inputs.walk.to)}`);
  if (inputs.day) segments.push(`${dayLabel(inputs.day.from)} → ${dayLabel(inputs.day.to)}`);
  for (const key of inputs.picksAdded) segments.push(`+ ${pickLabel(key)}`);
  for (const key of inputs.picksRemoved) segments.push(`− ${pickLabel(key)}`);

  if (!change.hasRoute) {
    segments.push(sv ? "ingen rutt för det här valet" : "no route for this choice");
    return segments;
  }
  if (!change.routeChanged) {
    segments.push(sv ? "samma stopp och sträcka" : "same stops and distance");
    return segments;
  }
  // One short line: counts, not names. The new stops are listed in the day
  // right below, and five wrapped lines of names made the card bulky.
  const count = (n) => `${n} ${sv ? "stopp" : n === 1 ? "stop" : "stops"}`;
  const swapped = Math.min(stops.added.length, stops.removed.length);
  if (swapped) segments.push(sv ? `${count(swapped)} ${swapped === 1 ? "bytt" : "bytta"}` : `${count(swapped)} swapped`);
  if (stops.added.length > swapped) segments.push(`+${count(stops.added.length - swapped)}`);
  if (stops.removed.length > swapped) segments.push(`−${count(stops.removed.length - swapped)}`);
  if (km && Math.round(km.before * 10) !== Math.round(km.after * 10)) {
    segments.push(`${walkingDistanceLabel(km.before, lang).replace(/ km$/, "")} → ${walkingDistanceLabel(km.after, lang)}`);
  }
  if (stops.reordered) segments.push(sv ? "samma stopp i ny ordning" : "same stops, new order");
  return segments;
}
