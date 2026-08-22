/**
 * Pure payload builder for the any-city planner — mirrors the production
 * anywhere-mode request (script.js planRoutesAnywhere) so the new frontend and
 * the current app speak the SAME API contract:
 *   - freeform `place` only, NEVER a recognized `city` key;
 *   - the three agnostic flags engage the engine path.
 * Kept as a pure .mjs module so node --test can assert the contract without a DOM.
 */

export const ANYWHERE_PREFERENCES = [
  { key: "food", sv: "Mat & dryck", en: "Food & drink" },
  { key: "culture", sv: "Kultur", en: "Culture" },
  { key: "views", sv: "Utsikt", en: "Views" },
  { key: "fika", sv: "Fika", en: "Coffee" },
  { key: "nightlife", sv: "Kvällsliv", en: "Nightlife" },
  { key: "green", sv: "Grönt & promenad", en: "Green & walks" },
  { key: "second_hand", sv: "Second hand", en: "Second hand" },
];

// ISO date (YYYY-MM-DD) offset by N days from a base date — pure + injectable so
// "tomorrow" is unit-testable without a real clock.
// The VIEWER-LOCAL calendar date, never the UTC one: toISOString() would hand a
// viewer ahead of UTC yesterday's date as "Today" until their UTC offset o'clock
// (Kyoto: the whole morning), and that date drives selected-day opening hours
// and the event-weave day alignment.
export function isoDateFromOffset(offsetDays = 0, from = new Date()) {
  const d = new Date(from.getTime());
  d.setDate(d.getDate() + offsetDays);
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${month}-${day}`;
}

// Walking-length presets → the same walking_km_target the production planner sends.
export const WALK_PRESETS = [
  { key: "short", km: 4, sv: "Kort · ~4 km", en: "Short · ~4 km" },
  { key: "balanced", km: 6, sv: "Lagom · ~6 km", en: "Balanced · ~6 km" },
  { key: "long", km: 9, sv: "Lång · ~9 km", en: "Long · ~9 km" },
];

export function buildAnywherePayload({
  place,
  coords,
  dates,
  preferences = [],
  walkingKmTarget = 6,
  excludedCandidateIds = [],
  pinnedCandidateIds = [],
} = {}) {
  const autoPoint = { type: "auto", label: "Parranda väljer" };
  // Two exclusive anchor modes, mirroring the engine's intake precedence:
  //  - coords ("near me now"): top-level lat/lng — explicit coords WIN in the
  //    agnostic intake (parseBlitzCoordinates), and no place text is sent;
  //  - place (typed city): freeform text only, never a recognized city key.
  const anchor =
    coords && Number.isFinite(coords.lat) && Number.isFinite(coords.lng)
      ? { lat: coords.lat, lng: coords.lng }
      : { place, place_query: place };
  return {
    ...anchor,
    dates,
    home_base: autoPoint,
    start: autoPoint,
    end: autoPoint,
    walking_km_target: walkingKmTarget,
    leg_pacing: "balanced",
    preferences,
    distance_mode: "soft_target",
    budget_tier: "standard",
    experimental_agnostic_route_output: 1,
    include_external_candidates: 1,
    agnostic_engine_compose: 1,
    // "Not this" — the commitment ledger, v1. Subtractive only: it can remove a
    // place from consideration, never add or vouch for one. Omitted entirely
    // when empty so the default request is unchanged.
    ...(Array.isArray(excludedCandidateIds) && excludedCandidateIds.length
      ? { excluded_candidate_ids: [...excludedCandidateIds] }
      : {}),
    // "Keep this one" — selection-only, and omitted entirely when empty so the
    // default request is unchanged.
    ...(Array.isArray(pinnedCandidateIds) && pinnedCandidateIds.length
      ? { pinned_candidate_ids: [...pinnedCandidateIds] }
      : {}),
  };
}
