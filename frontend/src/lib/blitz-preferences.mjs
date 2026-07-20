import { ANYWHERE_PREFERENCES } from "./anywhere-payload.mjs";

const ALLOWED_PREFERENCES = new Set(ANYWHERE_PREFERENCES.map((preference) => preference.key));

export const BLITZ_PREFERENCE_BUNDLES = Object.freeze([
  Object.freeze({ id: "food_stroll", preferences: Object.freeze(["food", "fika", "green"]) }),
  Object.freeze({ id: "culture_walk", preferences: Object.freeze(["culture", "views", "green"]) }),
  Object.freeze({ id: "city_evening", preferences: Object.freeze(["food", "culture", "nightlife"]) }),
  Object.freeze({ id: "local_find", preferences: Object.freeze(["second_hand", "culture", "fika"]) }),
  Object.freeze({ id: "slow_local", preferences: Object.freeze(["second_hand", "fika", "green"]) }),
  Object.freeze({ id: "sunset_city", preferences: Object.freeze(["views", "food", "nightlife"]) }),
]);

function preferenceKey(preferences = []) {
  return [...new Set(preferences.filter((preference) => ALLOWED_PREFERENCES.has(preference)))]
    .sort()
    .join("|");
}

export function chooseBlitzPreferences({ previous = [], random = Math.random } = {}) {
  const previousKey = preferenceKey(previous);
  const alternatives = BLITZ_PREFERENCE_BUNDLES.filter(
    (bundle) => preferenceKey(bundle.preferences) !== previousKey,
  );
  const candidates = alternatives.length > 0 ? alternatives : BLITZ_PREFERENCE_BUNDLES;
  const sampled = typeof random === "function" ? Number(random()) : 0;
  const bounded = Number.isFinite(sampled) ? Math.min(Math.max(sampled, 0), 0.999999) : 0;
  const selected = candidates[Math.floor(bounded * candidates.length)] || candidates[0];
  return selected ? [...selected.preferences] : [];
}
