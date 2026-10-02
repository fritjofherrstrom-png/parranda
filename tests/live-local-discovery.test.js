"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { executeLiveEventQuery } = require("../server/place-candidates/live-event-query");
const { resolveDefaultEventSupply, buildScopedEventSourcePlan } = require("../server/place-candidates/agnostic-event-supply");
const { buildLocalEventDiscoveryQueryPlan } = require("../server/pulse-sources/local-event-source-scout");
const { discoveryLocaleForCountryCode } = require("../server/pulse-sources/source-discovery-locales");

const anchor = { lat: 48.1, lng: 16 };
const bounds = { south: 47.95, north: 48.25, west: 15.8, east: 16.2 };
const spatialScope = { source: "resolver_bounds", kind: "settlement", bounds };
const now = "2026-09-30T12:00:00Z";
function resolverRow(overrides = {}) {
  return { ...anchor, label: "Harbour City, Local County, Austria", confidence: "medium",
    provenance: "nominatim_osm", spatial_scope: spatialScope,
    admin_context: { locality: "Harbour City", region: "Local County", country: "Austria", country_code: "at" }, ...overrides };
}
const payload = (scope = "around_place") => ({ scope, anchor, place_query: "Harbour City", selected_date: "2026-09-30", time: "this_week" });
const collection = (events = []) => ({ coverage: "covered", tonight: [], this_week: events, acquisition: { source_health: { status: "healthy", result: "events_found" } } });

test("an uncovered large settlement queues resolver-owned discovery without widening the local event gate", async () => {
  let demand;
  let supplied;
  const supply = resolveDefaultEventSupply({ PARRANDA_AGNOSTIC_EVENTS: "enabled" }, { sourceCatalog: {
    listApprovedEventFeedsForAnchor: async () => [],
    recordScoutDemand: async (value) => { demand = value; return { status: "recorded" }; },
  } });
  const result = await executeLiveEventQuery({ payload: { ...payload(), place_context: { country_code: "xx" }, spatial_scope: { kind: "region" } },
    now, placeResolver: async () => [resolverRow()], eventSupply: async (input) => { supplied = input; return supply(input); } });
  assert.equal(result.status, 200);
  assert.equal(result.body.live_events.acquisition.discovery_health.status, "pending");
  assert.equal(demand.placeContext.country_code, "at");
  assert.equal(demand.placeLabel, resolverRow().label);
  assert.deepEqual(demand.spatialScope.bounds, bounds);
  assert.equal(supplied.spatialScope, undefined, "discovery bounds never widen ordinary around-place geometry");
  assert.equal(supplied.radiusM, 3000);
  assert.equal(result.body.query.discovery_scope, "local");
});

test("near-me discovery uses trusted reverse context without moving GPS or widening the radius", async () => {
  let supplied;
  const resolver = async () => { throw new Error("forward lookup must not run"); };
  resolver.resolveCoordinates = async (coords) => { assert.deepEqual(coords, anchor); return resolverRow(); };
  const result = await executeLiveEventQuery({ payload: { scope: "near_me", anchor, place_query: "Injected place" }, now,
    placeResolver: resolver, eventSupply: async (input) => { supplied = input; return collection(); } });
  assert.equal(result.status, 200);
  assert.deepEqual(supplied.anchor, anchor);
  assert.equal(supplied.placeContext.country_code, "at");
  assert.deepEqual(supplied.discoverySpatialScope.bounds, bounds);
  assert.equal(supplied.radiusM, 2000);
  assert.equal(supplied.spatialScope, undefined);
});

test("whole-area Live keeps exact in-area occurrences outside 3 km and rejects outside/mapless evidence", async () => {
  let supplied;
  const result = await executeLiveEventQuery({ payload: payload("in_place"), now,
    placeResolver: async () => [resolverRow()], eventSupply: async (input) => {
      supplied = input;
      return collection([
        { id: "local", lat: 48.101, lng: 16 },
        { id: "other-neighbourhood", lat: 48.18, lng: 16 },
        { id: "outside-rectangle", lat: 48.1, lng: 16.25 },
        { id: "no-point", source_scope_verified: true, geographic_relevance: "source_scope" },
      ]);
    } });
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.live_events.this_week.map(e => e.id), ["local", "other-neighbourhood"]);
  assert.equal(result.body.live_events.this_week[1].live_proximity, "in_place");
  assert.ok(result.body.live_events.this_week[1].anchor_distance_km > 8);
  assert.equal(result.body.query.discovery_scope, "resolved_area");
  assert.equal(result.body.query.radius_m, supplied.radiusM);
  assert.ok(supplied.radiusM > 10000 && supplied.radiusM < 40000);
  assert.equal(supplied.spatialScope, undefined);
  assert.equal(result.body.route_mutation, false);
  assert.equal(result.body.day_anchor_mutation, false);
});

test("whole-area scope cannot be minted by injected bounds, detached matches or ambiguous place resolution", async () => {
  for (const resolver of [null, async () => [resolverRow({ lat: 49 })], async () => [resolverRow(), resolverRow({ label: "Other city", lat: 49 })]]) {
    let supplyCalls = 0;
    const result = await executeLiveEventQuery({ payload: { ...payload("in_place"), trusted_place_scope: spatialScope, spatial_scope: spatialScope, radius_m: 999999 },
      now, placeResolver: resolver, eventSupply: async () => { supplyCalls++; return collection(); } });
    assert.equal(result.status, 400);
    assert.equal(result.body.error, "place_scope_unavailable");
    assert.equal(supplyCalls, 0);
  }
  const missing = await executeLiveEventQuery({ payload: { scope: "in_place", anchor }, eventSupply: async () => collection() });
  assert.equal(missing.body.error, "in_place_requires_place_query");
});

test("broad regions and oversized city bounds cannot become whole-area Live requests", async () => {
  for (const scope of [
    { ...spatialScope, kind: "region" },
    { ...spatialScope, bounds: { south: 47, north: 49, west: 15, east: 17 } },
  ]) {
    const result = await executeLiveEventQuery({ payload: payload("in_place"), now, placeResolver: async () => [resolverRow({ spatial_scope: scope })],
      eventSupply: async () => { assert.fail("unsupported area must not fetch sources"); } });
    assert.equal(result.body.error, "place_scope_unavailable");
  }
});

test("whole-area source selection can see a small approved calendar away from the anchor and area corners", () => {
  const feed = { id: "local-hall", bbox: [16.05, 48.14, 16.08, 48.17], endpoint: "https://hall.example/events", source_identity: "hall.example",
    status: "active", runtime_policy: "bounded_refresh", adapter: "schema_org_html" };
  assert.deepEqual(buildScopedEventSourcePlan({ anchor, registry: [feed] }), []);
  const sources = buildScopedEventSourcePlan({ anchor, sourceBounds: bounds, registry: [feed, { ...feed, id: "unreviewed", status: "review-needed" }] });
  assert.deepEqual(sources.map(s => s.id), ["local-hall"]);
  assert.ok(sources.length <= 4);
});

test("whole-area supply loads off-centre approved catalog feeds and forwards their bounds to the warmer", async () => {
  let readScope;
  let warmed;
  const supply = resolveDefaultEventSupply({ PARRANDA_AGNOSTIC_EVENTS: "enabled" }, {
    sourceCatalog: {
      listApprovedEventFeedsForAnchor: async () => [],
      listApprovedEventFeedsForScope: async ({ spatialScope: scope }) => {
        readScope = scope;
        return [{ id: "local-hall", label: "Local Hall", bbox: [16.05, 48.14, 16.08, 48.17],
          endpoint: "https://hall.example/events", adapter: "schema_org_html", status: "active", runtime_policy: "bounded_refresh" }];
      },
    },
    eventCache: { peek: () => null, warm: async (_key, load) => load() },
    collectEvents: async (input) => { warmed = input; return collection(); },
  });
  const result = await supply({ anchor, radiusM: 22000, now,
    scope: { kind: "in_place", anchor, radius_m: 22000, trusted_place_scope: spatialScope } });
  assert.deepEqual(readScope.bounds, bounds);
  assert.deepEqual(result.feeds.map(feed => feed.id), ["local-hall"]);
  assert.deepEqual(warmed.sourceBounds, bounds);
  assert.equal(warmed.radiusM, 22000);
});

test("independent approved calendar and venue families do not request redundant complementary scouting", async () => {
  let demands = 0;
  const feeds = [
    { id: "official", source_family: "official_municipal_calendar", source_identity: "city.example" },
    { id: "venue", source_family: "venue_owned_calendar", source_identity: "venue.example" },
  ].map(feed => ({ ...feed, label: feed.id, adapter: "schema_org_html", endpoint: `https://${feed.source_identity}/events`,
    bbox: [15.8, 47.95, 16.2, 48.25], status: "active", runtime_policy: "bounded_refresh" }));
  const supply = resolveDefaultEventSupply({ PARRANDA_AGNOSTIC_EVENTS: "enabled", PARRANDA_EVENT_FEEDS: JSON.stringify(feeds) }, {
    sourceCatalog: { recordScoutDemand: async () => { demands++; return { status: "recorded" }; } },
    eventCache: { peek: () => null, warm: () => {} },
  });
  const result = await supply({ anchor, now, placeLabel: "Harbour City", placeContext: resolverRow().admin_context, discoverySpatialScope: spatialScope });
  assert.equal(result.coverage, "covered");
  assert.equal(demands, 0);
});

test("European local festivities survive a full ordinary vocabulary budget and stay tied to the locality", () => {
  for (const country of ["es", "it", "hr", "mt", "hu", "gb"]) {
    const locale = discoveryLocaleForCountryCode(country);
    const plan = buildLocalEventDiscoveryQueryPlan({ place: { name: "Harbour City", label: "Harbour City, County, Country", region_terms: ["Country"], ...locale },
      intentHints: ["music", "food", "culture", "art", "shopping"] });
    const rhythm = plan.filter(q => q.query_family === "local_rhythm");
    assert.equal(rhythm.length, 2, country);
    assert.ok(rhythm.every(q => q.label_scope === "locality" && q.query.startsWith("Harbour City ")));
    assert.ok(plan.some(q => q.query.endsWith(" events")), "generic calendars remain represented");
    assert.ok(plan.length <= 18);
  }
});
