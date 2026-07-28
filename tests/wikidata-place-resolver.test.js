"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  createWikidataPlaceResolver,
  firstEarthCoordinate,
  normalizeLanguages,
} = require("../server/place-candidates/wikidata-place-resolver");

function response(body, ok = true) {
  return { ok, status: ok ? 200 : 503, json: async () => body };
}

function coordinateClaim(lat, lng, globe = "http://www.wikidata.org/entity/Q2") {
  return {
    rank: "normal",
    mainsnak: { datavalue: { value: { latitude: lat, longitude: lng, globe } } },
  };
}

function entity(id, label, lat, lng, language = "sv") {
  return {
    id,
    labels: { [language]: { language, value: label }, en: { language: "en", value: label } },
    claims: { P625: [coordinateClaim(lat, lng)] },
  };
}

function wikidataFetcher({ searches, entities, calls = [] }) {
  return async (rawUrl, options = {}) => {
    const url = new URL(rawUrl);
    const action = url.searchParams.get("action");
    calls.push({ action, language: url.searchParams.get("language"), url: url.toString(), signal: options.signal });
    if (action === "wbsearchentities") {
      const language = url.searchParams.get("language");
      return response({ success: 1, search: searches[language] || [] });
    }
    if (action === "wbgetentities") return response({ success: 1, entities });
    return response({}, false);
  };
}

test("unique exact coordinate-bearing open-knowledge result becomes a conservative medium anchor", async () => {
  const calls = [];
  const resolver = createWikidataPlaceResolver({
    fetcher: wikidataFetcher({
      calls,
      searches: {
        sv: [
          { id: "Q298465", label: "Österlen", match: { language: "sv", text: "Österlen" } },
          { id: "Q98746135", label: "Österlen", match: { language: "sv", text: "Österlen" } },
        ],
      },
      entities: {
        Q298465: entity("Q298465", "Österlen", 55.626388, 14.184722),
        Q98746135: { id: "Q98746135", labels: { sv: { value: "Österlen" } }, claims: {} },
      },
    }),
  });

  const result = await resolver("Österlen", { language: "sv" });

  assert.deepEqual(result, [{
    label: "Österlen",
    lat: 55.626388,
    lng: 14.184722,
    provenance: "wikidata_open_knowledge",
    attribution: "Wikidata contributors",
    license: "CC0-1.0",
    source_tier: "inferred",
    wikidata_ref: "Q298465",
    confidence: "medium",
  }]);
  assert.deepEqual(calls.map((call) => call.action), ["wbsearchentities", "wbgetentities"]);
});

test("multiple exact coordinate-bearing entities remain ambiguous instead of selecting one", async () => {
  const resolver = createWikidataPlaceResolver({
    fetcher: wikidataFetcher({
      searches: {
        en: [
          { id: "Q1", label: "Springfield", match: { language: "en", text: "Springfield" } },
          { id: "Q2", label: "Springfield", match: { language: "en", text: "Springfield" } },
        ],
      },
      entities: {
        Q1: entity("Q1", "Springfield", 39.8, -89.6, "en"),
        Q2: entity("Q2", "Springfield", 42.1, -72.5, "en"),
      },
    }),
    languages: ["en"],
  });

  const result = await resolver("Springfield", { language: "en" });

  assert.equal(result.length, 2);
  assert.deepEqual(result.map((candidate) => candidate.confidence), ["medium", "medium"]);
});

test("fuzzy coordinate-bearing hits stay low and never fabricate regional bounds", async () => {
  const resolver = createWikidataPlaceResolver({
    fetcher: wikidataFetcher({
      searches: {
        en: [{ id: "Q3", label: "Österlen Line", match: { language: "en", text: "Österlen Line" } }],
      },
      entities: { Q3: entity("Q3", "Österlen Line", 55.7, 14.2, "en") },
    }),
    languages: ["en"],
  });

  const [candidate] = await resolver("Österlen", { language: "en" });

  assert.equal(candidate.confidence, "low");
  assert.equal("spatial_scope" in candidate, false);
});

test("request language is tried first and successful results are cached by query + language", async () => {
  const calls = [];
  const resolver = createWikidataPlaceResolver({
    fetcher: wikidataFetcher({
      calls,
      searches: { sv: [{ id: "Q4", label: "Testbygd", match: { language: "sv", text: "Testbygd" } }] },
      entities: { Q4: entity("Q4", "Testbygd", 57, 15) },
    }),
    languages: ["en", "sv"],
  });

  const first = await resolver("Testbygd", { language: "sv" });
  first.push({ tampered: true });
  const second = await resolver("  Testbygd  ", { language: "sv" });

  assert.equal(calls[0].language, "sv");
  assert.equal(calls.length, 2, "one search + one entity request; repeat uses cache");
  assert.equal(second.length, 1, "callers cannot mutate the cached value");
});

test("HTTP, malformed payload, non-Earth geometry, and invalid queries fail closed", async () => {
  const httpFailure = createWikidataPlaceResolver({ fetcher: async () => response({}, false) });
  assert.deepEqual(await httpFailure("Place"), []);

  const malformed = createWikidataPlaceResolver({ fetcher: async () => response({ nope: true }) });
  assert.deepEqual(await malformed("Place"), []);

  assert.equal(firstEarthCoordinate([coordinateClaim(10, 20, "http://www.wikidata.org/entity/Q111")]), null);
  assert.equal(firstEarthCoordinate([coordinateClaim(999, 20)]), null);

  let called = false;
  const resolver = createWikidataPlaceResolver({ fetcher: async () => { called = true; return response({}); } });
  assert.deepEqual(await resolver(" "), []);
  assert.deepEqual(await resolver("x".repeat(201)), []);
  assert.equal(called, false);
});

test("a transient entity-detail failure is not cached as a proven empty result", async () => {
  let detailCalls = 0;
  const resolver = createWikidataPlaceResolver({
    fetcher: async (rawUrl) => {
      const action = new URL(rawUrl).searchParams.get("action");
      if (action === "wbsearchentities") {
        return response({ search: [{ id: "Q5", label: "Region", match: { language: "en", text: "Region" } }] });
      }
      detailCalls += 1;
      if (detailCalls === 1) return response({}, false);
      return response({ entities: { Q5: entity("Q5", "Region", 48, 7, "en") } });
    },
    languages: ["en"],
  });

  assert.deepEqual(await resolver("Region", { language: "en" }), []);
  assert.equal((await resolver("Region", { language: "en" }))[0]?.wikidata_ref, "Q5");
  assert.equal(detailCalls, 2, "a failed detail lookup must be retried instead of cached as empty");
});

test("language normalization is generic, bounded, and adds English when capacity remains", () => {
  assert.deepEqual(normalizeLanguages(["SV", "fr", "sv", "bad value", "de", "es"]), ["sv", "fr", "de"]);
  assert.deepEqual(normalizeLanguages(["sv"]), ["sv", "en"]);
});
