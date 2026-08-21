"use strict";

/**
 * "Not this" — the first entry in the day's commitment ledger.
 *
 * The user can remove a place from consideration. That is the whole verb: it
 * is SUBTRACTIVE. A public payload may say "not this one" and nothing else —
 * it can never add a place, name a source, move a stop, or vouch for anything.
 * So the trust boundary is unchanged: this filters the trusted record set the
 * server already resolved, and adds nothing to it.
 *
 * Because it only shrinks supply, an exclusion flows through every existing
 * honesty gate untouched. Removing enough places makes the day honestly thin,
 * then honestly absent — never fabricated to compensate.
 *
 * One filter, applied to the loader itself, so the composed day and the
 * candidate panel (which derive from separate loader calls) cannot disagree
 * about what the user dismissed.
 *
 * Pure / side-effect free.
 */

// A ledger is a handful of deliberate dismissals, not a payload channel.
const MAX_EXCLUDED_IDS = 40;
// Loader record ids are slugs like "cafe-0" / "way:12345". Anything else is not
// an id we issued, so it is dropped rather than matched loosely.
const ID_PATTERN = /^[a-z0-9][a-z0-9_:.-]{0,63}$/i;

// Loader results carry metadata as properties on the array. Filtering must not
// silently drop the status the honesty layer reads.
const LOADER_METADATA_KEYS = ["loader_status", "loader_error", "loader_metadata"];

/**
 * @param {unknown} value  raw request field
 * @returns {string[]} validated, deduped, bounded ids
 */
function parseExcludedCandidateIds(value) {
  const out = [];
  const seen = new Set();
  for (const entry of Array.isArray(value) ? value : []) {
    const id = typeof entry === "string" ? entry.trim() : "";
    if (!id || !ID_PATTERN.test(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= MAX_EXCLUDED_IDS) break;
  }
  return out;
}

/**
 * Wrap a trusted loader so dismissed records never enter any downstream path.
 * Returns the loader unchanged when nothing is excluded, so the default request
 * is byte-identical to before.
 */
function withoutExcludedCandidates(loader, excludedIds) {
  if (typeof loader !== "function") return loader;
  const excluded = new Set(Array.isArray(excludedIds) ? excludedIds : []);
  if (excluded.size === 0) return loader;

  return async function loadWithoutExcluded(...args) {
    const records = await loader(...args);
    // A loader failure shape is passed through untouched: an exclusion must
    // never turn an error into an empty success.
    if (!Array.isArray(records)) return records;
    const kept = records.filter((record) => !excluded.has(String(record?.id ?? "")));
    for (const key of LOADER_METADATA_KEYS) {
      if (Object.prototype.hasOwnProperty.call(records, key)) kept[key] = records[key];
    }
    return kept;
  };
}

/**
 * Bounded, public-safe echo of what the request asked to dismiss. Counts only —
 * the ids are the user's own input and are not re-published as evidence.
 */
function excludedCandidateSummary(excludedIds) {
  const ids = Array.isArray(excludedIds) ? excludedIds : [];
  return { requested_count: ids.length };
}

module.exports = {
  MAX_EXCLUDED_IDS,
  excludedCandidateSummary,
  parseExcludedCandidateIds,
  withoutExcludedCandidates,
};
