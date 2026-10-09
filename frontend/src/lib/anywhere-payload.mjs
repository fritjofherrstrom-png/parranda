/**
 * Pure payload builder for the any-city planner — mirrors the production
 * anywhere-mode request (script.js planRoutesAnywhere) so the new frontend and
 * the current app speak the SAME API contract:
 *   - freeform `place` + agnostic flags for any-place intake;
 *   - registered-city labels use the same freeform intake and nearby curated supply.
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

/**
 * Freeze the local calendar date for one compose intent.
 *
 * Silent cold-cache/live follow-ups may run after midnight. They still answer
 * the original question, so an internal override wins over a newly-read clock.
 */
export function freezeComposeDateIso({ dayOffset = 0, dateIsoOverride = null, now = new Date() } = {}) {
  const override = typeof dateIsoOverride === "string" ? dateIsoOverride.trim() : "";
  return /^\d{4}-\d{2}-\d{2}$/.test(override)
    ? override
    : isoDateFromOffset(dayOffset, now);
}

// Day density, not a walking-distance goal. Distance is measured afterwards.
// Three steps of one scale (calm < balanced < full) and "free", which is not a
// fourth step: the reader leaves the choice to Parranda. Each `note` says what
// the engine does with it — "free" adapts to eligible supply and trusted time.
export const DAY_RHYTHMS = [
  { key: "calm", sv: "Lugn", en: "Easy", noteSv: "Färre stopp, mer tid på varje plats.", noteEn: "Fewer stops, more time at each place." },
  { key: "balanced", sv: "Lagom", en: "Balanced", noteSv: "Några stopp med luft emellan.", noteEn: "A few stops with room in between." },
  { key: "full", sv: "Fylld", en: "Full", noteSv: "Så många stopp som dagen rymmer.", noteEn: "As many stops as the day holds." },
  { key: "free", sv: "Parranda väljer", en: "Parranda chooses", noteSv: "Anpassar rytmen efter möjliga stopp och tiden som finns.", noteEn: "Adapts the rhythm to usable stops and the time available." },
];

export function buildAnywherePayload({
  city,
  place,
  coords,
  placeSelection,
  placeBias,
  placeContextSelection,
  placeRef,
  dates,
  preferences = [],
  dayRhythm = "balanced",
  excludedCandidateIds = [],
  pinnedCandidateIds = [],
} = {}) {
  const autoPoint = { type: "auto", label: "Parranda väljer" };
  // Two exclusive anchor modes, mirroring the engine's intake precedence:
  //  - coords ("near me now"): top-level lat/lng — explicit coords WIN in the
  //    agnostic intake (parseBlitzCoordinates), and no place text is sent;
  //  - place (typed city): freeform text only, never a recognized city key.
  // A legacy city key is text only at this UI boundary. Public citypack
  // selection no longer bypasses any-place intake, preferences or trust gates.
  const anchor = coords && Number.isFinite(coords.lat) && Number.isFinite(coords.lng)
    ? { lat: coords.lat, lng: coords.lng }
    : { place: place || city, place_query: place || city };
  const rhythm = DAY_RHYTHMS.some(({ key }) => key === dayRhythm) ? dayRhythm : "balanced";
  return {
    ...anchor,
    ...(!coords ? {
      ...(placeSelection ? { place_selection: placeSelection } : {}),
      ...(typeof placeRef === "string" && placeRef ? { place_ref: placeRef } : {}),
      ...(placeBias ? { place_bias: placeBias } : {}),
      ...(placeContextSelection ? { place_context_selection: placeContextSelection } : {}),
    } : {}),
    dates,
    home_base: autoPoint,
    start: autoPoint,
    end: autoPoint,
    day_rhythm: rhythm,
    ...(rhythm === "free" ? {} : { leg_pacing: "balanced" }),
    preferences,
    distance_mode: "no_limit",
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
