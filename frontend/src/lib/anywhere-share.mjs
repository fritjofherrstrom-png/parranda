/**
 * Shareable any-city day links — pure encode/decode of the day's inputs into URL
 * query params, so a shared link auto-plans the SAME day (place + preferences +
 * day + rhythm + language). Legacy kilometer links restore rhythm intent only.
 *
 * Only inputs are encoded, never results — the recipient's engine composes fresh
 * (honest: events / "today" reflect when THEY open it, not when it was shared).
 */

import { normalizePreferencePriority, normalizeDayEdit } from "../../../shared/planner-intent.mjs";

// The full bounded schema fits even when every ID needs JSON escaping. Refuse
// oversized raw URL input before parsing; never truncate an edit into another.
const MAX_EDIT_PARAM_LENGTH = 32768;

// A language-independent OSM identity the server re-validates itself
// ("r5400890" = relation 5400890). It names the place; it is never geography.
const PLACE_REF = /^[nwr][1-9]\d{0,11}$/;
export function validPlaceRef(value) {
  return typeof value === "string" && PLACE_REF.test(value) && !/[\r\n]/.test(value) ? value : null;
}

export function encodeShareParams({ city, place, placeRef, preferences = [], preferencePriority, dayEdit, invalidDayEdit = false, dayOffset = 0, walkKey = "balanced", lang = "en" } = {}) {
  const params = new URLSearchParams();
  const cityKey = String(city || "").trim().toLowerCase();
  if (/^[a-z0-9-]{1,64}$/.test(cityKey)) params.set("city", cityKey);
  const p = String(place || "").trim();
  if (p) params.set("place", p);
  // Display text is optional; the server resolves the identity itself.
  if (validPlaceRef(placeRef)) params.set("place_ref", placeRef);
  params.set("planner", "open");
  if (Array.isArray(preferences) && preferences.length) params.set("prefs", preferences.join(","));
  const priority = normalizePreferencePriority(preferencePriority, preferences);
  if (priority.length) params.set("prio", priority.join(","));
  if (dayEdit != null || invalidDayEdit === true) {
    // Invalid explicit intent stays explicit, without sharing its raw contents.
    params.set("edit", JSON.stringify(invalidDayEdit === true ? null : normalizeDayEdit(dayEdit)));
  }
  if (dayOffset === 1) params.set("day", "1");
  if (walkKey && walkKey !== "balanced") params.set("rhythm", walkKey);
  params.set("lang", lang === "sv" ? "sv" : "en");
  return params.toString();
}

// Build a full absolute share URL from an origin + inputs.
export function buildShareUrl(origin, inputs) {
  const base = String(origin || "").replace(/\/$/, "");
  return `${base}/anywhere?${encodeShareParams(inputs)}`;
}

// Losing a selected qualifier can silently share a different namesake.
// Decline sharing when the canonical label exceeds the resolver query budget.
export function shareablePlace(inputs) {
  if (!inputs?.place) return null;
  const place = String(inputs.placeLabel || inputs.place).trim();
  return place && place.length <= 200 ? place : null;
}

// Decode a query string (or URLSearchParams) back into day inputs. Unknown/absent
// params fall back to sensible defaults; only whitelisted preference keys survive.
export function decodeShareParams(search, allowedPrefKeys = null) {
  const params = typeof search === "string" ? new URLSearchParams(search) : search;
  const rawCity = (params.get("city") || "").trim().toLowerCase();
  const city = /^[a-z0-9-]{1,64}$/.test(rawCity) ? rawCity : null;
  const place = (params.get("place") || "").trim();
  const placeRef = validPlaceRef(params.get("place_ref"));
  const rawPrefs = (params.get("prefs") || "").split(",").map((s) => s.trim()).filter(Boolean);
  const preferences = allowedPrefKeys ? rawPrefs.filter((k) => allowedPrefKeys.includes(k)) : rawPrefs;
  const priority = normalizePreferencePriority((params.get("prio") || "").split(","), preferences);
  const editParams = params.getAll("edit");
  let dayEdit = null;
  if (editParams.length === 1 && editParams[0].length <= MAX_EDIT_PARAM_LENGTH) {
    try { dayEdit = normalizeDayEdit(JSON.parse(editParams[0])); } catch { /* explicit invalid intent */ }
  }
  const dayOffset = params.get("day") === "1" ? 1 : 0;
  const rhythmRaw = params.get("rhythm");
  // Old kilometer links remain readable as intent, but never restore a km target.
  const legacy = params.get("km");
  const walkKey = ["calm", "balanced", "full", "free"].includes(rhythmRaw)
    ? rhythmRaw
    : legacy === "short" ? "calm" : legacy === "long" ? "full" : "balanced";
  const langRaw = params.get("lang");
  const lang = langRaw === "sv" ? "sv" : langRaw === "en" ? "en" : null;
  const invalidPlaceRef = params.has("place_ref") && !validPlaceRef(params.get("place_ref"));
  return { city, place, placeRef, invalidPlaceRef, preferences, dayOffset, walkKey, lang,
    ...(priority.length ? { preferencePriority: priority } : {}),
    ...(editParams.length ? { dayEdit, invalidDayEdit: !dayEdit } : {}) };
}
