'use strict';

const { createHash } = require('node:crypto');
const { normalizeSourceWebsite } = require('../lib/source-website');
const { buildSelectedDayHoursFact, evaluateOpeningHoursForWindow } = require('./opening-hours');

const CALENDAR_CONTRACT = 'selected-hours-calendar-v1';
const DAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const MAX_AGE_MS = 6 * 60 * 60 * 1000;
const own = (value, name) => Object.prototype.hasOwnProperty.call(value, name);
const object = value => value && typeof value === 'object' && !Array.isArray(value) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(value));
const fields = (value, required, optional = []) => object(value) && required.every(key => own(value, key)) &&
  Object.keys(value).every(key => required.includes(key) || optional.includes(key));
const boundedText = (value, max) => typeof value === 'string' && value.trim().length > 0 &&
  value.length <= max && !/[\u0000-\u001f\u007f]/.test(value);

function sourceUrl(value) {
  const normalized = normalizeSourceWebsite(value);
  if (!normalized || /[?#]/.test(value) || /^(?:https?:)?\/\/[^/?#]*:/i.test(value.trim())) return null;
  const url = new URL(normalized);
  if (url.port || url.search || url.hash) return null;
  url.protocol = 'https:';
  return url;
}
function canonicalUrl(value) {
  const url = sourceUrl(value);
  if (!url) return null;
  url.hostname = url.hostname.replace(/^www\./, '');
  return url;
}

// This identity survives the provider's name -> label normalization, while
// retaining the selected record's coordinates, type and exact owner path.
function selectedHoursCalendarKey(record) {
  if (!object(record)) return null;
  const url = canonicalUrl(record.website);
  const label = record.name || record.label;
  if (!url || !boundedText(label, 300) || !boundedText(record.type, 80)) return null;
  const coordinates = ['lat', 'lng'].map(key => record[key] == null ? null : record[key]);
  if (coordinates.some((value, index) => value !== null && (!Number.isFinite(value) || Math.abs(value) > (index ? 180 : 90)))) return null;
  const id = record.id == null ? null : String(record.id).trim();
  if (id !== null && !boundedText(id, 300)) return null;
  const identity = [id, label.trim().replace(/\s+/g, ' '), record.type.trim(), ...coordinates, url.toString()];
  return createHash('sha256').update(JSON.stringify(identity)).digest('hex');
}

function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(value + 'T12:00:00Z');
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
function validMonthDay(value) {
  return typeof value === 'string' && /^\d{2}-\d{2}$/.test(value) && validDate('2000-' + value);
}
function minute(value, end = false) {
  if (typeof value !== 'string' || !/^\d{2}:\d{2}$/.test(value)) return null;
  const [hours, minutes] = value.split(':').map(Number);
  if (minutes > 59 || hours > 24 || (hours === 24 && (!end || minutes))) return null;
  return hours * 60 + minutes;
}
function normalizeWindows(value) {
  if (!Array.isArray(value) || value.length > 4) return null;
  const windows = [];
  for (const window of value) {
    if (!fields(window, ['opens', 'closes'])) return null;
    const start = minute(window.opens), end = minute(window.closes, true);
    if (start === null || end === null || start >= end) return null;
    windows.push({ opens: window.opens, closes: window.closes });
  }
  windows.sort((left, right) => left.opens.localeCompare(right.opens));
  if (windows.some((window, index) => index && windows[index - 1].closes > window.opens)) return null;
  return windows;
}
function normalizeValidity(value) {
  if (!fields(value, ['kind', 'from', 'through'])) return null;
  if (value.kind === 'absolute') {
    if (!validDate(value.from) || !validDate(value.through) || value.from > value.through) return null;
  } else if (value.kind === 'annual') {
    if (!validMonthDay(value.from) || !validMonthDay(value.through)) return null;
  } else return null;
  return { kind: value.kind, from: value.from, through: value.through };
}
function normalizeRules(value) {
  if (!Array.isArray(value) || value.length > 12) return null;
  const rules = [];
  for (const rule of value) {
    if (!fields(rule, ['week'], ['validity']) || !object(rule.week)) return null;
    const keys = Object.keys(rule.week);
    if (!keys.length || keys.length > 7 || keys.some(key => !DAYS.includes(key))) return null;
    const week = {};
    for (const day of DAYS) if (own(rule.week, day)) {
      const windows = normalizeWindows(rule.week[day]);
      if (!windows) return null;
      week[day] = windows;
    }
    const validity = own(rule, 'validity') ? normalizeValidity(rule.validity) : null;
    if (own(rule, 'validity') && !validity) return null;
    rules.push({ week, ...(validity ? { validity } : {}) });
  }
  return rules;
}
function normalizeOverrides(value) {
  if (!Array.isArray(value) || value.length > 24) return null;
  const overrides = [];
  for (const override of value) {
    if (!fields(override, ['from', 'through', 'status', 'windows']) ||
      !validDate(override.from) || !validDate(override.through) || override.from > override.through ||
      !['known', 'closed'].includes(override.status)) return null;
    const windows = normalizeWindows(override.windows);
    if (!windows || (override.status === 'known') !== (windows.length > 0)) return null;
    overrides.push({ from: override.from, through: override.through, status: override.status, windows });
  }
  return overrides;
}
function normalizeUnresolved(value) {
  if (!Array.isArray(value) || value.length > 24) return null;
  const rules = [];
  for (const rule of value) {
    if (!fields(rule, ['reason'], ['weekdays', 'from', 'through', 'validity']) || !boundedText(rule.reason, 120)) return null;
    if (own(rule, 'weekdays') && (!Array.isArray(rule.weekdays) || !rule.weekdays.length || rule.weekdays.length > 7 ||
      rule.weekdays.some(day => !Number.isInteger(day) || day < 0 || day > 6) || new Set(rule.weekdays).size !== rule.weekdays.length)) return null;
    if ((own(rule, 'from') && !validDate(rule.from)) || (own(rule, 'through') && !validDate(rule.through)) ||
      (rule.from && rule.through && rule.from > rule.through)) return null;
    const validity = own(rule, 'validity') ? normalizeValidity(rule.validity) : null;
    if (own(rule, 'validity') && !validity) return null;
    rules.push({ reason: rule.reason.trim(), ...(validity ? { validity } : {}),
      ...(own(rule, 'weekdays') ? { weekdays: [...rule.weekdays].sort((a, b) => a - b) } : {}),
      ...(own(rule, 'from') ? { from: rule.from } : {}), ...(own(rule, 'through') ? { through: rule.through } : {}),
    });
  }
  return rules;
}

/** Validate source-owned calendar facts; optional `now` enforces acquisition age. */
function normalizeSelectedHoursCalendar(value, { record, now } = {}) {
  if (!fields(value, ['contract', 'identity_key', 'visit_function', 'entry_url', 'source_url', 'source_relation',
    'observed_at', 'rules', 'overrides', 'unresolved']) || value.contract !== CALENDAR_CONTRACT ||
    typeof value.identity_key !== 'string' || !/^[a-f0-9]{64}$/.test(value.identity_key) ||
    value.visit_function !== 'general_visit') return null;
  const entry = canonicalUrl(value.entry_url), source = canonicalUrl(value.source_url);
  if (!entry || !source || !['entry', 'direct_hours_link'].includes(value.source_relation)) return null;
  if (value.source_relation === 'entry' ? entry.toString() !== source.toString() :
    entry.origin !== source.origin || !source.pathname.startsWith(entry.pathname.replace(/\/$/, '') + '/') ||
    source.pathname === entry.pathname.replace(/\/$/, '') + '/') return null;
  if (record !== undefined) {
    const owner = canonicalUrl(record?.website);
    if (!owner || owner.toString() !== entry.toString() || selectedHoursCalendarKey(record) !== value.identity_key) return null;
  }
  if (typeof value.observed_at !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value.observed_at)) return null;
  const observed = Date.parse(value.observed_at);
  if (!Number.isFinite(observed) || new Date(observed).toISOString().slice(0, 10) !== value.observed_at.slice(0, 10)) return null;
  if (now !== undefined && (!Number.isFinite(now) || observed > now || now - observed >= MAX_AGE_MS)) return null;
  const rules = normalizeRules(value.rules), overrides = normalizeOverrides(value.overrides), unresolved = normalizeUnresolved(value.unresolved);
  if (!rules || !overrides || !unresolved || !(rules.length || overrides.length || unresolved.length)) return null;
  return { contract: CALENDAR_CONTRACT, identity_key: value.identity_key, visit_function: value.visit_function,
    entry_url: sourceUrl(value.entry_url).toString(), source_url: sourceUrl(value.source_url).toString(),
    source_relation: value.source_relation, observed_at: new Date(observed).toISOString(), rules, overrides, unresolved };
}

function unknown(reason, ordinaryDayHours = null) {
  return { status: 'unknown', eligible: true, reason, ...(ordinaryDayHours ? { ordinary_day_hours: ordinaryDayHours } : {}) };
}
function applies(validity, date) {
  if (!validity) return true;
  if (validity.kind === 'absolute') return date >= validity.from && date <= validity.through;
  const md = date.slice(5);
  return validity.from <= validity.through ? md >= validity.from && md <= validity.through : md >= validity.from || md <= validity.through;
}
function uniqueWindows(candidates) {
  if (!candidates.length) return null;
  const first = JSON.stringify(candidates[0]);
  return candidates.every(windows => JSON.stringify(windows) === first) ? candidates[0] : null;
}
function dayHours(calendar, windows, date, timezone, weekday) {
  // A synthetic weekly selector exists only inside this authoritative day
  // adapter. It never becomes a candidate schedule or lifecycle evidence.
  const expression = `${DAYS[weekday]} ${windows.length ? windows.map(window => `${window.opens}-${window.closes}`).join(',') : 'off'}`;
  const selected = buildSelectedDayHoursFact(expression, { weekday });
  return { ...selected, date, timezone, source_url: calendar.source_url, observed_at: calendar.observed_at };
}

/** Project a validated source fact for one trusted local date and visit function. */
function projectSelectedHoursCalendar(value, { date, timezone, visitFunction = 'general_visit', availabilityWindow } = {}) {
  const calendar = normalizeSelectedHoursCalendar(value);
  if (!calendar) return unknown('selected_hours_calendar_invalid');
  if (!validDate(date)) return unknown('selected_hours_calendar_date_unavailable');
  if (typeof timezone !== 'string' || !timezone || timezone.length > 80) return unknown('selected_hours_calendar_timezone_unavailable');
  try { new Intl.DateTimeFormat('en', { timeZone: timezone }); } catch { return unknown('selected_hours_calendar_timezone_unavailable'); }
  if (visitFunction !== calendar.visit_function) return unknown('selected_hours_calendar_function_mismatch');
  const weekday = new Date(date + 'T12:00:00Z').getUTCDay();
  const query = availabilityWindow === undefined ? { weekday, startMinute: 0, endMinute: 1440 } : availabilityWindow;
  if (!object(query) || query.weekday !== weekday || !Number.isFinite(query.startMinute) || !Number.isFinite(query.endMinute) ||
    query.startMinute < 0 || query.endMinute > 1440 || query.startMinute >= query.endMinute) return unknown('selected_hours_calendar_window_invalid');
  const unresolved = calendar.unresolved.filter(rule => applies(rule.validity, date) && (!rule.weekdays || rule.weekdays.includes(weekday)) &&
    (!rule.from || date >= rule.from) && (!rule.through || date <= rule.through));
  const overrides = calendar.overrides.filter(rule => date >= rule.from && date <= rule.through);
  let windows;
  if (overrides.length) {
    // Explicit exceptions supersede the ordinary holiday/late-hours caveat,
    // never another unresolved date assertion or unsupported closure notice.
    if (unresolved.some(rule => rule.from || rule.through ||
      !['holiday_condition', 'holiday_scope_unresolved', 'special_hours', 'unresolved_late_hours'].includes(rule.reason))) return unknown('selected_hours_calendar_unresolved');
    windows = uniqueWindows(overrides.map(rule => rule.windows));
    if (windows === null) return unknown('selected_hours_calendar_conflict');
  } else {
    const ordinary = calendar.rules.filter(rule => applies(rule.validity, date) && own(rule.week, DAYS[weekday])).map(rule => rule.week[DAYS[weekday]]);
    windows = uniqueWindows(ordinary);
    if (unresolved.length) {
      const reasons = new Set(unresolved.map(rule => rule.reason));
      return unknown(reasons.size === 1 ? unresolved[0].reason :
        [...reasons].every(reason => ['holiday_condition', 'holiday_scope_unresolved', 'special_hours'].includes(reason)) ? 'holiday_scope_unresolved' : 'selected_hours_calendar_unresolved',
        windows === null ? null : dayHours(calendar, windows, date, timezone, weekday));
    }
    if (windows === null) return unknown(ordinary.length ? 'selected_hours_calendar_conflict' : 'selected_hours_calendar_day_unavailable');
  }
  const fact = dayHours(calendar, windows, date, timezone, weekday);
  const expression = `${DAYS[weekday]} ${windows.length ? windows.map(window => `${window.opens}-${window.closes}`).join(',') : 'off'}`;
  const availability = evaluateOpeningHoursForWindow(expression, query);
  return { status: fact.status, eligible: availability.eligible, reason: availability.reason, selected_day_hours: fact };
}

function resolveCandidateDayHours(record, options = {}) {
  if (!record || !own(record, 'selected_hours_calendar')) return null;
  const calendar = normalizeSelectedHoursCalendar(record.selected_hours_calendar, { record, ...(options.now !== undefined ? {now:options.now} : {}) });
  return calendar ? projectSelectedHoursCalendar(calendar, options) : unknown('selected_hours_calendar_invalid');
}

module.exports = { CALENDAR_CONTRACT, selectedHoursCalendarKey, normalizeSelectedHoursCalendar,
  projectSelectedHoursCalendar, resolveCandidateDayHours };
