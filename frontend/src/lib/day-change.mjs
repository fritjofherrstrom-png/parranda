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

const NAMED_STOPS = 2;

function primaryRoute(entry) {
  return entry?.safeResponse?.days?.[0]?.primary_route ?? null;
}

function routeStops(entry) {
  const stops = primaryRoute(entry)?.main_stops;
  return Array.isArray(stops) ? stops.filter((stop) => stop && typeof stop === "object") : [];
}

// A stop is the same stop when the engine gave it the same id. Only a stop the
// payload carries no id for is matched by its visible name.
function stopIdentity(stop) {
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
export function describeDayChange(previous, next) {
  const beforeStops = routeStops(previous);
  const afterStops = routeStops(next);
  const before = byIdentity(beforeStops);
  const after = byIdentity(afterStops);

  const added = [...after].filter(([key]) => !before.has(key)).map(([, stop]) => stopName(stop)).filter(Boolean);
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
  };
}

function names(list, lang) {
  const shown = list.slice(0, NAMED_STOPS).join(", ");
  const rest = list.length - NAMED_STOPS;
  if (rest <= 0) return shown;
  return lang === "sv" ? `${shown} och ${rest} till` : `${shown} and ${rest} more`;
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
  if (km && Math.round(km.before * 10) !== Math.round(km.after * 10)) {
    segments.push(`${walkingDistanceLabel(km.before, lang)} → ${walkingDistanceLabel(km.after, lang)}`);
  }
  if (stops.added.length) {
    segments.push(`+${stops.added.length} ${sv ? "stopp" : stops.added.length === 1 ? "stop" : "stops"}: ${names(stops.added, lang)}`);
  }
  if (stops.removed.length) {
    segments.push(`−${stops.removed.length}: ${names(stops.removed, lang)}`);
  }
  if (stops.reordered) segments.push(sv ? "samma stopp i ny ordning" : "same stops, new order");
  return segments;
}
