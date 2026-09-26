"use strict";

/**
 * Source-stated recurrence for calendar adapters.
 *
 * A date range with one session clock does not say which days carry a session.
 * Adapters use this closed Swedish/English grammar to read what the source
 * itself states: an every-day schedule, a weekday rule inside the stated range,
 * or an explicit list of dates. Anything else is unresolved and keeps period
 * semantics; nothing here guesses, widens or truncates a schedule.
 */

const { MAX_OCCURRENCE_DATES } = require("./time-sensitive-event");

// A weekday rule is expanded only inside an explicit source range of at most
// this many days; open-ended or longer rules keep honest period semantics.
const MAX_RECURRENCE_RANGE_DAYS = 120;
// Year inference for dates listed without a year never reaches further than
// half a year from the source's own reference date.
const MAX_INFERRED_YEAR_DISTANCE_DAYS = 183;
const DAY_MS = 24 * 60 * 60 * 1000;

const MONTHS = Object.freeze({
  januari: 1,
  january: 1,
  februari: 2,
  february: 2,
  mars: 3,
  march: 3,
  april: 4,
  maj: 5,
  may: 5,
  juni: 6,
  june: 6,
  juli: 7,
  july: 7,
  augusti: 8,
  august: 8,
  september: 9,
  oktober: 10,
  october: 10,
  november: 11,
  december: 12,
});

// Closed weekday vocabulary (JavaScript day numbers, Sunday = 0). Swedish
// singular/plural/definite forms and short forms occur in municipal date lists;
// English full names keep fixtures readable. A plural form states a rule
// ("torsdagar"); in a date label a singular form before a date only names that
// date's weekday. Anything else is unknown.
const WEEKDAYS = Object.freeze(Object.fromEntries([
  [0, ["söndag", "söndagen", "sön", "sunday"], ["söndagar", "sundays"]],
  [1, ["måndag", "måndagen", "mån", "monday"], ["måndagar", "mondays"]],
  [2, ["tisdag", "tisdagen", "tis", "tuesday"], ["tisdagar", "tuesdays"]],
  [3, ["onsdag", "onsdagen", "ons", "wednesday"], ["onsdagar", "wednesdays"]],
  [4, ["torsdag", "torsdagen", "tors", "tor", "thursday"], ["torsdagar", "thursdays"]],
  [5, ["fredag", "fredagen", "fre", "friday"], ["fredagar", "fridays"]],
  [6, ["lördag", "lördagen", "lör", "saturday"], ["lördagar", "saturdays"]],
].flatMap(([day, singular, plural]) => [
  ...singular.map((word) => [word, Object.freeze({ day, plural: false })]),
  ...plural.map((word) => [word, Object.freeze({ day, plural: true })]),
])));
const DAILY_WORDS = new Set(["dagligen", "daily", "everyday"]);
// "Varannan" (every other week) is not one of these: it does not say which
// weeks, and the range start is no evidence of the phase. It stays unknown.
const EVERY_WORDS = new Set(["varje", "every", "alla", "each"]);
const JOIN_WORDS = new Set(["och", "samt", "and"]);
// Words that never change which days are meant ("kl 18.00", "på torsdagar").
const FILLER_WORDS = new Set(["kl", "klockan", "at", "på", "on", "den"]);

// Decide which days a stated range actually carries a session. `daily` needs a
// source statement; listed dates and weekday rules become explicit bounded
// occurrences; anything unreadable, contradictory, open-ended or truncated is
// `unresolved` and keeps period semantics. `none` means no recurrence evidence.
function resolveSchedulePattern(recurrenceText, { range, explicitRange, time, statesDaily, present, complete }) {
  const multiDay = isMultiDay(range);
  const text = firstString(recurrenceText);
  // A recurrence section that exists but cannot be read still says the entry
  // recurs; it must not fall back to every-day date facts.
  if (!text && present) return { mode: "unresolved", time };
  if (!text) return { mode: statesDaily && multiDay ? "daily" : "none", time };
  // A recurrence section may open with the template lead-in; a date label may not.
  const statement = complete ? parseScheduleStatement(text, { leadIn: true }) : null;
  const everyDay = Boolean(statement?.daily || statement?.weekdays?.size === 7);
  // A stated "daily" line contradicted by a narrower recurrence is not daily.
  if (!statement || (statesDaily && !everyDay)) return { mode: "unresolved", time };
  const clock = mergeClocks(time, statement.clocks);
  if (clock === undefined) return { mode: "unresolved", time };

  if (everyDay) return { mode: multiDay ? "daily" : "none", time: clock };
  if (statement.weekdays) {
    // Without a stated end a weekday rule cannot be expanded. The explicitly
    // stated single date remains; later sessions are not claimed.
    if (!multiDay) return { mode: "none", time };
    return listedPattern(expandWeekdays(range, statement.weekdays), range, clock, time);
  }
  return listedPattern(resolveListedDates(statement.dates, { range, multiDay, explicitRange }), range, clock, time);
}

// The same decision for a date label and a session-time label ("När" /
// "Öppettider") around a range the adapter has already parsed. Without weekday
// or daily words there is no recurrence evidence (`none`): the caller keeps a
// clocked multi-day range as a period.
function resolveLabelledSchedule({ dateText, timeText, range, time }) {
  const statement = readLabelledStatement(dateText, timeText);
  const clock = mergeClocks(time, statement.clocks);
  // Different clocks for different days or sessions: none is the source's one
  // clock, so the range keeps period semantics without a clock.
  if (clock === undefined) return { mode: "unresolved", time: null };
  const partialWeek = statement.weekdays.size > 0 && statement.weekdays.size < 7;
  if (!statement.daily && !statement.weekdays.size) return { mode: "none", time };
  if (statement.unknown || (statement.daily && partialWeek)) return { mode: "unresolved", time };
  const multiDay = isMultiDay(range);
  if (!partialWeek) return { mode: multiDay ? "daily" : "none", time: clock };
  if (!multiDay) return { mode: "none", time };
  return listedPattern(expandWeekdays(range, statement.weekdays), range, clock, time);
}

// A label that states two or more explicit dates (never a range) names exactly
// those days. Years missing from the label resolve nearest to the reference.
function listedDatesFromText(value, reference) {
  const statement = parseScheduleStatement(value);
  const referenceParts = datePartsFromKey(reference);
  if (!statement?.dates || statement.dates.length < 2 || !referenceParts) return null;
  const dates = resolveListedDates(statement.dates, {
    range: { start: referenceParts, end: referenceParts },
    multiDay: false,
    explicitRange: false,
  });
  return dates && dates.length >= 2 ? { dates, clocks: statement.clocks } : null;
}

function listedPattern(dates, range, clock, time) {
  if (!dates) return { mode: "unresolved", time };
  // Every date of an explicit multi-day range listed is itself a daily statement.
  if (isMultiDay(range) && dates.length === rangeLength(range)) return { mode: "daily", time: clock };
  return { mode: "listed", dates, time: clock };
}

function statesDailyOccurrence(label) {
  const tokens = tokenizeSchedule(label);
  if (!tokens) return false;
  let daily = false;
  for (const token of tokens) {
    if (token.type === "daily") daily = true;
    else if (!["date", "day", "clock", "dash", "join", "filler"].includes(token.type)) return false;
  }
  return daily;
}

// Closed grammar over the recurrence text: either one daily statement, one set
// of weekdays (with ranges such as "mån–fre"), or one list of dates (optionally
// prefixed by their weekday, or sharing a month: "2, 9 och 16 juli"). Clocks may
// accompany any of them. Every other word fails the whole statement. With
// `leadIn`, the first token may be the template lead-in. It states no days, so
// the rest must still be one complete statement.
function parseScheduleStatement(value, { leadIn = false } = {}) {
  const tokens = tokenizeSchedule(value);
  if (!tokens || tokens.length === 0) return null;
  const clocks = [];
  const dates = [];
  const weekdays = new Set();
  let pendingDays = [];
  let daily = false;
  let every = false;
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    const next = tokens[index + 1];
    if (token.type === "clock") clocks.push(token);
    else if (token.type === "daily") daily = true;
    else if (token.type === "every") every = true;
    else if (token.type === "join" || token.type === "filler") continue;
    else if (token.type === "lead_in" && leadIn && index === 0) continue;
    else if (token.type === "day") pendingDays.push(token);
    else if (token.type === "date") {
      for (const day of pendingDays) {
        dates.push({ day: day.day, month: token.month, year: token.year, weekday: day.weekday });
      }
      pendingDays = [];
      dates.push(token);
    } else if (token.type === "weekday") {
      if (next?.type === "date" || next?.type === "day") {
        next.weekday = token.weekday; // a stated weekday must match its date
      } else if ((next?.type === "dash" || next?.type === "range") && tokens[index + 2]?.type === "weekday") {
        addWeekdayRange(weekdays, token.weekday, tokens[index + 2].weekday);
        index += 2;
      } else {
        weekdays.add(token.weekday);
      }
    } else {
      return null; // unknown words, stray dashes and range words outside weekday ranges
    }
  }
  if (pendingDays.length) return null;
  if ([daily, weekdays.size > 0, dates.length > 0].filter(Boolean).length !== 1) return null;
  if (every && weekdays.size === 0) return null;
  return {
    daily,
    weekdays: weekdays.size ? weekdays : null,
    dates: dates.length ? dates : null,
    clocks,
  };
}

// Date and range words in a date label belong to the range the adapter parsed;
// a singular weekday directly before a date only names that date's weekday.
// Any unknown word, and dates in the session-time label, mark the statement
// unknown so evidence around them cannot be read as a complete rule.
function readLabelledStatement(dateText, timeText) {
  const statement = { daily: false, weekdays: new Set(), clocks: [], unknown: false };
  for (const [text, isDateLabel] of [[dateText, true], [timeText, false]]) {
    if (!firstString(text)) continue;
    const tokens = tokenizeSchedule(text);
    if (!tokens) {
      statement.unknown = true;
      continue;
    }
    let every = false;
    for (let index = 0; index < tokens.length; index += 1) {
      const token = tokens[index];
      const next = tokens[index + 1];
      if (every && token.type !== "weekday") statement.unknown = true;
      every = token.type === "every";
      if (token.type === "clock") statement.clocks.push(token);
      else if (token.type === "daily") statement.daily = true;
      else if (["every", "join", "filler"].includes(token.type)) continue;
      else if (["date", "day", "dash", "range"].includes(token.type)) {
        if (!isDateLabel) statement.unknown = true;
      } else if (token.type === "weekday") {
        if ((next?.type === "dash" || next?.type === "range") && tokens[index + 2]?.type === "weekday") {
          addWeekdayRange(statement.weekdays, token.weekday, tokens[index + 2].weekday);
          index += 2;
        } else if (isDateLabel && !token.plural && tokens[index - 1]?.type !== "every" &&
          (next?.type === "date" || next?.type === "day")) {
          continue;
        } else {
          statement.weekdays.add(token.weekday);
        }
      } else {
        statement.unknown = true;
      }
    }
    if (every) statement.unknown = true;
  }
  return statement;
}

function tokenizeSchedule(value) {
  const text = String(value || "")
    .toLocaleLowerCase("sv-SE")
    .replace(/[\u2012-\u2015\u2212]/g, "-")
    .replace(/\u00a0/g, " ")
    .trim();
  if (!text || text.length > 2000) return null;
  const tokens = [];
  let index = 0;
  while (index < text.length) {
    const match = matchScheduleToken(text, index);
    if (!match) return null;
    index += match.length;
    if (match.token) tokens.push(match.token);
    if (tokens.length > 400) return null;
  }
  return tokens;
}

function matchScheduleToken(text, index) {
  const at = (pattern) => {
    pattern.lastIndex = index;
    return pattern.exec(text);
  };
  let match = at(/\s+/y);
  if (match) return { length: match[0].length, token: null };
  match = at(/[,;:·|.]/y);
  if (match) return { length: 1, token: { type: "join" } };
  match = at(/(\d{4})-(\d{2})-(\d{2})(?!\d)/y);
  if (match) {
    return {
      length: match[0].length,
      token: { type: "date", year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) },
    };
  }
  match = at(/(?:(?:kl\.?|klockan)\s*)?(\d{1,2})[.:](\d{2})(?:\s*-\s*(\d{1,2})[.:](\d{2}))?(?!\d)/y);
  if (match) {
    const start = validTimeParts(Number(match[1]), Number(match[2]));
    const end = match[3] ? validTimeParts(Number(match[3]), Number(match[4])) : null;
    if (!start || (match[3] && !end)) return { length: match[0].length, token: { type: "unknown" } };
    return { length: match[0].length, token: { type: "clock", start, end } };
  }
  match = at(/(\d{1,2})\s+([a-zåäö]+)\.?(?:\s+(\d{4}))?(?![\da-zåäö])/y);
  if (match && Object.hasOwn(MONTHS, match[2])) {
    return {
      length: match[0].length,
      token: {
        type: "date",
        day: Number(match[1]),
        month: MONTHS[match[2]],
        year: match[3] ? Number(match[3]) : null,
      },
    };
  }
  match = at(/(\d{1,2})(?![\d.:])/y);
  if (match) return { length: match[0].length, token: { type: "day", day: Number(match[1]) } };
  match = at(/-/y);
  if (match) return { length: 1, token: { type: "dash" } };
  match = at(/(?:varje\s+dag|alla\s+dagar|every\s+day)(?![a-zåäö])/y);
  if (match) return { length: match[0].length, token: { type: "daily" } };
  // The lead-in Sitevision's "Återkommande tillfällen" template prints before
  // the rule ("Detta evenemang äger rum varje måndag och torsdag"). It is read
  // only as this whole phrase: none of its words is filler on its own.
  match = at(/detta\s+evenemang\s+äger\s+rum(?![a-zåäöé])/y);
  if (match) return { length: match[0].length, token: { type: "lead_in" } };
  // Month-first dates ("July 16", "July 16, 2026"); never a clock such as "16.00".
  match = at(/([a-z]+)\s+(\d{1,2})(?:,?\s+(\d{4}))?(?![\d.:a-zåäö])/y);
  if (match && Object.hasOwn(MONTHS, match[1])) {
    return {
      length: match[0].length,
      token: {
        type: "date",
        day: Number(match[2]),
        month: MONTHS[match[1]],
        year: match[3] ? Number(match[3]) : null,
      },
    };
  }
  match = at(/[a-zåäöé]+\.?/y);
  if (match) return { length: match[0].length, token: classifyScheduleWord(match[0].replace(/\.$/, "")) };
  return null;
}

function classifyScheduleWord(word) {
  if (Object.hasOwn(WEEKDAYS, word)) {
    return { type: "weekday", weekday: WEEKDAYS[word].day, plural: WEEKDAYS[word].plural };
  }
  if (DAILY_WORDS.has(word)) return { type: "daily" };
  if (EVERY_WORDS.has(word)) return { type: "every" };
  if (JOIN_WORDS.has(word)) return { type: "join" };
  if (FILLER_WORDS.has(word)) return { type: "filler" };
  if (word === "till" || word === "to") return { type: "range" };
  return { type: "unknown" };
}

function addWeekdayRange(weekdays, from, to) {
  for (let day = from, steps = 0; steps < 7; day = (day + 1) % 7, steps += 1) {
    weekdays.add(day);
    if (day === to) return;
  }
}

// One shared session clock: the stated time line and every listed clock must
// agree (a start-only clock agrees with a full range that has the same start).
function mergeClocks(time, clocks) {
  let merged = time || null;
  for (const clock of clocks) {
    if (!merged) {
      merged = clock;
      continue;
    }
    if (minutesOfDay(merged.start) !== minutesOfDay(clock.start)) return undefined;
    if (merged.end && clock.end && minutesOfDay(merged.end) !== minutesOfDay(clock.end)) return undefined;
    if (!merged.end && clock.end) merged = clock;
  }
  return merged;
}

function expandWeekdays(range, weekdays) {
  const start = utcDay(range.start);
  const end = utcDay(range.end || range.start);
  if (end < start || (end - start) / DAY_MS > MAX_RECURRENCE_RANGE_DAYS) return null;
  const dates = [];
  for (let day = start; day <= end; day += DAY_MS) {
    if (!weekdays.has(new Date(day).getUTCDay())) continue;
    dates.push(new Date(day).toISOString().slice(0, 10));
    if (dates.length > MAX_OCCURRENCE_DATES) return null;
  }
  return dates.length ? dates : null;
}

// Listed dates must all be real, match any stated weekday, and fall inside an
// explicit multi-day range. A single explicitly stated date is itself one of the
// occurrences; a listing fallback date is not evidence of a session.
function resolveListedDates(items, { range, multiDay, explicitRange }) {
  const first = dateKey(range.start);
  const last = dateKey(range.end || range.start);
  const dates = new Set(!multiDay && explicitRange ? [first] : []);
  for (const item of items) {
    const parts = item.year
      ? validDateParts(item.year, item.month, item.day)
      : nearestYearDate(item, range.start);
    if (!parts) return null;
    if (item.weekday != null && new Date(utcDay(parts)).getUTCDay() !== item.weekday) return null;
    const key = dateKey(parts);
    if (multiDay && (key < first || key > last)) return null;
    dates.add(key);
  }
  if (dates.size === 0 || dates.size > MAX_OCCURRENCE_DATES) return null;
  return [...dates].sort();
}

function nearestYearDate(item, reference) {
  let best = null;
  for (const year of [reference.year - 1, reference.year, reference.year + 1]) {
    const parts = validDateParts(year, item.month, item.day);
    if (!parts) continue;
    const distance = Math.abs(utcDay(parts) - utcDay(reference)) / DAY_MS;
    if (!best || distance < best.distance) best = { parts, distance };
  }
  return best && best.distance <= MAX_INFERRED_YEAR_DISTANCE_DAYS ? best.parts : null;
}

function isMultiDay(range) {
  return dateKey(range.start) !== dateKey(range.end || range.start);
}

function rangeLength(range) {
  return Math.round((utcDay(range.end || range.start) - utcDay(range.start)) / DAY_MS) + 1;
}

function utcDay(parts) {
  return Date.UTC(parts.year, parts.month - 1, parts.day);
}

function dateKey(parts) {
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function datePartsFromKey(value) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? validDateParts(Number(match[1]), Number(match[2]), Number(match[3])) : null;
}

function validDateParts(year, month, day) {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() + 1 !== month ||
    date.getUTCDate() !== day
  ) return null;
  return { year, month, day };
}

function validTimeParts(hour, minute) {
  return Number.isInteger(hour) && hour >= 0 && hour <= 23 &&
    Number.isInteger(minute) && minute >= 0 && minute <= 59
    ? { hour, minute }
    : null;
}

function minutesOfDay(time) {
  return time.hour * 60 + time.minute;
}

function firstString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

module.exports = {
  MAX_RECURRENCE_RANGE_DAYS,
  MONTHS,
  listedDatesFromText,
  mergeClocks,
  parseScheduleStatement,
  readLabelledStatement,
  resolveLabelledSchedule,
  resolveSchedulePattern,
  statesDailyOccurrence,
};
