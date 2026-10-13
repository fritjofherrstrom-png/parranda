"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createRequestTimeEventDiscovery, feedsFromScout } = require("../server/pulse-sources/request-time-event-discovery");
const { createSearxngSourceSearch } = require("../server/pulse-sources/source-search-provider");
const { collectAnchorEvents, resolveDefaultEventSupply } = require("../server/place-candidates/agnostic-event-supply");
const { LIVE_COLLECTION_READ, createLiveCompletionStore } = require("../server/planner/live-completion");

const { memoryCache, response, anchor, input, tick, scoutHtml } = require("./helpers/request-time-review-fixtures");

test("uncovered discovery failure has a terminal hold through the real collector and completion store", async () => {
  let clock = 0;
  let searchCalls = 0;
  const discovery = createRequestTimeEventDiscovery({ cache: memoryCache(), now: () => clock,
    sourceSearch: createSearxngSourceSearch({ endpoint: "https://search.example/search", cache: memoryCache(),
      maxQueries: 2, hardQueryLimit: 2, queryAttempts: 1, retryBudget: 0, queryPaceMs: 0, delay: async () => {},
      fetcher: async url => { searchCalls++; return response(url, "", 503); } }) });
  let discoveries = 0;
  const supply = resolveDefaultEventSupply({ PARRANDA_AGNOSTIC_EVENTS: "enabled", PARRANDA_EVENT_FEEDS: "[]" }, {
    eventCache: memoryCache(), eventReader: null, failedRefreshClock: () => clock,
    requestTimeDiscovery: async args => { discoveries++; return discovery(args); },
  });
  // An anchor without a wired national calendar: the source plan is truly
  // empty, rather than silently acquiring FI's public-holiday reference.
  const args = { anchor: { lat: -45.1, lng: 170.2 }, placeLabel: "Fixture Region",
    now: "2026-10-12T20:00:00Z", selectedDate: "2026-10-13" };
  const first = await supply(args);
  const store = createLiveCompletionStore();
  const receipt = store.issue(first);
  for (let i = 0; i < 50 && first[LIVE_COLLECTION_READ]()?.pending; i++) await tick();
  const failure = first[LIVE_COLLECTION_READ]();
  assert.ok(failure, "real background collection settled");
  assert.equal(failure.pending, undefined);
  assert.equal(failure.coverage, "uncovered");
  assert.equal(failure.acquisition.request_time_discovery.status, "failed");
  assert.equal(failure.acquisition.source_health.result, "unknown");
  const held = await supply(args);
  assert.equal(held.pending, undefined, "failure does not restart pending inside the pool hold");
  assert.equal(held.coverage, "uncovered");
  assert.equal(discoveries, 1);
  assert.equal(store.read(receipt.token).body.live_events.acquisition.request_time_discovery.status, "failed");
  clock = 120000;
  const next = await supply(args);
  assert.equal(next.pending, true, "pool hold expires after two minutes");
  for (let i = 0; i < 50 && next[LIVE_COLLECTION_READ]()?.pending; i++) await tick();
  assert.equal(discoveries, 2);
  assert.equal(searchCalls, 2, "discovery's own five-minute hold still protects both original queries");
  assert.deepEqual(first[LIVE_COLLECTION_READ](), failure, "later generation preserves the original terminal answer");
});
