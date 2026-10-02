"use strict";

/**
 * Lagom → Lång must not trade a published map-backed day for a directory-only
 * one merely because the longer budget's map answer is still in flight.
 *
 * Independent Pi acceptance of 52c23d7 (Göteborg centre, second hand, same
 * anchor/date/preferences/cache state): warm 6 km published 4 stops / 5.8 km
 * from 121 loaded records (map + directory + Wikidata, `cached_supply`).
 * Changing only the budget to 9 km, the 9 km Overpass answer — HTTP 200 —
 * arrived 10.876 s after its request, 0.9 s after the 10 s bound, and the
 * published day came from the directory alone: 80 records, 2 stops. A second
 * trace lost a first Overpass pass that had answered in 4.0 s because only its
 * wider expansion was still pending at the bound (it then returned 504).
 *
 * SYNTHETIC geography. The bound is scaled down for the test; the Overpass
 * evaluator answers the loader's own queries, optionally late or with 504.
 */

const assert = require("node:assert/strict");
const http = require("node:http");
const { test, before, after } = require("node:test");

const fx = require("./helpers/dense-centre-fixture");
const { createOvertureSource } = require("../server/place-candidates/overture-source");
const {
  composeOpenDataLoaders,
  createOpenDataLoader,
  createOvertureBackgroundSource,
} = require("../server/place-candidates/open-data-loader");
const { createSourceCache } = require("../server/place-candidates/source-cache");
const { SOURCE_COMPLETION, createBackgroundSource } = require("../server/place-candidates/background-source");
const { deriveSecondaryAnchors } = require("../server/place-candidates/spatial-scope");
const { buildApp } = require("../server/app");
const { mockStableWeatherFetch } = require("./helpers/planner-reservoir-compare");

const BOUND_MS = 60;
const ORIGINAL_FETCH = global.fetch;
let places;
let directoryRows;

before(async () => {
  places = fx.generatePlaces();
  directoryRows = await fx.createOvertureQueryRows(places);
  global.fetch = mockStableWeatherFetch();
});

after(async () => {
  await directoryRows?.close();
  global.fetch = ORIGINAL_FETCH;
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Overpass that can answer late or fail. `policy(radiusM)` returns
// { delayMs, status } for one query; the loader's own query text decides it.
function controllableOverpass() {
  const evaluator = fx.createOverpassEmulator(places);
  const state = { policy: () => ({ delayMs: 0, status: 200 }), calls: [] };
  const fetcher = async (url, options = {}) => {
    const query = decodeURIComponent(String(options.body || "").replace(/^data=/, ""));
    const radiusM = Number(/around:([\d.]+)/.exec(query)?.[1]);
    const { delayMs = 0, status = 200, waitFor } = state.policy(radiusM) || {};
    state.calls.push({ radiusM, delayMs, status, query });
    if (waitFor) await waitFor;
    if (delayMs) await sleep(delayMs);
    if (status !== 200) return { ok: false, status, json: async () => ({}) };
    return evaluator.fetcher(url, options);
  };
  return { fetcher, state };
}

// "Just after the bound", without racing a timer against it: every Overpass
// answer is held until `release()`, so it is still outstanding when the day is
// composed however loaded the process is. `settled()` then waits for that same
// load (its first pass and any expansion) to finish and be stored. Joining it
// must never repeat a query, which a different cache key would.
function lateAnswer(overpass) {
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  const from = overpass.state.calls.length;
  overpass.state.policy = () => ({ waitFor: held, status: 200 });
  return {
    release,
    async settled(loader, request) {
      await loader.waitForPrimary(request);
      const queries = overpass.state.calls.slice(from).map((call) => call.query);
      assert.equal(new Set(queries).size, queries.length, "joined the composition's own load; no query was asked twice");
    },
  };
}

// Production wiring: cached Overpass, warm non-blocking Wikidata-like
// corroboration, and the per-anchor directory sample.
async function createSupply({ overpass, overpassCache = createSourceCache({ namespace: "budget-switch-overpass" }) }) {
  const keyFor = ({ lat, lng } = {}) => `${Number(lat).toFixed(3)},${Number(lng).toFixed(3)}`;
  const notableCache = createSourceCache({ namespace: "budget-switch-wikidata" });
  const notable = places
    .filter((place) => ["museum", "park"].includes(place.category))
    .slice(0, 16)
    .map((place, index) => ({
      id: `wikidata-Q${700000 + index}`,
      name: place.name,
      type: place.category,
      lat: place.lat,
      lng: place.lng,
      tags: [],
      sources: [{ provider: "wikidata", family: "open_knowledge", tier: "inferred", url: `https://www.wikidata.org/wiki/Q${700000 + index}` }],
    }));
  await notableCache.get(keyFor(fx.ANCHOR), async () => notable);
  const wikidata = createBackgroundSource({
    cache: notableCache, keyFor, load: async () => notable, eager: false, waitForCompletion: false,
  });
  const directory = createOvertureBackgroundSource({
    source: createOvertureSource({ queryRows: directoryRows.queryRows, releaseResolver: async () => "2026-09-17.0" }),
    cache: createSourceCache({ namespace: "budget-switch-directory" }),
  });
  const osm = createOpenDataLoader({ fetcher: overpass.fetcher, cache: overpassCache });
  const loader = composeOpenDataLoaders(osm, wikidata, directory, null, { primaryWaitMs: BOUND_MS });
  // Test-only synchronization: wait for the real SQL source completion rather
  // than guessing that a native query finished within a sleep under suite load.
  loader.waitForDirectory = async (request) => {
    const rows = directory.load(request, request);
    return rows[SOURCE_COMPLETION] ? await rows[SOURCE_COMPLETION] : rows;
  };
  loader.waitForPrimary = (request) => osm(request);
  return loader;
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

// The modern Planner path (`Prefer: respond-async`), polled as the client does.
async function planWithLifecycle(server, body) {
  const post = (path, payload, headers = {}) => new Promise((resolve, reject) => {
    const data = JSON.stringify(payload);
    const request = http.request({
      agent: false, // Isolate lifecycle probes from stale shared keep-alive sockets.
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
  let response = await post("/api/route-recommendations?lang=sv", body, { Prefer: "respond-async" });
  const token = response.body?.planner_lifecycle?.token;
  for (let polls = 0; response.status === 202 && polls < 20; polls += 1) {
    await sleep(200);
    response = await post("/api/planner-status", { token });
  }
  assert.equal(response.status, 200);
  return response.body;
}

async function withPlanner(loader, run) {
  const server = buildApp({
    openDataLoader: loader, placeResolver: null, eventSupply: null, reviewedPlaceSource: null, sourceCatalog: null,
  }).listen(0);
  try {
    return await run(server);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function familiesOf(stopOrRecord) {
  const fromStop = (stopOrRecord.provenance?.attribution || []).map((item) => item.source_family);
  const fromRecord = (stopOrRecord.sources || []).map((source) => source.family);
  return new Set([...fromStop, ...fromRecord].filter(Boolean));
}

function summarize(body) {
  const route = body?.days?.[0]?.primary_route || null;
  const experiment = body?.agnostic_route_output_experiment || {};
  const collection = experiment.source_status?.collection || {};
  const stops = route?.main_stops || [];
  return {
    km: Number.isFinite(route?.estimated_km) ? route.estimated_km : 0,
    stops: stops.length,
    stopNames: stops.map((stop) => `${stop.label} [${[...familiesOf(stop)].sort().join("+")}]`),
    corroborated: stops.filter((stop) => familiesOf(stop).size >= 2).length,
    mapStops: stops.filter((stop) => familiesOf(stop).has("map")).length,
    loaded: Number(/^loaded:(\d+)$/.exec(String(experiment.source_status?.status || ""))?.[1] || 0),
    collection: collection.primary_collection || null,
    collectionReason: collection.primary_collection_reason || null,
    collectionTargetKm: collection.primary_collection_target_km ?? null,
    readinessReasons: experiment.readiness_calibration?.reasons || [],
    walking: experiment.constraint_negotiation?.walking?.status || null,
    covered: experiment.constraint_negotiation?.preference_coverage?.covered_preferences || [],
  };
}

function familyCounts(records) {
  const counts = {};
  for (const record of records) {
    for (const family of familiesOf(record)) counts[family] = (counts[family] || 0) + 1;
  }
  return counts;
}

const loaderRequest = (targetKm, extra = {}) => ({
  ...fx.ANCHOR,
  requestedIntents: [],
  walkingTargetBand: fx.walkingBand(targetKm),
  anchorMode: "coordinates",
  ...extra,
});

// --------------------------------------------------------------------------
// The Pi pair: same anchor, date, preferences and cache state; only the budget
// changes, and the longer budget's map answer lands just after the bound.

test("Lagom → Lång keeps the published map-backed day when the 9 km map answer lands just after the bound", async (t) => {
  const overpass = controllableOverpass();
  const loader = await createSupply({ overpass });
  await withPlanner(loader, async (server) => {
    await planWithLifecycle(server, planBody([], 6)); // cold: warms every source
    await loader.waitForDirectory(loaderRequest(6));
    const lagom = summarize(await planWithLifecycle(server, planBody([], 6)));
    t.diagnostic(`Lagom 6 km: ${JSON.stringify(lagom)}`);
    assert.equal(lagom.collection, "cached_supply", "the warm 6 km day is served from its own cached map answer");
    assert.ok(lagom.stops >= 4 && lagom.mapStops >= 1, "precondition: a published map-backed day of four or more stops");

    // Only the budget changes. The 9 km Overpass answer is late, not absent:
    // it is held until the day has been composed, then released.
    const late = lateAnswer(overpass);
    const callsBefore = overpass.state.calls.length;
    let lang;
    try {
      lang = summarize(await planWithLifecycle(server, planBody([], 9)));
    } finally {
      late.release();
    }
    t.diagnostic(`Lång 9 km, map answer late: ${JSON.stringify(lang)}`);
    assert.ok(lang.loaded >= lagom.loaded,
      `no source family may vanish on a budget switch (${lagom.loaded} -> ${lang.loaded} records)`);
    assert.equal(lang.collection, "neighbouring_budget_cache",
      "the day says it used the same anchor's map answer for another budget while this one loads");
    assert.equal(lang.collectionReason, "primary_outstanding_at_wait_bound");
    assert.equal(lang.collectionTargetKm, 6);
    assert.ok(lang.readinessReasons.includes("primary_collection_neighbouring_budget_cache"));
    assert.ok(lang.mapStops >= 1 && lang.corroborated >= 1, "map-backed, corroborated stops remain");
    assert.ok(lang.stops >= lagom.stops, `the longer budget keeps the day's depth (${lagom.stops} -> ${lang.stops} stops)`);
    // Zero extra provider cost: the switch asked for the 9 km answer once,
    // exactly as any cold key would, and never re-asked any query.
    const switchCalls = overpass.state.calls.slice(callsBefore);
    assert.ok(switchCalls.length >= 1, "the 9 km answer was requested");
    assert.equal(new Set(switchCalls.map((call) => call.query)).size, switchCalls.length, "no query was asked twice");
    assert.ok(switchCalls.every((call) => call.radiusM > 1500), "only the new budget's own queries went out");

    // The late answer was not wasted: it completes in the background and the
    // next request is served from the 9 km answer itself.
    await late.settled(loader, loaderRequest(9));
    overpass.state.policy = () => ({ delayMs: 0, status: 200 });
    const callsAfterSwitch = overpass.state.calls.length;
    const settled = summarize(await planWithLifecycle(server, planBody([], 9)));
    t.diagnostic(`Lång 9 km, next request: ${JSON.stringify(settled)}`);
    assert.equal(settled.collection, "cached_supply", "the next request uses the 9 km answer itself");
    assert.equal(overpass.state.calls.length, callsAfterSwitch, "served from cache, no provider call");
    assert.ok(settled.mapStops >= 1);
    assert.ok(settled.stops >= lagom.stops);
  });
});

test("which evidence the switch loses: every map and Wikidata record of the 6 km reservoir survives at 9 km", async (t) => {
  const overpass = controllableOverpass();
  const loader = await createSupply({ overpass });
  const request = (targetKm) => loaderRequest(targetKm, { preferCachedSupply: true });
  await loader(request(6));
  await loader.waitForDirectory(request(6));
  const lagom = await loader(request(6));
  assert.ok(familyCounts(lagom).open_directory,
    "precondition: the asynchronous directory sample is warm before testing its bounded rescue");
  assert.equal(lagom.loader_metadata?.primary_collection, "cached_supply");
  // Keep the new budget's real emulator response pending until after the
  // assertion. A timer alone can settle before the bound under full-suite load.
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  overpass.state.policy = () => ({ waitFor: pending, status: 200 });
  try {
    const lang = await loader(request(9));
    assert.equal(lang.loader_metadata?.primary_collection, "neighbouring_budget_cache",
      "compare identities only when the new budget is still pending");
    const langIds = new Set(lang.map((record) => record.id));
    const lost = lagom.filter((record) => !langIds.has(record.id));
    t.diagnostic(`6 km reservoir by family: ${JSON.stringify(familyCounts(lagom))} (${lagom.length})`);
    t.diagnostic(`9 km reservoir by family: ${JSON.stringify(familyCounts(lang))} (${lang.length}), ${lang.loader_metadata?.primary_collection}`);
    t.diagnostic(`lost on the switch by family: ${JSON.stringify(familyCounts(lost))} (${lost.length})`);
    const lostFamilies = Object.keys(familyCounts(lost)).sort();
    assert.deepEqual(
      lostFamilies.filter((family) => family !== "open_directory"),
      [],
      `records lost on the switch by family: ${lostFamilies.join(", ")} (${lost.length} records)`,
    );
    // The directory itself re-selects for the longer reach; it is not a loss of evidence.
    assert.ok(lang.some((record) => familiesOf(record).has("map")));
    assert.ok(lang.some((record) => familiesOf(record).has("open_knowledge")));
  } finally {
    release();
  }
});

test("a map source that answers within the bound separates the wait from composition", async (t) => {
  const overpass = controllableOverpass();
  const loader = await createSupply({ overpass });
  await withPlanner(loader, async (server) => {
    await planWithLifecycle(server, planBody([], 6));
    await loader.waitForDirectory(loaderRequest(6));
    const lagom = summarize(await planWithLifecycle(server, planBody([], 6)));
    // Same switch, but the 9 km answer is on time: nothing to fall back on.
    const lang = summarize(await planWithLifecycle(server, planBody([], 9)));
    t.diagnostic(`healthy map, Lagom 6 km: ${JSON.stringify(lagom)}`);
    t.diagnostic(`healthy map, Lång 9 km: ${JSON.stringify(lang)}`);
    assert.equal(lang.collection, null, "the 9 km day was composed from its own live map answer");
    assert.ok(lang.mapStops >= 1);
    assert.ok(lang.stops >= lagom.stops, `composition keeps depth with a settled map answer (${lagom.stops} -> ${lang.stops})`);
    assert.ok(lang.km >= lagom.km, `and uses the longer budget (${lagom.km} -> ${lang.km} km)`);
  });
});

// The Pi's own pair used `second_hand`. The switch guarantees are the same:
// no family lost, map-backed depth kept, the requested intent still covered.
// What this does NOT guarantee is walk length: for a single requested intent
// the composer can build a more compact 9 km day than its 6 km day from the
// same evidence, even when the 9 km map answer arrives in time (a separate
// selection/composition limitation, present on `main` too, documented in
// DENSE_CENTRE_SUPPLY.md). The walk is therefore asserted to be reported
// honestly against the requested band, not to be at least as long.
test("second hand: Lagom → Lång keeps map-backed second-hand depth and reports the walk against the band", async (t) => {
  const overpass = controllableOverpass();
  const loader = await createSupply({ overpass });
  await withPlanner(loader, async (server) => {
    await planWithLifecycle(server, planBody(["second_hand"], 6));
    await loader.waitForDirectory(loaderRequest(6, { requestedIntents: ["second_hand"] }));
    const lagom = summarize(await planWithLifecycle(server, planBody(["second_hand"], 6)));
    const late = lateAnswer(overpass);
    let lang;
    try {
      lang = summarize(await planWithLifecycle(server, planBody(["second_hand"], 9)));
    } finally {
      late.release();
    }
    await late.settled(loader, loaderRequest(9, { requestedIntents: ["second_hand"] }));
    t.diagnostic(`second hand, Lagom 6 km: ${JSON.stringify(lagom)}`);
    t.diagnostic(`second hand, Lång 9 km, map answer late: ${JSON.stringify(lang)}`);
    assert.ok(lagom.covered.includes("second_hand") && lagom.mapStops >= 1, "precondition: a map-backed second-hand day");
    assert.equal(lang.collection, "neighbouring_budget_cache");
    assert.ok(lang.loaded >= lagom.loaded, `no source family may vanish (${lagom.loaded} -> ${lang.loaded})`);
    assert.ok(lang.covered.includes("second_hand"));
    assert.ok(lang.mapStops >= 1 && lang.stops >= lagom.stops, `map-backed depth is kept (${lagom.stops} -> ${lang.stops} stops)`);
    assert.equal(lang.walking, lang.km < 9 * 0.6 ? "shorter_than_requested_band" : "within_requested_band",
      "a walk below the requested band is reported as such");
  });
});

test("a first Overpass pass that answered is kept when only its wider expansion is still pending", async () => {
  const overpass = controllableOverpass();
  const loader = await createSupply({ overpass });
  const request = loaderRequest(6, { requestedIntents: ["second_hand"] });
  const warmRequest = { ...request, walkingTargetBand: fx.walkingBand(4), requestedIntents: ["food"] };
  await loader(warmRequest);
  await loader.waitForDirectory(warmRequest);
  let releaseExpansion;
  const expansionGate = new Promise(resolve => { releaseExpansion = resolve; });
  overpass.state.policy = radiusM => radiusM > 1500
    ? { waitFor: expansionGate, status: 504 } : { delayMs: 0, status: 200 };
  const callsBefore = overpass.state.calls.length;
  try {
    const records = await loader(request);
    assert.ok(overpass.state.calls.length > callsBefore, "the requested key went to Overpass");
    assert.equal(records.loader_metadata?.primary_collection, "first_pass_while_expanding");
    assert.equal(records.loader_metadata?.primary_collection_reason, "primary_outstanding_at_wait_bound");
    assert.equal(records.loader_metadata?.selection_reason, "expansion_outstanding");
    assert.ok(records.some(record => familiesOf(record).has("map")), "the answered first pass is in the reservoir");
  } finally {
    releaseExpansion();
    await loader.waitForPrimary(request);
  }
  // Observe actual completion, not a sleep: the 504 retains the first pass.
  const callsAfter = overpass.state.calls.length;
  const again = await loader({ ...request, preferCachedSupply: true });
  assert.equal(overpass.state.calls.length, callsAfter);
  assert.ok(again.some(record => familiesOf(record).has("map")));
});

test("a 504 for the new budget keeps the same anchor's cached map answer for another budget", async () => {
  const overpass = controllableOverpass();
  const loader = await createSupply({ overpass });
  await loader(loaderRequest(6));
  await sleep(50);
  overpass.state.policy = () => ({ delayMs: 0, status: 504 });
  const records = await loader(loaderRequest(9));
  assert.equal(records.loader_metadata?.primary_collection, "neighbouring_budget_cache");
  assert.equal(records.loader_metadata?.primary_collection_reason, "primary_failed");
  assert.equal(records.loader_metadata?.primary_collection_target_km, 6);
  assert.ok(records.some((record) => familiesOf(record).has("map")));
  assert.equal(records.loader_error, "http_non_200", "the new budget's own outage stays visible");
});

test("with no map answer for any budget the directory still rescues, and says so", async () => {
  const overpass = controllableOverpass();
  overpass.state.policy = () => ({ delayMs: 0, status: 504 });
  const loader = await createSupply({ overpass });
  const request = loaderRequest(9);
  await loader({ ...request, walkingTargetBand: fx.walkingBand(4) }); // starts warming the directory only
  await loader.waitForDirectory(request);
  const records = await loader(request);
  assert.ok(records.length > 0, "the outage rescue still answers");
  assert.ok(records.every((record) => !familiesOf(record).has("map")));
  assert.equal(records.loader_error, "http_non_200");
  assert.equal(records.loader_metadata?.primary_collection ?? null, null);
});

// --------------------------------------------------------------------------
// Bounds on the neighbouring answer: it is only ever the same anchor's fresh,
// stored answer for the same preferences, mode and scope.

test("a neighbouring budget is never another preference set, and the nearest aperture wins", async () => {
  const overpass = controllableOverpass();
  const loader = await createSupply({ overpass });
  await loader(loaderRequest(6)); // aperture 1.5 km
  await loader(loaderRequest(12)); // aperture 3 km
  await sleep(50);
  overpass.state.policy = () => ({ delayMs: 0, status: 504 });

  const seven = await loader(loaderRequest(7)); // aperture 1.75 km
  assert.equal(seven.loader_metadata?.primary_collection_target_km, 6, "1.5 km is nearer 1.75 km than 3 km is");
  const ten = await loader(loaderRequest(10)); // aperture 2.5 km
  assert.equal(ten.loader_metadata?.primary_collection_target_km, 12, "3 km is nearer 2.5 km than 1.5 km is");

  const otherPreferences = await loader(loaderRequest(9, { requestedIntents: ["second_hand"] }));
  assert.equal(otherPreferences.loader_metadata?.primary_collection ?? null, null);
  assert.ok(otherPreferences.every((record) => !familiesOf(record).has("map")),
    "a map answer gathered for other preferences is not borrowed");
});

test("a neighbouring budget answer is never served after it expires", async () => {
  let clock = 1_000_000;
  const overpass = controllableOverpass();
  const overpassCache = createSourceCache({ namespace: "budget-switch-expiry", ttlMs: 60_000, now: () => clock });
  const loader = await createSupply({ overpass, overpassCache });
  await loader(loaderRequest(6));
  await sleep(50);
  overpass.state.policy = () => ({ delayMs: 0, status: 504 });
  assert.equal((await loader(loaderRequest(9))).loader_metadata?.primary_collection, "neighbouring_budget_cache");
  clock += 60_001;
  const expired = await loader(loaderRequest(9));
  assert.equal(expired.loader_metadata?.primary_collection ?? null, null);
  assert.ok(expired.every((record) => !familiesOf(record).has("map")));
});

test("a regional cluster answer is never borrowed as a neighbouring budget", async () => {
  // A thin primary whose regional scout selects a richer secondary cluster:
  // that answer describes another place and must not stand in for the primary.
  const scope = { source: "test_resolver", kind: "region", bounds: { south: 55.3, north: 55.9, west: 14.0, east: 14.3 } };
  const primary = { lat: 55.6, lng: 14.15 };
  const secondary = deriveSecondaryAnchors(scope, primary)[0];
  let failing = false;
  const fetcher = async (_url, options) => {
    if (failing) return { ok: false, status: 504, json: async () => ({}) };
    const query = decodeURIComponent(options.body);
    const regional = (query.match(/around:3000/g) || []).length > 10;
    const center = regional ? secondary : primary;
    const kinds = regional ? [{ amenity: "restaurant" }, { tourism: "viewpoint" }, { tourism: "museum" }] : [{ amenity: "cafe" }];
    return {
      ok: true,
      json: async () => ({
        elements: Array.from({ length: regional ? 18 : 3 }, (_, index) => ({
          type: "node",
          id: index + 1 + (regional ? 100 : 0),
          lat: center.lat + index * 0.0001,
          lon: center.lng,
          tags: { name: `P${index}`, ...kinds[index % kinds.length] },
        })),
      }),
    };
  };
  const osm = createOpenDataLoader({ fetcher, endpoint: "https://x/overpass", cache: createSourceCache({ namespace: "budget-switch-regional" }) });
  const request = (targetKm) => ({
    ...primary, requestedIntents: ["food", "views"], anchorMode: "place", spatialScope: scope, walkingTargetBand: fx.walkingBand(targetKm),
  });
  const first = await osm(request(6));
  assert.equal(first.loader_metadata.regional_scout.selected_anchor, secondary.id, "precondition: a regional cluster was selected");
  failing = true;
  assert.equal(osm.readNeighbouring(primary, request(9)), null);
});

// --------------------------------------------------------------------------
// Progress is process-private and short-lived.

test("an answered primary is readable only while its regional scout is outstanding", async () => {
  const scope = { source: "test_resolver", kind: "region", bounds: { south: 55.3, north: 55.9, west: 14.0, east: 14.3 } };
  const primary = { lat: 55.6, lng: 14.15 };
  let releaseScout;
  const scoutGate = new Promise((resolve) => { releaseScout = resolve; });
  const fetcher = async (_url, options) => {
    const query = decodeURIComponent(options.body);
    const regional = (query.match(/around:3000/g) || []).length > 10;
    if (regional) await scoutGate;
    return {
      ok: true,
      json: async () => ({
        elements: regional ? [] : Array.from({ length: 3 }, (_, index) => ({
          type: "node", id: index + 1, lat: primary.lat + index * 0.0001, lon: primary.lng, tags: { name: `P${index}`, amenity: "cafe" },
        })),
      }),
    };
  };
  const osm = createOpenDataLoader({ fetcher, endpoint: "https://x/overpass" });
  const request = { ...primary, requestedIntents: ["food", "views"], anchorMode: "place", spatialScope: scope };
  const pending = osm(request);
  let progress = null;
  for (let tries = 0; tries < 50 && !progress; tries += 1) {
    await sleep(2);
    progress = osm.readProgress(primary, request);
  }
  assert.ok(progress?.length > 0, "the answered primary is visible while the scout runs");
  assert.equal(progress.loader_metadata.selection_reason, "regional_scout_outstanding");
  releaseScout();
  const settled = await pending;
  assert.ok(settled.length > 0);
  assert.equal(osm.readProgress(primary, request), null, "cleared once the load settles");
});
