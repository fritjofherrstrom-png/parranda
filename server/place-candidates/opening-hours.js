const DAY_INDEX = Object.freeze({ Su: 0, Mo: 1, Tu: 2, We: 3, Th: 4, Fr: 5, Sa: 6 });
const DAY_TOKEN = /^(Su|Mo|Tu|We|Th|Fr|Sa)$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const LOCAL_ISO = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::\d{2})?$/;
const MAX_OPENING_HOURS_LENGTH = 512;

function normalizeOpeningHours(value) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/\s+/g, " ");
  if (!normalized || normalized.length > MAX_OPENING_HOURS_LENGTH) return null;
  return normalized;
}

/**
 * Conservatively answer whether a source-backed place is available at any
 * point in a local wall-clock window. Unsupported OSM syntax stays unknown and
 * therefore never excludes a candidate.
 */
function evaluateOpeningHoursForWindow(value, { weekday, startMinute = 0, endMinute = 1440 } = {}) {
  const openingHours = normalizeOpeningHours(value);
  if (!openingHours) return unknown("opening_hours_unavailable");
  if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) {
    return unknown("opening_hours_local_day_unavailable");
  }
  if (
    !Number.isFinite(startMinute) ||
    !Number.isFinite(endMinute) ||
    startMinute < 0 ||
    endMinute > 1440 ||
    endMinute <= startMinute
  ) {
    return unknown("opening_hours_query_window_invalid");
  }

  if (openingHours === "24/7") {
    return available();
  }

  const schedule = parseWeeklySchedule(openingHours);
  if (!schedule) return unknown("opening_hours_unresolved");

  const intervals = intervalsForLocalDay(schedule, weekday);
  const overlaps = intervals.some(
    ([start, end]) => Math.max(start, startMinute) < Math.min(end, endMinute),
  );
  return overlaps ? available() : closed();
}

/**
 * Build the local window used by same-day Planner eligibility. Today starts at
 * the trusted local clock; a future day evaluates the whole local date.
 */
function buildLocalDayAvailabilityWindow({ requestedDate, nowLocalIso } = {}) {
  const date = typeof requestedDate === "string" ? requestedDate.trim() : "";
  if (!ISO_DATE.test(date) || !isValidIsoDate(date)) return null;

  const localNow = typeof nowLocalIso === "string" ? nowLocalIso.match(LOCAL_ISO) : null;
  if (!localNow) return null;
  let startMinute = 0;
  if (localNow && localNow[1] === date) {
    const hour = Number(localNow[2]);
    const minute = Number(localNow[3]);
    if (hour > 23 || minute > 59) return null;
    startMinute = hour * 60 + minute;
  } else if (localNow && date < localNow[1]) {
    return null;
  }

  if (startMinute >= 1440) return null;
  return {
    weekday: weekdayForIsoDate(date),
    startMinute,
    endMinute: 1440,
  };
}

function isValidIsoDate(value) {
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day, 12));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}

function parseWeeklySchedule(value) {
  const schedule = Array.from({ length: 7 }, () => ({ seen: false, intervals: [] }));
  const rules = value.split(";").map((rule) => rule.trim()).filter(Boolean);
  if (!rules.length) return null;

  for (const rule of rules) {
    const parsed = parseRule(rule);
    if (!parsed) return null;
    for (const day of parsed.days) {
      // Overlapping selectors need the full OSM precedence grammar. Fail open
      // rather than guessing whether a later rule replaces or extends an earlier.
      if (schedule[day].seen) return null;
      schedule[day] = { seen: true, intervals: parsed.intervals };
    }
  }
  return schedule;
}

function parseRule(rule) {
  if (/['"|]/.test(rule)) return null;
  const bodyMatch = rule.match(/\b(?:off|closed|\d{1,2}:\d{2})\b/i);
  if (!bodyMatch || bodyMatch.index === undefined) return null;

  const daySelector = rule.slice(0, bodyMatch.index).trim();
  const body = rule.slice(bodyMatch.index).trim();
  const days = daySelector ? parseDaySelector(daySelector) : Object.values(DAY_INDEX);
  if (!days) return null;
  if (/^(?:off|closed)$/i.test(body)) return { days, intervals: [] };

  const intervalTokens = body.split(",").map((entry) => entry.trim()).filter(Boolean);
  if (!intervalTokens.length) return null;
  const intervals = [];
  for (const token of intervalTokens) {
    const match = token.match(/^(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})$/);
    if (!match) return null;
    const start = parseClock(match[1], { allowEndOfDay: false });
    const rawEnd = parseClock(match[2], { allowEndOfDay: true });
    if (start === null || rawEnd === null || rawEnd === start) return null;
    intervals.push([start, rawEnd < start ? rawEnd + 1440 : rawEnd]);
  }
  return { days, intervals };
}

function parseDaySelector(value) {
  const compact = value.replace(/\s+/g, "");
  if (!compact) return null;
  const out = new Set();
  for (const part of compact.split(",")) {
    const range = part.split("-");
    if (range.length === 1 && DAY_TOKEN.test(range[0])) {
      out.add(DAY_INDEX[range[0]]);
      continue;
    }
    if (range.length !== 2 || !DAY_TOKEN.test(range[0]) || !DAY_TOKEN.test(range[1])) return null;
    let day = DAY_INDEX[range[0]];
    const end = DAY_INDEX[range[1]];
    for (let steps = 0; steps < 7; steps += 1) {
      out.add(day);
      if (day === end) break;
      day = (day + 1) % 7;
    }
  }
  return out.size ? [...out] : null;
}

function parseClock(value, { allowEndOfDay }) {
  const match = String(value).match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (minute > 59 || hour > 24 || (hour === 24 && (!allowEndOfDay || minute !== 0))) return null;
  return hour * 60 + minute;
}

function intervalsForLocalDay(schedule, weekday) {
  const intervals = [];
  for (const interval of schedule[weekday].intervals) {
    intervals.push([interval[0], Math.min(interval[1], 1440)]);
  }
  const previous = (weekday + 6) % 7;
  for (const interval of schedule[previous].intervals) {
    if (interval[1] > 1440) intervals.push([0, interval[1] - 1440]);
  }
  return intervals.filter(([start, end]) => end > start);
}

function weekdayForIsoDate(value) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day, 12)).getUTCDay();
}

function available() {
  return {
    eligible: true,
    status: "available_in_window",
    reason: "opening_hours_overlap_query_window",
  };
}

function closed() {
  return {
    eligible: false,
    status: "closed_for_window",
    reason: "opening_hours_closed_for_query_window",
  };
}

function unknown(reason) {
  return { eligible: true, status: "unknown", reason };
}

module.exports = {
  buildLocalDayAvailabilityWindow,
  evaluateOpeningHoursForWindow,
  normalizeOpeningHours,
};
