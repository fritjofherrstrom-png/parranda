const test = require("node:test");
const assert = require("node:assert/strict");

const { generateRecommendations } = require("../server/route-engine");
const { resetLiveEventsCache } = require("../server/live-events");
const {
  VALID_TRUST_TIERS,
  VALID_CONFIDENCE_LEVELS,
  VALID_FRESHNESS_LEVELS,
} = require("../server/place-candidates/contract");

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

function assertCanonicalTrustShape(trust, label) {
  assert.ok(trust && typeof trust === "object", `${label} must carry a trust object`);
  assert.ok(
    VALID_TRUST_TIERS.has(trust.source_tier),
    `${label} source_tier ${trust.source_tier} must be a known trust tier`,
  );
  assert.ok(
    VALID_CONFIDENCE_LEVELS.has(trust.confidence),
    `${label} confidence ${trust.confidence} must be a known confidence level`,
  );
  assert.ok(
    VALID_FRESHNESS_LEVELS.has(trust.freshness),
    `${label} freshness ${trust.freshness} must be a known freshness level`,
  );
  assert.equal(typeof trust.human_verified, "boolean", `${label} human_verified must be boolean`);
}

test.before(() => {
  global.fetch = createStableFetch();
});

test.after(() => {
  global.fetch = originalFetch;
});

test.afterEach(() => {
  resetLiveEventsCache();
});

test("verified citypack stops carry canonical curated trust and are never provisional", async () => {
  const result = await generateRecommendations({
    ...basePayload,
    city: "barcelona",
    preferences: ["vintage", "shopping", "lokalt"],
  });

  const route = result.days[0].primary_route;
  assert.ok(route, "expected a verified citypack route");
  const stops = route.main_stops || [];
  assert.ok(stops.length > 0, "expected verified stops");

  stops.forEach((stop) => {
    const label = `barcelona stop ${stop.id || stop.label}`;
    assertCanonicalTrustShape(stop.trust, label);
    // Implicit curated trust: a local built this.
    assert.equal(stop.trust.source_tier, "curated", `${label} must be curated`);
    assert.equal(stop.trust.confidence, "high", `${label} must be high confidence`);
    assert.equal(stop.trust.human_verified, true, `${label} must be human-verified`);
    assert.equal(stop.trust.freshness, "fresh", `${label} must be fresh`);
    // Derived honesty: verified stops never get the provisional marker.
    assert.equal(stop.provisional, undefined, `${label} must not be marked provisional`);
  });
});

test("provisional stops carry low canonical trust; provisional is derived from it", async () => {
  const result = await generateRecommendations({
    ...basePayload,
    city: "athens",
    dates: ["2026-05-25"],
    start: { type: "custom", label: "Makrygianni", lat: 37.9688, lng: 23.7289 },
    end: { type: "custom", label: "Makrygianni", lat: 37.9688, lng: 23.7289 },
    preferences: ["kultur", "utsikt", "klassiker"],
  });

  const route = result.days[0].primary_route;
  assert.ok(route, "expected a composed Athens route");
  const stops = route.main_stops || [];
  const provisionalStops = stops.filter((stop) => stop.provisional === true);
  const verifiedStops = stops.filter((stop) => stop.provisional !== true);

  assert.ok(provisionalStops.length >= 1, "expected at least one provisional stop");
  assert.ok(verifiedStops.length >= 1, "expected verified stops alongside provisional fill");

  // Every stop carries the canonical trust shape, provisional or not.
  stops.forEach((stop) => {
    assertCanonicalTrustShape(stop.trust, `athens stop ${stop.id}`);
  });

  // Provisional stops: low, unverified, source-candidate trust.
  provisionalStops.forEach((stop) => {
    const label = `provisional stop ${stop.id}`;
    assert.equal(stop.trust.human_verified, false, `${label} must be unverified`);
    assert.equal(stop.trust.confidence, "needs_review", `${label} must be needs_review`);
    assert.ok(
      ["inferred", "fallback"].includes(stop.trust.source_tier),
      `${label} source_tier must be inferred/fallback`,
    );
  });

  // Verified Athens catalog stops in the same route get curated trust.
  verifiedStops.forEach((stop) => {
    const label = `verified athens stop ${stop.id}`;
    assert.equal(stop.trust.human_verified, true, `${label} must be human-verified`);
    assert.equal(stop.trust.source_tier, "curated", `${label} must be curated`);
  });

  // The core invariant: provisional is exactly "unverified trust", never a
  // free-standing flag that can drift from the trust signal.
  stops.forEach((stop) => {
    assert.equal(
      stop.provisional === true,
      stop.trust.human_verified === false,
      `provisional marker for ${stop.id} must agree with trust.human_verified`,
    );
  });
});

test("mature citypack route never surfaces unverified trust", async () => {
  const result = await generateRecommendations({
    ...basePayload,
    city: "barcelona",
    preferences: ["vintage", "shopping", "lokalt"],
  });

  const route = result.days[0].primary_route;
  assert.ok(route);
  (route.main_stops || []).forEach((stop) => {
    assert.notEqual(
      stop.trust.human_verified,
      false,
      `mature city stop ${stop.id} must not carry unverified trust`,
    );
    assert.notEqual(stop.provisional, true, `mature city stop ${stop.id} must not be provisional`);
  });
});
