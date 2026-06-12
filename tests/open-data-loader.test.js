const assert = require("node:assert/strict");
const test = require("node:test");

const {
  createOpenDataLoader,
  resolveDefaultOpenDataLoader,
  buildOverpassQuery,
  mapOverpassResponse,
  mapOsmElement,
  MAX_RADIUS_KM,
  DEFAULT_USER_AGENT,
} = require("../server/place-candidates/open-data-loader");

// --- OSM element mapping ---------------------------------------------------

test("OSM element + wikidata tag yields two source families (map + open_knowledge)", () => {
  const record = mapOsmElement({
    type: "node",
    id: 42,
    lat: 41.9,
    lon: 12.5,
    tags: { name: "Belvedere", tourism: "viewpoint", wikidata: "Q123" },
  });
  assert.equal(record.id, "osm-node-42");
  assert.equal(record.type, "viewpoint");
  assert.deepEqual(record.sources.map((s) => s.family), ["map", "open_knowledge"]);
  // open_knowledge is NOT community — must not inherit community/local calibration
  assert.ok(!record.sources.some((s) => s.family === "community"));
  assert.match(record.sources[1].url, /wikidata\.org\/wiki\/Q123/);
});

test("OSM element without wikidata stays single-family (will be gated out downstream)", () => {
  const record = mapOsmElement({
    type: "node",
    id: 43,
    lat: 41.9,
    lon: 12.5,
    tags: { name: "Lone Cafe", amenity: "cafe" },
  });
  assert.deepEqual(record.sources.map((s) => s.family), ["map"]);
});

test("a malformed wikidata tag does not add a second source", () => {
  const record = mapOsmElement({
    type: "node",
    id: 44,
    lat: 41.9,
    lon: 12.5,
    tags: { name: "X", tourism: "viewpoint", wikidata: "not-an-entity" },
  });
  assert.deepEqual(record.sources.map((s) => s.family), ["map"]);
});

test("OSM brand tag yields chain:true + brand name; absence yields chain:false (#272)", () => {
  const chain = mapOsmElement({
    type: "node",
    id: 50,
    lat: 55.6,
    lon: 13.0,
    tags: { name: "Burger King", amenity: "fast_food", brand: "Burger King", "brand:wikidata": "Q177054" },
  });
  assert.equal(chain.chain, true);
  assert.equal(chain.brand, "Burger King");

  // brand:wikidata alone still marks a chain (some elements lack the text tag)
  const wikidataOnly = mapOsmElement({
    type: "node",
    id: 51,
    lat: 55.6,
    lon: 13.0,
    tags: { name: "Subway", amenity: "fast_food", "brand:wikidata": "Q244457" },
  });
  assert.equal(wikidataOnly.chain, true);
  assert.equal(wikidataOnly.brand, null);

  const local = mapOsmElement({
    type: "node",
    id: 52,
    lat: 55.6,
    lon: 13.0,
    tags: { name: "Orvars Korvar", amenity: "fast_food" },
  });
  assert.equal(local.chain, false);
  assert.equal(local.brand, null);

  // whitespace-only brand is not a chain signal
  const blank = mapOsmElement({
    type: "node",
    id: 53,
    lat: 55.6,
    lon: 13.0,
    tags: { name: "Kiosk", amenity: "cafe", brand: "   " },
  });
  assert.equal(blank.chain, false);
});

test("records without a name or coordinates are dropped", () => {
  assert.equal(mapOsmElement({ type: "node", id: 1, lat: 1, lon: 1, tags: { tourism: "viewpoint" } }), null);
  assert.equal(mapOsmElement({ type: "node", id: 1, tags: { name: "X", tourism: "viewpoint" } }), null);
});

test("non-intent-mapped OSM tags are dropped", () => {
  assert.equal(
    mapOsmElement({ type: "node", id: 1, lat: 1, lon: 1, tags: { name: "Bench", amenity: "bench" } }),
    null,
  );
});

test("ways resolve coordinates from center", () => {
  const record = mapOsmElement({
    type: "way",
    id: 7,
    center: { lat: 41.9, lon: 12.5 },
    tags: { name: "Market Sq", amenity: "marketplace" },
  });
  assert.equal(record.id, "osm-way-7");
  assert.equal(record.lat, 41.9);
  assert.equal(record.type, "market");
});

test("mapOverpassResponse dedupes by exact id and respects the limit", () => {
  const el = { type: "node", id: 9, lat: 1, lon: 1, tags: { name: "A", tourism: "viewpoint" } };
  const records = mapOverpassResponse({ elements: [el, el, { type: "node", id: 10, lat: 1, lon: 1, tags: { name: "B", amenity: "bar" } }] }, 25);
  assert.equal(records.length, 2); // duplicate id collapsed
  const limited = mapOverpassResponse({ elements: [el, { type: "node", id: 10, lat: 1, lon: 1, tags: { name: "B", amenity: "bar" } }] }, 1);
  assert.equal(limited.length, 1);
});

// --- loader: injection + fail closed --------------------------------------

test("no fetcher → no loader (honest fail closed)", () => {
  assert.equal(createOpenDataLoader({ fetcher: null }), null);
});

test("injected fetcher maps an Overpass payload into records (no live network)", async () => {
  let calledUrl = null;
  const fetcher = async (url, opts) => {
    calledUrl = url;
    assert.match(opts.body, /data=/); // posts the query
    return { ok: true, json: async () => ({ elements: [{ type: "node", id: 42, lat: 41.9, lon: 12.5, tags: { name: "V", tourism: "viewpoint", wikidata: "Q1" } }] }) };
  };
  const loader = createOpenDataLoader({ fetcher });
  const records = await loader({ lat: 41.9, lng: 12.5 });
  assert.equal(records.length, 1);
  assert.equal(records[0].id, "osm-node-42");
  assert.ok(calledUrl.includes("overpass"));
});

test("loader sends an identifying User-Agent (Overpass returns 406 without one)", async () => {
  let capturedHeaders = null;
  const fetcher = async (_url, opts) => {
    capturedHeaders = opts.headers;
    return { ok: true, json: async () => ({ elements: [] }) };
  };
  const loader = createOpenDataLoader({ fetcher });
  await loader({ lat: 41.9, lng: 12.5 });
  assert.equal(capturedHeaders["User-Agent"], DEFAULT_USER_AGENT);
  assert.match(capturedHeaders["User-Agent"], /^Parranda\/1\.0 \(\+https:\/\//);
  assert.equal(capturedHeaders.Accept, "application/json");

  let customHeaders = null;
  const custom = createOpenDataLoader({
    fetcher: async (_url, opts) => { customHeaders = opts.headers; return { ok: true, json: async () => ({ elements: [] }) }; },
    userAgent: "Parranda-Test/0.1 (+https://example.test)",
  });
  await custom({ lat: 41.9, lng: 12.5 });
  assert.equal(customHeaders["User-Agent"], "Parranda-Test/0.1 (+https://example.test)");
});

test("loader UA is identical to the resolver UA (one app identity, no ad-hoc strings)", () => {
  const resolver = require("../server/place-candidates/place-resolver");
  assert.equal(DEFAULT_USER_AGENT, resolver.DEFAULT_USER_AGENT);
});

test("default timeout stays realistic for live Overpass latency (4-6s observed)", () => {
  const { DEFAULT_TIMEOUT_MS } = require("../server/place-candidates/open-data-loader");
  // 5s silently turned dense areas into loaded:0; keep headroom above real latency.
  assert.ok(DEFAULT_TIMEOUT_MS >= 10000, `DEFAULT_TIMEOUT_MS ${DEFAULT_TIMEOUT_MS} < 10000`);
});

test("non-200 response fails closed with inspectable loader_error status", async () => {
  const loader = createOpenDataLoader({ fetcher: async () => ({ ok: false, status: 429 }) });
  const records = await loader({ lat: 1, lng: 1 });
  assert.deepEqual(records, []);
  assert.equal(records.loader_status, "error_failed_closed");
  assert.equal(records.loader_error, "http_non_200");
});

test("a thrown fetch error (incl. abort/timeout) fails closed with inspectable timeout/fetch status", async () => {
  const loader = createOpenDataLoader({
    fetcher: async () => {
      const error = new Error("AbortError");
      error.name = "AbortError";
      throw error;
    },
  });
  const records = await loader({ lat: 1, lng: 1 });
  assert.deepEqual(records, []);
  assert.equal(records.loader_status, "error_failed_closed");
  assert.equal(records.loader_error, "timeout_or_abort");
});

test("a JSON parse failure fails closed with inspectable parse status", async () => {
  const loader = createOpenDataLoader({
    fetcher: async () => ({ ok: true, json: async () => { throw new Error("bad json"); } }),
  });
  const records = await loader({ lat: 1, lng: 1 });
  assert.deepEqual(records, []);
  assert.equal(records.loader_status, "error_failed_closed");
  assert.equal(records.loader_error, "parse_error");
});

test("genuine empty Overpass response remains loaded:0, not loader_error", async () => {
  const loader = createOpenDataLoader({ fetcher: async () => ({ ok: true, json: async () => ({ elements: [] }) }) });
  const records = await loader({ lat: 1, lng: 1 });
  assert.deepEqual(records, []);
  assert.equal(records.loader_status, "loaded:0");
  assert.equal(records.loader_error, null);
});

test("invalid coordinates return no records without calling the fetcher", async () => {
  let called = false;
  const loader = createOpenDataLoader({ fetcher: async () => { called = true; return { ok: true, json: async () => ({}) }; } });
  assert.deepEqual(await loader({ lat: NaN, lng: 1 }), []);
  assert.equal(called, false);
});

// --- bounded query ---------------------------------------------------------

test("the Overpass query is bounded by radius and limit", () => {
  const q = buildOverpassQuery({ lat: 41.9, lng: 12.5, radiusM: 1000, limit: 25 });
  assert.match(q, /around:1000,41\.9,12\.5/);
  assert.match(q, /out center 25;/);
});

test("radius and limit are clamped to safe maxima", async () => {
  let body = "";
  const fetcher = async (_url, opts) => {
    body = opts.body;
    return { ok: true, json: async () => ({ elements: [] }) };
  };
  const loader = createOpenDataLoader({ fetcher, radiusKm: 999, limit: 100000 });
  await loader({ lat: 41.9, lng: 12.5 });
  assert.ok(body.includes(`around%3A${MAX_RADIUS_KM * 1000}`) || decodeURIComponent(body).includes(`around:${MAX_RADIUS_KM * 1000}`));
});

// --- env-gated default -----------------------------------------------------

test("resolveDefaultOpenDataLoader is off unless explicitly enabled", () => {
  assert.equal(resolveDefaultOpenDataLoader({}), null);
  assert.equal(resolveDefaultOpenDataLoader({ PARRANDA_OPEN_DATA_LOADER: "no" }), null);
  // when enabled, returns a loader IF the runtime has a global fetch
  const enabled = resolveDefaultOpenDataLoader({ PARRANDA_OPEN_DATA_LOADER: "enabled" });
  assert.ok(enabled === null || typeof enabled === "function");
});
