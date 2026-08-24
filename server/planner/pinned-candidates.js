"use strict";

/**
 * "Keep this one" — the commitment ledger's second verb.
 *
 * A pin says: this candidate must appear in the day. It deliberately does NOT
 * say which part of the day it should be, or what it is for. If a place could
 * serve as either the anchor or the stop that follows it, composition stays
 * free to use it wherever it yields a coherent day.
 *
 * TRUST: a pin can only ever name a candidate the server has ALREADY loaded and
 * already passed through its gates. It selects within the eligible pool; it
 * never adds to it. So a public payload cannot elevate a candidate the gates
 * rejected, cannot introduce a place, and cannot vouch for anything — the same
 * boundary the exclude ledger keeps, from the other direction.
 *
 * That property is structural rather than checked: pinning is expressed as
 * "prefer these members of the pool", so a candidate outside the pool simply
 * has nothing to select.
 *
 * A pin the day cannot honour is reported, never silently dropped. The caller
 * compares what it asked to keep against what the composed day contains.
 *
 * Pure / side-effect free.
 */

// A day is a handful of deliberate commitments, not a payload channel.
const MAX_PINNED_IDS = 12;
// Same vocabulary the exclude ledger validates against: ids we issue.
const ID_PATTERN = /^[a-z0-9][a-z0-9_:.-]{0,63}$/i;

/**
 * @param {unknown} value  raw request field
 * @returns {string[]} validated, deduped, bounded ids
 */
function parsePinnedCandidateIds(value) {
  const out = [];
  const seen = new Set();
  for (const entry of Array.isArray(value) ? value : []) {
    const id = typeof entry === "string" ? entry.trim() : "";
    if (!id || !ID_PATTERN.test(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= MAX_PINNED_IDS) break;
  }
  return out;
}

/**
 * Force pinned members of the eligible pool into the selected set.
 *
 * @param {Array} selected      stops the scorer chose
 * @param {Array} pool          the eligible pool, already ordered by score
 * @param {Iterable<string>} pinnedIds
 * @returns {Array} selection containing every pinnable pin, order otherwise intact
 */
function applyPinnedSelection(selected, pool, pinnedIds) {
  const pins = new Set(Array.isArray(pinnedIds) ? pinnedIds : [...(pinnedIds || [])]);
  if (pins.size === 0) return Array.isArray(selected) ? selected : [];

  const current = Array.isArray(selected) ? selected : [];
  const present = new Set(current.map((stop) => stopId(stop)));
  const missing = [];
  for (const item of Array.isArray(pool) ? pool : []) {
    const id = stopId(item);
    // Only pool members can be pinned. A candidate the gates removed is simply
    // not here, so there is nothing to force.
    if (!id || !pins.has(id) || present.has(id)) continue;
    present.add(id);
    missing.push(item);
  }
  if (missing.length === 0) return current;
  // Kept stops lead: the day is composed around the commitment, and ordering
  // downstream still owns the actual sequence.
  return [...missing, ...current];
}

/**
 * Which pins the composed day actually contains. The difference is what the
 * user has to be told, so it is derived from the real output rather than from
 * an intention recorded earlier.
 */
function summarizePinnedOutcome(pinnedIds, stops, refusals = []) {
  const requested = Array.isArray(pinnedIds) ? pinnedIds : [];
  const present = new Set((Array.isArray(stops) ? stops : []).map((stop) => stopId(stop)));
  const honored = requested.filter((id) => present.has(id));
  // The reason each unmet commitment went unmet, keyed by the id the client
  // asked for. Derived from the published day like the counts above, so the
  // list and the counts can never disagree about which pins went unmet.
  const byId = new Map(
    (Array.isArray(refusals) ? refusals : []).map((entry) => [String(entry?.id), entry?.reason]),
  );
  const unhonored = requested
    .filter((id) => !present.has(id))
    .map((id) => ({ id, reason: byId.get(String(id)) || null }));
  return {
    requested_count: requested.length,
    honored_count: honored.length,
    unhonored_count: requested.length - honored.length,
    unhonored,
  };
}

function stopId(stop) {
  if (!stop || typeof stop !== "object") return "";
  return String(stop.id ?? stop.candidate_id ?? stop.place_id ?? "");
}

module.exports = {
  MAX_PINNED_IDS,
  applyPinnedSelection,
  parsePinnedCandidateIds,
  summarizePinnedOutcome,
};
