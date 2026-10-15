"use strict";

const { createHash } = require("node:crypto");
const {
  normalizeSourceEventDate,
  normalizeIanaTimezone,
  datePartsInTimezone,
} = require("../pulse-sources/source-event-time");

const ID = /^live:(\d{4}-\d{2}-\d{2}):[a-f0-9]{32}$/;
const MAX_CHOICES = 52; // Existing commitment budgets: 12 pins + 40 exclusions.

function occurrenceDate(id) {
  const match = typeof id === "string" && id.match(ID);
  return match && normalizeSourceEventDate(match[1]) === match[1] ? match[1] : null;
}

// Issued from source facts after selected-day materialization, never titles or
// client coordinates. A source's stated title/end update preserves identity;
// another local date or start instant remains a different occurrence.
function liveOccurrenceId(event) {
  const id = typeof event?.id === "string" ? event.id : null;
  const source = event?.source_provider_id || event?.source_url;
  const timezone = normalizeIanaTimezone(event?.timezone || event?.time_window?.timezone);
  if (typeof event?.starts_at !== "string" || !/(?:Z|[+-]\d{2}:\d{2})$/i.test(event.starts_at)) return null;
  const start = Date.parse(event.starts_at);
  if (!id || !source || !timezone || !Number.isFinite(start)) return null;
  const parts = datePartsInTimezone(start, timezone);
  if (!parts) return null;
  const localDate = [parts.year, String(parts.month).padStart(2, "0"), String(parts.day).padStart(2, "0")].join("-");
  const date = normalizeSourceEventDate(event.occurrence_date || event.starts_on) || localDate;
  if (date !== localDate) return null;
  const hash = createHash("sha256")
    .update(JSON.stringify([source, id, date, new Date(start).toISOString()]))
    .digest("hex").slice(0, 32);
  return `live:${date}:${hash}`;
}

function parseLiveEventChoices(value) {
  if (value === undefined) return { choices: [], valid: true };
  if (!Array.isArray(value) || value.length > MAX_CHOICES) return { choices: [], valid: false };
  const choices = [];
  const seen = new Set();
  for (const row of value) {
    if (!row || typeof row !== "object" || Array.isArray(row) || Object.keys(row).length !== 2 ||
        !occurrenceDate(row.occurrence_id) || !["keep", "remove", "replace"].includes(row.action) ||
        seen.has(row.occurrence_id)) return { choices: [], valid: false };
    seen.add(row.occurrence_id);
    choices.push({ occurrence_id: row.occurrence_id, action: row.action });
  }
  return { choices, valid: true };
}

function activeLiveChoices(choices, date) {
  return (Array.isArray(choices) ? choices : []).filter(choice => occurrenceDate(choice?.occurrence_id) === date);
}

function summarizeLiveChoices(choices, stops, date) {
  const active = activeLiveChoices(choices, date);
  const kept = active.filter(choice => choice.action === "keep");
  const present = new Set((Array.isArray(stops) ? stops : [])
    .filter(stop => stop.is_live_event === true && stop.live_choice_eligible === true)
    .map(stop => stop.live_occurrence_id));
  return {
    requested_count: active.length,
    ignored_other_day_count: choices.length - active.length,
    remove_requested: active.some(choice => choice.action === "remove"),
    honored_count: kept.filter(choice => present.has(choice.occurrence_id)).length,
    unhonored: kept.filter(choice => !present.has(choice.occurrence_id))
      .map(choice => ({ id: choice.occurrence_id, reason: "event_not_available_or_eligible" })),
  };
}

module.exports = { liveOccurrenceId, occurrenceDate, parseLiveEventChoices, activeLiveChoices, summarizeLiveChoices };
