"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const test = require("node:test");

const {
  LATITUDE_FIELD,
  LONGITUDE_FIELD,
  VISIT_SWEDEN_NAPI_CONTRACT_REVISION,
  VISIT_SWEDEN_NAPI_SEARCH_ENDPOINT,
  buildVisitSwedenSearchRequest,
  createCachedVisitSwedenNapiSource,
  createVisitSwedenNapiSource,
  mapVisitSwedenEntry,
} = require("../server/place-candidates/visit-sweden-napi-source");
const { composeOpenDataLoaders, mapOsmElement } = require("../server/place-candidates/open-data-loader");
const { mapRecordToCandidate } = require("../server/place-candidates/external-open-provider");
const { resolveCandidateIdentity } = require("../server/candidates/entity-resolution");
const { reduceEvidence } = require("../server/candidates/evidence-reducer");
const { evaluateCandidateGates, targetFromPlaceCandidate } = require("../server/candidates/gates");
const { createSourceCache } = require("../server/place-candidates/source-cache");

const ANCHOR = Object.freeze({ lat: 55.6827, lng: 14.2340 });

function entry({
  contextId = "201",
  entryId = "55",
  name = "Kiviksgraven",
  language = "sv",
  rootType = "schema:Place",
  additionalType = "schema:LandmarksOrHistoricalBuildings",
  lat = 55.68266465,
  lng = 14.23398721,
  website = "https://www.sfv.se/fastigheter/kiviksgraven/",
} = {}) {
  const geoId = `_:geo-${contextId}-${entryId}`;
  const root = {
    "@id": `urn:uuid:11111111-2222-3333-4444-${String(entryId).padStart(12, "0")}`,
    "@type": rootType,
    "schema:name": { "@language": language, "@value": name },
    "schema:geo": { "@id": geoId },
    "schema:url": { "@id": website },
  };
  if (additionalType != null) {
    root["schema:additionalType"] = Array.isArray(additionalType)
      ? additionalType.map((value) => ({ "@id": value }))
      : { "@id": additionalType };
  }
  return {
    contextId,
    entryId,
    metadata: {
      "@id": `https://data.visitsweden.com/store/${contextId}/metadata/${entryId}`,
      "@context": { schema: "http://schema.org/" },
      "@graph": [
        root,
        {
          "@id": geoId,
          "@type": "schema:GeoCoordinates",
          "schema:latitude": String(lat),
          "schema:longitude": String(lng),
        },
      ],
    },
  };
}

function payload(children = []) {
  return {
    offset: 0,
    limit: 100,
    results: children.length,
    facetFields: [],
    resource: { children },
  };
}

function jsonResponse(value, init = {}) {
  return new Response(JSON.stringify(value), {
    status: init.status || 200,
    headers: { "content-type": "application/json; charset=utf-8", ...(init.headers || {}) },
  });
}

test("builds one capped coordinate query with no public place text or city branch", () => {
  const request = buildVisitSwedenSearchRequest({ ...ANCHOR, radiusKm: 999, limit: 999 });
  const url = new URL(request.url);
  const query = url.searchParams.get("query");

  assert.equal(url.origin + url.pathname, VISIT_SWEDEN_NAPI_SEARCH_ENDPOINT);
  assert.equal(url.searchParams.get("type"), "solr");
  assert.equal(url.searchParams.get("limit"), "100");
  assert.equal(url.searchParams.get("offset"), "0");
  assert.equal(url.searchParams.get("rdfFormat"), "application/ld+json");
  assert.match(query, /^public:true AND/);
  assert.match(query, /rdfType:http\\:\/\/schema\.org\/Place/);
  assert.match(query, /rdfType:http\\:\/\/schema\.org\/FoodEstablishment/);
  assert.match(query, new RegExp(`${LATITUDE_FIELD.replaceAll(".", "\\.")}:\\[`));
  assert.match(query, new RegExp(`${LONGITUDE_FIELD.replaceAll(".", "\\.")}:\\[`));
  assert.doesNotMatch(query.toLowerCase(), /kivik|stockholm|malm[öo]|name|label/);
  assert.equal(request.radiusKm, 5);
  assert.equal(buildVisitSwedenSearchRequest({ lat: 41.9, lng: 12.5 }), null, "outside provider coverage fails closed");
  for (const lat of [null, undefined, "55.68", true, NaN, Infinity]) {
    assert.equal(buildVisitSwedenSearchRequest({ lat, lng: ANCHOR.lng }), null);
  }
});

test("source shape contains no named-place or label/category inference branch", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "server", "place-candidates", "visit-sweden-napi-source.js"),
    "utf8",
  );
  assert.doesNotMatch(source, /\b(?:kivik|stockholm|malm[oö]|simrishamn|östersund)\b/i);
  assert.doesNotMatch(source, /(?:name|label).*(?:includes|startsWith|endsWith|match)\s*\(/i);
});

test("maps exact Place and FoodEstablishment graphs but discards provider prose and media", async () => {
  const source = createVisitSwedenNapiSource({
    fetcher: async (_url, options) => {
      assert.equal(options.method, "GET");
      assert.equal(options.redirect, "error");
      assert.equal(options.headers.Accept, "application/json");
      return jsonResponse(payload([
        entry(),
        entry({
          contextId: "125",
          entryId: "11",
          name: "Talldungen Gårdshotell",
          rootType: "schema:FoodEstablishment",
          additionalType: null,
          lat: 55.69,
          lng: 14.24,
        }),
      ]));
    },
  });

  const outcome = await source.collectOutcome(ANCHOR);
  assert.equal(outcome.status, "ok");
  assert.equal(outcome.contract_revision, VISIT_SWEDEN_NAPI_CONTRACT_REVISION);
  assert.deepEqual(outcome.records.map((record) => record.type).sort(), ["historic-site", "restaurant"]);
  const historicSite = outcome.records.find((record) => record.type === "historic-site");
  assert.equal(historicSite.id, "visit-sweden-napi-201-55");
  assert.equal(historicSite.name, "Kiviksgraven");
  assert.equal(historicSite.website, "https://www.sfv.se/fastigheter/kiviksgraven/");
  assert.deepEqual(historicSite.sources, [{
    provider: "visit-sweden-napi",
    label: "Visit Sweden National API",
    family: "official",
    tier: "official",
    url: "https://data.visitsweden.com/store/201/metadata/55",
    freshness: "fresh",
  }]);
  for (const forbidden of ["description", "abstract", "image", "rating", "metadata", "raw"]) {
    assert.equal(forbidden in historicSite, false);
  }
});

test("fails individual rows closed on identity, graph joins, category ambiguity and distance", () => {
  const request = buildVisitSwedenSearchRequest(ANCHOR);
  assert.ok(mapVisitSwedenEntry(entry(), request));

  const badMetadata = entry();
  badMetadata.metadata["@id"] = "https://data.visitsweden.com/store/201/metadata/999";
  assert.equal(mapVisitSwedenEntry(badMetadata, request), null);

  const duplicateRoot = entry();
  duplicateRoot.metadata["@graph"].push({ ...duplicateRoot.metadata["@graph"][0], "@id": "urn:uuid:aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" });
  assert.equal(mapVisitSwedenEntry(duplicateRoot, request), null);

  const duplicateGeo = entry();
  duplicateGeo.metadata["@graph"].push({ ...duplicateGeo.metadata["@graph"][1] });
  assert.equal(mapVisitSwedenEntry(duplicateGeo, request), null);

  assert.equal(mapVisitSwedenEntry(entry({ additionalType: "schema:Adventure" }), request), null);
  assert.equal(mapVisitSwedenEntry(entry({ additionalType: "schema:TouristAttraction" }), request), null);
  assert.equal(mapVisitSwedenEntry(entry({ rootType: "schema:Store", additionalType: null, name: "Museum Shop" }), request), null);
  assert.equal(mapVisitSwedenEntry(entry({ additionalType: ["schema:Museum", "schema:Park"] }), request), null);
  assert.equal(mapVisitSwedenEntry(entry({ lat: 55.75, lng: 14.24 }), request), null);
  assert.equal(mapVisitSwedenEntry(entry({ language: "de" }), request), null);
});

test("transport, URL, content type, byte and payload drift all fail closed", async () => {
  const cases = [
    async () => new Response("<html></html>", { status: 200, headers: { "content-type": "text/html" } }),
    async () => jsonResponse(payload([]), { headers: { "content-length": "2097153" } }),
    async () => jsonResponse({ results: 0, resource: { children: [] } }),
    async () => ({
      ok: true,
      status: 200,
      redirected: false,
      url: "https://example.invalid/store/search",
      headers: new Headers({ "content-type": "application/json" }),
      text: async () => JSON.stringify(payload([])),
    }),
  ];
  for (const fetcher of cases) {
    const outcome = await createVisitSwedenNapiSource({ fetcher }).collectOutcome(ANCHOR);
    assert.equal(outcome.status, "failed");
    assert.deepEqual(outcome.records, []);
  }

  let fetched = false;
  const outside = await createVisitSwedenNapiSource({ fetcher: async () => { fetched = true; } })
    .collectOutcome({ lat: 41.9, lng: 12.5 });
  assert.equal(outside.status, "failed");
  assert.equal(fetched, false);
});

test("persistent-capable cache stores healthy empty results but never freezes an outage", async () => {
  let calls = 0;
  let mode = "empty";
  const source = createVisitSwedenNapiSource({
    fetcher: async () => {
      calls += 1;
      if (mode === "failed") throw new Error("provider unavailable");
      return jsonResponse(payload([]));
    },
  });
  const cache = createSourceCache({ namespace: "visit-sweden-test", ttlMs: 60_000 });
  const cached = createCachedVisitSwedenNapiSource({ source, cache });

  assert.deepEqual(await cached.load(ANCHOR), []);
  assert.deepEqual(await cached.load(ANCHOR), []);
  assert.equal(calls, 1, "a healthy sparse location is cached");

  const otherAnchor = { lat: 55.7, lng: 14.3 };
  mode = "failed";
  assert.deepEqual(await cached.load(otherAnchor), []);
  assert.deepEqual(await cached.load(otherAnchor), []);
  assert.equal(calls, 3, "failed refreshes are retried rather than stored as healthy empties");
});

test("official rows are displayable but route promotion still requires independent corroboration", () => {
  const request = buildVisitSwedenSearchRequest(ANCHOR);
  const napiRecord = mapVisitSwedenEntry(entry({ name: "Regional Museum", additionalType: "schema:Museum" }), request);
  const napiCandidate = mapRecordToCandidate({ key: "kivik" }, napiRecord, "2026-09-04T00:00:00Z", 0);
  const singleDerived = reduceEvidence(napiCandidate.evidence);
  const singleGates = evaluateCandidateGates({
    target: targetFromPlaceCandidate(napiCandidate),
    derived: singleDerived,
  });
  assert.equal(singleGates.may_show, true);
  assert.equal(singleGates.may_influence_routes, false);
  assert.ok(singleGates.reasons.includes("blocked_promotion_uncorroborated"));

  const osmCandidate = mapRecordToCandidate(
    { key: "kivik" },
    mapOsmElement({
      type: "node",
      id: 42,
      lat: 55.68266,
      lon: 14.23399,
      tags: { name: "Regional Museum", tourism: "museum" },
    }),
    "2026-09-04T00:00:00Z",
    1,
  );
  assert.ok(osmCandidate);
  const resolved = resolveCandidateIdentity([napiCandidate, osmCandidate], { now: "2026-09-04T00:00:00Z" });
  assert.equal(resolved.candidates.length, 1);
  const merged = resolved.candidates[0];
  const mergedDerived = reduceEvidence(merged.evidence);
  const mergedGates = evaluateCandidateGates({ target: targetFromPlaceCandidate(merged), derived: mergedDerived });
  assert.equal(mergedDerived.provenance_diversity, 2);
  assert.equal(mergedGates.may_influence_routes, true);
});

test("NAPI starts concurrently but cannot bypass the primary corroboration opportunity", async () => {
  let releasePrimary;
  const primary = new Promise((resolve) => { releasePrimary = resolve; });
  const officialRecords = Array.from({ length: 12 }, (_, index) => ({
    id: `visit-sweden-napi-${index}`,
    name: `Official ${index}`,
    type: ["museum", "restaurant", "park"][index % 3],
    lat: ANCHOR.lat,
    lng: ANCHOR.lng,
    tags: [],
    sources: [{ provider: "visit-sweden-napi", family: "official", tier: "official" }],
  }));
  let officialStarted = false;
  const loader = composeOpenDataLoaders(
    async () => primary,
    null,
    null,
    {
      eager: true,
      primaryRescue: false,
      load: async () => {
        officialStarted = true;
        return officialRecords;
      },
    },
  );
  const pending = loader(ANCHOR);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(officialStarted, true);
  const state = await Promise.race([pending.then(() => "resolved"), Promise.resolve("pending")]);
  assert.equal(state, "pending");
  releasePrimary([]);
  const records = await pending;
  assert.equal(records.length, 12);
});

test("official cache survives a new cache instance and accompanies the fast directory path", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "parranda-napi-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  let calls = 0;
  const source = createVisitSwedenNapiSource({ fetcher: async () => {
    calls += 1;
    return jsonResponse(payload([entry()]));
  } });
  const makeCached = () => createCachedVisitSwedenNapiSource({ source,
    cache: createSourceCache({ namespace: "napi", dir }) });
  assert.equal((await makeCached().load(ANCHOR)).length, 1);
  const restarted = makeCached();
  assert.equal((await restarted.load(ANCHOR)).length, 1);
  assert.equal(calls, 1);
  const directory = Array.from({ length: 12 }, (_, index) => ({
    id: `directory-${index}`, name: `Place ${index}`, type: ["museum", "restaurant", "park"][index % 3],
    lat: ANCHOR.lat, lng: ANCHOR.lng,
  }));
  const loader = composeOpenDataLoaders(async () => [], null,
    { eager: true, load: () => directory }, restarted);
  const result = await loader(ANCHOR);
  assert.equal(result.length, 13);
  assert.ok(result.some((record) => record.id === "visit-sweden-napi-201-55"));
  assert.equal(result.loader_metadata.selected_profile.record_count, 13);
});

test("a failed primary and failed NAPI request never cause a second live fetch in the same composition", async () => {
  let calls = 0;
  const source = createVisitSwedenNapiSource({ fetcher: async () => {
    calls += 1;
    throw new Error("provider unavailable");
  } });
  const cached = createCachedVisitSwedenNapiSource({ source, cache: createSourceCache() });
  const loader = composeOpenDataLoaders(
    async () => Object.assign([], { loader_status: "error_failed_closed", loader_error: "http_non200" }),
    null, null, cached,
  );
  assert.deepEqual(Array.from(await loader(ANCHOR)), []);
  assert.equal(calls, 1, "a cache-only rescue reread must not retry the live API");
});

test("cache identity separates acquisition settings and rejects an obsolete contract", async () => {
  const cache = createSourceCache();
  let calls = 0;
  const fetcher = async () => { calls += 1; return jsonResponse(payload([entry()])); };
  for (const radiusKm of [1, 5]) {
    const source = createVisitSwedenNapiSource({ radiusKm, fetcher });
    await createCachedVisitSwedenNapiSource({ source, cache }).load(ANCHOR);
  }
  assert.equal(calls, 2);
  const source = createVisitSwedenNapiSource({ fetcher });
  const stale = createCachedVisitSwedenNapiSource({ source, cache: {
    get: async () => ({ contract_revision: "obsolete", status: "ok", records: [{lat:ANCHOR.lat,lng:ANCHOR.lng}] }),
  } });
  assert.deepEqual(await stale.load(ANCHOR), []);
});

test("duplicate graph identity and a local JSON-LD context cannot change the entity meaning", () => {
  const request = buildVisitSwedenSearchRequest(ANCHOR);
  const duplicate = entry();
  duplicate.metadata["@graph"].push({ ...duplicate.metadata["@graph"][1], "@type": "schema:PostalAddress" });
  assert.equal(mapVisitSwedenEntry(duplicate, request), null);
  const scoped = entry();
  scoped.metadata["@graph"][0]["@context"] = { schema: "https://untrusted.example/" };
  assert.equal(mapVisitSwedenEntry(scoped, request), null);
});

test("timeout covers the response body and oversized streams cancel before parsing", async () => {
  let canceled = false;
  const oversized = createVisitSwedenNapiSource({ maxBytes: 1024, fetcher: async () =>
    new Response(new ReadableStream({
      start(controller) { controller.enqueue(new Uint8Array(1025)); },
      cancel() { canceled = true; },
    }), { headers: { "content-type": "application/json" } }) });
  assert.equal((await oversized.collectOutcome(ANCHOR)).status, "failed");
  assert.equal(canceled, true);
  const slow = createVisitSwedenNapiSource({ timeoutMs: 50, fetcher: async (_url, {signal}) =>
    new Response(new ReadableStream({ start(controller) {
      signal.addEventListener("abort", () => controller.error(new Error("aborted")), {once:true});
    } }), { headers: { "content-type": "application/json" } }) });
  assert.equal((await slow.collectOutcome(ANCHOR)).status, "failed");
});
