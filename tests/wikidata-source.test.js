/**
 * Wikidata open-knowledge place source (the second open source family) +
 * its composition with the OSM open-data loader.
 *
 * The point of a second INDEPENDENT family: a place returned by both OSM and
 * Wikidata merges (entity-resolution) into one candidate carrying `map` +
 * `open_knowledge`, which lifts it past the single-family ceiling. These tests
 * cover the source's mapping/typing/fail-closed contract and that the composed
 * loader actually emits both families. No live network — fetchers are injected.
 * (The merge-unions-families mechanism itself is covered by entity-resolution
 * tests; here we prove the source produces correctly-shaped, mergeable records.)
 */

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  createWikidataSource,
  buildWikidataQuery,
  mapWikidataResponse,
  mapWikidataBinding,
} = require("../server/place-candidates/wikidata-source");
const { resolveDefaultOpenDataLoader, mapOsmElement } = require("../server/place-candidates/open-data-loader");
const { mapRecordToCandidate } = require("../server/place-candidates/external-open-provider");
const { resolveCandidateIdentity } = require("../server/candidates/entity-resolution");

const ORIGINAL_FETCH = global.fetch;

function binding({ qid = "Q1000001", label = "Test Museum", lat = "41.9", lng = "12.5", classRoot = "Q33506" } = {}) {
  return {
    item: { value: `http://www.wikidata.org/entity/${qid}` },
    itemLabel: { value: label },
    lat: { value: lat },
    lng: { value: lng },
    classRoot: { value: `http://www.wikidata.org/entity/${classRoot}` },
  };
}

function sparqlResponse(bindings) {
  return { ok: true, json: async () => ({ results: { bindings } }) };
}

// --- mapping + typing ------------------------------------------------------

test("maps a typed binding into an open_knowledge record with the mapped engine type", () => {
  const sourceBinding = binding({
    qid: "Q5264288",
    label: "Design Museum",
    classRoot: "Q33506",
  });
  sourceBinding.website = { value: "https://museum.example/whats-on" };
  const r = mapWikidataBinding(sourceBinding);
  assert.equal(r.id, "wikidata-Q5264288");
  assert.equal(r.name, "Design Museum");
  assert.equal(r.type, "museum");
  assert.equal(r.sources[0].family, "open_knowledge");
  assert.equal(r.sources[0].provider, "wikidata");
  assert.equal(r.sources[0].license, "CC0-1.0");
  assert.equal(r.city_pack_owned, false);
  assert.equal(r.human_verified, false);
  assert.equal(r.website, "https://museum.example/whats-on");
});

test("each curated class maps to its engine type; an unmapped class is dropped", () => {
  assert.equal(mapWikidataBinding(binding({ classRoot: "Q1007870" })).type, "gallery");
  assert.equal(mapWikidataBinding(binding({ classRoot: "Q22698" })).type, "park");
  assert.equal(mapWikidataBinding(binding({ classRoot: "Q330284" })).type, "market");
  // A class not in the curated map (e.g. archaeological site / settlement) → null.
  assert.equal(mapWikidataBinding(binding({ classRoot: "Q839954" })), null);
});

test("drops a binding with no usable label (label service echoes the QID), or no coords", () => {
  assert.equal(mapWikidataBinding(binding({ qid: "Q999", label: "Q999" })), null); // label === qid
  assert.equal(mapWikidataBinding(binding({ label: "" })), null);
  assert.equal(mapWikidataBinding({ item: { value: "http://www.wikidata.org/entity/Q1" }, itemLabel: { value: "X" }, classRoot: { value: "http://www.wikidata.org/entity/Q33506" } }), null); // no coords
});

test("mapWikidataResponse dedupes by id and honors the limit", () => {
  const records = mapWikidataResponse(
    { results: { bindings: [binding({ qid: "Q1" }), binding({ qid: "Q1" }), binding({ qid: "Q2" }), binding({ qid: "Q3" })] } },
    2,
  );
  assert.deepEqual(records.map((r) => r.id), ["wikidata-Q1", "wikidata-Q2"]);
});

test("the query is typed (curated VALUES), centered, bounded, and label-language prioritized", () => {
  const q = buildWikidataQuery({ lat: 37.98, lng: 23.72, radiusKm: 1.5, limit: 25, labelLangs: ["el", "en"] });
  assert.match(q, /wikibase:around/);
  assert.match(q, /VALUES \?classRoot \{ wd:Q33506/);
  assert.match(q, /wdt:P31\/wdt:P279\* \?classRoot/);
  assert.match(q, /OPTIONAL \{ \?item wdt:P856 \?website/);
  assert.match(q, /Point\(23\.72 37\.98\)/);
  assert.match(q, /wikibase:language "el,en"/);
  assert.match(q, /LIMIT 25/);
});

// --- source fetch + fail-closed --------------------------------------------

test("createWikidataSource maps an injected SPARQL response into records", async () => {
  const source = createWikidataSource({
    fetcher: async () => sparqlResponse([binding({ qid: "Q1", label: "Museo", classRoot: "Q33506" })]),
    labelLanguages: ["el", "en"],
  });
  const records = await source({ lat: 41.9, lng: 12.5 });
  assert.equal(records.length, 1);
  assert.equal(records[0].type, "museum");
  assert.equal(records[0].sources[0].family, "open_knowledge");
});

test("fail-closed: non-200, parse error, abort, and invalid coords all yield []", async () => {
  const non200 = createWikidataSource({ fetcher: async () => ({ ok: false, status: 500 }) });
  assert.deepEqual(await non200({ lat: 1, lng: 1 }), []);

  const badJson = createWikidataSource({ fetcher: async () => ({ ok: true, json: async () => { throw new Error("bad"); } }) });
  assert.deepEqual(await badJson({ lat: 1, lng: 1 }), []);

  const threw = createWikidataSource({ fetcher: async () => { throw Object.assign(new Error("x"), { name: "AbortError" }); } });
  assert.deepEqual(await threw({ lat: 1, lng: 1 }), []);

  let called = false;
  const source = createWikidataSource({ fetcher: async () => { called = true; return sparqlResponse([]); } });
  assert.deepEqual(await source({ lat: NaN, lng: 1 }), []);
  assert.equal(called, false, "invalid coords must not call the network");
});

test("no fetcher → no source (honest fail closed)", () => {
  assert.equal(createWikidataSource({ fetcher: null }), null);
});

// --- composition: both families through the real loader factory ------------

test("composed loader serves OSM immediately and adds the Wikidata family on the repeat request (background warm)", async () => {
  // Route the stubbed global fetch by URL: Overpass endpoint vs WDQS endpoint.
  global.fetch = async (url) => {
    if (String(url).includes("overpass")) {
      return { ok: true, json: async () => ({ elements: [{ type: "node", id: 7, lat: 41.9, lon: 12.5, tags: { name: "Local Cafe", amenity: "cafe" } }] }) };
    }
    if (String(url).includes("wikidata")) {
      return sparqlResponse([binding({ qid: "Q100", label: "National Museum", lat: "41.9009", lng: "12.5009", classRoot: "Q33506" })]);
    }
    return { ok: false, status: 404 };
  };
  try {
    const loader = resolveDefaultOpenDataLoader({ PARRANDA_OPEN_DATA_LOADER: "enabled", PARRANDA_WIKIDATA_SOURCE: "enabled" });

    // First request: OSM immediately, Wikidata is warmed out-of-band (never blocks).
    const first = await loader({ lat: 41.9, lng: 12.5 });
    assert.ok(first.some((r) => r.id.startsWith("osm-")), "OSM present on first request");
    assert.ok(!first.some((r) => r.id.startsWith("wikidata-")), "Wikidata does not block the first request");

    // Let the background warm settle, then the repeat request includes both families.
    await new Promise((r) => setTimeout(r, 0));
    const second = await loader({ lat: 41.9, lng: 12.5 });
    const families = new Set(second.flatMap((r) => (r.sources || []).map((s) => s.family)));
    assert.ok(second.some((r) => r.id.startsWith("wikidata-")), "Wikidata present on the repeat request");
    assert.ok(families.has("map") && families.has("open_knowledge"), "both source families present on the repeat request");
  } finally {
    global.fetch = ORIGINAL_FETCH;
  }
});

// --- consensus: the whole point ---------------------------------------------

test("consensus: an OSM place and a Wikidata place at the same location merge into ONE candidate carrying BOTH families", () => {
  const cityConfig = { key: "athens" };
  const now = "2026-06-23T10:00:00Z";
  // The SAME real place from two independent open sources. The OSM element has
  // NO wikidata tag, so its only family is `map` — the second family can only
  // come from the independent Wikidata source. Identical name + ~2 m apart +
  // same museum bucket → entity-resolution merges them.
  const osmRecord = mapOsmElement({ type: "node", id: 555, lat: 37.9839, lon: 23.7276, tags: { name: "Επιγραφικό μουσείο", tourism: "museum" } });
  const wikiRecord = mapWikidataBinding(binding({ qid: "Q1768487", label: "Επιγραφικό μουσείο", lat: "37.98392", lng: "23.72761", classRoot: "Q33506" }));
  assert.ok(osmRecord, "OSM record maps");
  assert.ok(wikiRecord, "Wikidata record maps");
  assert.deepEqual(osmRecord.sources.map((s) => s.family), ["map"], "OSM record is single-family map (no wikidata tag)");
  assert.deepEqual(wikiRecord.sources.map((s) => s.family), ["open_knowledge"], "Wikidata record is open_knowledge");

  const osmCandidate = mapRecordToCandidate(cityConfig, osmRecord, now, 0);
  const wikiCandidate = mapRecordToCandidate(cityConfig, wikiRecord, now, 1);
  const result = resolveCandidateIdentity([osmCandidate, wikiCandidate], { now });

  assert.equal(result.summary.merged_count, 1, "the two independent open-source records merge into one place");
  const survivor = result.candidates[0];
  const families = new Set((survivor.evidence || []).map((e) => e.source_ref && e.source_ref.source_family));
  assert.ok(families.has("map") && families.has("open_knowledge"), "merged candidate carries BOTH families → real cross-source consensus");
});

test("Wikidata source stays OFF unless its flag is set (loader is OSM-only)", async () => {
  global.fetch = async (url) => {
    if (String(url).includes("overpass")) return { ok: true, json: async () => ({ elements: [] }) };
    return { ok: false, status: 404 };
  };
  try {
    const loader = resolveDefaultOpenDataLoader({ PARRANDA_OPEN_DATA_LOADER: "enabled" }); // no wikidata flag
    const records = await loader({ lat: 41.9, lng: 12.5 });
    assert.ok(!records.some((r) => r.id.startsWith("wikidata-")), "no Wikidata records when flag unset");
  } finally {
    global.fetch = ORIGINAL_FETCH;
  }
});
