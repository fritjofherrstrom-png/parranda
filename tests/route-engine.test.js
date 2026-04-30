const test = require("node:test");
const assert = require("node:assert/strict");

const {
  annotateLiveEventsForRoutes,
  buildRouteFromTemplate,
  buildLiveEventStopCandidates,
  budgetScore,
  generateRecommendations,
  kmScore,
  normalizeBudgetTier,
  normalizeModifier,
  preferenceScore,
  priceLevelWeight,
  profileScore,
  routeScore,
  routeSimilarity,
} = require("../server/route-engine");
const { findItemByName, routeTemplates } = require("../server/catalog");
const { resetLiveEventsCache } = require("../server/live-events");

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

  assert.ok(nonTemplateStops.length >= 2);
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
  });

  assert.ok(
    result.days[0].primary_route.main_stops.some(
      (stop) => stop.is_live_event && stop.label === "Teatro India Night",
    ),
  );
  assert.match(result.days[0].primary_route.live_event_fit_note || "", /ligger inne i själva rutten/i);
});
