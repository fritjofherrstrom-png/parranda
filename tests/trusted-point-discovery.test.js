"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { resolveAgnosticIntake } = require("../server/planner/agnostic-place-intake");
const { pointWithinTrustedSpatialScope } = require("../server/place-candidates/spatial-scope");
const { createSourceProfileCatalog } = require("../server/pulse-sources/source-profile-catalog");
const { executeLiveEventQuery } = require("../server/place-candidates/live-event-query");
const { buildApp } = require("../server/app");
const { makeLoader, requestJson, mockStableWeatherFetch } = require("./helpers/planner-reservoir-compare");

const NOW = "2026-10-08T02:19:03Z";
// Sanitized point/context observed in Hermes's bf91fa9 cold run. No receipt/key.
const observed = {
  lat: 59.8586126, lng: 17.6387436, label: "Uppsala, Uppsala län, Sverige",
  confidence: "medium", provenance: "photon_osm",
  admin_context: { county: "Uppsala län", country: "Sverige", country_code: "se" },
};
const point = (row = observed) => ({ lat: row.lat, lng: row.lng });
const resolve = (row = observed) => resolveAgnosticIntake({ placeQuery: row.label, placeResolver: async () => [row] });
const collection = () => ({ coverage: "uncovered", tonight: [], this_week: [], acquisition: {} });

test("trusted points without area bounds queue bounded discovery without claiming a place area", async () => {
  for (const row of [observed, { ...observed, lat: -33.9, lng: 18.4, label: "Other settlement", admin_context: { locality: "Other settlement", country: "South Africa", country_code: "za" } }]) {
    const result = await resolve(row);
    assert.equal(result.spatialScope, null);
    assert.equal(result.discoverySpatialScope.source, "trusted_point_aperture");
    assert.equal(result.discoverySpatialScope.kind, "unknown");
    assert.equal(result.discoverySpatialScope.collection_mode, "local_anchor");
    assert.ok(result.discoverySpatialScope.diagonal_km <= 15);
    assert.ok(pointWithinTrustedSpatialScope(result.anchor, result.discoverySpatialScope));
    assert.doesNotMatch(JSON.stringify(result.intake), /bounds|aperture|discoverySpatialScope/);
    const writes = [];
    const catalog = createSourceProfileCatalog({ now: () => new Date(NOW), query: async (sql, values) => {
      writes.push(values); return { rows: [{ target_key: values[0], status: "pending", observation_count: 1 }] };
    } });
    const demand = { anchor: result.anchor, placeLabel: result.intake.resolved.label, placeContext: result.placeContext, spatialScope: result.discoverySpatialScope };
    assert.equal((await catalog.recordScoutDemand(demand)).status, "recorded");
    assert.equal(writes.length, 1);
    assert.deepEqual(JSON.parse(writes[0][9]), result.discoverySpatialScope);
  }
});

test("contextless and country-only points cannot mint a discovery aperture", async () => {
  for (const admin_context of [null, {}, { country: "Sweden", country_code: "se" }, { county: "County", country_code: "invalid" }]) {
    assert.equal((await resolve({ ...observed, admin_context })).discoverySpatialScope, null);
  }
  const untrusted = await resolveAgnosticIntake({ coords: point(), placeQuery: observed.label, admin_context: observed.admin_context, spatialScope: { bounds: {} } });
  assert.equal(untrusted.discoverySpatialScope, null, "public context-like arguments cannot establish identity");
});

test("weak, ambiguous and invalid resolved points never start discovery", async () => {
  for (const rows of [[{ ...observed, confidence: "low" }], [observed, { ...observed, label: "Other" }], [{ ...observed, lat: 999 }]]) {
    const result = await resolveAgnosticIntake({ placeQuery: observed.label, placeResolver: async () => rows });
    assert.equal(result.anchor, null);
    assert.ok(!result.discoverySpatialScope);
  }
});

test("provider bounds remain authoritative and malformed or detached bounds do not get a guessed replacement", async () => {
  const scope = { source: "provider_bounds", kind: "settlement", bounds: { south: 59.8, north: 59.9, west: 17.6, east: 17.7 } };
  const bounded = await resolve({ ...observed, spatial_scope: scope });
  assert.deepEqual(bounded.discoverySpatialScope, bounded.spatialScope);
  for (const spatial_scope of [{ ...scope, bounds: {} }, { ...scope, bounds: { south: 10, north: 11, west: 10, east: 11 } }]) {
    assert.equal((await resolve({ ...observed, spatial_scope })).discoverySpatialScope, null);
  }
});

test("trusted reverse context can scope discovery while GPS remains fixed", async () => {
  const resolver = async () => { throw new Error("forward lookup must not run"); };
  resolver.resolveCoordinates = async () => observed;
  const result = await resolveAgnosticIntake({ coords: point(), placeResolver: resolver });
  assert.deepEqual(result.anchor, point());
  assert.equal(result.spatialScope, null);
  assert.ok(pointWithinTrustedSpatialScope(point(), result.discoverySpatialScope));
});

test("point apertures remain bounded at coordinate limits", async () => {
  for (const coordinates of [{ lat: 89.999, lng: 179.999 }, { lat: -90, lng: -180 }]) {
    const result = await resolve({ ...observed, ...coordinates });
    assert.ok(pointWithinTrustedSpatialScope(coordinates, result.discoverySpatialScope));
    assert.ok(result.discoverySpatialScope.diagonal_km <= 15);
  }
});

test("around-place and near-me Live forward point discovery without changing ordinary event geography", async () => {
  const resolver = async () => [observed];
  resolver.resolveCoordinates = async () => observed;
  for (const [scope, radius] of [["around_place", 3000], ["near_me", 2000]]) {
    let supplied;
    const result = await executeLiveEventQuery({ payload: { scope, anchor: point(), place_query: observed.label }, now: NOW, placeResolver: resolver,
      eventSupply: async (input) => { supplied = input; return collection(); } });
    assert.equal(result.status, 200);
    assert.ok(supplied.discoverySpatialScope);
    assert.equal(supplied.discoverySpatialScope.source, "trusted_point_aperture");
    assert.equal(supplied.spatialScope, undefined);
    assert.equal(supplied.radiusM, radius);
    assert.equal(result.body.query.discovery_scope, "local");
  }
});

test("a point aperture is never sufficient for whole-place Live", async () => {
  let calls = 0;
  const result = await executeLiveEventQuery({ payload: { scope: "in_place", anchor: point(), place_query: observed.label }, now: NOW,
    placeResolver: async () => [observed], eventSupply: async () => { calls++; return collection(); } });
  assert.equal(result.status, 400);
  assert.equal(result.body.error, "place_scope_unavailable");
  assert.equal(calls, 0);
});

test("Live rejects injected discovery context and detached resolver points", async () => {
  for (const placeResolver of [null, async () => [{ ...observed, lat: 55 }]]) {
    let supplied;
    await executeLiveEventQuery({ payload: { scope: "around_place", anchor: point(), place_query: observed.label, place_context: observed.admin_context,
      discoverySpatialScope: { source: "trusted_point_aperture", bounds: {} } }, now: NOW, placeResolver,
      eventSupply: async (input) => { supplied = input; return collection(); } });
    assert.equal(supplied.discoverySpatialScope, undefined);
    assert.equal(supplied.placeContext, undefined);
  }
});

test("flagged Planner forwards private point discovery but not route area or public bounds", async () => {
  const originalFetch = global.fetch;
  global.fetch = mockStableWeatherFetch();
  let supplied;
  const server = buildApp({ openDataLoader: makeLoader([]), placeResolver: async () => [observed], sourceCatalog: null, reviewedPlaceSource: null,
    eventSupply: async (input) => { supplied = input; return collection(); } }).listen(0);
  try {
    const result = await requestJson(server, { path: "/api/route-recommendations?lang=sv&experimental_agnostic_route_output=1", body: {
      city: "unknown-place", place: observed.label, dates: ["2026-10-08"], preferences: ["fika", "culture"], include_external_candidates: 1,
      discoverySpatialScope: { bounds: {} }, place_context: { country_code: "xx" },
    } });
    assert.equal(result.status, 200);
    assert.equal(supplied.spatialScope, null);
    assert.equal(supplied.discoverySpatialScope.source, "trusted_point_aperture");
    assert.equal(supplied.placeContext.country_code, "se");
    assert.doesNotMatch(JSON.stringify(result.body), /trusted_point_aperture|discoverySpatialScope/);
    assert.deepEqual(result.body.days, [], "a discovery aperture alone never provides a route");
  } finally {
    await new Promise((done) => server.close(done));
    global.fetch = originalFetch;
  }
});
