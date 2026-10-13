"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createRequestTimeEventDiscovery } = require("../server/pulse-sources/request-time-event-discovery");
const { createSearxngSourceSearch } = require("../server/pulse-sources/source-search-provider");
const { memoryCache, response, input } = require("./helpers/request-time-review-fixtures");

for (const searchFailure of ["failed", "degraded", "clean", "partial_with_results"]) test(`actual SearXNG ${searchFailure} shape is classified after a real scout finds no feed`, async () => {
  const incomplete = searchFailure === "failed" || searchFailure === "degraded";
  let clock = 0;
  let queryCalls = 0;
  let searches = 0;
  let actual;
  const search = createSearxngSourceSearch({ endpoint: "https://search.example/search", cache: memoryCache(),
    maxQueries: 2, hardQueryLimit: 2, queryAttempts: 1, retryBudget: 0, queryPaceMs: 0, delay: async () => {},
    fetcher: async url => {
      queryCalls++;
      if (queryCalls % 2 === 0 && searchFailure === "failed") return response(url, "", 503);
      const body = queryCalls % 2 === 1
        ? { results: [{ url: "https://venue.example/agenda", title: "Fixture Region calendar", content: "Local events" }],
          unresponsive_engines: searchFailure === "partial_with_results" ? [["fixture", "timeout"]] : [] }
        : { results: [], unresponsive_engines: searchFailure === "degraded" ? [["fixture", "timeout"]] : [] };
      return response(url, JSON.stringify(body), 200, "application/json");
    } });
  const discover = createRequestTimeEventDiscovery({ cache: memoryCache(), now: () => clock,
    sourceSearch: async args => { searches++; actual = await search(args); return actual; },
    fetcher: async url => url.endsWith("/robots.txt")
      ? response(url, "User-agent: *\nAllow: /", 200, "text/plain")
      : response(url, "<html><body>Local venue news without event facts</body></html>"),
  });
  const first = await discover(input);
  assert.equal(actual.retry_recommended, false, "provider retains a seed, even when another query fails");
  assert.equal(actual.seed_count, 1);
  assert.equal(actual.status, searchFailure === "clean" ? "complete" : "partial");
  assert.equal(first.status, incomplete ? "failed" : "empty");
  clock = 4 * 60000;
  await discover(input);
  assert.equal(searches, 1);
  clock = 6 * 60000;
  await discover(input);
  assert.equal(searches, incomplete ? 2 : 1, "incomplete acquisition retries after minutes");
});

test("a real partial search keeps a useful structured feed despite the other query's failure", async () => {
  let queries = 0;
  let actual;
  const search = createSearxngSourceSearch({ endpoint: "https://search.example/search", cache: memoryCache(),
    maxQueries: 2, hardQueryLimit: 2, queryAttempts: 1, retryBudget: 0, queryPaceMs: 0, delay: async () => {},
    fetcher: async url => ++queries === 1
      ? response(url, JSON.stringify({ results: [{ url: "https://venue.example/agenda", title: "Fixture Region calendar" }] }), 200, "application/json")
      : response(url, "", 503) });
  const discover = createRequestTimeEventDiscovery({ cache: memoryCache(),
    sourceSearch: async args => { actual = await search(args); return actual; },
    fetcher: async url => url.endsWith("/robots.txt")
      ? response(url, "User-agent: *\nAllow: /", 200, "text/plain")
      : response(url, '<html><a href="/public/calendar.ics">Calendar</a></html>'),
  });
  const result = await discover(input);
  assert.equal(actual.status, "partial");
  assert.equal(actual.retry_recommended, false);
  assert.equal(actual.failed_query_count, 1);
  assert.equal(result.status, "found");
  assert.equal(result.feeds.length, 1);
  assert.equal(result.feeds[0].endpoint, "https://venue.example/public/calendar.ics");
});
