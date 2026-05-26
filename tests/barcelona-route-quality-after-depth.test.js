const assert = require("node:assert/strict");
const test = require("node:test");

const barcelona = require("../server/cities/barcelona");
const { generateRecommendations } = require("../server/route-engine");

const originalFetch = global.fetch;
const catalogById = new Map(barcelona.catalog.allItems.map((item) => [item.id, item]));

function mockJsonResponse(payload) {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    async json() {
      return payload;
    },
    async text() {
      return JSON.stringify(payload);
    },
  };
}

function createScenarioFetch(weatherByDate = {}) {
  return async (url) => {
    const parsed = new URL(String(url));

    if (parsed.hostname === "api.open-meteo.com") {
      const date = parsed.searchParams.get("start_date") || "2026-05-26";
      const weather = weatherByDate[date] || {};

      return mockJsonResponse({
        daily: {
          time: [date],
          weathercode: [weather.weathercode ?? 0],
          temperature_2m_max: [weather.max ?? 24],
          temperature_2m_min: [weather.min ?? 16],
        },
        current: {
          temperature_2m: weather.current ?? 22,
          weather_code: weather.weathercode ?? 0,
          is_day: 1,
        },
      });
    }

    if (
      parsed.hostname === "opendata-ajuntament.barcelona.cat" ||
      parsed.hostname === "agenda.cultura.gencat.cat" ||
      parsed.hostname === "www.turismoroma.it"
    ) {
      return mockJsonResponse({ result: { records: [] }, items: [] });
    }

    throw new Error(`Unexpected fetch during Barcelona route quality test: ${url}`);
  };
}

async function runBarcelonaScenario(payload, weatherByDate = {}) {
  global.fetch = createScenarioFetch(weatherByDate);
  const result = await generateRecommendations({
    city: "barcelona",
    dates: ["2026-05-26"],
    legPacing: "balanced",
    distanceMode: "soft_target",
    budgetTier: "standard",
    lang: "en",
    ...payload,
  });

  assert.equal(result.city, "barcelona");
  assert.equal(result.days.length, 1);
  assert.ok(result.days[0].primary_route);

  return result.days[0].primary_route;
}

function stopIds(route) {
  return (route.main_stops || []).map((stop) => stop.id);
}

function stopItems(route) {
  return stopIds(route).map((id) => catalogById.get(id)).filter(Boolean);
}

function assertRouteLegLabels(route) {
  for (const leg of route.legs || []) {
    assert.ok(leg.from_label, `Expected leg from_label for ${route.id}`);
    assert.ok(leg.to_label, `Expected leg to_label for ${route.id}`);
  }
}

test.after(() => {
  global.fetch = originalFetch;
});

test("Barcelona second-hand afternoon stays on the vintage route family instead of coast drift", async () => {
  const route = await runBarcelonaScenario({
    start: { type: "auto" },
    end: { type: "auto" },
    walkingKmTarget: 6,
    preferences: ["second_hand", "vintage", "shopping", "lokalt"],
  });
  const stops = stopItems(route);

  assert.equal(route.id, "raval-vintage-shopping-loop");
  assert.notEqual(route.start_label, "Poblenou / Coast");
  assert.notEqual(route.end_label, "Poblenou / Coast");
  assertRouteLegLabels(route);
  assert.ok(route.estimated_km <= 5);
  assert.ok(stops.length >= 3);
  assert.ok(
    stops.every((item) => item.tags.includes("second_hand") || item.tags.includes("vintage")),
    "second-hand afternoon should be carried by vintage/second-hand stops",
  );
});

test("Barcelona vintage plus cafe keeps one cafe stop in the realized route", async () => {
  const route = await runBarcelonaScenario({
    start: { type: "preset", label: "Raval" },
    end: { type: "auto" },
    walkingKmTarget: 5,
    preferences: ["vintage", "second_hand", "shopping", "cafe", "low-key"],
  });
  const stops = stopItems(route);

  assertRouteLegLabels(route);
  assert.ok(stops.some((item) => item.kind === "cafe" || item.tags.includes("cafe")));
  assert.ok(stops.some((item) => item.tags.includes("second_hand")));
  assert.ok(route.estimated_km <= 3);
});

test("Barcelona low-key evening stays local to Gracia", async () => {
  const route = await runBarcelonaScenario({
    start: { type: "preset", label: "Gràcia" },
    end: { type: "auto" },
    walkingKmTarget: 5,
    preferences: ["low-key", "vin", "mat", "lokalt", "kväll"],
    optimizerMode: "low-key",
    modifier: "low_key",
  });

  assert.ok(stopItems(route).every((item) => item.area === "gracia"));
  assert.ok(route.estimated_km <= 2);
});

test("Barcelona beer/bar night can use Poble-sec evening density without structural stops", async () => {
  const route = await runBarcelonaScenario({
    start: { type: "preset", label: "Poble-sec" },
    end: { type: "auto" },
    walkingKmTarget: 7,
    preferences: ["öl", "nattliv", "mat", "lokalt"],
    optimizerMode: "bar-hop",
    modifier: "party",
  });
  const ids = stopIds(route);

  assert.ok(ids.includes("abirradero"));
  assert.ok(stopItems(route).every((item) => item.kind !== "district-group"));
  assert.ok(stopItems(route).filter((item) => item.area === "poble-sec").length >= 3);
});

test("Barcelona short walking food/wine day remains compact", async () => {
  const route = await runBarcelonaScenario({
    start: { type: "preset", label: "Sant Antoni" },
    end: { type: "preset", label: "Sant Antoni" },
    walkingKmTarget: 3,
    preferences: ["mat", "vin", "low-key"],
    legPacing: "short",
  });

  assert.ok(route.estimated_km <= 3.5);
  assert.ok(Math.max(...(route.legs || []).map((leg) => Number(leg.distance_km) || 0)) <= 1.2);
});

test("Barcelona Gracia to Poblenou second-hand route inserts a real bridge instead of a dead long leg", async () => {
  const route = await runBarcelonaScenario({
    start: { type: "preset", label: "Gràcia" },
    end: { type: "preset", label: "Poblenou" },
    walkingKmTarget: 8,
    preferences: ["second_hand", "vintage", "shopping", "cafe"],
  });
  const stops = stopItems(route);

  assertRouteLegLabels(route);
  assert.ok(route.longest_leg_km < 3.2);
  assert.equal(route.long_leg_count, 0);
  assert.ok(route.route_continuity_score >= 7);
  assert.ok(route.estimated_km <= 9.1);
  assert.ok(
    stops.some((item) => !["gracia", "poblenou"].includes(item.area)),
    "expected a real bridge stop between Gracia and Poblenou clusters",
  );
});

test("Barcelona Gracia to Barceloneta nightlife route no longer keeps a 4km dead walking leg in balanced mode", async () => {
  const route = await runBarcelonaScenario({
    start: { type: "preset", label: "Gràcia" },
    end: { type: "preset", label: "Barceloneta" },
    walkingKmTarget: 9,
    preferences: ["öl", "vin", "nattliv", "mat", "kväll"],
    optimizerMode: "bar-hop",
  });
  const stops = stopItems(route);

  assertRouteLegLabels(route);
  assert.ok(route.longest_leg_km < 3.2);
  assert.equal(route.long_leg_count, 0);
  assert.ok(route.route_continuity_score >= 7);
  assert.ok(
    stops.some((item) => !["gracia", "barceloneta"].includes(item.area)),
    "expected an intermediate real stop between Gracia and the coast cluster",
  );
});

test("Barcelona flexible no-limit routes may keep a long transfer but must report it honestly", async () => {
  const route = await runBarcelonaScenario({
    start: { type: "preset", label: "Gràcia" },
    end: { type: "preset", label: "Poblenou" },
    walkingKmTarget: 12,
    preferences: ["second_hand", "vintage", "shopping", "cafe"],
    legPacing: "flexible",
    distanceMode: "no_limit",
  });

  assertRouteLegLabels(route);
  assert.ok(route.long_leg_count >= 1);
  assert.ok(route.dead_walk_penalty > 0);
  assert.ok(route.route_continuity_score < 10);
  assert.ok(Array.isArray(route.route_quality_warnings));
  assert.ok(route.route_quality_warnings.length >= 1);
});
