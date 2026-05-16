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

test("Barcelona pilot catalog has places but no route templates yet", () => {
  assert.equal(barcelona.visibility, "preview");
  assert.equal(barcelona.catalog.allItems.length, 26);
  assert.equal(barcelona.catalog.routeTemplates.length, 0);
});

test("direct Barcelona route-engine probe is blocked by missing route templates", async () => {
  global.fetch = createWeatherFetch();

  await assert.rejects(
    () =>
      generateRecommendations({
        city: "barcelona",
        dates: ["2026-05-14"],
        walkingKmTarget: 8,
        preferences: ["mat", "kultur"],
        legPacing: "balanced",
        distanceMode: "soft_target",
        budgetTier: "standard",
        lang: "en",
      }),
    /Cannot read properties of null \(reading 'route'\)/,
  );
});
