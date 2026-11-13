/**
 * ONE STATE WHEN NO DAY COULD BE COMPOSED.
 *
 * A resolved place can end without a day for several reasons at once: the
 * reader's picks found no walkable day, a place source failed, or the supply
 * was too thin. Each used to render its own card, so one answer read as four
 * contradicting ones. This module picks the single cause the page states, and
 * the single next step it offers. It reads verdicts the planner already
 * derived from server evidence; it never infers a new one.
 *
 * Priority, highest first:
 *   1. interests — the picks were tried against places that did load, and no
 *      walkable day covered them. A total outage never tested the picks, so it
 *      is never blamed on them.
 *   2. sources   — a place source failed or did not answer.
 *   3. supply    — anything else: too few places, or places but no route.
 *
 * Only a source failure offers Try again: retrying the same question cannot
 * change an interest verdict or the place's supply.
 */

/** @typedef {"interests" | "sources" | "supply"} NoDayCause */
/** @typedef {"edit_interests" | "retry" | "restart" | null} NoDayAction */

/**
 * @param {object} input
 * @param {boolean} input.settled              a resolved place, finished, with no day on screen and nothing pending
 * @param {boolean} input.interestsUnconfirmed the planner's own verdict: no route stop covered any pick
 * @param {boolean} input.sourcesUnanswered    every place source failed, so no place was loaded to test the picks
 * @param {boolean} input.sourceFailed         a place source failed or did not answer (total or partial)
 * @param {boolean} input.canRebuild           the page may ask the same question again (false for an unsafe saved day)
 * @param {boolean} input.hasPicks             the reader has interests to edit
 * @returns {{ cause: NoDayCause, action: NoDayAction } | null}
 */
export function noDayState({
  settled,
  interestsUnconfirmed,
  sourcesUnanswered,
  sourceFailed,
  canRebuild,
  hasPicks,
}) {
  if (!settled) return null;
  const cause = interestsUnconfirmed && !sourcesUnanswered
    ? "interests"
    : sourceFailed || sourcesUnanswered
      ? "sources"
      : "supply";
  if (!canRebuild) return { cause, action: "restart" };
  if (cause === "sources") return { cause, action: "retry" };
  return { cause, action: hasPicks ? "edit_interests" : null };
}

// The loader names a few intents in its own vocabulary; the district surface
// and the reader's picks use the planner's (server/candidates/district-composition.js).
const LOADER_TO_PLANNER = {
  scenic: "views",
  museums: "culture",
  coffee: "fika",
  bars: "nightlife",
  vintage: "second_hand",
  markets: "market",
};

const plannerKey = (key) => LOADER_TO_PLANNER[key] || key;

/**
 * The district surface's "missing" intents, minus any the engine's loader
 * found places for. The district list can be empty for reasons other than
 * absence (a failed source, no walkable cluster); the loader's profile is the
 * evidence of what was actually found. An intent it covered, even partly, is
 * never called absent.
 *
 * @param {unknown} missingIntents  place_structure.district_day.missing_intents
 * @param {any} sourceStatus        agnostic_route_output_experiment.source_status
 * @returns {string[]}
 */
export function evidencedMissingIntents(missingIntents, sourceStatus) {
  if (!Array.isArray(missingIntents)) return [];
  const profile = sourceStatus?.collection?.selected_profile;
  const found = new Set(
    [profile?.requested_intents_covered, profile?.requested_intents_partial]
      .flatMap((list) => (Array.isArray(list) ? list : []))
      .filter((key) => typeof key === "string")
      .map(plannerKey),
  );
  return [...new Set(missingIntents.filter((key) => typeof key === "string" && key && !found.has(plannerKey(key))))];
}
