const assert = require("node:assert/strict");
const test = require("node:test");

const {
  createRequestTimeEventDiscovery,
  feedsFromScout,
} = require("../server/pulse-sources/request-time-event-discovery");
const {
  collectAnchorEvents,
  isFailedEventRefresh,
  resolveDefaultEventSupply,
  shouldCacheEventSupplyResult,
  HELSINKI_LINKED_EVENTS_FEED,
} = require("../server/place-candidates/agnostic-event-supply");

const ANCHOR = { lat: 45.6496, lng: 13.7773 };
const PLACE_CONTEXT = { locality: "Trieste", region: "Friuli – Venezia Giulia", country: "Italy", country_code: "it" };

function memoryCache() {
  const store = new Map();
  return {
    async get(key, producer, { shouldStore = () => true } = {}) {
      if (store.has(key)) return store.get(key);
      const value = await producer();
      if (shouldStore(value)) store.set(key, value);
      return value;
    },
  };
}

function scoutedSource(id, { robots = "allowed", terms = "unknown", timezone = "" } = {}) {
  const url = `https://${id}.example/cal.ics`;
  return {
    candidate: { id, url, adapter: "ical", source_identity: `${id}.example`, status: "viable_provider_probe", maps_to_existing_provider: true, family: "venue_calendar" },
    manifest: { id, endpoint: url, adapter: "ical", source_identity: `${id}.example`, bbox: [13.6, 45.6, 13.9, 45.75], label: `${id} calendar`, timezone, review: { robots_status: robots, terms_status: terms } },
  };
}

function scoutResult(sources) {
  return {
    results: [{ candidates: sources.map((source) => source.candidate) }],
    manifest_candidates: sources.map((source) => source.manifest),
  };
}

test("a found structured source becomes a probationary, Pulse-only single observation with a local zone", () => {
  const feeds = feedsFromScout(scoutResult([scoutedSource("venue")]), { timezone: "Europe/Rome" });
  assert.equal(feeds.length, 1);
  const [feed] = feeds;
  assert.equal(feed.endpoint, "https://venue.example/cal.ics");
  assert.equal(feed.adapter, "ical");
  assert.equal(feed.fallback_timezone, "Europe/Rome");
  assert.equal(feed.timezone, undefined, "coordinate fallback is not a reviewed descriptor override");
  assert.equal(feed.status, "probationary");
  assert.equal(feed.runtime_trust, "request_time_single_observation");
  assert.equal(feed.pulse_only, true);
  assert.equal(feed.source_scoped_pulse, false);
  assert.equal(feed.confidence, "low");
});

test("a source's own zone wins; robots exclusions and restricted terms never become feeds", () => {
  const feeds = feedsFromScout(scoutResult([
    scoutedSource("declared", { timezone: "Europe/Vienna" }),
    scoutedSource("blocked", { robots: "disallowed" }),
    scoutedSource("restricted", { terms: "restricted" }),
    scoutedSource("permission", { terms: "permission_required" }),
  ]), { timezone: "Europe/Rome" });
  assert.deepEqual(feeds.map((feed) => feed.id), ["declared"]);
  assert.equal(feeds[0].timezone, "Europe/Vienna");
});

function scoutedInterface(publisher, adapter) {
  const id = `${publisher}-${adapter}`;
  const url = `https://${publisher}.example/${adapter}`;
  return {
    candidate: { id, url, adapter, source_identity: `${publisher}.example`, status: "viable_provider_probe", maps_to_existing_provider: true, family: "venue_calendar" },
    manifest: { id, endpoint: url, adapter, source_identity: `${publisher}.example`, bbox: [13.6, 45.6, 13.9, 45.75], label: publisher, review: { robots_status: "allowed", terms_status: "unknown" } },
  };
}

test("event-specific interfaces are read before blog feeds, one per publisher", () => {
  const feeds = feedsFromScout(scoutResult([
    scoutedInterface("blog", "rss_atom_event_detail"),
    scoutedInterface("venue", "rss_atom_event_detail"),
    scoutedInterface("venue", "events_calendar"),
    scoutedInterface("venue", "ical"),
    scoutedInterface("listing", "schema_org_html"),
  ]), { timezone: "Europe/Rome" });
  assert.deepEqual(feeds.map((feed) => feed.id), ["venue-events_calendar", "listing-schema_org_html", "blog-rss_atom_event_detail"]);
});

test("discovery searches locality-scoped queries once per place and reuses what it found", async () => {
  const searches = [];
  const discover = createRequestTimeEventDiscovery({
    cache: memoryCache(),
    sourceSearch: async (input) => {
      searches.push(input.queries);
      return { status: "ok", seeds: [{ url: "https://venue.example/agenda" }] };
    },
    scout: async ({ seeds, eventReader }) => {
      assert.deepEqual(seeds.map((seed) => seed.url), ["https://venue.example/agenda"]);
      assert.equal(eventReader, null, "request-time discovery never invokes the paid document reader");
      return scoutResult([scoutedSource("venue")]);
    },
    timezoneForPoint: () => "Europe/Rome",
  });
  const first = await discover({ anchor: ANCHOR, placeLabel: "Trieste, Italy", placeContext: PLACE_CONTEXT });
  const again = await discover({ anchor: { lat: 45.6499, lng: 13.7770 }, placeLabel: "Trieste, Italy", placeContext: PLACE_CONTEXT });
  assert.equal(first.status, "found");
  assert.equal(first.feeds.length, 1);
  assert.deepEqual(again, first);
  assert.equal(searches.length, 1);
  assert.ok(searches[0].length > 0 && searches[0].length <= 2);
  assert.ok(searches[0].every((query) => /Trieste/.test(query)), "queries stay on the place itself");
});

test("a place with nothing to find is not searched again within the hold, then is", async () => {
  let clock = 1_000_000;
  let searches = 0;
  const discover = createRequestTimeEventDiscovery({
    cache: memoryCache(),
    now: () => clock,
    sourceSearch: async () => {
      searches += 1;
      return { status: "ok", seeds: [] };
    },
    scout: async () => assert.fail("no seeds, no scout"),
  });
  assert.equal((await discover({ anchor: ANCHOR, placeLabel: "Trieste", placeContext: PLACE_CONTEXT })).status, "empty");
  clock += 30 * 60 * 1000;
  await discover({ anchor: ANCHOR, placeLabel: "Trieste", placeContext: PLACE_CONTEXT });
  assert.equal(searches, 1);
  clock += 31 * 60 * 1000;
  await discover({ anchor: ANCHOR, placeLabel: "Trieste", placeContext: PLACE_CONTEXT });
  assert.equal(searches, 2);
});

test("a failed search is a short failure hold, never the one-hour verified-empty hold", async () => {
  let clock = 1_000_000;
  let searches = 0;
  const discover = createRequestTimeEventDiscovery({
    cache: memoryCache(),
    now: () => clock,
    sourceSearch: async () => {
      searches += 1;
      return { status: "failed", seeds: [], retry_recommended: true };
    },
    scout: async () => assert.fail("no seeds, no scout"),
  });
  const failed = await discover({ anchor: ANCHOR, placeLabel: "Trieste", placeContext: PLACE_CONTEXT });
  assert.equal(failed.status, "failed");
  assert.equal(failed.reason, "source_search_failed");
  assert.deepEqual(failed.feeds, []);
  clock += 4 * 60 * 1000;
  assert.equal((await discover({ anchor: ANCHOR, placeLabel: "Trieste", placeContext: PLACE_CONTEXT })).status, "failed");
  assert.equal(searches, 1, "an outage is not re-searched at once");
  clock += 2 * 60 * 1000;
  await discover({ anchor: ANCHOR, placeLabel: "Trieste", placeContext: PLACE_CONTEXT });
  assert.equal(searches, 2, "a failure is retried after minutes, not after the hour a verified empty answer is held");
});

test("a search or scout that throws is a failure outcome, not an empty answer", async () => {
  const throwingSearch = createRequestTimeEventDiscovery({
    cache: memoryCache(),
    sourceSearch: async () => { throw new Error("connect refused"); },
  });
  const searchFailure = await throwingSearch({ anchor: ANCHOR, placeLabel: "Trieste", placeContext: PLACE_CONTEXT });
  assert.equal(searchFailure.status, "failed");
  assert.equal(searchFailure.reason, "source_search_failed");

  const throwingScout = createRequestTimeEventDiscovery({
    cache: memoryCache(),
    sourceSearch: async () => ({ status: "ok", seeds: [{ url: "https://venue.example/agenda" }] }),
    scout: async () => { throw new Error("timeout"); },
  });
  const scoutFailure = await throwingScout({ anchor: ANCHOR, placeLabel: "Trieste", placeContext: PLACE_CONTEXT });
  assert.equal(scoutFailure.status, "failed");
  assert.equal(scoutFailure.reason, "source_scout_failed");

  const healthyEmpty = createRequestTimeEventDiscovery({
    cache: memoryCache(),
    sourceSearch: async () => ({ status: "ok", seeds: [] }),
  });
  const empty = await healthyEmpty({ anchor: ANCHOR, placeLabel: "Trieste", placeContext: PLACE_CONTEXT });
  assert.equal(empty.status, "empty");
});

test("without a configured source search there is no request-time discovery", () => {
  assert.equal(createRequestTimeEventDiscovery({}), null);
});

test("a returned scout HTTP failure stays failed and is retried after the short hold", async () => {
  let clock = 0;
  let pageCalls = 0;
  const discover = createRequestTimeEventDiscovery({
    cache: memoryCache(), now: () => clock,
    sourceSearch: async () => ({ status: "complete", seeds: [{ url: "https://venue.example/agenda" }] }),
    // Real deterministic scout: an allowed robots response, then a failing page.
    fetcher: async url => {
      if (String(url).endsWith("/robots.txt")) return {
        ok: true, status: 200, headers: { get: () => "text/plain" },
        text: async () => "User-agent: *\nAllow: /",
      };
      pageCalls += 1;
      return { ok: false, status: 503 };
    },
    timezoneForPoint: () => "Europe/Rome",
  });
  const request = { anchor: ANCHOR, placeContext: PLACE_CONTEXT };
  const first = await discover(request);
  assert.equal(first.status, "failed", "the scout returns HTTP failures as data, without throwing");
  assert.equal(first.reason, "source_scout_failed");
  await discover(request);
  assert.equal(pageCalls, 1);
  clock = 5 * 60 * 1000;
  assert.equal((await discover(request)).status, "failed");
  assert.equal(pageCalls, 2, "the page outage must not acquire the one-hour verified-empty hold");
});

test("degraded search with retained seeds cannot prove absence when no feed is found", async () => {
  const discover = createRequestTimeEventDiscovery({
    cache: memoryCache(),
    sourceSearch: async () => ({ status: "degraded", retry_recommended: true, seeds: [{ url: "https://venue.example/agenda" }] }),
    scout: async () => ({ status: "complete", results: [], manifest_candidates: [] }),
  });
  assert.equal((await discover({ anchor: ANCHOR, placeContext: PLACE_CONTEXT })).status, "failed");
});

test("a robots transport outage is failed rather than a verified empty source", async () => {
  const discover = createRequestTimeEventDiscovery({
    cache: memoryCache(),
    sourceSearch: async () => ({ status: "complete", seeds: [{ url: "https://venue.example/agenda" }] }),
    fetcher: async url => String(url).endsWith("/robots.txt") ? { ok: false, status: 503 } : {
      ok: true, status: 200, headers: { get: () => "text/html" }, text: async () => "<html><body>Venue programme</body></html>",
    },
  });
  const result = await discover({ anchor: ANCHOR, placeContext: PLACE_CONTEXT });
  assert.equal(result.status, "failed");
  assert.equal(result.reason, "source_scout_failed");
});

test("an explicit robots exclusion remains an empty policy decision without fetching the page", async () => {
  const discover = createRequestTimeEventDiscovery({
    cache: memoryCache(),
    sourceSearch: async () => ({ status: "complete", seeds: [{ url: "https://venue.example/agenda" }] }),
    fetcher: async url => {
      assert.ok(String(url).endsWith("/robots.txt"), "excluded page must not be fetched");
      return { ok: true, status: 200, headers: { get: () => "text/plain" }, text: async () => "User-agent: *\nDisallow: /" };
    },
  });
  assert.equal((await discover({ anchor: ANCHOR, placeContext: PLACE_CONTEXT })).status, "empty");
});

test("a free discovered calendar surfaces source-backed Live facts without a model reader or route eligibility", async () => {
  const discover = createRequestTimeEventDiscovery({
    cache: memoryCache(),
    sourceSearch: async () => ({ status: "ok", seeds: [{ url: "https://venue.example/agenda" }] }),
    scout: async input => {
      assert.equal(input.eventReader, null);
      return scoutResult([scoutedSource("venue")]);
    },
    timezoneForPoint: () => "Europe/Rome",
  });
  const { feeds } = await discover({ anchor: ANCHOR, placeContext: PLACE_CONTEXT });
  const calendar = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "BEGIN:VEVENT", "UID:free-calendar-event",
    "DTSTART:20261013T170000Z", "DTEND:20261013T180000Z", "SUMMARY:Evening concert",
    "LOCATION:Source-owned venue", "GEO:45.650;13.778", "URL:https://venue.example/concert",
    "END:VEVENT", "END:VCALENDAR", "",
  ].join("\r\n");
  const result = await collectAnchorEvents({
    anchor: ANCHOR, registry: feeds, now: "2026-10-13T08:00:00Z", selectedDate: "2026-10-13",
    eventReader: { read: async () => assert.fail("a paid reader must never be invoked") },
    fetcher: async () => ({ ok: true, status: 200, text: async () => calendar }),
  });
  assert.equal(result.tonight.length, 1, "the actual calendar, normalization and geographic gates deliver the event");
  const event = result.tonight[0];
  assert.equal(event.title, "Evening concert");
  assert.equal(event.source_url, "https://venue.example/concert");
  assert.equal(event.trust_level, "low");
  assert.equal(event.pulse_display_eligible, true);
  assert.equal(event.route_eligible, false);
  assert.equal(result.acquisition.source_health.accepted_event_count, 1);
});

function supplyWith({ env = {}, discovery }) {
  let collectedInput = null;
  let warmPromise = null;
  const supply = resolveDefaultEventSupply({ PARRANDA_AGNOSTIC_EVENTS: "enabled", ...env }, {
    requestTimeDiscovery: discovery,
    eventCache: {
      peek: () => null,
      warm: (_key, factory) => {
        warmPromise = Promise.resolve().then(factory);
      },
    },
    collectEvents: async (input) => {
      collectedInput = input;
      return { coverage: "covered", tonight: [], this_week: [], acquisition: { source_health: { status: "healthy", result: "empty" } } };
    },
  });
  return {
    supply,
    settled: async () => {
      await warmPromise;
      return collectedInput;
    },
    produced: () => warmPromise,
  };
}

test("a place without its own source looks for one inside the out-of-band Live collection", async () => {
  const calls = [];
  const found = feedsFromScout(scoutResult([scoutedSource("venue")]), { timezone: "Europe/Rome" });
  const { supply, settled } = supplyWith({
    discovery: async (input) => {
      calls.push(input);
      return { status: "found", reason: null, feeds: found };
    },
  });
  const out = await supply({ anchor: ANCHOR, placeLabel: "Trieste, Italy", placeContext: PLACE_CONTEXT, now: "2026-10-10T08:00:00Z" });
  assert.equal(out.pending, true, "the day is answered before discovery finishes");
  const collected = await settled();
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].anchor, ANCHOR);
  assert.equal(calls[0].placeLabel, "Trieste, Italy");
  assert.ok(collected.registry.some((feed) => feed.id === "venue" && feed.runtime_trust === "request_time_single_observation"));
  assert.equal(collected.venueResolutionLimit, 6);
});

test("an uncovered place no longer stops at 'uncovered' when it can look for sources", async () => {
  const { supply, settled } = supplyWith({ discovery: async () => ({ status: "empty", reason: "no_search_results", feeds: [] }) });
  const out = await supply({ anchor: { lat: -45.1, lng: 170.2 }, now: "2026-10-10T08:00:00Z" });
  assert.notEqual(out.coverage, "uncovered");
  const collected = await settled();
  assert.ok(Array.isArray(collected.registry));
  assert.equal("venueResolutionLimit" in collected, false, "nothing found keeps the ordinary lookup budget");
});

test("a failed discovery keeps the collection retryable instead of caching a healthy empty answer", async () => {
  for (const discovery of [
    async () => ({ status: "failed", reason: "source_search_failed", feeds: [] }),
    async () => { throw new Error("unexpected"); },
  ]) {
    const { supply, produced } = supplyWith({ discovery });
    await supply({ anchor: ANCHOR, placeLabel: "Trieste", placeContext: PLACE_CONTEXT, now: "2026-10-10T08:00:00Z" });
    const result = await produced();
    assert.equal(result.acquisition.request_time_discovery.status, "failed");
    assert.equal(shouldCacheEventSupplyResult(result), false, "an unproven absence is not stored as a healthy empty answer");
    assert.equal(isFailedEventRefresh(result), true, "it is held briefly as a failed refresh and then retried");
  }
  const { supply, produced } = supplyWith({ discovery: async () => ({ status: "empty", reason: "no_search_results", feeds: [] }) });
  await supply({ anchor: ANCHOR, placeLabel: "Trieste", placeContext: PLACE_CONTEXT, now: "2026-10-10T08:00:00Z" });
  const verifiedEmpty = await produced();
  assert.equal(verifiedEmpty.acquisition.request_time_discovery.status, "empty");
  assert.equal(shouldCacheEventSupplyResult(verifiedEmpty), true, "a verified empty answer is still cacheable");
});

test("a place with an approved local source does not search", async () => {
  let called = false;
  const { supply, settled } = supplyWith({
    env: { PARRANDA_EVENT_FEEDS: JSON.stringify([HELSINKI_LINKED_EVENTS_FEED]) },
    discovery: async () => {
      called = true;
      return { status: "empty", reason: null, feeds: [] };
    },
  });
  await supply({ anchor: { lat: 60.17, lng: 24.94 }, now: "2026-10-10T08:00:00Z" });
  await settled();
  assert.equal(called, false);
});

test("the default lane follows the configured source search and can be switched off", () => {
  const { resolveRequestTimeDiscovery } = require("../server/place-candidates/agnostic-event-supply");
  assert.equal(resolveRequestTimeDiscovery({}), null, "no source search configured");
  const search = {
    PARRANDA_SOURCE_SEARCH: "enabled",
    PARRANDA_SOURCE_SEARCH_ENDPOINT: "https://search.example/search",
  };
  assert.equal(resolveRequestTimeDiscovery({ ...search, PARRANDA_REQUEST_TIME_EVENT_DISCOVERY: "disabled" }), null, "operator opt-out");
  assert.equal(typeof resolveRequestTimeDiscovery(search), "function");
});
