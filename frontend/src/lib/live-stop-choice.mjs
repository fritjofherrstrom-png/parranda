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
