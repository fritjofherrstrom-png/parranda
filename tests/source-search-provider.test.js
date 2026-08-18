"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  createSearxngSourceSearch,
  resolveDefaultSourceSearch,
} = require("../server/pulse-sources/source-search-provider");

function response(body, {
  status = 200,
  url = "http://searxng:8080/search",
  headers = {},
  text = null,
} = {}) {
  const normalizedHeaders = new Map(
    Object.entries(headers).map(([key, value]) => [key.toLowerCase(), String(value)]),
  );
  return {
    ok: status >= 200 && status < 300,
    status,
    url,
    headers: {
      get: (key) => normalizedHeaders.get(String(key).toLowerCase()) || null,
    },
    text: text || (async () => body),
  };
}

test("source search is default-off and requires an operator endpoint", () => {
  assert.equal(resolveDefaultSourceSearch({}), null);
  assert.equal(resolveDefaultSourceSearch({ PARRANDA_SOURCE_SEARCH: "enabled" }), null);
  assert.equal(resolveDefaultSourceSearch({
    PARRANDA_SOURCE_SEARCH: "disabled",
    PARRANDA_SOURCE_SEARCH_ENDPOINT: "http://searxng:8080/search",
  }), null);
});

test("SearXNG search stays bounded and returns only low-trust public seeds", async () => {
  const requests = [];
  const search = createSearxngSourceSearch({
    endpoint: "http://searxng:8080/search",
    maxQueries: 1,
    maxResultsPerQuery: 8,
    maxSeeds: 4,
    maxResultsPerOrigin: 2,
    fetcher: async (url, options) => {
      requests.push({ url, options });
      return response(JSON.stringify({
        results: [
          { url: "https://calendar.example/events/one", title: "<b>Local calendar</b>" },
          { url: "https://calendar.example/events/two", title: "Second listing" },
          { url: "https://calendar.example/events/three", title: "Origin cap" },
          { url: "https://venue.example/program", title: "Venue programme", content: "must-not-leak" },
          { url: "http://127.0.0.1/private", title: "Private" },
          { url: "https://user:secret@unsafe.example/events", title: "Credentials" },
          { url: "http://searxng:8080/search?q=loop", title: "Search loop" },
        ],
      }));
    },
  });

  const result = await search({
    queries: ["Northport events", "must not run"],
    place: { label: "Northport", language_hints: ["sv"] },
  });

  assert.equal(requests.length, 1);
  const requestUrl = new URL(requests[0].url);
  assert.equal(requestUrl.origin, "http://searxng:8080");
  assert.equal(requestUrl.searchParams.get("q"), "Northport events");
  assert.equal(requestUrl.searchParams.get("format"), "json");
  assert.equal(requestUrl.searchParams.get("categories"), "general");
  assert.equal(requestUrl.searchParams.get("language"), "sv");
  assert.equal(requests[0].options.redirect, "manual");
  assert.equal(result.status, "complete");
  assert.deepEqual(result.seeds.map((seed) => seed.url), [
    "https://calendar.example/events/one",
    "https://calendar.example/events/two",
    "https://venue.example/program",
  ]);
  assert.equal(result.seeds[0].label, "Local calendar");
  assert.equal(result.seeds[0].family, "unknown_source_family");
  assert.equal(result.seeds[0].trust_tier, "unknown");
  assert.equal(result.seeds[0].discovery_method, "bounded_source_search");
  assert.equal(result.activation_performed, false);
  assert.doesNotMatch(JSON.stringify(result), /must-not-leak|secret@|content|event_rows|feeds/);
});

test("source search caches successful query outcomes", async () => {
  const values = new Map();
  let fetchCalls = 0;
  const cache = {
    get: async (key, producer, options) => {
      if (values.has(key)) return values.get(key);
      const value = await producer();
      if (options.shouldStore(value)) values.set(key, value);
      return value;
    },
  };
  const search = createSearxngSourceSearch({
    endpoint: "https://search.example/search",
    cache,
    fetcher: async () => {
      fetchCalls += 1;
      return response(JSON.stringify({
        results: [{ url: "https://events.example/calendar", title: "Events" }],
      }), { url: "https://search.example/search" });
    },
  });

  await search({ queries: ["Southbay calendar"], place: { label: "Southbay" } });
  await search({ queries: ["Southbay calendar"], place: { label: "Southbay" } });
  assert.equal(fetchCalls, 1);
});

test("source search rejects cross-origin redirects and sanitizes failures", async () => {
  const redirected = createSearxngSourceSearch({
    endpoint: "https://search.example/search",
    fetcher: async () => response("", {
      status: 302,
      url: "https://search.example/search",
      headers: { location: "https://secret.example/search?credential=hidden" },
    }),
  });
  const redirectResult = await redirected({ queries: ["Test events"] });
  assert.equal(redirectResult.status, "failed");
  assert.equal(redirectResult.query_outcomes[0].reason, "source_search_cross_origin_redirect");
  assert.doesNotMatch(JSON.stringify(redirectResult), /secret|credential|hidden/);

  const throws = createSearxngSourceSearch({
    endpoint: "https://search.example/search",
    fetcher: async () => {
      throw new Error("https://secret.example?token=credential");
    },
  });
  const failure = await throws({ queries: ["Test events"] });
  assert.equal(failure.status, "failed");
  assert.equal(failure.query_outcomes[0].reason, "source_search_fetch_failed");
  assert.doesNotMatch(JSON.stringify(failure), /secret|token|credential/);
});

test("malformed and hanging response bodies fail soft", async () => {
  const malformed = createSearxngSourceSearch({
    endpoint: "https://search.example/search",
    fetcher: async () => response("not-json", { url: "https://search.example/search" }),
  });
  const malformedResult = await malformed({ queries: ["Test events"] });
  assert.equal(malformedResult.status, "failed");
  assert.equal(malformedResult.query_outcomes[0].reason, "source_search_payload_invalid");

  const hanging = createSearxngSourceSearch({
    endpoint: "https://search.example/search",
    timeoutMs: 50,
    fetcher: async () => response("", {
      url: "https://search.example/search",
      text: async () => new Promise(() => {}),
    }),
  });
  const started = Date.now();
  const hangingResult = await hanging({ queries: ["Test events"] });
  assert.equal(hangingResult.status, "failed");
  assert.equal(hangingResult.query_outcomes[0].reason, "source_search_timeout");
  assert.ok(Date.now() - started < 1000);
});

test("SearXNG engine failures never masquerade as a healthy empty search", async () => {
  const unavailable = createSearxngSourceSearch({
    endpoint: "https://search.example/search",
    fetcher: async () => response(JSON.stringify({
      results: [],
      unresponsive_engines: [["bing", "timeout"]],
    }), { url: "https://search.example/search" }),
  });
  const failed = await unavailable({ queries: ["Test events"] });
  assert.equal(failed.status, "failed");
  assert.equal(failed.query_outcomes[0].status, "failed");
  assert.equal(failed.query_outcomes[0].reason, "source_search_engines_unavailable");
  assert.equal(failed.query_outcomes[0].engine_failure_count, 1);

  const partial = createSearxngSourceSearch({
    endpoint: "https://search.example/search",
    fetcher: async () => response(JSON.stringify({
      results: [{ url: "https://calendar.example/events", title: "Calendar" }],
      unresponsive_engines: [["qwant", "captcha"]],
    }), { url: "https://search.example/search" }),
  });
  const partialResult = await partial({ queries: ["Test events"] });
  assert.equal(partialResult.status, "partial");
  assert.equal(partialResult.query_outcomes[0].status, "partial");
  assert.equal(partialResult.seed_count, 1);
});

test("the env factory supports a private self-hosted endpoint", async () => {
  let called = false;
  const search = resolveDefaultSourceSearch({
    PARRANDA_SOURCE_SEARCH: "enabled",
    PARRANDA_SOURCE_SEARCH_ENDPOINT: "http://searxng:8080/search",
    PARRANDA_SOURCE_SEARCH_MAX_QUERIES: "1",
  }, {
    fetcher: async () => {
      called = true;
      return response(JSON.stringify({ results: [] }));
    },
  });
  const result = await search({ queries: ["Test events"] });
  assert.equal(called, true);
  assert.equal(result.status, "empty");
});
