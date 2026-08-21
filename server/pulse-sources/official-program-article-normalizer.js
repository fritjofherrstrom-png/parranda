"use strict";

const { createHash } = require("node:crypto");

const { normalizeIanaTimezone } = require("./source-event-time");
const { fold } = require("./official-program-article-document");
const {
  addDateDays,
  buildEventTiming,
  eventLocalDateRange,
  normalizeDateKey,
} = require("./official-program-article-time");
const {
  MIN_TIMED_ROWS_FOR_SIGNATURE,
  collectOfficialProgramRows,
} = require("./official-program-article-rows");

const MAX_PROGRAMME_DAYS = 45;

function extractOfficialProgramArticle(html, options = {}) {
  const sourceUrl = normalizeHttpUrl(options.sourceUrl);
  const timezone = normalizeIanaTimezone(options.timezone);
  const sourceLanguage = normalizeLanguage(options.sourceLanguage);
  if (!sourceUrl || !timezone || !sourceLanguage) return emptyParsedProgram();

  const grouped = collectOfficialProgramRows(html);
  if (!grouped.page_year || !grouped.program_section_count) return emptyParsedProgram();

  const events = [];
  let timedEventCount = 0;
  let allDayEventCount = 0;
  for (const row of grouped.rows) {
    const timing = buildEventTiming({
      dateRange: row.date_range,
      time: row.time,
      timezone,
    });
    if (!timing) continue;
    if (timing.time_window?.kind === "all_day") allDayEventCount += 1;
    else timedEventCount += 1;

    const sourceRecordId = stableHash([
      sourceUrl,
      timing.starts_at || timing.starts_on,
      timing.time_window?.local_start || "",
      row.title,
    ].join("|"));
    events.push(compact({
      id: sourceRecordId,
      title: row.title,
      name: row.title,
      ...timing,
      source_url: sourceUrl,
      place_context: row.venue,
      area: row.venue,
      source_language: sourceLanguage,
      event_language: sourceLanguage,
      translation_status: "not_required",
      tags: factualTags([row.title, grouped.page_title, row.program_marker].filter(Boolean).join(" ")),
      provenance: {
        source_url: sourceUrl,
        source_page: sourceUrl,
        source_record_id: sourceRecordId,
      },
    }));
  }

  const dedupedEvents = dedupeEvents(events);
  const significance = {
    source_prominence: "dedicated_programme",
    programme_event_count: dedupedEvents.length,
    programme_day_count: programmeDayCount(dedupedEvents),
    current_year_evidence: referenceYear(options.referenceDate) === grouped.page_year,
  };
  return {
    recognized: timedEventCount >= MIN_TIMED_ROWS_FOR_SIGNATURE,
    program_section_count: grouped.program_section_count,
    candidate_row_count: grouped.candidate_row_count,
    timed_event_count: timedEventCount,
    all_day_event_count: allDayEventCount,
    events: dedupedEvents.map((event) => ({ ...event, local_significance: significance })),
  };
}

function referenceYear(value) {
  const date = normalizeDateKey(value);
  const year = Number(date?.slice(0, 4));
  return Number.isInteger(year) ? year : null;
}

function boundProgramEvents(events, { collectionDate, horizonDays, timezone, timedLimit, allDayLimit } = {}) {
  const lastDate = collectionDate ? addDateDays(collectionDate, horizonDays) : null;
  const filtered = (Array.isArray(events) ? events : []).filter((event) => {
    if (!collectionDate || !lastDate) return true;
    const range = eventLocalDateRange(event, timezone);
    return Boolean(range && range.end >= collectionDate && range.start <= lastDate);
  });
  const timed = filtered.filter((event) => event.time_window?.kind !== "all_day").slice(0, timedLimit);
  const allDay = filtered.filter((event) => event.time_window?.kind === "all_day").slice(0, allDayLimit);
  return [...timed, ...allDay].sort(compareEvents);
}

function programmeDayCount(events) {
  const dates = new Set();
  for (const event of Array.isArray(events) ? events : []) {
    const start = normalizeDateKey(event?.starts_on || event?.starts_at);
    const end = normalizeDateKey(event?.ends_on || event?.ends_at) || start;
    if (!start || !end || end < start) continue;
    let cursor = start;
    for (let index = 0; index < MAX_PROGRAMME_DAYS && cursor && cursor <= end; index += 1) {
      dates.add(cursor);
      cursor = addDateDays(cursor, 1);
    }
  }
  return Math.min(dates.size, MAX_PROGRAMME_DAYS);
}

function compareEvents(left, right) {
  return String(left.starts_at || left.starts_on || "").localeCompare(String(right.starts_at || right.starts_on || "")) ||
    String(left.id).localeCompare(String(right.id));
}

function factualTags(value) {
  const text = fold(value);
  const tags = [];
  const add = (tag, pattern) => { if (pattern.test(text)) tags.push(tag); };
  add("festival", /\b(festival|festa|fiesta|fete|fest|festes|verbenas?|verbenes)\b/);
  add("music", /\b(concert|concerts|music|musica|musik|orchestra|orkester|dj|band)\b/);
  add("market", /\b(market|mercat|mercado|marknad|loppis|brocante|flea)\b/);
  add("culture", /\b(culture|cultura|kultur|theatre|teatre|teatro|museum|museu|exhibition|utstallning)\b/);
  add("nightlife", /\b(night|natt|soir|soirée|vespre|verbena|party|dance|dans|ball)\b/);
  return [...new Set(tags)];
}

function dedupeEvents(events) {
  const seen = new Set();
  return events.filter((event) => {
    const key = `${fold(event.title)}|${event.starts_at || event.starts_on}|${fold(event.place_context)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function emptyParsedProgram() {
  return {
    recognized: false,
    program_section_count: 0,
    candidate_row_count: 0,
    timed_event_count: 0,
    all_day_event_count: 0,
    events: [],
  };
}

function normalizeLanguage(value) {
  const language = String(value || "").trim().toLowerCase().split(/[-_]/)[0];
  return /^[a-z]{2,3}$/.test(language) ? language : null;
}

function normalizeHttpUrl(value) {
  try {
    const url = new URL(String(value || ""));
    if (!["http:", "https:"].includes(url.protocol)) return null;
    url.hash = "";
    return url.toString();
  } catch (_error) {
    return null;
  }
}

function stableHash(value) {
  return createHash("sha256").update(String(value || "")).digest("hex").slice(0, 20);
}

function compact(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== null && item !== undefined && item !== ""));
}

module.exports = {
  boundProgramEvents,
  extractOfficialProgramArticle,
};
