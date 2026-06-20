const test = require("node:test");
const assert = require("node:assert/strict");

const { generateRecommendations } = require("../server/route-engine");
const { resetLiveEventsCache } = require("../server/live-events");
const { sourceCandidates: athensSourceCandidates } = require("../server/cities/athens/source-candidates");
const { allItems: athensCatalogItems } = require("../server/cities/athens/catalog");
const {
  normalizePlaceCandidate,
  validatePlaceCandidate,
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

test("thin registered city (Athens, zero templates) composes a low-confidence route from its own catalog", async () => {
  const result = await generateRecommendations({ ...basePayload, city: "athens" });

  assert.equal(result.city, "athens");
  assert.equal(result.readiness.resolved_city, "athens");
  assert.equal(result.readiness.fallback_used, false);
  assert.equal(result.readiness.catalog.route_template_count, 0);
  // Readiness stays honest: the city still needs source enrichment even though
  // we can now compose a usable walk from the thin catalog.
  assert.equal(result.readiness.signal, "source_enrichment_needed");
  assert.notEqual(result.readiness.status, "unsupported_city");

  const day = result.days[0];
  const route = day.primary_route;

  // Agnostic compose: a real, minimally coherent walk — never honest-empty here.
  assert.ok(route, "expected an agnostic-composed primary route for Athens");
  assert.equal(route.routing_source, "agnostic_compose");
  assert.equal(route.confidence, "low");

  const stops = route.main_stops || [];
  assert.ok(stops.length >= 2, "agnostic compose must produce at least 2 real stops");

  // No place leak: every stop is a genuine Athens catalog item — no fake POIs,
  // no Barcelona/Rome geography bleeding in.
  stops.forEach((stop) => {
    assert.ok(
      String(stop.id || "").startsWith("athens-"),
      `stop ${stop.id || stop.name} is not an Athens catalog item`,
    );
  });
});

test("Athens provisional source candidates conform to the place-candidate contract", () => {
  assert.ok(athensSourceCandidates.length > 0, "expected at least one provisional candidate");
  athensSourceCandidates.forEach((candidate) => {
    // Validate the shape we actually ship, and the normalized shape, so the
    // fixture cannot drift away from the shared contract vocabulary.
    validatePlaceCandidate(candidate, `athens-source-candidate:${candidate.id}`);
    const normalized = normalizePlaceCandidate(candidate);
    assert.equal(normalized.candidate_kind, "draft_place");
    assert.equal(normalized.city_pack_owned, false, "provisional candidates must not be city-pack owned");
    assert.equal(normalized.trust.human_verified, false, "provisional candidates must be unverified");
    assert.equal(normalized.trust.confidence, "needs_review");
    assert.ok(
      ["inferred", "fallback"].includes(normalized.trust.source_tier),
      "provisional source_tier must be inferred/fallback",
    );
    assert.ok(String(candidate.id).startsWith("athens-"), "provisional ids must be namespaced to athens");
  });
});

test("thin city compose supplements with clearly-marked provisional candidates, verified-first", async () => {
  // Anchor in the thin Koukaki-Makrygianni south where the verified pool runs
  // out, so provisional candidates can fill the leftover slots.
  const result = await generateRecommendations({
    ...basePayload,
    city: "athens",
    dates: ["2026-05-25"],
    start: { type: "custom", label: "Makrygianni", lat: 37.9688, lng: 23.7289 },
    end: { type: "custom", label: "Makrygianni", lat: 37.9688, lng: 23.7289 },
    preferences: ["kultur", "utsikt", "klassiker"],
  });

  // Readiness stays honest: provisional fill does NOT promote the city. The
  // verified item count is untouched; provisional sources are counted apart.
  assert.equal(result.readiness.signal, "source_enrichment_needed");
  assert.equal(result.readiness.catalog.route_template_count, 0);
  assert.equal(
    result.readiness.catalog.item_count,
    athensCatalogItems.length,
    "verified item count must not be inflated",
  );
  assert.equal(
    result.readiness.catalog.provisional_source_count,
    athensSourceCandidates.length,
    "provisional sources must be counted separately",
  );

  const route = result.days[0].primary_route;
  assert.ok(route, "expected a composed route");
  assert.equal(route.routing_source, "agnostic_compose");
  assert.equal(route.confidence, "low", "provisional fill must stay low confidence, not full citypack");
  assert.equal(route.uses_provisional_sources, true);

  const stops = route.main_stops || [];
  const provisionalStops = stops.filter((stop) => stop.provisional === true);
  const verifiedStops = stops.filter((stop) => stop.provisional !== true);

  // Provisional supplements, but verified items are still preferred and present.
  assert.ok(provisionalStops.length >= 1, "expected at least one provisional stop in a thin area");
  assert.ok(verifiedStops.length >= 1, "verified catalog items must remain in the route");

  // Route-level honesty count drives the "mostly provisional" UI signal and
  // must match the per-stop reality exactly.
  assert.equal(
    route.provisional_stop_count,
    provisionalStops.length,
    "provisional_stop_count must equal the number of provisional stops",
  );

  // No place leak and full provenance on every provisional stop.
  stops.forEach((stop) => {
    assert.ok(String(stop.id || "").startsWith("athens-"), `stop ${stop.id} is not an Athens place`);
  });
  provisionalStops.forEach((stop) => {
    assert.ok(stop.source && stop.source.kind, "provisional stop must carry its source");
    assert.equal(stop.trust.confidence, "needs_review");
    assert.equal(stop.trust.human_verified, false);
    assert.ok(stop.provenance && stop.provenance.source_note, "provisional stop must carry provenance");
  });

  // Verified stops never get the provisional marker — honesty is per-stop.
  verifiedStops.forEach((stop) => {
    assert.equal(stop.provisional, undefined, `verified stop ${stop.id} must not be marked provisional`);
  });
});

test("Athens second-hand source pack composes a single-intent vintage day", async () => {
  const result = await generateRecommendations({
    ...basePayload,
    city: "athens",
    dates: ["2026-06-20"],
    start: { type: "auto" },
    end: { type: "auto" },
    preferences: ["second_hand"],
  });

  assert.equal(result.readiness.signal, "source_enrichment_needed");
  assert.equal(
    result.readiness.catalog.provisional_source_count,
    athensSourceCandidates.length,
    "second-hand pack must stay in provisional source count, not verified catalog count",
  );

  const route = result.days[0].primary_route;
  assert.ok(route, "expected Athens second_hand to compose a route, not fall back to null");
  assert.equal(route.routing_source, "agnostic_compose");
  assert.equal(route.confidence, "low");
  assert.match(route.title, /second hand|vintage/i);

  const stops = route.main_stops || [];
  const provisionalVintageStops = stops.filter(
    (stop) => stop.provisional === true && (stop.tags || []).includes("second_hand"),
  );
  assert.ok(
    provisionalVintageStops.length >= 2,
    "expected provisional vintage-shop density to carry the second-hand day",
  );
  assert.ok(
    stops.some((stop) => stop.id === "athens-avissinias-flea-market" && (stop.tags || []).includes("second_hand")),
    "Avissinias should remain the verified flea-market spine for Athens second-hand",
  );
  assert.ok(
    stops.some((stop) => stop.id === "athens-kilo-shop-monastiraki" || stop.id === "athens-palaiopoleion-ton-athinon"),
    "Monastiraki second-hand pack stops should be available to the composed route",
  );
});

test("mature citypack never pulls provisional candidates (no source-candidate layer)", async () => {
  const result = await generateRecommendations({
    ...basePayload,
    city: "barcelona",
    preferences: ["vintage", "shopping", "lokalt"],
  });

  const route = result.days[0].primary_route;
  assert.ok(route);
  assert.notEqual(route.routing_source, "agnostic_compose");
  assert.ok(!route.uses_provisional_sources, "mature city route must not use provisional sources");
  assert.equal(route.provisional_stop_count, 0, "mature city route must have zero provisional stops");
  (route.main_stops || []).forEach((stop) => {
    assert.notEqual(stop.provisional, true, "no provisional stops in a mature citypack route");
  });
  assert.equal(result.readiness.catalog.provisional_source_count, 0);
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

  // Regression guard: readiness metadata did not break real planning, and a
  // mature citypack still routes via its curated templates — never the
  // agnostic-compose fallback.
  assert.ok(result.days[0].primary_route);
  assert.ok((result.days[0].primary_route.main_stops || []).length > 0);
  assert.notEqual(result.days[0].primary_route.routing_source, "agnostic_compose");
});

test("omitted city keeps the default-city plan (no false unsupported)", async () => {
  const result = await generateRecommendations({ ...basePayload });

  assert.equal(result.readiness.fallback_used, false);
  assert.notEqual(result.readiness.status, "unsupported_city");
  assert.ok(result.days[0].primary_route);
});
