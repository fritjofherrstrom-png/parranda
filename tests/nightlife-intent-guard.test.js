const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { isNightlifeExplicit, generateRecommendations } = require("../server/route-engine");

const originalFetch = global.fetch;

function createWeatherFetch() {
  return async (url) => {
    const parsed = new URL(String(url));
    if (parsed.hostname !== "api.open-meteo.com") {
      throw new Error(`Unexpected fetch in nightlife guard test: ${parsed.hostname}`);
    }
    return {
      ok: true,
      async json() {
        return {
          daily: {
            time: ["2026-06-01"],
            weathercode: [0],
            temperature_2m_max: [24],
          },
        };
      },
    };
  };
}

test.afterEach(() => {
  global.fetch = originalFetch;
});

test("isNightlifeExplicit returns false for food/drink + culture + hidden gems", () => {
  assert.equal(
    isNightlifeExplicit(["mat", "vin", "öl", "cocktail", "kultur", "kyrkor", "hidden gems", "low-key"]),
    false,
  );
});

test("isNightlifeExplicit returns true when nattliv is in preferences", () => {
  assert.equal(isNightlifeExplicit(["mat", "nattliv"]), true);
});

test("isNightlifeExplicit returns true when kväll is in preferences", () => {
  assert.equal(isNightlifeExplicit(["kväll"]), true);
});

test("isNightlifeExplicit returns true when party is in preferences", () => {
  assert.equal(isNightlifeExplicit(["party"]), true);
});

test("isNightlifeExplicit returns true for bar-hop optimizer", () => {
  assert.equal(isNightlifeExplicit(["mat"], "bar-hop"), true);
});

test("isNightlifeExplicit returns true for evening modifier", () => {
  assert.equal(isNightlifeExplicit(["mat"], null, "evening"), true);
});

test("isNightlifeExplicit returns false for culture-mode optimizer", () => {
  assert.equal(isNightlifeExplicit(["kultur"], "culture-mode"), false);
});

test("isNightlifeExplicit returns false with empty preferences", () => {
  assert.equal(isNightlifeExplicit([]), false);
});

test("isNightlifeExplicit returns true when nightlife is in preferences", () => {
  assert.equal(isNightlifeExplicit(["nightlife"]), true);
});

test("isNightlifeExplicit returns true when evening is in preferences", () => {
  assert.equal(isNightlifeExplicit(["evening"]), true);
});

test("Barcelona default-preference route has no nightlife framing in title/summary/why", async () => {
  global.fetch = createWeatherFetch();
  const result = await generateRecommendations({
    city: "barcelona",
    dates: ["2026-06-01"],
    walkingKmTarget: 6,
    preferences: ["mat", "vin", "öl", "cocktail", "kultur", "kyrkor", "hidden gems", "low-key"],
    legPacing: "balanced",
    distanceMode: "soft_target",
    budgetTier: "standard",
    lang: "en",
  });

  assert.ok(result.days.length >= 1, "should produce at least one day");
  const route = result.days[0].primary_route;
  assert.ok(route, "expected a primary route");

  const nightlifePatterns = /\b(nightlife|nattliv|party|late[- ]night|clubbing|nattklubb)\b/i;

  const title = route.title || "";
  const summary = route.summary || "";
  const why = route.why_recommended || "";

  assert.ok(
    !nightlifePatterns.test(title),
    `route title should not contain nightlife framing, got: "${title}"`,
  );
  assert.ok(
    !nightlifePatterns.test(summary),
    `route summary should not contain nightlife framing, got: "${summary}"`,
  );
  assert.ok(
    !nightlifePatterns.test(why),
    `why_recommended should not contain nightlife framing, got: "${why}"`,
  );
});

test("default planner markup does not have nightlife checked", () => {
  const indexHtml = fs.readFileSync(
    path.join(__dirname, "..", "index.html"),
    "utf8",
  );
  const nightlifeChip = indexHtml.match(
    /value="nightlife"[^>]*/,
  );
  assert.ok(nightlifeChip, "nightlife checkbox should exist");
  assert.ok(
    !nightlifeChip[0].includes("checked"),
    `nightlife checkbox should not be default-checked, found: ${nightlifeChip[0]}`,
  );
});

test("default planner JS does not include nightlife in defaults", () => {
  const scriptJs = fs.readFileSync(
    path.join(__dirname, "..", "script.js"),
    "utf8",
  );
  const match = scriptJs.match(
    /defaultPlannerIntentKeys\s*=\s*\[([^\]]*)\]/,
  );
  assert.ok(match, "defaultPlannerIntentKeys should be defined");
  assert.ok(
    !match[1].includes("nightlife"),
    `defaultPlannerIntentKeys should not include nightlife, found: [${match[1]}]`,
  );
});
