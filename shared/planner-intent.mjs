/** Shared input intent only: no ranking, routing, source facts or authority. */
export const PLANNER_PREFERENCE_KEYS = Object.freeze([
  "food", "culture", "views", "fika", "nightlife", "green", "second_hand",
]);
const preferenceKeys = new Set(PLANNER_PREFERENCE_KEYS);

function selectedPreferences(value) {
  return Array.isArray(value) ? [...new Set(value.filter(key => preferenceKeys.has(key)))] : [];
}

/**
 * An absent/empty priority is neutral, never the default chip order. Explicit
 * selected keys lead; any remaining selected keys follow in selection order.
 */
export function normalizePreferencePriority(value, selected) {
  const selection = selectedPreferences(selected);
  if (!Array.isArray(value)) return [];
  const requested = [...new Set(value.filter(key => selection.includes(key)))];
  return requested.length ? [...requested, ...selection.filter(key => !requested.includes(key))] : [];
}

/** Toggle a chip; selection order and explicit dominance are separate state. */
export function togglePreferenceSelection(state, key) {
  const selected = selectedPreferences(state?.selected);
  const preferencePriority = normalizePreferencePriority(state?.preferencePriority, selected);
  if (!preferenceKeys.has(key)) return { selected, preferencePriority };
  if (selected.includes(key)) return {
    selected: selected.filter(value => value !== key),
    preferencePriority: preferencePriority.filter(value => value !== key),
  };
  return {
    selected: [...selected, key],
    preferencePriority: preferencePriority.length ? [...preferencePriority, key] : [key, ...selected],
  };
}

/** Move a selected interest one rank up, or make it first from neutral. */
export function promotePreference(state, key) {
  const selected = selectedPreferences(state?.selected);
  const preferencePriority = normalizePreferencePriority(state?.preferencePriority, selected);
  if (!selected.includes(key)) return { selected, preferencePriority };
  if (!preferencePriority.length) return {
    selected, preferencePriority: [key, ...selected.filter(value => value !== key)],
  };
  const index = preferencePriority.indexOf(key);
  if (index > 0) [preferencePriority[index - 1], preferencePriority[index]] =
    [preferencePriority[index], preferencePriority[index - 1]];
  return { selected, preferencePriority };
}

function validCandidateId(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 200 &&
    value === value.trim() && !/[\u0000-\u001f\u007f]/.test(value);
}

function validCandidateIds(value, limit) {
  return Array.isArray(value) && value.length <= limit && [...value].every(validCandidateId) &&
    new Set(value).size === value.length;
}

/**
 * Canonical manual day intent, never a receipt or evidence of eligible supply.
 * Retained order is meaningful (the old slot); removed IDs are only a set.
 * Invalid input is rejected as a unit, not truncated into a different request.
 */
export function normalizeDayEdit(value) {
  if (!value || typeof value !== "object") return null;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return null;
  const fields = ["version", "action", "candidate_id", "retained_candidate_ids", "target_stop_count",
    "slot_index", "replacement_preference", "removed_candidate_ids"];
  if (fields.some(key => !Object.hasOwn(value, key))) return null;
  if (value.version !== 1 || !["replace", "remove"].includes(value.action) ||
      !validCandidateId(value.candidate_id) || !validCandidateIds(value.retained_candidate_ids, 6) ||
      !validCandidateIds(value.removed_candidate_ids, 12) ||
      !Number.isInteger(value.target_stop_count) || value.target_stop_count < 0 || value.target_stop_count > 6 ||
      !Number.isInteger(value.slot_index) || value.slot_index < 0 || value.slot_index > 5 ||
      (value.replacement_preference !== null && !preferenceKeys.has(value.replacement_preference)) ||
      (Object.hasOwn(value, "preserve_retained") && typeof value.preserve_retained !== "boolean")) return null;
  const retained = value.retained_candidate_ids;
  if (retained.includes(value.candidate_id) || value.removed_candidate_ids.some(id => retained.includes(id)) ||
      value.target_stop_count !== retained.length + (value.action === "replace" ? 1 : 0)) return null;
  return {
    version: 1,
    action: value.action,
    candidate_id: value.candidate_id,
    retained_candidate_ids: [...retained],
    target_stop_count: value.target_stop_count,
    slot_index: value.slot_index,
    replacement_preference: value.replacement_preference,
    removed_candidate_ids: [...value.removed_candidate_ids].sort(),
    ...(value.preserve_retained === false ? { preserve_retained: false } : {}),
  };
}
