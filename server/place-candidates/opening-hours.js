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

// When each route role is visited, as local wall-clock windows in minutes.
// Generic and role-shaped, not a clock schedule: a meal is lunch OR dinner, an
// evening bar is the evening, a museum is daytime. The day-arc labels a role
// with one daypart ("afternoon" for the main meal) but that label is an arc
// position; judging a bistro that opens 12-14:30 and 19-22:30 against 14-18
// would call an open restaurant closed. Roles without a window are not judged.
const ROLE_VISIT_WINDOWS = Object.freeze({
  coffee_fika_stop: [[8 * 60, 16 * 60]],
  scenic_anchor: [[9 * 60, 20 * 60]],
  culture_stop: [[10 * 60, 18 * 60]],
  market_stop: [[8 * 60, 15 * 60]],
  green_walk_stop: [[8 * 60, 20 * 60]],
  food_anchor: [[11 * 60 + 30, 14 * 60 + 30], [18 * 60, 22 * 60]],
  evening_bar_option: [[18 * 60, 24 * 60]],
  swimming_coast_option: [[9 * 60, 19 * 60]],
  vintage_second_hand_option: [[10 * 60, 18 * 60]],
});
// Long enough to arrive and actually use the place, not just catch it open.
const MIN_VISIT_MINUTES = 45;

/**
 * Can a source-backed place be reached open at the time its route role is
 * visited, and stay open for a real visit?
 *
 * Arrival falls inside the role's visit window on the selected local day and
 * never before now. Once every window has passed (a day started at 22:20 still
 * has a meal), arrival is "from now on" instead: a stop planned now is visited
 * now. The place must then stay open MIN_VISIT_MINUTES in a row, across local
 * midnight when its own hours run on. Unknown or unsupported hours stay
 * unknown and never exclude a candidate.
 */
function evaluateOpeningHoursForRole(value, role, { weekday, startMinute = 0, endMinute = 1440 } = {}) {
  const windows = Object.prototype.hasOwnProperty.call(ROLE_VISIT_WINDOWS, role) ? ROLE_VISIT_WINDOWS[role] : null;
  if (!windows) return unknown("role_visit_window_unavailable");
  const openingHours = normalizeOpeningHours(value);
  if (!openingHours) return unknown("opening_hours_unavailable");
  if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) return unknown("opening_hours_local_day_unavailable");
  if (!Number.isFinite(startMinute) || !Number.isFinite(endMinute) || startMinute < 0 || endMinute > 1440 || endMinute <= startMinute) {
    return unknown("opening_hours_query_window_invalid");
  }
  if (openingHours === "24/7") return roleAvailable();
  const schedule = parseWeeklySchedule(openingHours);
  if (!schedule) return unknown("opening_hours_unresolved");

  const roleArrivals = windows
    .map(([start, end]) => [Math.max(start, startMinute), Math.min(end, endMinute)])
    .filter(([start, end]) => end > start);
  const arrivals = roleArrivals.length ? roleArrivals : [[startMinute, endMinute]];
  const open = openIntervalsAroundLocalDay(schedule, weekday);
  const reachableOpen = arrivals.some(([firstArrival, lastArrival]) =>
    open.some(([opens, closes]) => {
      const arrival = Math.max(firstArrival, opens);
      return arrival < lastArrival && arrival + MIN_VISIT_MINUTES <= closes;
    }),
  );
  return reachableOpen
    ? roleAvailable()
    : { eligible: false, status: "closed_at_role_time", reason: "opening_hours_closed_at_role_visit_time" };
}

// Open intervals for the local day in minutes, continued into the next day
// (minutes past 1440) so a visit can run past midnight, merged so that
// "18:00-24:00" followed by "00:00-02:00" is one stretch.
function openIntervalsAroundLocalDay(schedule, weekday) {
  const nextDay = (weekday + 1) % 7;
  const intervals = [
    ...intervalsForLocalDay(schedule, weekday).filter(([, end]) => end < 1440),
    ...schedule[weekday].intervals.filter(([, end]) => end >= 1440),
    ...schedule[nextDay].intervals.map(([start, end]) => [start + 1440, end + 1440]),
  ].sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const [start, end] of intervals) {
    const last = merged[merged.length - 1];
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else merged.push([start, end]);
  }
  return merged;
}

function roleAvailable() {
  return { eligible: true, status: "available_at_role_time", reason: "opening_hours_cover_role_visit_time" };
}

/**
 * Convert a supported source-owned weekly schedule into a bounded local-day
 * fact suitable for a route-stop contract. This deliberately does not answer
 * "open now": it only reports the source's windows for the already-trusted
 * selected local day. Unsupported syntax stays null and raw schedules never
 * leave the candidate pipeline.
 */
function buildSelectedDayHoursFact(value, { weekday } = {}) {
  const openingHours = normalizeOpeningHours(value);
  if (!openingHours || !Number.isInteger(weekday) || weekday < 0 || weekday > 6) return null;

  if (openingHours === "24/7") {
    return {
      status: "known",
      all_day: true,
      windows: [],
    };
  }

  const schedule = parseWeeklySchedule(openingHours);
  if (!schedule) return null;
  const windows = intervalsForLocalDay(schedule, weekday)
    .sort(([left], [right]) => left - right)
    .map(([start, end]) => ({
      opens: formatLocalMinute(start),
      closes: formatLocalMinute(end),
    }));
  return {
    status: windows.length ? "known" : "closed",
    all_day: false,
    windows,
  };
}

function normalizeSelectedDayHoursFact(value) {
  if (!value || typeof value !== "object" || !["known", "closed"].includes(value.status)) return null;
  if (value.status === "closed") {
    return { status: "closed", all_day: false, windows: [] };
  }
  if (value.all_day === true) {
    return { status: "known", all_day: true, windows: [] };
  }
  const windows = Array.isArray(value.windows)
    ? value.windows
        .map((window) => ({
          startMinute: parseClock(String(window?.opens || ""), { allowEndOfDay: false }),
          endMinute: parseClock(String(window?.closes || ""), { allowEndOfDay: true }),
        }))
        .filter(({ startMinute, endMinute }) =>
          startMinute !== null && endMinute !== null && startMinute < endMinute,
        )
        .sort((left, right) => left.startMinute - right.startMinute || left.endMinute - right.endMinute)
        .slice(0, 4)
        .map(({ startMinute, endMinute }) => ({
          opens: formatLocalMinute(startMinute),
          closes: formatLocalMinute(endMinute),
        }))
    : [];
  return windows.length ? { status: "known", all_day: false, windows } : null;
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
  const rules = splitWeeklyRules(value);
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

// OSM schedules commonly separate complete day rules with either semicolons
// or commas. A comma is also valid inside a day selector ("Sa,Su") and between
// two time windows, so split only when the text before it already has a rule
// body and the suffix starts another complete day selector + body.
function splitWeeklyRules(value) {
  const rules = [];
  for (const semicolonRule of value.split(";")) {
    let start = 0;
    for (let index = 0; index < semicolonRule.length; index += 1) {
      if (semicolonRule[index] !== ",") continue;
      const prefix = semicolonRule.slice(start, index).trim();
      const suffix = semicolonRule.slice(index + 1);
      if (hasRuleBody(prefix) && startsCompleteDayRule(suffix)) {
        rules.push(prefix);
        start = index + 1;
      }
    }
    const tail = semicolonRule.slice(start).trim();
    if (tail) rules.push(tail);
  }
  return rules;
}

function hasRuleBody(value) {
  return /\b(?:off|closed|\d{1,2}:\d{2})\b/i.test(value);
}

function startsCompleteDayRule(value) {
  return /^\s*(?:Su|Mo|Tu|We|Th|Fr|Sa)(?:-(?:Su|Mo|Tu|We|Th|Fr|Sa))?(?:\s*,\s*(?:Su|Mo|Tu|We|Th|Fr|Sa)(?:-(?:Su|Mo|Tu|We|Th|Fr|Sa))?)*\s+(?:off\b|closed\b|\d{1,2}:\d{2})/i.test(value);
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

function formatLocalMinute(value) {
  if (!Number.isFinite(value) || value < 0 || value > 1440) return null;
  if (value === 1440) return "24:00";
  const hour = Math.floor(value / 60);
  const minute = value % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
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
  ROLE_VISIT_WINDOWS,
  buildSelectedDayHoursFact,
  buildLocalDayAvailabilityWindow,
  evaluateOpeningHoursForRole,
  evaluateOpeningHoursForWindow,
  normalizeOpeningHours,
  normalizeSelectedDayHoursFact,
};
