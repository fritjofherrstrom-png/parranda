"use strict";

/**
 * "Parranda chooses" — the engine picks the day's interests from evidence.
 *
 * Opt-in only. A request carries `intent_mode: "parranda_chooses"` when the
 * reader asked Parranda to choose; it is never inferred from empty
 * preferences, and explicit preferences always win over it.
 *
 * The inputs are what composition already trusts:
 *   - the no-preference role survey: the same gates, reach policy and
 *     opening-hours window the varied day is built from;
 *   - trusted local time (today only) and the remaining local-day window;
 *   - trusted weather;
 *   - a selected-day Live event the evening weave already admitted.
 *
 * Each pick names its reason codes and counts. Nothing here adds a place, an
 * hour or a source, and missing context removes its reasons, never the mode:
 * without weather the choice simply has no weather reason. Chosen interests
 * are ordinary planner preference keys, so taking over is the same request
 * with explicit picks.
 *
 * Pure / side-effect free.
 */

const { isRainyWeather, isPleasantWeather } = require("../candidates/fit-scorer");
const { normalizeUserIntents } = require("../candidates/intent-vocabulary");
const { preferenceFit } = require("./preference-focus");

const PARRANDA_CHOOSES = "parranda_chooses";

const DAYPARTS = Object.freeze(["morning", "midday", "afternoon", "evening", "late"]);

// The interests a reader can pick in the planner, with the planner role that
// serves each, whether it is mostly indoors, and the dayparts it belongs to.
// Order is the deterministic tie-break.
const CHOOSABLE_INTERESTS = Object.freeze([
  { key: "food", role: "food_anchor", indoor: true, dayparts: ["midday", "evening"] },
  { key: "fika", role: "coffee_fika_stop", indoor: true, dayparts: ["morning", "midday", "afternoon"] },
  { key: "culture", role: "culture_stop", indoor: true, dayparts: ["midday", "afternoon"] },
  { key: "green", role: "green_walk_stop", indoor: false, dayparts: ["morning", "midday", "afternoon"] },
  { key: "views", role: "scenic_anchor", indoor: false, dayparts: ["morning", "afternoon", "evening"] },
  { key: "second_hand", role: "vintage_second_hand_option", indoor: true, dayparts: ["midday", "afternoon"] },
  // A bar is an answer for tonight, not a plan for a whole day ahead.
  { key: "nightlife", role: "evening_bar_option", indoor: true, dayparts: ["evening", "late"], needsCurrentEvening: true },
]);

// Fewer than this many usable places does not make an interest a day can be
// built around; one place is an idea, not a direction.
const MIN_USABLE_PLACES = 2;
const STRONG_SUPPLY_PLACES = 4;
// The "free" rhythm's light-day floor: fewer eligible places than this is
// already a light day.
const LIGHT_DAY_PLACES = 4;
const TIME_EXCLUSIONS = new Set(["daypart_passed", "not_evening_yet", "needs_trusted_evening"]);

function normalizeIntentMode(value) {
  return typeof value === "string" && value.trim().toLowerCase() === PARRANDA_CHOOSES ? PARRANDA_CHOOSES : null;
}

/**
 * The "free" rhythm's day density: do not force a full day from sparse
 * eligible supply or the last hours of a trusted same-day window.
 */
function freeRhythmDayProfile({ candidateCount, remainingMinutes = null }) {
  const count = Number.isFinite(candidateCount) ? candidateCount : 0;
  const remaining = Number.isFinite(remainingMinutes) ? remainingMinutes : null;
  if (count < LIGHT_DAY_PLACES || (remaining !== null && remaining <= 180)) return "light";
  if (count < 6 || (remaining !== null && remaining <= 360)) return "variation";
  return "peak";
}

/**
 * Count what the survey can actually offer for one interest: places that
 * cover it (not merely adjacent), pass the role gates and are not closed for
 * the window. Counts are bounded by the survey's per-role depth.
 */
function summarizeInterestSupply(role, intent) {
  const candidates = Array.isArray(role?.candidates) ? role.candidates : [];
  const usable = candidates.filter((candidate) =>
    candidate?.planner_usable === true &&
    Array.isArray(candidate.covered_preferences) && candidate.covered_preferences.includes(intent) &&
    candidate.availability?.eligible !== false);
  const corroborated = usable.filter((candidate) => {
    const provenance = candidate.provenance || {};
    return provenance.human_verified === true ||
      provenance.corroborated_by_external === true ||
      Number(provenance.provenance_diversity) >= 2;
  });
  return {
    ids: usable.map((candidate) => String(candidate.candidate_id ?? "")).filter(Boolean),
    usable_count: usable.length,
    corroborated_count: corroborated.length,
    opening_hours_confirmed_count: usable.filter((candidate) => candidate.availability?.status === "available_in_window").length,
    single_source_only: usable.length > 0 && usable.every((candidate) => candidate.experimental_admission?.allowed === true),
  };
}

function weatherReading(weather) {
  if (!weather || typeof weather !== "object") return "unknown";
  if (isRainyWeather(weather)) return "rain";
  if (isPleasantWeather(weather)) return "pleasant";
  return "neutral";
}

/**
 * @param {object} params
 * @param {object} params.survey             selectPlannerRoleCandidates() for no preferences
 * @param {object|null} params.weather       trusted weather (never payload weather)
 * @param {string|null} params.timeBand      trusted local band, only for a today request
 * @param {boolean} params.timeAppliesToRequestedDate
 * @param {number|null} params.remainingMinutes trusted remaining local-day window
 * @param {object|null} params.liveEvent     selected-day evening event the weave admitted
 * @param {number} params.countedUpTo        the survey's per-role depth
 */
function chooseDayInterests({
  survey,
  weather = null,
  timeBand = null,
  timeAppliesToRequestedDate = false,
  remainingMinutes = null,
  liveEvent = null,
  countedUpTo = null,
} = {}) {
  const roles = new Map((Array.isArray(survey?.roles) ? survey.roles : []).map((role) => [role.role, role]));
  const weatherNow = weatherReading(weather);
  const band = timeAppliesToRequestedDate && DAYPARTS.includes(timeBand) ? timeBand : null;
  const remainingDayparts = band ? DAYPARTS.slice(DAYPARTS.indexOf(band)) : null;
  const liveFit = liveEvent ? preferenceFit(liveEvent).coveredPreferences : [];

  const considered = CHOOSABLE_INTERESTS.map((interest, order) => {
    const intent = normalizeUserIntents([interest.key]).intents[0];
    const supply = summarizeInterestSupply(roles.get(interest.role), intent);
    const reasons = [];
    let excluded = null;
    let score = 0;

    if (supply.usable_count < MIN_USABLE_PLACES) {
      excluded = supply.usable_count === 0 ? "no_usable_places" : "too_few_usable_places";
    } else if (interest.needsCurrentEvening && !(band === "evening" || band === "late")) {
      excluded = band ? "not_evening_yet" : "needs_trusted_evening";
    } else if (remainingDayparts && !interest.dayparts.some((part) => remainingDayparts.includes(part))) {
      excluded = "daypart_passed";
    }

    if (!excluded) {
      reasons.push(supply.usable_count >= STRONG_SUPPLY_PLACES ? "strong_local_supply" : "enough_local_supply");
      score += Math.min(supply.usable_count, STRONG_SUPPLY_PLACES) * 0.5;
      if (supply.corroborated_count > 0) {
        reasons.push("independently_corroborated");
        score += Math.min(supply.corroborated_count, 2) * 0.5;
      }
      if (supply.opening_hours_confirmed_count > 0) {
        reasons.push("open_in_window");
        score += 0.25;
      }
      if (supply.single_source_only) {
        reasons.push("single_source_only");
        score -= 0.5;
      }
      if (band && interest.dayparts.includes(band)) {
        reasons.push(`fits_${band}`);
        score += 1;
      }
      if (weatherNow === "rain") {
        reasons.push(interest.indoor ? "rain_favors_indoor" : "rain_penalizes_outdoor");
        score += interest.indoor ? 1 : -2;
      } else if (weatherNow === "pleasant" && !interest.indoor) {
        reasons.push("pleasant_weather_favors_outdoor");
        score += 0.75;
      }
      if (liveFit.includes(intent)) {
        reasons.push("matches_live_event_today");
        score += 0.5;
      }
      if (score <= 0) excluded = "unsuited_to_context";
    }

    return { interest, order, intent, supply, reasons, score, excluded };
  });

  // Rain leans the day indoors: an exposed interest is only a fallback for a
  // place with nothing indoor to offer.
  if (weatherNow === "rain" && considered.some((entry) => !entry.excluded && entry.interest.indoor)) {
    for (const entry of considered) {
      if (!entry.excluded && !entry.interest.indoor) entry.excluded = "rain_prefers_indoor";
    }
  }

  const qualifying = considered
    .filter((entry) => !entry.excluded)
    .sort((left, right) =>
      right.score - left.score ||
      right.supply.usable_count - left.supply.usable_count ||
      left.order - right.order);

  // Places the day could still use now: an interest ruled out by the hour
  // does not count as something the place offers today.
  const offeredIds = new Set(considered
    .filter((entry) => !TIME_EXCLUSIONS.has(entry.excluded))
    .flatMap((entry) => entry.supply.ids));

  // The same density rule as the "free" rhythm decides how many directions a
  // day can carry: a light day gets at most two.
  const pickBudget = freeRhythmDayProfile({ candidateCount: offeredIds.size, remainingMinutes });
  const maxPicks = pickBudget === "peak" ? 3 : 2;
  let chosen = qualifying.slice(0, maxPicks);

  // Choosing must never make the day smaller than the varied day would be.
  // One direction, or picks that together hold fewer places than a light day
  // needs, would narrow a place that offers more; keep the varied day then.
  const chosenIds = new Set(chosen.flatMap((entry) => entry.supply.ids));
  const offersMore = offeredIds.size > chosenIds.size;
  const tooNarrow = chosen.length > 0 && offersMore &&
    (chosen.length < 2 || chosenIds.size < Math.min(LIGHT_DAY_PLACES, offeredIds.size));
  if (tooNarrow) {
    for (const entry of chosen) entry.excluded = "too_narrow_for_the_day";
    chosen = [];
  }
  const chosenKeys = new Set(chosen.map((entry) => entry.interest.key));

  // Fewer picks for lack of places is thin supply. Fewer picks because the
  // hour or the weather ruled an interest out is an ordinary choice, and
  // not_chosen says why.
  const suppliedInterestCount = considered.filter((entry) => entry.supply.usable_count >= MIN_USABLE_PLACES).length;
  const status = tooNarrow
    ? "thin_supply"
    : chosen.length === 0
      ? "no_supported_interest"
      : chosen.length < maxPicks && suppliedInterestCount < maxPicks
        ? "thin_supply"
        : "chosen";
  const notes = [];
  if (chosen.length === 0) notes.push("varied_day_kept");
  if (tooNarrow) notes.push("too_few_places_to_focus");
  else if (status === "thin_supply") notes.push("fewer_interests_thin_supply");
  if (weatherNow === "unknown") notes.push("weather_unknown");
  if (!band) notes.push(timeAppliesToRequestedDate ? "time_unknown" : "planned_without_current_time");

  return {
    mode: PARRANDA_CHOOSES,
    status,
    preferences: chosen.map((entry) => entry.interest.key),
    auto_intents: chosen.map((entry) => ({
      intent: entry.interest.key,
      reasons: entry.reasons,
      evidence: {
        usable_count: entry.supply.usable_count,
        corroborated_count: entry.supply.corroborated_count,
        opening_hours_confirmed_count: entry.supply.opening_hours_confirmed_count,
        ...(Number.isFinite(countedUpTo) ? { counted_up_to: countedUpTo } : {}),
      },
    })),
    not_chosen: considered
      .filter((entry) => !chosenKeys.has(entry.interest.key))
      .map((entry) => ({
        intent: entry.interest.key,
        reason: entry.excluded || "lower_ranked",
        usable_count: entry.supply.usable_count,
      })),
    context: {
      time_band: band,
      remaining_minutes: Number.isFinite(remainingMinutes) ? remainingMinutes : null,
      weather: weatherNow,
      live_event: liveEvent ? "available" : "none",
      pick_budget: pickBudget,
    },
    notes,
  };
}

/**
 * The public block: the choice as decided, plus what composition did with it.
 */
function publishInterestChoice(choice, { fellBack = null, liveEventWoven = null } = {}) {
  if (!choice) return null;
  const { preferences: _internal, ...block } = choice;
  return {
    ...block,
    ...(fellBack ? { status: "focus_fell_back_to_varied_day", fallback_reason: fellBack } : {}),
    context: {
      ...block.context,
      // "woven" or "offered" only when composition knows; otherwise the event
      // stays "available" and the response layer decides.
      live_event: block.context.live_event !== "available" ? "none"
        : liveEventWoven === true ? "woven"
          : liveEventWoven === false ? "offered"
            : "available",
    },
    notes: fellBack ? [...block.notes, "varied_day_kept"] : block.notes,
  };
}

function ignoredForExplicitPreferences() {
  return {
    mode: PARRANDA_CHOOSES,
    status: "ignored_explicit_preferences",
    auto_intents: [],
    not_chosen: [],
    context: null,
    notes: ["explicit_preferences_win"],
  };
}

module.exports = {
  CHOOSABLE_INTERESTS,
  MIN_USABLE_PLACES,
  PARRANDA_CHOOSES,
  chooseDayInterests,
  freeRhythmDayProfile,
  ignoredForExplicitPreferences,
  normalizeIntentMode,
  publishInterestChoice,
};
