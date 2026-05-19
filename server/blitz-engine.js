const { getIsoWeekday } = require("./lib/iso-date");
const { evaluateLocalTruth, localTruthForLang } = require("./local-truth");
const { normalizeAvailability } = require("./availability");
const { translate, normalizeLanguage } = require("./ui-i18n");

const CHIPPED_SIGNAL_TYPES = new Set([
  "golden_hour",
  "live_event_nearby",
  "evening_window",
  "crowd_warning",
]);

function labelSignalType(type, lang) {
  if (!type || !CHIPPED_SIGNAL_TYPES.has(type)) return null;
  return translate(lang, `pulse.signal_type.${type}`);
}

const DEFAULT_BLITZ_MODE = "auto";
const DEFAULT_MEMORY = {
  recent_stop_ids: [],
  recent_move_kinds: [],
  recent_area_tokens: [],
  recent_template_ids: [],
  last_blitz_at: null,
};

const plannerIntentSignals = {
  food_drink: ["mat", "vin", "öl", "cocktail"],
  culture: ["kultur", "kyrkor"],
  second_hand: ["second_hand"],
  hidden_gems: ["hidden gems", "low-key"],
  views: ["utsikt"],
  nightlife: ["nattliv", "kväll", "cocktail", "party"],
  history: ["klassiker", "kyrkor", "kultur"],
  green_walk: ["low-key", "utsikt", "hidden gems"],
};

const secondHandCanonicalTags = new Set([
  "second_hand",
  "vintage",
  "market",
  "shopping",
  "antique",
]);

const timeBandTagBoosts = {
  morning: {
    boost: ["kultur", "kyrkor", "utsikt", "hidden gems", "green", "promenad"],
    dampen: ["nattliv", "cocktail", "party", "kväll"],
  },
  midday: {
    boost: ["mat", "shopping", "market", "second_hand", "kultur"],
    dampen: ["party", "nattliv"],
  },
  afternoon: {
    boost: ["second_hand", "shopping", "vin", "mat", "hidden gems", "utsikt"],
    dampen: [],
  },
  evening: {
    boost: ["vin", "öl", "cocktail", "nattliv", "kväll", "utsikt", "hidden gems"],
    dampen: ["museum", "market", "event_market"],
  },
  late: {
    boost: ["cocktail", "öl", "nattliv", "kväll", "party"],
    dampen: ["museum", "kyrkor", "market", "event_market", "shopping", "second_hand"],
  },
};

const candidateKindDwellMinutes = {
  bar: 18,
  restaurant: 30,
  cafe: 20,
  shop: 18,
  market: 24,
  event_market: 28,
  museum: 28,
  church: 16,
  viewpoint: 14,
  square: 12,
  district: 16,
  seasonal: 20,
  stop: 16,
};

function uniqueNonEmpty(values = []) {
  return [...new Set((values || []).map((value) => String(value || "").trim()).filter(Boolean))];
}

function normalizeStringArray(values = [], limit = 10) {
  if (!Array.isArray(values)) {
    return [];
  }

  return uniqueNonEmpty(values).slice(-limit);
}

function slugifyToken(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function haversineKm(left, right) {
  if (
    !left ||
    !right ||
    typeof left.lat !== "number" ||
    typeof left.lng !== "number" ||
    typeof right.lat !== "number" ||
    typeof right.lng !== "number"
  ) {
    return Number.POSITIVE_INFINITY;
  }

  const toRad = (value) => (value * Math.PI) / 180;
  const earthRadiusKm = 6371;
  const dLat = toRad(right.lat - left.lat);
  const dLng = toRad(right.lng - left.lng);
  const lat1 = toRad(left.lat);
  const lat2 = toRad(right.lat);

  const hav =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;

  return 2 * earthRadiusKm * Math.atan2(Math.sqrt(hav), Math.sqrt(1 - hav));
}

function walkingKm(points = []) {
  if (!Array.isArray(points) || points.length < 2) {
    return 0;
  }

  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    total += haversineKm(points[index - 1], points[index]) * 1.18;
  }

  return Number(total.toFixed(1));
}

function walkMinutesForKm(distanceKm) {
  if (!Number.isFinite(distanceKm)) {
    return null;
  }

  return Math.max(2, Math.round(distanceKm * 12));
}

function resolveEffortLabel(walkingMinutes, lang = "sv") {
  if (!Number.isFinite(walkingMinutes)) {
    return translate(lang, "blitz.effort.unknown");
  }

  if (walkingMinutes <= 12) {
    return translate(lang, "blitz.effort.low");
  }

  if (walkingMinutes <= 24) {
    return translate(lang, "blitz.effort.lowMedium");
  }

  return translate(lang, "blitz.effort.medium");
}

function buildTimeZoneParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const values = Object.fromEntries(
    parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]),
  );

  return {
    date: `${values.year}-${values.month}-${values.day}`,
    hour: Number(values.hour || 13),
    minute: Number(values.minute || 0),
  };
}

function resolveNowContext(cityConfig, payload = {}) {
  const providedNow = payload.now ? new Date(payload.now) : null;

  if (providedNow && !Number.isNaN(providedNow.getTime())) {
    const parts = buildTimeZoneParts(providedNow, cityConfig.timezone);
    return {
      date: parts.date,
      hour: parts.hour,
      minute: parts.minute,
      now_iso: providedNow.toISOString(),
    };
  }

  const date = String(payload.date || cityConfig.todayIsoDate() || "").trim() || cityConfig.todayIsoDate();

  return {
    date,
    hour: 13,
    minute: 0,
    now_iso: `${date}T13:00:00`,
  };
}

function resolveTimeBand(hour) {
  if (hour >= 6 && hour < 11) {
    return "morning";
  }

  if (hour >= 11 && hour < 15) {
    return "midday";
  }

  if (hour >= 15 && hour < 18) {
    return "afternoon";
  }

  if (hour >= 18 && hour < 23) {
    return "evening";
  }

  return "late";
}

function normalizeOriginInput(input) {
  if (!input || typeof input !== "object") {
    return null;
  }

  if (input.type === "selected_place") {
    return {
      ...input,
      type:
        typeof input.lat === "number" && typeof input.lng === "number"
          ? "custom"
          : "preset",
      query: input.query || input.label || input.id || null,
    };
  }

  return input;
}

async function resolveOriginPoint(cityConfig, input) {
  const normalized = normalizeOriginInput(input);
  const fallback = cityConfig.catalog.findItemByName(cityConfig.fallbackLabel || cityConfig.label);

  if (!normalized || !normalized.type) {
    if (fallback) {
      return {
        label: fallback.name,
        lat: fallback.lat,
        lng: fallback.lng,
        source: "default",
      };
    }

    return {
      label: cityConfig.label,
      lat: cityConfig.center.lat,
      lng: cityConfig.center.lng,
      source: "default",
    };
  }

  if (
    normalized.type === "current_location" &&
    typeof normalized.lat === "number" &&
    typeof normalized.lng === "number"
  ) {
    return {
      label: normalized.label || "Nuvarande plats",
      lat: normalized.lat,
      lng: normalized.lng,
      source: "current_location",
    };
  }

  if (normalized.type === "preset" && normalized.label) {
    const found = cityConfig.catalog.findItemByName(normalized.label);
    if (found) {
      return {
        label: found.name,
        lat: found.lat,
        lng: found.lng,
        source: "preset",
      };
    }
  }

  if (
    normalized.type === "custom" &&
    typeof normalized.lat === "number" &&
    typeof normalized.lng === "number"
  ) {
    return {
      label: normalized.label || normalized.query || "Vald plats",
      lat: normalized.lat,
      lng: normalized.lng,
      source: "custom",
    };
  }

  if (normalized.query || normalized.label) {
    const candidates = await cityConfig.services.geocodeQuery(normalized.query || normalized.label);
    if (Array.isArray(candidates) && candidates[0]) {
      return {
        label: candidates[0].label,
        lat: candidates[0].lat,
        lng: candidates[0].lng,
        source: candidates[0].source,
      };
    }
  }

  if (fallback) {
    return {
      label: fallback.name,
      lat: fallback.lat,
      lng: fallback.lng,
      source: "default",
    };
  }

  return {
    label: cityConfig.label,
    lat: cityConfig.center.lat,
    lng: cityConfig.center.lng,
    source: "default",
  };
}

function resolveBlitzPreferences(payload = {}) {
  const rawPreferences = Array.isArray(payload.preferences) ? payload.preferences : [];
  const rawIntentKeys = Array.isArray(payload.intent_keys) ? payload.intent_keys : [];
  const normalizedIntentKeys = uniqueNonEmpty(rawIntentKeys.map((key) => slugifyToken(key).replace(/-/g, "_")));
  const intentSignals = normalizedIntentKeys.flatMap((key) => plannerIntentSignals[key] || []);

  return {
    intent_keys: normalizedIntentKeys,
    preferences: uniqueNonEmpty([...rawPreferences, ...intentSignals]),
  };
}

function buildAdditionalMemoryFromPreviousRoute(previousRoute) {
  if (!previousRoute || typeof previousRoute !== "object") {
    return DEFAULT_MEMORY;
  }

  const mainStops = Array.isArray(previousRoute.main_stops) ? previousRoute.main_stops : [];
  const areaTokens = uniqueNonEmpty(
    mainStops.flatMap((stop) => {
      const tokens = [];
      if (stop.area) {
        tokens.push(slugifyToken(String(stop.area).split("/")[0]));
      }
      return tokens;
    }),
  );

  return {
    recent_stop_ids: uniqueNonEmpty(mainStops.map((stop) => stop.id)),
    recent_move_kinds: [],
    recent_area_tokens: areaTokens,
    recent_template_ids: previousRoute.id ? [previousRoute.id] : [],
    last_blitz_at: null,
  };
}

function normalizeBlitzMemory(memory, previousRoute = null) {
  const memoryObject =
    memory && typeof memory === "object" && !Array.isArray(memory) ? memory : {};
  const base = {
    ...DEFAULT_MEMORY,
    ...memoryObject,
  };
  const previousRouteMemory = buildAdditionalMemoryFromPreviousRoute(previousRoute);

  return {
    recent_stop_ids: normalizeStringArray(
      [...normalizeStringArray(base.recent_stop_ids, 10), ...previousRouteMemory.recent_stop_ids],
      10,
    ),
    recent_move_kinds: normalizeStringArray(
      [...normalizeStringArray(base.recent_move_kinds, 8), ...previousRouteMemory.recent_move_kinds],
      8,
    ),
    recent_area_tokens: normalizeStringArray(
      [...normalizeStringArray(base.recent_area_tokens, 8), ...previousRouteMemory.recent_area_tokens],
      8,
    ),
    recent_template_ids: normalizeStringArray(
      [...normalizeStringArray(base.recent_template_ids, 6), ...previousRouteMemory.recent_template_ids],
      6,
    ),
    last_blitz_at: typeof base.last_blitz_at === "string" && base.last_blitz_at.trim() ? base.last_blitz_at : null,
  };
}

function buildAreaTokens(item, cityConfig) {
  const area = String(item?.area || "").toLowerCase();
  const definitions = cityConfig.routing?.areaDefinitions || {};
  const matched = Object.entries(definitions)
    .filter(([token, definition]) => {
      const tokenText = token.replace(/-/g, " ");
      const label = String(definition?.label || "").toLowerCase();
      return area.includes(tokenText) || (label && area.includes(label));
    })
    .map(([token]) => token);

  if (matched.length) {
    return uniqueNonEmpty(matched);
  }

  if (!area) {
    return [];
  }

  return [slugifyToken(String(item.area).split("/")[0])];
}

function buildAreaMacro(item, cityConfig) {
  const tokens = buildAreaTokens(item, cityConfig);
  const definitions = cityConfig.routing?.areaDefinitions || {};

  for (const token of tokens) {
    if (definitions[token]?.macro) {
      return definitions[token].macro;
    }
  }

  return null;
}

function deriveMoveKind(item) {
  const availability = normalizeAvailability(item.availability);

  if (availability?.kind) {
    return availability.kind;
  }

  if ((item.tags || []).includes("second_hand") || (item.tags || []).includes("vintage")) {
    return "vintage_stop";
  }

  if ((item.tags || []).includes("nattliv") || (item.tags || []).includes("cocktail")) {
    return "evening_stop";
  }

  if ((item.tags || []).includes("kultur") || (item.tags || []).includes("klassiker")) {
    return "culture_stop";
  }

  if ((item.tags || []).includes("utsikt")) {
    return "view_stop";
  }

  return item.kind || "stop";
}

function buildCandidateVibes(item) {
  const vibes = new Set();
  const tags = new Set(item.tags || []);

  if (tags.has("nattliv") || tags.has("cocktail") || tags.has("öl") || tags.has("vin")) {
    vibes.add("evening");
  }

  if (tags.has("party")) {
    vibes.add("party");
  }

  if (tags.has("kultur") || tags.has("kyrkor") || tags.has("klassiker")) {
    vibes.add("culture");
  }

  if (tags.has("hidden gems") || tags.has("low-key") || tags.has("utsikt")) {
    vibes.add("low_key");
  }

  return vibes;
}

function buildAvailabilityContext(stops = [], weekday = null) {
  const withAvailability = (stops || [])
    .map((stop) => ({
      stop,
      availability: normalizeAvailability(stop.availability),
    }))
    .filter((entry) => entry.availability);

  if (!withAvailability.length) {
    return null;
  }

  const dominant = withAvailability.find((entry) =>
    ["event_market", "market"].includes(entry.availability.kind),
  ) || withAvailability[0];
  const strong = dominant.availability.strongWeekdays.includes(weekday);
  const weak = dominant.availability.weakWeekdays.includes(weekday);

  return {
    kind: dominant.availability.kind,
    day_fit: strong ? "strong" : weak ? "weak" : "stable",
    note: dominant.availability.note || null,
    verify_recommended: dominant.availability.verifyRecommended,
  };
}

function isMarketStyleAvailability(availability) {
  return Boolean(availability && ["market", "event_market"].includes(availability.kind));
}

function isWeakMarketAvailability(availability, weekday) {
  return Boolean(isMarketStyleAvailability(availability) && availability.weakWeekdays.includes(weekday));
}

function isStrongMarketAvailability(availability, weekday) {
  return Boolean(isMarketStyleAvailability(availability) && availability.strongWeekdays.includes(weekday));
}

function scoreLeadAvailabilityFit(availability, weekday) {
  if (isWeakMarketAvailability(availability, weekday)) {
    return -1.8;
  }

  if (isStrongMarketAvailability(availability, weekday)) {
    return 0.55;
  }

  return 0;
}

function scoreTimeBandForItem(item, timeBand) {
  const config = timeBandTagBoosts[timeBand] || timeBandTagBoosts.midday;
  const tags = new Set(item.tags || []);
  const availability = normalizeAvailability(item.availability);
  const moveKind = availability?.kind || item.kind;
  let score = 0;

  config.boost.forEach((tag) => {
    if (tags.has(tag) || moveKind === tag) {
      score += 0.9;
    }
  });

  config.dampen.forEach((tag) => {
    if (tags.has(tag) || moveKind === tag) {
      score -= 1;
    }
  });

  if ((item.weatherTags || []).includes("evening") && timeBand === "evening") {
    score += 1;
  }

  if ((item.weatherTags || []).includes("golden-hour") && (timeBand === "afternoon" || timeBand === "evening")) {
    score += 0.8;
  }

  return Number(score.toFixed(2));
}

function buildTimeReason(item, timeBand, lang = "sv") {
  const tags = new Set(item.tags || []);

  if (timeBand === "evening" && (tags.has("nattliv") || tags.has("vin") || tags.has("cocktail"))) {
    return translate(lang, "blitz.timeReason.evening");
  }

  if (timeBand === "afternoon" && (tags.has("second_hand") || tags.has("shopping") || tags.has("market"))) {
    return translate(lang, "blitz.timeReason.afternoon");
  }

  if (timeBand === "midday" && (tags.has("mat") || tags.has("kultur"))) {
    return translate(lang, "blitz.timeReason.midday");
  }

  if (timeBand === "morning" && (tags.has("kultur") || tags.has("utsikt") || tags.has("hidden gems"))) {
    return translate(lang, "blitz.timeReason.morning");
  }

  if (timeBand === "late" && (tags.has("nattliv") || tags.has("cocktail"))) {
    return translate(lang, "blitz.timeReason.late");
  }

  return null;
}

function scorePulseForItem(item, pulseItems = [], cityConfig) {
  if (!Array.isArray(pulseItems) || !pulseItems.length) {
    return { score: 0, item: null };
  }

  const itemTags = new Set(item.tags || []);
  const itemAreaTokens = new Set(buildAreaTokens(item, cityConfig));
  const itemMacro = buildAreaMacro(item, cityConfig);
  const itemVibes = buildCandidateVibes(item);

  const ranked = pulseItems
    .map((pulseItem) => {
      const hints = pulseItem.route_hints || {};
      const preferredTags = new Set(hints.preferred_tags || []);
      const avoidTags = new Set(hints.avoid_tags || []);
      const preferredAreaTokens = new Set(hints.preferred_area_tokens || []);
      const avoidAreaTokens = new Set(hints.avoid_area_tokens || []);
      const preferredMacros = new Set(hints.preferred_macros || []);
      const avoidMacros = new Set(hints.avoid_macros || []);
      const preferredVibes = new Set(hints.preferred_vibes || []);
      const avoidVibes = new Set(hints.avoid_vibes || []);
      let score = 0;

      preferredTags.forEach((tag) => {
        if (itemTags.has(tag)) {
          score += 1.15;
        }
      });
      avoidTags.forEach((tag) => {
        if (itemTags.has(tag)) {
          score -= 1.2;
        }
      });
      preferredAreaTokens.forEach((token) => {
        if (itemAreaTokens.has(token)) {
          score += 1.5;
        }
      });
      avoidAreaTokens.forEach((token) => {
        if (itemAreaTokens.has(token)) {
          score -= 1.4;
        }
      });
      if (itemMacro && preferredMacros.has(itemMacro)) {
        score += 1.3;
      }
      if (itemMacro && avoidMacros.has(itemMacro)) {
        score -= 1.3;
      }
      preferredVibes.forEach((vibe) => {
        if (itemVibes.has(vibe)) {
          score += 0.9;
        }
      });
      avoidVibes.forEach((vibe) => {
        if (itemVibes.has(vibe)) {
          score -= 0.95;
        }
      });

      return {
        pulseItem,
        score: Number(score.toFixed(2)),
      };
    })
    .sort((left, right) => right.score - left.score);

  if (!ranked.length || ranked[0].score <= 0) {
    return { score: 0, item: null };
  }

  return {
    score: ranked[0].score,
    item: ranked[0].pulseItem,
  };
}

function scoreMemoryPenalty(item, memory, moveKind, areaTokens = []) {
  let penalty = 0;

  if (memory.recent_stop_ids.includes(item.id)) {
    penalty -= 3.5;
  }

  if (memory.recent_move_kinds.includes(moveKind)) {
    penalty -= 1.2;
  }

  if (areaTokens.some((token) => memory.recent_area_tokens.includes(token))) {
    penalty -= 1;
  }

  return Number(penalty.toFixed(2));
}

function buildPseudoRouteForStops(stops, origin) {
  return {
    id: `blitz-${stops.map((stop) => stop.id).join("-")}`,
    title: "Blitz-kandidat",
    main_stops: stops.map((stop) => ({
      id: stop.id,
      label: stop.name,
      lat: stop.lat,
      lng: stop.lng,
      tags: stop.tags || [],
      area: stop.area,
    })),
    map_route_points: [
      { label: origin.label, lat: origin.lat, lng: origin.lng },
      ...stops.map((stop) => ({
        label: stop.name,
        lat: stop.lat,
        lng: stop.lng,
      })),
    ],
  };
}

function formatCompactStop(stop, previousPoint = null) {
  const walkKm = previousPoint ? walkingKm([previousPoint, stop]) : 0;
  const walkMinutes = previousPoint ? walkMinutesForKm(walkKm) : 0;

  return {
    id: stop.id,
    label: stop.name,
    type: stop.kind,
    area: stop.area,
    lat: stop.lat,
    lng: stop.lng,
    tags: stop.tags || [],
    walk_from_previous_minutes: walkMinutes,
  };
}

function computeRouteDurationMinutes(origin, stops = []) {
  const points = [
    { lat: origin.lat, lng: origin.lng },
    ...stops.map((stop) => ({ lat: stop.lat, lng: stop.lng, kind: stop.kind })),
  ];
  const estimatedKm = walkingKm(points);
  const walkingMinutes = walkMinutesForKm(estimatedKm) || 0;
  const dwellMinutes = stops.reduce((sum, stop) => {
    const availability = normalizeAvailability(stop.availability);
    const kind = availability?.kind || stop.kind || "stop";
    return sum + (candidateKindDwellMinutes[kind] || candidateKindDwellMinutes.stop);
  }, 0);

  return {
    estimated_km: estimatedKm,
    walking_minutes: walkingMinutes,
    duration_minutes: walkingMinutes + dwellMinutes,
  };
}

function pickRouteStops(seedCandidate, stopCandidates, origin, timeBand, options = {}) {
  const weekday = options.weekday ?? null;
  const picked = [seedCandidate.item];
  const usedIds = new Set([seedCandidate.item.id]);
  const seedAvailability = normalizeAvailability(seedCandidate.item.availability);
  const seedIsMarket = isMarketStyleAvailability(seedAvailability);
  const sortedSupports = stopCandidates
    .filter((candidate) => candidate.item.id !== seedCandidate.item.id)
    .map((candidate) => ({
      ...candidate,
      supportScore:
        candidate.score -
        haversineKm(seedCandidate.item, candidate.item) * 2.6 +
        (candidate.areaTokens.some((token) => seedCandidate.areaTokens.includes(token)) ? 0.8 : 0),
    }))
    .sort((left, right) => right.supportScore - left.supportScore);
  const nearbyStableSupportExists = sortedSupports.some((candidate) => {
    const availability = normalizeAvailability(candidate.item.availability);
    const distanceToSeed = haversineKm(seedCandidate.item, candidate.item);
    return !isMarketStyleAvailability(availability) && Number.isFinite(distanceToSeed) && distanceToSeed <= 1.2;
  });

  for (const candidate of sortedSupports) {
    if (picked.length >= 3) {
      break;
    }

    if (usedIds.has(candidate.item.id)) {
      continue;
    }

    const distanceToSeed = haversineKm(seedCandidate.item, candidate.item);
    if (!Number.isFinite(distanceToSeed) || distanceToSeed > 1.2) {
      continue;
    }

    const candidateAvailability = normalizeAvailability(candidate.item.availability);
    if (
      !seedIsMarket &&
      nearbyStableSupportExists &&
      isWeakMarketAvailability(candidateAvailability, weekday)
    ) {
      continue;
    }

    if (timeBand === "late" && !new Set(candidate.item.tags || []).has("nattliv")) {
      continue;
    }

    picked.push(candidate.item);
    usedIds.add(candidate.item.id);
  }

  const ordered = picked
    .slice()
    .sort(
      (left, right) =>
        haversineKm(origin, left) - haversineKm(origin, right),
    );
  const duration = computeRouteDurationMinutes(origin, ordered);

  return {
    stops: ordered,
    duration,
  };
}

function buildRouteTitle(routeStops, preferences, timeBand, lang = "sv") {
  const stopNames = routeStops.map((stop) => stop.name);
  const lastStop = routeStops[routeStops.length - 1];

  if (preferences.includes("second_hand") && routeStops.some((stop) => (stop.tags || []).includes("second_hand"))) {
    return translate(lang, "blitz.routeTitle.secondHand", { area: lastStop.area });
  }

  if (timeBand === "evening" && routeStops.some((stop) => (stop.tags || []).includes("vin"))) {
    return translate(lang, "blitz.routeTitle.eveningWine", { area: lastStop.area });
  }

  return translate(lang, "blitz.routeTitle.default", { first: stopNames[0] });
}

function buildWhatToDoAfter(stops = [], lang = "sv") {
  const lastStop = stops[stops.length - 1];

  if (!lastStop) {
    return translate(lang, "blitz.afterEmpty");
  }

  const tags = new Set(lastStop.tags || []);

  if (tags.has("vin") || tags.has("öl") || tags.has("cocktail") || tags.has("nattliv")) {
    return translate(lang, "blitz.afterBar", { area: lastStop.area });
  }

  if (tags.has("mat")) {
    return translate(lang, "blitz.afterFood", { area: lastStop.area });
  }

  return translate(lang, "blitz.afterDefault", { name: lastStop.name });
}

function buildWhyNow({
  timeReason,
  pulseResult,
  truthEffect,
  availabilityContext,
  strongReason,
  lang = "sv",
}) {
  const reasons = [];

  if (strongReason) {
    reasons.push(strongReason);
  }

  // Local-truth prose is currently authored only in Swedish (see
  // server/cities/rome/local-truth.js). Until route-engine/local-truth
  // i18n lands in a follow-up PR, suppress the note text for non-SV
  // languages to avoid surfacing Swedish in /api/blitz?lang=en.
  // Scoring effects (truthEffect.score_delta) remain unchanged.
  if (lang === "sv" && truthEffect.route_context_notes[0]?.text) {
    reasons.push(truthEffect.route_context_notes[0].text);
  }

  if (pulseResult?.item?.why_it_matters) {
    reasons.push(pulseResult.item.why_it_matters);
  }

  if (availabilityContext?.day_fit === "weak" && availabilityContext.note) {
    reasons.push(availabilityContext.note);
  }

  if (timeReason) {
    reasons.push(timeReason);
  }

  return reasons.slice(0, 2).join(" ");
}

function buildStrongReason(item, walkMinutes, preferences, lang = "sv") {
  const tags = new Set(item.tags || []);

  if (
    preferences.includes("second_hand") &&
    [...secondHandCanonicalTags].some((tag) => tags.has(tag))
  ) {
    return translate(lang, "blitz.strongReason.secondHand", { name: item.name });
  }

  if (tags.has("nattliv") || tags.has("vin")) {
    return translate(lang, "blitz.strongReason.nightlife", { name: item.name });
  }

  if (Number.isFinite(walkMinutes) && walkMinutes <= 12) {
    return translate(lang, "blitz.strongReason.close", { name: item.name });
  }

  return translate(lang, "blitz.strongReason.default", { name: item.name });
}

function scorePreferenceCoverage(item, preferences, options = {}) {
  const hasSecondHandCoverage = options.hasSecondHandCoverage !== false;
  const tags = new Set(item.tags || []);
  const secondHandMatch = [...secondHandCanonicalTags].some((tag) => tags.has(tag));
  let score = 0;

  if (preferences.includes("second_hand")) {
    if (hasSecondHandCoverage) {
      score += secondHandMatch ? 4.8 : -5;
    } else if (secondHandMatch) {
      score += 2.2;
    }
  }

  if (preferences.some((tag) => ["mat", "vin", "öl", "cocktail"].includes(tag))) {
    score += ["mat", "vin", "öl", "cocktail"].some((tag) => tags.has(tag)) ? 1.25 : -0.8;
  }

  if (preferences.some((tag) => ["nattliv", "kväll", "party"].includes(tag))) {
    score += ["nattliv", "vin", "öl", "cocktail", "party"].some((tag) => tags.has(tag)) ? 1.35 : -1.1;
  }

  if (preferences.some((tag) => ["kultur", "kyrkor", "klassiker"].includes(tag))) {
    score += ["kultur", "kyrkor", "klassiker", "museum"].some((tag) => tags.has(tag)) ? 1.1 : -0.6;
  }

  if (preferences.some((tag) => ["hidden gems", "low-key", "utsikt"].includes(tag))) {
    score += ["hidden gems", "low-key", "utsikt"].some((tag) => tags.has(tag)) ? 0.95 : -0.4;
  }

  if (preferences.length && preferences.every((tag) => !tags.has(tag)) && !secondHandMatch) {
    score -= 1.8;
  }

  return Number(score.toFixed(2));
}

function buildCandidateSummary(
  item,
  truthEffect,
  availabilityContext,
  pulseResult,
  timeBand,
  preferences,
  walkMinutes,
  coverageNote = null,
  lang = "sv",
) {
  const timeReason = buildTimeReason(item, timeBand, lang);
  const strongReason = buildStrongReason(item, walkMinutes, preferences, lang);

  // See note in buildWhyNow: local-truth prose is SV-only until follow-up
  // i18n PR. Omit it from contextual_reasons for non-SV languages.
  const truthRouteContextNote =
    lang === "sv" ? truthEffect.route_context_notes[0]?.text || null : null;

  return {
    why_now: buildWhyNow({
      timeReason,
      pulseResult,
      truthEffect,
      availabilityContext,
      strongReason,
      lang,
    }) || coverageNote || strongReason,
    contextual_reasons: uniqueNonEmpty([
      coverageNote,
      strongReason,
      truthRouteContextNote,
      pulseResult?.item?.title
        ? translate(lang, "blitz.pulseRightNow", { title: pulseResult.item.title })
        : null,
      timeReason,
    ]),
  };
}

function buildSingleStopCandidate({
  item,
  origin,
  preferences,
  timeBand,
  pulseItems,
  cityConfig,
  date,
  weekday,
  memory,
  hasSecondHandCoverage,
  coverageNote,
  lang = "sv",
}) {
  const areaTokens = buildAreaTokens(item, cityConfig);
  const moveKind = deriveMoveKind(item);
  const distanceKm = walkingKm([origin, item]);
  const walkMinutes = walkMinutesForKm(distanceKm);
  const tags = new Set(item.tags || []);
  const tagHits = preferences.filter((tag) => tags.has(tag)).length;
  const preferenceCoverageScore = scorePreferenceCoverage(item, preferences, {
    hasSecondHandCoverage,
  });
  const timeScore = scoreTimeBandForItem(item, timeBand);
  const pulseResult = scorePulseForItem(item, pulseItems, cityConfig);
  const pseudoRoute = buildPseudoRouteForStops([item], origin);
  const truthEffect = evaluateLocalTruth(cityConfig, {
    date,
    weekday,
    route: pseudoRoute,
    routeStops: [item],
    preferences,
    optimizerMode: null,
    modifier: null,
  });
  const leadAvailability = normalizeAvailability(item.availability);
  const availabilityContext = buildAvailabilityContext([item], weekday);
  const memoryPenalty = scoreMemoryPenalty(item, memory, moveKind, areaTokens);
  const distanceScore =
    distanceKm <= 0.35
      ? 5
      : distanceKm <= 0.7
        ? 4
        : distanceKm <= 1.1
          ? 2.6
          : distanceKm <= 1.8
            ? 1
            : -Math.min(3.8, distanceKm * 1.4);
  const intentScore = tagHits * 1.7;
  const secondHandBonus =
    preferences.includes("second_hand") && [...secondHandCanonicalTags].some((tag) => tags.has(tag))
      ? 1.6
      : 0;
  const totalScore = Number(
    (
      distanceScore +
      intentScore +
      preferenceCoverageScore +
      secondHandBonus +
      timeScore +
      scoreLeadAvailabilityFit(leadAvailability, weekday) +
      pulseResult.score +
      truthEffect.score_delta +
      memoryPenalty
    ).toFixed(2),
  );
  const summary = buildCandidateSummary(
    item,
    truthEffect,
    availabilityContext,
    pulseResult,
    timeBand,
    preferences,
    walkMinutes,
    coverageNote,
    lang,
  );

  return {
    candidate_id: `single:${item.id}`,
    kind: "single_stop",
    move_kind: moveKind,
    primary_stop_id: item.id,
    item,
    areaTokens,
    score: totalScore,
    walk_minutes: walkMinutes,
    effort: resolveEffortLabel(walkMinutes, lang),
    why_now: summary.why_now,
    contextual_reasons: summary.contextual_reasons,
    caution_notes:
      lang === "sv" ? truthEffect.caution_notes.map((note) => note.text) : [],
    local_truth: localTruthForLang(truthEffect, lang),
    pulse_context: pulseResult.item
      ? {
          id: pulseResult.item.id,
          title: pulseResult.item.title,
          why_it_matters: pulseResult.item.why_it_matters,
          signal_type: pulseResult.item.signal_type || null,
          signal_label: labelSignalType(pulseResult.item.signal_type, lang),
        }
      : null,
    availability: availabilityContext,
    stop: formatCompactStop(item),
    what_to_do_after: buildWhatToDoAfter([item], lang),
  };
}

function buildMiniRouteCandidate({
  seedCandidate,
  stopCandidates,
  origin,
  preferences,
  timeBand,
  cityConfig,
  date,
  weekday,
  memory,
  coverageNote,
  lang = "sv",
}) {
  const seedAvailability = normalizeAvailability(seedCandidate.item.availability);
  const pickedRoute = pickRouteStops(seedCandidate, stopCandidates, origin, timeBand, { weekday });
  const routeStops = pickedRoute.stops;

  if (routeStops.length < 2) {
    return null;
  }

  const pseudoRoute = buildPseudoRouteForStops(routeStops, origin);
  const truthEffect = evaluateLocalTruth(cityConfig, {
    date,
    weekday,
    route: pseudoRoute,
    routeStops,
    preferences,
    optimizerMode: null,
    modifier: null,
  });
  const availabilityContext = buildAvailabilityContext(routeStops, weekday);
  const walkMinutes = pickedRoute.duration.walking_minutes;
  const totalDuration = pickedRoute.duration.duration_minutes;

  if (totalDuration < 35 || totalDuration > 85) {
    return null;
  }

  const weakMarketTailPenalty = routeStops.slice(1).reduce((penalty, stop) => {
    const availability = normalizeAvailability(stop.availability);
    return penalty + (isWeakMarketAvailability(availability, weekday) ? -1.1 : 0);
  }, 0);
  const leadAvailabilityScore = scoreLeadAvailabilityFit(seedAvailability, weekday);
  const routeScore =
    routeStops.reduce((sum, stop) => {
      const stopCandidate = stopCandidates.find((candidate) => candidate.item.id === stop.id);
      return sum + (stopCandidate?.score || 0);
    }, 0) /
      routeStops.length +
    (routeStops.length >= 3 ? 1.2 : 0.65) +
    truthEffect.score_delta +
    weakMarketTailPenalty +
    leadAvailabilityScore;
  const routeAreaTokens = uniqueNonEmpty(routeStops.flatMap((stop) => buildAreaTokens(stop, cityConfig)));
  const memoryPenalty = routeStops.reduce((penalty, stop) => {
    return penalty + scoreMemoryPenalty(stop, memory, "mini_route_60", routeAreaTokens);
  }, 0);
  const pulseResult = scorePulseForItem(routeStops[0], cityConfig.services.getCityPulse(date, { lang })?.items || [], cityConfig);
  const summary = buildCandidateSummary(
    routeStops[0],
    truthEffect,
    availabilityContext,
    pulseResult,
    timeBand,
    preferences,
    walkMinutes,
    coverageNote,
    lang,
  );
  const orderedStops = routeStops.map((stop, index) =>
    formatCompactStop(stop, index === 0 ? origin : routeStops[index - 1]),
  );

  return {
    candidate_id: `mini:${routeStops.map((stop) => stop.id).join(":")}`,
    kind: "mini_route_60",
    move_kind: "mini_route_60",
    primary_stop_id: routeStops[0].id,
    item: routeStops[0],
    areaTokens: routeAreaTokens,
    score: Number((routeScore + memoryPenalty).toFixed(2)),
    walk_minutes: walkMinutes,
    effort: resolveEffortLabel(walkMinutes, lang),
    why_now: summary.why_now,
    contextual_reasons: summary.contextual_reasons,
    caution_notes:
      lang === "sv" ? truthEffect.caution_notes.map((note) => note.text) : [],
    local_truth: localTruthForLang(truthEffect, lang),
    pulse_context: pulseResult.item
      ? {
          id: pulseResult.item.id,
          title: pulseResult.item.title,
          why_it_matters: pulseResult.item.why_it_matters,
          signal_type: pulseResult.item.signal_type || null,
          signal_label: labelSignalType(pulseResult.item.signal_type, lang),
        }
      : null,
    availability: availabilityContext,
    route: {
      title: buildRouteTitle(routeStops, preferences, timeBand, lang),
      duration_minutes: totalDuration,
      estimated_km: pickedRoute.duration.estimated_km,
      stops: orderedStops,
    },
    what_to_do_after: buildWhatToDoAfter(routeStops, lang),
  };
}

function filterCandidateItems(cityConfig) {
  return cityConfig.catalog.allItems.filter(
    (item) => item.kind !== "district" && item.kind !== "district-group",
  );
}

function buildStopCandidates(params) {
  const {
    cityConfig,
    origin,
    preferences,
    timeBand,
    pulseItems,
    date,
    weekday,
    memory,
    hasSecondHandCoverage,
    coverageNote,
    lang = "sv",
  } = params;

  return filterCandidateItems(cityConfig)
    .map((item) =>
      buildSingleStopCandidate({
        item,
        origin,
        preferences,
        timeBand,
        pulseItems,
        cityConfig,
        date,
        weekday,
        memory,
        hasSecondHandCoverage,
        coverageNote,
        lang,
      }),
    )
    .filter((candidate) => Number.isFinite(candidate.score))
    .sort((left, right) => right.score - left.score)
    .slice(0, 16);
}

function buildAllCandidates(params) {
  const stopCandidates = buildStopCandidates(params);
  const bestStopCandidates = stopCandidates.slice(0, 5);
  const miniRouteCandidates = bestStopCandidates
    .map((seedCandidate) =>
      buildMiniRouteCandidate({
        seedCandidate,
        stopCandidates: bestStopCandidates,
        origin: params.origin,
        preferences: params.preferences,
        timeBand: params.timeBand,
        cityConfig: params.cityConfig,
        date: params.date,
        weekday: params.weekday,
        memory: params.memory,
        coverageNote: params.coverageNote,
        lang: params.lang,
      }),
    )
    .filter(Boolean);

  return [...stopCandidates, ...miniRouteCandidates]
    .sort((left, right) => right.score - left.score)
    .filter((candidate, index, array) => {
      return (
        array.findIndex(
          (entry) => entry.kind === candidate.kind && entry.primary_stop_id === candidate.primary_stop_id,
        ) === index
      );
    });
}

function choosePrimaryAndBackup(candidates, requestedMode = DEFAULT_BLITZ_MODE) {
  const mode = requestedMode || DEFAULT_BLITZ_MODE;
  const filtered =
    mode === "mini_route_60"
      ? candidates.filter((candidate) => candidate.kind === "mini_route_60")
      : mode === "next_move"
        ? candidates.filter((candidate) => candidate.kind === "single_stop")
        : candidates;
  const ranked = filtered.length ? filtered : candidates;
  const primary = ranked[0] || null;
  const backup =
    ranked.find(
      (candidate) =>
        primary &&
        (candidate.primary_stop_id !== primary.primary_stop_id || candidate.kind !== primary.kind),
    ) || null;

  return { primary, backup };
}

function buildUpdatedMemory(memory, candidate, nowIso) {
  if (!candidate) {
    return {
      ...memory,
      last_blitz_at: nowIso,
    };
  }

  const routeStops =
    candidate.kind === "mini_route_60"
      ? candidate.route.stops.map((stop) => stop.id)
      : [candidate.primary_stop_id];
  const areaTokens = candidate.areaTokens || [];

  return {
    recent_stop_ids: normalizeStringArray([...memory.recent_stop_ids, ...routeStops], 10),
    recent_move_kinds: normalizeStringArray([...memory.recent_move_kinds, candidate.move_kind], 8),
    recent_area_tokens: normalizeStringArray([...memory.recent_area_tokens, ...areaTokens], 8),
    recent_template_ids: normalizeStringArray(memory.recent_template_ids, 6),
    last_blitz_at: nowIso,
  };
}

function formatMoveOutput(candidate) {
  if (!candidate) {
    return null;
  }

  const base = {
    kind: candidate.kind,
    title:
      candidate.kind === "mini_route_60"
        ? candidate.route.title
        : candidate.stop.label,
    why_now: candidate.why_now,
    walking_minutes: candidate.walk_minutes,
    effort: candidate.effort,
    what_to_do_after: candidate.what_to_do_after,
    contextual_reasons: candidate.contextual_reasons,
    caution_notes: candidate.caution_notes,
    local_truth: candidate.local_truth,
    availability: candidate.availability,
    pulse_context: candidate.pulse_context,
  };

  if (candidate.kind === "mini_route_60") {
    return {
      ...base,
      route: candidate.route,
    };
  }

  return {
    ...base,
    stop: candidate.stop,
  };
}

async function buildBlitzDecision(cityConfig, payload = {}) {
  const lang = normalizeLanguage(payload.lang);
  const nowContext = resolveNowContext(cityConfig, payload);
  const origin = await resolveOriginPoint(cityConfig, payload.origin || payload.start || null);
  const { intent_keys, preferences } = resolveBlitzPreferences(payload);
  const memory = normalizeBlitzMemory(payload.memory, payload.previous_route);
  const weekday = getIsoWeekday(nowContext.date);
  const timeBand = resolveTimeBand(nowContext.hour);
  const pulse = cityConfig.services.getCityPulse(nowContext.date, { lang });
  const hasSecondHandCoverage = cityConfig.catalog.allItems.some((item) =>
    ["second_hand", "vintage", "antique"].some((tag) => (item.tags || []).includes(tag)),
  );
  const coverageNote =
    preferences.includes("second_hand") && !hasSecondHandCoverage
      ? translate(lang, "blitz.coverageNoteNoSecondHand", { city: cityConfig.label })
      : null;
  const candidates = buildAllCandidates({
    cityConfig,
    origin,
    preferences,
    timeBand,
    pulseItems: pulse.items || [],
    pulse,
    date: nowContext.date,
    weekday,
    memory,
    hasSecondHandCoverage,
    coverageNote,
    lang,
  });
  const { primary, backup } = choosePrimaryAndBackup(candidates, payload.mode || DEFAULT_BLITZ_MODE);
  const updatedMemory = buildUpdatedMemory(memory, primary, nowContext.now_iso);

  return {
    city: cityConfig.key,
    context: {
      date: nowContext.date,
      now: nowContext.now_iso,
      weekday,
      time_band: timeBand,
      origin_label: origin.label,
      origin,
      mode: payload.mode || DEFAULT_BLITZ_MODE,
      intent_keys,
      preferences,
      coverage_note: coverageNote,
    },
    best_move: formatMoveOutput(primary),
    backup_option: formatMoveOutput(backup),
    reroll_supported: true,
    memory: updatedMemory,
  };
}

module.exports = {
  buildBlitzDecision,
  resolveBlitzPreferences,
  normalizeBlitzMemory,
};
