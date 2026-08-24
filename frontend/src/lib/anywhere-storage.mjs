/**
 * Pure helpers for saving any-city days (retention) — no localStorage here so the
 * rules are unit-testable; the component does the actual read/write.
 *
 * A saved day is a SNAPSHOT: it stores the composed result + the exact inputs
 * that produced it, keyed by place + date + preferences so re-saving the same
 * query replaces (never duplicates) it. Events / "today" may be stale on restore,
 * so the UI labels it and offers a rebuild.
 *
 * It also stores the commitments that day answered (see commitment-snapshot),
 * so a restore can carry them without inferring anything. The id is what keeps
 * days isolated from one another: two saved days for the same place on
 * different dates are different entries and each carries its own record.
 */

export const LAST_KEY = "parranda:anywhere:last";
export const SAVED_KEY = "parranda:anywhere:saved";
export const SAVED_CAP = 12;

function prefsKey(prefs) {
  return (Array.isArray(prefs) ? prefs.slice().sort() : []).join(",");
}

/**
 * The identity of one saved day: place, date and preferences.
 *
 * Exported so the commitment snapshot can bind itself to the SAME key the
 * entry is stored under. Two days for the same place on different dates, or
 * with different preferences, are different days — and a record written for
 * one must not be readable by the other.
 */
export function savedEntryId({ place, dateIso, selected } = {}) {
  const p = (place || "").trim();
  return `${p || "pos"}::${dateIso || ""}::${prefsKey(selected)}`;
}

export function buildSavedEntry({
  place,
  label,
  dateIso,
  savedAt,
  safeResponse,
  classification,
  inputs,
  // The immutable, versioned record of what this day was composed under. Null
  // for a day with no commitments, and for every day saved before this existed.
  commitments = null,
} = {}) {
  const p = (place || "").trim();
  return {
    id: savedEntryId({ place: p, dateIso, selected: inputs && inputs.selected }),
    label: (label || p || "Min position").trim(),
    place: p || null,
    dateIso: dateIso || null,
    savedAt: savedAt || null,
    safeResponse,
    classification,
    inputs: inputs || null,
    commitments: commitments || null,
  };
}

// Newest-first, de-duplicated by id, capped.
export function upsertSaved(list, entry) {
  const rest = (Array.isArray(list) ? list : []).filter((e) => e && e.id !== entry.id);
  return [entry, ...rest].slice(0, SAVED_CAP);
}

export function removeSaved(list, id) {
  return (Array.isArray(list) ? list : []).filter((e) => e && e.id !== id);
}
