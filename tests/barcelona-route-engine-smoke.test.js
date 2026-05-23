const test = require("node:test");
const assert = require("node:assert/strict");

const { generateRecommendations } = require("../server/route-engine");
const barcelona = require("../server/cities/barcelona");

const originalFetch = global.fetch;

function createWeatherFetch() {
  return async (url) => {
    const parsed = new URL(String(url));

    if (parsed.hostname !== "api.open-meteo.com") {
      throw new Error(`Unexpected fetch in Barcelona smoke test: ${parsed.hostname}`);
    }

    return {
      ok: true,
      async json() {
        return {
          daily: {
            time: ["2026-05-14", "2026-05-15"],
            weathercode: [0, 0],
            temperature_2m_max: [24, 24],
          },
        };
      },
    };
  };
}

function assertNoStructuralAnchorsAsStops(route) {
  assert.ok(
    route.main_stops.every((stop) => stop.kind !== "district" && stop.kind !== "district-group"),
    "structural route anchors should not render as ordinary route stops",
  );
}

test.afterEach(() => {
  global.fetch = originalFetch;
});

test("Barcelona pilot catalog now has route templates backed by real places", () => {
  const placeItems = barcelona.catalog.allItems.filter((item) => !["district", "district-group"].includes(item.kind));
  const routeAnchors = barcelona.catalog.allItems.filter((item) => item.kind === "district-group");

  assert.equal(barcelona.visibility, "preview");
  assert.equal(placeItems.length, 95);
  assert.equal(routeAnchors.length, 5);
  assert.equal(barcelona.catalog.routeTemplates.length, 6);
});

test("Barcelona multi-day shopping route generation does not crash on entries with omitted closedWeekdays", async () => {
  // Regression for a crash where buildOpeningWarnings in route-engine.js
  // assumed `stop.closedWeekdays` was always defined. Several #141
  // clothing-anchor entries intentionally omit the field when the weekly
  // schedule is unverified (the catalog convention is "omit rather than
  // pretend it is open every day"). Multi-day route generation must
  // survive that.
  global.fetch = createWeatherFetch();

  const result = await generateRecommendations({
    city: "barcelona",
    dates: ["2026-05-14", "2026-05-15"],
    walkingKmTarget: 6,
    preferences: ["vintage", "shopping", "lokalt"],
    legPacing: "balanced",
    distanceMode: "soft_target",
    budgetTier: "standard",
    lang: "en",
  });

  assert.equal(result.city, "barcelona");
  assert.equal(result.days.length, 2);
  for (const day of result.days) {
    assert.ok(day.primary_route, `expected a primary route for ${day.date}`);
  }
});

test("direct Barcelona route-engine probe can build a Barcelona route from the pilot catalog", async () => {
  global.fetch = createWeatherFetch();
  const result = await generateRecommendations({
    city: "barcelona",
    dates: ["2026-05-14"],
    walkingKmTarget: 8,
    preferences: ["mat", "kultur"],
    legPacing: "balanced",
    distanceMode: "soft_target",
    budgetTier: "standard",
    lang: "en",
  });

  assert.equal(result.city, "barcelona");
  assert.equal(result.days.length, 1);
  assert.ok(result.days[0].primary_route, "expected a primary Barcelona route");
  assert.ok(result.days[0].primary_route.main_stops.length >= 3);
  assertNoStructuralAnchorsAsStops(result.days[0].primary_route);
  assert.doesNotMatch(
    JSON.stringify(result.days[0].primary_route),
    /Trastevere|Monti|Testaccio|Centro Storico|Garbatella|Pigneto|\bRom\b|\bRome\b/,
  );
});

test("direct Barcelona route-engine probe uses structural route anchors for auto preview routes", async () => {
  global.fetch = createWeatherFetch();

  const result = await generateRecommendations({
    city: "barcelona",
    dates: ["2026-05-16"],
    start: { type: "auto", label: "Parranda chooses" },
    end: { type: "auto", label: "Parranda chooses" },
    walkingKmTarget: 9,
    preferences: [],
    legPacing: "balanced",
    distanceMode: "soft_target",
    budgetTier: "standard",
    lang: "en",
  });

  assert.equal(result.city, "barcelona");
  assert.equal(result.days.length, 1);
  assert.ok(result.days[0].primary_route);
  assertNoStructuralAnchorsAsStops(result.days[0].primary_route);
  assert.notEqual(result.resolved_start.label, "Barcelona");
  assert.notEqual(result.resolved_end.label, "Barcelona");
});

test("direct Barcelona route-engine probe separates food-culture from food-nightlife", async () => {
  global.fetch = createWeatherFetch();
  const auto = { type: "auto", label: "Parranda chooses" };
  const base = {
    city: "barcelona",
    dates: ["2026-05-14"],
    start: auto,
    end: auto,
    walkingKmTarget: 8,
    legPacing: "balanced",
    distanceMode: "soft_target",
    budgetTier: "standard",
    lang: "en",
  };

  const culture = await generateRecommendations({
    ...base,
    preferences: ["mat", "vin", "öl", "cocktail", "kultur", "kyrkor"],
  });
  const nightlife = await generateRecommendations({
    ...base,
    preferences: ["mat", "vin", "öl", "cocktail", "nattliv", "kväll", "party"],
  });
  const cultureStops = culture.days[0].primary_route.main_stops.map((stop) => stop.label);
  const nightlifeStops = nightlife.days[0].primary_route.main_stops.map((stop) => stop.label);
  const nightlifeAreas = new Set(nightlife.days[0].primary_route.main_stops.map((stop) => stop.area));

  assertNoStructuralAnchorsAsStops(culture.days[0].primary_route);
  assertNoStructuralAnchorsAsStops(nightlife.days[0].primary_route);
  assert.notDeepEqual(cultureStops, nightlifeStops);
  assert.ok(nightlifeAreas.has("poble-sec") || nightlifeAreas.has("montjuic"));
  assert.doesNotMatch(
    JSON.stringify({ culture, nightlife }),
    /Trastevere|Monti|Testaccio|Centro Storico|Garbatella|Pigneto|\bRom\b|\bRome\b/,
  );
  assert.doesNotMatch(
    JSON.stringify({ culture, nightlife }),
    /Gràcia med kultur|Sant Antoni som tät mat- och bardag|Ett gammalstadsspår som undviker topplistan/,
  );
});

test("direct Barcelona route-engine probe reaches coast-east stops for coast intent", async () => {
  global.fetch = createWeatherFetch();
  const auto = { type: "auto", label: "Parranda chooses" };

  const result = await generateRecommendations({
    city: "barcelona",
    dates: ["2026-05-14"],
    start: auto,
    end: auto,
    walkingKmTarget: 8,
    preferences: ["kultur", "mat", "vin", "utsikt", "coast", "hidden gems"],
    legPacing: "balanced",
    distanceMode: "soft_target",
    budgetTier: "standard",
    lang: "en",
  });
  const areas = new Set(result.days[0].primary_route.main_stops.map((stop) => stop.area));

  assertNoStructuralAnchorsAsStops(result.days[0].primary_route);
  assert.ok(areas.has("poblenou") || areas.has("barceloneta"));
});

test("direct Barcelona route-engine probe keeps Gracia and Sant Antoni hints locally meaningful", async () => {
  global.fetch = createWeatherFetch();
  const auto = { type: "auto", label: "Parranda chooses" };
  const base = {
    city: "barcelona",
    dates: ["2026-05-14"],
    end: auto,
    walkingKmTarget: 7,
    legPacing: "balanced",
    distanceMode: "soft_target",
    budgetTier: "standard",
    lang: "en",
  };

  const gracia = await generateRecommendations({
    ...base,
    start: { type: "preset", label: "Gràcia" },
    preferences: ["kultur", "nattliv", "kväll"],
  });
  const santAntoni = await generateRecommendations({
    ...base,
    start: { type: "preset", label: "Sant Antoni" },
    preferences: ["mat", "vin", "nattliv", "kväll"],
  });
  const graciaAreas = gracia.days[0].primary_route.main_stops.map((stop) => stop.area);
  const santAntoniAreas = santAntoni.days[0].primary_route.main_stops.map((stop) => stop.area);

  assertNoStructuralAnchorsAsStops(gracia.days[0].primary_route);
  assertNoStructuralAnchorsAsStops(santAntoni.days[0].primary_route);
  assert.ok(graciaAreas.includes("gracia"));
  assert.ok(santAntoniAreas.includes("sant-antoni"));
});
