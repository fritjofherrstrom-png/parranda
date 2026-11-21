import { distanceKm } from './line-progress.mjs';
import { eventBoardClock, liveEventRelevance, pulseBrowseBuckets } from './pulse-view.mjs';

/** User selection references only: these helpers never mint source evidence. */
const ID = /^live:(\d{4}-\d{2}-\d{2}):[a-f0-9]{32}$/;

export function isLiveOccurrenceId(value) {
  if (typeof value !== "string") return false;
  const match = value.match(ID);
  if (!match) return false;
  const date = new Date(`${match[1]}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === match[1];
}

export function liveStopChoiceId(stop) {
  return isLiveOccurrenceId(stop?.live_occurrence_id) ? stop.live_occurrence_id : null;
}

// Display an action only for an actual server-admitted slot on the day being
// planned. A series is a container even when its representative has metadata.
export function selectableLiveOccurrenceId(event, date) {
  const id = liveStopChoiceId(event);
  return id && event.live_choice_eligible === true && event.occurrence_date === date &&
    id.slice(5, 15) === date && !(Array.isArray(event.occurrences) && event.occurrences.length)
    ? id : null;
}

const SUGGESTION_RADIUS_KM = 0.8;

/** Offer an evening finish when the exact occurrence and the published day agree. */
export function suggestLiveRouteEnd({ live, date, stops, selected, commitments, now, lang }) {
  if (!date || live?.selected_date !== date || live.coverage !== 'covered' || live.pending) return null;
  const lastStop = stops.at(-1);
  const lastLabel = (lastStop?.label || lastStop?.name || '').trim();
  if (stops.length < 2 || !lastLabel ||
      ![lastStop.lat, lastStop.lng].every(Number.isFinite) ||
      !['morning', 'midday', 'afternoon'].includes(lastStop.daypart) ||
      stops.some(stop => stop.is_live_event === true || stop.daypart === 'evening')) return null;

  const highlights = Array.isArray(live.tonight) ? live.tonight : [];
  const rows = [...highlights, ...pulseBrowseBuckets(live).tonight];
  for (const event of rows.flatMap(row => Array.isArray(row?.occurrences) && row.occurrences.length ? row.occurrences : [row])) {
    const id = selectableLiveOccurrenceId(event, date);
    if (!id || commitments[id] || typeof event.title !== 'string' || !event.title.trim() ||
        ![event.lat, event.lng].every(Number.isFinite) || distanceKm(lastStop, event) > SUGGESTION_RADIUS_KM) continue;
    const relevance = liveEventRelevance(event, selected);
    if (relevance?.kind !== 'match') continue;
    const start = event.starts_at || event.time_window?.starts_at;
    if (typeof start !== 'string' || !/(Z|[+-]\d\d:\d\d)$/.test(start) || !(Date.parse(start) > now.getTime())) continue;
    const clock = eventBoardClock(event, lang, now, date);
    if (!clock || clock.now || Number.parseInt(clock.at, 10) < 17) continue;
    return { event, lastLabel, relevance };
  }
  return null;
}

export function scopeLiveChoices(entries, date) {
  const scoped = {};
  const liveEventChoices = [];
  for (const [id, entry] of Object.entries(entries || {})) {
    if (id.startsWith("live:")) {
      if (!isLiveOccurrenceId(id) || id.slice(5, 15) !== date) continue;
      const action = entry?.kind === "pin" ? "keep"
        : entry?.kind === "exclude" && ["remove", "replace"].includes(entry.liveAction) ? entry.liveAction : null;
      if (!action) continue;
      liveEventChoices.push({ occurrence_id: id, action });
    }
    scoped[id] = entry;
  }
  return {
    entries: scoped,
    pinnedIds: Object.keys(scoped).filter(id => scoped[id]?.kind === "pin"),
    excludedIds: Object.keys(scoped).filter(id => scoped[id]?.kind === "exclude"),
    liveEventChoices,
  };
}
