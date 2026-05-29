const { AsyncLocalStorage } = require("node:async_hooks");
const { getCityConfig, resolveCityConfig } = require("./cities");
const {
  classifyRuntimeReadiness,
  buildUnsupportedCityResult,
} = require("./city-readiness/runtime-readiness");
const { getIsoWeekday } = require("./lib/iso-date");
const { evaluateLocalTruth, localTruthForLang } = require("./local-truth");
const {
  buildRepeatPressure,
  routeNoveltyScore,
  routeSimilarity,
} = require("./route-diversity");
const { routeWalkingPath } = require("./walking-router");

const defaultCityConfig = getCityConfig("rome");
const cityContextStorage = new AsyncLocalStorage();

function getActiveCityConfig() {
  return cityContextStorage.getStore() || defaultCityConfig;
}

function getActiveCatalog() {
  return getActiveCityConfig().catalog;
}

function getAllItems() {
  return getActiveCatalog().allItems;
}

function findCatalogItemByName(name) {
  return getActiveCatalog().findItemByName(name);
}

function getRouteTemplates() {
  return getActiveCatalog().routeTemplates;
}

// Provisional source candidates live on the city config OUTSIDE `catalog` so
// they can never be mistaken for verified items. Each is mapped to a
// catalog-item-shaped stop that carries a `provisional: true` marker plus its
// source/trust/provenance, which ride through buildStopPool ordering into
// formatMainStop so the honesty signal survives to the API response.
function getSourceCandidates() {
  const candidates = getActiveCityConfig().sourceCandidates;
  return Array.isArray(candidates) ? candidates : [];
}

function buildProvisionalComposeStops() {
  return getSourceCandidates()
    .filter((candidate) => candidate && Number.isFinite(candidate.lat) && Number.isFinite(candidate.lng))
    .map((candidate) => ({
      id: candidate.id,
      name: candidate.label,
      kind: candidate.type,
      lat: candidate.lat,
      lng: candidate.lng,
      area: candidate.area,
      tags: Array.isArray(candidate.tags) ? candidate.tags : [],
      weatherTags: Array.isArray(candidate.provenance?.weatherTags)
        ? candidate.provenance.weatherTags
        : [],
      searchTerms: [],
      anchorWeight: 1,
      provisional: true,
      source: candidate.source || null,
      trust: candidate.trust || null,
      provenance: candidate.provenance || null,
    }));
}

const AGNOSTIC_COMPOSE_TEMPLATE_ID = "__agnostic_compose__";

// When a registered city has zero curated route templates (a "thin" citypack
// such as the Athens preview skeleton) we still want an honest, low-confidence
// walk built ENTIRELY from that city's own real catalog items — never a
// fallback city's geography, never invented places. buildStopPool already
// seeds its candidate pool from getAllItems() + geometry, so a neutral,
// place-less template is enough to drive the existing pipeline generically.
// The template carries no stops of its own; every real stop comes from the
// active catalog.
function buildAgnosticComposeTemplate(targetKm) {
  return {
    id: AGNOSTIC_COMPOSE_TEMPLATE_ID,
    title: "",
    summary: "",
    stops: [],
    defaultKm: Number.isFinite(targetKm) ? targetKm : 6,
    preferenceTags: [],
    optimizerModes: [],
    weatherProfile: {},
    weekdayBoost: {},
    vibeProfile: {},
    hiddenMentions: [],
    barMentions: [],
  };
}

function markAgnosticComposeRoute(route) {
  if (route && typeof route === "object") {
    route.routing_source = "agnostic_compose";
    route.confidence = "low";
  }
  return route;
}

function findCatalogItemByIdOrName(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  return (
    getAllItems().find((item) => String(item.id || "").toLowerCase() === normalized) ||
    findCatalogItemByName(value)
  );
}

function getCityCenter() {
  return getActiveCityConfig().center;
}

function buildCityCenterPoint(source = "default") {
  const center = getCityCenter();
  const cityLabel = getActiveCityConfig().label || "Staden";

  return {
    label: cityLabel,
    lat: center.lat,
    lng: center.lng,
    source,
  };
}

function getFallbackLabel() {
  return getActiveCityConfig().fallbackLabel || "Centro Storico";
}

async function geocodeInActiveCity(query) {
  return getActiveCityConfig().services.geocodeQuery(query);
}

function getPulseForDate(date, lang) {
  return getActiveCityConfig().services.getCityPulse(date, { lang });
}

function getDateSignalsForDate(date, lang = "sv") {
  return getActiveCityConfig().services.getDateSignals(date, lang);
}

async function fetchWeatherForActiveCity(dates, anchor) {
  return getActiveCityConfig().services.fetchWeatherForDates(dates, anchor);
}

async function fetchLiveEventsForActiveCity(dates, options) {
  return getActiveCityConfig().services.fetchLiveEventsForDates(dates, options);
}

function getWalkingConfig() {
  return getActiveCityConfig().walking || {};
}

function getRoutingConfig() {
  return getActiveCityConfig().routing || {};
}

function getAreaDefinitions() {
  return getRoutingConfig().areaDefinitions || {};
}

function getMacroAreaLabels() {
  return getRoutingConfig().macroAreaLabels || {};
}

function getRoutingTuning() {
  return getRoutingConfig().tuning || {};
}

function haversineKm(a, b) {
  const toRad = (value) => (value * Math.PI) / 180;
  const earthRadiusKm = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const hav =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;

  return 2 * earthRadiusKm * Math.atan2(Math.sqrt(hav), Math.sqrt(1 - hav));
}

function walkingKm(points) {
  if (points.length < 2) {
    return 0;
  }

  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    total += haversineKm(points[index - 1], points[index]) * 1.22;
  }
  return Number(total.toFixed(1));
}

const legPacingConfig = {
  short: {
    preferredMaxKm: 0.95,
    overflowWeight: 4.1,
    varianceWeight: 2.6,
    lateralWeight: 1.35,
    radiusBonusWeight: 1.3,
  },
  balanced: {
    preferredMaxKm: 1.35,
    overflowWeight: 2.7,
    varianceWeight: 1.7,
    lateralWeight: 1,
    radiusBonusWeight: 1,
  },
  flexible: {
    preferredMaxKm: 2.05,
    overflowWeight: 1.35,
    varianceWeight: 0.9,
    lateralWeight: 0.8,
    radiusBonusWeight: 0.72,
  },
};

const routeContinuityConfig = {
  short: {
    reportMaxKm: 1.8,
    bridgeMaxKm: 1.9,
    deadWalkWeight: 3.8,
    severeLegKm: 2.7,
  },
  balanced: {
    reportMaxKm: 3.1,
    bridgeMaxKm: 3.1,
    deadWalkWeight: 2.9,
    severeLegKm: 4.2,
  },
  flexible: {
    reportMaxKm: 3.8,
    bridgeMaxKm: Number.POSITIVE_INFINITY,
    deadWalkWeight: 0.7,
    severeLegKm: 5.6,
  },
};

function normalizeLegPacing(value) {
  return legPacingConfig[value] ? value : "balanced";
}

function getRouteContinuityConfig(legPacing = "balanced") {
  return routeContinuityConfig[normalizeLegPacing(legPacing)];
}

function estimatedWalkMinutes(distanceKm) {
  if (!Number.isFinite(distanceKm)) {
    return null;
  }

  return Math.max(2, Math.round(distanceKm * 12));
}

function weekdayFromDate(dateString) {
  return getIsoWeekday(dateString);
}

function expandDateRange(dates) {
  if (!Array.isArray(dates) || !dates.length) {
    return [];
  }

  const unique = [...new Set(dates)].sort();
  return unique;
}

async function resolvePoint(input, fallbackLabel = getFallbackLabel()) {
  if (!input || !input.type) {
    const fallback = findCatalogItemByName(fallbackLabel);
    if (!fallback) {
      return buildCityCenterPoint("default");
    }
    return {
      label: fallback.name,
      lat: fallback.lat,
      lng: fallback.lng,
      source: "default",
    };
  }

  if (
    input.type === "current_location" &&
    typeof input.lat === "number" &&
    typeof input.lng === "number"
  ) {
    return {
      label: input.label || "Nuvarande plats",
      lat: input.lat,
      lng: input.lng,
      source: "current_location",
    };
  }

  if (input.type === "preset" && input.label) {
    const found = findCatalogItemByName(input.label);
    if (found) {
      return {
        label: found.name,
        lat: found.lat,
        lng: found.lng,
        source: "preset",
      };
    }
  }

  if (input.type === "custom" || input.query) {
    if (typeof input.lat === "number" && typeof input.lng === "number") {
      return {
        label: input.label || input.query || "Vald plats",
        lat: input.lat,
        lng: input.lng,
        source: "custom",
      };
    }

    const candidates = await geocodeInActiveCity(input.query || input.label);
    if (candidates[0]) {
      return {
        label: candidates[0].label,
        lat: candidates[0].lat,
        lng: candidates[0].lng,
        source: candidates[0].source,
      };
    }
  }

  const fallback = findCatalogItemByName(fallbackLabel);
  if (!fallback) {
    return buildCityCenterPoint("default");
  }
  return {
    label: fallback.name,
    lat: fallback.lat,
    lng: fallback.lng,
    source: "default",
  };
}

function kmScore(estimatedKm, targetKm, distanceMode = "soft_target") {
  if (distanceMode === "no_limit") {
    return 1;
  }

  const diff = Math.abs(estimatedKm - targetKm);
  if (diff <= 1) {
    return 6;
  }
  if (diff <= 2.5) {
    return 3;
  }
  if (diff <= 4) {
    return 1;
  }
  return -2;
}

function preferenceScore(route, preferences) {
  return preferences.reduce((score, preference) => {
    if (route.preferenceTags.includes(preference)) {
      return score + 3;
    }
    return score;
  }, 0);
}

function priceLevelWeight(level) {
  if (!level) {
    return 2;
  }

  if (level === "gratis") {
    return 0;
  }

  if (level === "gratis eller låg avgift") {
    return 0.5;
  }

  if (level === "$") {
    return 1;
  }

  if (level === "$$") {
    return 2;
  }

  if (level === "$$$") {
    return 3;
  }

  return 2;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

const modifierToOptimizerMode = {
  evening: "evening-mode",
  culture: "culture-mode",
  low_key: "low-key-mode",
  party: "party-mode",
};

const strictPreferenceFamilies = new Set([
  "second_hand",
  "kyrkor",
  "pizza",
  "cocktail",
  "öl",
  "vin",
  "mat",
  "utsikt",
]);

const strictPreferenceSupportTags = new Set([
  "hidden gems",
  "kultur",
  "kväll",
  "lokalt",
  "low-key",
  "party",
  "budget",
  "nattliv",
  "vintage",
  "shopping",
  "market",
  "event_market",
  "antique",
  "antiques",
]);

const secondHandFamilyTags = new Set([
  "second_hand",
  "vintage",
  "shopping",
  "market",
  "event_market",
  "antique",
  "antiques",
]);

const intentFamilyMatchers = new Map([
  ["second_hand", secondHandFamilyTags],
  ["food_drink", new Set(["mat", "vin", "öl", "cocktail", "pizza"])],
  ["nightlife", new Set(["nattliv", "kväll", "party", "cocktail", "öl", "vin"])],
  ["culture", new Set(["kultur", "kyrkor", "klassiker"])],
  ["hidden_gems", new Set(["hidden gems", "low-key"])],
  ["views", new Set(["utsikt"])],
]);

const barRelevantIntentFamilies = new Set(["food_drink", "nightlife"]);
const hiddenRelevantIntentFamilies = new Set(["hidden_gems", "culture", "views"]);

const nightlifeExplicitPreferences = new Set(["nattliv", "kväll", "party", "nightlife", "evening"]);
const nightlifeExplicitOptimizers = new Set(["bar-hop", "cocktail-night", "evening-mode", "party-mode"]);
const nightlifeExplicitModifiers = new Set(["evening", "party"]);

function isNightlifeExplicit(preferences = [], optimizerMode = null, modifier = null) {
  if (preferences.some((p) => nightlifeExplicitPreferences.has(p))) return true;
  if (nightlifeExplicitOptimizers.has(optimizerMode)) return true;
  if (nightlifeExplicitModifiers.has(normalizeModifier(modifier, optimizerMode))) return true;
  return false;
}

const nightlifeDominantTags = new Set(["nattliv", "party"]);

const optimizerStrictPreferenceTags = {
  "church-crawl": ["kyrkor"],
  "pizza-freak": ["pizza"],
  "sunset-spots": ["utsikt"],
};

function normalizeBudgetTier(preferences = [], optimizerMode = null, budgetTier = "standard") {
  if (budgetTier === "budget" || budgetTier === "dolce-vita") {
    return budgetTier;
  }

  if (preferences.includes("budget") || optimizerMode === "budget-mode") {
    return "budget";
  }

  return "standard";
}

function normalizeModifier(modifier = null, optimizerMode = null) {
  if (modifier && modifierToOptimizerMode[modifier]) {
    return modifier;
  }

  const legacyModeMap = {
    "evening-mode": "evening",
    "culture-mode": "culture",
    "low-key-mode": "low_key",
    "party-mode": "party",
  };

  return legacyModeMap[optimizerMode] || null;
}

function resolveStrictPreferenceTags(preferences = [], optimizerMode = null) {
  if (optimizerStrictPreferenceTags[optimizerMode]) {
    return optimizerStrictPreferenceTags[optimizerMode];
  }

  const hasSecondHandIntent =
    preferences.includes("second_hand") || preferences.includes("vintage");
  const onlySecondHandFamilySelections = preferences.every(
    (preference) =>
      secondHandFamilyTags.has(preference) || strictPreferenceSupportTags.has(preference),
  );

  if (hasSecondHandIntent && onlySecondHandFamilySelections) {
    return ["second_hand"];
  }

  const directSelections = preferences.filter((preference) =>
    strictPreferenceFamilies.has(preference),
  );

  if (directSelections.length !== 1) {
    return [];
  }

  const [primaryTag] = directSelections;
  const onlySupportiveSelections = preferences.every(
    (preference) => preference === primaryTag || strictPreferenceSupportTags.has(preference),
  );

  return onlySupportiveSelections ? [primaryTag] : [];
}

function itemMatchesStrictPreference(item, strictTags = []) {
  if (!item || !strictTags.length) {
    return false;
  }

  return strictTags.some((tag) => item.tags.includes(tag));
}

function strictPreferenceCoverageScore(routeStops = [], strictTags = []) {
  if (!strictTags.length || !routeStops.length) {
    return 0;
  }

  const matchingStops = routeStops.filter((stop) => itemMatchesStrictPreference(stop, strictTags)).length;
  const coverage = matchingStops / routeStops.length;
  let score = coverage * 14 + matchingStops * 0.8;

  if (coverage >= 0.85) {
    score += 2.4;
  } else if (coverage < 0.6) {
    score -= 6;
  } else if (coverage < 0.75) {
    score -= 1.5;
  }

  return Math.round(score * 10) / 10;
}

function itemMatchesSecondHandIntentFamily(item) {
  if (!item) {
    return false;
  }

  return [...secondHandFamilyTags].some((tag) => (item.tags || []).includes(tag));
}

function getSelectedIntentFamilyKeys(preferences = []) {
  const selected = new Set();

  intentFamilyMatchers.forEach((tags, familyKey) => {
    if (preferences.some((preference) => tags.has(preference))) {
      selected.add(familyKey);
    }
  });

  return [...selected];
}

function isSingleIntentSelection(preferences = [], familyKey) {
  const families = getSelectedIntentFamilyKeys(preferences);
  return families.length === 1 && families[0] === familyKey;
}

function getAvailabilityDayFit(item, weekday) {
  const availability = item?.availability;

  if (!availability || !Number.isFinite(Number(weekday))) {
    return "stable";
  }

  if (Array.isArray(availability.strongWeekdays) && availability.strongWeekdays.includes(Number(weekday))) {
    return "strong";
  }

  if (Array.isArray(availability.weakWeekdays) && availability.weakWeekdays.includes(Number(weekday))) {
    return "weak";
  }

  return "stable";
}

function isMarketStyleSecondHandStop(item) {
  if (!item) {
    return false;
  }

  const kind = item.availability?.kind;
  return (
    kind === "market" ||
    kind === "event_market" ||
    (item.tags || []).includes("market") ||
    (item.tags || []).includes("event_market")
  );
}

function isShopStyleSecondHandStop(item) {
  if (!item) {
    return false;
  }

  if (item.availability?.kind === "shop") {
    return true;
  }

  const tags = new Set(item.tags || []);
  return (
    itemMatchesSecondHandIntentFamily(item) &&
    !tags.has("market") &&
    !tags.has("event_market")
  );
}

function buildSecondHandIntentFit(routeStops = [], preferences = [], weekday = null) {
  if (!preferences.includes("second_hand")) {
    return {
      score: 0,
      coverage: 0,
      leadStop: null,
      identity: "none",
      note: null,
    };
  }

  const familyStops = routeStops.filter((stop) => itemMatchesSecondHandIntentFamily(stop));
  const coverage = routeStops.length ? familyStops.length / routeStops.length : 0;
  const leadStopIndex = routeStops.findIndex((stop) => itemMatchesSecondHandIntentFamily(stop));
  const leadStop = leadStopIndex >= 0 ? routeStops[leadStopIndex] : null;
  const shopLikeCount = familyStops.filter((stop) => isShopStyleSecondHandStop(stop)).length;
  const marketLikeCount = familyStops.filter((stop) => isMarketStyleSecondHandStop(stop)).length;
  const leadDayFit = getAvailabilityDayFit(leadStop, weekday);
  const singleIntent = isSingleIntentSelection(preferences, "second_hand");
  let score = 0;
  let note = null;

  if (!familyStops.length) {
    return {
      score: singleIntent ? -28 : -12,
      coverage,
      leadStop: null,
      identity: "missing",
      note: singleIntent
        ? "Second hand-spåret bär inte den här rutten tydligt nog."
        : "Second hand finns för svagt här för att bära rutten själv.",
    };
  }

  score += coverage * (singleIntent ? 18 : 8);
  score += Math.min(familyStops.length, singleIntent ? 4 : 3);

  if (leadStopIndex === 0) {
    score += singleIntent ? 7 : 2.8;
  } else if (leadStopIndex === 1) {
    score += singleIntent ? 3.2 : 1.2;
  } else {
    score -= singleIntent ? 6.8 : 2.6;
  }

  if (coverage >= (singleIntent ? 0.66 : 0.45)) {
    score += singleIntent ? 4.2 : 2.2;
  } else if (coverage < (singleIntent ? 0.5 : 0.34)) {
    score -= singleIntent ? 8.4 : 4.6;
  }

  if (leadStop && isShopStyleSecondHandStop(leadStop)) {
    score += singleIntent ? 4.6 : 2.4;
  }

  if (leadStop && isMarketStyleSecondHandStop(leadStop)) {
    if (leadDayFit === "strong") {
      score += singleIntent ? 4.4 : 2.2;
      note = "Marknadsspåret är faktiskt starkt nog att bära dagen på den här veckodagen.";
    } else if (leadDayFit === "weak") {
      score -= shopLikeCount > 0 ? (singleIntent ? 9.2 : 5.4) : singleIntent ? 5.4 : 3.2;
      note =
        shopLikeCount > 0
          ? "Marknadsspåret är svagare i dag än butiksspåret."
          : "Marknadsspåret är skörare i dag och bör inte bära hela löftet själv.";
    }
  }

  if (!note && singleIntent && leadStop && isShopStyleSecondHandStop(leadStop)) {
    note = "Rutten bärs tydligt av butiker och vintage snarare än av sidospår.";
  } else if (!note && !singleIntent && coverage >= 0.45) {
    note = "Second hand-spåret syns tydligt i huvudstoppen även när dagen blandar fler lager.";
  }

  return {
    score: Math.round(score * 10) / 10,
    coverage,
    leadStop,
    identity:
      leadStop && isMarketStyleSecondHandStop(leadStop)
        ? leadDayFit === "strong"
          ? "market-strong"
          : "market-weak"
        : leadStop
          ? "shop"
          : "missing",
    note,
    shopLikeCount,
    marketLikeCount,
    singleIntent,
  };
}

function rebalanceWeakMarketLead(orderedStops = [], preferences = [], weekday = null) {
  if (!preferences.includes("second_hand") || !orderedStops.length) {
    return orderedStops;
  }

  const leadSecondHandIndex = orderedStops.findIndex((stop) => itemMatchesSecondHandIntentFamily(stop));

  if (leadSecondHandIndex < 0) {
    return orderedStops;
  }

  const leadStop = orderedStops[leadSecondHandIndex];
  const leadDayFit = getAvailabilityDayFit(leadStop, weekday);

  if (!isMarketStyleSecondHandStop(leadStop) || leadDayFit !== "weak") {
    return orderedStops;
  }

  const replacementIndex = orderedStops.findIndex(
    (stop, index) =>
      index > leadSecondHandIndex &&
      itemMatchesSecondHandIntentFamily(stop) &&
      isShopStyleSecondHandStop(stop),
  );

  if (replacementIndex < 0) {
    return orderedStops;
  }

  const nextStops = [...orderedStops];
  const [replacement] = nextStops.splice(replacementIndex, 1);
  nextStops.splice(leadSecondHandIndex, 0, replacement);
  return nextStops;
}

function areBarMentionsRelevant(preferences = []) {
  return getSelectedIntentFamilyKeys(preferences).some((family) =>
    barRelevantIntentFamilies.has(family),
  );
}

function areHiddenMentionsRelevant(preferences = []) {
  return getSelectedIntentFamilyKeys(preferences).some((family) =>
    hiddenRelevantIntentFamilies.has(family),
  );
}

function normalizeVibeProfile(template) {
  const explicit = template.vibeProfile || {};
  const preferenceTags = new Set(template.preferenceTags || []);
  const optimizerModes = new Set(template.optimizerModes || []);

  return {
    evening:
      explicit.evening ??
      clamp(
        (preferenceTags.has("kväll") ? 2 : 0) +
          (preferenceTags.has("nattliv") ? 1 : 0) +
          (optimizerModes.has("evening-mode") ||
          optimizerModes.has("bar-hop") ||
          optimizerModes.has("cocktail-night")
            ? 1
            : 0),
        0,
        3,
      ),
    culture:
      explicit.culture ??
      clamp(
        (preferenceTags.has("kultur") ? 2 : 0) +
          (preferenceTags.has("kyrkor") ? 1 : 0) +
          (preferenceTags.has("utsikt") ? 1 : 0),
        0,
        3,
      ),
    lowKey:
      explicit.lowKey ??
      clamp(
        (preferenceTags.has("low-key") ? 2 : 0) +
          (optimizerModes.has("low-key-mode") ||
          optimizerModes.has("wine-crawl") ||
          optimizerModes.has("church-crawl")
            ? 1
            : 0) -
          (preferenceTags.has("party") || optimizerModes.has("party-mode") ? 1 : 0),
        0,
        3,
      ),
    party:
      explicit.party ??
      clamp(
        (preferenceTags.has("party") ? 2 : 0) +
          (preferenceTags.has("cocktail") ? 1 : 0) +
          (optimizerModes.has("party-mode") || optimizerModes.has("cocktail-night") ? 1 : 0),
        0,
        3,
      ),
  };
}

const pulseVibeToRouteVibes = {
  buzzy: ["party", "evening"],
  romantic: ["low_key", "evening"],
  slow: ["low_key", "culture"],
  curious: ["culture", "low_key"],
};

const modifierEventTags = {
  evening: ["nattliv", "vin", "cocktail", "utsikt"],
  culture: ["kultur", "kyrkor", "utsikt"],
  low_key: ["vin", "kultur", "mat"],
  party: ["nattliv", "cocktail", "öl"],
};

const modifierLabel = {
  evening: "mer kväll",
  culture: "mer kultur",
  low_key: "mer low-key",
  party: "mer party",
};

const modifierLabelEn = {
  evening: "more evening",
  culture: "more culture",
  low_key: "more low-key",
  party: "more party",
};

const preferenceLabelEn = {
  mat: "food",
  vin: "wine",
  nattliv: "nightlife",
  cocktail: "cocktails",
  "öl": "beer",
  kultur: "culture",
  kyrkor: "churches",
  klassiker: "classics",
  utsikt: "views",
  "hidden gems": "hidden gems",
  second_hand: "second hand",
  secondhand: "second hand",
  "grönt": "green walks",
  "promenad": "walking",
  low_key: "low-key",
  party: "party",
  kväll: "evening",
};

function normalizeRouteResultLanguage(lang = "sv") {
  return lang === "en" ? "en" : "sv";
}

function isEnglishRouteResult(lang) {
  return normalizeRouteResultLanguage(lang) === "en";
}

function routeText(lang, sv, en) {
  return isEnglishRouteResult(lang) ? en : sv;
}

function resolveCuratorVoice(template, lang) {
  const voice = template?.curatorVoice;
  if (!voice || typeof voice !== "object") {
    return null;
  }
  const pickField = (field) => {
    if (!field || typeof field !== "object") return null;
    const text = routeText(lang, field.sv || "", field.en || "");
    return text && text.trim() ? text.trim() : null;
  };
  const resolved = {
    why_area: pickField(voice.whyArea),
    why_order: pickField(voice.whyOrder),
    why_now: pickField(voice.whyNow),
    who_fits: pickField(voice.whoFits),
  };
  const hasAny = Object.values(resolved).some((value) => typeof value === "string" && value.length > 0);
  return hasAny ? resolved : null;
}

function routePreferenceLabel(preference, lang = "sv") {
  if (!isEnglishRouteResult(lang)) {
    return preference;
  }

  return preferenceLabelEn[preference] || preference;
}

function routeModifierLabel(modifier, lang = "sv") {
  if (!isEnglishRouteResult(lang)) {
    return modifierLabel[modifier] || modifier;
  }

  return modifierLabelEn[modifier] || modifier;
}

function formatApproxKm(km, lang = "sv") {
  const value = Number(km).toFixed(1);
  return routeText(lang, `cirka ${value} km`, `about ${value} km`);
}

const autoAnchorKinds = new Set(["district", "district-group"]);

const autoAnchorOptimizerTags = {
  "bar-hop": ["nattliv", "öl", "vin", "cocktail"],
  "wine-crawl": ["vin", "mat", "kultur"],
  "cocktail-night": ["cocktail", "nattliv"],
  "church-crawl": ["kyrkor", "kultur"],
  "pizza-freak": ["pizza", "mat"],
  "sunset-spots": ["utsikt", "kultur"],
  "budget-mode": ["mat", "öl", "hidden gems"],
};

const routeMentionHiddenTags = new Set(["hidden gems", "kultur", "kyrkor", "utsikt"]);
const routeMentionBarTags = new Set(["vin", "öl", "cocktail", "nattliv"]);
const autoAnchorSupportCache = new Map();
const routeLineageSymbol = Symbol.for("parranda.routeLineage");

function buildRouteTagSetFromData(template, route, routeStops = []) {
  const routeTags = route ? buildRouteTagSet(route) : new Set();
  const stopTags = routeStops.flatMap((stop) => (Array.isArray(stop.tags) ? stop.tags : []));
  return new Set([...(template.preferenceTags || []), ...routeTags, ...stopTags]);
}

function routeVibeValue(profile, vibeKey) {
  if (vibeKey === "low_key") {
    return profile.lowKey || 0;
  }

  return profile[vibeKey] || 0;
}

function normalizePulseRouteHints(item) {
  const routeHints = item.route_hints || {};
  const derivedPreferredVibes = [...new Set(
    (item.matches_vibes || []).flatMap((vibe) => pulseVibeToRouteVibes[vibe] || []),
  )];

  return {
    preferredTags: new Set(routeHints.preferred_tags || []),
    avoidTags: new Set(routeHints.avoid_tags || []),
    preferredAreaTokens: new Set(routeHints.preferred_area_tokens || []),
    avoidAreaTokens: new Set(routeHints.avoid_area_tokens || []),
    preferredMacros: new Set(routeHints.preferred_macros || []),
    avoidMacros: new Set(routeHints.avoid_macros || []),
    preferredVibes: new Set([...(routeHints.preferred_vibes || []), ...derivedPreferredVibes]),
    avoidVibes: new Set(routeHints.avoid_vibes || []),
    modifierBias: routeHints.modifier_bias || {},
  };
}

function slugifyText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function orderedIdsEqual(left = [], right = []) {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((value, index) => value === right[index]);
}

function differenceById(left = [], right = []) {
  const rightSet = new Set(right);
  return left.filter((value) => !rightSet.has(value));
}

function buildTemplateUserFacingStopIds(template = {}) {
  return (Array.isArray(template.stops) ? template.stops : [])
    .map((stopId) => findCatalogItemByIdOrName(stopId))
    .filter((item) => item && !autoAnchorKinds.has(item.kind))
    .map((item) => item.id);
}

function buildRealizedRouteId(sourceTemplateId, realizedStopIds = [], templateMatchStatus) {
  if (sourceTemplateId && templateMatchStatus === "exact") {
    return sourceTemplateId;
  }

  const base = sourceTemplateId || "generated-route";
  const stopSlug = realizedStopIds.length ? realizedStopIds.join("--") : "empty";
  return `${base}--realized--${stopSlug}`;
}

function buildRouteIdentity(template = {}, realizedStops = []) {
  const sourceTemplateId = typeof template.id === "string" && template.id.trim()
    ? template.id.trim()
    : null;
  const templateStopIds = buildTemplateUserFacingStopIds(template);
  const realizedStopIds = realizedStops
    .map((stop) => (typeof stop?.id === "string" ? stop.id.trim() : ""))
    .filter(Boolean);
  const missingTemplateStops = differenceById(templateStopIds, realizedStopIds);
  const extraRealizedStops = differenceById(realizedStopIds, templateStopIds);
  const sameStopSet = missingTemplateStops.length === 0 && extraRealizedStops.length === 0;

  let templateMatchStatus = "generated_or_unknown";
  if (sourceTemplateId && sameStopSet && orderedIdsEqual(templateStopIds, realizedStopIds)) {
    templateMatchStatus = "exact";
  } else if (sourceTemplateId && sameStopSet) {
    templateMatchStatus = "reordered";
  } else if (sourceTemplateId) {
    templateMatchStatus = "realized_variant";
  }

  const realizationKind = {
    exact: "template_exact",
    reordered: "template_reordered",
    realized_variant: "template_realized_variant",
    generated_or_unknown: "generated_or_unknown",
  }[templateMatchStatus];

  return {
    source_template_id: sourceTemplateId,
    realized_route_id: buildRealizedRouteId(
      sourceTemplateId,
      realizedStopIds,
      templateMatchStatus,
    ),
    realization_kind: realizationKind,
    template_match_status: templateMatchStatus,
    template_stop_ids: templateStopIds,
    realized_stop_ids: realizedStopIds,
    missing_template_stops: missingTemplateStops,
    extra_realized_stops: extraRealizedStops,
  };
}

function cloneRouteLineage(lineage = {}) {
  return {
    ...lineage,
    template_stop_ids: [...(lineage.template_stop_ids || [])],
    realized_stop_ids: [...(lineage.realized_stop_ids || [])],
    missing_template_stops: [...(lineage.missing_template_stops || [])],
    extra_realized_stops: [...(lineage.extra_realized_stops || [])],
  };
}

function attachRouteLineage(route, lineage = {}) {
  if (!route || typeof route !== "object") {
    return route;
  }

  Object.defineProperty(route, routeLineageSymbol, {
    value: cloneRouteLineage(lineage),
    enumerable: false,
    configurable: true,
    writable: false,
  });

  return route;
}

function getRouteLineage(route) {
  const lineage = route?.[routeLineageSymbol];
  return lineage && typeof lineage === "object" ? lineage : null;
}

function copyRouteLineage(sourceRoute, targetRoute) {
  const lineage = getRouteLineage(sourceRoute);
  return lineage ? attachRouteLineage(targetRoute, lineage) : targetRoute;
}

function extractAreaTokens(...values) {
  const flattenedValues = values.flat().filter(Boolean);
  const tokens = new Set();
  const areaDefinitions = getAreaDefinitions();
  const areaTokens = Object.keys(areaDefinitions);

  flattenedValues.map(slugifyText).forEach((text) => {
    areaTokens.forEach((token) => {
      if (text.includes(token)) {
        tokens.add(token);
      }
    });
  });

  return tokens;
}

function primaryAreaToken(...values) {
  const flattenedValues = values.flat().filter(Boolean);
  const areaTokens = Object.keys(getAreaDefinitions());

  for (const text of flattenedValues.map(slugifyText)) {
    for (const token of areaTokens) {
      if (text.includes(token)) {
        return token;
      }
    }
  }

  return null;
}

function isAutoPointInput(input) {
  return input?.type === "auto";
}

function tokenLabel(token) {
  return getAreaDefinitions()[token]?.label || null;
}

function macroLabel(macro) {
  return getMacroAreaLabels()[macro] || getActiveCityConfig().label || "staden";
}

function currentCityLabel(fallback = "staden") {
  return getActiveCityConfig().label || fallback;
}

function findNearestCatalogItem(point) {
  if (!point || typeof point.lat !== "number" || typeof point.lng !== "number") {
    return null;
  }

  return getAllItems().reduce((closest, item) => {
    const distanceKm = haversineKm(point, item);

    if (!closest || distanceKm < closest.distanceKm) {
      return {
        item,
        distanceKm,
      };
    }

    return closest;
  }, null);
}

function buildItemAreaProfile(item) {
  if (!item) {
    return {
      tokens: new Set(),
      macros: new Set(),
      primaryToken: null,
      primaryMacro: null,
      primaryLabel: null,
    };
  }

  const areaDefinitions = getAreaDefinitions();
  const tokens = extractAreaTokens(item.area, item.id, item.name, item.searchTerms || []);
  const primaryToken =
    primaryAreaToken(item.id, item.name, item.area, item.searchTerms || []) ||
    [...tokens][0] ||
    null;
  const macros = new Set([...tokens].map((token) => areaDefinitions[token]?.macro).filter(Boolean));

  return {
    tokens,
    macros,
    primaryToken,
    primaryMacro: areaDefinitions[primaryToken]?.macro || [...macros][0] || null,
    primaryLabel: tokenLabel(primaryToken) || item.area || item.name,
  };
}

function buildPointAreaProfile(point) {
  const nearest = findNearestCatalogItem(point);

  if (!nearest) {
    return null;
  }

  const itemProfile = buildItemAreaProfile(nearest.item);

  return {
    ...itemProfile,
    nearestItem: nearest.item,
    distanceKm: nearest.distanceKm,
    sourceLabel: point.label || nearest.item.name,
    confidence:
      nearest.distanceKm <= 1.35 ? "high" : nearest.distanceKm <= 2.4 ? "medium" : "low",
  };
}

function incrementCount(map, key) {
  if (!key) {
    return;
  }

  map.set(key, (map.get(key) || 0) + 1);
}

function buildUsedRouteContext(usedRoutes = []) {
  const context = {
    startLabels: new Map(),
    endLabels: new Map(),
    startTokens: new Map(),
    endTokens: new Map(),
    startMacros: new Map(),
    endMacros: new Map(),
    labelPairs: new Map(),
    tokenPairs: new Map(),
    macroPairs: new Map(),
  };

  usedRoutes.forEach((route) => {
    const geoProfile = route?.geo_profile || {};
    const startLabel = slugifyText(route?.start_label);
    const endLabel = slugifyText(route?.end_label);
    const startToken = slugifyText(geoProfile.start_token);
    const endToken = slugifyText(geoProfile.end_token);
    const startMacro = slugifyText(geoProfile.start_macro);
    const endMacro = slugifyText(geoProfile.end_macro);

    incrementCount(context.startLabels, startLabel);
    incrementCount(context.endLabels, endLabel);
    incrementCount(context.startTokens, startToken);
    incrementCount(context.endTokens, endToken);
    incrementCount(context.startMacros, startMacro);
    incrementCount(context.endMacros, endMacro);
    incrementCount(context.labelPairs, startLabel && endLabel ? `${startLabel}|${endLabel}` : null);
    incrementCount(context.tokenPairs, startToken && endToken ? `${startToken}|${endToken}` : null);
    incrementCount(context.macroPairs, startMacro && endMacro ? `${startMacro}|${endMacro}` : null);
  });

  return context;
}

function repeatDepthMultiplier(usedRoutes = []) {
  if (!Array.isArray(usedRoutes) || !usedRoutes.length) {
    return 1;
  }

  return Math.min(2, 1 + Math.max(0, usedRoutes.length - 1) * 0.25);
}

function buildUsedStopContext(usedRoutes = []) {
  const context = {
    stopIds: new Map(),
    duplicateFamilies: new Map(),
  };

  usedRoutes.forEach((route) => {
    (route?.main_stops || []).forEach((stop) => {
      if (!stop?.id) {
        return;
      }

      incrementCount(context.stopIds, stop.id);
      const catalogItem = findCatalogItemByIdOrName(stop.id);
      incrementCount(context.duplicateFamilies, catalogItem?.duplicateFamily);
    });
  });

  return context;
}

function getAutoAnchorCandidates() {
  return getAllItems().filter((item) => autoAnchorKinds.has(item.kind));
}

function getAutoAnchorSupportItems(candidate) {
  if (!candidate?.id) {
    return [];
  }

  const cityKey = getActiveCityConfig().key || "default-city";
  const cacheKey = `${cityKey}:${candidate.id}`;

  if (autoAnchorSupportCache.has(cacheKey)) {
    return autoAnchorSupportCache.get(cacheKey);
  }

  const radiusKm = candidate.kind === "district-group" ? 2.4 : 1.8;
  const supportItems = getAllItems()
    .filter((item) => item.id !== candidate.id && !autoAnchorKinds.has(item.kind))
    .map((item) => ({
      item,
      distanceKm: haversineKm(candidate, item),
    }))
    .filter((entry) => entry.distanceKm <= radiusKm)
    .sort((left, right) => left.distanceKm - right.distanceKm)
    .slice(0, 28);

  autoAnchorSupportCache.set(cacheKey, supportItems);
  return supportItems;
}

function scoreHomeBaseFit(candidate, homeBase, role = "start") {
  if (
    !candidate ||
    !homeBase ||
    typeof homeBase.lat !== "number" ||
    typeof homeBase.lng !== "number"
  ) {
    return 0;
  }

  const candidateProfile = buildItemAreaProfile(candidate);
  const homeProfile = buildPointAreaProfile(homeBase);
  const distanceKm = haversineKm(candidate, homeBase);
  let score = 0;

  if (distanceKm <= 0.75) {
    score += role === "loop" ? 5.4 : role === "start" ? 4.2 : 3.2;
  } else if (distanceKm <= 1.5) {
    score += role === "loop" ? 4 : role === "start" ? 3 : 2.4;
  } else if (distanceKm <= 2.8) {
    score += role === "loop" ? 2.4 : role === "start" ? 1.9 : 1.5;
  } else if (distanceKm <= 4.5) {
    score += role === "start" ? 0.2 : 0.6;
  } else {
    score -= role === "start" ? 2.4 : 1.6;
  }

  if (candidateProfile.primaryToken && candidateProfile.primaryToken === homeProfile.primaryToken) {
    score += 2.1;
  } else if (
    candidateProfile.primaryMacro &&
    candidateProfile.primaryMacro === homeProfile.primaryMacro
  ) {
    score += 0.8;
  }

  return Number(score.toFixed(1));
}

function scoreAutoAnchorCandidate(
  candidate,
  {
    role = "start",
    homeBase = null,
    preferences = [],
    optimizerMode = null,
    modifier = null,
    pairedPoint = null,
    pulseItems = [],
    liveEvents = [],
    targetKm = 8,
    distanceMode = "soft_target",
    usedRoutes = [],
  } = {},
) {
  const strictTags = resolveStrictPreferenceTags(preferences, optimizerMode);
  const supportItems = getAutoAnchorSupportItems(candidate);
  const candidateProfile = buildItemAreaProfile(candidate);
  const pairedProfile = pairedPoint ? buildPointAreaProfile(pairedPoint) : null;
  const usedRouteContext = buildUsedRouteContext(usedRoutes);
  const activeModifier = normalizeModifier(modifier, optimizerMode);
  const optimizerTags = autoAnchorOptimizerTags[optimizerMode] || [];
  const modifierTags = modifierEventTags[activeModifier] || [];
  let score =
    (candidate.anchorWeight || 1.5) * 2.4 +
    (role === "end" ? candidate.goodAsFinal || 1.5 : candidate.goodAsStart || 1.5);

  score += scoreHomeBaseFit(candidate, homeBase, role);

  if (!pairedPoint) {
    score += candidate.kind === "district-group" ? 0.9 : 0.4;
  }

  preferences.forEach((preference) => {
    if (candidate.tags.includes(preference)) {
      score += 2.1;
    }
  });

  optimizerTags.forEach((tag) => {
    if (candidate.tags.includes(tag)) {
      score += 1.4;
    }
  });

  modifierTags.forEach((tag) => {
    if (candidate.tags.includes(tag)) {
      score += 0.75;
    }
  });

  const strictSupportCount = supportItems.filter(({ item }) =>
    itemMatchesStrictPreference(item, strictTags),
  ).length;

  if (strictTags.length === 1) {
    if (candidate.tags.includes(strictTags[0])) {
      score += 4;
    }

    if (strictSupportCount >= 4) {
      score += 5.5;
    } else if (strictSupportCount >= 2) {
      score += 3.2;
    } else if (strictSupportCount === 1) {
      score += 1.2;
    } else {
      score -= 5.2;
    }
  }

  const nearbyPreferenceSupport = supportItems.reduce((sum, { item, distanceKm }) => {
    const closeness = clamp(1.9 - distanceKm, 0, 1.9);
    const preferenceHits = item.tags.filter((tag) => preferences.includes(tag)).length;
    const optimizerHits = optimizerTags.filter((tag) => item.tags.includes(tag)).length;
    const modifierHits = modifierTags.filter((tag) => item.tags.includes(tag)).length;
    const strictHit = itemMatchesStrictPreference(item, strictTags) ? 1 : 0;

    return (
      sum +
      preferenceHits * (0.55 + closeness * 0.35) +
      optimizerHits * 0.35 +
      modifierHits * 0.22 +
      strictHit * (1.2 + closeness * 0.4)
    );
  }, 0);

  score += Math.min(12, nearbyPreferenceSupport);

  if (pairedPoint) {
    const distanceKm = haversineKm(candidate, pairedPoint);

    if (distanceKm <= 1.1) {
      score += 4;
    } else if (distanceKm <= 2.6) {
      score += 2.4;
    } else if (distanceKm <= 4.4) {
      score += 1.1;
    } else if (distanceKm <= 6.2) {
      score -= 0.6;
    } else {
      score -= 3.8;
    }

    if (
      candidateProfile.primaryToken &&
      pairedProfile?.primaryToken &&
      candidateProfile.primaryToken === pairedProfile.primaryToken
    ) {
      score += 2.6;
    } else if (
      candidateProfile.primaryMacro &&
      pairedProfile?.primaryMacro &&
      candidateProfile.primaryMacro === pairedProfile.primaryMacro
    ) {
      score += 1.8;
    } else if (
      distanceMode !== "no_limit" &&
      candidateProfile.primaryMacro &&
      pairedProfile?.primaryMacro
    ) {
      score -= 1.4;
    }

    if (distanceMode !== "no_limit" && distanceKm > Math.max(5.4, (targetKm || 8) * 0.8)) {
      score -= 2.4;
    }
  }

  pulseItems.forEach((item) => {
    const areaDefinitions = getAreaDefinitions();
    const pulseTokens = extractAreaTokens(item.where, item.title, item.blurb);

    if (candidateProfile.primaryToken && pulseTokens.has(candidateProfile.primaryToken)) {
      score += 1.2;
    } else if (
      candidateProfile.primaryMacro &&
      [...pulseTokens].some((token) => areaDefinitions[token]?.macro === candidateProfile.primaryMacro)
    ) {
      score += 0.5;
    }
  });

  liveEvents.forEach((event) => {
    const eventAreaTokens = extractAreaTokens(
      event.where,
      event.venue,
      event.address,
      event.geocode_label,
      event.title,
    );
    const eventTags = event.match_tags || [];

    if (candidateProfile.primaryToken && eventAreaTokens.has(candidateProfile.primaryToken)) {
      score += 1.4;
    }

    if (typeof event.lat !== "number" || typeof event.lng !== "number") {
      return;
    }

    const tagHits = preferences.filter((preference) => eventTags.includes(preference)).length;
    const distanceKm = haversineKm(candidate, event);

    if (distanceKm <= 0.8) {
      score += 3 + tagHits * 0.7;
    } else if (distanceKm <= 1.8) {
      score += 1.5 + tagHits * 0.35;
    }
  });

  const candidateLabel = slugifyText(candidate.name);
  const roleLabels = role === "end" ? usedRouteContext.endLabels : usedRouteContext.startLabels;
  const roleTokens = role === "end" ? usedRouteContext.endTokens : usedRouteContext.startTokens;
  const roleMacros = role === "end" ? usedRouteContext.endMacros : usedRouteContext.startMacros;
  const repeatedLabelCount = candidateLabel ? roleLabels.get(candidateLabel) || 0 : 0;
  const repeatedTokenCount = candidateProfile.primaryToken
    ? roleTokens.get(candidateProfile.primaryToken) || 0
    : 0;
  const repeatedMacroCount = candidateProfile.primaryMacro
    ? roleMacros.get(candidateProfile.primaryMacro) || 0
    : 0;
  const repeatMultiplier = repeatDepthMultiplier(usedRoutes);

  if (repeatedLabelCount) {
    score -= Math.min(9.2, repeatedLabelCount * 4.4 * repeatMultiplier);
  }

  if (repeatedTokenCount) {
    score -= Math.min(6.4, repeatedTokenCount * 2.6 * repeatMultiplier);
  }

  if (repeatedMacroCount) {
    score -= Math.min(5.2, repeatedMacroCount * 1.4 * repeatMultiplier);
  }

  return Number(score.toFixed(1));
}

function resolveAutoPoint({
  role = "start",
  homeBase = null,
  pairedPoint = null,
  pulseByDate = {},
  liveEventsByDate = {},
  preferences = [],
  optimizerMode = null,
  modifier = null,
  targetKm = 8,
  distanceMode = "soft_target",
} = {}) {
  const pulseItems = Object.values(pulseByDate).flatMap((pulse) =>
    Array.isArray(pulse?.items) ? pulse.items : [],
  );
  const liveEvents = Object.values(liveEventsByDate).flatMap((items) =>
    Array.isArray(items) ? items : [],
  );
  const ranked = getAutoAnchorCandidates()
    .map((candidate) => ({
      candidate,
      score: scoreAutoAnchorCandidate(candidate, {
        role,
        homeBase,
        preferences,
        optimizerMode,
        modifier,
        pairedPoint,
        pulseItems,
        liveEvents,
        targetKm,
        distanceMode,
      }),
    }))
    .sort((left, right) => right.score - left.score);
  const best = ranked[0]?.candidate || findCatalogItemByName(getFallbackLabel());

  if (!best) {
    return buildCityCenterPoint("auto");
  }

  return {
    label: best.name,
    lat: best.lat,
    lng: best.lng,
    source: "auto",
  };
}

function rankAutoAnchorCandidates({
  role = "start",
  homeBase = null,
  pairedPoint = null,
  pulseByDate = {},
  liveEventsByDate = {},
  preferences = [],
  optimizerMode = null,
  modifier = null,
  targetKm = 8,
  distanceMode = "soft_target",
} = {}) {
  const pulseItems = Object.values(pulseByDate).flatMap((pulse) =>
    Array.isArray(pulse?.items) ? pulse.items : [],
  );
  const liveEvents = Object.values(liveEventsByDate).flatMap((items) =>
    Array.isArray(items) ? items : [],
  );

  return getAutoAnchorCandidates()
    .map((candidate) => ({
      candidate,
      score: scoreAutoAnchorCandidate(candidate, {
        role,
        homeBase,
        preferences,
        optimizerMode,
        modifier,
        pairedPoint,
        pulseItems,
        liveEvents,
        targetKm,
        distanceMode,
      }),
    }))
    .sort((left, right) => right.score - left.score);
}

function scoreAutoAnchorPair(
  startCandidate,
  endCandidate,
  {
    homeBase = null,
    preferences = [],
    optimizerMode = null,
    modifier = null,
    targetKm = 8,
    distanceMode = "soft_target",
    legPacing = "balanced",
    weather = null,
    usedRoutes = [],
    isFinalDay = false,
  } = {},
) {
  if (!startCandidate || !endCandidate) {
    return Number.NEGATIVE_INFINITY;
  }

  const startProfile = buildItemAreaProfile(startCandidate);
  const endProfile = buildItemAreaProfile(endCandidate);
  const usedRouteContext = buildUsedRouteContext(usedRoutes);
  const strictTags = resolveStrictPreferenceTags(preferences, optimizerMode);
  const distanceKm = haversineKm(startCandidate, endCandidate);
  const startLabel = slugifyText(startCandidate.name);
  const endLabel = slugifyText(endCandidate.name);
  const labelPair = startLabel && endLabel ? `${startLabel}|${endLabel}` : null;
  const tokenPair =
    startProfile.primaryToken && endProfile.primaryToken
      ? `${startProfile.primaryToken}|${endProfile.primaryToken}`
      : null;
  const macroPair =
    startProfile.primaryMacro && endProfile.primaryMacro
      ? `${startProfile.primaryMacro}|${endProfile.primaryMacro}`
      : null;
  let score = 0;

  score += (startCandidate.anchorWeight || 1.5) * 1.8;
  score += (endCandidate.anchorWeight || 1.5) * 1.8;
  score += (startCandidate.goodAsStart || 1.5) * 1.5;
  score += (endCandidate.goodAsFinal || 1.5) * 1.9;
  score += scoreHomeBaseFit(startCandidate, homeBase, "start");
  score += scoreHomeBaseFit(
    endCandidate,
    homeBase,
    preferences.includes("kväll") || preferences.includes("party") || preferences.includes("nattliv")
      ? "end"
      : "start",
  ) * 0.7;

  if (slugifyText(startCandidate.name) === slugifyText(endCandidate.name)) {
    return -99;
  }

  if (distanceKm <= 1.1) {
    score -= 8;
  } else if (distanceKm <= 2.2) {
    score += 1.5;
  } else if (distanceKm <= 4.8) {
    score += 5.2;
  } else if (distanceKm <= 6.4) {
    score += distanceMode === "no_limit" ? 4.5 : 2.2;
  } else {
    score -= distanceMode === "no_limit" ? 0.5 : 6.5;
  }

  if (startProfile.primaryToken && startProfile.primaryToken === endProfile.primaryToken) {
    score -= 4.5;
  } else if (startProfile.primaryMacro && startProfile.primaryMacro === endProfile.primaryMacro) {
    score += 0.9;
  } else {
    score += 1.8;
  }

  if (strictTags.length === 1) {
    if (strictTags[0] === "second_hand") {
      const startMatchesStrict = itemMatchesStrictPreference(startCandidate, strictTags);
      const endMatchesStrict = itemMatchesStrictPreference(endCandidate, strictTags);
      score += startMatchesStrict ? 2.4 : -4.2;
      score += endMatchesStrict ? 2.4 : -4.2;
    }

    score -= 2.8;
  }

  if (preferences.includes("kväll") || preferences.includes("party") || preferences.includes("nattliv")) {
    score += 3.4;
  }

  if (modifier === "party" || modifier === "evening") {
    score += 2.4;
  }

  if (distanceMode === "no_limit" && distanceKm >= 2.2 && distanceKm <= 6.8) {
    score += 2.2;
  }

  if (!isBroadExplorationRoute({ preferences, optimizerMode, modifier, distanceMode, targetKm })) {
    const pacingKey = normalizeLegPacing(legPacing);
    const cautiousFlow =
      pacingKey === "short" ||
      Number(targetKm || 8) <= 6 ||
      preferences.includes("low-key") ||
      normalizeModifier(modifier, optimizerMode) === "low_key" ||
      weather?.condition === "rain";
    const comfortableArcKm = cautiousFlow ? Math.max(3.2, (targetKm || 8) * 0.58) : Math.max(4.2, (targetKm || 8) * 0.72);

    if (distanceKm > comfortableArcKm) {
      score -= (distanceKm - comfortableArcKm) * (cautiousFlow ? 2.8 : 1.6);
    }

    if (homeBase && typeof homeBase.lat === "number" && typeof homeBase.lng === "number") {
      const startHomeKm = haversineKm(startCandidate, homeBase);
      const endHomeKm = haversineKm(endCandidate, homeBase);
      const farthestHomeKm = Math.max(startHomeKm, endHomeKm);
      if (farthestHomeKm > Math.max(2.4, (targetKm || 8) * 0.38)) {
        score -= (farthestHomeKm - Math.max(2.4, (targetKm || 8) * 0.38)) * 2.4;
      }
    }
  }

  const expectedMaxDistance = distanceMode === "no_limit" ? 7.2 : Math.max(4.5, targetKm * 0.75);
  if (distanceKm > expectedMaxDistance) {
    score -= (distanceKm - expectedMaxDistance) * 1.5;
  }

  const repeatedStartLabelCount = startLabel ? usedRouteContext.startLabels.get(startLabel) || 0 : 0;
  const repeatedEndLabelCount = endLabel ? usedRouteContext.endLabels.get(endLabel) || 0 : 0;
  const repeatedLabelPairCount = labelPair ? usedRouteContext.labelPairs.get(labelPair) || 0 : 0;
  const repeatedStartTokenCount = startProfile.primaryToken
    ? usedRouteContext.startTokens.get(startProfile.primaryToken) || 0
    : 0;
  const repeatedEndTokenCount = endProfile.primaryToken
    ? usedRouteContext.endTokens.get(endProfile.primaryToken) || 0
    : 0;
  const repeatedStartMacroCount = startProfile.primaryMacro
    ? usedRouteContext.startMacros.get(startProfile.primaryMacro) || 0
    : 0;
  const repeatedEndMacroCount = endProfile.primaryMacro
    ? usedRouteContext.endMacros.get(endProfile.primaryMacro) || 0
    : 0;
  const repeatedTokenPairCount = tokenPair ? usedRouteContext.tokenPairs.get(tokenPair) || 0 : 0;
  const repeatedMacroPairCount = macroPair ? usedRouteContext.macroPairs.get(macroPair) || 0 : 0;
  const repeatMultiplier = isFinalDay ? 0.5 : repeatDepthMultiplier(usedRoutes);

  if (repeatedLabelPairCount) {
    score -= Math.min(14.5, repeatedLabelPairCount * 6.2 * repeatMultiplier);
  }

  if (repeatedStartLabelCount) {
    score -= Math.min(7.2, repeatedStartLabelCount * 2.7 * repeatMultiplier);
  }

  if (repeatedEndLabelCount) {
    score -= Math.min(7.6, repeatedEndLabelCount * 3 * repeatMultiplier);
  }

  if (repeatedTokenPairCount) {
    score -= Math.min(8.4, repeatedTokenPairCount * 3.4 * repeatMultiplier);
  }

  if (repeatedMacroPairCount) {
    score -= Math.min(6.4, repeatedMacroPairCount * 2.2 * repeatMultiplier);
  }

  if (repeatedStartTokenCount) {
    score -= Math.min(5.4, repeatedStartTokenCount * 1.7 * repeatMultiplier);
  }

  if (repeatedEndTokenCount) {
    score -= Math.min(5.8, repeatedEndTokenCount * 1.9 * repeatMultiplier);
  }

  if (repeatedStartMacroCount) {
    score -= Math.min(3.6, repeatedStartMacroCount * 0.9 * repeatMultiplier);
  }

  if (repeatedEndMacroCount) {
    score -= Math.min(4, repeatedEndMacroCount * 1.1 * repeatMultiplier);
  }

  return Number(score.toFixed(1));
}

function scoreAutoLoopCandidate(
  candidate,
  {
    baseScore = 0,
    homeBase = null,
    preferences = [],
    optimizerMode = null,
    modifier = null,
    targetKm = 8,
    distanceMode = "soft_target",
    legPacing = "balanced",
    weather = null,
    usedRoutes = [],
    isFinalDay = false,
  } = {},
) {
  const strictTags = resolveStrictPreferenceTags(preferences, optimizerMode);
  const candidateProfile = buildItemAreaProfile(candidate);
  const usedRouteContext = buildUsedRouteContext(usedRoutes);
  const repeatMultiplier = isFinalDay ? 0.5 : repeatDepthMultiplier(usedRoutes);
  let score = baseScore + (candidate.goodAsFinal || 1.5) * 1.1;

  score += scoreHomeBaseFit(candidate, homeBase, "loop");

  if (candidate.kind === "district") {
    score += 1.2;
  }

  if (strictTags.length === 1) {
    score += 2.2;
  }

  if (distanceMode !== "no_limit" && targetKm <= 7) {
    score += 1.3;
  }

  if (preferences.includes("low-key") || modifier === "low_key") {
    score += 1.2;
  }

  if (normalizeLegPacing(legPacing) === "short" || Number(targetKm || 8) <= 6) {
    score += 2.8;
  }

  if (weather?.condition === "rain") {
    score += 1.8;
  }

  if (homeBase && typeof homeBase.lat === "number" && typeof homeBase.lng === "number") {
    const homeKm = haversineKm(candidate, homeBase);
    score += Math.max(0, 4.2 - homeKm * 1.6);
  }

  if (distanceMode === "no_limit" && !isBroadExplorationRoute({ preferences, optimizerMode, modifier, distanceMode, targetKm })) {
    score -= 1.4;
  }

  if (
    preferences.includes("party") ||
    preferences.includes("nattliv") ||
    preferences.includes("kväll") ||
    modifier === "party" ||
    modifier === "evening"
  ) {
    score -= 2.3;
  }

  const candidateLabel = slugifyText(candidate.name);
  const repeatedLabelCount = candidateLabel ? usedRouteContext.startLabels.get(candidateLabel) || 0 : 0;
  const repeatedTokenCount = candidateProfile.primaryToken
    ? usedRouteContext.startTokens.get(candidateProfile.primaryToken) || 0
    : 0;
  const repeatedMacroCount = candidateProfile.primaryMacro
    ? usedRouteContext.startMacros.get(candidateProfile.primaryMacro) || 0
    : 0;

  if (repeatedLabelCount) {
    score -= Math.min(10.2, repeatedLabelCount * 4.8 * repeatMultiplier);
  }

  if (repeatedTokenCount) {
    score -= Math.min(6.4, repeatedTokenCount * 2.9 * repeatMultiplier);
  }

  if (repeatedMacroCount) {
    score -= Math.min(5.4, repeatedMacroCount * 1.8 * repeatMultiplier);
  }

  return Number(score.toFixed(1));
}

function resolveAutoAnchors(options = {}) {
  const strictTags = resolveStrictPreferenceTags(options.preferences || [], options.optimizerMode);
  const broadExploration = isBroadExplorationRoute(options);
  const localEnvelopeBias = localAutoEnvelopeBias(options);
  const arcFriendlyDay =
    broadExploration ||
    options.preferences?.includes("kväll") ||
    options.preferences?.includes("party") ||
    options.preferences?.includes("nattliv") ||
    options.modifier === "evening" ||
    options.modifier === "party";
  const rankedStart = rankAutoAnchorCandidates({
    ...options,
    role: "start",
  }).slice(0, 6);
  const rankedEnd = rankAutoAnchorCandidates({
    ...options,
    role: "end",
  }).slice(0, 6);
  const rankedLoop = rankedStart
    .map(({ candidate, score }) => ({
      candidate,
      score: scoreAutoLoopCandidate(candidate, {
        ...options,
        baseScore: score,
      }),
    }))
    .sort((left, right) => right.score - left.score);
  const rankedArc = [];

  rankedStart.forEach(({ candidate: startCandidate }) => {
    rankedEnd.forEach(({ candidate: endCandidate }) => {
      if (slugifyText(startCandidate.name) === slugifyText(endCandidate.name)) {
        return;
      }

      rankedArc.push({
        startCandidate,
        endCandidate,
        score: scoreAutoAnchorPair(startCandidate, endCandidate, options),
      });
    });
  });

  rankedStart.slice(0, 3).forEach(({ candidate: startCandidate }) => {
    rankAutoAnchorCandidates({
      ...options,
      role: "end",
      pairedPoint: {
        label: startCandidate.name,
        lat: startCandidate.lat,
        lng: startCandidate.lng,
      },
    })
      .slice(0, 5)
      .forEach(({ candidate: endCandidate, score }) => {
        if (slugifyText(startCandidate.name) === slugifyText(endCandidate.name)) {
          return;
        }

        rankedArc.push({
          startCandidate,
          endCandidate,
          score: Number(
            (
              score +
              scoreAutoAnchorPair(startCandidate, endCandidate, options) +
              (endCandidate.goodAsFinal || 1.5)
            ).toFixed(1),
          ),
        });
      });
  });

  rankedArc.sort((left, right) => right.score - left.score);

  const bestLoop = rankedLoop[0];
  const bestArc = rankedArc[0];
  // Final days favor a compact loop: a relaxed, coherent finish should not jump
  // to a fresh-but-distant arc anchor just to chase cross-day novelty.
  const finalDayLoopBias = options.isFinalDay ? 10 : 0;
  const adjustedLoopScore = bestLoop
    ? bestLoop.score + localEnvelopeBias + finalDayLoopBias
    : Number.NEGATIVE_INFINITY;
  const adjustedArcScore = bestArc ? bestArc.score - localEnvelopeBias * 0.75 : Number.NEGATIVE_INFINITY;
  const shouldPreferArc =
    bestArc &&
    (
      !bestLoop ||
      adjustedArcScore >= adjustedLoopScore + 2.4 ||
      (
        arcFriendlyDay &&
        adjustedArcScore >= adjustedLoopScore + 0.8
      ) ||
      (
        arcFriendlyDay &&
        strictTags.length === 0 &&
        adjustedArcScore >= adjustedLoopScore - 2.6
      )
    );

  if (shouldPreferArc) {
    return {
      start: {
        label: bestArc.startCandidate.name,
        lat: bestArc.startCandidate.lat,
        lng: bestArc.startCandidate.lng,
        source: "auto",
      },
      end: {
        label: bestArc.endCandidate.name,
        lat: bestArc.endCandidate.lat,
        lng: bestArc.endCandidate.lng,
        source: "auto",
      },
      shape: "arc",
    };
  }

  const fallbackLoopCandidate =
    bestLoop?.candidate || rankedStart[0]?.candidate || findCatalogItemByName(getFallbackLabel());

  if (!fallbackLoopCandidate) {
    const cityCenterPoint = buildCityCenterPoint("auto");

    return {
      start: cityCenterPoint,
      end: { ...cityCenterPoint },
      shape: "loop",
    };
  }

  return {
    start: {
      label: fallbackLoopCandidate.name,
      lat: fallbackLoopCandidate.lat,
      lng: fallbackLoopCandidate.lng,
      source: "auto",
    },
    end: {
      label: fallbackLoopCandidate.name,
      lat: fallbackLoopCandidate.lat,
      lng: fallbackLoopCandidate.lng,
      source: "auto",
    },
    shape: "loop",
  };
}

function inferLiveEventBestTime(event) {
  const corpus = `${event.title || ""} ${event.summary || ""} ${event.type || ""}`.toLowerCase();

  if (/(22:|23:|night|dj|club|jazz|concert|aperitivo|sera|evening)/.test(corpus)) {
    return "kväll";
  }

  if (/(lunch|middag|dinner|food|market|mercato|tasting|degustazione)/.test(corpus)) {
    return "middagstid";
  }

  return "sen eftermiddag till kväll";
}

function buildLiveEventStopCandidates(
  liveEvents = [],
  preferences = [],
  optimizerMode = null,
  modifier = null,
  options = {},
) {
  // Live events are a separate contextual layer (Pulse, map overlay,
  // days[].live_events). They never become primary_route.main_stops unless the
  // caller explicitly opts in via options.includeLiveEvents. The flag preserves
  // the existing Rome capability (e.g. "Teatro India Night" as a bar-hop
  // evening stop) behind an opt-in, while default routes stay built from
  // stable catalog places only.
  if (!options.includeLiveEvents) {
    return [];
  }

  const activeModifier = normalizeModifier(modifier, optimizerMode);
  const shape = options.shape || "loop";
  const start = options.start || null;
  const end = options.end || null;
  const startProfile = options.startProfile || buildPointAreaProfile(start);
  const endProfile = options.endProfile || buildPointAreaProfile(end);
  const liveEventTuning = getRoutingTuning().liveEventSeed || {};

  return (liveEvents || [])
    .filter(
      (event) =>
        typeof event.lat === "number" &&
        typeof event.lng === "number" &&
        Array.isArray(event.match_tags) &&
        event.match_tags.length,
    )
    .map((event) => {
      const tagHits = preferences.filter((preference) => event.match_tags.includes(preference)).length;
      const modifierHits = activeModifier
        ? (modifierEventTags[activeModifier] || []).filter((tag) => event.match_tags.includes(tag)).length
        : 0;
      const searchTerms = [
        event.title,
        event.venue,
        event.address,
        event.geocode_label,
        ...(event.match_tags || []),
      ].filter(Boolean);
      const primaryToken =
        primaryAreaToken(searchTerms) ||
        primaryAreaToken(event.geocode_label, event.venue, event.address) ||
        "centro";
      const primaryMacro = getAreaDefinitions()[primaryToken]?.macro || null;
      let anchorWeight = 2.6 + Math.min(2.2, tagHits * 0.4 + modifierHits * 0.35);
      let goodAsStart = 0.8;
      let goodAsFinal =
        event.match_tags.includes("nattliv") || event.match_tags.includes("kultur") ? 2.9 : 2.1;

      if (start && end) {
        if (shape === "loop") {
          const distanceToStart = haversineKm(start, event);
          if (distanceToStart <= (liveEventTuning.loopNearKm ?? 1.8)) {
            anchorWeight += Math.max(
              0,
              (liveEventTuning.loopNearKm ?? 1.8) - distanceToStart,
            ) * (liveEventTuning.loopStrongRadiusBoost ?? 2.8);
          }

          if (
            startProfile?.primaryMacro &&
            primaryMacro &&
            primaryMacro !== startProfile.primaryMacro
          ) {
            anchorWeight -= liveEventTuning.loopMacroPenalty ?? 2.4;
          } else if (
            startProfile?.primaryToken &&
            primaryToken === startProfile.primaryToken
          ) {
            anchorWeight += 1.6;
            goodAsStart += 0.5;
            goodAsFinal += 0.3;
          }
        } else {
          const axis = projectPointToAxis(event, start, end);
          const axisLengthKm = Math.max(axis.axisLengthKm || 0, 0.1);
          const progressRatio = axis.progressKm / axisLengthKm;

          if (
            axis.progressKm < (liveEventTuning.arcProgressStartSlackKm ?? -0.35) ||
            axis.progressKm > axis.axisLengthKm + (liveEventTuning.arcProgressEndSlackKm ?? 1)
          ) {
            anchorWeight -= 3.1;
          }

          if (axis.lateralKm <= (liveEventTuning.arcStrongLateralKm ?? 0.9)) {
            anchorWeight += 2.3;
          } else if (axis.lateralKm <= (liveEventTuning.arcMaxLateralKm ?? 2.4)) {
            anchorWeight += 0.8;
          } else {
            anchorWeight -= (axis.lateralKm - (liveEventTuning.arcMaxLateralKm ?? 2.4)) * 1.3;
          }

          if (
            progressRatio >= (liveEventTuning.arcBridgeProgressMin ?? 0.18) &&
            progressRatio <= (liveEventTuning.arcBridgeProgressMax ?? 0.82)
          ) {
            anchorWeight += liveEventTuning.arcBridgeBoost ?? 2.6;
          }

          if (startProfile?.primaryToken && primaryToken === startProfile.primaryToken) {
            goodAsStart += 1.2;
          }

          if (endProfile?.primaryToken && primaryToken === endProfile.primaryToken) {
            goodAsFinal += 1.3;
          }
        }
      }

      return {
        id: `live-event-${event.id}`,
        name: event.title,
        kind: "live-event",
        lat: event.lat,
        lng: event.lng,
        area: event.venue || event.geocode_label || tokenLabel(primaryToken) || currentCityLabel(),
        tags: [...new Set([...(event.match_tags || []), "live"])],
        weatherTags: ["all-weather", "evening"],
        closedWeekdays: [],
        searchTerms,
        priceLevel: event.buy_url ? "$$" : "$",
        bestTime: inferLiveEventBestTime(event),
        vibe: event.type ? `Live: ${event.type}` : "Tidsbundet stopp",
        groupSize: "2-6 personer",
        bookingRequired: Boolean(event.buy_url),
        openingSummary:
          event.match_reason ||
          event.summary ||
          `Officiellt event som händer just nu i ${currentCityLabel()}.`,
        longDescription: event.summary || event.match_reason || "Tidsbundet live-event i dagens rutt.",
        perfectFor: event.match_tags || [],
        featureNotes: [
          event.route_fit_note || null,
          event.type || null,
          event.source_label || null,
        ].filter(Boolean),
        happyHourNote: null,
        clusterToken: primaryToken,
        anchorWeight: Number(anchorWeight.toFixed(1)),
        goodAsStart: Number(goodAsStart.toFixed(1)),
        goodAsFinal: Number(goodAsFinal.toFixed(1)),
        dwellType: "live-anchor",
        duplicateFamily: `live-${primaryToken}`,
        isLiveEvent: true,
        eventId: event.id,
        drawerQuery: event.venue || event.title,
        eventTitle: event.title,
        externalSearchUrl: event.url || null,
        externalMapUrl: null,
      };
    })
    .sort((left, right) => (right.anchorWeight || 0) - (left.anchorWeight || 0))
    .slice(0, 3);
}

function buildRouteAreaProfile(routeStops) {
  const tokens = new Set();
  const macros = new Set();
  const tokenCounts = new Map();
  const macroCounts = new Map();

  routeStops.forEach((item) => {
    const profile = buildItemAreaProfile(item);

    profile.tokens.forEach((token) => {
      tokens.add(token);
      tokenCounts.set(token, (tokenCounts.get(token) || 0) + 1);
    });

    profile.macros.forEach((macro) => {
      macros.add(macro);
      macroCounts.set(macro, (macroCounts.get(macro) || 0) + 1);
    });
  });

  return {
    tokens,
    macros,
    tokenCounts,
    macroCounts,
    dominantToken:
      [...tokenCounts.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] || null,
    dominantMacro:
      [...macroCounts.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] || null,
  };
}

function buildRouteGeoProfile(routeArea, startProfile, endProfile) {
  return {
    area_tokens: [...(routeArea?.tokens || [])],
    macros: [...(routeArea?.macros || [])],
    dominant_token: routeArea?.dominantToken || null,
    dominant_macro: routeArea?.dominantMacro || null,
    start_token: startProfile?.primaryToken || null,
    start_macro: startProfile?.primaryMacro || null,
    end_token: endProfile?.primaryToken || null,
    end_macro: endProfile?.primaryMacro || null,
  };
}

function areaScore({ routeStops, startPoint, endPoint, distanceMode, lang = "sv" }) {
  if (!Array.isArray(routeStops) || !routeStops.length) {
    return {
      score: 0,
      note: null,
    };
  }

  const routeProfile = buildRouteAreaProfile(routeStops);
  const startProfile = buildPointAreaProfile(startPoint);
  const endProfile = buildPointAreaProfile(endPoint);
  const areaTuning = getRoutingTuning().areaScore || {};
  let score = 0;
  const notes = [];

  const applyAnchorScore = (profile) => {
    if (!profile?.primaryMacro) {
      return;
    }

    if (profile.primaryToken && routeProfile.tokens.has(profile.primaryToken)) {
      score += areaTuning.anchorTokenHitScore ?? 5.5;
      return;
    }

    if (routeProfile.macros.has(profile.primaryMacro)) {
      score += areaTuning.anchorMacroHitScore ?? 2.5;
      return;
    }

    score -= areaTuning.anchorMissPenalty ?? 4;
  };

  applyAnchorScore(startProfile);
  applyAnchorScore(endProfile);

  const sameMacro =
    startProfile?.primaryMacro &&
    endProfile?.primaryMacro &&
    startProfile.primaryMacro === endProfile.primaryMacro;

  if (sameMacro) {
    if (routeProfile.dominantMacro === startProfile.primaryMacro) {
      score += areaTuning.sameMacroDominantHitScore ?? 4.5;
    } else if (routeProfile.macros.has(startProfile.primaryMacro)) {
      score += areaTuning.sameMacroPresenceScore ?? 2;
    }

    if (
      distanceMode !== "no_limit" &&
      routeProfile.macros.size > (areaTuning.sameMacroSpreadPenaltyThreshold ?? 2)
    ) {
      score -= areaTuning.sameMacroSpreadPenalty ?? 1.5;
    }

    if (routeProfile.dominantMacro === startProfile.primaryMacro) {
      notes.push(
        routeText(
          lang,
          `Rutten håller sig främst i ${macroLabel(startProfile.primaryMacro)} runt ${
            tokenLabel(routeProfile.dominantToken) || startProfile.primaryLabel
          } i stället för att dra tvärs över stan i onödan.`,
          `The route stays mostly in ${macroLabel(startProfile.primaryMacro)} around ${
            tokenLabel(routeProfile.dominantToken) || startProfile.primaryLabel
          } instead of pulling across town unnecessarily.`,
        ),
      );
    }
  } else if (startProfile?.primaryMacro && endProfile?.primaryMacro) {
    if (
      routeProfile.macros.has(startProfile.primaryMacro) &&
      routeProfile.macros.has(endProfile.primaryMacro)
    ) {
      score += areaTuning.crossMacroBridgeScore ?? 4.5;
      notes.push(
        routeText(
          lang,
          `Rutten binder ihop ${macroLabel(startProfile.primaryMacro)} och ${macroLabel(
            endProfile.primaryMacro,
          )} på ett mer naturligt sätt än de mer generiska looparna.`,
          `The route connects ${macroLabel(startProfile.primaryMacro)} and ${macroLabel(
            endProfile.primaryMacro,
          )} more naturally than the more generic loops.`,
        ),
      );
    } else {
      score -= areaTuning.crossMacroMissPenalty ?? 2.5;
    }

    if (
      routeProfile.dominantMacro &&
      ![startProfile.primaryMacro, endProfile.primaryMacro].includes(routeProfile.dominantMacro)
    ) {
      score -= areaTuning.crossMacroDominantDriftPenalty ?? 1.5;
    }
  }

  if (
    routeProfile.dominantMacro === (areaTuning.unanchoredDominantMacro || "west") &&
    startProfile?.primaryMacro !== (areaTuning.unanchoredDominantMacro || "west") &&
    endProfile?.primaryMacro !== (areaTuning.unanchoredDominantMacro || "west")
  ) {
    score -= areaTuning.unanchoredDominantMacroPenalty ?? 2.5;
  }

  if (!notes.length && startProfile?.primaryToken && routeProfile.tokens.has(startProfile.primaryToken)) {
    notes.push(
      routeText(
        lang,
        `Rutten tar faktiskt avstamp i ${startProfile.primaryLabel} i stället för att direkt hoppa till fel sida av stan.`,
        `The route actually starts from ${startProfile.primaryLabel} instead of immediately jumping to the wrong side of town.`,
      ),
    );
  }

  return {
    score: Math.round(score * 10) / 10,
    note: notes[0] || null,
  };
}

function profileScore(template, preferences, optimizerMode, modifier) {
  const profile = normalizeVibeProfile(template);
  const activeModifier = normalizeModifier(modifier, optimizerMode);
  let score = 0;

  if (preferences.includes("kväll")) {
    score += profile.evening * 2.4;
  }

  if (preferences.includes("kultur")) {
    score += profile.culture * 1.8;
  }

  if (preferences.includes("low-key")) {
    score += profile.lowKey * 2.8;
  }

  if (preferences.includes("party")) {
    score += profile.party * 3;
  }

  if (activeModifier === "evening") {
    score += profile.evening * 3.2;
  } else if (activeModifier === "culture") {
    score += profile.culture * 3.2;
  } else if (activeModifier === "low_key") {
    score += profile.lowKey * 3.4;
  } else if (activeModifier === "party") {
    score += profile.party * 3.6;
  }

  return {
    score: Math.round(score * 10) / 10,
    profile,
  };
}

function pointAdjacencyScore(anchorPoint, stopPoint) {
  const distance = haversineKm(anchorPoint, stopPoint);

  if (distance <= 0.35) {
    return 4;
  }

  if (distance <= 0.85) {
    return 2.5;
  }

  if (distance <= 1.6) {
    return 1;
  }

  if (distance <= 2.6) {
    return -1.5;
  }

  return -4;
}

function weatherScore(route, weather, lang = "sv") {
  if (!weather) {
    return { score: 0, note: null };
  }

  let score = 0;
  const notes = [];

  if (weather.condition === "rain") {
    score += route.weatherProfile.rain || 0;
    notes.push(
      routeText(
        lang,
        "Regn väntas, så inomhus- och kvartersstopp väger lite tyngre.",
        "Rain is expected, so indoor and neighborhood stops carry a little more weight.",
      ),
    );
  } else if (weather.condition === "sun") {
    score += route.weatherProfile.sun || 0;
    notes.push(
      routeText(
        lang,
        "Soligt väder gör utevyer och längre promenadpartier extra starka.",
        "Sunny weather makes viewpoints and longer outdoor stretches stronger.",
      ),
    );
  } else {
    score += 1;
  }

  if (weather.hot) {
    score += route.weatherProfile.hot || 0;
    notes.push(
      routeText(
        lang,
        "Hög värme gör att pauser och skuggigare partier prioriteras.",
        "Higher heat makes breaks and shadier stretches more important.",
      ),
    );
  }

  return {
    score,
    note: notes.length ? notes.join(" ") : null,
  };
}

function weekdayScore(route, weekday) {
  return route.weekdayBoost[weekday] || 0;
}

function optimizerModeScore(template, optimizerMode, budgetTier, modifier) {
  let score = 0;
  const activeModifier = normalizeModifier(modifier, optimizerMode);
  const activeBudgetTier = normalizeBudgetTier([], optimizerMode, budgetTier);
  const legacyModes = new Set(["budget-mode", "evening-mode", "culture-mode", "low-key-mode", "party-mode"]);

  if (optimizerMode && !legacyModes.has(optimizerMode)) {
    score += template.optimizerModes?.includes(optimizerMode) ? 10 : -2;
  }

  if (activeModifier) {
    const modifierMode = modifierToOptimizerMode[activeModifier];
    score += template.optimizerModes?.includes(modifierMode) ? 7 : -1;
  }

  if (activeBudgetTier === "budget" && template.optimizerModes?.includes("budget-mode")) {
    score += 5;
  }

  if (activeBudgetTier === "dolce-vita" && template.optimizerModes?.includes("dolce-vita")) {
    score += 7;
  }

  return score;
}

function buildOpeningWarnings(routeStops, weekday) {
  // closedWeekdays is intentionally optional on catalog entries — when an
  // entry's weekly schedule has not been verified to source, the field is
  // omitted rather than encoded as `[]` (which would imply "open every
  // day"). Treat a missing field as "schedule unknown, do not warn".
  return routeStops
    .filter((stop) => Array.isArray(stop.closedWeekdays) && stop.closedWeekdays.includes(weekday))
    .map((stop) => `${stop.name} är kuraterat som svagare eller stängt den här veckodagen.`);
}

function buildLocalTruthOpeningWarnings(localTruth = {}) {
  const warnings = new Set();

  (localTruth.verify_opening_hours || []).forEach((entry) => {
    if (entry?.reason) {
      warnings.add(entry.reason);
    }
  });

  (localTruth.caution_notes || []).forEach((entry) => {
    if (entry?.text) {
      warnings.add(entry.text);
    }
  });

  return [...warnings];
}

function buildVenueSpecials(routeStops, weekday, lang = "sv") {
  return routeStops
    .filter((stop) => stop.happyHourNote || stop.bookingRequired)
    .map((stop) => {
      const weekdayLabel = isEnglishRouteResult(lang)
        ? ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][weekday]
        : ["söndag", "måndag", "tisdag", "onsdag", "torsdag", "fredag", "lördag"][weekday];

      if (stop.happyHourNote && stop.bookingRequired) {
        return isEnglishRouteResult(lang)
          ? `${stop.name}: ${stop.happyHourNote} Book ahead if ${weekdayLabel} is an evening you really want to lock in.`
          : `${stop.name}: ${stop.happyHourNote} Boka gärna om ${weekdayLabel} är en kväll du verkligen vill låsa.`;
      }

      if (stop.happyHourNote) {
        return `${stop.name}: ${stop.happyHourNote}`;
      }

      return routeText(
        lang,
        `${stop.name}: boka smart om det här är ett viktigt kvällsankare.`,
        `${stop.name}: book smart if this is an important evening anchor.`,
      );
    });
}

function buildBudgetNote(routeStops, preferences, optimizerMode, budgetTier, lang = "sv") {
  const activeBudgetTier = normalizeBudgetTier(preferences, optimizerMode, budgetTier);

  if (activeBudgetTier === "standard" || !routeStops.length) {
    return null;
  }

  const averagePrice =
    routeStops.reduce((sum, stop) => sum + priceLevelWeight(stop.priceLevel), 0) /
    routeStops.length;
  const cheaperStops = routeStops.filter((stop) => priceLevelWeight(stop.priceLevel) <= 1).length;
  const premiumStops = routeStops.filter(
    (stop) => priceLevelWeight(stop.priceLevel) >= 3 || stop.bookingRequired,
  ).length;

  if (activeBudgetTier === "budget") {
    if (averagePrice <= 1.05) {
      return routeText(
        lang,
        "Budgetläge: den här dagen lutar tydligt mot billig öl, prisvärd mat och stopp som håller nere notan.",
        "Budget-smart: this day leans clearly toward cheaper beer, good-value food, and stops that keep the bill down.",
      );
    }

    if (averagePrice <= 1.65) {
      return routeText(
        lang,
        `Budgetläge: dagen håller en ganska snäll prisnivå med ${cheaperStops} tydligt prisvänliga stopp inbakade.`,
        `Budget-smart: the day stays fairly gentle on price, with ${cheaperStops} clearly budget-friendly stops built in.`,
      );
    }

    return routeText(
      lang,
      "Budgetläge: det här är fortfarande ett starkt upplägg, men det finns dyrare stopp längs vägen än i de mest prisvänliga alternativen.",
      "Budget-smart: this is still a strong plan, but there are pricier stops along the way than in the most budget-friendly alternatives.",
    );
  }

  if (premiumStops >= 2 && averagePrice >= 2.3) {
    return routeText(
      lang,
      "La Dolce Vita: rutten lutar tydligt mot premiumglas, bokningsvärda stopp och en större kvällskänsla.",
      "La Dolce Vita: the route leans clearly toward premium glasses, bookable stops, and a bigger evening feel.",
    );
  }

  if (averagePrice >= 1.9) {
    return routeText(
      lang,
      "La Dolce Vita: den här dagen håller en tydligt högre nivå i glas, middag eller kvällsrum utan att bli stel.",
      "La Dolce Vita: this day keeps a higher level in drinks, dinner, or evening rooms without becoming stiff.",
    );
  }

  return routeText(
    lang,
    "La Dolce Vita: dagen har fortfarande några mjukare ankare, men den viktas upp mot mer premium och mer extravagant final.",
    "La Dolce Vita: the day still has softer anchors, but it is weighted toward more premium and a more extravagant finish.",
  );
}

function budgetScore(routeStops, preferences, optimizerMode, budgetTier = "standard", lang = "sv") {
  const activeBudgetTier = normalizeBudgetTier(preferences, optimizerMode, budgetTier);

  if (activeBudgetTier === "standard" || !routeStops.length) {
    return {
      score: 0,
      note: null,
    };
  }

  const averagePrice =
    routeStops.reduce((sum, stop) => sum + priceLevelWeight(stop.priceLevel), 0) /
    routeStops.length;
  const cheaperStops = routeStops.filter((stop) => priceLevelWeight(stop.priceLevel) <= 1).length;
  const premiumStops = routeStops.filter(
    (stop) => priceLevelWeight(stop.priceLevel) >= 3 || stop.bookingRequired,
  ).length;
  const bookedStops = routeStops.filter((stop) => stop.bookingRequired).length;

  if (activeBudgetTier === "budget") {
    return {
      score: Math.round((7.5 - averagePrice * 2.4 + cheaperStops * 0.9) * 10) / 10,
      note: buildBudgetNote(routeStops, preferences, optimizerMode, budgetTier, lang),
    };
  }

  return {
    score: Math.round((averagePrice * 2.5 + premiumStops * 1.4 + bookedStops * 0.8 - cheaperStops * 0.3) * 10) / 10,
    note: buildBudgetNote(routeStops, preferences, optimizerMode, budgetTier, lang),
  };
}

function isLoopRoute(start, end) {
  return slugifyText(start.label) === slugifyText(end.label) || haversineKm(start, end) <= 0.85;
}

function toRelativeKm(point, origin, referenceLat = (point.lat + origin.lat) / 2) {
  const lngKm = 111.32 * Math.cos((referenceLat * Math.PI) / 180);
  return {
    x: (point.lng - origin.lng) * lngKm,
    y: (point.lat - origin.lat) * 110.57,
  };
}

function projectPointToAxis(point, start, end) {
  const axis = toRelativeKm(end, start, (start.lat + end.lat) / 2);
  const vector = toRelativeKm(point, start, (start.lat + end.lat) / 2);
  const axisLength = Math.max(0.15, Math.hypot(axis.x, axis.y));
  const progressKm = (vector.x * axis.x + vector.y * axis.y) / axisLength;
  const lateralKm = Math.abs(vector.x * axis.y - vector.y * axis.x) / axisLength;

  return {
    progressKm,
    lateralKm,
    axisLengthKm: axisLength,
  };
}

function normalizeDayProfile(dayProfile = "peak") {
  return ["light", "peak", "variation", "final"].includes(dayProfile) ? dayProfile : "peak";
}

const noLimitStopBudgetByProfile = {
  peak: 6,
  variation: 5,
  light: 4,
  final: 4,
};

function noLimitStopBudget(dayProfile = "peak") {
  return noLimitStopBudgetByProfile[normalizeDayProfile(dayProfile)] || noLimitStopBudgetByProfile.peak;
}

function choosePrimaryDayProfile({
  dateIndex = 0,
  totalDates = 1,
  targetKm = 8,
  distanceMode = "soft_target",
  preferences = [],
  optimizerMode = null,
} = {}) {
  const strictTags = resolveStrictPreferenceTags(preferences, optimizerMode);

  if (totalDates > 1 && dateIndex === totalDates - 1) {
    return "final";
  }

  if (strictTags.length === 1 || targetKm <= 6) {
    return "light";
  }

  if (distanceMode === "no_limit" && (preferences.includes("nattliv") || preferences.includes("party"))) {
    return "peak";
  }

  return "peak";
}

function buildAlternativeDayProfiles(primaryDayProfile = "peak") {
  const primary = normalizeDayProfile(primaryDayProfile);

  if (primary === "light") {
    return ["variation", "peak"];
  }

  if (primary === "final") {
    return ["variation", "light"];
  }

  if (primary === "variation") {
    return ["light", "peak"];
  }

  return ["variation", "light"];
}

function desiredStopCount(poolSize, targetKm, distanceMode, dayProfile = "peak") {
  if (poolSize <= 3) {
    return poolSize;
  }

  const normalizedProfile = normalizeDayProfile(dayProfile);

  if (distanceMode === "no_limit") {
    return Math.min(poolSize, noLimitStopBudget(normalizedProfile));
  }

  let baseCount;
  if (targetKm <= 5) {
    baseCount = Math.min(poolSize, 3);
  } else if (targetKm <= 7) {
    baseCount = Math.min(poolSize, 4);
  } else if (targetKm <= 9) {
    baseCount = Math.min(poolSize, 5);
  } else {
    baseCount = Math.min(poolSize, 6);
  }

  if (normalizedProfile === "light") {
    return Math.max(2, baseCount - 1);
  }

  if (normalizedProfile === "final") {
    return targetKm <= 7 ? Math.max(2, baseCount - 1) : Math.min(poolSize, 4);
  }

  if (normalizedProfile === "peak") {
    return Math.min(poolSize, baseCount + (targetKm >= 8 ? 1 : 0));
  }

  return baseCount;
}

function directLegDistanceKm(fromPoint, toPoint) {
  return Number((haversineKm(fromPoint, toPoint) * 1.22).toFixed(1));
}

function loopRadiusKm(targetKm, distanceMode) {
  if (distanceMode === "no_limit") {
    return 4.6;
  }

  return clamp((targetKm || 8) * 0.42, 2.2, 4.4);
}

function isBroadExplorationRoute({
  preferences = [],
  optimizerMode = null,
  modifier = null,
  distanceMode = "soft_target",
  targetKm = 8,
} = {}) {
  if (distanceMode !== "no_limit") {
    return false;
  }

  const activeModifier = normalizeModifier(modifier, optimizerMode);
  return (
    Number(targetKm || 0) >= 10 &&
    (
      isNightlifeExplicit(preferences, optimizerMode, modifier) ||
      activeModifier === "party" ||
      activeModifier === "evening"
    )
  );
}

function localAutoEnvelopeBias({
  homeBase = null,
  preferences = [],
  optimizerMode = null,
  modifier = null,
  targetKm = 8,
  distanceMode = "soft_target",
  legPacing = "balanced",
  weather = null,
  usedRoutes = [],
} = {}) {
  if (isBroadExplorationRoute({ preferences, optimizerMode, modifier, distanceMode, targetKm })) {
    return 0;
  }

  const activeModifier = normalizeModifier(modifier, optimizerMode);
  const pacingKey = normalizeLegPacing(legPacing);
  let bias = 0;

  if (homeBase && typeof homeBase.lat === "number" && typeof homeBase.lng === "number") {
    bias += 8.4;
  }

  if (pacingKey === "short") {
    bias += 4.4;
  }

  if (preferences.includes("low-key") || activeModifier === "low_key") {
    bias += 2.4;
  }

  if (weather?.condition === "rain") {
    bias += 2.2;
  }

  if (
    Array.isArray(usedRoutes) &&
    usedRoutes.length >= 3 &&
    distanceMode !== "no_limit" &&
    Number(targetKm || 8) <= 6.5 &&
    (pacingKey === "short" || pacingKey === "balanced")
  ) {
    bias += Math.min(3.2, usedRoutes.length * 0.9);
  }

  return Number(bias.toFixed(1));
}

function isAnchorDuplicateStop(item, point) {
  return (
    slugifyText(item.name) === slugifyText(point.label) ||
    (item.kind.startsWith("district") && haversineKm(item, point) <= 0.16)
  );
}

function uniqueStops(items) {
  return [...new Map(items.map((item) => [item.id, item])).values()];
}

function isBridgeCandidateStop(item) {
  return (
    item &&
    !autoAnchorKinds.has(item.kind) &&
    !item.isLiveEvent &&
    Number.isFinite(item.lat) &&
    Number.isFinite(item.lng)
  );
}

function scoreBridgeStopCandidate({
  item,
  fromPoint,
  toPoint,
  routeStops = [],
  existingIds = new Set(),
  strictTags = [],
  preferences = [],
  optimizerMode = null,
  modifier = null,
  legPacing = "balanced",
}) {
  if (
    !isBridgeCandidateStop(item) ||
    existingIds.has(item.id) ||
    isAnchorDuplicateStop(item, fromPoint) ||
    isAnchorDuplicateStop(item, toPoint)
  ) {
    return null;
  }

  const originalLegKm = directLegDistanceKm(fromPoint, toPoint);
  const continuity = getRouteContinuityConfig(legPacing);
  const axisStats = projectPointToAxis(item, fromPoint, toPoint);
  const axisLengthKm = Math.max(axisStats.axisLengthKm || 0.1, 0.1);
  const progressRatio = axisStats.progressKm / axisLengthKm;
  const maxLateralKm = clamp(originalLegKm * 0.24, 0.45, 1.35);
  const fromLegKm = directLegDistanceKm(fromPoint, item);
  const toLegKm = directLegDistanceKm(item, toPoint);
  const splitLongestKm = Math.max(fromLegKm, toLegKm);
  const detourKm = Number((fromLegKm + toLegKm - originalLegKm).toFixed(1));

  if (progressRatio <= 0.14 || progressRatio >= 0.86) {
    return null;
  }

  if (axisStats.lateralKm > maxLateralKm) {
    return null;
  }

  if (splitLongestKm >= originalLegKm - 0.5) {
    return null;
  }

  if (splitLongestKm > Math.max(continuity.bridgeMaxKm, originalLegKm * 0.78)) {
    return null;
  }

  if (detourKm > clamp(originalLegKm * 0.3, 0.45, 1.15)) {
    return null;
  }

  const routeArea = buildRouteAreaProfile(routeStops);
  const itemProfile = buildItemAreaProfile(item);
  const fromProfile = buildPointAreaProfile(fromPoint);
  const toProfile = buildPointAreaProfile(toPoint);
  const midpointBoost = 1 - Math.min(1, Math.abs(progressRatio - 0.5) / 0.5);
  const improvementKm = Math.max(0, originalLegKm - splitLongestKm);
  let score = preferenceBoostForStop(item, preferences, optimizerMode, modifier, strictTags);

  score += improvementKm * 3.2;
  score += Math.max(0, 2.4 - detourKm * 2.2);
  score += midpointBoost * 2.2;
  score -= axisStats.lateralKm * 1.9;

  if (strictTags.length && itemMatchesStrictPreference(item, strictTags)) {
    score += 2.8;
  }

  if (
    itemProfile.primaryMacro &&
    (itemProfile.primaryMacro === fromProfile?.primaryMacro ||
      itemProfile.primaryMacro === toProfile?.primaryMacro)
  ) {
    score += 1.3;
  } else if (routeArea.macros.has(itemProfile.primaryMacro)) {
    score += 0.8;
  }

  if (
    itemProfile.primaryToken &&
    (itemProfile.primaryToken === fromProfile?.primaryToken ||
      itemProfile.primaryToken === toProfile?.primaryToken)
  ) {
    score += 0.9;
  }

  return {
    item,
    score: Number(score.toFixed(1)),
    splitLongestKm,
  };
}

function insertBridgeStopsForLongLegs(
  orderedStops,
  {
    start,
    end,
    preferences = [],
    optimizerMode = null,
    modifier = null,
    legPacing = "balanced",
    distanceMode = "soft_target",
    shape = "loop",
  } = {},
) {
  const pacingKey = normalizeLegPacing(legPacing);
  const continuity = getRouteContinuityConfig(pacingKey);

  if (distanceMode === "no_limit" || pacingKey === "flexible") {
    return orderedStops;
  }

  let currentStops = [...orderedStops];
  const maxInsertions = currentStops.length >= 5 ? 2 : 1;

  for (let insertionCount = 0; insertionCount < maxInsertions; insertionCount += 1) {
    const points = [start, ...currentStops, end];
    const legs = buildRouteLegs(points);
    const lateHopMetrics = shape === "arc" ? buildArcLateHopMetrics(legs, legPacing) : { count: 0 };
    const bridgeThreshold =
      shape === "arc" && lateHopMetrics.count
        ? Math.max(0.8, continuity.bridgeMaxKm - 0.15)
        : continuity.bridgeMaxKm;
    const longLegIndex = legs.findIndex((leg, index) => {
      const distance = Number(leg.distance_km);
      if (!Number.isFinite(distance)) {
        return false;
      }

      if (distance > bridgeThreshold) {
        return true;
      }

      return shape === "arc" && lateHopMetrics.count && index >= 2 && distance >= bridgeThreshold - 0.05;
    });

    if (longLegIndex < 0) {
      break;
    }

    const fromPoint = points[longLegIndex];
    const toPoint = points[longLegIndex + 1];
    const existingIds = new Set(currentStops.map((stop) => stop.id));
    const strictTags = resolveStrictPreferenceTags(preferences, optimizerMode);
    const bridgeCandidate = uniqueStops(getAllItems())
      .map((item) =>
        scoreBridgeStopCandidate({
          item,
          fromPoint,
          toPoint,
          routeStops: currentStops,
          existingIds,
          strictTags,
          preferences,
          optimizerMode,
          modifier,
          legPacing,
        }),
      )
      .filter(Boolean)
      .sort((left, right) => {
        if (right.score !== left.score) {
          return right.score - left.score;
        }

        return left.splitLongestKm - right.splitLongestKm;
      })[0];

    if (!bridgeCandidate) {
      break;
    }

    currentStops.splice(longLegIndex, 0, bridgeCandidate.item);
  }

  return currentStops;
}

function ensureLockedArcCoverage(selectedStops, sortedPool, start, end, desiredCount) {
  const selected = uniqueStops(selectedStops);

  if (selected.length < 2 || !Array.isArray(sortedPool) || !sortedPool.length) {
    return selected;
  }

  const startProfile = buildPointAreaProfile(start);
  const endProfile = buildPointAreaProfile(end);

  const metaById = new Map(
    sortedPool.map((entry) => {
      const axis = projectPointToAxis(entry.item, start, end);
      const distanceToStart = haversineKm(start, entry.item);
      const distanceToEnd = haversineKm(end, entry.item);
      const itemProfile = buildItemAreaProfile(entry.item);
      const nearStart =
        distanceToStart <= 1.15 ||
        axis.progressKm <= Math.max(0.7, axis.axisLengthKm * 0.34);
      const nearEnd =
        distanceToEnd <= 1.15 ||
        axis.progressKm >= axis.axisLengthKm * 0.56;

      return [
        entry.item.id,
        {
          axis,
          distanceToStart,
          distanceToEnd,
          itemProfile,
          nearStart,
          nearEnd,
        },
      ];
    }),
  );

  const selectedIds = new Set(selected.map((item) => item.id));
  const hasNearStart = selected.some((item) => metaById.get(item.id)?.nearStart);
  const candidates = sortedPool.map((entry) => entry.item);
  const hasStartToken =
    startProfile?.primaryToken &&
    selected.some((item) => metaById.get(item.id)?.itemProfile.primaryToken === startProfile.primaryToken);
  const hasEndToken =
    endProfile?.primaryToken &&
    selected.some((item) => metaById.get(item.id)?.itemProfile.primaryToken === endProfile.primaryToken);

  const replaceForStart = (candidate) => {
    const replaceIndex = selected.reduce((chosenIndex, item, index) => {
      const meta = metaById.get(item.id);

      if (!meta || meta.nearStart || meta.itemProfile.primaryToken === startProfile?.primaryToken) {
        return chosenIndex;
      }

      if (chosenIndex < 0) {
        return index;
      }

      const chosenMeta = metaById.get(selected[chosenIndex].id);
      return (meta.axis.progressKm || 0) > (chosenMeta?.axis.progressKm || 0) ? index : chosenIndex;
    }, -1);

    if (replaceIndex >= 0) {
      selected[replaceIndex] = candidate;
      selectedIds.add(candidate.id);
    }
  };

  const replaceForEnd = (candidate) => {
    const replaceIndex = selected.reduce((chosenIndex, item, index) => {
      const meta = metaById.get(item.id);

      if (!meta || meta.nearEnd || meta.itemProfile.primaryToken === endProfile?.primaryToken) {
        return chosenIndex;
      }

      if (chosenIndex < 0) {
        return index;
      }

      const chosenMeta = metaById.get(selected[chosenIndex].id);
      return (meta.axis.progressKm || 0) < (chosenMeta?.axis.progressKm || 0) ? index : chosenIndex;
    }, -1);

    if (replaceIndex >= 0) {
      selected[replaceIndex] = candidate;
      selectedIds.add(candidate.id);
    }
  };

  if (!hasStartToken && startProfile?.primaryToken) {
    const startTokenCandidate = candidates.find((item) => {
      const meta = metaById.get(item.id);
      return (
        !selectedIds.has(item.id) &&
        meta?.itemProfile.primaryToken === startProfile.primaryToken &&
        (meta.nearStart || meta.distanceToStart <= 1.7)
      );
    });

    if (startTokenCandidate) {
      replaceForStart(startTokenCandidate);
    }
  }

  if (!hasNearStart) {
    const startCandidate = candidates.find((item) => {
      const meta = metaById.get(item.id);
      return !selectedIds.has(item.id) && meta?.nearStart;
    });

    if (startCandidate) {
      replaceForStart(startCandidate);
    }
  }

  if (!hasEndToken && endProfile?.primaryToken) {
    const endTokenCandidate = candidates.find((item) => {
      const meta = metaById.get(item.id);
      return (
        !selectedIds.has(item.id) &&
        meta?.itemProfile.primaryToken === endProfile.primaryToken &&
        (meta.nearEnd || meta.distanceToEnd <= 1.7)
      );
    });

    if (endTokenCandidate) {
      replaceForEnd(endTokenCandidate);
    }
  }

  if (!selected.some((item) => metaById.get(item.id)?.nearEnd)) {
    const endCandidate = candidates.find((item) => {
      const meta = metaById.get(item.id);
      return !selectedIds.has(item.id) && meta?.nearEnd;
    });

    if (endCandidate) {
      replaceForEnd(endCandidate);
    }
  }

  return uniqueStops(selected).slice(0, desiredCount);
}

function ensureArcProgressionCoverage(
  selectedStops,
  sortedPool,
  start,
  end,
  {
    desiredCount,
    preferences = [],
    optimizerMode = null,
    targetKm = 8,
    distanceMode = "soft_target",
    legPacing = "balanced",
  } = {},
) {
  const selected = uniqueStops(selectedStops);

  if (selected.length < 3 || !Array.isArray(sortedPool) || !sortedPool.length) {
    return selected;
  }

  const axisLengthKm = Math.max(haversineKm(start, end), 0.1);
  if (axisLengthKm < 3.2) {
    return selected;
  }

  const strictTags = resolveStrictPreferenceTags(preferences, optimizerMode);
  const shouldPreserveSecondHandFamily =
    preferences.includes("second_hand") || preferences.includes("vintage");
  const selectedIds = new Set(selected.map((item) => item.id));
  const pacingKey = normalizeLegPacing(legPacing);
  const corridorWidthKm = clamp(
    Math.max((targetKm || 8) * (pacingKey === "short" ? 0.15 : 0.2), pacingKey === "short" ? 0.75 : 0.95),
    pacingKey === "short" ? 0.75 : 0.95,
    distanceMode === "no_limit" ? 2.1 : pacingKey === "short" ? 1.25 : 1.65,
  );
  const windows =
    axisLengthKm >= 4.4
      ? [
          { min: 0.18, max: 0.46 },
          { min: 0.46, max: 0.78 },
        ]
      : [{ min: 0.26, max: 0.74 }];

  const metaFor = (item) => {
    const axis = projectPointToAxis(item, start, end);
    const progressRatio = axis.progressKm / Math.max(axis.axisLengthKm || 0.1, 0.1);
    return { axis, progressRatio };
  };

  const replaceWeakClusterStop = (candidate, window) => {
    const candidateMatchesStrict = !strictTags.length || itemMatchesStrictPreference(candidate, strictTags);
    if (!candidateMatchesStrict) {
      return false;
    }

    if (shouldPreserveSecondHandFamily && !itemMatchesSecondHandIntentFamily(candidate)) {
      return false;
    }

    const replaceIndex = selected.reduce((chosenIndex, item, index) => {
      const meta = metaFor(item);
      const outsideWindow = meta.progressRatio < window.min || meta.progressRatio > window.max;
      const strictProtected = strictTags.length && itemMatchesStrictPreference(item, strictTags);

      if (!outsideWindow || (strictProtected && !itemMatchesStrictPreference(candidate, strictTags))) {
        return chosenIndex;
      }

      if (chosenIndex < 0) {
        return index;
      }

      const chosenMeta = metaFor(selected[chosenIndex]);
      const currentEdgeDistance = Math.max(
        Math.abs(meta.progressRatio - window.min),
        Math.abs(meta.progressRatio - window.max),
      );
      const chosenEdgeDistance = Math.max(
        Math.abs(chosenMeta.progressRatio - window.min),
        Math.abs(chosenMeta.progressRatio - window.max),
      );
      return currentEdgeDistance > chosenEdgeDistance ? index : chosenIndex;
    }, -1);

    if (replaceIndex < 0) {
      return false;
    }

    selectedIds.delete(selected[replaceIndex].id);
    selected[replaceIndex] = candidate;
    selectedIds.add(candidate.id);
    return true;
  };

  windows.forEach((window) => {
    const hasWindowStop = selected.some((item) => {
      const meta = metaFor(item);
      return (
        meta.progressRatio >= window.min &&
        meta.progressRatio <= window.max &&
        meta.axis.lateralKm <= corridorWidthKm
      );
    });

    if (hasWindowStop) {
      return;
    }

    const candidate = sortedPool
      .map((entry) => entry.item)
      .find((item) => {
        if (!item || selectedIds.has(item.id) || !isBridgeCandidateStop(item)) {
          return false;
        }

        const meta = metaFor(item);
        return (
          meta.progressRatio >= window.min &&
          meta.progressRatio <= window.max &&
          meta.axis.lateralKm <= corridorWidthKm &&
          (!shouldPreserveSecondHandFamily || itemMatchesSecondHandIntentFamily(item)) &&
          (!strictTags.length || itemMatchesStrictPreference(item, strictTags))
        );
      });

    if (!candidate) {
      return;
    }

    if (selected.length < Math.max(3, desiredCount || selected.length)) {
      selected.push(candidate);
      selectedIds.add(candidate.id);
      return;
    }

    replaceWeakClusterStop(candidate, window);
  });

  return uniqueStops(selected).slice(0, desiredCount || selected.length);
}

function preferenceBoostForStop(
  item,
  preferences = [],
  optimizerMode = null,
  modifier = null,
  strictTags = [],
) {
  const activeModifier = normalizeModifier(modifier, optimizerMode);
  let score = item.tags.filter((tag) => preferences.includes(tag)).length * 0.8;

  if (strictTags.length) {
    score += itemMatchesStrictPreference(item, strictTags) ? 5.4 : -6.6;
  }

  if (optimizerMode === "bar-hop" && (item.tags.includes("nattliv") || item.tags.includes("öl") || item.tags.includes("vin"))) {
    score += 1.2;
  }

  if (optimizerMode === "wine-crawl" && item.tags.includes("vin")) {
    score += 1.8;
  }

  if (optimizerMode === "cocktail-night" && item.tags.includes("cocktail")) {
    score += 1.8;
  }

  if (optimizerMode === "church-crawl" && item.tags.includes("kyrkor")) {
    score += 1.8;
  }

  if (optimizerMode === "pizza-freak" && item.tags.includes("pizza")) {
    score += 2;
  }

  if (optimizerMode === "sunset-spots" && (item.tags.includes("utsikt") || item.weatherTags?.includes("golden-hour"))) {
    score += 1.6;
  }

  if (
    (preferences.includes("cafe") || preferences.includes("café")) &&
    (item.kind === "cafe" || item.tags.includes("cafe") || item.tags.includes("café"))
  ) {
    score += 3.4;
  }

  if (activeModifier === "evening" && (item.tags.includes("nattliv") || item.tags.includes("cocktail") || item.tags.includes("vin"))) {
    score += 1.2;
  }

  if (activeModifier === "culture" && (item.tags.includes("kultur") || item.tags.includes("kyrkor"))) {
    score += 1.2;
  }

  if (activeModifier === "low_key" && item.tags.includes("low-key")) {
    score += 1.2;
  }

  if (activeModifier === "party" && item.tags.includes("party")) {
    score += 1.4;
  }

  if (!isNightlifeExplicit(preferences, optimizerMode, modifier)) {
    const nightlifeDominantCount = item.tags.filter((t) => nightlifeDominantTags.has(t)).length;
    if (nightlifeDominantCount > 0) {
      const matchesExplicitFoodDrinkPref = item.tags.some((t) =>
        (t === "mat" || t === "vin" || t === "öl" || t === "cocktail" || t === "vermut" || t === "tapas" || t === "aperitivo")
        && preferences.includes(t));
      if (!matchesExplicitFoodDrinkPref) {
        score -= 3.2;
      }
    }
  }

  return score;
}

function scoreStopCandidate({
  item,
  index,
  shape,
  start,
  end,
  startProfile,
  endProfile,
  preferences,
  optimizerMode,
  modifier,
  strictTags = [],
  targetKm,
  distanceMode,
  legPacing = "balanced",
  usedRoutes = [],
  manualAnchorsLocked = false,
}) {
  const itemProfile = buildItemAreaProfile(item);
  const distanceToStart = haversineKm(start, item);
  const distanceToEnd = haversineKm(end, item);
  const pacing = legPacingConfig[normalizeLegPacing(legPacing)];
  const arcTuning = getRoutingTuning().arcStopScoring || {};
  const neutralArcMacros = new Set(arcTuning.driftNeutralMacros || ["center"]);
  const usedStopContext = buildUsedStopContext(usedRoutes);
  const repeatMultiplier = repeatDepthMultiplier(usedRoutes) * (manualAnchorsLocked ? 0.35 : 1);
  let score = (item.anchorWeight || 1) + Math.max(0, 1.2 - index * 0.08);

  score += preferenceBoostForStop(item, preferences, optimizerMode, modifier, strictTags);
  if (item.isLiveEvent) {
    score += 3.4;
  }
  score += Math.max(0, 2.2 - distanceToStart) * ((item.goodAsStart || 1.5) * 0.6);
  score += Math.max(0, 2.2 - distanceToEnd) * ((item.goodAsFinal || 1.5) * 0.45);

  if (shape === "loop") {
    const anchorMacro = startProfile?.primaryMacro;
    const anchorToken = startProfile?.primaryToken;
    const radiusLimit = loopRadiusKm(targetKm, distanceMode);
    const preferredRadius = pacing.preferredMaxKm * 2.1;

    if (anchorToken && itemProfile.primaryToken === anchorToken) {
      score += 4.4;
    } else if (anchorMacro && itemProfile.primaryMacro === anchorMacro) {
      score += 2.8;
    } else if (anchorMacro && itemProfile.primaryMacro) {
      score -= distanceMode === "no_limit" ? 1.2 : 5.4;
    }

    if (distanceToStart > radiusLimit) {
      score -= (distanceToStart - radiusLimit) * 3.1;
    }

    if (distanceToStart > preferredRadius) {
      score -= (distanceToStart - preferredRadius) * pacing.radiusBonusWeight * 1.8;
    }
  } else {
    const axisStats = projectPointToAxis(item, start, end);
    const startMacro = startProfile?.primaryMacro;
    const endMacro = endProfile?.primaryMacro;
    const axisLengthKm = Math.max(axisStats.axisLengthKm || 0, 0.1);
    const progressRatio = axisStats.progressKm / axisLengthKm;

    score -= axisStats.lateralKm * 1.15 * pacing.lateralWeight;

    if (
      axisStats.progressKm < (arcTuning.progressStartSlackKm ?? -0.35) ||
      axisStats.progressKm > axisStats.axisLengthKm + (arcTuning.progressEndSlackKm ?? 0.9)
    ) {
      score -= 5.5;
    }

    if (startProfile?.primaryToken && itemProfile.primaryToken === startProfile.primaryToken) {
      score += 2.2;
    }
    if (endProfile?.primaryToken && itemProfile.primaryToken === endProfile.primaryToken) {
      score += 2.2;
    }
    if (startMacro && itemProfile.primaryMacro === startMacro) {
      score += 1.1;
    }
    if (endMacro && itemProfile.primaryMacro === endMacro) {
      score += 1.1;
    }
    if (
      itemProfile.primaryMacro &&
      ![startMacro, endMacro].includes(itemProfile.primaryMacro) &&
      !neutralArcMacros.has(itemProfile.primaryMacro)
    ) {
      score -= 2.6;
    }

    if (normalizeLegPacing(legPacing) === "short") {
      if (
        axisLengthKm > (arcTuning.shortBridgeMinAxisKm ?? 2.8) &&
        progressRatio >= (arcTuning.shortBridgeProgressMin ?? 0.18) &&
        progressRatio <= (arcTuning.shortBridgeProgressMax ?? 0.82) &&
        axisStats.lateralKm <= (arcTuning.shortBridgeMaxLateralKm ?? 1.05)
      ) {
        const bridgeBoost = 1 - Math.min(1, Math.abs(progressRatio - 0.5) / 0.5);
        score += 1.8 + bridgeBoost * 1.9;
      }

      const shortLateralPenaltyStartKm = arcTuning.shortLateralPenaltyStartKm ?? 1.4;
      if (axisStats.lateralKm > shortLateralPenaltyStartKm) {
        score -= (axisStats.lateralKm - shortLateralPenaltyStartKm) * 2.4;
      }
    }
  }

  const repeatedStopCount = item.id ? usedStopContext.stopIds.get(item.id) || 0 : 0;
  const repeatedDuplicateFamilyCount = item.duplicateFamily
    ? usedStopContext.duplicateFamilies.get(item.duplicateFamily) || 0
    : 0;

  if (repeatedStopCount) {
    score -= Math.min(9.5, repeatedStopCount * 4.8 * repeatMultiplier);
  } else if (repeatedDuplicateFamilyCount) {
    score -= Math.min(4.6, repeatedDuplicateFamilyCount * 1.8 * repeatMultiplier);
  }

  return Math.round(score * 10) / 10;
}

function scoreSupplementalPoolItem({
  item,
  template,
  shape,
  start,
  end,
  startProfile,
  endProfile,
  seedRouteArea,
  seedIds,
  seedDuplicateCounts,
  preferences = [],
  optimizerMode = null,
  modifier = null,
  strictTags = [],
  targetKm,
  distanceMode,
  liveEvents = [],
  legPacing = "balanced",
  usedRoutes = [],
  manualAnchorsLocked = false,
}) {
  if (!item || seedIds.has(item.id) || isAnchorDuplicateStop(item, start) || isAnchorDuplicateStop(item, end)) {
    return Number.NEGATIVE_INFINITY;
  }

  if (item.kind === "district-group") {
    return Number.NEGATIVE_INFINITY;
  }

  const itemProfile = buildItemAreaProfile(item);
  const pacing = legPacingConfig[normalizeLegPacing(legPacing)];
  const supplementalArcTuning = getRoutingTuning().supplementalArcScoring || {};
  const usedStopContext = buildUsedStopContext(usedRoutes);
  const repeatMultiplier = repeatDepthMultiplier(usedRoutes) * (manualAnchorsLocked ? 0.35 : 1);
  const distanceToStart = haversineKm(start, item);
  const distanceToEnd = haversineKm(end, item);
  let score = preferenceBoostForStop(item, preferences, optimizerMode, modifier, strictTags);
  score += item.anchorWeight || 1;
  if (item.isLiveEvent) {
    score += 4.2;
  }
  score += item.tags.filter((tag) => (template.preferenceTags || []).includes(tag)).length * 0.95;

  if (seedRouteArea.tokens.has(itemProfile.primaryToken)) {
    score += 3.3;
  } else if (seedRouteArea.macros.has(itemProfile.primaryMacro)) {
    score += 1.7;
  }

  const duplicatePenalty = seedDuplicateCounts.get(item.duplicateFamily) || 0;
  score -= duplicatePenalty * 1.1;
  const repeatedStopCount = item.id ? usedStopContext.stopIds.get(item.id) || 0 : 0;
  const repeatedDuplicateFamilyCount = item.duplicateFamily
    ? usedStopContext.duplicateFamilies.get(item.duplicateFamily) || 0
    : 0;

  if (repeatedStopCount) {
    score -= Math.min(8.4, repeatedStopCount * 4.1 * repeatMultiplier);
  } else if (repeatedDuplicateFamilyCount) {
    score -= Math.min(3.8, repeatedDuplicateFamilyCount * 1.5 * repeatMultiplier);
  }

  if (shape === "loop") {
    const anchorToken = startProfile?.primaryToken;
    const anchorMacro = startProfile?.primaryMacro;
    const radiusLimit = loopRadiusKm(targetKm, distanceMode) + 0.7;
    const preferredRadius = pacing.preferredMaxKm * 2.35;

    if (anchorToken && itemProfile.primaryToken === anchorToken) {
      score += 3.8;
    } else if (anchorMacro && itemProfile.primaryMacro === anchorMacro) {
      score += 2.1;
    } else if (anchorMacro && itemProfile.primaryMacro) {
      score -= distanceMode === "no_limit" ? 0.8 : 4.4;
    }

    if (distanceToStart > radiusLimit) {
      score -= (distanceToStart - radiusLimit) * 2.6;
    }

    if (distanceToStart > preferredRadius) {
      score -= (distanceToStart - preferredRadius) * pacing.radiusBonusWeight * 1.3;
    }
  } else {
    const axisStats = projectPointToAxis(item, start, end);
    const axisLengthKm = Math.max(axisStats.axisLengthKm || 0, 0.1);
    const progressRatio = axisStats.progressKm / axisLengthKm;

    score -= axisStats.lateralKm * 0.9 * pacing.lateralWeight;

    if (
      axisStats.progressKm < (supplementalArcTuning.progressStartSlackKm ?? -0.45) ||
      axisStats.progressKm >
        axisStats.axisLengthKm + (supplementalArcTuning.progressEndSlackKm ?? 1.1)
    ) {
      score -= 5;
    }

    if (startProfile?.primaryMacro && itemProfile.primaryMacro === startProfile.primaryMacro) {
      score += 1.4;
    }
    if (endProfile?.primaryMacro && itemProfile.primaryMacro === endProfile.primaryMacro) {
      score += 1.4;
    }

    const shortLateralPenaltyStartKm =
      supplementalArcTuning.shortLateralPenaltyStartKm ?? 1.35;
    if (normalizeLegPacing(legPacing) === "short" && axisStats.lateralKm > shortLateralPenaltyStartKm) {
      score -= (axisStats.lateralKm - shortLateralPenaltyStartKm) * 1.9;
    }

    if (
      normalizeLegPacing(legPacing) === "short" &&
      axisLengthKm > (supplementalArcTuning.shortBridgeMinAxisKm ?? 2.8) &&
      progressRatio >= (supplementalArcTuning.shortBridgeProgressMin ?? 0.16) &&
      progressRatio <= (supplementalArcTuning.shortBridgeProgressMax ?? 0.84) &&
      axisStats.lateralKm <= (supplementalArcTuning.shortBridgeMaxLateralKm ?? 1.1)
    ) {
      const bridgeBoost = 1 - Math.min(1, Math.abs(progressRatio - 0.5) / 0.5);
      score += 2 + bridgeBoost * 2.1;
    }
  }

  liveEvents.forEach((event) => {
    if (typeof event.lat !== "number" || typeof event.lng !== "number") {
      return;
    }

    const distanceKm = haversineKm(item, event);
    const tagHits = preferences.filter((preference) => (event.match_tags || []).includes(preference)).length;

    if (distanceKm <= 0.45) {
      score += 2.8 + tagHits * 0.6;
    } else if (distanceKm <= 1.1) {
      score += 1.2 + tagHits * 0.35;
    }
  });

  return Number(score.toFixed(1));
}

function buildStopPool(
  template,
  start,
  end,
  preferences = [],
  optimizerMode = null,
  modifier = null,
  targetKm = 8,
  distanceMode = "soft_target",
  liveEvents = [],
  options = {},
) {
  const shape = isLoopRoute(start, end) ? "loop" : "arc";
  const legPacing = normalizeLegPacing(options.legPacing);
  const dayProfile = normalizeDayProfile(options.dayProfile);
  const startProfile = buildPointAreaProfile(start);
  const endProfile = buildPointAreaProfile(end);
  const manualAnchorsLocked = Boolean(options.manualAnchorsLocked);
  const liveEventCandidates = buildLiveEventStopCandidates(
    liveEvents,
    preferences,
    optimizerMode,
    modifier,
    {
      shape,
      start,
      end,
      startProfile,
      endProfile,
      includeLiveEvents: Boolean(options.includeLiveEvents),
    },
  );
  const lockedCorridorTuning = getRoutingTuning().lockedCorridor || {};
  const corridorLimitKm = clamp(
    Math.max(
      targetKm * (lockedCorridorTuning.targetFactor ?? 0.22),
      lockedCorridorTuning.minLateralKm ?? 1.2,
    ),
    lockedCorridorTuning.minLateralKm ?? 1.2,
    distanceMode === "no_limit"
      ? lockedCorridorTuning.noLimitMaxLateralKm ?? 3.6
      : lockedCorridorTuning.maxLateralKm ?? 2.8,
  );
  const candidateFitsLockedCorridor = (item) => {
    if (!manualAnchorsLocked || shape !== "arc") {
      return true;
    }

    const axis = projectPointToAxis(item, start, end);

    if (
      axis.progressKm < (lockedCorridorTuning.progressStartSlackKm ?? -0.45) ||
      axis.progressKm > axis.axisLengthKm + (lockedCorridorTuning.progressEndSlackKm ?? 0.85)
    ) {
      return false;
    }

    if (axis.lateralKm > corridorLimitKm) {
      return false;
    }

    return true;
  };
  const baseSeedStops = template.stops
    .map((stopId) => findCatalogItemByName(stopId))
    .filter(Boolean)
    .filter((item) => !isAnchorDuplicateStop(item, start) && !isAnchorDuplicateStop(item, end));
  const filteredSeedStops = baseSeedStops.filter(candidateFitsLockedCorridor);
  const seededPool =
    filteredSeedStops.length > 0
      ? filteredSeedStops
      : manualAnchorsLocked && shape === "arc"
        ? []
        : baseSeedStops;
  const basePool = uniqueStops(seededPool);

  const templateSeedStops = basePool.length ? basePool : baseSeedStops;
  const templateSeedRouteArea = buildRouteAreaProfile(templateSeedStops);
  const templateSeedIds = new Set(templateSeedStops.map((item) => item.id));
  const templateSeedDuplicateCounts = templateSeedStops.reduce((counts, item) => {
    if (item.duplicateFamily) {
      counts.set(item.duplicateFamily, (counts.get(item.duplicateFamily) || 0) + 1);
    }
    return counts;
  }, new Map());
  const strictTags = resolveStrictPreferenceTags(preferences, optimizerMode);
  const catalogSeedLimit = manualAnchorsLocked && shape === "arc"
    ? distanceMode === "no_limit"
      ? 7
      : targetKm <= 6
        ? 4
        : targetKm <= 9
          ? 5
          : 6
    : distanceMode === "no_limit"
      ? 4
      : targetKm <= 6
        ? 2
        : targetKm <= 9
          ? 3
          : 4;
  const effectiveCatalogSeedLimit =
    manualAnchorsLocked && shape === "arc" && legPacing === "short"
      ? catalogSeedLimit + 1
      : catalogSeedLimit;
  const catalogSeedThreshold =
    manualAnchorsLocked && shape === "arc"
      ? strictTags.length
        ? 0.4
        : 0.8
      : strictTags.length
        ? 1.6
        : 2.1;
  const catalogSeedCandidates = uniqueStops([...getAllItems(), ...liveEventCandidates])
    .filter((item) => !isAnchorDuplicateStop(item, start) && !isAnchorDuplicateStop(item, end))
    .filter((item) => !templateSeedIds.has(item.id))
    .filter((item) => candidateFitsLockedCorridor(item))
    .map((item) => ({
      item,
        score: scoreSupplementalPoolItem({
          item,
          template,
          shape,
        start,
        end,
        startProfile,
        endProfile,
        seedRouteArea: templateSeedRouteArea,
        seedIds: templateSeedIds,
        seedDuplicateCounts: templateSeedDuplicateCounts,
        preferences,
        optimizerMode,
        modifier,
        strictTags,
          targetKm,
          distanceMode,
          liveEvents,
          legPacing,
          usedRoutes: options.usedRoutes || [],
          manualAnchorsLocked,
        }),
    }))
    .filter((entry) => Number.isFinite(entry.score))
    .filter((entry) => entry.score > catalogSeedThreshold)
    .sort((left, right) => right.score - left.score)
    .slice(0, effectiveCatalogSeedLimit)
    .map((entry) => entry.item);
  const hybridBasePool = uniqueStops([...basePool, ...catalogSeedCandidates]);

  if (!hybridBasePool.length && !manualAnchorsLocked) {
    return [];
  }

  const seedRouteArea = buildRouteAreaProfile(hybridBasePool.length ? hybridBasePool : templateSeedStops);
  const seedIds = new Set(hybridBasePool.map((item) => item.id));
  const seedDuplicateCounts = (hybridBasePool.length ? hybridBasePool : templateSeedStops).reduce((counts, item) => {
    if (item.duplicateFamily) {
      counts.set(item.duplicateFamily, (counts.get(item.duplicateFamily) || 0) + 1);
    }
    return counts;
  }, new Map());
  const supplementalLimit = manualAnchorsLocked && shape === "arc"
    ? distanceMode === "no_limit"
      ? 10
      : targetKm <= 6
        ? 6
        : targetKm <= 9
          ? 8
          : 10
    : distanceMode === "no_limit"
      ? 4
      : targetKm <= 6
        ? 2
        : targetKm <= 9
          ? 3
          : 4;
  const effectiveSupplementalLimit =
    manualAnchorsLocked && shape === "arc" && legPacing === "short"
      ? supplementalLimit + 2
      : supplementalLimit;
  const supplementalThreshold =
    manualAnchorsLocked && shape === "arc"
      ? strictTags.length
        ? 0.8
        : 1.2
      : strictTags.length
        ? 2.2
        : 3;
  const scoreSupplementalCandidate = (item) => ({
    item,
    score: scoreSupplementalPoolItem({
      item,
      template,
      shape,
      start,
      end,
      startProfile,
      endProfile,
      seedRouteArea,
      seedIds,
      seedDuplicateCounts,
      preferences,
      optimizerMode,
      modifier,
      strictTags,
      targetKm,
      distanceMode,
      liveEvents,
      legPacing,
      usedRoutes: options.usedRoutes || [],
      manualAnchorsLocked,
    }),
  });
  const passesSupplementalThreshold = (entry) =>
    Number.isFinite(entry.score) && entry.score > supplementalThreshold;

  const verifiedSupplemental = [...getAllItems(), ...liveEventCandidates]
    .filter((item) => candidateFitsLockedCorridor(item))
    .map(scoreSupplementalCandidate)
    .filter(passesSupplementalThreshold)
    .sort((left, right) => right.score - left.score);

  // Provisional source candidates only ever enter the agnostic-compose path,
  // and only AFTER every qualifying verified item — verified entries are
  // concatenated first, so provisional candidates can fill nothing but the
  // slots verified items left empty once we slice to effectiveSupplementalLimit.
  // This keeps the route spine + verified-dense neighborhoods byte-identical
  // while thin neighborhoods gain honest, clearly-marked fill.
  const provisionalSupplemental =
    template.id === AGNOSTIC_COMPOSE_TEMPLATE_ID
      ? buildProvisionalComposeStops()
          .filter((item) => candidateFitsLockedCorridor(item))
          .map(scoreSupplementalCandidate)
          .filter(passesSupplementalThreshold)
          .sort((left, right) => right.score - left.score)
      : [];

  const supplemental = [...verifiedSupplemental, ...provisionalSupplemental]
    .slice(0, effectiveSupplementalLimit)
    .map((entry) => entry.item);

  return uniqueStops([...hybridBasePool, ...supplemental]);
}

function permuteStops(items) {
  if (items.length <= 1) {
    return [items];
  }

  const permutations = [];

  items.forEach((item, index) => {
    const remaining = [...items.slice(0, index), ...items.slice(index + 1)];
    permuteStops(remaining).forEach((tail) => {
      permutations.push([item, ...tail]);
    });
  });

  return permutations;
}

function summarizeLoopGeometry(orderedStops, start, end, startProfile, targetKm, distanceMode, legPacing = "balanced", lang = "sv") {
  const points = [start, ...orderedStops, end];
  const estimatedKm = walkingKm(points);
  const legs = buildRouteLegs(points);
  const legMetrics = buildLegMetrics(legs, legPacing, { shape: "loop", lang });
  const firstGap = orderedStops[0] ? haversineKm(start, orderedStops[0]) : 0;
  const lastGap = orderedStops.length ? haversineKm(end, orderedStops[orderedStops.length - 1]) : 0;
  const radiusLimit = loopRadiusKm(targetKm, distanceMode);
  const maxRadius = orderedStops.reduce((max, stop) => Math.max(max, haversineKm(start, stop)), 0);
  const macroDrift = orderedStops.reduce((sum, stop) => {
    const macro = buildItemAreaProfile(stop).primaryMacro;
    if (!macro || !startProfile?.primaryMacro || macro === startProfile.primaryMacro) {
      return sum;
    }
    return sum + 1;
  }, 0);
  const edgePenalty =
    Math.max(0, firstGap - 1.25) * 2.3 + Math.max(0, lastGap - 1.25) * 2.3;
  const radiusPenalty = Math.max(0, maxRadius - radiusLimit) * 2.1;
  const driftPenalty = macroDrift * (distanceMode === "no_limit" ? 0.7 : 1.8);
  const kmPenalty =
    distanceMode === "no_limit" || !targetKm
      ? 0
      : Math.max(0, Math.abs(estimatedKm - targetKm) - 1.6) * 0.9;
  const objective = estimatedKm + edgePenalty + radiusPenalty + driftPenalty + kmPenalty + legMetrics.penalty;

  return {
    estimatedKm,
    objective,
    legs,
    firstGap,
    lastGap,
    maxRadius,
    macroDrift,
    longestLegKm: legMetrics.longestLegKm,
    longestLegMinutes: legMetrics.longestLegMinutes,
    averageLegKm: legMetrics.averageLegKm,
    averageLegMinutes: legMetrics.averageLegMinutes,
    legPenalty: legMetrics.penalty,
    legFitNote: legMetrics.note,
    qualityScore: Math.max(0, 13 - edgePenalty - radiusPenalty - driftPenalty - kmPenalty - legMetrics.penalty),
  };
}

function summarizeArcGeometry(orderedStops, start, end, startProfile, endProfile, targetKm, distanceMode, legPacing = "balanced", lang = "sv") {
  const points = [start, ...orderedStops, end];
  const estimatedKm = walkingKm(points);
  const legs = buildRouteLegs(points);
  const legMetrics = buildLegMetrics(legs, legPacing, { shape: "arc", lang });
  const lateHopMetrics = buildArcLateHopMetrics(legs, legPacing);
  const directKm = Math.max(0.4, haversineKm(start, end) * 1.22);
  const firstGap = orderedStops[0] ? haversineKm(start, orderedStops[0]) : 0;
  const lastGap = orderedStops.length ? haversineKm(end, orderedStops[orderedStops.length - 1]) : 0;
  let previousProgress = -0.4;
  let reversals = 0;
  let lateralTotal = 0;
  let macroDrift = 0;

  orderedStops.forEach((stop) => {
    const axis = projectPointToAxis(stop, start, end);
    const macro = buildItemAreaProfile(stop).primaryMacro;
    lateralTotal += axis.lateralKm;
    if (axis.progressKm + 0.15 < previousProgress) {
      reversals += previousProgress - axis.progressKm;
    }
    previousProgress = Math.max(previousProgress, axis.progressKm);

    if (
      macro &&
      ![startProfile?.primaryMacro, endProfile?.primaryMacro, "center"].includes(macro)
    ) {
      macroDrift += 1;
    }
  });

  const edgePenalty =
    Math.max(0, firstGap - 1.4) * 2.6 + Math.max(0, lastGap - 1.4) * 2.6;
  const detourPenalty = Math.max(0, estimatedKm - directKm * 1.8) * 1.4;
  const progressionPenalty =
    reversals * 3.6 + lateralTotal * 0.95 + macroDrift * 0.9 + lateHopMetrics.penalty;
  const kmPenalty =
    distanceMode === "no_limit" || !targetKm
      ? 0
      : Math.max(0, Math.abs(estimatedKm - targetKm) - 1.8) * 0.75;
  const objective = estimatedKm + edgePenalty + detourPenalty + progressionPenalty + kmPenalty + legMetrics.penalty;

  return {
    estimatedKm,
    objective,
    legs,
    firstGap,
    lastGap,
    directKm,
    reversals,
    lateralTotal,
    macroDrift,
    lateHopCount: lateHopMetrics.count,
    lateHopPenalty: lateHopMetrics.penalty,
    longestLegKm: legMetrics.longestLegKm,
    longestLegMinutes: legMetrics.longestLegMinutes,
    averageLegKm: legMetrics.averageLegKm,
    averageLegMinutes: legMetrics.averageLegMinutes,
    legPenalty: legMetrics.penalty,
    legFitNote: legMetrics.note,
    qualityScore: Math.max(
      0,
      13 - edgePenalty - detourPenalty - progressionPenalty - kmPenalty - legMetrics.penalty,
    ),
  };
}

function optimizeStopOrder(selectedStops, shape, start, end, startProfile, endProfile, targetKm, distanceMode, legPacing = "balanced", lang = "sv") {
  if (selectedStops.length <= 1) {
    const summary =
      shape === "loop"
        ? summarizeLoopGeometry(selectedStops, start, end, startProfile, targetKm, distanceMode, legPacing, lang)
        : summarizeArcGeometry(
            selectedStops,
            start,
            end,
            startProfile,
            endProfile,
            targetKm,
            distanceMode,
            legPacing,
            lang,
          );

    return {
      orderedStops: selectedStops,
      geometry: summary,
    };
  }

  let bestOrder = selectedStops;
  let bestGeometry = null;

  permuteStops(selectedStops).forEach((candidate) => {
    const geometry =
      shape === "loop"
        ? summarizeLoopGeometry(candidate, start, end, startProfile, targetKm, distanceMode, legPacing, lang)
        : summarizeArcGeometry(
            candidate,
            start,
            end,
            startProfile,
            endProfile,
            targetKm,
            distanceMode,
            legPacing,
            lang,
          );

    if (!bestGeometry || geometry.objective < bestGeometry.objective) {
      bestGeometry = geometry;
      bestOrder = candidate;
    }
  });

  return {
    orderedStops: bestOrder,
    geometry: bestGeometry,
  };
}

function buildRouteLegs(points) {
  const legs = [];

  for (let index = 1; index < points.length; index += 1) {
    const distanceKm = Number((haversineKm(points[index - 1], points[index]) * 1.22).toFixed(1));
    legs.push({
      from_label: points[index - 1].label || points[index - 1].name || null,
      to_label: points[index].label || points[index].name || null,
      distance_km: distanceKm,
      estimated_walk_minutes: estimatedWalkMinutes(distanceKm),
    });
  }

  return legs;
}

function buildArcLateHopMetrics(legs = [], legPacing = "balanced") {
  const pacingKey = normalizeLegPacing(legPacing);
  const pacing = legPacingConfig[pacingKey];
  const continuity = getRouteContinuityConfig(pacingKey);
  const distances = legs
    .map((leg) => Number(leg.distance_km))
    .filter((distance) => Number.isFinite(distance));

  if (distances.length < 4) {
    return { count: 0, penalty: 0 };
  }

  const lateHopThreshold = Math.max(
    pacing.preferredMaxKm * (pacingKey === "short" ? 1.55 : pacingKey === "balanced" ? 1.75 : 2.1),
    continuity.reportMaxKm * (pacingKey === "short" ? 0.72 : 0.82),
  );
  let count = 0;
  let penalty = 0;

  distances.forEach((distance, index) => {
    if (index < 2 || distance <= lateHopThreshold) {
      return;
    }

    const previous = distances.slice(0, index);
    const previousAverage = previous.reduce((sum, value) => sum + value, 0) / previous.length;
    const previousClustered = previousAverage <= pacing.preferredMaxKm * 0.92;

    if (!previousClustered) {
      return;
    }

    count += 1;
    penalty += (distance - lateHopThreshold) * (pacingKey === "short" ? 5.2 : pacingKey === "balanced" ? 3.4 : 1.4);
  });

  return {
    count,
    penalty: Number(penalty.toFixed(1)),
  };
}

function buildLegMetrics(legs = [], legPacing = "balanced", { shape = "loop", lang = "sv" } = {}) {
  const pacingKey = normalizeLegPacing(legPacing);
  const pacing = legPacingConfig[pacingKey];
  const continuity = getRouteContinuityConfig(pacingKey);
  const validLegs = legs.filter((leg) => Number.isFinite(leg.distance_km));

  if (!validLegs.length) {
    return {
      longestLegKm: 0,
      longestLegMinutes: null,
      averageLegKm: 0,
      averageLegMinutes: null,
      longLegCount: 0,
      routeContinuityScore: 10,
      deadWalkPenalty: 0,
      penalty: 0,
      note: null,
      warnings: [],
    };
  }

  const distances = validLegs.map((leg) => leg.distance_km);
  const totalDistance = distances.reduce((sum, distance) => sum + distance, 0);
  const longestLegKm = Math.max(...distances);
  const averageLegKm = totalDistance / distances.length;
  const longestLegMinutes = estimatedWalkMinutes(longestLegKm);
  const averageLegMinutes = estimatedWalkMinutes(averageLegKm);
  const sortedDistances = [...distances].sort((left, right) => right - left);
  const secondLongestKm = sortedDistances[1] ?? averageLegKm;
  const overflowPenalty = distances.reduce((sum, distance) => {
    return sum + Math.max(0, distance - pacing.preferredMaxKm) * pacing.overflowWeight;
  }, 0);
  const variancePenalty = Math.max(0, longestLegKm - averageLegKm - 0.35) * pacing.varianceWeight;
  const outlierGapKm =
    validLegs.length >= 2
      ? Math.max(
          0,
          longestLegKm -
            Math.max(
              averageLegKm + (shape === "arc" ? 0.42 : 0.52),
              secondLongestKm + (shape === "arc" ? 0.28 : 0.36),
            ),
        )
      : 0;
  const outlierWeights = {
    short: shape === "arc" ? 6.2 : 4.3,
    balanced: shape === "arc" ? 2.9 : 1.9,
    flexible: shape === "arc" ? 1.1 : 0.7,
  };
  const outlierPenalty = outlierGapKm * outlierWeights[pacingKey];
  const reportMaxKm =
    shape === "arc" && pacingKey === "flexible"
      ? Math.min(continuity.reportMaxKm, routeContinuityConfig.balanced.reportMaxKm)
      : continuity.reportMaxKm;
  const longLegs = validLegs.filter((leg) => leg.distance_km > reportMaxKm);
  const severeLongLegCount = longLegs.filter((leg) => leg.distance_km >= continuity.severeLegKm).length;
  const deadWalkPenalty =
    longLegs.reduce(
      (sum, leg) => sum + Math.max(0, leg.distance_km - reportMaxKm) * continuity.deadWalkWeight,
      0,
    ) +
    severeLongLegCount * (pacingKey === "short" ? 1.8 : pacingKey === "balanced" ? 1.2 : 0.5) +
    Math.max(0, longLegs.length - 1) * (pacingKey === "short" ? 0.9 : pacingKey === "balanced" ? 0.6 : 0.25);
  const penalty = overflowPenalty + variancePenalty + outlierPenalty + deadWalkPenalty;
  const routeContinuityScore = clamp(
    10 - deadWalkPenalty - Math.max(0, longestLegKm - reportMaxKm) * 0.4,
    0,
    10,
  );
  let note = null;
  const warnings = [];

  if (!longLegs.length && penalty <= 0.8) {
    note = routeText(
      lang,
      "Etapperna håller sig jämna och lätta att följa till fots.",
      "The walking legs stay even and easy to follow on foot.",
    );
  } else if (longLegs.length && pacingKey === "flexible") {
    note = routeText(
      lang,
      "Rutten tillater lite längre ben i utbyte mot starkare helhet, men ett tydligt transportben finns kvar.",
      "The route allows a longer walking transfer in exchange for a stronger overall day, but one clear transfer leg still remains.",
    );
    warnings.push(
      routeText(
        lang,
        "Rutten innehåller ett längre gångben mellan två kluster. Kör den om du vill ha tätare flöde.",
        "This route includes a longer walking leg between clusters. Reroll it if you want a tighter flow.",
      ),
    );
  } else if (longLegs.length) {
    note = routeText(
      lang,
      "Rutten håller ihop stora delar av dagen, men ett längre gångben mellan kluster drar ner flödet.",
      "The route holds together for most of the day, but one longer walking transfer between clusters still drags on the flow.",
    );
    warnings.push(
      routeText(
        lang,
        "Rutten innehåller fortfarande ett längre gångben mellan kluster.",
        "The route still contains a longer walking leg between clusters.",
      ),
    );
  } else if (outlierPenalty > overflowPenalty + variancePenalty && pacingKey === "short") {
    note =
      shape === "arc"
        ? routeText(
            lang,
            "Kort trycker ner långa hopp, men ett tydligt mellanben sticker fortfarande ut i bågen.",
            "Short-leg mode keeps long jumps down, but one middle leg still stands out in the route.",
          )
        : routeText(
            lang,
            "Kort försöker hålla rundan jämn, men ett enskilt ben drar fortfarande iväg lite.",
            "Short-leg mode keeps the loop even, but one leg still stretches a little.",
          );
  } else if (pacingKey === "short") {
    note = routeText(
      lang,
      "Rutten försöker hålla benen korta, men ett eller två hopp blir fortfarande lite längre än idealet.",
      "The route tries to keep walking legs short, but one or two hops are still a little longer than ideal.",
    );
  } else if (pacingKey === "flexible") {
    note = routeText(
      lang,
      "Rutten tillåter friare ben för att helheten ska bli starkare.",
      "The route allows freer walking legs so the overall day can be stronger.",
    );
  } else {
    note = routeText(
      lang,
      "Benlängderna är överlag rimliga, men några etapper blir lite längre för att hålla dagen stark.",
      "The walking legs are mostly reasonable, with a few slightly longer stretches to keep the day strong.",
    );
  }

  return {
    longestLegKm: Number(longestLegKm.toFixed(1)),
    longestLegMinutes,
    averageLegKm: Number(averageLegKm.toFixed(1)),
    averageLegMinutes,
    longLegCount: longLegs.length,
    routeContinuityScore: Number(routeContinuityScore.toFixed(1)),
    deadWalkPenalty: Number(deadWalkPenalty.toFixed(1)),
    penalty: Number(penalty.toFixed(1)),
    note,
    warnings,
  };
}

async function applyWalkingTruthToRoute(route, { legPacing = "balanced", lang = "sv" } = {}) {
  if (!route || !Array.isArray(route.map_route_points) || route.map_route_points.length < 2) {
    return route;
  }

  const truth = await routeWalkingPath(route.map_route_points, {
    walkingConfig: getWalkingConfig(),
  });
  const metrics = buildLegMetrics(truth.legs || [], legPacing, {
    shape: route.route_shape || "loop",
    lang,
  });
  const providerNote =
    truth.source === "osrm"
      ? routeText(lang, "Verifierad med riktig gångrouting.", "Verified with real walking routing.")
      : routeText(
          lang,
          "Gångbenen bygger just nu på heuristisk routing.",
          "Walking legs currently use heuristic routing.",
        );
  const existingGeoNote = route.geo_fit_note ? `${route.geo_fit_note} ` : "";

  return copyRouteLineage(
    route,
    {
      ...route,
      estimated_km: Number((truth.estimatedKm || route.estimated_km || 0).toFixed(1)),
      legs: truth.legs || route.legs || [],
      longest_leg_km: metrics.longestLegKm,
      longest_leg_minutes: metrics.longestLegMinutes,
      average_leg_minutes: metrics.averageLegMinutes,
      long_leg_count: metrics.longLegCount,
      route_continuity_score: metrics.routeContinuityScore,
      dead_walk_penalty: metrics.deadWalkPenalty,
      leg_fit_note: metrics.note,
      route_quality_warnings: metrics.warnings,
      map_path_points:
        Array.isArray(truth.pathPoints) && truth.pathPoints.length
          ? truth.pathPoints
          : route.map_path_points || route.map_route_points,
      routing_source: truth.source || "heuristic",
      geo_fit_note: `${existingGeoNote}${providerNote}`.trim(),
    },
  );
}

function withRouteLineage(route, updates = {}) {
  return copyRouteLineage(route, { ...route, ...updates });
}

function buildAnchorZone(shape, startProfile, endProfile, routeArea) {
  if (shape === "loop") {
    return startProfile?.primaryLabel || tokenLabel(routeArea.dominantToken) || currentCityLabel();
  }

  if (startProfile?.primaryLabel && endProfile?.primaryLabel) {
    return `${startProfile.primaryLabel} -> ${endProfile.primaryLabel}`;
  }

  return tokenLabel(routeArea.dominantToken) || currentCityLabel();
}

function routeToneLabel(optimizerMode, modifier, preferences = [], routeStops = [], weekday = null, lang = "sv") {
  const activeModifier = normalizeModifier(modifier, optimizerMode);
  const secondHandFit = buildSecondHandIntentFit(routeStops, preferences, weekday);
  const en = isEnglishRouteResult(lang);

  if (preferences.includes("second_hand") && secondHandFit.coverage >= 0.34) {
    if (preferences.includes("vin") || preferences.includes("mat")) {
      return en ? "second hand + wine" : "second hand + vin";
    }
    if (preferences.includes("nattliv") || preferences.includes("cocktail") || preferences.includes("kväll")) {
      return en ? "second hand + evening" : "second hand + kväll";
    }
    if (preferences.includes("kultur") || preferences.includes("kyrkor") || preferences.includes("klassiker")) {
      return "second hand + kultur";
    }

    return secondHandFit.identity === "market-strong"
      ? routeText(lang, "marknad och vintage", "market and vintage")
      : routeText(lang, "second hand och vintage", "second hand and vintage");
  }

  if (optimizerMode === "bar-hop") {
    return "barhopping";
  }
  if (optimizerMode === "wine-crawl") {
    return en ? "wine and food" : "vin och mat";
  }
  if (optimizerMode === "cocktail-night") {
    return en ? "cocktails and late night" : "cocktails och natt";
  }
  if (optimizerMode === "church-crawl") {
    return en ? "churches and culture" : "kyrkor och kultur";
  }
  if (optimizerMode === "pizza-freak") {
    return en ? "pizza and neighborhoods" : "pizza och kvarter";
  }
  if (optimizerMode === "sunset-spots") {
    return en ? "light and views" : "ljus och utsikter";
  }
  if (activeModifier === "party") {
    return routeModifierLabel(activeModifier, lang);
  }
  if (activeModifier === "evening") {
    return routeModifierLabel(activeModifier, lang);
  }
  if (activeModifier === "culture") {
    return routeModifierLabel(activeModifier, lang);
  }
  if (activeModifier === "low_key") {
    return routeModifierLabel(activeModifier, lang);
  }
  if (preferences.includes("vin")) {
    return en ? "wine and city" : "vin och stad";
  }
  if (preferences.includes("kultur")) {
    return en ? "culture and walking" : "kultur och promenad";
  }
  return en ? "local rhythm" : "lokal rytm";
}

function buildDynamicTitle({
  start,
  end,
  shape,
  routeArea,
  optimizerMode,
  modifier,
  preferences,
  routeStops = [],
  weekday = null,
  lang = "sv",
}) {
  const dominantZone =
    tokenLabel(routeArea.dominantToken) || macroLabel(routeArea.dominantMacro) || currentCityLabel();
  const tone = routeToneLabel(optimizerMode, modifier, preferences, routeStops, weekday, lang);

  if (shape === "loop") {
    return `${start.label} loop • ${dominantZone} • ${tone}`;
  }

  return routeText(
    lang,
    `${start.label} till ${end.label} • ${dominantZone} • ${tone}`,
    `${start.label} to ${end.label} • ${dominantZone} • ${tone}`,
  );
}

function buildDynamicSummary({
  start,
  end,
  shape,
  routeArea,
  estimatedKm,
  optimizerMode,
  modifier,
  preferences,
  routeStops = [],
  weekday = null,
  lang = "sv",
}) {
  const dominantZone =
    tokenLabel(routeArea.dominantToken) || macroLabel(routeArea.dominantMacro) || currentCityLabel();
  const tone = routeToneLabel(optimizerMode, modifier, preferences, routeStops, weekday, lang);
  const secondHandFit = buildSecondHandIntentFit(routeStops, preferences, weekday);

  if (preferences.includes("second_hand") && secondHandFit.coverage >= 0.34) {
    const carryText =
      secondHandFit.identity === "market-strong"
        ? routeText(
            lang,
            "där marknadsspåret faktiskt får bära dagen",
            "where the market thread can actually carry the day",
          )
        : routeText(
            lang,
            "där vintage- och butiksspåret faktiskt får bära dagen",
            "where the vintage and shop thread can actually carry the day",
          );

    if (shape === "loop") {
      return routeText(
        lang,
        `En sammanhängande runda på cirka ${estimatedKm.toFixed(1)} km runt ${dominantZone} ${carryText} i stället för att bara dyka upp som bonus.`,
        `A coherent loop of ${formatApproxKm(estimatedKm, lang)} around ${dominantZone}, ${carryText} instead of showing up as a bonus.`,
      );
    }

    return routeText(
      lang,
      `En tydlig båge på cirka ${estimatedKm.toFixed(1)} km från ${start.label} mot ${end.label}, med tyngd i ${dominantZone} där second hand-spåret fortfarande märks tydligt.`,
      `A clear route of ${formatApproxKm(estimatedKm, lang)} from ${start.label} toward ${end.label}, with weight in ${dominantZone} where the second-hand thread still comes through.`,
    );
  }

  if (shape === "loop") {
    return routeText(
      lang,
      `En sammanhängande runda på cirka ${estimatedKm.toFixed(1)} km som utgår från ${start.label}, håller sig runt ${dominantZone} och lutar mot ${tone}.`,
      `A coherent loop of ${formatApproxKm(estimatedKm, lang)} starting from ${start.label}, staying around ${dominantZone}, and leaning toward ${tone}.`,
    );
  }

  return routeText(
    lang,
    `En tydlig båge på cirka ${estimatedKm.toFixed(1)} km från ${start.label} mot ${end.label}, med tyngd i ${dominantZone} och mer ${tone}.`,
    `A clear route of ${formatApproxKm(estimatedKm, lang)} from ${start.label} toward ${end.label}, with weight in ${dominantZone} and more ${tone}.`,
  );
}

function buildGeoFitNote({ shape, start, end, geometry, routeArea, startProfile, endProfile, lang = "sv" }) {
  const dominantZone =
    tokenLabel(routeArea.dominantToken) || macroLabel(routeArea.dominantMacro) || currentCityLabel();
  const legNote = geometry?.legFitNote ? ` ${geometry.legFitNote}` : "";

  if (shape === "loop") {
    return routeText(
      lang,
      `Loop runt ${startProfile?.primaryLabel || start.label}: stoppordningen minimerar retursträckor och håller sig huvudsakligen kring ${dominantZone}.${legNote}`,
      `Loop around ${startProfile?.primaryLabel || start.label}: the stop order minimizes backtracking and stays mainly around ${dominantZone}.${legNote}`,
    );
  }

  return routeText(
    lang,
    `Båge från ${start.label} mot ${end.label}: rutten rör sig framåt genom ${dominantZone} utan stora geografiska reversaler.${legNote}`,
    `Route from ${start.label} toward ${end.label}: the day keeps moving forward through ${dominantZone} without major geographic reversals.${legNote}`,
  );
}

function formatMainStop(stop) {
  const formatted = {
    id: stop.id,
    label: stop.name,
    lat: stop.lat,
    lng: stop.lng,
    type: stop.kind,
    area: stop.area,
    tags: stop.tags,
    price_level: stop.priceLevel,
    best_time: stop.bestTime,
    vibe: stop.vibe,
    summary: stop.openingSummary || stop.longDescription || null,
    opening_summary: stop.openingSummary,
    dwell_type: stop.dwellType,
    cluster_token: stop.clusterToken,
    duplicate_family: stop.duplicateFamily,
    drawer_query: stop.drawerQuery || stop.name,
    is_live_event: Boolean(stop.isLiveEvent),
    event_id: stop.eventId || null,
    anchor_weight: typeof stop.anchorWeight === "number" ? stop.anchorWeight : null,
  };

  // Honest provenance for provisional source candidates: a stop that did not
  // come from the verified catalog carries its source/trust so the UI and API
  // can mark it clearly instead of presenting it as full citypack confidence.
  if (stop.provisional === true) {
    formatted.provisional = true;
    formatted.source = stop.source || null;
    formatted.trust = stop.trust || null;
    formatted.provenance = stop.provenance || null;
  }

  return formatted;
}

function resolveRouteStopData(stop) {
  const catalogItem = findCatalogItemByIdOrName(stop.id);

  if (catalogItem) {
    return catalogItem;
  }

  return {
    id: stop.id,
    name: stop.label,
    lat: stop.lat,
    lng: stop.lng,
    kind: stop.type || "stop",
    area: stop.area || currentCityLabel(),
    tags: Array.isArray(stop.tags) ? stop.tags : [],
    priceLevel: stop.price_level || null,
    bestTime: stop.best_time || null,
    vibe: stop.vibe || null,
    openingSummary: stop.opening_summary || stop.summary || null,
    closedWeekdays: [],
    happyHourNote: null,
    bookingRequired: Boolean(stop.is_live_event),
    clusterToken: stop.cluster_token || null,
    duplicateFamily: stop.duplicate_family || stop.type || "stop",
    isLiveEvent: Boolean(stop.is_live_event),
    eventId: stop.event_id || null,
  };
}

function nearestPointDistanceKm(point, routePoints = []) {
  if (!routePoints.length) {
    return Number.POSITIVE_INFINITY;
  }

  return routePoints.reduce((closest, routePoint) => {
    const distanceKm = haversineKm(point, routePoint);
    return Math.min(closest, distanceKm);
  }, Number.POSITIVE_INFINITY);
}

function isBarRouteMentionCandidate(item) {
  if (!item || autoAnchorKinds.has(item.kind) || item.isLiveEvent) {
    return false;
  }

  return (
    item.kind === "bar" ||
    item.kind.includes("bar") ||
    item.kind.includes("cocktail") ||
    item.tags.some((tag) => routeMentionBarTags.has(tag))
  );
}

function isHiddenRouteMentionCandidate(item) {
  if (!item || autoAnchorKinds.has(item.kind) || item.isLiveEvent) {
    return false;
  }

  return item.tags.some((tag) => routeMentionHiddenTags.has(tag));
}

function pickRouteMentions(candidates = [], limit = 4) {
  const picked = [];
  const seenNames = new Set();
  const seenFamilies = new Set();

  candidates
    .sort((left, right) => right.score - left.score)
    .forEach(({ item }) => {
      if (!item || picked.length >= limit) {
        return;
      }

      const nameKey = slugifyText(item.name);
      const familyKey = item.duplicateFamily || null;

      if (seenNames.has(nameKey)) {
        return;
      }

      if (familyKey && seenFamilies.has(familyKey) && picked.length >= Math.max(2, limit - 1)) {
        return;
      }

      picked.push(item.name);
      seenNames.add(nameKey);

      if (familyKey) {
        seenFamilies.add(familyKey);
      }
    });

  return picked;
}

function buildDynamicRouteMentions({
  orderedStops = [],
  mapRoutePoints = [],
  preferences = [],
  optimizerMode = null,
  template = null,
} = {}) {
  const strictTags = resolveStrictPreferenceTags(preferences, optimizerMode);
  const stopIds = new Set(orderedStops.map((stop) => stop.id));
  const nearbyItems = getAllItems()
    .filter((item) => !stopIds.has(item.id) && !autoAnchorKinds.has(item.kind))
    .map((item) => ({
      item,
      distanceKm: nearestPointDistanceKm(item, mapRoutePoints),
    }))
    .filter((entry) => entry.distanceKm <= 0.55)
    .sort((left, right) => left.distanceKm - right.distanceKm)
    .slice(0, 20);

  const barCandidates = [
    ...orderedStops.map((item, index) => ({
      item,
      score:
        (isBarRouteMentionCandidate(item) ? 4.6 : -10) +
        item.tags.filter((tag) => preferences.includes(tag)).length * 0.8 +
        (item.tags.includes("nattliv") ? 1.1 : 0) -
        index * 0.25,
    })),
    ...nearbyItems.map(({ item, distanceKm }) => ({
      item,
      score:
        (isBarRouteMentionCandidate(item) ? 3.6 : -10) +
        item.tags.filter((tag) => preferences.includes(tag)).length * 0.75 +
        clamp(0.7 - distanceKm, 0, 0.7) * 3,
    })),
  ].filter((entry) => entry.score > 0);

  const hiddenCandidates = [
    ...orderedStops.map((item, index) => ({
      item,
      score:
        (isHiddenRouteMentionCandidate(item) ? 4.2 : -10) +
        (item.tags.includes("hidden gems") ? 1.3 : 0) +
        (item.tags.includes("kyrkor") ? 1.5 : 0) +
        (item.tags.includes("utsikt") ? 1 : 0) +
        (itemMatchesStrictPreference(item, strictTags) ? 1.8 : 0) -
        (isBarRouteMentionCandidate(item) ? 1 : 0) -
        index * 0.2,
    })),
    ...nearbyItems.map(({ item, distanceKm }) => ({
      item,
      score:
        (isHiddenRouteMentionCandidate(item) ? 3.2 : -10) +
        (item.tags.includes("hidden gems") ? 1.1 : 0) +
        (item.tags.includes("kyrkor") ? 1.3 : 0) +
        (itemMatchesStrictPreference(item, strictTags) ? 1.4 : 0) -
        (isBarRouteMentionCandidate(item) ? 0.8 : 0) +
        clamp(0.65 - distanceKm, 0, 0.65) * 3,
    })),
  ].filter((entry) => entry.score > 0);

  const hiddenMentions = areHiddenMentionsRelevant(preferences)
    ? pickRouteMentions(hiddenCandidates, 4)
    : [];
  const barMentions = areBarMentionsRelevant(preferences)
    ? pickRouteMentions(barCandidates, 4)
    : [];

  return {
    hiddenMentions:
      hiddenMentions.length > 0
        ? hiddenMentions
        : areHiddenMentionsRelevant(preferences)
          ? (template?.hiddenMentions || [])
              .filter((name) => Boolean(findCatalogItemByName(name)))
              .slice(0, 4)
          : [],
    barMentions:
      barMentions.length > 0
        ? barMentions
        : areBarMentionsRelevant(preferences)
          ? (template?.barMentions || [])
              .filter((name) => Boolean(findCatalogItemByName(name)))
              .slice(0, 4)
          : [],
  };
}

function buildRouteFromTemplate(
  template,
  start,
  end,
  targetKm,
  preferences = [],
  optimizerMode = null,
  modifier = null,
  distanceMode = "soft_target",
  liveEvents = [],
  options = {},
) {
  const shape = isLoopRoute(start, end) ? "loop" : "arc";
  const lang = normalizeRouteResultLanguage(options.lang);
  const legPacing = normalizeLegPacing(options.legPacing);
  const dayProfile = normalizeDayProfile(options.dayProfile);
  const startProfile = buildPointAreaProfile(start);
  const endProfile = buildPointAreaProfile(end);
  const strictTags = resolveStrictPreferenceTags(preferences, optimizerMode);
  const rawPool = buildStopPool(
    template,
    start,
    end,
    preferences,
    optimizerMode,
    modifier,
    targetKm,
    distanceMode,
    liveEvents,
    options,
  );
  const sortedPool = rawPool
    .map((item, index) => ({
      item,
      score: scoreStopCandidate({
        item,
        index,
        shape,
        start,
        end,
        startProfile,
        endProfile,
        preferences,
        optimizerMode,
        modifier,
        strictTags,
        targetKm,
        distanceMode,
        legPacing,
        usedRoutes: options.usedRoutes || [],
        manualAnchorsLocked: Boolean(options.manualAnchorsLocked),
      }),
    }))
    .sort((left, right) => right.score - left.score);
  const selectedCount = desiredStopCount(sortedPool.length, targetKm, distanceMode, dayProfile);
  const strictPool = strictTags.length
    ? sortedPool.filter((entry) => itemMatchesStrictPreference(entry.item, strictTags))
    : [];
  const strictSelectedCount = strictTags.length
    ? Math.max(selectedCount, Math.min(3, strictPool.length))
    : selectedCount;
  let selectedStops = strictTags.length
    ? strictPool.slice(0, strictSelectedCount).map((entry) => entry.item)
    : sortedPool.slice(0, selectedCount).map((entry) => entry.item);

  if (strictTags.length && !selectedStops.length) {
    selectedStops = sortedPool.slice(0, Math.min(rawPool.length, 2)).map((entry) => entry.item);
  }

  if (!strictTags.length && selectedStops.length < Math.min(3, rawPool.length)) {
    selectedStops = sortedPool.slice(0, Math.min(rawPool.length, 3)).map((entry) => entry.item);
  }

  if (!selectedStops.length) {
    selectedStops = sortedPool.slice(0, Math.min(rawPool.length, 3)).map((entry) => entry.item);
  }

  if (
    dayProfile === "final" &&
    strictTags.length &&
    selectedStops.length > 0 &&
    selectedStops.length < selectedCount
  ) {
    const selectedAreas = new Set(selectedStops.map((stop) => stop.area).filter(Boolean));
    const selectedIds = new Set(selectedStops.map((stop) => stop.id));
    const strictCount = selectedStops.filter((stop) =>
      itemMatchesStrictPreference(stop, strictTags),
    ).length;
    const maxTotalForCoverage =
      strictCount > 0 ? Math.floor(strictCount / 0.6) : selectedStops.length;
    const targetTotal = Math.min(selectedCount, maxTotalForCoverage, rawPool.length);

    if (targetTotal > selectedStops.length) {
      const connectors = sortedPool
        .filter(
          (entry) =>
            !selectedIds.has(entry.item.id) &&
            !itemMatchesStrictPreference(entry.item, strictTags) &&
            entry.item.area &&
            selectedAreas.has(entry.item.area),
        )
        .slice(0, targetTotal - selectedStops.length)
        .map((entry) => entry.item);
      selectedStops = [...selectedStops, ...connectors];
    }
  }

  if (options.manualAnchorsLocked && shape === "arc") {
    selectedStops = ensureLockedArcCoverage(
      selectedStops,
      sortedPool,
      start,
      end,
      selectedCount,
    );
  }

  if (shape === "arc") {
    selectedStops = ensureArcProgressionCoverage(
      selectedStops,
      sortedPool,
      start,
      end,
      {
        desiredCount: selectedStops.length,
        preferences,
        optimizerMode,
        targetKm,
        distanceMode,
        legPacing,
      },
    );
  }

  const { orderedStops, geometry } = optimizeStopOrder(
    selectedStops,
    shape,
    start,
    end,
    startProfile,
    endProfile,
    targetKm,
    distanceMode,
    legPacing,
    lang,
  );
  const bridgedStops = insertBridgeStopsForLongLegs(orderedStops, {
    start,
    end,
    preferences,
    optimizerMode,
    modifier,
    legPacing,
    distanceMode,
    shape,
  });
  const rebalancedStops = rebalanceWeakMarketLead(
    bridgedStops,
    preferences,
    options.weekday || null,
  );
  const finalOrderedStops = rebalancedStops;
  const finalGeometry =
    finalOrderedStops === orderedStops
      ? geometry
      : shape === "loop"
        ? summarizeLoopGeometry(
            finalOrderedStops,
            start,
            end,
            startProfile,
            targetKm,
            distanceMode,
            legPacing,
            lang,
          )
        : summarizeArcGeometry(
            finalOrderedStops,
            start,
            end,
            startProfile,
            endProfile,
            targetKm,
            distanceMode,
            legPacing,
            lang,
          );

  const mainStops = finalOrderedStops.map((stop) => formatMainStop(stop));
  const routeArea = buildRouteAreaProfile(finalOrderedStops);
  const mapRoutePoints = [
    { label: start.label, lat: start.lat, lng: start.lng, role: "start" },
    ...finalOrderedStops.map((stop, index) => ({
      label: stop.name,
      lat: stop.lat,
      lng: stop.lng,
      role: index === 0 ? "first-stop" : "stop",
    })),
    { label: end.label, lat: end.lat, lng: end.lng, role: "end" },
  ];
  const estimatedKm = Number((finalGeometry?.estimatedKm || walkingKm(mapRoutePoints)).toFixed(1));
  const legs = finalGeometry?.legs || buildRouteLegs(mapRoutePoints);
  const routeMentions = buildDynamicRouteMentions({
    orderedStops: finalOrderedStops,
    mapRoutePoints,
    preferences,
    optimizerMode,
    template,
  });
  const routeIdentity = buildRouteIdentity(template, finalOrderedStops);

  const route = {
    id: template.id,
    title: buildDynamicTitle({
      start,
      end,
      shape,
      routeArea,
      optimizerMode,
      modifier,
      preferences,
      routeStops: finalOrderedStops,
      weekday: options.weekday || null,
      lang,
    }),
    summary: buildDynamicSummary({
      start,
      end,
      shape,
      routeArea,
      estimatedKm,
      optimizerMode,
      modifier,
      preferences,
      routeStops: finalOrderedStops,
      weekday: options.weekday || null,
      lang,
    }),
    estimated_km: estimatedKm,
    start_label: start.label,
    end_label: end.label,
    route_shape: shape,
    uses_provisional_sources: mainStops.some((stop) => stop.provisional === true),
    main_stops: mainStops,
    hidden_mentions: routeMentions.hiddenMentions,
    bar_mentions: routeMentions.barMentions,
    map_route_points: mapRoutePoints,
    map_path_points: mapRoutePoints.map((point) => ({
      lat: point.lat,
      lng: point.lng,
    })),
    legs,
    routing_source: "heuristic",
    geo_profile: buildRouteGeoProfile(routeArea, startProfile, endProfile),
    longest_leg_km: finalGeometry?.longestLegKm ?? null,
    longest_leg_minutes: finalGeometry?.longestLegMinutes ?? null,
    average_leg_minutes: finalGeometry?.averageLegMinutes ?? null,
    long_leg_count: finalGeometry?.longLegCount ?? 0,
    route_continuity_score: finalGeometry?.routeContinuityScore ?? null,
    dead_walk_penalty: finalGeometry?.deadWalkPenalty ?? null,
    leg_fit_note: finalGeometry?.legFitNote ?? null,
    route_quality_warnings: finalGeometry?.warnings || [],
    geo_fit_note: buildGeoFitNote({
      shape,
      start,
      end,
      geometry: finalGeometry,
      routeArea,
      startProfile,
      endProfile,
      lang,
    }),
    anchor_zone: buildAnchorZone(shape, startProfile, endProfile, routeArea),
    day_profile: dayProfile,
    geo_quality_score: Number((finalGeometry?.qualityScore || 0).toFixed(1)),
    pool_fit_penalty: Math.max(0, rawPool.length - finalOrderedStops.length - 1) * 0.9,
  };

  return attachRouteLineage(route, routeIdentity);
}

function nearestRouteDistanceKm(route, point) {
  if (
    !route ||
    !Array.isArray(route.map_route_points) ||
    typeof point.lat !== "number" ||
    typeof point.lng !== "number"
  ) {
    return null;
  }

  return route.map_route_points.reduce((closest, routePoint) => {
    const distance = haversineKm(routePoint, point);
    return Math.min(closest, distance);
  }, Number.POSITIVE_INFINITY);
}

function buildRouteTagSet(route) {
  return new Set(
    (route.main_stops || []).flatMap((stop) => (Array.isArray(stop.tags) ? stop.tags : [])),
  );
}

function pulseScore({
  template,
  route,
  routeStops,
  pulseItems = [],
  preferences = [],
  optimizerMode = null,
  modifier = null,
  lang = "sv",
}) {
  if (!Array.isArray(pulseItems) || !pulseItems.length) {
    return { score: 0, note: null, anchor: null };
  }

  const activeModifier = normalizeModifier(modifier, optimizerMode);
  const routeProfile = normalizeVibeProfile(template);
  const routeArea = buildRouteAreaProfile(routeStops || []);
  const routeTags = buildRouteTagSetFromData(template, route, routeStops);
  const scoredItems = pulseItems.map((item) => {
    const hints = normalizePulseRouteHints(item);
    let score = 0;
    const reasonParts = [];

    const preferredTagHits = [...hints.preferredTags].filter((tag) => routeTags.has(tag));
    const avoidTagHits = [...hints.avoidTags].filter((tag) => routeTags.has(tag));

    if (preferredTagHits.length) {
      score += Math.min(3.6, preferredTagHits.length * 1.35);
      reasonParts.push(
        routeText(
          lang,
          "rutten bär rätt typ av stopp för dagens rytm",
          "the route carries the right kind of stops for today's rhythm",
        ),
      );
    }

    if (avoidTagHits.length) {
      score -= Math.min(3.4, avoidTagHits.length * 1.4);
    }

    if (routeArea.dominantToken && hints.preferredAreaTokens.has(routeArea.dominantToken)) {
      score += 3.5;
      reasonParts.push(
        routeText(
          lang,
          `${tokenLabel(routeArea.dominantToken) || routeArea.dominantToken} spelar extra bra just nu`,
          `${tokenLabel(routeArea.dominantToken) || routeArea.dominantToken} fits especially well right now`,
        ),
      );
    } else if ([...hints.preferredAreaTokens].some((token) => routeArea.tokens.has(token))) {
      score += 1.9;
    }

    if (routeArea.dominantMacro && hints.preferredMacros.has(routeArea.dominantMacro)) {
      score += 2.6;
      if (!reasonParts.length) {
        reasonParts.push(
          routeText(
            lang,
            `${macroLabel(routeArea.dominantMacro)} bär den här typen av dag bättre just nu`,
            `${macroLabel(routeArea.dominantMacro)} carries this kind of day better right now`,
          ),
        );
      }
    } else if ([...hints.preferredMacros].some((macro) => routeArea.macros.has(macro))) {
      score += 1.2;
    }

    if (routeArea.dominantToken && hints.avoidAreaTokens.has(routeArea.dominantToken)) {
      score -= 3.6;
    } else if ([...hints.avoidAreaTokens].some((token) => routeArea.tokens.has(token))) {
      score -= 1.8;
    }

    if (routeArea.dominantMacro && hints.avoidMacros.has(routeArea.dominantMacro)) {
      score -= 3;
    } else if ([...hints.avoidMacros].some((macro) => routeArea.macros.has(macro))) {
      score -= 1.4;
    }

    [...hints.preferredVibes].forEach((vibeKey) => {
      const vibeStrength = routeVibeValue(routeProfile, vibeKey);
      const modifierWeight = activeModifier === vibeKey ? 1.5 : 1.05;
      score += vibeStrength * modifierWeight;

      if (vibeStrength >= 2 && activeModifier === vibeKey) {
        reasonParts.push(
          routeText(
            lang,
            `rutten matchar tydligt att du valde ${modifierLabel[vibeKey] || vibeKey}`,
            `the route clearly matches your ${routeModifierLabel(vibeKey, lang)} choice`,
          ),
        );
      }
    });

    [...hints.avoidVibes].forEach((vibeKey) => {
      const vibeStrength = routeVibeValue(routeProfile, vibeKey);
      const modifierWeight = activeModifier === vibeKey ? 1.7 : 1.15;
      score -= vibeStrength * modifierWeight;
    });

    if (activeModifier && hints.modifierBias[activeModifier]) {
      score += hints.modifierBias[activeModifier];
    }

    const preferredPreferenceHits = preferences.filter((preference) => hints.preferredTags.has(preference));
    if (preferredPreferenceHits.length) {
      score += preferredPreferenceHits.length * 0.6;
    }

    return {
      item,
      score: Math.round(score * 10) / 10,
      reasonParts,
    };
  });

  const topPositive = scoredItems
    .filter((entry) => entry.score > 0.6)
    .sort((left, right) => right.score - left.score)
    .slice(0, 2);
  const topNegative = scoredItems
    .filter((entry) => entry.score < -0.6)
    .sort((left, right) => left.score - right.score)[0];
  const totalScore = clamp(
    topPositive.reduce((sum, entry) => sum + entry.score, 0) + (topNegative ? topNegative.score * 0.55 : 0),
    -6,
    10,
  );
  const lead = topPositive[0] || null;
  const leadReason = lead?.reasonParts?.[0]
    ? `${lead.reasonParts[0].charAt(0).toUpperCase()}${lead.reasonParts[0].slice(1)}.`
    : routeText(
        lang,
        "Den här rutten följer dagens rytm bättre än de mer generiska alternativen.",
        "This route follows today's rhythm better than the more generic alternatives.",
      );
  const note = lead
    ? routeText(
        lang,
        `Just nu i ${currentCityLabel()}: ${lead.item.title}. ${leadReason}.`,
        `Right now in ${currentCityLabel()}, today's Pulse fits this route better than the more generic alternatives. ${leadReason}.`,
      )
    : null;

  return {
    score: Math.round(totalScore * 10) / 10,
    note,
    anchor: lead?.item?.title || null,
  };
}

function liveEventRouteScore({
  route,
  template,
  liveEvents = [],
  preferences = [],
  optimizerMode = null,
  modifier = null,
  routeStops = [],
  lang = "sv",
}) {
  if (!Array.isArray(liveEvents) || !liveEvents.length) {
    return { score: 0, note: null };
  }

  const activeModifier = normalizeModifier(modifier, optimizerMode);
  const routeTags = buildRouteTagSetFromData(template, route, routeStops);
  const embeddedEventStops = routeStops.filter((stop) => stop?.isLiveEvent && stop.eventId);
  const ranked = liveEvents
    .map((event) => {
      const eventTags = new Set(event.match_tags || []);
      const tagHits = [...eventTags].filter((tag) => routeTags.has(tag)).length;
      const preferenceHits = preferences.filter((tag) => eventTags.has(tag)).length;
      const modifierHits = activeModifier
        ? (modifierEventTags[activeModifier] || []).filter((tag) => eventTags.has(tag)).length
        : 0;
      const distanceKm = nearestRouteDistanceKm(route, event);
      let proximityScore = 0;

      if (distanceKm !== null && Number.isFinite(distanceKm)) {
        if (distanceKm <= 0.45) {
          proximityScore = 4;
        } else if (distanceKm <= 1) {
          proximityScore = 2.2;
        } else if (distanceKm <= 2) {
          proximityScore = 0.8;
        } else {
          proximityScore = -1;
        }
      }

      return {
        event,
        embedded: embeddedEventStops.some((stop) => String(stop.eventId) === String(event.id)),
        score:
          tagHits * 1.5 +
          preferenceHits * 0.9 +
          modifierHits * 1.25 +
          proximityScore,
      };
    })
    .map((entry) => ({
      ...entry,
      score: entry.score + (entry.embedded ? 5.4 : 0),
    }))
    .sort((left, right) => right.score - left.score);

  const best = ranked[0];
  const second = ranked[1];
  const totalScore = clamp(
    (best?.score > 0 ? best.score : 0) + (second?.score > 1 ? second.score * 0.35 : 0),
    0,
    5,
  );

  if (!best || totalScore < 2.2) {
    return {
      score: Math.round(totalScore * 10) / 10,
      note: null,
    };
  }

  return {
    score: Math.round(totalScore * 10) / 10,
    note: best.embedded
      ? routeText(
          lang,
          `Live i dag: ${best.event.title} ligger inne i själva rutten och gör upplägget tydligt mer tidsbundet och trovärdigt.`,
          `Live today: ${best.event.title} sits inside the route itself and makes the plan more time-bound and credible.`,
        )
      : routeText(
          lang,
          `Live i dag: ${best.event.title} ligger ovanligt bra på eller nära den här rutten och gör upplägget mer tidsbundet på ett bra sätt.`,
          `Live today: ${best.event.title} fits unusually well on or near this route and gives the plan a useful time-bound layer.`,
        ),
  };
}

function buildRouteFitNote(routeChoice, distanceKm, lang = "sv") {
  if (distanceKm === null || !Number.isFinite(distanceKm)) {
    return routeText(
      lang,
      `Passar bäst med ${routeChoice.label.toLowerCase()} sett till dagens helhet.`,
      `Best fit with ${routeChoice.label.toLowerCase()} in the context of the day.`,
    );
  }

  if (distanceKm <= 0.35) {
    return routeText(
      lang,
      `Passar bäst med ${routeChoice.label.toLowerCase()} och ligger nästan direkt på sträckningen.`,
      `Best fit with ${routeChoice.label.toLowerCase()} and sits almost directly on the route.`,
    );
  }

  if (distanceKm <= 1) {
    return routeText(
      lang,
      `Passar bäst med ${routeChoice.label.toLowerCase()} och kräver bara en kort avstickare.`,
      `Best fit with ${routeChoice.label.toLowerCase()} and only needs a short detour.`,
    );
  }

  return routeText(
    lang,
    `Passar bäst med ${routeChoice.label.toLowerCase()}, men räkna med en tydligare avstickare.`,
    `Best fit with ${routeChoice.label.toLowerCase()}, but expect a more noticeable detour.`,
  );
}

function annotateLiveEventsForRoutes(liveEvents, routeChoices, lang = "sv") {
  return (liveEvents || []).map((event) => {
    const hasRouteGeometry =
      typeof event.lat === "number" &&
      Number.isFinite(event.lat) &&
      typeof event.lng === "number" &&
      Number.isFinite(event.lng);

    if (!hasRouteGeometry) {
      return {
        ...event,
        best_route_id: null,
        best_route_title: null,
        best_route_label: null,
        route_distance_km: null,
        route_fit_note: null,
      };
    }

    const rankedRoutes = routeChoices
      .map((routeChoice) => {
        const distanceKm = nearestRouteDistanceKm(routeChoice.route, event);
        const routeTags = buildRouteTagSet(routeChoice.route);
        const tagBoost = (event.match_tags || []).reduce((score, tag) => {
          if (routeTags.has(tag)) {
            return score + 0.8;
          }
          return score;
        }, 0);

        return {
          routeChoice,
          distanceKm,
          score:
            tagBoost -
            (distanceKm === null || !Number.isFinite(distanceKm) ? 1.5 : distanceKm * 3),
        };
      })
      .sort((left, right) => {
        if (right.score !== left.score) {
          return right.score - left.score;
        }

        return (left.distanceKm ?? 999) - (right.distanceKm ?? 999);
      });

    const bestRoute = rankedRoutes[0]?.routeChoice || null;
    const distanceKm = rankedRoutes[0]?.distanceKm ?? null;

    if (!bestRoute) {
      return event;
    }

    return {
      ...event,
      best_route_id: bestRoute.route.id,
      best_route_title: bestRoute.route.title,
      best_route_label: bestRoute.label,
      route_distance_km:
        distanceKm === null || !Number.isFinite(distanceKm)
          ? null
          : Number(distanceKm.toFixed(2)),
      route_fit_note: buildRouteFitNote(bestRoute, distanceKm, lang),
    };
  });
}

function lockedAnchorScore({
  route,
  routeStops = [],
  startPoint,
  endPoint,
  distanceMode = "soft_target",
  lang = "sv",
}) {
  if (!route || !routeStops.length || isLoopRoute(startPoint, endPoint)) {
    return { score: 0, note: null };
  }

  const lockedAnchorTuning = getRoutingTuning().lockedAnchorScore || {};
  const neutralLockedMacros = new Set(lockedAnchorTuning.driftNeutralMacros || ["center"]);
  const startProfile = buildPointAreaProfile(startPoint);
  const endProfile = buildPointAreaProfile(endPoint);
  const routeProfile = buildRouteAreaProfile(routeStops);
  const firstStop = routeStops[0];
  const lastStop = routeStops[routeStops.length - 1];
  const startGap = haversineKm(startPoint, firstStop);
  const endGap = haversineKm(endPoint, lastStop);
  const progressionStats = routeStops.map((stop) => projectPointToAxis(stop, startPoint, endPoint));
  const reversalCount = progressionStats.reduce((count, current, index) => {
    if (index === 0) {
      return count;
    }

    return current.progressKm + (lockedAnchorTuning.reversalToleranceKm ?? 0.35) <
      progressionStats[index - 1].progressKm
      ? count + 1
      : count;
  }, 0);
  const offCorridorCount = progressionStats.filter(
    (entry) => entry.lateralKm > (lockedAnchorTuning.offCorridorLateralKm ?? 2.2),
  ).length;
  let score = 0;
  const notes = [];

  if (startGap <= 0.8) {
    score += 4.8;
  } else if (startGap <= 1.5) {
    score += 1.8;
  } else {
    score -= Math.min(6, startGap * 2.8);
  }

  if (endGap <= 0.8) {
    score += 5;
  } else if (endGap <= 1.5) {
    score += 2;
  } else {
    score -= Math.min(6.5, endGap * 3);
  }

  if (
    startProfile?.primaryMacro &&
    endProfile?.primaryMacro &&
    routeProfile.macros.has(startProfile.primaryMacro) &&
    routeProfile.macros.has(endProfile.primaryMacro)
  ) {
    score += 3.5;
  } else {
    score -= 3.8;
  }

  if (
    routeProfile.dominantMacro &&
    ![startProfile?.primaryMacro, endProfile?.primaryMacro].includes(routeProfile.dominantMacro) &&
    !neutralLockedMacros.has(routeProfile.dominantMacro)
  ) {
    score -= 4.4;
  }

  score -= reversalCount * 3.1;
  score -= offCorridorCount * 1.6;

  if (distanceMode !== "no_limit" && progressionStats.some((entry) => entry.axisLengthKm > 0)) {
    const progressSpread =
      progressionStats[progressionStats.length - 1].progressKm - progressionStats[0].progressKm;
    if (progressSpread <= (lockedAnchorTuning.progressSpreadFloorKm ?? 0.8)) {
      score -= 3.6;
    }
  }

  if (score >= 2.5) {
    notes.push(
      routeText(
        lang,
        `Rutten håller faktiskt korridoren mellan ${startPoint.label} och ${endPoint.label} i stället för att glida tillbaka till en generisk mitt-i-stan-dag.`,
        `The route actually holds the corridor between ${startPoint.label} and ${endPoint.label} instead of drifting back into a generic central day.`,
      ),
    );
  } else if (score <= -2) {
    notes.push(
      routeText(
        lang,
        `Flera stopp ligger för långt från korridoren mellan ${startPoint.label} och ${endPoint.label}, så den här dagen passar ankaren svagare.`,
        `Several stops sit too far from the corridor between ${startPoint.label} and ${endPoint.label}, so this day fits the anchors less strongly.`,
      ),
    );
  }

  return {
    score: Math.round(score * 10) / 10,
    note: notes[0] || null,
  };
}

function routeScore({
  route,
  template,
  weather,
  weekday,
  pulseItems,
  liveEvents,
  targetKm,
  preferences,
  reusedIds,
  optimizerMode,
  budgetTier,
  modifier,
  distanceMode,
  legPacing = "balanced",
  routeStops,
  usedRoutes = [],
  manualAnchorsLocked = false,
  localTruth = null,
  lang = "sv",
}) {
  const startPoint = route.map_route_points[0];
  const endPoint = route.map_route_points[route.map_route_points.length - 1];
  const firstStop = route.main_stops[0] || startPoint;
  const lastStop = route.main_stops[route.main_stops.length - 1] || endPoint;
  const startProximity = pointAdjacencyScore(startPoint, firstStop);
  const endProximity = pointAdjacencyScore(endPoint, lastStop);
  const prefScore = preferenceScore(template, preferences);
  const dayScore = weekdayScore(template, weekday);
  const kmFitScore = kmScore(route.estimated_km, targetKm, distanceMode);
  const weatherFit = weatherScore(template, weather, lang);
  const optimizerScore = optimizerModeScore(template, optimizerMode, budgetTier, modifier);
  const normalizedRouteStops = Array.isArray(routeStops) ? routeStops : [];
  const budgetFit = budgetScore(normalizedRouteStops, preferences, optimizerMode, budgetTier, lang);
  const profileFit = profileScore(template, preferences, optimizerMode, modifier);
  const pulseFit = pulseScore({
    template,
    route,
    routeStops: normalizedRouteStops,
    pulseItems,
    preferences,
    optimizerMode,
    modifier,
    lang,
  });
  const liveFit = liveEventRouteScore({
    route,
    template,
    liveEvents,
    preferences,
    optimizerMode,
    modifier,
    routeStops: normalizedRouteStops,
    lang,
  });
  const areaFit = areaScore({
    routeStops: normalizedRouteStops,
    startPoint,
    endPoint,
    distanceMode,
    lang,
  });
  const anchorFit = manualAnchorsLocked
    ? lockedAnchorScore({
        route,
        routeStops: normalizedRouteStops,
        startPoint,
        endPoint,
        distanceMode,
        lang,
      })
    : { score: 0, note: null };
  const strictTags = resolveStrictPreferenceTags(preferences, optimizerMode);
  const templateStrictFitScore = strictTags.length
    ? strictTags.every((tag) => template.preferenceTags.includes(tag))
      ? 4.2
      : -10.5
    : 0;
  const strictFitScore = strictPreferenceCoverageScore(normalizedRouteStops, strictTags);
  const secondHandFit = buildSecondHandIntentFit(normalizedRouteStops, preferences, weekday);
  const isFinalDay = normalizeDayProfile(route.day_profile) === "final";
  const reusedPenalty = reusedIds.has(template.id)
    ? isFinalDay && templateStrictFitScore > 0
      ? -2
      : -6
    : 0;
  const geoFitScore = (route.geo_quality_score || 0) - (route.pool_fit_penalty || 0);
  const localTruthScore = Number(localTruth?.score_delta || 0);
  const repeatPressure = buildRepeatPressure(route, usedRoutes);
  const noveltyBoost = routeNoveltyScore(route, usedRoutes);
  const crossDayDepth = usedRoutes.length;
  const diversityMultiplier = manualAnchorsLocked
    ? 0.25
    : Math.min(1.35, 0.55 + crossDayDepth * 0.18) * (isFinalDay ? 0.7 : 1);
  const rawDiversityScore =
    !crossDayDepth
      ? 0
      : noveltyBoost * diversityMultiplier -
        repeatPressure.maxSimilarity * (0.24 * diversityMultiplier) -
        repeatPressure.averageSimilarity * (0.12 * diversityMultiplier) -
        repeatPressure.repeatedAnchorCount * (1.55 * diversityMultiplier) -
        repeatPressure.repeatedMacroCount * (1.1 * diversityMultiplier) -
        repeatPressure.repeatedStartCount * (0.4 * diversityMultiplier) -
        repeatPressure.repeatedEndCount * (0.4 * diversityMultiplier);
  const continuityConfig = getRouteContinuityConfig(legPacing);
  const estimatedKm = Number(route?.estimated_km) || 0;
  const longestLegKm = Number(route?.longest_leg_km) || 0;
  const routeContinuityScore = Number(route?.route_continuity_score);
  const deadWalkPenalty = Number(route?.dead_walk_penalty) || 0;
  let diversityEnvelopeAllowance = 1;

  if (!manualAnchorsLocked && rawDiversityScore > 0) {
    const kmTolerance =
      distanceMode === "no_limit" ? 1.8 : isFinalDay ? 0.3 : 0.9;
    const kmPenaltyWeight = distanceMode === "no_limit" ? 0.1 : 0.18;
    const overTargetKm = Math.max(0, estimatedKm - ((targetKm || 0) + kmTolerance));
    const longestLegTolerance =
      continuityConfig.reportMaxKm * (isFinalDay ? 0.8 : 1) +
      (distanceMode === "no_limit" ? 0.35 : 0);
    const longestLegOverflow = Math.max(0, longestLegKm - longestLegTolerance);

    diversityEnvelopeAllowance -= Math.min(0.62, overTargetKm * kmPenaltyWeight);
    diversityEnvelopeAllowance -= Math.min(0.42, longestLegOverflow * 0.28);

    if (Number.isFinite(routeContinuityScore) && routeContinuityScore < 7.8) {
      diversityEnvelopeAllowance -= Math.min(0.46, (7.8 - routeContinuityScore) * 0.18);
    }

    if (deadWalkPenalty > 0) {
      diversityEnvelopeAllowance -= Math.min(0.34, deadWalkPenalty * 0.18);
    }

    if (
      route?.route_shape === "arc" &&
      distanceMode !== "no_limit" &&
      estimatedKm > Math.max((targetKm || 0) * 1.2, (targetKm || 0) + 1.1)
    ) {
      diversityEnvelopeAllowance -= Math.min(
        0.28,
        (estimatedKm - Math.max((targetKm || 0) * 1.2, (targetKm || 0) + 1.1)) * 0.12,
      );
    }
  }

  const normalizedDiversityAllowance = clamp(diversityEnvelopeAllowance, 0.08, 1);
  const diversityScore =
    rawDiversityScore > 0
      ? rawDiversityScore * normalizedDiversityAllowance * normalizedDiversityAllowance
      : rawDiversityScore;

  return {
    score:
      prefScore +
      dayScore +
      kmFitScore +
      weatherFit.score +
      optimizerScore +
      budgetFit.score +
      profileFit.score +
      pulseFit.score +
      liveFit.score +
      areaFit.score +
      anchorFit.score +
      templateStrictFitScore +
      strictFitScore +
      secondHandFit.score +
      geoFitScore +
      startProximity +
      endProximity +
      diversityScore +
      reusedPenalty +
      localTruthScore,
    weatherNote: weatherFit.note,
    budgetNote: budgetFit.note,
    pulseNote: pulseFit.note,
    pulseAnchor: pulseFit.anchor,
    liveEventNote: liveFit.note,
    areaNote: anchorFit.note || areaFit.note,
    intentNote: secondHandFit.note,
    profile: profileFit.profile,
  };
}

function whyRecommended(
  template,
  preferences,
  route,
  routeStops,
  weekday,
  weather,
  optimizerMode,
  distanceMode,
  budgetTier,
  modifier,
  pulseNote,
  liveEventNote,
  areaNote,
  intentNote,
  lang = "sv",
) {
  const nightlifeActive = isNightlifeExplicit(preferences, optimizerMode, modifier);
  const nightlifePresentationTags = new Set(["nattliv", "kväll", "party"]);
  const prefMatches = preferences
    .filter((pref) => template.preferenceTags.includes(pref))
    .filter((pref) => nightlifeActive || !nightlifePresentationTags.has(pref));
  const reasonParts = [];
  const profile = normalizeVibeProfile(template);
  const activeBudgetTier = normalizeBudgetTier(preferences, optimizerMode, budgetTier);
  const activeModifier = normalizeModifier(modifier, optimizerMode);
  const strictTags = resolveStrictPreferenceTags(preferences, optimizerMode);
  const secondHandFit = buildSecondHandIntentFit(routeStops, preferences, weekday);

  if (strictTags.length === 1) {
    reasonParts.push(
      routeText(
        lang,
        `Du valde i praktiken ${strictTags[0]}, så stoppmixen hålls tydligare runt just det temat än i de bredare rutterna.`,
        `You effectively chose ${routePreferenceLabel(strictTags[0], lang)}, so the stop mix stays closer to that theme than the broader routes.`,
      ),
    );
  }

  if (preferences.includes("second_hand")) {
    if (secondHandFit.coverage >= 0.5 && secondHandFit.leadStop) {
      if (secondHandFit.identity === "market-strong") {
        reasonParts.push(
          routeText(
            lang,
            "Second hand-spåret bärs här faktiskt av marknad och vintage på en veckodag som stöder det.",
            "The second-hand thread is actually carried by market and vintage on a weekday that supports it.",
          ),
        );
      } else {
        reasonParts.push(
          routeText(
            lang,
            "Second hand-spåret bärs här tydligt av butiker, vintage och shopping snarare än av ett enstaka bonusstopp.",
            "The second-hand thread is clearly carried by shops, vintage, and browsing rather than a single bonus stop.",
          ),
        );
      }
    } else if (intentNote) {
      reasonParts.push(
        routeText(
          lang,
          intentNote,
          "The second-hand thread is present, but this route keeps it as a supporting layer rather than overclaiming it.",
        ),
      );
    }
  }

  if (prefMatches.length) {
    reasonParts.push(
      routeText(
        lang,
        `Den matchar särskilt bra för ${prefMatches.join(", ")}.`,
        `It is an especially good match for ${prefMatches.map((pref) => routePreferenceLabel(pref, lang)).join(", ")}.`,
      ),
    );
  }

  if (preferences.includes("kväll") && profile.evening >= 2) {
    reasonParts.push(
      routeText(
        lang,
        "Rutten är byggd för att bli starkare ju senare dagen blir, inte för att pika för tidigt.",
        "The route is built to get stronger later in the day, not to peak too early.",
      ),
    );
  }

  if (preferences.includes("kultur") && profile.culture >= 2) {
    reasonParts.push(
      routeText(
        lang,
        "Kulturdelen är här ett riktigt bärande lager med stopp som känns värda i sig.",
        "The culture layer is a real backbone here, with stops that feel worthwhile on their own.",
      ),
    );
  }

  if (preferences.includes("low-key") && profile.lowKey >= 2) {
    reasonParts.push(
      routeText(
        lang,
        "Tempot hålls mer low-key med bättre samtalsstopp och mindre showig energi.",
        "The pace stays more low-key, with better conversation stops and less showy energy.",
      ),
    );
  }

  if (preferences.includes("party") && profile.party >= 2) {
    reasonParts.push(
      routeText(
        lang,
        "Kvällen lutar tydligt mot mer puls, tätare glasstopp och senare energi.",
        "The evening leans clearly toward more pulse, tighter drink stops, and later energy.",
      ),
    );
  }

  if (activeModifier === "evening" && profile.evening >= 2) {
    reasonParts.push(
      routeText(
        lang,
        "Du valde mer kväll, och den här rutten blir faktiskt bättre ju senare dagen går.",
        "You chose more evening, and this route actually gets better as the day moves later.",
      ),
    );
  }

  if (activeModifier === "culture" && profile.culture >= 2) {
    reasonParts.push(
      routeText(
        lang,
        "Du bad om mer kultur, och här bär riktiga rum, kyrkor eller kulturlager större del av dagen.",
        "You asked for more culture, and here real rooms, churches, or cultural layers carry more of the day.",
      ),
    );
  }

  if (activeModifier === "low_key" && profile.lowKey >= 2) {
    reasonParts.push(
      routeText(
        lang,
        "Du valde low-key, så tempot hålls mjukare med bättre samtalsstopp och mindre show.",
        "You chose low-key, so the pace stays softer, with better conversation stops and less show.",
      ),
    );
  }

  if (activeModifier === "party" && profile.party >= 2) {
    reasonParts.push(
      routeText(
        lang,
        "Du valde party, och den här rutten har tydligare nattenergi än de lugnare alternativen.",
        "You chose party, and this route has clearer late-night energy than the calmer alternatives.",
      ),
    );
  }

  if (route.route_shape === "loop") {
    reasonParts.push(
      routeText(
        lang,
        `Huvudrutten blir en riktig runda från ${route.start_label} tillbaka till ${route.end_label} på cirka ${route.estimated_km} km i stället för en ut-och-tillbaka-dag.`,
        `The main route becomes a real loop from ${route.start_label} back to ${route.end_label}, ${formatApproxKm(route.estimated_km, lang)}, instead of an out-and-back day.`,
      ),
    );
  } else if (distanceMode === "no_limit") {
    reasonParts.push(
      routeText(
        lang,
        `Du valde "spelar ingen roll" på avstånd, så rutten får vara friare mellan ${route.start_label} och ${route.end_label} utan att tappa riktning.`,
        `You chose flexible distance, so the route can move more freely between ${route.start_label} and ${route.end_label} without losing direction.`,
      ),
    );
  } else {
    reasonParts.push(
      routeText(
        lang,
        `Rutten rör sig från ${route.start_label} mot ${route.end_label} på cirka ${route.estimated_km} km med tydligare geografisk progression.`,
        `The route moves from ${route.start_label} toward ${route.end_label}, ${formatApproxKm(route.estimated_km, lang)}, with clearer geographic progression.`,
      ),
    );
  }

  if (optimizerMode && template.optimizerModes?.includes(optimizerMode)) {
    reasonParts.push(
      routeText(
        lang,
        "Den här rutten matchar det valda optimizer-läget extra tydligt.",
        "This route matches the selected optimizer mode especially clearly.",
      ),
    );
  }

  if (activeBudgetTier === "budget") {
    reasonParts.push(
      routeText(
        lang,
        "Du bad om ett mer budgetvänligt upplägg, så prisnivå och billiga ankare väger tyngre.",
        "You asked for a more budget-friendly plan, so price level and cheaper anchors carry more weight.",
      ),
    );
  } else if (activeBudgetTier === "dolce-vita") {
    reasonParts.push(
      routeText(
        lang,
        "Du bad om La Dolce Vita, så premiumglas, bokningsvärda stopp och en större kväll väger tyngre.",
        "You asked for La Dolce Vita, so premium drinks, bookable stops, and a bigger evening carry more weight.",
      ),
    );
  }

  if (pulseNote) {
    reasonParts.push(
      routeText(
        lang,
        `Dagens puls i ${currentCityLabel()} lutar också tydligt åt just den här riktningen.`,
        `Today's Pulse in ${currentCityLabel()} also points clearly in this direction.`,
      ),
    );
  }

  if (liveEventNote) {
    reasonParts.push(
      routeText(
        lang,
        "Det finns dessutom ett live-lager som passar extra bra med den här rutten i dag.",
        "There is also a live layer that fits this route especially well today.",
      ),
    );
  }

  if (areaNote) {
    reasonParts.push(areaNote);
  }

  if (route.geo_fit_note) {
    reasonParts.push(route.geo_fit_note);
  }

  if (weather?.condition === "rain") {
    reasonParts.push(
      routeText(
        lang,
        "Dagens väder gör att den här mixen av inne- och kvartersstopp passar extra bra.",
        "Today's weather makes this mix of indoor and neighborhood stops fit especially well.",
      ),
    );
  } else if (weather?.condition === "sun") {
    reasonParts.push(
      routeText(
        lang,
        "Dagens väder gynnar utsikter, kvällspromenad och längre utepartier.",
        "Today's weather favors viewpoints, evening walking, and longer outdoor stretches.",
      ),
    );
  }

  return reasonParts.join(" ");
}

function pickDistinctRoutes(rankedEntries, usedRoutes = [], maxRoutes = 3) {
  const remaining = [...rankedEntries];
  const picked = [];
  const distinctSimilarityCutoff = 8.4;
  const fallbackSimilarityCutoff = 10;
  const crossDaySimilarityCutoff = 10.6;

  while (remaining.length && picked.length < maxRoutes) {
    let bestIndex = 0;
    let bestScore = Number.NEGATIVE_INFINITY;

    remaining.forEach((entry, index) => {
      const maxIntraSimilarity = picked.reduce(
        (max, chosen) => Math.max(max, routeSimilarity(entry.route, chosen.route)),
        0,
      );
      const maxCrossDaySimilarity = usedRoutes.reduce(
        (max, usedRoute) => Math.max(max, routeSimilarity(entry.route, usedRoute)),
        0,
      );

      if (
        (picked.length && maxIntraSimilarity >= distinctSimilarityCutoff) ||
        (usedRoutes.length && maxCrossDaySimilarity >= crossDaySimilarityCutoff)
      ) {
        return;
      }

      const intraPenalty = picked.reduce(
        (sum, chosen) => sum + routeSimilarity(entry.route, chosen.route),
        0,
      );
      const crossDayPenalty = usedRoutes.reduce(
        (sum, usedRoute) => sum + routeSimilarity(entry.route, usedRoute) * 0.75,
        0,
      );
      const adjustedScore = entry.score - intraPenalty - crossDayPenalty;

      if (adjustedScore > bestScore) {
        bestScore = adjustedScore;
        bestIndex = index;
      }
    });

    if (!Number.isFinite(bestScore)) {
      break;
    }

    const [next] = remaining.splice(bestIndex, 1);
    picked.push({
      ...next,
      adjustedScore: Number(bestScore.toFixed(1)),
    });
  }

  if (picked.length === 1 && remaining.length && maxRoutes > 1) {
    let fallbackIndex = -1;
    let fallbackScore = Number.NEGATIVE_INFINITY;

    remaining.forEach((entry, index) => {
      const maxIntraSimilarity = picked.reduce(
        (max, chosen) => Math.max(max, routeSimilarity(entry.route, chosen.route)),
        0,
      );
      const maxCrossDaySimilarity = usedRoutes.reduce(
        (max, usedRoute) => Math.max(max, routeSimilarity(entry.route, usedRoute)),
        0,
      );

      if (
        maxIntraSimilarity >= fallbackSimilarityCutoff ||
        (usedRoutes.length && maxCrossDaySimilarity >= crossDaySimilarityCutoff)
      ) {
        return;
      }

      const adjustedScore =
        entry.score -
        picked.reduce((sum, chosen) => sum + routeSimilarity(entry.route, chosen.route), 0) -
        usedRoutes.reduce(
          (sum, usedRoute) => sum + routeSimilarity(entry.route, usedRoute) * 0.75,
          0,
        );

      if (adjustedScore > fallbackScore) {
        fallbackScore = adjustedScore;
        fallbackIndex = index;
      }
    });

    if (fallbackIndex >= 0) {
      const [next] = remaining.splice(fallbackIndex, 1);
      picked.push({
        ...next,
        adjustedScore: Number(fallbackScore.toFixed(1)),
      });
    }
  }

  return picked;
}

function pickAlternativeRoutes(
  rankedEntries,
  primaryEntry,
  usedRoutes = [],
  preferredProfiles = ["variation", "light"],
  maxRoutes = 2,
) {
  const remaining = [...rankedEntries];
  const picked = [];
  const strongCutoff = 8.8;
  const softCutoff = 10.2;
  const maxPrimarySimilarityForAlternative = 8.6;
  const preferredProfileOrder = new Map(preferredProfiles.map((profile, index) => [profile, index]));

  while (remaining.length && picked.length < maxRoutes) {
    let bestIndex = -1;
    let bestScore = Number.NEGATIVE_INFINITY;

    remaining.forEach((entry, index) => {
      const similarityToPrimary = primaryEntry ? routeSimilarity(entry.route, primaryEntry.route) : 0;
      const sameTemplateAsPrimary = primaryEntry && entry.route?.id === primaryEntry.route?.id;
      const maxIntraSimilarity = picked.reduce(
        (max, chosen) => Math.max(max, routeSimilarity(entry.route, chosen.route)),
        0,
      );
      const maxCrossDaySimilarity = usedRoutes.reduce(
        (max, usedRoute) => Math.max(max, routeSimilarity(entry.route, usedRoute)),
        0,
      );

      if (
        similarityToPrimary >= maxPrimarySimilarityForAlternative ||
        (sameTemplateAsPrimary && similarityToPrimary >= strongCutoff) ||
        similarityToPrimary >= softCutoff ||
        maxIntraSimilarity >= softCutoff ||
        (usedRoutes.length && maxCrossDaySimilarity >= 10.6)
      ) {
        return;
      }

      const profileRank = preferredProfileOrder.has(entry.dayProfile)
        ? preferredProfileOrder.get(entry.dayProfile)
        : preferredProfiles.length;
      const profileBonus = Math.max(0, 2.4 - profileRank * 0.9);
      const primaryProfilePenalty =
        primaryEntry && entry.dayProfile === primaryEntry.dayProfile ? 1.6 : 0;
      const softSimilarityPenalty = Math.max(0, similarityToPrimary - strongCutoff) * 1.2;
      const intraPenalty = picked.reduce(
        (sum, chosen) => sum + routeSimilarity(entry.route, chosen.route),
        0,
      );
      const crossDayPenalty = usedRoutes.reduce(
        (sum, usedRoute) => sum + routeSimilarity(entry.route, usedRoute) * 0.75,
        0,
      );
      const adjustedScore =
        entry.score +
        profileBonus -
        primaryProfilePenalty -
        softSimilarityPenalty -
        intraPenalty -
        crossDayPenalty;

      if (adjustedScore > bestScore) {
        bestScore = adjustedScore;
        bestIndex = index;
      }
    });

    if (bestIndex < 0 || !Number.isFinite(bestScore)) {
      break;
    }

    const [next] = remaining.splice(bestIndex, 1);
    picked.push({
      ...next,
      adjustedScore: Number(bestScore.toFixed(1)),
    });
  }

  if (picked.length < maxRoutes && remaining.length) {
    const relaxedSoftCutoff = softCutoff + 1.8;
    const relaxedCrossDayCutoff = 12.4;

    while (remaining.length && picked.length < maxRoutes) {
      let bestIndex = -1;
      let bestScore = Number.NEGATIVE_INFINITY;

      remaining.forEach((entry, index) => {
        const similarityToPrimary = primaryEntry
          ? routeSimilarity(entry.route, primaryEntry.route)
          : 0;
        const sameTemplateAsPrimary = primaryEntry && entry.route?.id === primaryEntry.route?.id;
        const maxIntraSimilarity = picked.reduce(
          (max, chosen) => Math.max(max, routeSimilarity(entry.route, chosen.route)),
          0,
        );
        const maxCrossDaySimilarity = usedRoutes.reduce(
          (max, usedRoute) => Math.max(max, routeSimilarity(entry.route, usedRoute)),
          0,
        );

        if (
          similarityToPrimary >= maxPrimarySimilarityForAlternative ||
          (sameTemplateAsPrimary && similarityToPrimary >= strongCutoff) ||
          similarityToPrimary >= relaxedSoftCutoff ||
          maxIntraSimilarity >= relaxedSoftCutoff ||
          (usedRoutes.length && maxCrossDaySimilarity >= relaxedCrossDayCutoff)
        ) {
          return;
        }

        const profileRank = preferredProfileOrder.has(entry.dayProfile)
          ? preferredProfileOrder.get(entry.dayProfile)
          : preferredProfiles.length;
        const profileBonus = Math.max(0, 2 - profileRank * 0.7);
        const primaryProfilePenalty =
          primaryEntry && entry.dayProfile === primaryEntry.dayProfile ? 1.2 : 0;
        const softSimilarityPenalty = Math.max(0, similarityToPrimary - strongCutoff) * 0.6;
        const intraPenalty = picked.reduce(
          (sum, chosen) => sum + routeSimilarity(entry.route, chosen.route) * 0.45,
          0,
        );
        const crossDayPenalty = usedRoutes.reduce(
          (sum, usedRoute) => sum + routeSimilarity(entry.route, usedRoute) * 0.4,
          0,
        );
        const adjustedScore =
          entry.score +
          profileBonus -
          primaryProfilePenalty -
          softSimilarityPenalty -
          intraPenalty -
          crossDayPenalty;

        if (adjustedScore > bestScore) {
          bestScore = adjustedScore;
          bestIndex = index;
        }
      });

      if (bestIndex < 0 || !Number.isFinite(bestScore)) {
        break;
      }

      const [next] = remaining.splice(bestIndex, 1);
      picked.push({
        ...next,
        adjustedScore: Number(bestScore.toFixed(1)),
      });
    }
  }

  if (picked.length < maxRoutes && remaining.length) {
    const fallbackEntries = [...remaining].sort((left, right) => right.score - left.score);

    fallbackEntries.forEach((entry) => {
      if (picked.length >= maxRoutes) {
        return;
      }

      const similarityToPrimary = primaryEntry ? routeSimilarity(entry.route, primaryEntry.route) : 0;
      const sameTemplateAsPrimary = primaryEntry && entry.route?.id === primaryEntry.route?.id;

      const alreadyPicked = picked.some(
        (chosen) =>
          chosen.route?.id === entry.route?.id && chosen.dayProfile === entry.dayProfile,
      );

      if (
        alreadyPicked ||
        similarityToPrimary >= maxPrimarySimilarityForAlternative ||
        (sameTemplateAsPrimary && similarityToPrimary >= strongCutoff)
      ) {
        return;
      }

      picked.push({
        ...entry,
        adjustedScore: Number(entry.score.toFixed(1)),
      });
    });
  }

  return picked;
}

async function generateRecommendations({
  city = "rome",
  dates,
  homeBase,
  start,
  end,
  walkingKmTarget,
  preferences,
  optimizerMode,
  budgetTier = "standard",
  modifier = null,
  distanceMode = "soft_target",
  legPacing = "balanced",
  lang = "sv",
  includeLiveEvents = false,
}) {
  const routeResultLang = normalizeRouteResultLanguage(lang);
  const cityResolution = resolveCityConfig(city);

  // A city that was explicitly requested but is not registered must not be
  // silently planned as the fallback city — that would leak the fallback
  // city's geography and present fake confidence. Return an honest shell.
  if (cityResolution.requestedKey && !cityResolution.found) {
    return buildUnsupportedCityResult(cityResolution, expandDateRange(dates));
  }

  return cityContextStorage.run(cityResolution.cityConfig, async () => {
    const normalizedDates = expandDateRange(dates);
    const pulseByDate = Object.fromEntries(
      normalizedDates.map((date) => [date, getPulseForDate(date, routeResultLang)]),
    );
    const [weatherByDate, liveEventsByDate] = await Promise.all([
      fetchWeatherForActiveCity(normalizedDates, getCityCenter()).catch(() => ({})),
      fetchLiveEventsForActiveCity(normalizedDates, {
        preferences,
        optimizerMode,
        budgetTier,
        modifier,
      }).catch(() => ({})),
    ]);
    const homeBaseIsAuto = !homeBase || isAutoPointInput(homeBase);
    const startIsAuto = isAutoPointInput(start);
    const endIsAuto = isAutoPointInput(end);
    const resolvedHomeBase = homeBaseIsAuto ? null : await resolvePoint(homeBase, getFallbackLabel());
    let resolvedStart = startIsAuto ? null : await resolvePoint(start, getFallbackLabel());
    let resolvedEnd = endIsAuto ? null : await resolvePoint(end, getFallbackLabel());
    const manualAnchorsLocked = !startIsAuto && !endIsAuto;
    const usedTemplateIds = new Set();
    const usedPrimaryRoutes = [];
    const truthPassCount = Math.max(1, getWalkingConfig().truthPassTopCandidates || 5);

    const days = [];

    for (const [dateIndex, date] of normalizedDates.entries()) {
        const weekday = weekdayFromDate(date);
        const weather = weatherByDate[date];
        const pulse = pulseByDate[date] || getPulseForDate(date, routeResultLang);
        const dateSignals = getDateSignalsForDate(date, routeResultLang);
        const pulseItems = Array.isArray(pulse.items) ? pulse.items : [];
        const liveEvents = liveEventsByDate[date] || [];
        const dayPulseByDate = { [date]: pulse };
        const dayLiveEventsByDate = { [date]: liveEvents };
        let dayResolvedStart = resolvedStart;
        let dayResolvedEnd = resolvedEnd;
        let dayResolvedAutoShape = null;

        const isFinalDay = normalizedDates.length > 1 && dateIndex === normalizedDates.length - 1;

        if (startIsAuto && endIsAuto) {
          const autoAnchors = resolveAutoAnchors({
            homeBase: resolvedHomeBase,
            pulseByDate: dayPulseByDate,
            liveEventsByDate: dayLiveEventsByDate,
            preferences,
            optimizerMode,
            modifier,
            targetKm: walkingKmTarget,
            distanceMode,
            legPacing,
            weather,
            usedRoutes: usedPrimaryRoutes,
            isFinalDay,
          });
          dayResolvedStart = autoAnchors.start;
          dayResolvedEnd = autoAnchors.end;
          dayResolvedAutoShape = autoAnchors.shape;
        } else if (startIsAuto) {
          dayResolvedStart = resolveAutoPoint({
            role: "start",
            homeBase: resolvedHomeBase,
            pairedPoint: dayResolvedEnd,
            pulseByDate: dayPulseByDate,
            liveEventsByDate: dayLiveEventsByDate,
            preferences,
            optimizerMode,
            modifier,
            targetKm: walkingKmTarget,
            distanceMode,
            usedRoutes: usedPrimaryRoutes,
          });
        } else if (endIsAuto) {
          dayResolvedEnd = resolveAutoPoint({
            role: "end",
            homeBase: resolvedHomeBase,
            pairedPoint: dayResolvedStart,
            pulseByDate: dayPulseByDate,
            liveEventsByDate: dayLiveEventsByDate,
            preferences,
            optimizerMode,
            modifier,
            targetKm: walkingKmTarget,
            distanceMode,
            usedRoutes: usedPrimaryRoutes,
          });
        }

        if (dateIndex === 0) {
          if (startIsAuto) {
            resolvedStart = dayResolvedStart;
          }
          if (endIsAuto) {
            resolvedEnd = dayResolvedEnd;
          }
        }
        const primaryDayProfile = choosePrimaryDayProfile({
          dateIndex,
          totalDates: normalizedDates.length,
          targetKm: walkingKmTarget,
          distanceMode,
          preferences,
          optimizerMode,
        });
        const alternativeDayProfiles = buildAlternativeDayProfiles(primaryDayProfile);
        const candidateDayProfiles = [...new Set([primaryDayProfile, ...alternativeDayProfiles])];

        const buildRankedEntry = async (template, baseRoute = null, dayProfile = primaryDayProfile) => {
          const route =
            baseRoute ||
            buildRouteFromTemplate(
              template,
              dayResolvedStart,
              dayResolvedEnd,
              walkingKmTarget,
              preferences,
              optimizerMode,
              modifier,
              distanceMode,
              liveEvents,
              {
                manualAnchorsLocked,
                resolvedAutoShape: dayResolvedAutoShape,
                legPacing,
                dayProfile,
                weekday,
                lang: routeResultLang,
                includeLiveEvents,
                usedRoutes: usedPrimaryRoutes,
              },
            );
          const routeStops = route.main_stops
            .map((stop) => resolveRouteStopData(stop))
            .filter(Boolean);
          const localTruth = evaluateLocalTruth(getActiveCityConfig(), {
            date,
            weekday,
            route,
            routeStops,
            template,
            preferences,
            optimizerMode,
            modifier: normalizeModifier(modifier, optimizerMode),
            weather,
            liveEvents,
          });
          const openingWarnings = [
            ...buildOpeningWarnings(routeStops, weekday),
            ...buildLocalTruthOpeningWarnings(localTruth),
          ];
          const venueSpecials = buildVenueSpecials(routeStops, weekday, routeResultLang);
          const scoring = routeScore({
            route,
            template,
            weather,
            weekday,
            pulseItems,
            liveEvents,
            targetKm: walkingKmTarget,
            preferences,
            reusedIds: usedTemplateIds,
            optimizerMode,
            budgetTier,
            modifier,
            distanceMode,
            legPacing,
            routeStops,
            usedRoutes: usedPrimaryRoutes,
            manualAnchorsLocked,
            localTruth,
            lang: routeResultLang,
          });

          return {
            template,
            dayProfile,
            route: withRouteLineage(route, {
              local_truth: localTruthForLang(localTruth, routeResultLang),
              weather_note: scoring.weatherNote,
              budget_note: scoring.budgetNote,
              pulse_note: scoring.pulseNote,
              live_event_fit_note: scoring.liveEventNote,
              pulse_anchor: scoring.pulseAnchor,
              area_note: scoring.areaNote,
              opening_hours_warnings: openingWarnings,
              venue_specials: venueSpecials,
              why_recommended: whyRecommended(
                template,
                preferences,
                route,
                routeStops,
                weekday,
                weather,
                optimizerMode,
                distanceMode,
                budgetTier,
                modifier,
                scoring.pulseNote,
                scoring.liveEventNote,
                scoring.areaNote,
                scoring.intentNote,
                routeResultLang,
              ),
              curator_voice: resolveCuratorVoice(template, routeResultLang),
            }),
            score: scoring.score,
          };
        };

        const cityRouteTemplates = getRouteTemplates();
        const usingAgnosticCompose = cityRouteTemplates.length === 0;
        const effectiveTemplates = usingAgnosticCompose
          ? [buildAgnosticComposeTemplate(walkingKmTarget)]
          : cityRouteTemplates;

        const initialRanked = await Promise.all(
          effectiveTemplates.flatMap((template) =>
            candidateDayProfiles.map((dayProfile) => buildRankedEntry(template, null, dayProfile)),
          ),
        );
        initialRanked.sort((a, b) => b.score - a.score);

        const truthEnhancedEntries = await Promise.all(
          initialRanked.slice(0, truthPassCount).map(async (entry) => {
            const truthRoute = await applyWalkingTruthToRoute(entry.route, {
              legPacing,
              lang: routeResultLang,
            });
            return buildRankedEntry(entry.template, truthRoute, entry.dayProfile);
          }),
        );
        const truthEnhancedById = new Map(
          truthEnhancedEntries.map((entry) => [`${entry.template.id}::${entry.dayProfile}`, entry]),
        );
        const ranked = initialRanked
          .map((entry) => truthEnhancedById.get(`${entry.template.id}::${entry.dayProfile}`) || entry)
          .sort((a, b) => b.score - a.score);

        const primaryCandidates = ranked.filter((entry) => entry.dayProfile === primaryDayProfile);
        const [pickedPrimary] = pickDistinctRoutes(
          primaryCandidates.length ? primaryCandidates : ranked,
          usedPrimaryRoutes,
          1,
        );
        const primary =
          pickedPrimary || (primaryCandidates.length ? primaryCandidates[0] : ranked[0]) || null;

        // Honest empty-day shape. Two cases collapse here:
        //  - a city with templates produced no rankable route, or
        //  - agnostic compose (thin citypack) could not assemble a minimally
        //    coherent walk (< 2 real catalog stops). In both we surface a null
        //    route rather than forcing a one-stop or hallucinated route.
        const agnosticTooThin =
          usingAgnosticCompose && (primary?.route?.main_stops || []).length < 2;
        if (!primary || agnosticTooThin) {
          days.push({
            date,
            date_signals: dateSignals,
            live_events: [],
            primary_route: null,
            alternatives: [],
          });
          continue;
        }

        const alternativeCandidates = ranked.filter(
          (entry) =>
            !primary ||
            !(entry.template.id === primary.template.id && entry.dayProfile === primary.dayProfile),
        );
        const alternatives = pickAlternativeRoutes(
          alternativeCandidates,
          primary,
          usedPrimaryRoutes,
          alternativeDayProfiles,
          2,
        );
        const annotatedLiveEvents = annotateLiveEventsForRoutes(liveEvents, [
          {
            label: routeText(routeResultLang, "Huvudrutten", "Main route"),
            route: primary.route,
          },
          ...alternatives.map((entry, index) => ({
            label: routeText(routeResultLang, `Alternativ ${index + 1}`, `Alternative ${index + 1}`),
            route: entry.route,
          })),
        ], routeResultLang);
        usedTemplateIds.add(primary.template.id);
        usedPrimaryRoutes.push(primary.route);

        if (usingAgnosticCompose) {
          markAgnosticComposeRoute(primary.route);
          alternatives.forEach((entry) => markAgnosticComposeRoute(entry.route));
        }

        days.push({
          date,
          date_signals: dateSignals,
          live_events: annotatedLiveEvents,
          primary_route: primary.route,
          alternatives: alternatives.map((entry) => entry.route),
        });
    }

    return {
      city: getActiveCityConfig().key,
      days,
      resolved_home_base: resolvedHomeBase,
      resolved_start: resolvedStart,
      resolved_end: resolvedEnd,
      readiness: classifyRuntimeReadiness(cityResolution.cityConfig, cityResolution, {
        routedDayCount: days.filter((day) => day.primary_route).length,
      }),
    };
  });
}

module.exports = {
  generateRecommendations,
  resolvePoint,
  expandDateRange,
  buildRouteFromTemplate,
  buildRouteIdentity,
  attachRouteLineage,
  getRouteLineage,
  buildLiveEventStopCandidates,
  annotateLiveEventsForRoutes,
  budgetScore,
  kmScore,
  normalizeBudgetTier,
  normalizeModifier,
  areaScore,
  preferenceScore,
  priceLevelWeight,
  profileScore,
  routeScore,
  routeSimilarity,
  isNightlifeExplicit,
};
