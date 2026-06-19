const test = require("node:test");
const assert = require("node:assert/strict");

const {
  generateRecommendations,
  generateAgnosticRecommendations,
} = require("../server/route-engine");
const { getCityConfig } = require("../server/cities");
const { resetLiveEventsCache } = require("../server/live-events");
const {
  buildAgnosticEngineCityConfig,
} = require("../server/planner/agnostic-engine-compose");

const originalFetch = global.fetch;

// Generic stable fetch: weather for any anchor, empty for any other feed. No
// city-specific hosts, so the harness proves the path is not city-bound.
function createStableFetch() {
  return async (url) => {
    const parsed = new URL(String(url));
    if (parsed.hostname === "api.open-meteo.com") {
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        async json() {
          return {
            daily: {
              time: ["2026-06-20"],
              weathercode: [0],
              temperature_2m_max: [24],
              temperature_2m_min: [15],
            },
            current: { temperature_2m: 20, weather_code: 0, is_day: 1 },
          };
        },
        async text() {
          return "{}";
        },
      };
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
  dates: ["2026-06-20"],
  start: { type: "auto" },
  end: { type: "auto" },
  walkingKmTarget: 6,
  preferences: ["mat", "kultur"],
  legPacing: "balanced",
  distanceMode: "soft_target",
  budgetTier: "standard",
  lang: "en",
};

// A cluster of source-backed, finite-geo provisional candidates near a generic
// anchor (a made-up coastal old town — NOT a registered city). Shaped per the
// place-candidate draft_place contract with honest low trust.
function sourceCandidate(overrides = {}) {
  return {
    id: "agn-stop-1",
    city: "agnostic-engine-area",
    label: "Old Harbour Promenade",
    type: "viewpoint",
    candidate_kind: "draft_place",
    is_structural: false,
    city_pack_owned: false,
    lat: 43.5101,
    lng: 16.4402,
    area: "old-town",
    tags: ["utsikt", "klassiker"],
    route_roles: ["connector", "viewpoint_anchor"],
    source: { kind: "open_geo_source", label: "OpenStreetMap", url: "https://example.test/osm/1" },
    trust: { source_tier: "inferred", confidence: "needs_review", human_verified: false, freshness: "unknown" },
    confidence: "needs_review",
    freshness: "unknown",
    provenance: { why_included: "source-backed", source_note: "test", last_seen: "2026-06-01" },
    ...overrides,
  };
}

const ANCHOR = { lat: 43.5096, lng: 16.4397 };

function threeCandidates() {
  return [
    sourceCandidate(),
    sourceCandidate({ id: "agn-stop-2", label: "Cathedral Square", type: "landmark", lat: 43.5089, lng: 16.4419, area: "old-town" }),
    sourceCandidate({ id: "agn-stop-3", label: "Riva Cafés", type: "cafe", lat: 43.5076, lng: 16.4408, area: "old-town" }),
  ];
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

test("generateAgnosticRecommendations requires a cityConfig", async () => {
  await assert.rejects(() => generateAgnosticRecommendations({}), /requires a cityConfig/);
});

test("any-place config with source-backed candidates composes through agnostic_compose", async () => {
  const cityConfig = buildAgnosticEngineCityConfig({
    anchor: ANCHOR,
    sourceCandidates: threeCandidates(),
    timezone: "Europe/Zagreb",
    todayIsoDate: "2026-06-20",
    label: "Old Town",
  });

  const result = await generateAgnosticRecommendations({ ...basePayload, cityConfig });

  assert.equal(result.city, "agnostic-engine-area");
  // Honest readiness: a templateless place always needs source enrichment.
  assert.equal(result.readiness.signal, "source_enrichment_needed");
  assert.notEqual(result.readiness.status, "unsupported_city");

  const route = result.days[0].primary_route;
  assert.ok(route, "expected an agnostic-composed route from the supplied candidates");
  // The convergence proof: it is the ENGINE's agnostic_compose path, low confidence.
  assert.equal(route.routing_source, "agnostic_compose");
  assert.equal(route.confidence, "low");

  const stops = route.main_stops || [];
  assert.ok(stops.length >= 2, "agnostic compose must produce >= 2 real stops");
  // No geography leak: every stop is one of the supplied source candidates —
  // no invented POIs, no registered-city catalog bleeding in.
  const allowed = new Set(["agn-stop-1", "agn-stop-2", "agn-stop-3"]);
  stops.forEach((stop) => {
    assert.ok(allowed.has(stop.id), `stop ${stop.id || stop.name} is not a supplied source candidate`);
    assert.equal(stop.provisional, true, "every any-place stop must carry the provisional honesty marker");
  });
});

test("fewer than two viable candidates degrades to an honest null route, never invented", async () => {
  const cityConfig = buildAgnosticEngineCityConfig({
    anchor: ANCHOR,
    sourceCandidates: [sourceCandidate()],
    timezone: "Europe/Zagreb",
    todayIsoDate: "2026-06-20",
  });

  const result = await generateAgnosticRecommendations({ ...basePayload, cityConfig });
  assert.equal(result.days[0].primary_route, null, "one stop must not be padded into a fake route");
  assert.deepEqual(result.days[0].alternatives, []);
});

test("zero candidates degrades to an honest null route (no fabricated geography)", async () => {
  const cityConfig = buildAgnosticEngineCityConfig({
    anchor: ANCHOR,
    sourceCandidates: [],
    timezone: "Europe/Zagreb",
    todayIsoDate: "2026-06-20",
  });
  const result = await generateAgnosticRecommendations({ ...basePayload, cityConfig });
  assert.equal(result.days[0].primary_route, null);
});

test("cityConfigOverride is transparent: override path == registered-city resolve path", async () => {
  // The override seam must NOT alter engine behavior. Driving Athens (a thin
  // registered city) through the override produces the same route as resolving
  // it by key — proving registered-city behavior is byte-stable.
  const athensByKey = await generateRecommendations({ ...basePayload, city: "athens" });
  const athensByOverride = await generateAgnosticRecommendations({
    ...basePayload,
    cityConfig: getCityConfig("athens"),
  });

  assert.equal(athensByOverride.city, athensByKey.city);

  const byKeyRoute = athensByKey.days[0].primary_route;
  const byOverrideRoute = athensByOverride.days[0].primary_route;
  assert.equal(Boolean(byOverrideRoute), Boolean(byKeyRoute));
  if (byKeyRoute && byOverrideRoute) {
    assert.equal(byOverrideRoute.routing_source, byKeyRoute.routing_source);
    assert.equal(byOverrideRoute.confidence, byKeyRoute.confidence);
    assert.deepEqual(
      (byOverrideRoute.main_stops || []).map((s) => s.id),
      (byKeyRoute.main_stops || []).map((s) => s.id),
      "override path must order stops identically to the resolve path",
    );
  }
});
