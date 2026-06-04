/**
 * Candidate Intelligence Spine — fit scorer v1 (small but real).
 *
 * Turns a gate-eligible candidate + the user's normalized intents + light
 * context into a fit decomposition. Philosophy (matches the spine rules):
 *
 *   - INTENT coverage is primary. It is scored as `intent_base`, and the
 *     orchestrator sorts lexicographically by coverage tier FIRST, so a
 *     candidate that covers a requested intent can never be out-ranked by one
 *     that does not, no matter how favorable its context.
 *   - ROUTE / TIME / WEATHER are BOUNDED modifiers that only tilt ordering
 *     WITHIN a coverage tier. Their combined magnitude is capped below a single
 *     intent increment, so context can break ties but never dominate fit.
 *   - MOMENT (live) stays neutral in v1. LOCAL is a tag-based experience-lens
 *     tilt v1 — not a full "locals know best" ranker.
 *
 * Pure / side-effect free.
 */

const { createFitDecomposition } = require("./fit");
const { normalizeLens } = require("./lens");
const { matchCandidateToIntent, candidateModifiers, STRONG_MATCH } = require("./intent-vocabulary");

const CONTEXT_CAP = 0.9; // total context tilt magnitude — strictly < STRONG_MATCH (2.0)

const INDOOR_TYPES = new Set([
  "museum", "church", "gallery", "library", "market", "event_market", "restaurant",
  "pizza", "street-food", "bakery", "cafe", "café", "bar", "wine-bar", "cocktail-bar",
  "vintage-shop", "shop", "cinema", "theatre",
]);
const EXPOSED_TYPES = new Set([
  "viewpoint", "beach", "promenade", "park", "garden", "bridge", "square",
  "rooftop-bar", "castle", "landmark",
]);

const TIME_BAND_TOKENS = new Set(["morning", "midday", "afternoon", "evening", "late", "golden-hour"]);

/**
 * @param {object} params
 * @param {object} params.candidate    normalized place candidate
 * @param {string[]} params.userIntents canonical intents requested
 * @param {string[]} [params.userModifiers] canonical modifiers requested
 * @param {object} [params.context]    { timeBand, weather, origin, lens }
 * @returns {object} fit decomposition + coverage + reasons
 */
function scoreCandidateFit({ candidate, userIntents = [], userModifiers = [], context = {} } = {}) {
  const normalizedLens = normalizeLens(context.lens);
  const normalizedContext = { ...context, lens: normalizedLens };
  const decomposition = createFitDecomposition({ lens: normalizedLens });
  const reasons = [];

  // --- INTENT (primary) -----------------------------------------------------
  const covered = [];
  const partial = [];
  const missing = [];
  let intentBase = 0;
  for (const intent of userIntents) {
    const m = matchCandidateToIntent(candidate, intent);
    intentBase += m.strength;
    if (m.level === "strong") {
      covered.push(intent);
      reasons.push(`covers:${intent}(${m.reason})`);
    } else if (m.level === "weak") {
      partial.push(intent);
      reasons.push(`partial:${intent}`);
    } else {
      missing.push(intent);
    }
  }
  if (!userIntents.length) {
    // No requested intents → a neutral general-move base so eligible candidates
    // still rank by context/quality.
    intentBase = 0.5;
    reasons.push("general_next_move");
  }
  setDim(decomposition, "intent", intentBase, reasons.filter((r) => /^(covers|partial|general)/.test(r)));

  // --- ROUTE (kind suitability + proximity) ---------------------------------
  const route = scoreRoute(candidate, normalizedContext, reasons);
  setDim(decomposition, "route", route.score, route.reasons);

  // --- TIME -----------------------------------------------------------------
  const time = scoreTime(candidate, normalizedContext, userModifiers, reasons);
  setDim(decomposition, "time", time.score, time.reasons);

  // --- WEATHER --------------------------------------------------------------
  const weather = scoreWeather(candidate, normalizedContext, userModifiers, reasons);
  setDim(decomposition, "weather", weather.score, weather.reasons);

  // moment stays neutral in v1
  setDim(decomposition, "moment", 0, []);

  // --- LOCAL (experience lens) ---------------------------------------------
  // The lens reweights which PLACES rise, from the same candidate set. v2:
  // additive lifts only (never penalties) so it tilts within a coverage tier
  // and never drags curated below a comparably-fitting candidate (#235).
  const lens = scoreLens(candidate, normalizedContext);
  setDim(decomposition, "local", lens.score, lens.reasons.length ? lens.reasons : ["lens_neutral"]);

  // Context is bounded so it can only tilt within a coverage tier.
  const rawContext = route.score + time.score + weather.score + lens.score;
  const contextTotal = clamp(rawContext, -CONTEXT_CAP, CONTEXT_CAP);

  const primaryScore = round(intentBase + contextTotal);
  decomposition.primary_score = primaryScore;
  decomposition.implemented = true;

  const intentMatch = userIntents.length
    ? covered.length
      ? "covered"
      : partial.length
        ? "partial"
        : "none"
    : "general";

  return {
    ...decomposition,
    intent_base: round(intentBase),
    context_total: round(contextTotal),
    covered_preferences: covered,
    partial_preferences: partial,
    missing_preferences: missing,
    intent_match: intentMatch,
    // coverage key the orchestrator sorts on (covered first, then partial)
    coverage_rank: [covered.length, partial.length],
    reasons,
  };
}

function scoreRoute(candidate, context, reasons) {
  const localReasons = [];
  let score = 0;
  if (candidate.candidate_kind === "real_place") {
    score += 0.3;
    localReasons.push("real_place");
  }
  if ((candidate.route_roles || []).includes("catalog_stop")) {
    score += 0.1;
  }
  // proximity, if we have both origin and candidate coordinates
  const origin = context.origin;
  if (
    origin &&
    Number.isFinite(origin.lat) &&
    Number.isFinite(origin.lng) &&
    Number.isFinite(candidate.lat) &&
    Number.isFinite(candidate.lng)
  ) {
    const km = haversineKm(origin.lat, origin.lng, candidate.lat, candidate.lng);
    if (km <= 0.6) {
      score += 0.5;
      localReasons.push(`very_near_${km.toFixed(2)}km`);
    } else if (km <= 1.5) {
      score += 0.25;
      localReasons.push(`near_${km.toFixed(2)}km`);
    } else if (km > 3) {
      score -= 0.3;
      localReasons.push(`far_${km.toFixed(1)}km`);
    }
  }
  return { score: clamp(score, -0.3, 0.8), reasons: localReasons };
}

function scoreTime(candidate, context, userModifiers, reasons) {
  const band = context.timeBand;
  const localReasons = [];
  let score = 0;
  const timeFit = new Set((candidate.time_fit || []).map((t) => String(t).toLowerCase()));
  const bandTokens = [...timeFit].filter((t) => TIME_BAND_TOKENS.has(t));

  if (band && bandTokens.includes(band)) {
    score += 0.4;
    localReasons.push(`time_match:${band}`);
  } else if (timeFit.has("golden-hour") && ["afternoon", "evening"].includes(band)) {
    score += 0.3;
    localReasons.push("golden_hour_window");
  } else if (bandTokens.length) {
    score -= 0.2;
    localReasons.push(`time_mismatch:${band}`);
  }

  // requested sunset/golden_hour modifier honored when the candidate has it
  if ((userModifiers.includes("sunset") || userModifiers.includes("golden_hour")) &&
    candidateModifiers(candidate).some((m) => m === "sunset" || m === "golden_hour")) {
    score += 0.3;
    localReasons.push("requested_golden_hour");
  }

  return { score: clamp(score, -0.3, 0.6), reasons: localReasons };
}

function scoreWeather(candidate, context, userModifiers, reasons) {
  const weather = context.weather;
  const localReasons = [];
  if (!weather || typeof weather !== "object") {
    return { score: 0, reasons: [] };
  }
  const type = String(candidate.type || "").toLowerCase();
  const indoor = INDOOR_TYPES.has(type);
  const exposed = EXPOSED_TYPES.has(type);
  const rainy = weather.condition === "rain" || Number(weather.precipitationProbabilityMax) >= 60;
  const sunny = weather.condition === "sun" || weather.pleasant === true;
  let score = 0;

  if (rainy) {
    if (indoor) {
      score += 0.4;
      localReasons.push("rain_favors_indoor");
    } else if (exposed) {
      score -= 0.4;
      localReasons.push("rain_penalizes_exposed");
    }
  } else if (sunny && exposed) {
    score += 0.4;
    localReasons.push("sun_favors_scenic");
  }

  if (weather.hot === true) {
    if (type === "beach") {
      score += 0.3;
      localReasons.push("hot_favors_swim");
    } else if (type === "viewpoint") {
      score -= 0.2;
      localReasons.push("hot_penalizes_shadeless");
    }
  }

  // waterfront request honored
  if (userModifiers.includes("waterfront") && candidateModifiers(candidate).includes("waterfront")) {
    score += 0.2;
    localReasons.push("requested_waterfront");
  }

  return { score: clamp(score, -0.5, 0.5), reasons: localReasons };
}

// Legibility signals: clearly iconic types + "classic/landmark" tags. Tourist
// lenses lift these; local lenses leave them flat (relative softening).
const LEGIBLE_TYPES = new Set([
  "landmark", "castle", "basilica", "cathedral", "monument", "palace", "ruins",
]);
const LEGIBLE_TAGS = new Set([
  "klassiker", "classic", "iconic", "turist", "tourist", "landmark", "must-see", "must see", "dolce-vita",
]);
// Localness signals: neighborhood / everyday / under-surfaced. Local + rediscover
// lenses lift these.
const LOCAL_TAGS = new Set([
  "lokalt", "local", "hidden gems", "hidden-gems", "hidden_gems", "low-key", "lowkey",
  "hippt", "neighbourhood", "neighborhood", "kiez", "kvarter", "vardag",
]);

/**
 * Experience-lens fit (v1): bounded, ADDITIVE-ONLY reweighting of which places
 * rise. No penalties — a candidate with no legibility/localness signal scores 0,
 * so local mode never "blindly rewards obscurity" and tourist mode never punishes
 * neighborhood stops; defaults are softened only relatively. Returns 0 for
 * balanced / no lens (so default behavior is unchanged).
 *
 * @returns {{ score: number, reasons: string[] }}
 */
function scoreLens(candidate, context) {
  const lens = normalizeLens(context?.lens);
  if (!lens || lens === "balanced") return { score: 0, reasons: [] };

  const type = String(candidate?.type || "").toLowerCase();
  const tags = new Set((candidate?.tags || []).map((t) => String(t).toLowerCase().trim()));
  const legible = LEGIBLE_TYPES.has(type) || hasAny(tags, LEGIBLE_TAGS);
  const local = hasAny(tags, LOCAL_TAGS);

  const reasons = [];
  let score = 0;

  if (lens === "first_time") {
    if (legible) {
      score += 0.4;
      reasons.push("lens_first_time_classic");
    }
  } else if (lens === "local" || lens === "rediscover") {
    if (local) {
      score += 0.4;
      reasons.push("lens_local_neighborhood");
    }
  } else if (lens === "surprise") {
    if (local) {
      score += 0.3;
      reasons.push("lens_surprise_offbeat");
    }
  }

  return { score: clamp(score, -0.5, 0.5), reasons };
}

function hasAny(set, candidates) {
  for (const value of candidates) if (set.has(value)) return true;
  return false;
}

function setDim(decomposition, key, score, dimReasons) {
  if (decomposition.dimensions[key]) {
    decomposition.dimensions[key].score = round(score);
    decomposition.dimensions[key].reasons = dimReasons || [];
  }
}

function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function toRad(deg) {
  return (deg * Math.PI) / 180;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function round(value) {
  return Number(value.toFixed(3));
}

module.exports = {
  scoreCandidateFit,
  CONTEXT_CAP,
  STRONG_MATCH,
};
