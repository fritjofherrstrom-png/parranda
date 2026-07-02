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

export function buildAnywherePayload({ place, dates, preferences = [], walkingKmTarget = 6 } = {}) {
  const autoPoint = { type: "auto", label: "Parranda väljer" };
  return {
    place,
    place_query: place,
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
  };
}
