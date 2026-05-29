const test = require("node:test");
const assert = require("node:assert/strict");

const { generateRecommendations } = require("../server/route-engine");
const { resetLiveEventsCache } = require("../server/live-events");

const originalFetch = global.fetch;

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

// Generic stable fetch: weather for any anchor, empty for any source feed.
// No city-specific hosts so the harness proves it is not Barcelona/Rome-bound.
function createStableFetch() {
  return async (url) => {
    const parsed = new URL(String(url));
    if (parsed.hostname === "api.open-meteo.com") {
      const start = new Date(`${parsed.searchParams.get("start_date")}T12:00:00`);
      const end = new Date(`${parsed.searchParams.get("end_date")}T12:00:00`);
      const time = [];
      const weathercode = [];
      const temperature_2m_max = [];
      const temperature_2m_min = [];
      for (let cursor = new Date(start); cursor <= end; cursor.setDate(cursor.getDate() + 1)) {
        time.push(cursor.toISOString().slice(0, 10));
        weathercode.push(0);
        temperature_2m_max.push(22);
        temperature_2m_min.push(13);
      }
      return mockJsonResponse({
        daily: { time, weathercode, temperature_2m_max, temperature_2m_min },
        current: { temperature_2m: 18, weather_code: 1, is_day: 1 },
      });
    }
    return {
      ok: true,
      status: 200,
      statusText: "OK",
      async text() {
        return "<div></div>";
      },
      async json() {
        return { result: { records: [] }, items: [] };
      },
    };
  };
}

const basePayload = {
  dates: ["2026-06-10"],
  start: { type: "auto" },
  end: { type: "auto" },
  walkingKmTarget: 7,
  preferences: ["mat", "kultur"],
  legPacing: "balanced",
  distanceMode: "soft_target",
  budgetTier: "standard",
  lang: "en",
};

test.before(() => {
  global.fetch = createStableFetch();
});

test.after(() => {
  global.fetch = originalFetch;
});

test.afterEach(() => {
  resetLiveEventsCache();
});

test("unknown city (Malmö) is not silently planned as the fallback city", async () => {
  const result = await generateRecommendations({ ...basePayload, city: "malmo" });

  // Honest unsupported shape — must NOT echo the fallback city or its routes.
  assert.equal(result.city, "malmo");
  assert.equal(result.readiness.status, "unsupported_city");
  assert.equal(result.readiness.signal, "unsupported_city");
  assert.equal(result.readiness.requested_city, "malmo");
  assert.equal(result.readiness.resolved_city, null);
  assert.equal(result.readiness.fallback_used, true);

  // No route leak: every day is an honest null route, never a fallback-city itinerary.
  assert.ok(result.days.length >= 1);
  result.days.forEach((day) => {
    assert.equal(day.primary_route, null);
    assert.deepEqual(day.alternatives, []);
  });
  assert.equal(result.resolved_start, null);
  assert.equal(result.resolved_end, null);
});

test("thin registered city (Athens, zero templates) returns honest enrichment signal", async () => {
  const result = await generateRecommendations({ ...basePayload, city: "athens" });

  assert.equal(result.city, "athens");
  assert.equal(result.readiness.resolved_city, "athens");
  assert.equal(result.readiness.fallback_used, false);
  assert.equal(result.readiness.catalog.route_template_count, 0);
  assert.equal(result.readiness.signal, "source_enrichment_needed");
  assert.notEqual(result.readiness.status, "unsupported_city");

  // Honest empty — no crash, no hallucinated route from a template-less catalog.
  result.days.forEach((day) => {
    assert.equal(day.primary_route, null);
  });
});

test("thin internal city (test-city) is routable and flagged generically, not leaked", async () => {
  const result = await generateRecommendations({ ...basePayload, city: "test-city" });

  assert.equal(result.city, "test-city");
  assert.equal(result.readiness.resolved_city, "test-city");
  assert.equal(result.readiness.fallback_used, false);
  assert.ok(result.readiness.catalog.route_template_count > 0);
  assert.ok(["ready", "source_enrichment_needed"].includes(result.readiness.signal));
});

test("mature citypack (Barcelona) is ready and still produces real routes", async () => {
  const result = await generateRecommendations({
    ...basePayload,
    city: "barcelona",
    preferences: ["vintage", "shopping", "lokalt"],
  });

  assert.equal(result.city, "barcelona");
  assert.equal(result.readiness.resolved_city, "barcelona");
  assert.equal(result.readiness.fallback_used, false);
  assert.ok(result.readiness.catalog.route_template_count > 0);
  assert.equal(result.readiness.signal, "ready");

  // Regression guard: readiness metadata did not break real planning.
  assert.ok(result.days[0].primary_route);
  assert.ok((result.days[0].primary_route.main_stops || []).length > 0);
});

test("omitted city keeps the default-city plan (no false unsupported)", async () => {
  const result = await generateRecommendations({ ...basePayload });

  assert.equal(result.readiness.fallback_used, false);
  assert.notEqual(result.readiness.status, "unsupported_city");
  assert.ok(result.days[0].primary_route);
});
