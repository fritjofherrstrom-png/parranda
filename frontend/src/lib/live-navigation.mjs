import { liveHighlightGroups } from './pulse-view.mjs';

// Navigation is a view of the supplied evidence. Neither identity, eligibility
// nor rank is manufactured here; all rows retain their original event objects.
export function liveNavigationGroups(events, moreEvents, { sort = 'for_you', selectedPreferences = [] } = {}) {
  const list = values(events);
  const more = values(moreEvents);
  const relevance = liveHighlightGroups(list, selectedPreferences);
  const result = { ...relevance, more, dates: [], ranges: [], undated: [] };
  if (sort !== 'by_time') return result;

  const dates = new Map();
  for (const event of [...list, ...more]) {
    const slots = values(event.occurrences);
    for (const slot of slots.length ? slots : [event]) {
      for (const row of navigationRows(slot, slots.length ? event : null)) {
        if (row.kind === 'range') result.ranges.push(row);
        else if (!row.date) result.undated.push(row);
        else {
          if (!dates.has(row.date)) dates.set(row.date, []);
          dates.get(row.date).push(row);
        }
      }
    }
  }
  result.dates = [...dates].sort(([a], [b]) => a.localeCompare(b)).map(([date, rows]) => ({
    date,
    // All-day/date-only facts lead; ties retain their supplied order. A source
    // recurrence can appear on each of its stated dates without cloning facts.
    rows: rows.sort((a, b) => (a.clock || '').localeCompare(b.clock || '')),
  }));
  return result;
}

// These are supplied tags, not an inferred category taxonomy. The one internal
// provider marker is not reader-facing; preferences and titles are never read.
export function liveEventTags(event) {
  const tags = [];
  for (const value of Array.isArray(event?.tags) ? event.tags : []) {
    if (typeof value !== 'string') continue;
    const tag = value.trim();
    if (tag && tag !== 'community_event' && !tags.includes(tag)) tags.push(tag);
  }
  return tags;
}

function values(list) {
  return (Array.isArray(list) ? list : []).filter(value => value && typeof value === 'object');
}

function navigationRows(event, series) {
  const window = event.time_window || {};
  const kind = window.kind;
  const row = (date = null, clock = null, endClock = null, rowKind = 'undated') => ({
    event, series, date, clock, endClock, kind: rowKind,
  });
  const startsOn = validDate(window.starts_on || event.starts_on);
  const endsOn = validDate(window.ends_on || event.ends_on) || startsOn;

  // A holiday is a stated calendar date even when the source marks a half day.
  // Its programme and half-day caveats remain with the original event object.
  if (event.calendar_fact?.kind === 'public_holiday' && startsOn && startsOn === endsOn) {
    return [row(startsOn, null, null, 'date')];
  }
  if (kind === 'period' || kind === 'daily') return [row(null, null, null, 'range')];
  if (kind === 'occurrences') {
    const dates = (Array.isArray(window.dates) ? window.dates : []).map(validDate).filter(Boolean);
    return dates.length ? dates.map(date => row(date, validClock(window.local_start), validClock(window.local_end), 'date')) : [row()];
  }
  if (kind === 'all_day' || (!kind && !event.starts_at && startsOn)) {
    return [startsOn && startsOn === endsOn ? row(startsOn, null, null, 'date')
      : row(null, null, null, startsOn ? 'range' : 'undated')];
  }
  if (kind === 'continuous' || !kind) {
    const timezone = event.timezone || window.timezone;
    const start = localInstant(window.starts_at || event.starts_at, timezone);
    if (!start) return [row()];
    const end = localInstant(window.ends_at || event.ends_at, timezone);
    if (end && end.date !== start.date) return [row(null, null, null, 'range')];
    return [row(start.date, start.clock, end?.clock || null, 'date')];
  }
  return [row()];
}

function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : null;
}

function validClock(value) {
  return typeof value === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(value) ? value : null;
}

function localInstant(value, timezone) {
  if (typeof value !== 'string' || !/(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !timezone) return null;
  const instant = new Date(value);
  if (!Number.isFinite(instant.getTime())) return null;
  try {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(instant).map(part => [part.type, part.value]));
    return { date: `${parts.year}-${parts.month}-${parts.day}`, clock: `${parts.hour}:${parts.minute}` };
  } catch {
    return null;
  }
}
