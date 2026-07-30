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

function populationClaim(amount) {
  return {
    rank: "preferred",
    mainsnak: { datavalue: { value: { amount: `+${amount}`, unit: "1" } } },
  };
}

function entity(id, label, lat, lng, language = "sv", population = null) {
  return {
    id,
    labels: { [language]: { language, value: label }, en: { language: "en", value: label } },
    claims: {
      P625: [coordinateClaim(lat, lng)],
      ...(population ? { P1082: [populationClaim(population)] } : {}),
    },
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

test("one nearby same-label cluster disambiguates distant namesakes without losing provider rank", async () => {
  const resolver = createWikidataPlaceResolver({
    fetcher: wikidataFetcher({
      searches: {
        en: [
          { id: "Q727", label: "Amsterdam", match: { language: "en", text: "Amsterdam" } },
          { id: "Q3152900", label: "Amsterdam", match: { language: "en", text: "Amsterdam" } },
          { id: "Q9899", label: "Amsterdam", match: { language: "en", text: "Amsterdam" } },
        ],
      },
      entities: {
        Q727: entity("Q727", "Amsterdam", 52.36667, 4.88333, "en"),
        Q3152900: entity("Q3152900", "Amsterdam", -26.617, 30.667, "en"),
        Q9899: entity("Q9899", "Amsterdam", 52.36666, 4.88334, "en"),
      },
    }),
    languages: ["en"],
  });

  const result = await resolver("Amsterdam", { language: "en" });

  assert.deepEqual(result.map((candidate) => candidate.wikidata_ref), ["Q727", "Q3152900"]);
  assert.deepEqual(result.map((candidate) => candidate.confidence), ["medium", "low"]);
});

test("an extreme population difference can disambiguate exact distant namesakes conservatively", async () => {
  const resolver = createWikidataPlaceResolver({
    fetcher: wikidataFetcher({
      searches: {
        en: [
          { id: "Q90", label: "Paris", match: { language: "en", text: "Paris" } },
          { id: "Q830149", label: "Paris", match: { language: "en", text: "Paris" } },
        ],
      },
      entities: {
        Q90: entity("Q90", "Paris", 48.8566, 2.3522, "en", 2100000),
        Q830149: entity("Q830149", "Paris", 33.6609, -95.5555, "en", 25000),
      },
    }),
    languages: ["en"],
  });

  const result = await resolver("Paris", { language: "en" });

  assert.deepEqual(result.map((candidate) => candidate.confidence), ["medium", "low"]);
  assert.equal(result[0].wikidata_ref, "Q90");
  assert.equal("population" in result[0], false, "population stays private resolution evidence");
});

test("similarly sized distant namesakes remain ambiguous even with population evidence", async () => {
  const resolver = createWikidataPlaceResolver({
    fetcher: wikidataFetcher({
      searches: {
        en: [
          { id: "Q10", label: "Shared", match: { language: "en", text: "Shared" } },
          { id: "Q20", label: "Shared", match: { language: "en", text: "Shared" } },
        ],
      },
      entities: {
        Q10: entity("Q10", "Shared", 39.8, -89.6, "en", 170000),
        Q20: entity("Q20", "Shared", 42.1, -72.5, "en", 120000),
      },
    }),
    languages: ["en"],
  });

  const result = await resolver("Shared", { language: "en" });

  assert.deepEqual(result.map((candidate) => candidate.confidence), ["medium", "medium"]);
});

test("extreme population evidence outranks a duplicated but much smaller namesake", async () => {
  const resolver = createWikidataPlaceResolver({
    fetcher: wikidataFetcher({
      searches: {
        en: [
          { id: "Q1", label: "Example", match: { language: "en", text: "Example" } },
          { id: "Q2", label: "Example", match: { language: "en", text: "Example" } },
          { id: "Q3", label: "Example", match: { language: "en", text: "Example" } },
        ],
      },
      entities: {
        Q1: entity("Q1", "Example", 10, 10, "en", 9000),
        Q2: entity("Q2", "Example", 10.01, 10.01, "en", 10000),
        Q3: entity("Q3", "Example", 50, 20, "en", 500000),
      },
    }),
    languages: ["en"],
  });

  const result = await resolver("Example", { language: "en" });

  assert.deepEqual(result.map((candidate) => candidate.wikidata_ref), ["Q1", "Q3"]);
  assert.deepEqual(result.map((candidate) => candidate.confidence), ["low", "medium"]);
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
