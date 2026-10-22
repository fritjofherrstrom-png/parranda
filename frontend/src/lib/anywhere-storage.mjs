import { anchorKey } from './recompose-retention.mjs';
import { normalizePreferencePriority, normalizeDayEdit } from '../../../shared/planner-intent.mjs';

/**
 * Pure helpers for saving any-city days (retention) — no localStorage here so the
 * rules are unit-testable; the component does the actual read/write.
 *
 * A saved day is a SNAPSHOT: it stores the composed result + the exact inputs
 * that produced it, keyed by place + date + preferences + walking preset so
 * re-saving the same query replaces (never duplicates) it. Events / "today" may be stale on restore,
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

export const DEFAULT_SAVED_WALK_KEY = "balanced";
const SAVED_WALK_KEYS = new Set(["calm", DEFAULT_SAVED_WALK_KEY, "full", "free"]);

export function normalizeSavedWalkKey(value) {
  return SAVED_WALK_KEYS.has(value) ? value :
    value === "short" ? "calm" : value === "long" ? "full" : DEFAULT_SAVED_WALK_KEY;
}

/**
 * The identity of one saved day: place, date, preferences and walking preset.
 *
 * Exported so the commitment snapshot can bind itself to the SAME key the
 * entry is stored under. Two days for the same place on different dates, or
 * with different preferences or walking contracts, are different days — and a
 * record written for one must not be readable by the other.
 */
export function savedEntryId({ city, place, placeLabel, dateIso, selected, walkKey, preferencePriority, dayEdit, invalidDayEdit = false } = {}) {
  const c = String(city || "").trim().toLowerCase();
  const p = (placeLabel || place || "").trim();
  const anchor = c ? `city:${c}` : p || "pos";
  const priority = normalizePreferencePriority(preferencePriority, selected);
  const edit = invalidDayEdit === true ? null : normalizeDayEdit(dayEdit);
  return `${anchor}::${dateIso || ""}::${prefsKey(selected)}::rhythm=${normalizeSavedWalkKey(walkKey)}` +
    (priority.length ? `::prio=${priority.join(",")}` : "") +
    (edit ? `::edit=${JSON.stringify(edit)}` : dayEdit != null || invalidDayEdit === true ? "::edit=invalid" : "");
}

/** The saved ledger's coarse identity is not a reusable GPS position. */
export function savedEntryAnchorKey(entry) {
  const inputs = entry?.inputs;
  if (inputs?.mode !== 'near_me') return anchorKey({ place: inputs?.place, selectionLabel: inputs?.placeLabel });
  if (inputs.city || inputs.place || inputs.placeLabel || inputs.placeRef) return null;
  const response = entry.safeResponse;
  // Intentional zero has no pins/ledger or route start. Its published source
  // anchor can bind coarse identity, never supply a new precise position.
  const emptyAnchor = isEditedEmptyEntry(entry) ? response?.agnostic_route_output_experiment?.source_status?.anchor : null;
  const key = entry?.commitments?.anchorKey ?? (Number.isFinite(emptyAnchor?.lat) && Number.isFinite(emptyAnchor?.lng)
    ? anchorKey({ coords: emptyAnchor }) : null);
  const match = typeof key === 'string' && /^coords:(-?\d{1,2}\.\d{3}),(-?\d{1,3}\.\d{3})$/.exec(key);
  if (!match || Math.abs(Number(match[1])) > 90 || Math.abs(Number(match[2])) > 180) return null;
  // A ledger cannot attest itself: compare its coarse key with this saved
  // response's published anchor. These facts never become an in-memory GPS fix.
  const firstPoint = response?.days?.[0]?.primary_route?.map_route_points?.[0];
  const anchors = [response?.agnostic_route_output_experiment?.source_status?.anchor,
    firstPoint?.role === 'start' ? firstPoint : null].filter(Boolean);
  if (!anchors.length || anchors.some(coords => anchorKey({ coords }) !== key)) return null;
  return key;
}

export function buildSavedEntry({
  city,
  place,
  placeLabel,
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
  const c = String(city ?? inputs?.city ?? "").trim().toLowerCase();
  const p = (place || "").trim();
  const priority = normalizePreferencePriority(inputs?.preferencePriority, inputs?.selected);
  const normalizedInputs = inputs ? { ...inputs } : null;
  if (normalizedInputs) {
    if (Array.isArray(inputs.selected)) normalizedInputs.selected = [...inputs.selected];
    delete normalizedInputs.preferencePriority;
    if (priority.length) normalizedInputs.preferencePriority = priority;
    delete normalizedInputs.dayEdit;
    delete normalizedInputs.invalidDayEdit;
    const edit = inputs.invalidDayEdit === true ? null : normalizeDayEdit(inputs.dayEdit);
    if (edit) normalizedInputs.dayEdit = edit;
    else if (inputs.dayEdit != null || inputs.invalidDayEdit === true) {
      normalizedInputs.dayEdit = null;
      normalizedInputs.invalidDayEdit = true;
    }
  }
  return {
    id: savedEntryId({
      city: c,
      place: p,
      placeLabel: placeLabel || inputs?.placeLabel,
      dateIso,
      selected: inputs && inputs.selected,
      walkKey: inputs && inputs.walkKey,
      preferencePriority: priority,
      dayEdit: normalizedInputs?.dayEdit,
      invalidDayEdit: normalizedInputs?.invalidDayEdit,
    }),
    label: (label || p || "Min position").trim(),
    place: p || null,
    dateIso: dateIso || null,
    savedAt: savedAt || null,
    safeResponse,
    classification,
    inputs: normalizedInputs,
    commitments: commitments || null,
  };
}

/**
 * Whether a stored entry holds a day at all. Mirrors the shared honesty rule
 * (anywhere-render-decision's isComposedStatus) so the landing can name a
 * remembered day without loading the planner's decision module. A place that
 * could not be resolved or composed is not a day to continue.
 */
export function isComposedEntry(entry) {
  const status = entry && typeof entry === "object" ? entry.classification?.status : null;
  return Boolean(entry?.safeResponse) && (status === "composed" || status === "composed_limited");
}

/** An accepted empty choice is not a composed walking route or a source failure. */
export function isEditedEmptyEntry(entry) {
  const edit = normalizeDayEdit(entry?.inputs?.dayEdit);
  const day = entry?.safeResponse?.days?.[0];
  const experiment = entry?.safeResponse?.agnostic_route_output_experiment;
  const outcome = experiment?.day_edit;
  return entry?.classification?.status === 'edited_empty' && edit?.action === 'remove' && edit.target_stop_count === 0 &&
    day?.manual_empty_day === true && day.primary_route === null && experiment?.manual_edit_published === true &&
    experiment?.promotion?.promote === false && outcome?.version === 1 && outcome.action === 'remove' &&
    outcome.status === 'applied' && outcome.target_stop_count === 0 && outcome.actual_stop_count === 0 &&
    Array.isArray(outcome.result_candidate_ids) && outcome.result_candidate_ids.length === 0;
}

// Newest-first, de-duplicated by id, capped.
export function upsertSaved(list, entry) {
  const rest = (Array.isArray(list) ? list : []).filter((e) => e && e.id !== entry.id);
  return [entry, ...rest].slice(0, SAVED_CAP);
}

export function removeSaved(list, id) {
  return (Array.isArray(list) ? list : []).filter((e) => e && e.id !== id);
}
