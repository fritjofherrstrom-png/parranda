const test = require("node:test");
const assert = require("node:assert/strict");

const {
  generateRecommendations,
  buildRouteTrustSummary,
} = require("../server/route-engine");
const { resetLiveEventsCache } = require("../server/live-events");
const {
  VALID_TRUST_TIERS,
  VALID_CONFIDENCE_LEVELS,
} = require("../server/route-candidates/contract");
const { VALID_FRESHNESS_LEVELS } = require("../server/place-candidates/contract");

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

function assertCanonicalTrustSummary(summary, label) {
  assert.ok(summary && typeof summary === "object", `${label} must have a trust_summary`);
  assert.ok(Array.isArray(summary.source_tiers), `${label} source_tiers must be an array`);
  summary.source_tiers.forEach((tier) => {
    assert.ok(VALID_TRUST_TIERS.has(tier), `${label} tier ${tier} must be canonical`);
  });
  assert.ok(VALID_CONFIDENCE_LEVELS.has(summary.confidence), `${label} confidence must be canonical`);
  assert.ok(VALID_FRESHNESS_LEVELS.has(summary.freshness), `${label} freshness must be canonical`);
  assert.equal(typeof summary.human_verified, "boolean", `${label} human_verified must be boolean`);
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

// ---- Unit tests for buildRouteTrustSummary (boundary logic) -----------------

test("buildRouteTrustSummary: all-curated, all-verified stops → high", () => {
  const stops = [
    { trust: { source_tier: "curated", confidence: "high", human_verified: true, freshness: "fresh" } },
    { trust: { source_tier: "curated", confidence: "high", human_verified: true, freshness: "fresh" } },
  ];
  const { trust_summary, credibility_tier } = buildRouteTrustSummary(stops);
  assert.equal(credibility_tier, "high");
  assert.equal(trust_summary.confidence, "high");
  assert.equal(trust_summary.human_verified, true);
  assert.deepEqual(trust_summary.source_tiers, ["curated"]);
});

test("buildRouteTrustSummary: official-but-unreviewed (human_verified:false) is NOT high", () => {
  // A live event is official but unreviewed. It must push the route to medium,
  // never high — "high" means a human stood behind every stop.
  const stops = [
    { trust: { source_tier: "curated", confidence: "high", human_verified: true, freshness: "fresh" } },
    { trust: { source_tier: "official", confidence: "medium", human_verified: false, freshness: "live" } },
  ];
  const { trust_summary, credibility_tier } = buildRouteTrustSummary(stops);
  assert.equal(credibility_tier, "medium", "unverified official stop must drop the route to medium");
  assert.equal(trust_summary.human_verified, false);
});

test("buildRouteTrustSummary: a minority of provisional stops → medium", () => {
  const stops = [
    { trust: { source_tier: "curated", confidence: "high", human_verified: true, freshness: "fresh" } },
    { trust: { source_tier: "curated", confidence: "high", human_verified: true, freshness: "fresh" } },
    { provisional: true, trust: { source_tier: "inferred", confidence: "needs_review", human_verified: false, freshness: "unknown" } },
  ];
  const { credibility_tier } = buildRouteTrustSummary(stops);
  assert.equal(credibility_tier, "medium", "1 of 3 provisional is a minority → medium");
});

test("buildRouteTrustSummary: provisional stops dominate (>= half) → low", () => {
  const stops = [
    { trust: { source_tier: "curated", confidence: "high", human_verified: true, freshness: "fresh" } },
    { provisional: true, trust: { source_tier: "inferred", confidence: "needs_review", human_verified: false, freshness: "unknown" } },
    { provisional: true, trust: { source_tier: "inferred", confidence: "needs_review", human_verified: false, freshness: "unknown" } },
  ];
  const { trust_summary, credibility_tier } = buildRouteTrustSummary(stops);
  assert.equal(credibility_tier, "low", "2 of 3 provisional dominates → low");
  assert.equal(trust_summary.human_verified, false);
  assert.ok(trust_summary.source_tiers.includes("inferred"));
});

test("buildRouteTrustSummary: freshness is the worst-case across stops", () => {
  const stops = [
    { trust: { source_tier: "curated", confidence: "high", human_verified: true, freshness: "live" } },
    { trust: { source_tier: "curated", confidence: "high", human_verified: true, freshness: "stale" } },
  ];
  const { trust_summary } = buildRouteTrustSummary(stops);
  assert.equal(trust_summary.freshness, "stale", "route is only as fresh as its least-fresh stop");
});

test("buildRouteTrustSummary: empty route is not high", () => {
  const { credibility_tier } = buildRouteTrustSummary([]);
  assert.notEqual(credibility_tier, "high");
});

// ---- Integration tests over generateRecommendations -------------------------

test("mature curated route (Barcelona) → high credibility, never provisional", async () => {
  const result = await generateRecommendations({
    ...basePayload,
    city: "barcelona",
    preferences: ["vintage", "shopping", "lokalt"],
  });

  const route = result.days[0].primary_route;
  assert.ok(route, "expected a Barcelona route");
  assert.equal(route.credibility_tier, "high");
  assertCanonicalTrustSummary(route.trust_summary, "barcelona route");
  assert.ok(route.trust_summary.source_tiers.includes("curated"));
  assert.equal(route.trust_summary.human_verified, true);
  assert.equal(route.provisional_stop_count, 0);

  // Credibility is SEPARATE from route.confidence — a mature route has no
  // thin-city composition confidence field set.
  assert.notEqual(route.confidence, "low");
});

test("thin provisional route (Athens) → low credibility, honest mixed trust", async () => {
  const result = await generateRecommendations({
    ...basePayload,
    city: "athens",
    dates: ["2026-05-25"],
    start: { type: "custom", label: "Makrygianni", lat: 37.9688, lng: 23.7289 },
    end: { type: "custom", label: "Makrygianni", lat: 37.9688, lng: 23.7289 },
    preferences: ["kultur", "utsikt", "klassiker"],
  });

  const route = result.days[0].primary_route;
  assert.ok(route, "expected an Athens route");
  assert.equal(route.credibility_tier, "low");
  assertCanonicalTrustSummary(route.trust_summary, "athens route");
  assert.equal(route.trust_summary.human_verified, false);
  assert.ok(route.trust_summary.source_tiers.includes("inferred"), "thin route mixes in inferred tier");

  // route.confidence stays the existing thin-city signal, untouched by credibility.
  assert.equal(route.confidence, "low");
});

test("credibility derivation is deterministic across repeated calls", async () => {
  const payload = {
    ...basePayload,
    city: "barcelona",
    preferences: ["vintage", "shopping", "lokalt"],
  };
  const first = (await generateRecommendations(payload)).days[0].primary_route;
  const second = (await generateRecommendations(payload)).days[0].primary_route;
  assert.equal(first.credibility_tier, second.credibility_tier);
  assert.deepEqual(first.trust_summary, second.trust_summary);
});
