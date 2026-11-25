"use strict";

/**
 * "Something wrong with this place?" — reports from anyone, read only by the
 * owner. A report never changes a day by itself: it waits in the owner's queue
 * until the owner turns it into a correction or dismisses it. Automatic hiding
 * after N reports would let anyone hide a competitor.
 *
 * Stored per report: the place (id, label, source), what is wrong, an optional
 * comment and suggested hours, and the time. No account, no name, no address.
 * The comment is only ever shown to the owner, as text.
 *
 * Like the corrections, the file is an append-only log beside them
 * (`reports.jsonl`): handling a report is a later `resolve` event, and nothing
 * is erased.
 */

const nodeFs = require("node:fs");
const nodePath = require("node:path");
const { randomBytes } = require("node:crypto");
const { TARGET_ID } = require("../planner/owner-corrections");

const FILE_NAME = "reports.jsonl";
const KINDS = Object.freeze(["closed", "wrong_type", "wrong_hours", "wrong_location", "other"]);
const RESOLUTIONS = new Set(["dismissed", "corrected"]);
const MAX_COMMENT = 280;
const MAX_HOURS = 120;
const MAX_LABEL = 200;
const MAX_PER_DAY = 500;
const MAX_LINES = 200000;
const MAX_IDS_PER_RESOLVE = 1000;
const COMMENTS_PER_GROUP = 10;
const RELOAD_CHECK_MS = 1000;
const REPORT_ID = /^r_[a-z0-9]{6,24}$/;
const CORRECTION_ID = /^c_[a-z0-9]{6,24}$/;
const SOURCE = /^[a-z0-9_-]{1,40}$/;

function cleanText(value, max) {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") return null;
  const text = value.replace(/[\u0000-\u001f\u007f]+/g, " ").trim();
  if (!text) return undefined;
  return text.length <= max ? text : null;
}

function validTime(value) {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

/** Normalize one log event, or `{ error }` naming why it is refused. */
function validateReportEvent(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { error: "not_an_object" };
  if (raw.v !== 1) return { error: "unknown_version" };
  if (!validTime(raw.at)) return { error: "bad_time" };
  if (raw.event === "resolve") {
    const ids = Array.isArray(raw.ids) ? raw.ids : [];
    if (!ids.length || ids.length > MAX_IDS_PER_RESOLVE || !ids.every(id => REPORT_ID.test(String(id)))) {
      return { error: "bad_ids" };
    }
    if (!RESOLUTIONS.has(raw.resolution)) return { error: "unknown_resolution" };
    if (raw.correction_id !== undefined && !CORRECTION_ID.test(String(raw.correction_id))) {
      return { error: "bad_correction_id" };
    }
    return {
      v: 1, event: "resolve", at: raw.at, ids: ids.map(String), resolution: raw.resolution,
      ...(raw.correction_id ? { correction_id: raw.correction_id } : {}),
    };
  }
  if (raw.event !== "report") return { error: "unknown_event" };
  if (!REPORT_ID.test(String(raw.id || ""))) return { error: "bad_id" };
  const target = raw.target && typeof raw.target === "object" ? raw.target : {};
  const id = typeof target.id === "string" ? target.id.trim() : "";
  if (!TARGET_ID.test(id)) return { error: "bad_target" };
  const label = cleanText(target.label, MAX_LABEL);
  const source = target.source === undefined || target.source === null || target.source === ""
    ? undefined
    : (typeof target.source === "string" && SOURCE.test(target.source) ? target.source : null);
  if (label === null || source === null) return { error: "bad_target" };
  if (!KINDS.includes(raw.kind)) return { error: "unknown_kind" };
  const comment = cleanText(raw.comment, MAX_COMMENT);
  if (comment === null) return { error: "bad_comment" };
  const hours = cleanText(raw.hours, MAX_HOURS);
  if (hours === null) return { error: "bad_hours" };
  return {
    v: 1, event: "report", id: raw.id, at: raw.at,
    target: { id, ...(label ? { label } : {}), ...(source ? { source } : {}) },
    kind: raw.kind,
    ...(comment ? { comment } : {}),
    ...(hours ? { hours } : {}),
  };
}

const groupKey = (targetId, kind) => `${targetId}\n${kind}`;

/**
 * The owner's queue: open reports grouped by place and kind, with a count.
 * Places with more reports come first, then the most recent.
 */
function foldReports(events) {
  const resolved = new Set();
  for (const event of events) if (event.event === "resolve") for (const id of event.ids) resolved.add(id);
  const groups = new Map();
  const perDay = new Map();
  for (const event of events) {
    if (event.event !== "report") continue;
    const day = event.at.slice(0, 10);
    perDay.set(day, (perDay.get(day) || 0) + 1);
    if (resolved.has(event.id)) continue;
    const key = groupKey(event.target.id, event.kind);
    let group = groups.get(key);
    if (!group) {
      group = { target: { id: event.target.id }, kind: event.kind, count: 0, first_at: event.at, last_at: event.at,
        notes: [], report_ids: [] };
      groups.set(key, group);
    }
    group.count += 1;
    group.report_ids.push(event.id);
    if (event.at < group.first_at) group.first_at = event.at;
    if (event.at >= group.last_at) group.last_at = event.at;
    // The latest label and source the reporter saw.
    if (event.target.label) group.target.label = event.target.label;
    if (event.target.source) group.target.source = event.target.source;
    if (event.comment || event.hours) {
      group.notes.push({ at: event.at, ...(event.comment ? { comment: event.comment } : {}),
        ...(event.hours ? { hours: event.hours } : {}) });
    }
  }
  const queue = [...groups.values()]
    .map(group => ({ ...group, notes: group.notes.sort((a, b) => b.at.localeCompare(a.at)).slice(0, COMMENTS_PER_GROUP) }))
    .sort((a, b) => b.count - a.count || b.last_at.localeCompare(a.last_at));
  return { queue, groups, perDay };
}

const EMPTY = Object.freeze({ queue: [], groups: new Map(), perDay: new Map() });

function createPlaceReportStore({
  directory,
  fs = nodeFs,
  now = () => Date.now(),
  logger = console,
} = {}) {
  if (typeof directory !== "string" || !directory.trim()) return null;
  const dir = directory.trim();
  const file = nodePath.join(dir, FILE_NAME);
  let state = EMPTY;
  let stamp = null;
  let checkedAt = -Infinity;
  let skipped = 0;

  function load() {
    let stat = null;
    try { stat = fs.statSync(file); } catch (_) { stat = null; }
    const nextStamp = stat ? `${stat.mtimeMs}:${stat.size}` : "missing";
    if (nextStamp === stamp) return;
    stamp = nextStamp;
    if (!stat) { state = EMPTY; skipped = 0; return; }
    let text = "";
    try { text = fs.readFileSync(file, "utf8"); } catch (error) {
      logger?.warn?.(`[place-reports] cannot read ${file}: ${error.message}`);
      return;
    }
    const events = [];
    let bad = 0;
    for (const line of text.split("\n").slice(0, MAX_LINES)) {
      if (!line.trim()) continue;
      let parsed = null;
      try { parsed = JSON.parse(line); } catch (_) { bad += 1; continue; }
      const event = validateReportEvent(parsed);
      if (event.error) { bad += 1; continue; }
      events.push(event);
    }
    if (bad && bad !== skipped) logger?.warn?.(`[place-reports] skipped ${bad} unreadable line(s) in ${file}`);
    skipped = bad;
    state = foldReports(events);
  }

  function current() {
    const at = now();
    if (at - checkedAt >= RELOAD_CHECK_MS) {
      checkedAt = at;
      load();
    }
    return state;
  }

  function write(event) {
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(file, `${JSON.stringify(event)}\n`, { encoding: "utf8", mode: 0o640 });
    checkedAt = -Infinity;
  }

  function refuse(reason) {
    const error = new Error(`invalid report: ${reason}`);
    error.reason = reason;
    return error;
  }

  /**
   * Store one public report. Throws on invalid input (the caller answers 400);
   * returns `{ stored: false }` when the day's total is used up.
   */
  function submit(input) {
    const at = new Date(now()).toISOString();
    const event = validateReportEvent({
      v: 1, event: "report", id: `r_${randomBytes(6).toString("hex")}`, at,
      target: input?.target, kind: input?.kind, comment: input?.comment, hours: input?.hours,
    });
    if (event.error) throw refuse(event.error);
    checkedAt = -Infinity;
    if ((current().perDay.get(at.slice(0, 10)) || 0) >= MAX_PER_DAY) return { stored: false, reason: "daily_cap" };
    write(event);
    return { stored: true, id: event.id };
  }

  /** Close every open report for one place and kind. Returns how many. */
  function resolveGroup({ targetId, kind, resolution, correctionId } = {}) {
    checkedAt = -Infinity;
    const group = current().groups.get(groupKey(String(targetId || ""), kind));
    if (!group) throw refuse("unknown_group");
    let closed = 0;
    for (let index = 0; index < group.report_ids.length; index += MAX_IDS_PER_RESOLVE) {
      const event = validateReportEvent({
        v: 1, event: "resolve", at: new Date(now()).toISOString(),
        ids: group.report_ids.slice(index, index + MAX_IDS_PER_RESOLVE), resolution,
        ...(correctionId ? { correction_id: correctionId } : {}),
      });
      if (event.error) throw refuse(event.error);
      write(event);
      closed += event.ids.length;
    }
    return closed;
  }

  return {
    file,
    submit,
    resolveGroup,
    queue: () => current().queue.map(({ report_ids, ...group }) => group),
    skippedLines: () => { current(); return skipped; },
  };
}

module.exports = {
  FILE_NAME,
  KINDS,
  MAX_PER_DAY,
  createPlaceReportStore,
  foldReports,
  validateReportEvent,
};
