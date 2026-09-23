"use strict";

const {
  normalizeSourceEventDate, normalizeSourceEventDateTime,
  normalizeIanaTimezone, datePartsInTimezone,
} = require("../pulse-sources/source-event-time");

function addCalendarDays(date, days) {
  if (!normalizeSourceEventDate(date)) return null;
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function localCalendarDate(instant, timezone) {
  const parts = datePartsInTimezone(instant, timezone);
  return parts ? `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}` : null;
}

// Calendar selection is not a replacement clock. Source approval, cancellation,
// acquisition freshness and normalization must keep using the actual instant.
function eventOccursOnDate(event, date, now) {
  if (!normalizeSourceEventDate(date) || event?.freshness === "stale" || event?.timing_relevance === "stale") return false;
  const window = event?.time_window;
  const timezone = normalizeIanaTimezone(event?.timezone || window?.timezone);
  const instant = new Date(now);
  if (!Number.isFinite(instant.getTime())) return false;
  // Without a venue timezone, only expire dates already past everywhere. This
  // is a conservative bound, not a claim that the venue is in UTC-12.
  const today = localCalendarDate(instant, timezone || "Etc/GMT+12");
  if (today && date < today) return false;

  if (window?.kind === "all_day" || window?.kind === "daily") {
    const start = normalizeSourceEventDate(event.starts_on || window.starts_on);
    const end = normalizeSourceEventDate(event.ends_on || window.ends_on) || start;
    if (!start || !end || start > date || end < date) return false;
    if (window.kind === "all_day") return true; // date facts, never invented hours
    if (!timezone || !window.local_start || !window.local_end) return false;
    const endDate = window.local_end <= window.local_start ? addCalendarDays(date, 1) : date;
    const startsAt = normalizeSourceEventDateTime(`${date}T${window.local_start}`, { timezone });
    const endsAt = normalizeSourceEventDateTime(`${endDate}T${window.local_end}`, { timezone });
    return Boolean(startsAt && endsAt && new Date(endsAt) > instant && new Date(endsAt) > new Date(startsAt));
  }

  if (!timezone) return false; // no browser/UTC guess for the venue's calendar
  const start = new Date(event?.starts_at);
  if (!event?.starts_at || !Number.isFinite(start.getTime())) return false;
  if (!event.ends_at) return localCalendarDate(start, timezone) === date;
  const end = new Date(event.ends_at);
  if (!Number.isFinite(end.getTime()) || end <= start || end <= instant) return false;
  return intervalOverlapsDates(start.getTime(), end.getTime(), date, date, timezone);
}

// Compare the dates of actual instants, not manufactured local midnights:
// midnight can be skipped or repeated. The last included millisecond preserves
// exclusive source ends without inventing a duration. A spanning interval may
// cross an entirely skipped calendar date; locate its first real instant before
// accepting that date. Ordinary same-day events need only endpoint formatting.
function intervalOverlapsDates(start, end, firstDate, lastDate, timezone) {
  const startDate = localCalendarDate(start, timezone);
  const endDate = localCalendarDate(end - 1, timezone);
  if (!startDate || !endDate || startDate > lastDate || endDate < firstDate) return false;
  if (startDate >= firstDate || endDate <= lastDate) return true;
  let low = start;
  let high = end - 1;
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2);
    if (localCalendarDate(middle, timezone) < firstDate) low = middle + 1;
    else high = middle;
  }
  return localCalendarDate(low, timezone) <= lastDate;
}

function selectedDateBucket(event, selectedDate, now) {
  if (!normalizeSourceEventDate(selectedDate)) return null;
  const window = event?.time_window;
  const timezone = normalizeIanaTimezone(event?.timezone || window?.timezone);
  const instant = new Date(now);
  if (!Number.isFinite(instant.getTime()) || event?.freshness === "stale" || event?.timing_relevance === "stale") return null;
  let first;
  let last;
  if (window?.kind === "all_day" || window?.kind === "daily") {
    first = normalizeSourceEventDate(event.starts_on || window.starts_on);
    last = normalizeSourceEventDate(event.ends_on || window.ends_on) || first;
  } else {
    if (!timezone || !event?.starts_at) return null;
    const start = new Date(event.starts_at);
    const end = event.ends_at ? new Date(event.ends_at) : null;
    if (!Number.isFinite(start.getTime()) || (end && (!Number.isFinite(end.getTime()) || end <= start || end <= instant))) return null;
    first = localCalendarDate(start, timezone);
    last = end ? localCalendarDate(new Date(end.getTime() - 1), timezone) : first;
  }
  if (!first || !last) return null;
  const today = localCalendarDate(instant, timezone || "Etc/GMT+12");
  const horizon = addCalendarDays(selectedDate, 7);
  // Jump straight to the first possible overlap. Most records need one check,
  // not eight expensive timezone conversions for every warm-cache read.
  let date = [selectedDate, first, today].filter(Boolean).sort().at(-1);
  const finalDate = last < horizon ? last : horizon;
  for (; date && date <= finalDate; date = addCalendarDays(date, 1)) {
    if (eventOccursOnDate(event, date, instant)) return date === selectedDate ? "tonight" : "this_week";
  }
  return null;
}

// A source-local midnight handles DST without adding a fixed 24-hour offset.
// With no source timezone, date-only is still useful to a date-aware provider;
// final timestamp filtering will require event-level trusted timezone evidence.
function sourceWindowStart(selectedDate, timezone, now) {
  const date = normalizeSourceEventDate(selectedDate);
  if (!date) return now instanceof Date ? now.toISOString() : now;
  const start = normalizeSourceEventDateTime(`${date}T00:00:00`, { timezone });
  if (!start) return date;
  return new Date(start) < new Date(now) ? new Date(now).toISOString() : start;
}

module.exports = { addCalendarDays, localCalendarDate, eventOccursOnDate, selectedDateBucket, sourceWindowStart };
