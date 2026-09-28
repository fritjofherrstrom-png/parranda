"use strict";

/**
 * Dense-centre supply: any-place days must be able to use the walking budget.
 *
 * Field evidence (docs/VISIT_SWEDEN_NAPI_ACCEPTANCE.md, BOUNDED_WALKING_FIT_
 * SELECTION.md) repeatedly showed 0.4-2.3 km days for 4-9 km requests, with
 * exactly 80 directory records. Offline replay of a synthetic dense centre
 * reproduced the mechanisms:
 *
 *  1. the directory sampled the 600 travel places NEAREST the anchor, which in
 *     a dense centre lie within a few hundred metres, whatever budget was asked;
 *  2. a warm directory (or other warm background source) answered alone while
 *     the map primary was never asked, so a changed walking budget or pick
 *     served a background-only day — including warm Wikidata alone, as an
 *     independent Pi trace of a public Göteborg/second-hand request showed;
 *  3. a single requested intent could never form a day from single-source
 *     supply: one experimentally admitted place, then nothing.
 *
 * SYNTHETIC GEOGRAPHY, deterministic, no network. It proves the generic
 * mechanisms, not any real city's supply; live acceptance is separate.
 */

const assert = require("node:assert/strict");
const http = require("node:http");
const { test, before, after } = require("node:test");

const fx = require("./helpers/dense-centre-fixture");
const { createOvertureSource } = require("../server/place-candidates/overture-source");
const {
  composeOpenDataLoaders,
  createOpenDataLoader,
} = require("../server/place-candidates/open-data-loader");
const { createSourceCache } = require("../server/place-candidates/source-cache");
const { createBackgroundSource, SOURCE_COMPLETION } = require("../server/place-candidates/background-source");
const { buildApp } = require("../server/app");
const { requestJson, mockStableWeatherFetch } = require("./helpers/planner-reservoir-compare");

const RELEASE = "2026-09-17.0";
const ORIGINAL_FETCH = global.fetch;
let dense;
let densePlaces;

before(async () => {
  densePlaces = fx.generatePlaces();
  dense = await fx.createOvertureQueryRows(densePlaces);
  global.fetch = mockStableWeatherFetch();
});

after(() => {
  dense?.close();
  global.fetch = ORIGINAL_FETCH;
});

function directorySource(queryRows = dense.queryRows) {
  return createOvertureSource({ queryRows, releaseResolver: async () => RELEASE });
}

// A directory whose cache is warm: it answers each request at once from the
// real adapter, with the request's own preferences and walking budget.
function warmDirectory(source) {
  const forRequest = (anchor, request = {}) => source({
    ...anchor,
    requestedIntents: request.requestedIntents,
    walkingTargetBand: request.walkingTargetBand,
  });
  return { eager: true, load: forRequest, readCached: forRequest };
}

// A directory that is cold on its first request (its acquisition then lands
// out of band, as a background source does) and warm afterwards.
function warmingDirectory(source) {
  const warm = warmDirectory(source);
  let isWarm = false;
  return {
    eager: true,
    load(anchor, request) {
      if (isWarm) return warm.load(anchor, request);
      isWarm = true;
      return Object.defineProperty([], SOURCE_COMPLETION, { value: warm.load(anchor, request) });
    },
    readCached: (anchor, request) => (isWarm ? warm.readCached(anchor, request) : []),
  };
}

function failingPrimary() {
  return async () => Object.assign([], { loader_status: "error_failed_closed", loader_error: "http_non_200" });
}

function planBody(preferences, walkingKm) {
  return {
    ...fx.ANCHOR,
    dates: ["2026-10-01"],
    preferences,
    walking_km_target: walkingKm,
    include_external_candidates: 1,
    experimental_agnostic_route_output: 1,
    agnostic_engine_compose: 1,
  };
}

async function withPlanner(openDataLoader, run) {
  const server = buildApp({
    openDataLoader,
    placeResolver: null,
    eventSupply: null,
    reviewedPlaceSource: null,
    sourceCatalog: null,
  }).listen(0);
  try {
    return await run(server);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function plan(server, body) {
  const response = await requestJson(server, { path: "/api/route-recommendations?lang=en", body });
  assert.equal(response.status, 200);
  return response.body;
}

// The modern Planner path: one server execution that may answer 202 and then
// be read through /api/planner-status until the final day is ready.
async function planWithLifecycle(server, body) {
  const post = (path, payload, headers = {}) => new Promise((resolve, reject) => {
    const data = JSON.stringify(payload);
    const request = http.request({
      hostname: "127.0.0.1",
      port: server.address().port,
      path,
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data), ...headers },
    }, (response) => {
      let raw = "";
      response.on("data", (chunk) => { raw += chunk; });
      response.on("end", () => resolve({ status: response.statusCode, body: raw ? JSON.parse(raw) : null }));
    });
    request.on("error", reject);
    request.end(data);
  });
  let response = await post("/api/route-recommendations?lang=en", body, { Prefer: "respond-async" });
  const token = response.body?.planner_lifecycle?.token;
  // The lifecycle allows at most 20 status reads per token.
  for (let polls = 0; response.status === 202 && polls < 20; polls += 1) {
    await new Promise((resolve) => setTimeout(resolve, 200));
    response = await post("/api/planner-status", { token });
  }
  assert.equal(response.status, 200);
  return response.body;
}

function publishedRoute(body) {
  return body?.days?.[0]?.primary_route || null;
}

function loadedCount(body) {
  const match = /^loaded:(\d+)$/.exec(String(body?.agnostic_route_output_experiment?.source_status?.status || ""));
  return match ? Number(match[1]) : 0;
}

// --------------------------------------------------------------------------
// 1. The directory sample describes the walkable disc.
// --------------------------------------------------------------------------

test("a dense centre's directory sample spans the walkable disc of a 9 km day, not its nearest few hundred metres", async () => {
  const records = await directorySource()({
    ...fx.ANCHOR,
    requestedIntents: ["food", "museums"],
    walkingTargetBand: fx.walkingBand(9),
  });
  assert.equal(records.length, 80, "the bounded output budget is unchanged");
  const distance = (record) => fx.distanceKm(fx.ANCHOR, record);
  // 0.25 x 9 km: the loop reach the Overpass aperture also uses.
  const reachKm = 2.25;
  for (const [innerKm, outerKm] of [[0, 0.5], [0.5, 1], [1, 1.5], [1.5, reachKm]]) {
    const ring = records.filter((record) => distance(record) >= innerKm && distance(record) < outerKm);
    assert.ok(ring.some((record) => record.type === "restaurant"),
      `requested food reaches ${innerKm}-${outerKm} km`);
    assert.ok(ring.some((record) => ["museum", "gallery"].includes(record.type)),
      `requested culture reaches ${innerKm}-${outerKm} km`);
  }
  assert.ok(Math.max(...records.map(distance)) >= 0.9 * reachKm, "the sample reaches the edge of the day's reach");
  for (const record of records) {
    assert.deepEqual(record.sources.map((source) => source.family), ["open_directory"],
      "stratification changes which rows are sampled, never their trust");
  }
});

test("a short day stays near and a request without a walking budget stays proximity-first", async () => {
  const source = directorySource();
  const short = await source({ ...fx.ANCHOR, requestedIntents: ["food", "museums"], walkingTargetBand: fx.walkingBand(4) });
  const within = short.filter((record) => fx.distanceKm(fx.ANCHOR, record) <= 1.5).length;
  assert.ok(within / short.length >= 0.7, `a 4 km day keeps most of its sample within reach (${within}/${short.length})`);

  const nearby = await source({ ...fx.ANCHOR, requestedIntents: ["food", "museums"] });
  const nearest = [...nearby].map((record) => fx.distanceKm(fx.ANCHOR, record)).sort((a, b) => a - b);
  assert.ok(nearest[Math.floor(nearest.length / 2)] <= 0.6,
    "nearby surfaces without a walking budget still receive the closest places first");
});

test("one stratified acquisition per anchor serves every preference set and walking budget", async () => {
  const { createOvertureBackgroundSource } = require("../server/place-candidates/open-data-loader");
  const before = dense.stats.queries;
  const directory = createOvertureBackgroundSource({
    source: directorySource(),
    cache: createSourceCache({ namespace: "dense-centre-directory" }),
  });
  const cold = directory.load(fx.ANCHOR, { requestedIntents: ["food"], walkingTargetBand: fx.walkingBand(4) });
  assert.equal(cold.length, 0, "a cold directory never blocks the composition");
  assert.ok((await cold[SOURCE_COMPLETION]).length > 0, "the acquisition completes out of band");
  const reach = async (requestedIntents, targetKm) => {
    const records = await directory.load(fx.ANCHOR, { requestedIntents, walkingTargetBand: fx.walkingBand(targetKm) });
    return Math.max(...records.map((record) => fx.distanceKm(fx.ANCHOR, record)));
  };
  const shortReach = await reach(["food"], 4);
  const longReach = await reach(["food"], 9);
  await reach(["museums", "green"], 6);
  assert.ok(longReach > shortReach, `a longer budget re-selects deeper from the same sample (${shortReach} -> ${longReach})`);
  assert.equal(dense.stats.queries - before, 1, "budget or preference changes never start another GeoParquet query");
});

// --------------------------------------------------------------------------
// 2. A 9 km dense-centre day reaches the 60% floor, or says honestly why not.
// --------------------------------------------------------------------------

test("with the map source down, a 9 km dense-centre day from the directory reaches the 60% walking floor", async () => {
  const loader = composeOpenDataLoaders(failingPrimary(), null, warmDirectory(directorySource()));
  const body = await withPlanner(loader, (server) => plan(server, planBody(["food", "culture"], 9)));
  const route = publishedRoute(body);
  assert.ok(route, "a published day");
  assert.ok(route.estimated_km >= 5.4, `9 km day reached ${route.estimated_km} km`);
  const negotiation = body.agnostic_route_output_experiment.constraint_negotiation;
  assert.equal(negotiation.walking.status, "within_requested_band");
  assert.deepEqual(negotiation.preference_coverage.missing_preferences, []);
});

test("with a healthy map source and a warm directory, a 9 km dense-centre day reaches the floor with real depth", async () => {
  const overpass = fx.createOverpassEmulator(densePlaces);
  const loader = composeOpenDataLoaders(
    createOpenDataLoader({ fetcher: overpass.fetcher }),
    null,
    warmDirectory(directorySource()),
  );
  const body = await withPlanner(loader, (server) => plan(server, planBody(["food", "culture"], 9)));
  const route = publishedRoute(body);
  assert.ok(overpass.stats.calls > 0, "the map primary was asked");
  assert.ok(route.estimated_km >= 5.4, `9 km day reached ${route.estimated_km} km`);
  assert.ok(route.main_stops.length >= 4, `${route.main_stops.length} stops`);
  assert.ok(
    route.main_stops.some((stop) => stop.provenance?.corroborated_by_external === true ||
      new Set((stop.provenance?.attribution || []).map((item) => item.source_family)).size >= 2),
    "depth comes from places two independent families corroborate",
  );
});

test("a genuinely compact world cannot reach the floor and the day says why instead of inventing distance", async () => {
  const compactPlaces = fx.generatePlaces({ spec: fx.COMPACT_WORLD });
  const compact = await fx.createOvertureQueryRows(compactPlaces);
  try {
    const loader = composeOpenDataLoaders(
      createOpenDataLoader({ fetcher: fx.createOverpassEmulator(compactPlaces).fetcher }),
      null,
      warmDirectory(directorySource(compact.queryRows)),
    );
    const body = await withPlanner(loader, (server) => plan(server, planBody(["food", "culture"], 9)));
    const experiment = body.agnostic_route_output_experiment;
    assert.equal(experiment.constraint_negotiation.walking.status, "shorter_than_requested_band");
    const capacity = experiment.source_status.collection.selected_day_capacity;
    assert.equal(capacity.can_support_target, false, "the reservoir itself reports it cannot span the band");
    assert.ok(capacity.candidate_span_km < capacity.target_floor_km);
  } finally {
    compact.close();
  }
});

// --------------------------------------------------------------------------
// 3. A warm background source never stands in for a primary nobody asked.
// --------------------------------------------------------------------------

test("a second request with a longer budget is not worse than the first (warm directory, healthy map source)", async () => {
  const overpass = fx.createOverpassEmulator(densePlaces);
  const loader = composeOpenDataLoaders(
    createOpenDataLoader({ fetcher: overpass.fetcher, cache: createSourceCache({ namespace: "dense-centre-overpass" }) }),
    null,
    warmingDirectory(directorySource()),
  );
  await withPlanner(loader, async (server) => {
    const first = await planWithLifecycle(server, planBody(["food", "culture"], 6));
    const callsAfterFirst = overpass.stats.calls;
    // Lagom -> Lång: the map key changes with the budget, the directory's not.
    const second = await planWithLifecycle(server, planBody(["food", "culture"], 9));
    assert.ok(overpass.stats.calls > callsAfterFirst, "the longer budget asked the map source for its own aperture");
    assert.ok(loadedCount(second) > 80, `the second day kept the map family (${loadedCount(second)} records)`);
    assert.ok(publishedRoute(second).estimated_km >= publishedRoute(first).estimated_km,
      `a longer budget did not shorten the day (${publishedRoute(first).estimated_km} -> ${publishedRoute(second).estimated_km} km)`);
  });
});

test("an identical repeat keeps the map family once the directory is warm (compatible API path)", async () => {
  const overpass = fx.createOverpassEmulator(densePlaces);
  const loader = composeOpenDataLoaders(
    createOpenDataLoader({ fetcher: overpass.fetcher, cache: createSourceCache({ namespace: "dense-centre-repeat" }) }),
    null,
    warmingDirectory(directorySource()),
  );
  await withPlanner(loader, async (server) => {
    const first = await plan(server, planBody(["food", "culture"], 9));
    const second = await plan(server, planBody(["food", "culture"], 9));
    assert.ok(loadedCount(first) > 0);
    assert.ok(loadedCount(second) > 80, `warm directory plus cached map family (${loadedCount(second)} records)`);
    assert.ok(publishedRoute(second).estimated_km >= 5.4, `${publishedRoute(second).estimated_km} km`);
  });
});

test("warm Wikidata alone cannot answer for a cold map source and a cold directory (public Göteborg/second-hand trace)", async () => {
  const overpass = fx.createOverpassEmulator(densePlaces);
  const wikidataCache = createSourceCache({ namespace: "dense-centre-wikidata" });
  const keyFor = ({ lat, lng } = {}) => `${Number(lat).toFixed(3)},${Number(lng).toFixed(3)}`;
  // Sixteen notable culture/green/market places in three categories, as traced.
  const pick = (category, count) => densePlaces.filter((place) => place.category === category).slice(0, count);
  const notable = [
    ...pick("museum", 7),
    ...pick("park", 8),
    { category: "market", name: "Saluhall", lat: fx.ANCHOR.lat + 0.002, lng: fx.ANCHOR.lng },
  ].map((place, index) => ({
    id: `wikidata-Q${900000 + index}`,
    name: place.name,
    type: place.category,
    lat: place.lat,
    lng: place.lng,
    tags: [],
    sources: [{ provider: "wikidata", family: "open_knowledge", tier: "inferred", url: `https://www.wikidata.org/wiki/Q${900000 + index}` }],
  }));
  assert.equal(new Set(notable.map((record) => record.type)).size, 3);
  await wikidataCache.get(keyFor(fx.ANCHOR), async () => notable);
  const wikidata = createBackgroundSource({
    cache: wikidataCache, keyFor, load: async () => notable, eager: false, waitForCompletion: false,
  });
  let directoryLoads = 0;
  const coldDirectory = { eager: true, load: () => { directoryLoads += 1; return []; }, readCached: () => [] };
  const loader = composeOpenDataLoaders(
    createOpenDataLoader({ fetcher: overpass.fetcher, cache: createSourceCache({ namespace: "dense-centre-cold-osm" }) }),
    wikidata,
    coldDirectory,
  );
  const records = await loader({
    ...fx.ANCHOR,
    requestedIntents: ["second_hand"],
    walkingTargetBand: fx.walkingBand(6),
    preferCachedSupply: true,
  });
  assert.ok(overpass.stats.calls > 0, "the cold map source was asked");
  assert.equal(directoryLoads, 1, "the cold directory was asked");
  assert.notEqual(records.loader_metadata?.primary_collection, "cached_supply");
  assert.ok(records.some((record) => record.type === "vintage-shop"), "the requested intent is now in the pool");
});

// --------------------------------------------------------------------------
// 4. A single requested intent can form an honest day from single-source supply.
// --------------------------------------------------------------------------

test("a second-hand-only day from directory-only supply publishes two labelled second-hand stops", async () => {
  const loader = composeOpenDataLoaders(failingPrimary(), null, warmDirectory(directorySource()));
  const body = await withPlanner(loader, (server) => plan(server, planBody(["second_hand"], 6)));
  const route = publishedRoute(body);
  assert.ok(route, "a published day instead of days: []");
  const secondHand = route.main_stops.filter((stop) => stop.type === "vintage-shop");
  assert.ok(secondHand.length >= 2, `${secondHand.length} second-hand stops`);
  for (const stop of route.main_stops) {
    assert.equal(stop.provisional, true);
    assert.equal(stop.trust.human_verified, false);
    assert.equal(stop.trust.confidence, "low", "single-source places stay labelled as low confidence");
  }
  const experiment = body.agnostic_route_output_experiment;
  assert.deepEqual(experiment.constraint_negotiation.preference_coverage.covered_preferences, ["second_hand"]);
  assert.equal(experiment.readiness_calibration.status, "thin_usable");
  assert.ok(experiment.readiness_calibration.caps.includes("capped_by_external_only_sources"));
  assert.equal(experiment.promotion.readiness, "promotable_limited");
});
