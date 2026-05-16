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

test.afterEach(() => {
  global.fetch = originalFetch;
});

test("Barcelona pilot catalog now has route templates backed by real places", () => {
  assert.equal(barcelona.visibility, "preview");
  assert.equal(barcelona.catalog.allItems.length, 26);
  assert.equal(barcelona.catalog.routeTemplates.length, 6);
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
  assert.doesNotMatch(
    JSON.stringify(result.days[0].primary_route),
    /Trastevere|Monti|Testaccio|Centro Storico|Garbatella|Pigneto|\bRom\b|\bRome\b/,
  );
});

test("direct Barcelona route-engine probe falls back to city-center anchors when auto districts are missing", async () => {
  global.fetch = createWeatherFetch();

  const result = await generateRecommendations({
    city: "barcelona",
    dates: ["2026-05-16"],
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
  assert.equal(result.resolved_start.label, "Barcelona");
  assert.equal(result.resolved_end.label, "Barcelona");
});
