"use strict";

const {
  datePartsInTimezone,
  normalizeSourceEventDateTime,
} = require("./source-event-time");

const MONTHS = Object.freeze({
  january: 1, jan: 1, januari: 1, janvier: 1, enero: 1, gener: 1, janeiro: 1, gennaio: 1, januar: 1,
  february: 2, feb: 2, februari: 2, fevrier: 2, février: 2, febrero: 2, febrer: 2, fevereiro: 2, febbraio: 2, februar: 2,
  march: 3, mar: 3, mars: 3, marzo: 3, marc: 3, marco: 3, março: 3, marz: 3, märz: 3, maart: 3,
  april: 4, apr: 4, avril: 4, abril: 4, aprile: 4,
  may: 5, maj: 5, mai: 5, mayo: 5, maig: 5, maggio: 5, maio: 5, mei: 5,
  june: 6, jun: 6, juni: 6, juin: 6, junio: 6, juny: 6, giugno: 6, junho: 6,
  july: 7, jul: 7, juli: 7, juillet: 7, julio: 7, juliol: 7, luglio: 7, julho: 7,
  august: 8, aug: 8, augusti: 8, aout: 8, août: 8, agosto: 8, agost: 8,
  september: 9, sep: 9, sept: 9, setembre: 9, septiembre: 9, setembro: 9, settembre: 9,
  october: 10, oct: 10, oktober: 10, octobre: 10, octubre: 10, outubro: 10, ottobre: 10,
  november: 11, nov: 11, novembre: 11, noviembre: 11, novembro: 11,
  december: 12, dec: 12, december: 12, decembre: 12, décembre: 12, diciembre: 12, desembre: 12, dezembro: 12, dicembre: 12, dezember: 12,
});

function parseDateRange(value, fallbackYear) {
  const text = fold(value).replace(/[–—]/g, "-");
  // Historical years elsewhere in prose cannot override the page year. Only
  // a year syntactically attached to this date expression is considered.
  const year = fallbackYear;
  if (!Number.isInteger(year)) return null;
  const monthNames = Object.keys(MONTHS).sort((a, b) => b.length - a.length).join("|");
  let match = text.match(new RegExp(`\\b(\\d{1,2})(?:\\s*(?:-|to|till|au|al)\\s*)(\\d{1,2})\\s+(?:d['’]?)?(${monthNames})\\b`, "i"));
  if (match) {
    const month = MONTHS[fold(match[3])];
    return validRange(year, month, Number(match[1]), year, month, Number(match[2]));
  }
  match = text.match(new RegExp(`\\b(\\d{1,2})\\s+(?:d['’]?)?(${monthNames})\\s*(?:-|to|till|au|al)\\s*(\\d{1,2})\\s+(?:d['’]?)?(${monthNames})\\b`, "i"));
  if (match) {
    const startMonth = MONTHS[fold(match[2])];
    const endMonth = MONTHS[fold(match[4])];
    return validRange(year, startMonth, Number(match[1]), endMonth < startMonth ? year + 1 : year, endMonth, Number(match[3]));
  }
  match = text.match(new RegExp(`\\b(\\d{1,2})\\s+(?:d['’]?)?(${monthNames})(?:\\s+(\\d{4}))?\\b`, "i"));
  if (!match) return null;
  const explicitYear = Number(match[3]) || year;
  const month = MONTHS[fold(match[2])];
  return validRange(explicitYear, month, Number(match[1]), explicitYear, month, Number(match[1]));
}

function parseTimeRange(value) {
  const text = String(value || "").replace(/[–—]/g, "-");
  const pattern = /(?:^|[^\d])([01]?\d|2[0-3])(?:[:.]([0-5]\d))(?:\s*h)?/g;
  const matches = [];
  let match;
  while ((match = pattern.exec(text))) {
    matches.push({
      hour: Number(match[1]),
      minute: Number(match[2]),
      startIndex: match.index + match[0].search(/\d/),
      endIndex: pattern.lastIndex,
    });
    if (matches.length === 2) break;
  }
  if (!matches.length) return null;
  const between = matches[1]
    ? fold(text.slice(matches[0].endIndex, matches[1].startIndex)).replace(/[()]/g, "").trim()
    : "";
  const isExplicitRange = /^(?:-|to|till|a|al|au|until)$/.test(between);
  return { start: matches[0], end: isExplicitRange ? matches[1] : null };
}

function buildEventTiming({ dateRange, time, timezone }) {
  const startsOn = dateKey(dateRange.start);
  const endsOn = dateKey(dateRange.end || dateRange.start);
  if (!startsOn || !endsOn) return null;
  if (!time) {
    return {
      starts_on: startsOn,
      ends_on: endsOn,
      time_window: { kind: "all_day", starts_on: startsOn, ends_on: endsOn },
    };
  }
  const localStart = localClock(time.start);
  const localEnd = time.end ? localClock(time.end) : null;
  if (startsOn !== endsOn) {
    return compact({
      starts_on: startsOn,
      ends_on: endsOn,
      time_window: compact({
        kind: "daily",
        starts_on: startsOn,
        ends_on: endsOn,
        local_start: localStart,
        local_end: localEnd,
        timezone,
      }),
    });
  }

  const startsAt = normalizeSourceEventDateTime(`${startsOn}T${localStart}:00`, { timezone });
  if (!startsAt) return null;
  let endsAt = null;
  if (localEnd) {
    const endDate = minutesOfDay(time.end) < minutesOfDay(time.start)
      ? addDateDays(startsOn, 1)
      : startsOn;
    endsAt = normalizeSourceEventDateTime(`${endDate}T${localEnd}:00`, { timezone });
    if (!endsAt || Date.parse(endsAt) <= Date.parse(startsAt)) return null;
  }
  return compact({
    starts_at: startsAt,
    ends_at: endsAt,
    starts_on: startsOn,
    ends_on: startsOn,
    time_window: compact({ kind: "continuous", starts_at: startsAt, ends_at: endsAt }),
  });
}

function stripDateAndTime(value) {
  let text = String(value || "");
  const weekdays = "monday|tuesday|wednesday|thursday|friday|saturday|sunday|mandag|måndag|tisdag|onsdag|torsdag|fredag|lordag|lördag|sondag|söndag|lunes|martes|miercoles|miércoles|jueves|viernes|sabado|sábado|domingo|dilluns|dimarts|dimecres|dijous|divendres|dissabte|diumenge|lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche";
  text = text.replace(new RegExp(`^\\s*(?:${weekdays})\\b[,.]?\\s*`, "i"), "");
  const monthNames = Object.keys(MONTHS).sort((a, b) => b.length - a.length).join("|");
  text = text.replace(new RegExp(`^\\s*\\d{1,2}(?:\\s*(?:-|to|till|au|al)\\s*\\d{1,2})?\\s+(?:d['’]?)?(?:${monthNames})(?:\\s+\\d{4})?\\s*`, "i"), "");
  text = text.replace(/\(?\b(?:[01]?\d|2[0-3])[:.]\d{2}(?:\s*h)?(?:\s*[-–—]\s*(?:[01]?\d|2[0-3])[:.]\d{2}(?:\s*h)?)?\b\)?/g, " ");
  return text.replace(/\s+/g, " ").trim();
}

function eventLocalDateRange(event, timezone) {
  const startsOn = normalizeDateKey(event?.starts_on) || localDateKey(event?.starts_at, timezone);
  const endsOn = normalizeDateKey(event?.ends_on) || localDateKey(event?.ends_at || event?.starts_at, timezone);
  return startsOn ? { start: startsOn, end: endsOn || startsOn } : null;
}

function localDateKey(value, timezone) {
  const parts = datePartsInTimezone(value, timezone);
  return parts ? dateKey(parts) : null;
}

function normalizeDateKey(value) {
  const key = String(value || "").slice(0, 10);
  const date = new Date(`${key}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === key ? key : null;
}

function addDateDays(value, days) {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + Number(days || 0));
  return date.toISOString().slice(0, 10);
}

function validRange(startYear, startMonth, startDay, endYear, endMonth, endDay) {
  const start = validDateParts(startYear, startMonth, startDay);
  const end = validDateParts(endYear, endMonth, endDay);
  if (!start || !end || dateKey(end) < dateKey(start)) return null;
  return { start, end };
}

function validDateParts(year, month, day) {
  if (![year, month, day].every(Number.isInteger)) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day) return null;
  return { year, month, day };
}

function dateKey(parts) {
  return parts
    ? `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`
    : null;
}

function localClock(parts) {
  return `${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}`;
}

function minutesOfDay(parts) {
  return parts.hour * 60 + parts.minute;
}

function fold(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’']/g, "'")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function compact(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== null && item !== undefined && item !== ""));
}

module.exports = {
  addDateDays,
  buildEventTiming,
  eventLocalDateRange,
  normalizeDateKey,
  parseDateRange,
  parseTimeRange,
  stripDateAndTime,
};
