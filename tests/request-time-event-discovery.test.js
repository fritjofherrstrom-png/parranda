const assert = require("node:assert/strict");
const test = require("node:test");

const {
  createRequestTimeEventDiscovery,
  feedsFromScout,
} = require("../server/pulse-sources/request-time-event-discovery");
const { resolveDefaultEventSupply, HELSINKI_LINKED_EVENTS_FEED } = require("../server/place-candidates/agnostic-event-supply");

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
  assert.equal(feed.timezone, "Europe/Rome");
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

test("discovery searches locality-scoped queries once per place and reuses what it found", async () => {
  const searches = [];
  const discover = createRequestTimeEventDiscovery({
    cache: memoryCache(),
    sourceSearch: async (input) => {
      searches.push(input.queries);
      return { status: "ok", seeds: [{ url: "https://venue.example/agenda" }] };
    },
    scout: async ({ seeds }) => {
      assert.deepEqual(seeds.map((seed) => seed.url), ["https://venue.example/agenda"]);
      return scoutResult([scoutedSource("venue")]);
    },
    timezoneForPoint: () => "Europe/Rome",
  });
  const first = await discover({ anchor: ANCHOR, placeLabel: "Trieste, Italy", placeContext: PLACE_CONTEXT });
  const again = await discover({ anchor: { lat: 45.6499, lng: 13.7770 }, placeLabel: "Trieste, Italy", placeContext: PLACE_CONTEXT });
  assert.equal(first.length, 1);
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
  assert.deepEqual(await discover({ anchor: ANCHOR, placeLabel: "Trieste", placeContext: PLACE_CONTEXT }), []);
  clock += 30 * 60 * 1000;
  await discover({ anchor: ANCHOR, placeLabel: "Trieste", placeContext: PLACE_CONTEXT });
  assert.equal(searches, 1);
  clock += 31 * 60 * 1000;
  await discover({ anchor: ANCHOR, placeLabel: "Trieste", placeContext: PLACE_CONTEXT });
  assert.equal(searches, 2);
});

test("without a configured source search there is no request-time discovery", () => {
  assert.equal(createRequestTimeEventDiscovery({}), null);
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
  };
}

test("a place without its own source looks for one inside the out-of-band Live collection", async () => {
  const calls = [];
  const found = feedsFromScout(scoutResult([scoutedSource("venue")]), { timezone: "Europe/Rome" });
  const { supply, settled } = supplyWith({
    discovery: async (input) => {
      calls.push(input);
      return found;
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
  const { supply, settled } = supplyWith({ discovery: async () => [] });
  const out = await supply({ anchor: { lat: -45.1, lng: 170.2 }, now: "2026-10-10T08:00:00Z" });
  assert.notEqual(out.coverage, "uncovered");
  const collected = await settled();
  assert.ok(Array.isArray(collected.registry));
  assert.equal("venueResolutionLimit" in collected, false, "nothing found keeps the ordinary lookup budget");
});

test("a place with an approved local source does not search", async () => {
  let called = false;
  const { supply, settled } = supplyWith({
    env: { PARRANDA_EVENT_FEEDS: JSON.stringify([HELSINKI_LINKED_EVENTS_FEED]) },
    discovery: async () => {
      called = true;
      return [];
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
