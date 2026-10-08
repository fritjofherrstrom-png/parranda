"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const { createHmac } = require("node:crypto");
const { mapFeature, createPlaceSuggestions } = require("../server/place-candidates/place-suggestions");
const { createPlaceSelectionStore } = require("../server/place-candidates/place-selection");
const { resolveAgnosticIntake } = require("../server/planner/agnostic-place-intake");
const { executeLiveEventQuery } = require("../server/place-candidates/live-event-query");
const { createSourceProfileCatalog, UPSERT_SCOUT_TARGET_SQL } = require("../server/pulse-sources/source-profile-catalog");
const { resolveDefaultEventSupply } = require("../server/place-candidates/agnostic-event-supply");
const { buildApp } = require("../server/app");
const { requestJson, makeLoader } = require("./helpers/planner-reservoir-compare");

const now = "2026-10-08T02:19:03Z";
const feature = { type: "Feature", geometry: { type: "Point", coordinates: [17.6387436, 59.8586126] },
  properties: { name: "Uppsala", county: "Uppsala län", country: "Sverige", countrycode: "se", type: "city", osm_key: "place", osm_value: "city", osm_type: "N", osm_id: 25735371 } };
const choice = mapFeature(feature);
const anchor = { lat: choice.candidate.lat, lng: choice.candidate.lng };

test("malformed Photon extents remain unusable after signing and reading a selected point", async () => {
  for (const extent of [[], [17.6, 59.9, "bad", 59.8], [17.7, 59.8, 17.6, 59.9]]) {
    const mapped = mapFeature({ ...feature, properties: { ...feature.properties, extent } });
    const store = createPlaceSelectionStore();
    const token = store.issue(mapped.candidate, mapped.query);
    const result = await resolveAgnosticIntake({ placeQuery: mapped.query, placeSelection: token, placeSelectionStore: store });
    assert.deepEqual(result.anchor, anchor, "usable point identity survives bad area metadata");
    assert.equal(result.spatialScope, null);
    assert.equal(result.discoverySpatialScope, null, "bad provider bounds cannot turn into absent bounds through a receipt");
  }
});

test("legacy point receipts preserve identity and ordinary Live while declining new aperture attestation", async () => {
  const secret = Buffer.alloc(32, 1);
  const clock = () => Date.parse(now);
  const store = createPlaceSelectionStore({ secret, now: clock });
  const data = Buffer.from(JSON.stringify({ v: 1, q: choice.query.toLowerCase(), exp: clock() + 10000, selected: choice.candidate })).toString("base64url");
  const token = `${data}.${createHmac("sha256", secret).update(data).digest("base64url")}`;
  const result = await resolveAgnosticIntake({ placeQuery: choice.query, placeSelection: token, placeSelectionStore: store });
  assert.deepEqual(result.anchor, anchor);
  assert.equal(result.discoverySpatialScope, null);
  let supplied;
  const live = await executeLiveEventQuery({ payload: { scope: "around_place", anchor, place_query: choice.query, place_selection: token }, now,
    placeSelectionStore: store, eventSupply: async (input) => { supplied = input; return { coverage: "uncovered", tonight: [], this_week: [], acquisition: {} }; } });
  assert.equal(live.status, 200);
  assert.deepEqual(supplied.anchor, anchor);
  assert.equal(supplied.placeContext.country_code, "se");
  assert.equal(supplied.discoverySpatialScope, null);
  assert.equal(supplied.radiusM, 3000);
});

test("fresh suggestion receipt reaches the actual catalog queue from Planner and Live without re-geocoding", async () => {
  const writes = [];
  const catalog = createSourceProfileCatalog({ now: () => new Date(now), query: async (sql, values) => {
    // Approved-feed reads remain empty; queue writes use the real catalog mapper.
    if (sql === UPSERT_SCOUT_TARGET_SQL) {
      writes.push(values);
      return { rows: [{ target_key: values[0], status: "pending", observation_count: 1 }] };
    }
    return { rows: [] };
  } });
  const supply = resolveDefaultEventSupply({ PARRANDA_AGNOSTIC_EVENTS: "enabled" }, { sourceCatalog: catalog,
    eventCache: { peek: () => null, warm: () => {} } });
  const store = createPlaceSelectionStore();
  let lookups = 0;
  const server = buildApp({ placeSelectionStore: store, placeResolver: async () => { lookups++; throw new Error("selected identity must bypass lookup"); },
    placeSuggestions: createPlaceSuggestions({ minIntervalMs: 0, fetcher: async () => ({ ok: true, json: async () => ({ features: [feature] }) }) }),
    openDataLoader: makeLoader([]), reviewedPlaceSource: null, sourceCatalog: catalog, eventSupply: supply, weatherProvider: async () => null,
    clock: { now: () => now } }).listen(0);
  try {
    const suggestions = await requestJson(server, { path: "/api/place-suggestions?lang=sv", body: { query: "Uppsala" } });
    const selected = suggestions.body.choices[0];
    const plan = await requestJson(server, { path: "/api/route-recommendations?lang=sv", body: { place: selected.query, place_selection: selected.selection_id,
      dates: ["2026-10-08"], preferences: ["fika", "culture"], day_rhythm: "balanced", experimental_agnostic_route_output: true,
      agnostic_engine_compose: true, include_external_candidates: true, spatial_scope: { bounds: {} }, place_context: { country_code: "xx" } } });
    assert.equal(plan.status, 200);
    assert.equal(plan.body.live_events.acquisition.discovery_health.status, "pending");
    assert.equal(writes.length, 1);
    const firstKey = writes[0][0];
    assert.equal(JSON.parse(writes[0][9]).source, "trusted_point_aperture");
    const live = await executeLiveEventQuery({ payload: { scope: "around_place", anchor, place_query: selected.query, place_selection: selected.selection_id },
      placeSelectionStore: store, eventSupply: supply, now });
    assert.equal(live.status, 200);
    assert.equal(live.body.live_events.acquisition.discovery_health.status, "pending");
    assert.equal(writes.length, 2);
    assert.equal(writes[1][0], firstKey, "same attested geometry deduplicates through the persisted target key");
    assert.equal(lookups, 0);
    assert.doesNotMatch(JSON.stringify(plan.body), /trusted_point_aperture|spatial_scope_invalid|discovery_aperture_unavailable/);
  } finally {
    await new Promise((done) => server.close(done));
  }
});
