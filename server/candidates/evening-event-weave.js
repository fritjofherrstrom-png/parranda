"use strict";

/**
 * Weave a genuine selected-day evening event INTO the composed day.
 *
 * The district day (place_structure.district_day) says WHERE to go. Stable places
 * tell you what a place IS; this gives the day an honest EVENING ANCHOR — a real
 * happening tonight, with its own time window and source, tied to the nearest
 * district so the day reads "...and end your evening at X, near the Y quarter."
 *
 * It is an ANCHOR, not a walking-validated route stop: no ETA, no walking time, no
 * geometry is claimed for it — only the event's real start/end, place, and source.
 * Pure + deterministic. Additive + honest: if there is no genuine, geocoded
 * tonight-event, the day is returned UNCHANGED (no fabricated happening).
 */

const { haversineKm } = require("./area-intelligence");
const {
  datePartsInTimezone,
  normalizeIanaTimezone,
  normalizeSourceEventDate,
  normalizeSourceEventDateTime,
} = require("../pulse-sources/source-event-time");

const EVENING_START_MINUTES = 17 * 60;

function dateKeyFromParts(parts) {
  if (!parts) return null;
  return [parts.year, parts.month, parts.day]
    .map((value, index) => String(value).padStart(index === 0 ? 4 : 2, "0"))
    .join("-");
}

function addDateDays(dateKey, days) {
  const date = normalizeSourceEventDate(dateKey);
  if (!date) return null;
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

function clockMinutes(value) {
  const match = String(value || "").match(/^(\d{2}):(\d{2})(?::\d{2})?$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return hour * 60 + minute;
}

function localDateTime(date, value) {
  const match = String(value || "").match(/^(\d{2}):(\d{2})(?::(\d{2}))?$/);
  return match ? `${date}T${match[1]}:${match[2]}:${match[3] || "00"}` : null;
}

function eventKey(event) {
  return event?.id || event?.source_url || [event?.title, event?.starts_at, event?.starts_on]
    .filter(Boolean)
    .join("|");
}

function selectedDayCandidates(liveEvents) {
  const browse = liveEvents?.browse || {};
  const buckets = [
    restoreEventRanking(liveEvents?.tonight, browse.tonight?.more),
    restoreEventRanking(liveEvents?.this_week, browse.this_week?.more),
  ];
  const seen = new Set();
  const candidates = [];
  for (const bucket of buckets) {
    for (const event of Array.isArray(bucket) ? bucket : []) {
      const key = eventKey(event);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      candidates.push(event);
    }
  }
  return candidates;
}

// Live may reserve its final highlight slot for a strong local discovery. Route
// composition must remain independent of that presentation choice, so put the
// displaced sixth ranked row back before the promoted discovery when rebuilding
// the selected-day evidence order.
function restoreEventRanking(highlights, more) {
  const visible = Array.isArray(highlights) ? highlights : [];
  const browse = Array.isArray(more) ? more : [];
  const discoveryIndex = visible.findIndex((event) => event?.highlight_reason === "local_serendipity");
  if (discoveryIndex < 0) return [...visible, ...browse];
  const discovery = visible[discoveryIndex];
  const ordinary = visible.filter((_, index) => index !== discoveryIndex);
  return browse.length > 0
    ? [...ordinary, browse[0], discovery, ...browse.slice(1)]
    : [...ordinary, discovery];
}

function materializeDailyOccurrence(event, selectedDate) {
  const window = event?.time_window;
  const timezone = normalizeIanaTimezone(event?.timezone || window?.timezone);
  const startsOn = normalizeSourceEventDate(event?.starts_on || window?.starts_on);
  const endsOn = normalizeSourceEventDate(event?.ends_on || window?.ends_on) || startsOn;
  const startMinutes = clockMinutes(window?.local_start);
  const endMinutes = clockMinutes(window?.local_end);
  if (
    window?.kind !== "daily" ||
    !timezone ||
    !startsOn ||
    !endsOn ||
    selectedDate < startsOn ||
    selectedDate > endsOn ||
    startMinutes == null ||
    startMinutes < EVENING_START_MINUTES
  ) {
    return null;
  }

  const localStartsAt = localDateTime(selectedDate, window.local_start);
  const startsAt = normalizeSourceEventDateTime(localStartsAt, { timezone });
  if (!startsAt) return null;
  const endDate = endMinutes != null && endMinutes <= startMinutes
    ? addDateDays(selectedDate, 1)
    : selectedDate;
  const localEndsAt = endDate ? localDateTime(endDate, window.local_end) : null;
  const endsAt = endMinutes == null || !localEndsAt
    ? null
    : normalizeSourceEventDateTime(localEndsAt, { timezone });
  if (endMinutes != null && !endsAt) return null;

  return {
    ...event,
    starts_at: startsAt,
    ends_at: endsAt,
    starts_on: selectedDate,
    ends_on: endDate || selectedDate,
    timezone,
    timing_relevance: "tonight",
    occurrence_date: selectedDate,
  };
}

function materializeContinuousOccurrence(event, selectedDate) {
  if (!event?.starts_at) return null;
  const timezone = normalizeIanaTimezone(event.timezone || event.time_window?.timezone);
  if (!timezone) return null;
  const starts = datePartsInTimezone(event.starts_at, timezone);
  if (!starts || dateKeyFromParts(starts) !== selectedDate) return null;
  const timing = String(event.timing_relevance || "").toLowerCase();
  if (timing === "stale") return null;
  if (starts.hour * 60 + starts.minute < EVENING_START_MINUTES && timing !== "now") return null;
  const ends = event.ends_at ? datePartsInTimezone(event.ends_at, timezone) : null;
  return {
    ...event,
    starts_on: selectedDate,
    ends_on: dateKeyFromParts(ends) || selectedDate,
    timezone,
    timing_relevance: timing === "now" ? "now" : "tonight",
    occurrence_date: selectedDate,
  };
}

function eventOccurrenceForDate(event, selectedDate) {
  const date = normalizeSourceEventDate(selectedDate);
  if (!event || !date) return null;
  if (event.time_window?.kind === "daily") return materializeDailyOccurrence(event, date);
  if (event.time_window?.kind === "all_day") return null;
  return materializeContinuousOccurrence(event, date);
}

function weaveEveningEvent(placeStructure, liveEvents, { selectedDate = null } = {}) {
  if (!placeStructure || typeof placeStructure !== "object" || !placeStructure.district_day) {
    return placeStructure;
  }
  const requestedDate = normalizeSourceEventDate(selectedDate);
  const tonight = requestedDate
    ? selectedDayCandidates(liveEvents)
      .map((event) => eventOccurrenceForDate(event, requestedDate))
      .filter(Boolean)
    : restoreOriginalHighlights(liveEvents?.tonight, liveEvents?.browse?.tonight?.more);
  // The list is already salience-ranked; take the top event that has real
  // coordinates AND is salient enough to shape a visitor-facing day. Civic/admin
  // notices can stay in Pulse/source inspect, but must not become an evening
  // anchor just because they are timed and geocoded.
  const event = tonight.find(isEligibleEveningAnchor);
  if (!event) return placeStructure;

  const areas = Array.isArray(placeStructure.district_day.areas) ? placeStructure.district_day.areas : [];
  let nearIndex = null;
  let nearKm = Infinity;
  areas.forEach((area, i) => {
    const c = area && area.center;
    if (c && Number.isFinite(c.lat) && Number.isFinite(c.lng)) {
      const d = haversineKm({ lat: event.lat, lng: event.lng }, c);
      if (d < nearKm) {
        nearKm = d;
        nearIndex = i;
      }
    }
  });

  const eveningEvent = {
    id: event.id || null,
    title: event.title || null,
    starts_at: event.starts_at || null,
    ends_at: event.ends_at || null,
    starts_on: event.starts_on || null,
    ends_on: event.ends_on || null,
    time_window: event.time_window || null,
    occurrence_date: event.occurrence_date || null,
    place: event.place || null,
    source_label: event.source_label || null,
    source_url: event.source_url || null,
    license: event.license || null,
    cultural_tier: event.cultural_tier || null,
    salience_score: Number.isFinite(event.salience_score) ? event.salience_score : null,
    // Venue-local timezone rides along (same contract as the event views) so a
    // "tonight at 19:00" renders in the VENUE's clock wherever it is shown.
    timezone: event.timezone || null,
    lat: event.lat,
    lng: event.lng,
    near_area_index: nearIndex,
    near_area_km: nearIndex != null && Number.isFinite(nearKm) ? Number(nearKm.toFixed(2)) : null,
  };

  return {
    ...placeStructure,
    district_day: { ...placeStructure.district_day, evening_event: eveningEvent },
  };
}

function restoreOriginalHighlights(highlights, more) {
  const visible = Array.isArray(highlights) ? highlights : [];
  const discoveryIndex = visible.findIndex((event) => event?.highlight_reason === "local_serendipity");
  if (discoveryIndex < 0) return visible;
  const displaced = Array.isArray(more) ? more[0] : null;
  const ordinary = visible.filter((_, index) => index !== discoveryIndex);
  return displaced ? [...ordinary, displaced] : [...ordinary, visible[discoveryIndex]];
}

function isEligibleEveningAnchor(event) {
  if (!event || typeof event !== "object") return false;
  if (event.route_eligible === false) return false;
  if (!Number.isFinite(event.lat) || !Number.isFinite(event.lng)) return false;
  if (!(event.title || event.id)) return false;
  if (!event.source_url && !event.source_label) return false;

  const timing = String(event.timing_relevance || "").toLowerCase();
  if (timing && !["now", "today", "tonight"].includes(timing)) return false;

  if (event.cultural_tier === "administrative") return false;
  if (event.cultural_tier === "cultural") return true;

  // Older injected/event fixtures may predate cultural_tier. Keep the path
  // useful for clearly salient events, while still preventing low-score noise
  // from becoming the day's anchor.
  if (Number.isFinite(event.salience_score)) return event.salience_score >= 6;
  return true;
}

module.exports = {
  eventOccurrenceForDate,
  isEligibleEveningAnchor,
  weaveEveningEvent,
};
