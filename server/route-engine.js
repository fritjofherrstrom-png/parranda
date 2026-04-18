const { routeTemplates, allItems, findItemByName } = require("./catalog");
const { geocodeQuery } = require("./geocoding");
const { fetchWeatherForDates, ROME_CENTER } = require("./weather");
const { getCityPulse, getDateSignals } = require("./editorial-calendar");
const { fetchLiveEventsForDates } = require("./live-events");

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

function weekdayFromDate(dateString) {
  return new Date(`${dateString}T12:00:00+02:00`).getDay();
}

function expandDateRange(dates) {
  if (!Array.isArray(dates) || !dates.length) {
    return [];
  }

  const unique = [...new Set(dates)].sort();
  return unique;
}

async function resolvePoint(input, fallbackLabel = "Trastevere") {
  if (!input || !input.type) {
    const fallback = findItemByName(fallbackLabel);
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
    const found = findItemByName(input.label);
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

    const candidates = await geocodeQuery(input.query || input.label);
    if (candidates[0]) {
      return {
        label: candidates[0].label,
        lat: candidates[0].lat,
        lng: candidates[0].lng,
        source: candidates[0].source,
      };
    }
  }

  const fallback = findItemByName(fallbackLabel);
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

const areaDefinitions = {
  trastevere: { label: "Trastevere", macro: "west" },
  gianicolo: { label: "Gianicolo", macro: "west" },
  prati: { label: "Prati", macro: "west" },
  borgo: { label: "Borgo", macro: "west" },
  centro: { label: "Centro Storico", macro: "center" },
  ghetto: { label: "Jewish Ghetto", macro: "center" },
  monti: { label: "Monti", macro: "center" },
  celio: { label: "Celio", macro: "center" },
  colosseum: { label: "Colosseo", macro: "center" },
  colosseo: { label: "Colosseo", macro: "center" },
  navona: { label: "Navona", macro: "center" },
  campo: { label: "Campo de' Fiori", macro: "center" },
  sallustiano: { label: "Sallustiano", macro: "center" },
  "villa-borghese": { label: "Villa Borghese", macro: "center" },
  testaccio: { label: "Testaccio", macro: "south" },
  ostiense: { label: "Ostiense", macro: "south" },
  aventino: { label: "Aventino", macro: "south" },
  garbatella: { label: "Garbatella", macro: "south" },
  portuense: { label: "Portuense/Marconi", macro: "south" },
  marconi: { label: "Portuense/Marconi", macro: "south" },
  piramide: { label: "Piramide", macro: "south" },
  pigneto: { label: "Pigneto", macro: "east" },
  "san-lorenzo": { label: "San Lorenzo", macro: "east" },
  esquilino: { label: "Esquilino", macro: "east" },
  "san-giovanni": { label: "San Giovanni", macro: "east" },
  laterano: { label: "Laterano", macro: "east" },
  termini: { label: "Termini", macro: "east" },
};

const macroAreaLabels = {
  west: "västra Rom",
  center: "centrala Rom",
  south: "södra Rom",
  east: "östra Rom",
};

function slugifyText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function extractAreaTokens(...values) {
  const flattenedValues = values.flat().filter(Boolean);
  const tokens = new Set();

  flattenedValues.map(slugifyText).forEach((text) => {
    Object.keys(areaDefinitions).forEach((token) => {
      if (text.includes(token)) {
        tokens.add(token);
      }
    });
  });

  return tokens;
}

function primaryAreaToken(...values) {
  const flattenedValues = values.flat().filter(Boolean);

  for (const text of flattenedValues.map(slugifyText)) {
    for (const token of Object.keys(areaDefinitions)) {
      if (text.includes(token)) {
        return token;
      }
    }
  }

  return null;
}

function tokenLabel(token) {
  return areaDefinitions[token]?.label || null;
}

function macroLabel(macro) {
  return macroAreaLabels[macro] || "Rom";
}

function findNearestCatalogItem(point) {
  if (!point || typeof point.lat !== "number" || typeof point.lng !== "number") {
    return null;
  }

  return allItems.reduce((closest, item) => {
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

  const tokens = extractAreaTokens(item.area, item.id, item.name, item.searchTerms || []);
  const primaryToken =
    primaryAreaToken(item.area, item.id, item.name, item.searchTerms || []) ||
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

function areaScore({ routeStops, startPoint, endPoint, distanceMode }) {
  if (!Array.isArray(routeStops) || !routeStops.length) {
    return {
      score: 0,
      note: null,
    };
  }

  const routeProfile = buildRouteAreaProfile(routeStops);
  const startProfile = buildPointAreaProfile(startPoint);
  const endProfile = buildPointAreaProfile(endPoint);
  let score = 0;
  const notes = [];

  const applyAnchorScore = (profile) => {
    if (!profile?.primaryMacro) {
      return;
    }

    if (profile.primaryToken && routeProfile.tokens.has(profile.primaryToken)) {
      score += 5.5;
      return;
    }

    if (routeProfile.macros.has(profile.primaryMacro)) {
      score += 2.5;
      return;
    }

    score -= 4;
  };

  applyAnchorScore(startProfile);
  applyAnchorScore(endProfile);

  const sameMacro =
    startProfile?.primaryMacro &&
    endProfile?.primaryMacro &&
    startProfile.primaryMacro === endProfile.primaryMacro;

  if (sameMacro) {
    if (routeProfile.dominantMacro === startProfile.primaryMacro) {
      score += 4.5;
    } else if (routeProfile.macros.has(startProfile.primaryMacro)) {
      score += 2;
    }

    if (distanceMode !== "no_limit" && routeProfile.macros.size > 2) {
      score -= 1.5;
    }

    if (routeProfile.dominantMacro === startProfile.primaryMacro) {
      notes.push(
        `Rutten håller sig främst i ${macroLabel(startProfile.primaryMacro)} runt ${
          tokenLabel(routeProfile.dominantToken) || startProfile.primaryLabel
        } i stället för att dra tvärs över stan i onödan.`,
      );
    }
  } else if (startProfile?.primaryMacro && endProfile?.primaryMacro) {
    if (
      routeProfile.macros.has(startProfile.primaryMacro) &&
      routeProfile.macros.has(endProfile.primaryMacro)
    ) {
      score += 4.5;
      notes.push(
        `Rutten binder ihop ${macroLabel(startProfile.primaryMacro)} och ${macroLabel(
          endProfile.primaryMacro,
        )} på ett mer naturligt sätt än de mer generiska looparna.`,
      );
    } else {
      score -= 2.5;
    }

    if (
      routeProfile.dominantMacro &&
      ![startProfile.primaryMacro, endProfile.primaryMacro].includes(routeProfile.dominantMacro)
    ) {
      score -= 1.5;
    }
  }

  if (
    routeProfile.dominantMacro === "west" &&
    startProfile?.primaryMacro !== "west" &&
    endProfile?.primaryMacro !== "west"
  ) {
    score -= 2.5;
  }

  if (!notes.length && startProfile?.primaryToken && routeProfile.tokens.has(startProfile.primaryToken)) {
    notes.push(
      `Rutten tar faktiskt avstamp i ${startProfile.primaryLabel} i stället för att direkt hoppa till fel sida av stan.`,
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

function weatherScore(route, weather) {
  if (!weather) {
    return { score: 0, note: null };
  }

  let score = 0;
  const notes = [];

  if (weather.condition === "rain") {
    score += route.weatherProfile.rain || 0;
    notes.push("Regn väntas, så inomhus- och kvartersstopp väger lite tyngre.");
  } else if (weather.condition === "sun") {
    score += route.weatherProfile.sun || 0;
    notes.push("Soligt väder gör utevyer och längre promenadpartier extra starka.");
  } else {
    score += 1;
  }

  if (weather.hot) {
    score += route.weatherProfile.hot || 0;
    notes.push("Hög värme gör att pauser och skuggigare partier prioriteras.");
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
  return routeStops
    .filter((stop) => stop.closedWeekdays.includes(weekday))
    .map((stop) => `${stop.name} är kuraterat som svagare eller stängt den här veckodagen.`);
}

function buildVenueSpecials(routeStops, weekday) {
  return routeStops
    .filter((stop) => stop.happyHourNote || stop.bookingRequired)
    .map((stop) => {
      const weekdayLabel = ["söndag", "måndag", "tisdag", "onsdag", "torsdag", "fredag", "lördag"][
        weekday
      ];

      if (stop.happyHourNote && stop.bookingRequired) {
        return `${stop.name}: ${stop.happyHourNote} Boka gärna om ${weekdayLabel} är en kväll du verkligen vill låsa.`;
      }

      if (stop.happyHourNote) {
        return `${stop.name}: ${stop.happyHourNote}`;
      }

      return `${stop.name}: boka smart om det här är ett viktigt kvällsankare.`;
    });
}

function buildBudgetNote(routeStops, preferences, optimizerMode, budgetTier) {
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
      return `Budgetläge: den här dagen lutar tydligt mot billig öl, prisvärd mat och stopp som håller nere notan.`;
    }

    if (averagePrice <= 1.65) {
      return `Budgetläge: dagen håller en ganska snäll prisnivå med ${cheaperStops} tydligt prisvänliga stopp inbakade.`;
    }

    return `Budgetläge: det här är fortfarande ett starkt upplägg, men det finns dyrare stopp längs vägen än i de mest prisvänliga alternativen.`;
  }

  if (premiumStops >= 2 && averagePrice >= 2.3) {
    return `La Dolce Vita: rutten lutar tydligt mot premiumglas, bokningsvärda stopp och en större kvällskänsla.`;
  }

  if (averagePrice >= 1.9) {
    return `La Dolce Vita: den här dagen håller en tydligt högre nivå i glas, middag eller kvällsrum utan att bli stel.`;
  }

  return `La Dolce Vita: dagen har fortfarande några mjukare ankare, men den viktas upp mot mer premium och mer extravagant final.`;
}

function budgetScore(routeStops, preferences, optimizerMode, budgetTier = "standard") {
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
      note: buildBudgetNote(routeStops, preferences, optimizerMode, budgetTier),
    };
  }

  return {
    score: Math.round((averagePrice * 2.5 + premiumStops * 1.4 + bookedStops * 0.8 - cheaperStops * 0.3) * 10) / 10,
    note: buildBudgetNote(routeStops, preferences, optimizerMode, budgetTier),
  };
}

function buildRouteFromTemplate(template, start, end, targetKm) {
  const rawStops = template.stops
    .map((stopId) => findItemByName(stopId))
    .filter(Boolean)
    .map((stop) => ({
      id: stop.id,
      label: stop.name,
      lat: stop.lat,
      lng: stop.lng,
      type: stop.kind,
      area: stop.area,
      tags: stop.tags,
    }));

  const mainStops = rawStops.filter((stop, index) => {
    const isDuplicatedStart = index === 0 && stop.label === start.label;
    const isDuplicatedEnd = index === rawStops.length - 1 && stop.label === end.label;

    return !isDuplicatedStart && !isDuplicatedEnd;
  });

  const mapRoutePoints = [
    { label: start.label, lat: start.lat, lng: start.lng, role: "start" },
    ...mainStops.map((stop, index) => ({
      label: stop.label,
      lat: stop.lat,
      lng: stop.lng,
      role: index === 0 ? "first-stop" : "stop",
    })),
    { label: end.label, lat: end.lat, lng: end.lng, role: "end" },
  ];

  const estimatedKm = Math.max(
    template.defaultKm,
    walkingKm(mapRoutePoints),
    targetKm ? targetKm - 1 : 0,
  );

  return {
    id: template.id,
    title: template.title,
    summary: template.summary,
    estimated_km: Number(estimatedKm.toFixed(1)),
    start_label: start.label,
    end_label: end.label,
    main_stops: mainStops,
    hidden_mentions: template.hiddenMentions,
    bar_mentions: template.barMentions,
    map_route_points: mapRoutePoints,
  };
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
      reasonParts.push("rutten bär rätt typ av stopp för dagens rytm");
    }

    if (avoidTagHits.length) {
      score -= Math.min(3.4, avoidTagHits.length * 1.4);
    }

    if (routeArea.dominantToken && hints.preferredAreaTokens.has(routeArea.dominantToken)) {
      score += 3.5;
      reasonParts.push(`${tokenLabel(routeArea.dominantToken) || routeArea.dominantToken} spelar extra bra just nu`);
    } else if ([...hints.preferredAreaTokens].some((token) => routeArea.tokens.has(token))) {
      score += 1.9;
    }

    if (routeArea.dominantMacro && hints.preferredMacros.has(routeArea.dominantMacro)) {
      score += 2.6;
      if (!reasonParts.length) {
        reasonParts.push(`${macroLabel(routeArea.dominantMacro)} bär den här typen av dag bättre just nu`);
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
        reasonParts.push(`rutten matchar tydligt att du valde ${modifierLabel[vibeKey] || vibeKey}`);
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
    : "Den här rutten följer dagens rytm bättre än de mer generiska alternativen.";
  const note = lead
    ? `Just nu i Rom: ${lead.item.title}. ${
        leadReason
      }.`
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
}) {
  if (!Array.isArray(liveEvents) || !liveEvents.length) {
    return { score: 0, note: null };
  }

  const activeModifier = normalizeModifier(modifier, optimizerMode);
  const routeTags = buildRouteTagSetFromData(template, route, routeStops);
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
        score:
          tagHits * 1.5 +
          preferenceHits * 0.9 +
          modifierHits * 1.25 +
          proximityScore,
      };
    })
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
    note: `Live i dag: ${best.event.title} ligger ovanligt bra på eller nära den här rutten och gör upplägget mer tidsbundet på ett bra sätt.`,
  };
}

function buildRouteFitNote(routeChoice, distanceKm) {
  if (distanceKm === null || !Number.isFinite(distanceKm)) {
    return `Passar bäst med ${routeChoice.label.toLowerCase()} sett till dagens helhet.`;
  }

  if (distanceKm <= 0.35) {
    return `Passar bäst med ${routeChoice.label.toLowerCase()} och ligger nästan direkt på sträckningen.`;
  }

  if (distanceKm <= 1) {
    return `Passar bäst med ${routeChoice.label.toLowerCase()} och kräver bara en kort avstickare.`;
  }

  return `Passar bäst med ${routeChoice.label.toLowerCase()}, men räkna med en tydligare avstickare.`;
}

function annotateLiveEventsForRoutes(liveEvents, routeChoices) {
  return (liveEvents || []).map((event) => {
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
      route_fit_note: buildRouteFitNote(bestRoute, distanceKm),
    };
  });
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
  routeStops,
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
  const weatherFit = weatherScore(template, weather);
  const optimizerScore = optimizerModeScore(template, optimizerMode, budgetTier, modifier);
  const normalizedRouteStops = Array.isArray(routeStops) ? routeStops : [];
  const budgetFit = budgetScore(normalizedRouteStops, preferences, optimizerMode, budgetTier);
  const profileFit = profileScore(template, preferences, optimizerMode, modifier);
  const pulseFit = pulseScore({
    template,
    route,
    routeStops: normalizedRouteStops,
    pulseItems,
    preferences,
    optimizerMode,
    modifier,
  });
  const liveFit = liveEventRouteScore({
    route,
    template,
    liveEvents,
    preferences,
    optimizerMode,
    modifier,
    routeStops: normalizedRouteStops,
  });
  const areaFit = areaScore({
    routeStops: normalizedRouteStops,
    startPoint,
    endPoint,
    distanceMode,
  });
  const reusedPenalty = reusedIds.has(template.id) ? -6 : 0;

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
      startProximity +
      endProximity +
      reusedPenalty,
    weatherNote: weatherFit.note,
    budgetNote: budgetFit.note,
    pulseNote: pulseFit.note,
    pulseAnchor: pulseFit.anchor,
    liveEventNote: liveFit.note,
    areaNote: areaFit.note,
    profile: profileFit.profile,
  };
}

function whyRecommended(
  template,
  preferences,
  route,
  weather,
  optimizerMode,
  distanceMode,
  budgetTier,
  modifier,
  pulseNote,
  liveEventNote,
  areaNote,
) {
  const prefMatches = preferences.filter((pref) => template.preferenceTags.includes(pref));
  const reasonParts = [];
  const profile = normalizeVibeProfile(template);
  const activeBudgetTier = normalizeBudgetTier(preferences, optimizerMode, budgetTier);
  const activeModifier = normalizeModifier(modifier, optimizerMode);

  if (prefMatches.length) {
    reasonParts.push(`Den matchar särskilt bra för ${prefMatches.join(", ")}.`);
  }

  if (preferences.includes("kväll") && profile.evening >= 2) {
    reasonParts.push("Rutten är byggd för att bli starkare ju senare dagen blir, inte för att pika för tidigt.");
  }

  if (preferences.includes("kultur") && profile.culture >= 2) {
    reasonParts.push("Kulturdelen är här ett riktigt bärande lager med stopp som känns värda i sig.");
  }

  if (preferences.includes("low-key") && profile.lowKey >= 2) {
    reasonParts.push("Tempot hålls mer low-key med bättre samtalsstopp och mindre showig energi.");
  }

  if (preferences.includes("party") && profile.party >= 2) {
    reasonParts.push("Kvällen lutar tydligt mot mer puls, tätare glasstopp och senare energi.");
  }

  if (activeModifier === "evening" && profile.evening >= 2) {
    reasonParts.push("Du valde mer kväll, och den här rutten blir faktiskt bättre ju senare dagen går.");
  }

  if (activeModifier === "culture" && profile.culture >= 2) {
    reasonParts.push("Du bad om mer kultur, och här bär riktiga rum, kyrkor eller kulturlager större del av dagen.");
  }

  if (activeModifier === "low_key" && profile.lowKey >= 2) {
    reasonParts.push("Du valde low-key, så tempot hålls mjukare med bättre samtalsstopp och mindre show.");
  }

  if (activeModifier === "party" && profile.party >= 2) {
    reasonParts.push("Du valde party, och den här rutten har tydligare nattenergi än de lugnare alternativen.");
  }

  if (distanceMode === "no_limit") {
    reasonParts.push(
      `Du valde "spelar ingen roll" på avstånd, så rutten får vara friare mellan ${route.start_label} och ${route.end_label} än strikt km-styrd.`,
    );
  } else {
    reasonParts.push(`Rutten kopplar ${route.start_label} till ${route.end_label} på cirka ${route.estimated_km} km.`);
  }

  if (optimizerMode && template.optimizerModes?.includes(optimizerMode)) {
    reasonParts.push("Den här rutten matchar det valda optimizer-läget extra tydligt.");
  }

  if (activeBudgetTier === "budget") {
    reasonParts.push("Du bad om ett mer budgetvänligt upplägg, så prisnivå och billiga ankare väger tyngre.");
  } else if (activeBudgetTier === "dolce-vita") {
    reasonParts.push("Du bad om La Dolce Vita, så premiumglas, bokningsvärda stopp och en större kväll väger tyngre.");
  }

  if (pulseNote) {
    reasonParts.push("Dagens puls i Rom lutar också tydligt åt just den här riktningen.");
  }

  if (liveEventNote) {
    reasonParts.push("Det finns dessutom ett live-lager som passar extra bra med den här rutten i dag.");
  }

  if (areaNote) {
    reasonParts.push(areaNote);
  }

  if (weather?.condition === "rain") {
    reasonParts.push("Dagens väder gör att den här mixen av inne- och kvartersstopp passar extra bra.");
  } else if (weather?.condition === "sun") {
    reasonParts.push("Dagens väder gynnar utsikter, kvällspromenad och längre utepartier.");
  }

  return reasonParts.join(" ");
}

async function generateRecommendations({
  dates,
  start,
  end,
  walkingKmTarget,
  preferences,
  optimizerMode,
  budgetTier = "standard",
  modifier = null,
  distanceMode = "soft_target",
}) {
  const normalizedDates = expandDateRange(dates);
  const resolvedStart = await resolvePoint(start, "Trastevere");
  const resolvedEnd = await resolvePoint(end, "Trastevere");
  const pulseByDate = Object.fromEntries(
    normalizedDates.map((date) => [date, getCityPulse(date)]),
  );
  const [weatherByDate, liveEventsByDate] = await Promise.all([
    fetchWeatherForDates(normalizedDates, ROME_CENTER).catch(() => ({})),
    fetchLiveEventsForDates(normalizedDates, {
      preferences,
      optimizerMode,
      budgetTier,
      modifier,
    }).catch(() => ({})),
  ]);
  const usedTemplateIds = new Set();

  const days = normalizedDates.map((date) => {
    const weekday = weekdayFromDate(date);
    const weather = weatherByDate[date];
    const pulse = pulseByDate[date] || getCityPulse(date);
    const dateSignals = getDateSignals(date);
    const pulseItems = Array.isArray(pulse.items) ? pulse.items : [];
    const liveEvents = liveEventsByDate[date] || [];

    const ranked = routeTemplates
      .map((template) => {
        const route = buildRouteFromTemplate(
          template,
          resolvedStart,
          resolvedEnd,
          walkingKmTarget,
        );
        const openingWarnings = buildOpeningWarnings(
          route.main_stops.map((stop) => findItemByName(stop.id)).filter(Boolean),
          weekday,
        );
        const routeStops = route.main_stops
          .map((stop) => findItemByName(stop.id))
          .filter(Boolean);
        const venueSpecials = buildVenueSpecials(routeStops, weekday);
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
          routeStops,
        });

        return {
          template,
          route: {
            ...route,
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
              weather,
              optimizerMode,
              distanceMode,
              budgetTier,
              modifier,
              scoring.pulseNote,
              scoring.liveEventNote,
              scoring.areaNote,
            ),
          },
          score: scoring.score,
        };
      })
      .sort((a, b) => b.score - a.score);

    const primary = ranked[0];
    const alternatives = ranked.slice(1, 3);
    const annotatedLiveEvents = annotateLiveEventsForRoutes(liveEvents, [
      {
        label: "Huvudrutten",
        route: primary.route,
      },
      ...alternatives.map((entry, index) => ({
        label: `Alternativ ${index + 1}`,
        route: entry.route,
      })),
    ]);
    usedTemplateIds.add(primary.template.id);

    return {
      date,
      date_signals: dateSignals,
      live_events: annotatedLiveEvents,
      primary_route: primary.route,
      alternatives: alternatives.map((entry) => entry.route),
    };
  });

  return {
    days,
    resolved_start: resolvedStart,
    resolved_end: resolvedEnd,
  };
}

module.exports = {
  generateRecommendations,
  resolvePoint,
  expandDateRange,
  budgetScore,
  kmScore,
  normalizeBudgetTier,
  normalizeModifier,
  areaScore,
  preferenceScore,
  priceLevelWeight,
  profileScore,
  routeScore,
};
