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

async function runBarcelonaMultiDayScenario(payload, weatherByDate = {}) {
  global.fetch = createScenarioFetch(weatherByDate);
  const result = await generateRecommendations({
    city: "barcelona",
    legPacing: "balanced",
    distanceMode: "soft_target",
    budgetTier: "standard",
    lang: "en",
    ...payload,
  });

  assert.equal(result.city, "barcelona");
  assert.ok(result.days.length >= 2);

  return result.days.map((day) => day.primary_route).filter(Boolean);
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

test("Barcelona explicit Gracia loop remains topology-bound even with no-limit distance", async () => {
  const route = await runBarcelonaScenario({
    start: { type: "preset", label: "Gràcia" },
    end: { type: "preset", label: "Gràcia" },
    walkingKmTarget: 10,
    preferences: ["lokalt"],
    legPacing: "flexible",
    distanceMode: "no_limit",
  });

  assert.ok(stopItems(route).every((item) => item.area === "gracia"));
  assert.ok(route.longest_leg_km <= 2.2);
  assert.ok(route.estimated_km <= 6.5);
});

test("Barcelona Sant Antoni loop stays compact instead of drifting across the city", async () => {
  const route = await runBarcelonaScenario({
    start: { type: "preset", label: "Sant Antoni" },
    end: { type: "preset", label: "Sant Antoni" },
    walkingKmTarget: 4,
    preferences: ["mat", "vin", "bar"],
    legPacing: "short",
  });
  const allowedAreas = new Set(["sant-antoni", "eixample", "raval"]);

  assert.ok(stopItems(route).every((item) => allowedAreas.has(item.area)));
  assert.ok(route.longest_leg_km <= 1.2);
  assert.ok(route.estimated_km <= 3.8);
});

test("Barcelona Gothic/Born loop stays inside the central neighborhood envelope", async () => {
  const route = await runBarcelonaScenario({
    start: { type: "preset", label: "Gothic" },
    end: { type: "preset", label: "Born" },
    walkingKmTarget: 4,
    preferences: ["kultur", "cafe"],
    legPacing: "short",
  });
  const allowedAreas = new Set(["gothic", "born-sant-pere-santa-caterina", "raval"]);

  assert.ok(stopItems(route).every((item) => allowedAreas.has(item.area)));
  assert.ok(route.longest_leg_km <= 1.2);
  assert.ok(route.estimated_km <= 3.2);
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

test("Barcelona Born to Gracia arc progresses through real connector stops", async () => {
  const route = await runBarcelonaScenario({
    start: { type: "preset", label: "Born" },
    end: { type: "preset", label: "Gràcia" },
    walkingKmTarget: 7,
    preferences: ["kultur", "cafe", "lokalt"],
  });
  const stops = stopItems(route);

  assertRouteLegLabels(route);
  assert.ok(route.longest_leg_km <= 2.1);
  assert.equal(route.long_leg_count, 0);
  assert.ok(stops.some((item) => item.area === "eixample" || item.area === "raval"));
  assert.ok(stops.some((item) => item.area === "gracia"));
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

test("Barcelona rainy low-walking auto-flow chooses a compact route envelope", async () => {
  const route = await runBarcelonaScenario(
    {
      start: { type: "auto", label: "Parranda chooses" },
      end: { type: "auto", label: "Parranda chooses" },
      walkingKmTarget: 4,
      preferences: ["kultur", "cafe"],
      legPacing: "short",
      modifier: "rainy",
    },
    { "2026-05-26": { condition: "rain", temperature: 18 } },
  );

  assert.ok(route.estimated_km <= 4.2);
  assert.ok(route.longest_leg_km <= 1.6);
  assert.equal(route.long_leg_count, 0);
});

test("Barcelona home-base in Gracia biases auto-flow into a local soft loop", async () => {
  const route = await runBarcelonaScenario({
    homeBase: { type: "preset", label: "Gràcia" },
    start: { type: "auto", label: "Parranda chooses" },
    end: { type: "auto", label: "Parranda chooses" },
    walkingKmTarget: 5,
    preferences: ["mat", "vin", "lokalt"],
  });

  assert.ok(stopItems(route).every((item) => item.area === "gracia"));
  assert.ok(route.longest_leg_km <= 1.2);
  assert.ok(route.estimated_km <= 3);
});

test("Barcelona Poblenou weekday route surfaces the Palo Alto Market closed-day warning", async () => {
  // 2026-05-26 is a Tuesday (weekday 2). Palo Alto Market is an event_market
  // with closedWeekdays [1,2,3,4,5], so a route that lands on it on a weekday
  // must emit an opening-hours warning. Regression guard: resolveRouteStopData
  // previously looked the stop up by catalog id via findItemByName (name-only
  // index), always missed, fell back to a stub with closedWeekdays: [], and
  // silently suppressed the warning.
  const route = await runBarcelonaScenario({
    start: { type: "preset", label: "Poblenou" },
    end: { type: "preset", label: "Poblenou" },
    walkingKmTarget: 8,
    preferences: ["market", "kultur", "coast", "hidden gems", "mat", "lokalt"],
    optimizerMode: "culture-mode",
    legPacing: "flexible",
    distanceMode: "no_limit",
  });

  assert.ok(
    stopIds(route).includes("palo-alto-market"),
    "regression premise: this Poblenou weekday route should realize Palo Alto Market",
  );
  assert.ok(
    (route.opening_hours_warnings || []).some((warning) => warning.includes("Palo Alto Market")),
    "Palo Alto Market is closed on weekdays and must trigger an opening-hours warning",
  );
});

test("Barcelona long second-hand trips vary later anchor zones and stop sets", async () => {
  const routes = await runBarcelonaMultiDayScenario({
    dates: ["2026-05-23", "2026-05-24", "2026-05-25", "2026-05-26", "2026-05-27"],
    start: { type: "auto" },
    end: { type: "auto" },
    walkingKmTarget: 6,
    preferences: ["vintage", "shopping", "lokalt"],
  });

  assert.equal(routes.length, 5);

  const anchorZones = new Set(routes.map((route) => route.anchor_zone).filter(Boolean));
  assert.ok(anchorZones.size >= 4);

  assert.notDeepEqual(stopIds(routes[3]), stopIds(routes[4]));
  assert.ok(
    routes.every((route) => Number(route.estimated_km) <= 6.5),
    "late-day novelty should not broaden the route far beyond the 6 km target",
  );
  assert.ok(
    routes.every((route) => Number(route.longest_leg_km) <= 3),
    "long-trip diversity should stay inside a reasonable leg envelope",
  );
  assert.ok(
    routes.every((route) => Number(route.route_continuity_score || 0) >= 8),
    "long-trip diversity should preserve route continuity",
  );

  routes.forEach((route) => {
    const stops = stopItems(route);
    assert.ok(
      stops.some((item) =>
        item.tags.includes("second_hand") ||
        item.tags.includes("vintage") ||
        item.tags.includes("shopping"),
      ),
      "long second-hand trip should keep at least one second-hand-adjacent stop per day",
    );
  });
});

test("Barcelona long second-hand trip ends on a relaxed, coherent final day", async () => {
  const routes = await runBarcelonaMultiDayScenario({
    dates: ["2026-05-23", "2026-05-24", "2026-05-25", "2026-05-26", "2026-05-27"],
    start: { type: "auto" },
    end: { type: "auto" },
    walkingKmTarget: 6,
    preferences: ["vintage", "shopping", "lokalt"],
  });

  assert.equal(routes.length, 5);

  const finalRoute = routes[4];
  const finalStops = stopItems(finalRoute);

  assert.equal(finalStops.length, 3, "final day should reach a relaxed 3-stop count, not collapse to 2");

  assert.ok(
    Number(finalRoute.estimated_km) <= 4.5,
    `final day should walk a softer envelope (got ${finalRoute.estimated_km} km)`,
  );
  assert.ok(
    Number(finalRoute.longest_leg_km) <= 2.3,
    `final day should avoid a long march leg (got ${finalRoute.longest_leg_km} km)`,
  );

  const secondHandCount = finalStops.filter((item) =>
    item.tags.includes("second_hand") || item.tags.includes("vintage"),
  ).length;
  assert.ok(
    secondHandCount / finalStops.length >= 0.6,
    `final day should keep a genuine vintage identity (coverage ${secondHandCount}/${finalStops.length})`,
  );

  assert.notDeepEqual(
    stopIds(finalRoute),
    stopIds(routes[3]),
    "final day should not repeat the previous day's exact stop set",
  );
});
