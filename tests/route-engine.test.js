const test = require("node:test");
const assert = require("node:assert/strict");

const {
  annotateLiveEventsForRoutes,
  buildRouteFromTemplate,
  buildRouteIdentity,
  buildLiveEventStopCandidates,
  budgetScore,
  generateRecommendations,
  getRouteLineage,
  kmScore,
  normalizeBudgetTier,
  normalizeModifier,
  preferenceScore,
  priceLevelWeight,
  profileScore,
  routeScore,
  routeSimilarity,
} = require("../server/route-engine");
const { getCityConfig } = require("../server/cities");
const { createEmptyLocalTruthEffect, evaluateLocalTruth } = require("../server/local-truth");
const { diversifyRecommendationDays } = require("../server/route-diversity");
const { findItemByName, routeTemplates } = require("../server/catalog");
const { resetLiveEventsCache } = require("../server/live-events");
const { resetBarcelonaLiveEventsCache } = require("../server/cities/barcelona/live");

const originalFetch = global.fetch;

function weatherResponse(payload) {
  return {
    ok: true,
    async json() {
      return payload;
    },
  };
}

function createWeatherFetch(codesByDate = {}) {
  return async (url) => {
    const parsed = new URL(String(url));

    if (parsed.hostname !== "api.open-meteo.com") {
      throw new Error(`Unexpected fetch in route-engine test: ${parsed.hostname}`);
    }

    const start = new Date(`${parsed.searchParams.get("start_date")}T12:00:00`);
    const end = new Date(`${parsed.searchParams.get("end_date")}T12:00:00`);
    const time = [];
    const weathercode = [];
    const temperature_2m_max = [];

    for (let cursor = new Date(start); cursor <= end; cursor.setDate(cursor.getDate() + 1)) {
      const isoDate = cursor.toISOString().slice(0, 10);
      time.push(isoDate);
      weathercode.push(codesByDate[isoDate] ?? 0);
      temperature_2m_max.push(24);
    }

    return weatherResponse({
      daily: {
        time,
        weathercode,
        temperature_2m_max,
      },
    });
  };
}

function sampleRoute(template) {
  return {
    estimated_km: template.defaultKm,
    map_route_points: [
      { lat: 41.8885, lng: 12.4678 },
      { lat: 41.8946, lng: 12.4951 },
    ],
    main_stops: [
      {
        id: template.stops[1] || template.stops[0],
        label: "Sample stop",
        lat: 41.8946,
        lng: 12.4951,
      },
    ],
  };
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

function nearestDistanceToRouteKm(route, item) {
  return route.map_route_points.reduce((closest, point) => {
    return Math.min(closest, haversineKm(point, item));
  }, Number.POSITIVE_INFINITY);
}

const secondHandFamilyTags = new Set([
  "second_hand",
  "vintage",
  "shopping",
  "market",
  "event_market",
  "antique",
  "antiques",
]);

function isSecondHandFamilyStop(stop) {
  return (stop?.tags || []).some((tag) => secondHandFamilyTags.has(tag));
}

function secondHandFamilyStopCount(route) {
  return (route?.main_stops || []).filter((stop) => isSecondHandFamilyStop(stop)).length;
}

test.after(() => {
  global.fetch = originalFetch;
});

test.afterEach(() => {
  resetLiveEventsCache();
});

test("km-soft-target belönar rutter nära målet tydligare än långa avvikelser", () => {
  assert.ok(kmScore(9.5, 9) > kmScore(14, 9));
  assert.ok(kmScore(11, 9) > kmScore(14, 9));
});

test("budget mode värderar billigare stopp högre än dyrare", () => {
  const budgetFriendly = budgetScore(
    [{ priceLevel: "$" }, { priceLevel: "gratis" }, { priceLevel: "$" }],
    ["mat", "öl", "budget"],
    "budget-mode",
  );
  const expensive = budgetScore(
    [{ priceLevel: "$$$" }, { priceLevel: "$$" }, { priceLevel: "$$$" }],
    ["mat", "öl", "budget"],
    "budget-mode",
  );

  assert.ok(budgetFriendly.score > expensive.score);
  assert.ok(priceLevelWeight("gratis") < priceLevelWeight("$$$"));
});

test("la dolce vita värderar premiumstopp högre än billiga upplägg", () => {
  const premium = budgetScore(
    [{ priceLevel: "$$$", bookingRequired: true }, { priceLevel: "$$$" }, { priceLevel: "$$" }],
    ["vin", "cocktail"],
    null,
    "dolce-vita",
  );
  const cheap = budgetScore(
    [{ priceLevel: "$" }, { priceLevel: "gratis" }, { priceLevel: "$" }],
    ["vin", "cocktail"],
    null,
    "dolce-vita",
  );

  assert.ok(premium.score > cheap.score);
});

test('distance mode "spelar ingen roll" tar bort hård km-press', () => {
  assert.ok(kmScore(14, 9, "no_limit") > kmScore(14, 9, "soft_target"));
});

test("preferensmatchning gynnar mallar som faktiskt bär öl och hidden gems", () => {
  const southLoop = routeTemplates.find((template) => template.id === "south-loop");
  const classicLoop = routeTemplates.find((template) => template.id === "classic-loop");

  assert.ok(
    preferenceScore(southLoop, ["öl", "hidden gems"]) >
      preferenceScore(classicLoop, ["öl", "hidden gems"]),
  );
});

test("veckodagslogik ger högre score när mallens weekday boost träffar rätt dag", () => {
  const southLoop = routeTemplates.find((template) => template.id === "south-loop");
  const route = sampleRoute(southLoop);
  const fridayScore = routeScore({
    route,
    template: southLoop,
    weather: null,
    weekday: 5,
    targetKm: southLoop.defaultKm,
    preferences: ["mat", "vin"],
    reusedIds: new Set(),
  });
  const mondayScore = routeScore({
    route,
    template: southLoop,
    weather: null,
    weekday: 1,
    targetKm: southLoop.defaultKm,
    preferences: ["mat", "vin"],
    reusedIds: new Set(),
  });

  assert.ok(fridayScore.score > mondayScore.score);
});

test("partyprofilen gynnar tydliga kvällsrutter framför low-key-upplägg", () => {
  const partyRoute = routeTemplates.find((template) => template.id === "pigneto-after-dark");
  const lowKeyRoute = routeTemplates.find((template) => template.id === "prati-centro-low-key");

  assert.ok(
    profileScore(partyRoute, ["party", "kväll", "nattliv"], "party-mode").score >
      profileScore(lowKeyRoute, ["party", "kväll", "nattliv"], "party-mode").score,
  );
});

test("low-key-profilen gynnar lugnare rutter framför partyspår", () => {
  const partyRoute = routeTemplates.find((template) => template.id === "pigneto-after-dark");
  const lowKeyRoute = routeTemplates.find((template) => template.id === "prati-centro-low-key");

  assert.ok(
    profileScore(lowKeyRoute, ["low-key", "vin", "hidden gems"], "low-key-mode").score >
      profileScore(partyRoute, ["low-key", "vin", "hidden gems"], "low-key-mode").score,
  );
});

test("modifier och budget tier normaliseras från nya UI-värden", () => {
  assert.equal(normalizeBudgetTier([], null, "budget"), "budget");
  assert.equal(normalizeBudgetTier([], null, "dolce-vita"), "dolce-vita");
  assert.equal(normalizeModifier("party", null), "party");
  assert.equal(normalizeModifier(null, "culture-mode"), "culture");
});

test("routeScore konsumerar local truth score_delta generiskt utan city-specialfall", () => {
  const template = routeTemplates.find((entry) => entry.id === "south-loop");
  const route = sampleRoute(template);
  const routeStops = template.stops.map((id) => findItemByName(id)).filter(Boolean);

  const baseScore = routeScore({
    route,
    template,
    weather: null,
    weekday: 1,
    targetKm: template.defaultKm,
    preferences: ["mat", "vin", "kultur", "hidden gems"],
    reusedIds: new Set(),
    routeStops,
    localTruth: createEmptyLocalTruthEffect(),
  });
  const adjustedScore = routeScore({
    route,
    template,
    weather: null,
    weekday: 1,
    targetKm: template.defaultKm,
    preferences: ["mat", "vin", "kultur", "hidden gems"],
    reusedIds: new Set(),
    routeStops,
    localTruth: {
      ...createEmptyLocalTruthEffect(),
      score_adjustments: [
        {
          id: "synthetic-local-truth-penalty",
          rule_id: "synthetic-local-truth",
          reason: "Synthetic local truth penalty",
          delta: -2,
        },
      ],
      score_delta: -2,
    },
  });

  assert.ok(adjustedScore.score < baseScore.score);
});

test("Rome local truth laddas från aktiv city config och markerar skörare måndagskultur", () => {
  const rome = getCityConfig("rome");
  const template = routeTemplates.find((entry) => entry.id === "south-loop");
  const routeStops = template.stops.map((id) => findItemByName(id)).filter(Boolean);
  const route = sampleRoute(template);

  const effect = evaluateLocalTruth(rome, {
    date: "2026-04-20",
    route,
    routeStops,
    template,
    preferences: ["mat", "vin", "kultur", "hidden gems"],
    liveEvents: [],
  });

  assert.ok(effect.verify_opening_hours.length >= 1);
  assert.ok(effect.caution_notes.length >= 1);
  assert.ok(effect.score_delta < 0);
});

test("test-city local truth förblir neutral utan Rome-hardcoding i generisk logik", () => {
  const testCity = getCityConfig("test-city");
  const template = testCity.catalog.routeTemplates[0];
  const routeStops = template.stops.map((id) => testCity.catalog.allItems.find((item) => item.id === id)).filter(Boolean);
  const route = sampleRoute(template);

  const effect = evaluateLocalTruth(testCity, {
    date: "2026-05-01",
    route,
    routeStops,
    template,
    preferences: ["kultur", "mat"],
    liveEvents: [],
  });

  assert.deepEqual(effect, createEmptyLocalTruthEffect());
});

test("Rome-packet har riktig second hand-coverage medan test-city förblir neutral", () => {
  const rome = getCityConfig("rome");
  const testCity = getCityConfig("test-city");
  const romeSecondHandItems = rome.catalog.allItems.filter(
    (item) => item.tags.includes("second_hand") || item.tags.includes("vintage"),
  );
  const romeSecondHandIds = new Set(romeSecondHandItems.map((item) => item.id));
  const italianTerms = new Set(["seconda mano", "usato", "mercatino", "mercato dell'usato", "antiquariato"]);

  assert.ok(romeSecondHandItems.length >= 6);
  ["pifebo-vintage-shop", "humana-vintage-monti", "ciao-vintage", "porta-portese-market"].forEach((id) => {
    assert.ok(romeSecondHandIds.has(id));
  });
  assert.ok(
    romeSecondHandItems.some(
      (item) => item.availability?.kind === "event_market" && item.availability.strongWeekdays?.includes(0),
    ),
  );
  assert.ok(
    romeSecondHandItems.some(
      (item) => item.availability?.kind === "shop" && item.availability.daySensitivity === "low",
    ),
  );

  assert.equal(
    testCity.catalog.allItems.some(
      (item) =>
        item.tags.includes("second_hand") ||
        item.tags.includes("vintage") ||
        item.tags.includes("market") ||
        item.searchTerms.some((term) => italianTerms.has(term.toLowerCase())),
    ),
    false,
  );
});

test("Rome Sunday-marknader använder samma weekday-index som resten av katalogen", () => {
  const rome = getCityConfig("rome");
  const portaPortese = rome.catalog.allItems.find((item) => item.id === "porta-portese-market");
  const borghetto = rome.catalog.allItems.find((item) => item.id === "borghetto-flaminio-market");

  assert.deepEqual(portaPortese.closedWeekdays, [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(borghetto.closedWeekdays, [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(portaPortese.availability.strongWeekdays, [0]);
  assert.deepEqual(borghetto.availability.strongWeekdays, [0]);
  assert.deepEqual(portaPortese.availability.weakWeekdays, [1, 2, 3, 4, 5, 6]);
  assert.equal(portaPortese.availability.kind, "event_market");
  assert.equal(borghetto.availability.kind, "event_market");
  assert.equal(portaPortese.closedWeekdays.includes(0), false);
  assert.equal(borghetto.closedWeekdays.includes(0), false);
});

test("single second_hand-intent ger en second hand-buren primary route utan irrelevanta mentions", async () => {
  global.fetch = createWeatherFetch({
    "2026-05-08": 0,
  });

  const result = await generateRecommendations({
    dates: ["2026-05-08"],
    start: { type: "preset", label: "Monti" },
    end: { type: "preset", label: "Monti" },
    walkingKmTarget: 6,
    preferences: ["second_hand"],
  });

  const primary = result.days[0].primary_route;

  assert.ok(result.days.length >= 1);
  assert.match(primary.title, /second hand|marknad och vintage/i);
  assert.ok(secondHandFamilyStopCount(primary) >= 2);
  assert.ok(isSecondHandFamilyStop(primary.main_stops[0]));
  assert.deepEqual(primary.bar_mentions, []);
  assert.deepEqual(primary.hidden_mentions, []);
  assert.match(primary.why_recommended, /Second hand-spåret/i);
});

test("single second_hand på stark marknadsdag kan ge market-led primary route", async () => {
  global.fetch = createWeatherFetch({
    "2026-05-10": 0,
  });

  const result = await generateRecommendations({
    dates: ["2026-05-10"],
    start: { type: "preset", label: "Trastevere" },
    end: { type: "preset", label: "Trastevere" },
    walkingKmTarget: 7,
    preferences: ["second_hand"],
  });

  const primary = result.days[0].primary_route;

  assert.match(primary.title, /marknad och vintage/i);
  assert.ok(primary.main_stops[0].tags.includes("market"));
  assert.ok(
    primary.local_truth.score_delta > 0 ||
      primary.local_truth.route_context_notes.some((entry) => /stark veckodag/i.test(entry.text)),
  );
  assert.ok(
    primary.local_truth.verify_opening_hours.every(
      (entry) => !/är stängt|kommer vara stängt/i.test(entry.reason),
    ),
  );
  assert.deepEqual(primary.bar_mentions, []);
  assert.deepEqual(primary.hidden_mentions, []);
});

test("single second_hand på svag marknadsdag låter butiksvintage bära primary route före market", async () => {
  global.fetch = createWeatherFetch({
    "2026-05-13": 0,
  });

  const result = await generateRecommendations({
    dates: ["2026-05-13"],
    start: { type: "preset", label: "Trastevere" },
    end: { type: "preset", label: "Trastevere" },
    walkingKmTarget: 7,
    preferences: ["second_hand"],
  });

  const primary = result.days[0].primary_route;
  const marketStopIndex = primary.main_stops.findIndex((stop) => stop.tags.includes("market"));

  assert.match(primary.title, /second hand och vintage/i);
  assert.ok(secondHandFamilyStopCount(primary) >= 2);
  assert.ok(primary.main_stops[0].tags.includes("vintage"));
  assert.ok(!primary.main_stops[0].tags.includes("market"));
  assert.ok(marketStopIndex >= 1);
  assert.deepEqual(primary.bar_mentions, []);
  assert.deepEqual(primary.hidden_mentions, []);

  const marketWarnings = [
    ...primary.opening_hours_warnings,
    ...primary.local_truth.caution_notes.map((entry) => entry.text),
  ];

  assert.ok(marketWarnings.some((entry) => /marknadsdelen|dubbelkolla|veckodag/i.test(entry)));
});

test("second_hand kan blandas med vin utan att förlora second hand-identiteten", async () => {
  global.fetch = createWeatherFetch({
    "2026-05-13": 0,
  });

  const result = await generateRecommendations({
    dates: ["2026-05-13"],
    start: { type: "preset", label: "Monti" },
    end: { type: "preset", label: "Monti" },
    walkingKmTarget: 6,
    preferences: ["second_hand", "vin"],
  });

  const primary = result.days[0].primary_route;

  assert.match(primary.title, /second hand \+ vin/i);
  assert.ok(secondHandFamilyStopCount(primary) >= 2);
  assert.ok(primary.main_stops.some((stop) => stop.tags.includes("shopping")));
  assert.match(primary.why_recommended, /Second hand-spåret/i);
});

test("auto-läget bygger en riktig auto-loop för kyrkor utan dold preset-injektion", async () => {
  global.fetch = createWeatherFetch({
    "2026-04-18": 0,
  });

  const result = await generateRecommendations({
    dates: ["2026-04-18"],
    start: { type: "auto" },
    end: { type: "auto" },
    walkingKmTarget: 6,
    preferences: ["kyrkor"],
    optimizerMode: "church-crawl",
  });

  assert.equal(result.resolved_start.source, "auto");
  assert.equal(result.resolved_end.source, "auto");
  assert.ok(result.resolved_start.label);
  assert.ok(result.resolved_end.label);
  assert.ok(result.days[0].primary_route.main_stops.every((stop) => stop.tags.includes("kyrkor")));
});

test("auto-läget kan bära en mjuk boendebas utan att låsa exakt start", async () => {
  global.fetch = createWeatherFetch({
    "2026-04-18": 0,
  });

  const result = await generateRecommendations({
    dates: ["2026-04-18"],
    homeBase: { type: "preset", label: "Monti" },
    start: { type: "auto" },
    end: { type: "auto" },
    walkingKmTarget: 7,
    preferences: ["vin", "mat", "kultur", "hidden gems"],
  });

  assert.equal(result.resolved_home_base.label, "Monti");
  assert.ok(
    [result.resolved_start.label, result.resolved_end.label, result.days[0].primary_route.anchor_zone]
      .filter(Boolean)
      .some((value) => /Monti|Esquilino|Centro/i.test(value)),
  );
});

test("auto-läget kan nu välja en riktig båge för öppna kvällar med no-limit", async () => {
  global.fetch = createWeatherFetch({
    "2026-04-19": 0,
  });

  const result = await generateRecommendations({
    dates: ["2026-04-19"],
    start: { type: "auto" },
    end: { type: "auto" },
    walkingKmTarget: 14,
    preferences: ["öl", "vin", "hidden gems", "nattliv", "kväll", "party"],
    optimizerMode: "bar-hop",
    modifier: "party",
    distanceMode: "no_limit",
  });

  assert.equal(result.days[0].primary_route.route_shape, "arc");
  assert.notEqual(result.resolved_start.label, result.resolved_end.label);
});

test("bar-hop mellan Trastevere och Monti ger nu flera stopp utanför Trastevere", async () => {
  global.fetch = createWeatherFetch({
    "2026-04-18": 0,
  });

  const result = await generateRecommendations({
    dates: ["2026-04-18"],
    start: { type: "preset", label: "Trastevere" },
    end: { type: "preset", label: "Monti" },
    walkingKmTarget: 8,
    preferences: ["öl", "vin", "hidden gems", "nattliv", "kväll"],
    optimizerMode: "bar-hop",
  });

  const nonTrastevereStops = result.days[0].primary_route.main_stops.filter(
    (stop) => stop.area !== "Trastevere",
  );

  assert.ok(nonTrastevereStops.length >= 2);
});

test("Trastevere -> Monti kan nu formas av katalogstopp utanför template-listan", async () => {
  global.fetch = createWeatherFetch({
    "2026-04-18": 0,
  });

  const result = await generateRecommendations({
    dates: ["2026-04-18"],
    start: { type: "preset", label: "Trastevere" },
    end: { type: "preset", label: "Monti" },
    walkingKmTarget: 8,
    preferences: ["öl", "vin", "hidden gems", "nattliv", "kväll"],
    optimizerMode: "bar-hop",
  });

  const route = result.days[0].primary_route;
  const template = routeTemplates.find((entry) => entry.id === route.id);
  const nonTemplateStops = route.main_stops.filter((stop) => !template.stops.includes(stop.id));
  const lineage = getRouteLineage(route);

  assert.ok(nonTemplateStops.length >= 2);
  assert.ok(lineage, "route lineage should be available internally");
  assert.equal(lineage.source_template_id, route.id);
  assert.ok(lineage.realized_route_id.startsWith(`${route.id}--realized--`));
  assert.equal(lineage.template_match_status, "realized_variant");
  assert.equal(route.source_template_id, undefined);
  assert.equal(Object.keys(route).includes("source_template_id"), false);
  assert.equal(JSON.stringify(route).includes("source_template_id"), false);
  assert.deepEqual(
    lineage.extra_realized_stops,
    route.main_stops
      .map((stop) => stop.id)
      .filter((stopId) => !lineage.template_stop_ids.includes(stopId)),
  );
});

test("route identity marks exact template realizations", () => {
  const template = routeTemplates.find((entry) => entry.id === "centro-church-salon");
  const realizedStops = template.stops
    .map((stopId) => findItemByName(stopId))
    .filter((item) => item && item.kind !== "district" && item.kind !== "district-group");

  const identity = buildRouteIdentity(template, realizedStops);

  assert.equal(identity.source_template_id, "centro-church-salon");
  assert.equal(identity.realized_route_id, "centro-church-salon");
  assert.equal(identity.realization_kind, "template_exact");
  assert.equal(identity.template_match_status, "exact");
  assert.deepEqual(identity.template_stop_ids, [
    "santa-maria-del-popolo",
    "san-luigi-dei-francesi",
    "santa-maria-sopra-minerva",
    "roscioli-salumeria",
  ]);
  assert.deepEqual(identity.realized_stop_ids, identity.template_stop_ids);
  assert.deepEqual(identity.missing_template_stops, []);
  assert.deepEqual(identity.extra_realized_stops, []);
});

test("route identity marks reordered template realizations", () => {
  const template = routeTemplates.find((entry) => entry.id === "centro-church-salon");
  const realizedStops = template.stops
    .map((stopId) => findItemByName(stopId))
    .filter((item) => item && item.kind !== "district" && item.kind !== "district-group")
    .reverse();

  const identity = buildRouteIdentity(template, realizedStops);

  assert.equal(identity.source_template_id, "centro-church-salon");
  assert.notEqual(identity.realized_route_id, "centro-church-salon");
  assert.equal(identity.realization_kind, "template_reordered");
  assert.equal(identity.template_match_status, "reordered");
  assert.deepEqual(identity.missing_template_stops, []);
  assert.deepEqual(identity.extra_realized_stops, []);
});

test("route identity marks dropped template stops as realized variants", () => {
  const template = routeTemplates.find((entry) => entry.id === "centro-church-salon");
  const realizedStops = template.stops
    .map((stopId) => findItemByName(stopId))
    .filter((item) => item && item.kind !== "district" && item.kind !== "district-group")
    .slice(0, 3);

  const identity = buildRouteIdentity(template, realizedStops);

  assert.equal(identity.source_template_id, "centro-church-salon");
  assert.ok(identity.realized_route_id.startsWith("centro-church-salon--realized--"));
  assert.equal(identity.realization_kind, "template_realized_variant");
  assert.equal(identity.template_match_status, "realized_variant");
  assert.deepEqual(identity.missing_template_stops, ["roscioli-salumeria"]);
  assert.deepEqual(identity.extra_realized_stops, []);
});

test("route identity marks added realized stops as realized variants", () => {
  const template = routeTemplates.find((entry) => entry.id === "centro-church-salon");
  const realizedStops = [
    ...template.stops
      .map((stopId) => findItemByName(stopId))
      .filter((item) => item && item.kind !== "district" && item.kind !== "district-group"),
    findItemByName("colosseum"),
  ];

  const identity = buildRouteIdentity(template, realizedStops);

  assert.equal(identity.source_template_id, "centro-church-salon");
  assert.ok(identity.realized_route_id.endsWith("--colosseum"));
  assert.equal(identity.realization_kind, "template_realized_variant");
  assert.equal(identity.template_match_status, "realized_variant");
  assert.deepEqual(identity.missing_template_stops, []);
  assert.deepEqual(identity.extra_realized_stops, ["colosseum"]);
});

test("live-event-kandidater premierar stopp som faktiskt ligger i korridoren", () => {
  const candidates = buildLiveEventStopCandidates(
    [
      {
        id: "corridor",
        title: "Corridor Jazz Set",
        venue: "Piazza Navona",
        address: "Piazza Navona",
        geocode_label: "Piazza Navona, Rome, Italy",
        lat: 41.8992,
        lng: 12.4731,
        match_tags: ["vin", "kultur", "nattliv"],
        summary: "On-corridor evening event.",
      },
      {
        id: "detour",
        title: "Deep South Party",
        venue: "Garbatella",
        address: "Garbatella",
        geocode_label: "Garbatella, Rome, Italy",
        lat: 41.8613,
        lng: 12.4819,
        match_tags: ["vin", "kultur", "nattliv"],
        summary: "Same tags but off the current arc.",
      },
    ],
    ["vin", "kultur", "nattliv"],
    "bar-hop",
    "evening",
    {
      shape: "arc",
      start: { label: "Trastevere", lat: 41.8885, lng: 12.4678 },
      end: { label: "Monti", lat: 41.8946, lng: 12.4951 },
      // The candidate-builder gates on includeLiveEvents now (default is the
      // separate Pulse/sidecar layer). The corridor-scoring behaviour this
      // test pins is still valid behind the opt-in.
      includeLiveEvents: true,
    },
  );

  assert.equal(candidates[0].name, "Corridor Jazz Set");
  assert.ok(candidates[0].anchorWeight > candidates[1].anchorWeight);
});

test("live-events utan platskoppling får inte låtsas passa en specifik rutt", () => {
  const annotated = annotateLiveEventsForRoutes(
    [
      {
        id: "ungrounded",
        title: "Mystery Event",
        venue: "Rome",
        match_tags: ["kultur", "vin"],
      },
    ],
    [
      {
        label: "Huvudrutten",
        route: {
          id: "sample-route",
          title: "Sample route",
          main_stops: [
            {
              tags: ["kultur", "vin"],
            },
          ],
          map_route_points: [
            { lat: 41.89, lng: 12.48 },
            { lat: 41.9, lng: 12.49 },
          ],
        },
      },
    ],
  );

  assert.equal(annotated[0].best_route_id, null);
  assert.equal(annotated[0].best_route_label, null);
  assert.equal(annotated[0].route_fit_note, null);
});

test("Prati -> Monti väljer nu en väst-till-centro-rutt utan Trastevere-bias", async () => {
  global.fetch = createWeatherFetch({
    "2026-04-18": 0,
  });

  const result = await generateRecommendations({
    dates: ["2026-04-18"],
    start: { type: "preset", label: "Prati" },
    end: { type: "preset", label: "Monti" },
    walkingKmTarget: 7,
    preferences: ["vin", "kultur", "hidden gems", "low-key"],
    optimizerMode: "wine-crawl",
    modifier: "low_key",
  });

  const route = result.days[0].primary_route;

  assert.ok(route.main_stops.some((stop) => stop.area === "Prati" || stop.area === "Borgo"));
  assert.ok(route.main_stops.some((stop) => stop.area === "Monti" || stop.area === "Centro"));
  assert.ok(!route.main_stops.some((stop) => stop.area === "Trastevere"));
  assert.ok(route.area_note);
});

test("Garbatella -> Testaccio håller sig nu i södra Rom när tempot är low-key", async () => {
  global.fetch = createWeatherFetch({
    "2026-04-19": 0,
  });

  const result = await generateRecommendations({
    dates: ["2026-04-19"],
    start: { type: "preset", label: "Garbatella" },
    end: { type: "preset", label: "Testaccio" },
    walkingKmTarget: 6,
    preferences: ["öl", "vin", "mat", "hidden gems", "low-key"],
    optimizerMode: "bar-hop",
    modifier: "low_key",
  });

  const route = result.days[0].primary_route;

  assert.ok(route.main_stops.some((stop) => stop.area === "Garbatella"));
  assert.ok(route.main_stops.some((stop) => stop.area === "Testaccio" || stop.area === "Ostiense"));
  assert.ok(!route.main_stops.some((stop) => stop.area === "Trastevere"));
  assert.match(route.area_note || "", /(södra Rom|Garbatella)/i);
});

test("Trastevere -> San Lorenzo ger nu en riktig väst-till-öst-båge", async () => {
  global.fetch = createWeatherFetch({
    "2026-04-19": 0,
  });

  const result = await generateRecommendations({
    dates: ["2026-04-19"],
    start: { type: "preset", label: "Trastevere" },
    end: { type: "preset", label: "San Lorenzo" },
    walkingKmTarget: 9,
    preferences: ["öl", "vin", "hidden gems", "nattliv", "kväll"],
    optimizerMode: "bar-hop",
  });

  const route = result.days[0].primary_route;

  assert.equal(route.route_shape, "arc");
  assert.equal(result.resolved_start.label, "Trastevere");
  assert.equal(result.resolved_end.label, "San Lorenzo");
  assert.equal(route.main_stops[0].area, "Trastevere");
  assert.ok(route.main_stops.some((stop) => stop.area === "San Lorenzo"));
  assert.match(route.geo_fit_note || "", /(San Lorenzo|Trastevere)/i);
});

test("alternativrutterna hålls tydligare isär än tidigare", async () => {
  global.fetch = createWeatherFetch({
    "2026-04-19": 0,
  });

  const result = await generateRecommendations({
    dates: ["2026-04-19"],
    start: { type: "preset", label: "Garbatella" },
    end: { type: "preset", label: "Testaccio" },
    walkingKmTarget: 6,
    preferences: ["öl", "vin", "mat", "hidden gems", "low-key"],
    optimizerMode: "bar-hop",
    modifier: "low_key",
  });

  result.days[0].alternatives.forEach((route) => {
    assert.ok(routeSimilarity(result.days[0].primary_route, route) < 8.4);
  });
});

test("leg pacing short ger tätare ben än flexible på samma låsta båge", () => {
  const template = routeTemplates.find((entry) => entry.id === "monti-night-spine");
  const start = { label: "Trastevere", lat: 41.8885, lng: 12.4678 };
  const end = { label: "San Lorenzo", lat: 41.8992, lng: 12.5211 };

  assert.ok(template);

  const shortRoute = buildRouteFromTemplate(
    template,
    start,
    end,
    9,
    ["öl", "vin", "hidden gems", "nattliv", "kväll"],
    "bar-hop",
    null,
    "soft_target",
    [],
    { legPacing: "short", manualAnchorsLocked: true },
  );

  const flexibleRoute = buildRouteFromTemplate(
    template,
    start,
    end,
    9,
    ["öl", "vin", "hidden gems", "nattliv", "kväll"],
    "bar-hop",
    null,
    "soft_target",
    [],
    { legPacing: "flexible", manualAnchorsLocked: true },
  );

  assert.ok(shortRoute.legs.length >= 1);
  assert.ok(shortRoute.legs.every((leg) => Number.isFinite(leg.estimated_walk_minutes)));
  assert.ok(shortRoute.longest_leg_km <= flexibleRoute.longest_leg_km);
});

test("day profile light bygger en lättare dag än peak med samma template", () => {
  const template = routeTemplates.find((entry) => entry.id === "south-loop");
  const start = { label: "Trastevere", lat: 41.8885, lng: 12.4678 };
  const end = { label: "Trastevere", lat: 41.8885, lng: 12.4678 };

  assert.ok(template);

  const lightRoute = buildRouteFromTemplate(
    template,
    start,
    end,
    9,
    ["öl", "vin", "mat", "hidden gems"],
    "bar-hop",
    null,
    "soft_target",
    [],
    { dayProfile: "light" },
  );

  const peakRoute = buildRouteFromTemplate(
    template,
    start,
    end,
    9,
    ["öl", "vin", "mat", "hidden gems"],
    "bar-hop",
    null,
    "soft_target",
    [],
    { dayProfile: "peak" },
  );

  assert.equal(lightRoute.day_profile, "light");
  assert.equal(peakRoute.day_profile, "peak");
  assert.ok(lightRoute.main_stops.length < peakRoute.main_stops.length);
});

test("no-limit använder en dold stoppbudget så flexibelt avstånd inte blir obegränsat", () => {
  const template = routeTemplates.find((entry) => entry.id === "south-loop");
  const start = { label: "Trastevere", lat: 41.8885, lng: 12.4678 };
  const end = { label: "Trastevere", lat: 41.8885, lng: 12.4678 };

  assert.ok(template);

  const peakRoute = buildRouteFromTemplate(
    template,
    start,
    end,
    14,
    ["öl", "vin", "mat", "hidden gems", "nattliv", "kväll"],
    "bar-hop",
    "party",
    "no_limit",
    [],
    { dayProfile: "peak" },
  );

  const finalRoute = buildRouteFromTemplate(
    template,
    start,
    end,
    14,
    ["öl", "vin", "mat", "hidden gems", "nattliv", "kväll"],
    "bar-hop",
    "party",
    "no_limit",
    [],
    { dayProfile: "final" },
  );

  assert.ok(peakRoute.main_stops.length <= 6);
  assert.ok(finalRoute.main_stops.length <= 4);
  assert.ok(finalRoute.main_stops.length < peakRoute.main_stops.length);
});

test("finaldagar behåller fyra stopp när användaren inte valt en kort dag", async () => {
  global.fetch = createWeatherFetch({
    "2026-05-14": 0,
    "2026-05-15": 0,
  });

  const template = routeTemplates.find((entry) => entry.id === "south-loop");
  const start = { label: "Trastevere", lat: 41.8885, lng: 12.4678 };
  const end = { label: "Ostiense/Garbatella", lat: 41.8659, lng: 12.4857 };

  assert.ok(template);

  const constructedFinal = buildRouteFromTemplate(
    template,
    start,
    end,
    9,
    ["vin", "mat", "nattliv"],
    "bar-hop",
    "evening",
    "soft_target",
    [],
    { dayProfile: "final" },
  );

  assert.equal(constructedFinal.main_stops.length, 4);
  assert.equal(constructedFinal.day_profile, "final");

  const result = await generateRecommendations({
    dates: ["2026-05-14", "2026-05-15"],
    start: { type: "auto" },
    end: { type: "auto" },
    walkingKmTarget: 9,
    preferences: ["vin", "mat", "nattliv"],
    optimizerMode: "bar-hop",
    modifier: "evening",
    distanceMode: "soft_target",
  });

  const finalDay = result.days.at(-1);

  assert.equal(finalDay.primary_route.day_profile, "final");
  assert.equal(finalDay.primary_route.main_stops.length, 4);
});

test("alternativrutterna får ofta annan day profile än huvudrutten", async () => {
  global.fetch = createWeatherFetch({
    "2026-04-19": 0,
  });

  const result = await generateRecommendations({
    dates: ["2026-04-19"],
    start: { type: "preset", label: "Trastevere" },
    end: { type: "preset", label: "Trastevere" },
    walkingKmTarget: 11,
    preferences: ["öl", "vin", "mat", "hidden gems", "nattliv", "kväll", "party"],
    optimizerMode: "bar-hop",
    modifier: "party",
    distanceMode: "no_limit",
  });

  const primary = result.days[0].primary_route;
  const alternatives = result.days[0].alternatives;

  assert.ok(alternatives.length > 0);
  assert.equal(primary.day_profile, "peak");
  assert.ok(alternatives.every((route) => route.day_profile));
  assert.ok(alternatives.some((route) => route.day_profile !== primary.day_profile));
});

test("mentions följer faktiska stopp nära den genererade rutten", async () => {
  global.fetch = createWeatherFetch({
    "2026-04-18": 0,
  });

  const result = await generateRecommendations({
    dates: ["2026-04-18"],
    start: { type: "preset", label: "Trastevere" },
    end: { type: "preset", label: "Monti" },
    walkingKmTarget: 8,
    preferences: ["öl", "vin", "hidden gems", "nattliv", "kväll"],
    optimizerMode: "bar-hop",
  });

  const route = result.days[0].primary_route;

  assert.ok(route.bar_mentions.length > 0);
  assert.ok(route.hidden_mentions.length > 0);

  [...route.bar_mentions, ...route.hidden_mentions].forEach((mention) => {
    const item = findItemByName(mention);
    assert.ok(item, `expected mention "${mention}" to resolve to a catalog item`);
    assert.ok(nearestDistanceToRouteKm(route, item) <= 0.7);
  });
});

test("fler datum ger dedupe så att samma huvuddag inte återkommer direkt", async () => {
  global.fetch = createWeatherFetch({
    "2026-04-20": 0,
    "2026-04-21": 61,
  });

  const result = await generateRecommendations({
    dates: ["2026-04-20", "2026-04-21"],
    start: { type: "preset", label: "Trastevere" },
    end: { type: "preset", label: "Trastevere" },
    walkingKmTarget: 9,
    preferences: ["öl", "vin", "mat", "kultur", "hidden gems", "nattliv"],
  });

  assert.equal(result.days.length, 2);
  assert.notEqual(result.days[0].primary_route.id, result.days[1].primary_route.id);
});

test("flera auto-dagar varierar huvudrutten över en vecka i stället för samma sydvästspår", async () => {
  global.fetch = createWeatherFetch({
    "2026-05-11": 0,
    "2026-05-12": 1,
    "2026-05-13": 61,
    "2026-05-14": 2,
    "2026-05-15": 0,
  });

  const raw = await generateRecommendations({
    dates: ["2026-05-11", "2026-05-12", "2026-05-13", "2026-05-14", "2026-05-15"],
    homeBase: { type: "auto" },
    start: { type: "auto" },
    end: { type: "auto" },
    walkingKmTarget: 9,
    preferences: ["öl", "vin", "mat", "kultur", "hidden gems", "nattliv"],
    legPacing: "balanced",
  });
  const result = diversifyRecommendationDays(raw);
  const primaryIds = result.days.map((day) => day.primary_route.id);
  const anchorZones = result.days.map((day) => day.primary_route.anchor_zone);
  const startLabels = result.days.map((day) => day.primary_route.start_label);

  assert.equal(result.days.length, 5);
  assert.ok(new Set(primaryIds).size >= 4);
  assert.ok(new Set(anchorZones).size >= 4);
  assert.ok(new Set(startLabels).size >= 3);

  result.days.slice(1).forEach((day, index) => {
    assert.notEqual(result.days[index].primary_route.id, day.primary_route.id);
    assert.ok(routeSimilarity(result.days[index].primary_route, day.primary_route) < 8);
  });
});

test("21 april ger datumssignal för Natale di Roma", async () => {
  global.fetch = createWeatherFetch({
    "2026-04-21": 0,
  });

  const result = await generateRecommendations({
    dates: ["2026-04-21"],
    start: { type: "preset", label: "Trastevere" },
    end: { type: "preset", label: "Trastevere" },
    walkingKmTarget: 9,
    preferences: ["vin", "mat", "kultur", "hidden gems", "nattliv"],
  });

  assert.equal(result.days[0].date_signals[0].title, "Natale di Roma");
});

test("officiella live-events vävs in per dag när källan svarar", async () => {
  global.fetch = async (url) => {
    const parsed = new URL(String(url));

    if (parsed.hostname === "api.open-meteo.com") {
      return weatherResponse({
        daily: {
          time: ["2026-04-16"],
          weathercode: [0],
          temperature_2m_max: [23],
        },
      });
    }

    if (parsed.hostname === "www.turismoroma.it") {
      return {
        ok: true,
        async text() {
          return `
            <div class="views-row views-row-1">
              <div class="news_info">
                <div class="news_titolo_container">
                  <div class="news_titolo">
                    <div class="field-content">
                      <a href="/en/events/village-earth-2026">Village for the Earth 2026</a>
                    </div>
                  </div>
                </div>
                <div class="news_date">
                  <div class="field-content">
                    <span class="date-display-start">from&nbsp;16-04-2026</span>
                    <span class="date-display-end">&nbsp;to&nbsp;19-04-2026</span>
                  </div>
                </div>
                <div class="news_tipo">
                  <div class="field-content"><a href="/en/tipo-evento/events">Events</a></div>
                </div>
                <div class="news_sedi">
                  <div class="field-content"><a href="/en/places/villa-borghese">Villa Borghese</a></div>
                </div>
                <div class="news_indirizzo">Viale delle Magnolie</div>
                <div class="news_text">
                  <div class="field-content"><p>Big open-air sustainability festival.</p></div>
                </div>
              </div>
            </div>
          `;
        },
      };
    }

    if (parsed.hostname === "nominatim.openstreetmap.org") {
      return {
        ok: true,
        async json() {
          return [
            {
              display_name: "Villa Borghese, Rome, Italy",
              lat: "41.9142",
              lon: "12.4923",
              type: "park",
            },
          ];
        },
      };
    }

    throw new Error(`Unexpected fetch in live events test: ${url}`);
  };

  const result = await generateRecommendations({
    dates: ["2026-04-16"],
    start: { type: "preset", label: "Trastevere" },
    end: { type: "preset", label: "Trastevere" },
    walkingKmTarget: 9,
    preferences: ["kultur", "hidden gems"],
    optimizerMode: "sunset-spots",
  });

  assert.equal(result.days[0].live_events.length, 1);
  assert.equal(result.days[0].live_events[0].title, "Village for the Earth 2026");
  assert.ok(result.days[0].live_events[0].best_route_label);
  assert.ok(result.days[0].live_events[0].route_fit_note);
  assert.ok(typeof result.days[0].live_events[0].lat === "number");
});

test("live-event kan bli ett faktiskt stopp i huvudrutten när det passar kvällen", async () => {
  global.fetch = async (url) => {
    const parsed = new URL(String(url));

    if (parsed.hostname === "api.open-meteo.com") {
      return weatherResponse({
        daily: {
          time: ["2026-04-16"],
          weathercode: [0],
          temperature_2m_max: [23],
        },
      });
    }

    if (parsed.hostname === "www.turismoroma.it") {
      return {
        ok: true,
        async text() {
          return `
            <div class="views-row views-row-1">
              <div class="news_info">
                <div class="news_titolo_container">
                  <div class="news_titolo">
                    <div class="field-content">
                      <a href="/en/events/teatro-india-night">Teatro India Night</a>
                    </div>
                  </div>
                </div>
                <div class="news_date">
                  <div class="field-content">
                    <span class="date-display-start">from&nbsp;16-04-2026</span>
                    <span class="date-display-end">&nbsp;to&nbsp;16-04-2026</span>
                  </div>
                </div>
                <div class="news_tipo">
                  <div class="field-content"><a href="/en/tipo-evento/events">Events</a></div>
                </div>
                <div class="news_sedi">
                  <div class="field-content"><a href="/en/places/teatro-india">Teatro di Roma - Teatro India</a></div>
                </div>
                <div class="news_indirizzo">Lungotevere Vittorio Gassman</div>
                <div class="news_text">
                  <div class="field-content"><p>Guided show visits for a cultural evening in Rome.</p></div>
                </div>
                <a class="news_button_acquista" href="https://tickets.example.com/india" target="_blank">
                  Buy
                </a>
              </div>
            </div>
          `;
        },
      };
    }

    if (parsed.hostname === "nominatim.openstreetmap.org") {
      return {
        ok: true,
        async json() {
          return [
            {
              display_name: "Teatro di Roma - Teatro India, Rome, Italy",
              lat: "41.8704",
              lon: "12.4674",
              type: "theatre",
            },
          ];
        },
      };
    }

    throw new Error(`Unexpected fetch in live route stop test: ${url}`);
  };

  const result = await generateRecommendations({
    dates: ["2026-04-16"],
    start: { type: "preset", label: "Trastevere" },
    end: { type: "preset", label: "Trastevere" },
    walkingKmTarget: 8,
    preferences: ["kultur", "nattliv"],
    optimizerMode: "bar-hop",
    modifier: "evening",
    // Default routes use catalog stops only; opt into the live-event-as-stop
    // capability so this regression coverage keeps exercising the wiring.
    includeLiveEvents: true,
  });

  assert.ok(
    result.days[0].primary_route.main_stops.some(
      (stop) => stop.is_live_event && stop.label === "Teatro India Night",
    ),
  );
  assert.match(result.days[0].primary_route.live_event_fit_note || "", /ligger inne i själva rutten/i);
});

test("default route generation keeps live events out of main_stops on Rome but the sidecar still annotates them", async () => {
  global.fetch = async (url) => {
    const parsed = new URL(String(url));

    if (parsed.hostname === "api.open-meteo.com") {
      return weatherResponse({
        daily: {
          time: ["2026-04-16"],
          weathercode: [0],
          temperature_2m_max: [23],
        },
      });
    }

    if (parsed.hostname === "www.turismoroma.it") {
      return {
        ok: true,
        async text() {
          return `
            <div class="views-row views-row-1">
              <div class="news_info">
                <div class="news_titolo_container">
                  <div class="news_titolo">
                    <div class="field-content">
                      <a href="/en/events/teatro-india-night">Teatro India Night</a>
                    </div>
                  </div>
                </div>
                <div class="news_date">
                  <div class="field-content">
                    <span class="date-display-start">from&nbsp;16-04-2026</span>
                    <span class="date-display-end">&nbsp;to&nbsp;16-04-2026</span>
                  </div>
                </div>
                <div class="news_tipo">
                  <div class="field-content"><a href="/en/tipo-evento/events">Events</a></div>
                </div>
                <div class="news_sedi">
                  <div class="field-content"><a href="/en/places/teatro-india">Teatro di Roma - Teatro India</a></div>
                </div>
                <div class="news_indirizzo">Lungotevere Vittorio Gassman</div>
                <div class="news_text">
                  <div class="field-content"><p>Guided show visits for a cultural evening in Rome.</p></div>
                </div>
              </div>
            </div>
          `;
        },
      };
    }

    if (parsed.hostname === "nominatim.openstreetmap.org") {
      return {
        ok: true,
        async json() {
          return [
            {
              display_name: "Teatro di Roma - Teatro India, Rome, Italy",
              lat: "41.8704",
              lon: "12.4674",
              type: "theatre",
            },
          ];
        },
      };
    }

    throw new Error(`Unexpected fetch in default-route live-event separation test: ${url}`);
  };

  const result = await generateRecommendations({
    dates: ["2026-04-16"],
    start: { type: "preset", label: "Trastevere" },
    end: { type: "preset", label: "Trastevere" },
    walkingKmTarget: 8,
    preferences: ["kultur", "nattliv"],
    optimizerMode: "bar-hop",
    modifier: "evening",
    // No includeLiveEvents — verify the default path keeps live events
    // off main_stops entirely, while the sidecar continues to expose them.
  });

  const mainStops = result.days[0].primary_route.main_stops;
  assert.ok(
    mainStops.every((stop) => !stop.is_live_event),
    `Default route should contain no live-event main_stops; got: ${mainStops
      .filter((s) => s.is_live_event)
      .map((s) => s.label)
      .join(", ")}`,
  );

  const sidecar = result.days[0].live_events;
  assert.ok(Array.isArray(sidecar) && sidecar.length >= 1, "Sidecar should still expose live events");
  const indiaSidecar = sidecar.find((event) => event.title === "Teatro India Night");
  assert.ok(indiaSidecar, "Teatro India Night should still appear on the sidecar");
  assert.ok(
    indiaSidecar.best_route_id,
    "Sidecar live event should still carry best_route_id annotation so the UI can show 'near this route today'",
  );
});

test("default route generation keeps live events out of main_stops on Barcelona even when events would seed the route", async () => {
  // Realistic Open Data BCN fixture for 2026-05-20: two evening concerts
  // tagged music/kultur/nattliv near Gràcia, scored highly enough by
  // buildLiveEventStopCandidates that — without the include_live_events
  // gate — they would push catalog stops out of primary_route.main_stops
  // (the bug we reproduced via curl). The gate must keep them out by
  // default; we assert that here.
  const openDataFixture = [
    {
      register_id: 91001,
      name: "Concert Gràcia 1",
      status: "published",
      core_type: "event",
      body: "<p>Live music night in Gràcia.</p>",
      start_date: "2026-05-20T20:00:00+02:00",
      end_date: "2026-05-20T23:00:00+02:00",
      addresses: [
        {
          place: "Plaça del Sol",
          address_name: "Plaça del Sol",
          location_4326: { geometries: [{ type: "Point", coordinates: [41.4019, 2.1567] }] },
          location_4326_latlon: { geometries: [{ type: "Point", coordinates: [2.1567, 41.4019] }] },
        },
      ],
      classifications_data: [{ name: "Concerts" }],
      secondary_filters_data: [{ name: "Música" }],
    },
    {
      register_id: 91002,
      name: "Concert Gràcia 2",
      status: "published",
      core_type: "event",
      body: "<p>Second live night in Gràcia.</p>",
      start_date: "2026-05-20T21:00:00+02:00",
      end_date: "2026-05-20T23:30:00+02:00",
      addresses: [
        {
          place: "Casa Vicens vicinity",
          address_name: "Carrer de les Carolines",
          location_4326: { geometries: [{ type: "Point", coordinates: [41.4032, 2.1495] }] },
          location_4326_latlon: { geometries: [{ type: "Point", coordinates: [2.1495, 41.4032] }] },
        },
      ],
      classifications_data: [{ name: "Concerts" }],
      secondary_filters_data: [{ name: "Música" }],
    },
  ];

  global.fetch = async (url) => {
    const parsed = new URL(String(url));

    if (parsed.hostname === "api.open-meteo.com") {
      return weatherResponse({
        daily: {
          time: ["2026-05-20"],
          weathercode: [0],
          temperature_2m_max: [22],
        },
      });
    }

    if (parsed.hostname === "opendata-ajuntament.barcelona.cat") {
      return {
        ok: true,
        async json() {
          return openDataFixture;
        },
      };
    }

    throw new Error(`Unexpected fetch in default Barcelona live-event separation test: ${url}`);
  };

  resetBarcelonaLiveEventsCache();

  const result = await generateRecommendations({
    city: "barcelona",
    dates: ["2026-05-20"],
    start: { type: "preset", label: "Gràcia" },
    end: { type: "preset", label: "Gràcia" },
    walkingKmTarget: 6,
    preferences: ["mat", "kultur", "nattliv"],
    optimizerMode: "evening-mode",
    modifier: "evening",
    lang: "en",
  });

  // The regression coverage matters precisely when Barcelona DOES produce a
  // route here — that's the path the screenshot bug reproduced on. Assert
  // loudly so the test cannot pass vacuously if some future change starts
  // returning days: [] for Barcelona at the engine level.
  assert.ok(
    result.days?.length,
    "Expected generateRecommendations to produce at least one day for Barcelona in this fixture; if Barcelona stops generating routes via the engine, this regression cannot protect against the live-event-in-main_stops bug.",
  );
  const primaryRoute = result.days[0].primary_route;
  assert.ok(
    primaryRoute,
    "Expected day[0].primary_route to exist; without a primary_route there is nothing to assert against.",
  );

  const mainStops = primaryRoute.main_stops || [];
  assert.ok(mainStops.length > 0, "Primary route should contain at least one main stop");
  assert.ok(
    mainStops.every((stop) => !stop.is_live_event),
    `Default Barcelona route should contain no live-event main_stops; got: ${mainStops
      .filter((s) => s.is_live_event)
      .map((s) => s.label)
      .join(", ")}`,
  );

  // The events should still be available on the sidecar (the layer is
  // populated regardless of the gate).
  const sidecar = result.days[0].live_events || [];
  assert.ok(
    sidecar.length >= 1,
    "Sidecar live_events should still be populated even when main_stops excludes them",
  );
});
