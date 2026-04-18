const test = require("node:test");
const assert = require("node:assert/strict");

const {
  budgetScore,
  generateRecommendations,
  kmScore,
  normalizeBudgetTier,
  normalizeModifier,
  preferenceScore,
  priceLevelWeight,
  profileScore,
  routeScore,
} = require("../server/route-engine");
const { routeTemplates } = require("../server/catalog");
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
