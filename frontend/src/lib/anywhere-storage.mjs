/**
 * Pure helpers for saving any-city days (retention) — no localStorage here so the
 * rules are unit-testable; the component does the actual read/write.
 *
 * A saved day is a SNAPSHOT: it stores the composed result + the exact inputs
 * that produced it, keyed by place + date + preferences so re-saving the same
 * query replaces (never duplicates) it. Events / "today" may be stale on restore,
 * so the UI labels it and offers a rebuild.
 */

export const LAST_KEY = "parranda:anywhere:last";
export const SAVED_KEY = "parranda:anywhere:saved";
export const SAVED_CAP = 12;

function prefsKey(prefs) {
  return (Array.isArray(prefs) ? prefs.slice().sort() : []).join(",");
}

export function buildSavedEntry({ place, label, dateIso, savedAt, safeResponse, classification, inputs } = {}) {
  const p = (place || "").trim();
  return {
    id: `${p || "pos"}::${dateIso || ""}::${prefsKey(inputs && inputs.selected)}`,
    label: (label || p || "Min position").trim(),
    place: p || null,
    dateIso: dateIso || null,
    savedAt: savedAt || null,
    safeResponse,
    classification,
    inputs: inputs || null,
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
