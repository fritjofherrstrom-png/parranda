"use strict";

/**
 * Owner corrections: durable, global fixes the owner makes to places the
 * sources got wrong (25 Nov 2026: Overture lists a Prague property manager,
 * "Flat Service", as a second-hand shop, and it became stop 1 of a
 * second-hand day).
 *
 * The sources are never edited. OSM extracts, Overture and the caches are
 * rebuilt and replaced; a fix written into them would vanish with the next
 * build. Corrections live in their own append-only log and are laid over the
 * loader's records every time, after any cache, so a correction never needs a
 * cache flush or a restart.
 *
 * It is the durable, global sibling of "Not this" (excluded-candidates.js):
 * that one is one request's dismissal, this one is the owner's decision for
 * every request. Version 1 has two actions:
 *   - hide: the place never enters any day;
 *   - set_type: the place is re-typed to a known OSM mapping (OSM_TAG_MAP), for
 *     a place that is real and visitable but of another kind.
 * Opening-hour corrections are left for later: hours pass through enrichment,
 * selected-day calendars and the loader's own window filter, and one layer on
 * the loader's output cannot own all three.
 *
 * Nothing is ever deleted. Undoing a correction is a later `revoke` event.
 * The public payload can never reach this module: only the server reads the
 * log, and only server-side tools write it.
 */

const nodeFs = require("node:fs");
const nodePath = require("node:path");
const { randomBytes } = require("node:crypto");
const { SOURCE_COMPLETION, SOURCE_SNAPSHOT } = require("../place-candidates/background-source");
const { OSM_TAG_MAP } = require("../place-candidates/open-data-loader");

const FILE_NAME = "corrections.jsonl";
const ACTIONS = new Set(["hide", "set_type"]);
const MAX_ACTIVE = 5000;
const MAX_LINES = 50000;
const MAX_REASON = 280;
const MAX_LABEL = 200;
const RELOAD_CHECK_MS = 1000;
// Loader ids: "osm-node-123", "overture-<GERS id>", "wikidata-Q42", catalog slugs.
const TARGET_ID = /^[a-z0-9][a-z0-9_:.-]{0,127}$/i;
const CORRECTION_ID = /^c_[a-z0-9]{6,24}$/;
const OSM_TYPE = /^([a-z_:]{1,40})=([a-z0-9_;:-]{1,60})$/;

// "shop=antiques" → { type, tags } from the loader's own table. Only plain
// entries: one with an extra `and` condition needs a tag a correction cannot vouch for.
function typeForOsmTag(value) {
  const match = typeof value === "string" ? OSM_TYPE.exec(value.trim()) : null;
  if (!match) return null;
  const entry = OSM_TAG_MAP.find(row => row.key === match[1] && row.value === match[2] && !row.and);
  return entry ? { type: entry.type, tags: entry.tags.slice() } : null;
}

function cleanText(value, max) {
  if (typeof value !== "string") return null;
  const text = value.replace(/[\u0000-\u001f\u007f]+/g, " ").trim();
  return text && text.length <= max ? text : null;
}

/**
 * Validate one log event. Returns the normalized event, or { error } naming
 * the first problem. Shared by reading (skip and count) and writing (refuse).
 */
function validateEvent(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { error: "not_an_object" };
  if (raw.v !== 1) return { error: "unknown_version" };
  if (typeof raw.id !== "string" || !CORRECTION_ID.test(raw.id)) return { error: "bad_id" };
  if (typeof raw.at !== "string" || !Number.isFinite(Date.parse(raw.at))) return { error: "bad_time" };
  if (raw.event === "revoke") {
    const reason = raw.reason === undefined ? null : cleanText(raw.reason, MAX_REASON);
    if (raw.reason !== undefined && !reason) return { error: "bad_reason" };
    return { v: 1, event: "revoke", id: raw.id, at: raw.at, ...(reason ? { reason } : {}) };
  }
  if (raw.event !== "add") return { error: "unknown_event" };
  const target = raw.target;
  if (!target || typeof target !== "object" || typeof target.id !== "string" || !TARGET_ID.test(target.id)) {
    return { error: "bad_target" };
  }
  if (!ACTIONS.has(raw.action)) return { error: "unknown_action" };
  const reason = cleanText(raw.reason, MAX_REASON);
  if (!reason) return { error: "reason_required" };
  let value = null;
  if (raw.action === "set_type") {
    if (!typeForOsmTag(raw.value?.osm)) return { error: "unknown_type" };
    value = { osm: raw.value.osm.trim() };
  }
  const label = cleanText(target.label, MAX_LABEL);
  const source = cleanText(target.source, 40);
  const lat = Number.isFinite(target.lat) && Math.abs(target.lat) <= 90 ? target.lat : null;
  const lng = Number.isFinite(target.lng) && Math.abs(target.lng) <= 180 ? target.lng : null;
  return {
    v: 1, event: "add", id: raw.id, at: raw.at,
    target: { id: target.id, ...(source ? { source } : {}), ...(label ? { label } : {}),
      ...(lat !== null && lng !== null ? { lat, lng } : {}) },
    action: raw.action, value, reason,
  };
}

/**
 * Fold the log into what applies now. For each place and action the latest
 * correction that is not revoked wins; a hide outranks a re-type.
 */
function foldEvents(events) {
  const adds = new Map();
  const revoked = new Set();
  for (const event of events) {
    if (event.event === "add") adds.set(event.id, event);
    else revoked.add(event.id);
  }
  const active = [...adds.values()].filter(event => !revoked.has(event.id));
  const byTarget = new Map();
  for (const event of active) {
    const entry = byTarget.get(event.target.id) || {};
    entry[event.action] = event; // log order: a later correction replaces an earlier one
    byTarget.set(event.target.id, entry);
  }
  const hidden = new Set();
  const retype = new Map();
  for (const [id, entry] of byTarget) {
    if (hidden.size + retype.size >= MAX_ACTIVE) break;
    if (entry.hide) hidden.add(id);
    else if (entry.set_type) retype.set(id, typeForOsmTag(entry.set_type.value.osm));
  }
  return { hidden, retype, active };
}

const EMPTY = Object.freeze({ hidden: new Set(), retype: new Map(), active: [] });

/**
 * File-backed store. Without a directory there is no store at all (null), so
 * the default deployment is unchanged. The file is re-read when it changes,
 * checked at most once a second, so web and worker pick up a new correction
 * within seconds and without a restart.
 */
function createOwnerCorrectionStore({ directory, fs = nodeFs, now = () => Date.now(), logger = console } = {}) {
  if (typeof directory !== "string" || !directory.trim()) return null;
  const file = nodePath.join(directory, FILE_NAME);
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
      logger?.warn?.(`[owner-corrections] cannot read ${file}: ${error.message}`);
      return; // keep the last good state rather than dropping every correction
    }
    const events = [];
    let bad = 0;
    const lines = text.split("\n");
    for (const line of lines.slice(0, MAX_LINES)) {
      if (!line.trim()) continue;
      let parsed = null;
      try { parsed = JSON.parse(line); } catch (_) { bad += 1; continue; }
      const event = validateEvent(parsed);
      if (event.error) { bad += 1; continue; }
      events.push(event);
    }
    if (bad && bad !== skipped) logger?.warn?.(`[owner-corrections] skipped ${bad} unreadable line(s) in ${file}`);
    skipped = bad;
    state = foldEvents(events);
  }

  function current() {
    const at = now();
    if (at - checkedAt >= RELOAD_CHECK_MS) {
      checkedAt = at;
      load();
    }
    return state;
  }

  /** Append one event. Fills id and time; refuses anything invalid. */
  function append(input) {
    const event = validateEvent({ v: 1, id: `c_${randomBytes(6).toString("hex")}`,
      at: new Date(now()).toISOString(), ...input });
    if (event.error) {
      const error = new Error(`invalid correction: ${event.error}`);
      error.reason = event.error;
      throw error;
    }
    if (event.event === "revoke") {
      checkedAt = -Infinity;
      const known = current().active.some(active => active.id === event.id);
      if (!known) {
        const error = new Error(`no active correction ${event.id}`);
        error.reason = "unknown_correction";
        throw error;
      }
    }
    fs.mkdirSync(directory, { recursive: true });
    fs.appendFileSync(file, `${JSON.stringify(event)}\n`, { encoding: "utf8", mode: 0o640 });
    checkedAt = -Infinity; // the next read sees it at once
    return event;
  }

  return {
    file,
    current,
    append,
    list: () => current().active.slice(),
    skippedLines: () => { current(); return skipped; },
  };
}

function isIndexKey(key) {
  return key === "length" || (typeof key === "string" && /^\d+$/.test(key));
}

/**
 * Lay the corrections over one loader answer. `read` is the store's current()
 * so late source rows (background completion, partial snapshots) are checked
 * against the corrections of the moment they arrive.
 */
function correctRecords(records, read) {
  if (!Array.isArray(records)) return records;
  const { hidden, retype } = read();
  // No corrections: the answer keeps its identity and every property, so the
  // default deployment behaves byte for byte as before.
  if (!hidden.size && !retype.size) return records;
  const late = SOURCE_COMPLETION in records || SOURCE_SNAPSHOT in records;
  let changed = false;
  const kept = [];
  for (const record of records) {
    const id = record?.id == null ? "" : String(record.id);
    if (id && hidden.has(id)) { changed = true; continue; }
    const type = id ? retype.get(id) : null;
    if (type) {
      changed = true;
      // Details were derived from the old kind (e.g. "second_hand_clothing").
      const { place_details: _details, ...rest } = record;
      kept.push({ ...rest, type: type.type, tags: type.tags.slice() });
      continue;
    }
    kept.push(record);
  }
  // Untouched supply keeps its identity, so request-local caches keyed on the
  // array (enrichment, lifecycle snapshots) behave exactly as before. Late
  // rows must still pass the corrections, so those answers are always wrapped.
  if (!changed && !late) return records;
  for (const key of Reflect.ownKeys(records)) {
    if (isIndexKey(key)) continue;
    const descriptor = Object.getOwnPropertyDescriptor(records, key);
    if (key === SOURCE_COMPLETION) {
      const completion = Promise.resolve(records[key]).then(rows => correctRecords(rows, read));
      completion.catch(() => {}); // the original promise still carries the failure
      Object.defineProperty(kept, key, { ...descriptor, value: completion });
    } else if (key === SOURCE_SNAPSHOT && typeof records[key] === "function") {
      const snapshot = records[key];
      Object.defineProperty(kept, key, { ...descriptor, value: (...args) => correctRecords(snapshot(...args), read) });
    } else {
      Object.defineProperty(kept, key, descriptor);
    }
  }
  return kept;
}

/**
 * Wrap the app's trusted loader once, so every path that reads places (the
 * day, the candidate panel, inspect sidecars, Blitz, registered-city fill)
 * sees the same corrected supply. Without a store the loader is returned
 * unchanged.
 */
function withOwnerCorrections(loader, store) {
  if (typeof loader !== "function" || !store) return loader;
  const corrected = async function loadWithOwnerCorrections(...args) {
    // A failure shape (not an array) passes untouched.
    return correctRecords(await loader(...args), store.current);
  };
  // Helpers hung on the loader (enrich, readCached, ...) keep working. They
  // only ever see records this wrapper already corrected.
  for (const key of Reflect.ownKeys(loader)) {
    if (["length", "name", "prototype"].includes(key)) continue;
    Object.defineProperty(corrected, key, Object.getOwnPropertyDescriptor(loader, key));
  }
  return corrected;
}

module.exports = {
  FILE_NAME,
  createOwnerCorrectionStore,
  foldEvents,
  typeForOsmTag,
  validateEvent,
  withOwnerCorrections,
};
