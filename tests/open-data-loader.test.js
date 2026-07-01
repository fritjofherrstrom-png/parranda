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

test("broadened OSM coverage maps to existing recognized types (no new vocab, generic for every city)", () => {
  const cases = [
    [{ shop: "bakery" }, "cafe", "fika"],
    [{ shop: "coffee" }, "cafe", "fika"],
    [{ amenity: "ice_cream" }, "cafe", "fika"],
    [{ shop: "vintage" }, "vintage-shop", "vintage"],
    [{ leisure: "nature_reserve" }, "park", "green"],
    [{ amenity: "arts_centre" }, "gallery", "kultur"],
  ];
  for (const [tags, type, tag] of cases) {
    const record = mapOsmElement({ type: "node", id: 1, lat: 41.9, lon: 12.5, tags: { name: "X", ...tags } });
    assert.equal(record && record.type, type, JSON.stringify(tags));
    assert.ok(record.tags.includes(tag), `${JSON.stringify(tags)} carries ${tag}`);
  }
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

test("scenic place types beyond viewpoint are mapped to vocab-known scenic types (#273)", () => {
  const cases = [
    [{ leisure: "park" }, "park"],
    [{ leisure: "garden" }, "garden"],
    [{ historic: "castle" }, "castle"],
    [{ leisure: "marina" }, "promenade"],
    [{ man_made: "pier" }, "promenade"],
  ];
  for (const [tag, expectedType] of cases) {
    const record = mapOsmElement({ type: "node", id: 100, lat: 55.6, lon: 13.0, tags: { name: "X", ...tag } });
    assert.ok(record, `expected a record for ${JSON.stringify(tag)}`);
    assert.equal(record.type, expectedType, `${JSON.stringify(tag)} → ${expectedType}`);
  }
});

test("loader-emitted scenic types match the scenic intent (viewpoint covers, the rest are adjacent) (#273)", () => {
  const { matchCandidateToIntent } = require("../server/candidates/intent-vocabulary");
  // viewpoint is the canonical (covering) scenic type
  assert.equal(matchCandidateToIntent({ type: "viewpoint", tags: [] }, "scenic").level, "strong");
  // the broadened loader types are genuine-but-adjacent scenic matches — enough
  // to fill an otherwise-empty scenic role in the agnostic experiment, while a
  // viewpoint still outranks them. They must NOT have become strong (that would
  // change curated/citypack scoring).
  for (const type of ["park", "garden", "promenade", "castle"]) {
    const m = matchCandidateToIntent({ type, tags: [] }, "scenic");
    assert.ok(m.strength > 0, `${type} should at least adjacent-match scenic`);
    assert.notEqual(m.level, "strong", `${type} must stay adjacent, not strong (shared scoring unchanged)`);
  }
});

test("category-balanced selection keeps a scarce scenic record out of a food-dense response (#273)", () => {
  const elements = [];
  for (let i = 0; i < 40; i += 1) {
    elements.push({ type: "node", id: i, lat: 55.6, lon: 13.0, tags: { name: `Rest ${i}`, amenity: "restaurant" } });
  }
  // One park, last in the response — a naive head-of-list cap would drop it.
  elements.push({ type: "node", id: 999, lat: 55.6, lon: 13.0, tags: { name: "Kungsparken", leisure: "park" } });
  const out = mapOverpassResponse({ elements }, 25);
  assert.equal(out.length, 25);
  assert.ok(out.some((r) => r.type === "park"), "the lone park must survive category balancing");
});

test("balancing is a no-op when the response already fits the limit (#273)", () => {
  const elements = [
    { type: "node", id: 1, lat: 55.6, lon: 13.0, tags: { name: "A", amenity: "restaurant" } },
    { type: "node", id: 2, lat: 55.6, lon: 13.0, tags: { name: "B", leisure: "park" } },
  ];
  const out = mapOverpassResponse({ elements }, 25);
  assert.deepEqual(out.map((r) => r.id), ["osm-node-1", "osm-node-2"]); // order preserved
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

// --- configurable Overpass mirror failover (deploy-set HA, default single) --

test("a configured mirror set fails over on error (HA) — second mirror rescues the load", async () => {
  const calls = [];
  // Rich, varied result so the load isn't thin (no aperture expansion muddying
  // the failover assertion).
  const kinds = [{ amenity: "cafe" }, { amenity: "bar" }, { tourism: "museum" }, { leisure: "park" }];
  const rich = { elements: Array.from({ length: 15 }, (_, i) => ({ type: "node", id: i + 1, lat: 41.9 + i * 0.001, lon: 12.5, tags: { name: `P${i}`, ...kinds[i % kinds.length] } })) };
  const fetcher = async (endpoint) => {
    calls.push(endpoint);
    if (calls.length === 1) throw new Error("primary cold/overloaded"); // first mirror down
    return { ok: true, json: async () => rich };
  };
  const loader = createOpenDataLoader({ fetcher, endpoints: ["https://m1/overpass", "https://m2/overpass"] });
  const records = await loader({ lat: 41.9, lng: 12.5 });
  assert.ok(records.length >= 12, "records recovered from the second mirror");
  assert.deepEqual(calls, ["https://m1/overpass", "https://m2/overpass"], "primary failed → fallback tried; rich → no expansion");
});

test("the DEFAULT endpoint set is primary-only — no failover to slow public mirrors", async () => {
  // Public fallback mirrors measured 60-77 s; defaulting to them only adds latency
  // for no rescue. Failover is opt-in via an explicit endpoints/PARRANDA_OVERPASS_ENDPOINTS.
  let calls = 0;
  const loader = createOpenDataLoader({ fetcher: async () => { calls += 1; throw new Error("down"); } });
  const records = await loader({ lat: 41.9, lng: 12.5 });
  assert.deepEqual(records, []);
  assert.equal(calls, 1, "default does not fan out to public fallback mirrors");
});

test("a genuine empty 200 does NOT fail over to the fallback mirror", async () => {
  const calls = [];
  const loader = createOpenDataLoader({
    endpoints: ["https://m1/overpass", "https://m2/overpass"],
    fetcher: async (endpoint) => { calls.push(endpoint); return { ok: true, json: async () => ({ elements: [] }) }; },
  });
  const records = await loader({ lat: 1, lng: 1 });
  assert.deepEqual(records, []);
  assert.equal(records.loader_status, "loaded:0");
  // Empty is a real answer, not a failover trigger → the fallback mirror is never hit.
  assert.ok(!calls.includes("https://m2/overpass"), "an empty 200 never fails over to another mirror");
  // (An empty first pass does trigger ONE wider-radius expansion — on the SAME primary.)
  assert.deepEqual(calls, ["https://m1/overpass", "https://m1/overpass"], "primary tried at default + expanded radius, no fallover");
});

// --- thin-city aperture expansion (supply density) -------------------------

// A fetcher whose result depends on the query radius (the body is url-encoded, so
// decode before matching). Rich only at the wider 3 km radius.
function radiusVaryingFetcher({ thin, rich }) {
  let calls = 0;
  const kinds = [{ amenity: "cafe" }, { amenity: "restaurant" }, { amenity: "bar" }, { tourism: "museum" }, { leisure: "park" }];
  const els = (n) => Array.from({ length: n }, (_, i) => ({ type: "node", id: i + 1, lat: 1 + i * 0.001, lon: 1, tags: { name: `P${i}`, ...kinds[i % kinds.length] } }));
  const fetcher = async (_url, opts) => {
    calls += 1;
    const wide = /around:3000/.test(decodeURIComponent(opts.body));
    return { ok: true, json: async () => ({ elements: els(wide ? rich : thin) }) };
  };
  fetcher.calls = () => calls;
  return fetcher;
}

test("a THIN first pass expands the radius once and keeps the richer wider result", async () => {
  const fetcher = radiusVaryingFetcher({ thin: 5, rich: 20 });
  const loader = createOpenDataLoader({ fetcher, endpoint: "https://x/overpass" });
  const records = await loader({ lat: 59.44, lng: 24.75 });
  assert.equal(records.length, 20, "the wider pass's richer supply is returned");
  assert.equal(records.loader_status, "loaded:20");
  assert.equal(fetcher.calls(), 2, "one expansion query, not more");
});

test("a RICH first pass never expands (no wasted second query)", async () => {
  const fetcher = radiusVaryingFetcher({ thin: 5, rich: 20 });
  const loader = createOpenDataLoader({ fetcher, endpoint: "https://x/overpass" });
  const records = await loader({ lat: 41.9, lng: 12.5 }); // first pass = 25 (rich) below
  // Force a rich first pass by making both radii rich:
  const richFetcher = radiusVaryingFetcher({ thin: 25, rich: 25 });
  const richLoader = createOpenDataLoader({ fetcher: richFetcher, endpoint: "https://x/overpass" });
  const rich = await richLoader({ lat: 41.9, lng: 12.5 });
  assert.equal(rich.length, 25);
  assert.equal(richFetcher.calls(), 1, "a rich first pass is not expanded");
  void records;
});

test("expansion is kept ONLY when actually richer — else the first pass stands", async () => {
  const fetcher = radiusVaryingFetcher({ thin: 4, rich: 3 }); // wider is NOT richer
  const loader = createOpenDataLoader({ fetcher, endpoint: "https://x/overpass" });
  const records = await loader({ lat: 1, lng: 1 });
  assert.equal(records.length, 4, "the (better) first pass is kept");
  assert.equal(fetcher.calls(), 2, "it still tried the wider radius once");
});

test("a thin pass caused by few CATEGORIES (not few records) still expands", async () => {
  // 15 records but all one type → thin by category even though count is high.
  let calls = 0;
  const fetcher = async (_url, opts) => {
    calls += 1;
    const wide = /around:3000/.test(decodeURIComponent(opts.body));
    const n = wide ? 8 : 15;
    const tag = wide ? (i) => [{ amenity: "cafe" }, { amenity: "bar" }, { tourism: "museum" }][i % 3] : () => ({ amenity: "cafe" });
    const els = Array.from({ length: n }, (_, i) => ({ type: "node", id: i + 1, lat: 1 + i * 0.001, lon: 1, tags: { name: `P${i}`, ...tag(i) } }));
    return { ok: true, json: async () => ({ elements: els }) };
  };
  const loader = createOpenDataLoader({ fetcher, endpoint: "https://x/overpass" });
  const records = await loader({ lat: 1, lng: 1 });
  assert.equal(calls, 2, "single-category first pass is thin → expands for variety");
  assert.ok(records.some((r) => r.type === "bar") && records.some((r) => r.type === "museum"), "the wider pass added variety");
});

// --- bounded query ---------------------------------------------------------

test("the Overpass query is bounded by radius and uses per-category out budgets (#273)", () => {
  const q = buildOverpassQuery({ lat: 41.9, lng: 12.5, radiusM: 1000, limit: 25 });
  assert.match(q, /around:1000,41\.9,12\.5/);
  // Per-category set + out (so area-typed scenic ways are not starved by nodes).
  assert.match(q, /->\.c0;\.c0 out center \d+;/);
  assert.ok((q.match(/out center \d+;/g) || []).length >= 2, "multiple category out budgets");
  // Scenic and food tags are both present.
  assert.match(q, /leisure"="park"/);
  assert.match(q, /amenity"="restaurant"/);
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
