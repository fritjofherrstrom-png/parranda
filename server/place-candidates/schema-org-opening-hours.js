"use strict";

const { evaluateOpeningHoursForWindow, normalizeOpeningHours } = require("./opening-hours");

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const TOKENS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
const has = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const hasOverrides = value => ["validFrom", "validThrough", "specialOpeningHoursSpecification"]
  .some(key => has(value, key));

/**
 * Preserve only weekly schema.org facts that the existing hours evaluator can
 * represent. A partial structured week cannot imply closures on unstated days;
 * dated/special overrides need a calendar-aware reader and remain unknown here.
 */
function normalizeSchemaOrgOpeningHours(place) {
  if (!place || typeof place !== "object" || Array.isArray(place) || hasOverrides(place)) return null;
  const text = place.openingHours;
  const structured = place.openingHoursSpecification;
  if (text != null && structured != null) return null;

  if (text != null) {
    const values = Array.isArray(text) ? text : [text];
    if (!values.length || values.length > 32 || values.some(value => typeof value !== "string" || !value.trim())) return null;
    return supportedSchedule(values.map(value => value.trim()).join("; "));
  }
  if (structured == null) return null;
  const entries = Array.isArray(structured) ? structured : [structured];
  if (!entries.length || entries.length > 7) return null;
  const week = new Map();
  for (const entry of entries) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry) || hasOverrides(entry)) return null;
    if (has(entry, "@type") && !["OpeningHoursSpecification", "https://schema.org/OpeningHoursSpecification", "http://schema.org/OpeningHoursSpecification"].includes(entry["@type"])) return null;
    const values = Array.isArray(entry.dayOfWeek) ? entry.dayOfWeek : [entry.dayOfWeek];
    if (!values.length || values.length > 7) return null;
    const days = values.map(dayIndex);
    if (days.some(day => day < 0) || new Set(days).size !== days.length || days.some(day => week.has(day))) return null;

    // schema.org defines a stated day without opens as closed. A malformed
    // supplied clock is still unknown, rather than an implied closure.
    let rule = "off";
    if (has(entry, "opens")) {
      const opens = clock(entry.opens, false);
      const closes = clock(entry.closes, true);
      if (!opens || !closes || opens === closes) return null;
      rule = `${opens}-${closes}`;
    } else if (has(entry, "closes") && !clock(entry.closes, true)) return null;
    for (const day of days) week.set(day, rule);
  }
  if (week.size !== 7) return null;
  return supportedSchedule(TOKENS.map((day, index) => `${day} ${week.get(index)}`).join("; "));
}

function supportedSchedule(value) {
  const schedule = normalizeOpeningHours(value);
  return schedule && evaluateOpeningHoursForWindow(schedule, { weekday: 0 }).status !== "unknown" ? schedule : null;
}

function dayIndex(value) {
  if (value && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value).length === 1 && typeof value["@id"] === "string") value = value["@id"];
  if (typeof value !== "string") return -1;
  const name = value.replace(/^https?:\/\/schema\.org\//, "");
  return DAYS.indexOf(name);
}

function clock(value, allowEndOfDay) {
  if (typeof value !== "string" || !/^\d{2}:\d{2}(?::00)?$/.test(value)) return null;
  const [hour, minute] = value.split(":").map(Number);
  if (minute > 59 || hour > 24 || (hour === 24 && (!allowEndOfDay || minute !== 0))) return null;
  return value.slice(0, 5);
}

module.exports = { normalizeSchemaOrgOpeningHours };
