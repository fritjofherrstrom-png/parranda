const test = require("node:test");
const assert = require("node:assert/strict");

const {
  generateAgnosticRecommendations,
  generateRecommendations,
  composeStopDaypartSlot,
  applyAgnosticDaypartOrder,
} = require("../server/route-engine");
const { getCityConfig } = require("../server/cities");
const { resetLiveEventsCache } = require("../server/live-events");
const { buildAgnosticEngineCityConfig } = require("../server/planner/agnostic-engine-compose");

// --- unit: composeStopDaypartSlot ------------------------------------------

test("composeStopDaypartSlot reads roles off the stop, else resolves by id", () => {
  assert.equal(composeStopDaypartSlot({ route_roles: ["coffee_fika_stop"] }), 0);
  assert.equal(composeStopDaypartSlot({ route_roles: ["evening_bar_option"] }), 3);
  // the EARLIEST slot among multiple roles wins (a stop usable earlier sorts earlier)
  assert.equal(composeStopDaypartSlot({ route_roles: ["evening_bar_option", "coffee_fika_stop"] }), 0);
  // no roles on the stop → resolve via the id→roles map
  const roleById = new Map([["x1", ["food_anchor"]]]);
  assert.equal(composeStopDaypartSlot({ id: "x1" }, roleById), 2);
  // no roles anywhere → null (nothing to sequence by)
  assert.equal(composeStopDaypartSlot({ id: "unknown" }, roleById), null);
  assert.equal(composeStopDaypartSlot({}), null);
});

// --- unit: applyAgnosticDaypartOrder ---------------------------------------

const flatGeom = () => ({ estimatedKm: 3 });
// geomFor that always reports the SAME cheap distance → daypart order is walkable
const cheapGeomFor = () => ({ estimatedKm: 3 });

function stop(id, roles, lat = 0, lng = 0) {
  return { id, name: id, route_roles: roles, lat, lng };
}

test("reorders geometry-optimal stops into a morning→evening daypart arc", () => {
  // geometry order is bar, coffee, food — daypart should make it coffee, food, bar
  const ordered = [stop("bar", ["evening_bar_option"]), stop("coffee", ["coffee_fika_stop"]), stop("food", ["food_anchor"])];
  const out = applyAgnosticDaypartOrder(ordered, flatGeom(), cheapGeomFor);
  assert.equal(out.applied, true);
  assert.equal(out.fallback, false);
  assert.equal(out.reason, "daypart_rhythm");
  assert.deepEqual(out.stops.map((s) => s.id), ["coffee", "food", "bar"]);
});

test("preserves geometry order WITHIN a slot (stable sort = proximity kept)", () => {
  // two daytime (slot 1) stops in geometry order A then B must keep A,B
  const ordered = [stop("scenicA", ["scenic_anchor"]), stop("scenicB", ["culture_stop"]), stop("coffee", ["coffee_fika_stop"])];
  const out = applyAgnosticDaypartOrder(ordered, flatGeom(), cheapGeomFor);
  assert.deepEqual(out.stops.map((s) => s.id), ["coffee", "scenicA", "scenicB"]);
});

test("falls back to geometry order when the daypart order breaks the walk budget", () => {
  // The geometry chain walks west→east. A hard role sort would jump east,
  // double back, then jump west again. The hidden anchor-loop geometry supplied
  // by geomFor claims it is cheap; the selected-stop chain must still veto it.
  const ordered = [
    stop("bar", ["evening_bar_option"], 55.6, 13.0),
    stop("coffee", ["coffee_fika_stop"], 55.6, 13.01),
    stop("food", ["food_anchor"], 55.6, 13.02),
    stop("scenic", ["scenic_anchor"], 55.6, 13.03),
  ];
  const geomFor = () => ({ estimatedKm: 3 });
  const out = applyAgnosticDaypartOrder(ordered, { estimatedKm: 3 }, geomFor);
  assert.equal(out.applied, false);
  assert.equal(out.fallback, true);
  assert.equal(out.reason, "daypart_order_exceeded_walk_budget");
  assert.deepEqual(out.stops.map((s) => s.id), ["bar", "coffee", "food", "scenic"], "geometry order preserved");
});

test("no role metadata anywhere → geometry order stands, no reorder", () => {
  const ordered = [stop("a", []), stop("b", [])];
  const out = applyAgnosticDaypartOrder(ordered, flatGeom(), cheapGeomFor);
  assert.equal(out.applied, false);
  assert.equal(out.reason, "no_role_metadata");
  assert.deepEqual(out.stops.map((s) => s.id), ["a", "b"]);
});

test("accepts a geometry-neutral daypart tie-break", () => {
  const ordered = [
    stop("bar", ["evening_bar_option"], 55.6, 13.0),
    stop("coffee", ["coffee_fika_stop"], 55.6, 13.001),
    stop("food", ["food_anchor"], 55.6, 13.0005),
  ];
  const geomFor = () => ({ estimatedKm: 0.2 });
  const out = applyAgnosticDaypartOrder(ordered, { estimatedKm: 0.2 }, geomFor);
  assert.equal(out.applied, true);
  assert.deepEqual(out.stops.map((s) => s.id), ["coffee", "food", "bar"]);
});

// --- integration: through the engine ---------------------------------------

const originalFetch = global.fetch;
test.before(() => {
  global.fetch = async (url) => {
    const parsed = new URL(String(url));
    if (parsed.hostname === "api.open-meteo.com") {
      return {
        ok: true,
        async json() {
          return {
            daily: { time: ["2026-06-20"], weathercode: [0], temperature_2m_max: [24], temperature_2m_min: [15] },
            current: { temperature_2m: 20, weather_code: 0, is_day: 1 },
          };
        },
        async text() { return "{}"; },
      };
    }
    return { ok: true, async text() { return "<div></div>"; }, async json() { return { items: [] }; } };
  };
});
test.after(() => { global.fetch = originalFetch; });
test.afterEach(() => resetLiveEventsCache());

function srcCandidate(id, roles, lat, lng) {
  return {
    id, city: "agnostic-engine-area", label: id, type: "place", candidate_kind: "draft_place",
    city_pack_owned: false, lat, lng, route_roles: roles,
    source: { kind: "open_geo_source", label: "OpenStreetMap", url: "https://osm.org/" + id },
    trust: { source_tier: "inferred", confidence: "needs_review", human_verified: false, freshness: "unknown" },
    confidence: "needs_review", freshness: "unknown",
    provenance: { why_included: "src", weatherTags: [] },
  };
}

const basePayload = {
  dates: ["2026-06-20"], start: { type: "auto" }, end: { type: "auto" },
  walkingKmTarget: 6, preferences: [], legPacing: "balanced",
  distanceMode: "soft_target", budgetTier: "standard", lang: "en",
};

test("engine agnostic_compose attaches a daypart arc + per-stop labels for role-bearing candidates", async () => {
  // A compact cluster so the daypart reorder stays within the walk budget.
  const cityConfig = buildAgnosticEngineCityConfig({
    anchor: { lat: 43.5096, lng: 16.4397 },
    timezone: "Europe/Zagreb",
    todayIsoDate: "2026-06-20",
    sourceCandidates: [
      srcCandidate("agn-bar", ["evening_bar_option"], 43.5101, 16.4402),
      srcCandidate("agn-coffee", ["coffee_fika_stop"], 43.5097, 16.4399),
      srcCandidate("agn-food", ["food_anchor"], 43.5089, 16.4408),
    ],
  });
  const result = await generateAgnosticRecommendations({ ...basePayload, cityConfig });
  const route = result.days[0].primary_route;
  assert.ok(route, "expected an agnostic-composed route");
  assert.equal(route.routing_source, "agnostic_compose");
  assert.ok(route.agnostic_daypart_ordering, "expected daypart ordering metadata");
  assert.ok(Array.isArray(route.daypart_arc), "expected a daypart_arc");
  // Every role-bearing stop carries a daypart label, and the arc is non-decreasing
  // (morning → evening), never an evening stop before a morning one.
  const RANK = { morning: 0, midday: 1, afternoon: 2, evening: 3 };
  const ranks = route.main_stops
    .map((s) => s.daypart)
    .filter((d) => d != null)
    .map((d) => RANK[d]);
  for (let i = 1; i < ranks.length; i += 1) {
    assert.ok(ranks[i] >= ranks[i - 1], `daypart arc must be non-decreasing, got ${ranks}`);
  }
});

test("a templated registered city never gets the agnostic daypart post-pass", async () => {
  // The post-pass is gated to the agnostic-compose template. A curated city with
  // real route templates (Rome) must keep its pure geometry order — no daypart
  // arc, no ordering metadata. (Thin templateless cities legitimately DO use
  // agnostic_compose; the invariant is specifically about templated routes.)
  const rome = await generateRecommendations({ ...basePayload, city: "rome", dates: ["2026-06-20"] });
  const romeRoute = rome.days[0].primary_route;
  assert.ok(romeRoute, "rome should compose a route");
  assert.equal(romeRoute.agnostic_daypart_ordering, undefined, "templated city must not get the agnostic daypart post-pass");
  assert.equal(romeRoute.daypart_arc, undefined);
});
