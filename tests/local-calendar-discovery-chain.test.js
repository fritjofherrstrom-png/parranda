"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createSearxngSourceSearch } = require("../server/pulse-sources/source-search-provider");
const { createRequestTimeEventDiscovery } = require("../server/pulse-sources/request-time-event-discovery");
const { resolveDefaultEventSupply, collectAnchorEvents } = require("../server/place-candidates/agnostic-event-supply");
const { executeLiveEventQuery, shapeCollectedLiveEvents } = require("../server/place-candidates/live-event-query");
const capturedEvent = require("./fixtures/schema-org-single-date-schedule.json");

const anchor = { lat: 55.676, lng: 12.568 };
const selectedDate = "2026-11-06";
const now = "2026-11-06T19:10:00Z";
const bounds = { south: 55.66, north: 55.69, west: 12.55, east: 12.59 };
const spatialScope = { source: "resolver_bounds", kind: "settlement", bounds };

function memoryCache() {
  const values = new Map();
  return { get: async (key, factory, options) => {
    if (values.has(key)) return values.get(key);
    const value = await factory();
    if (options.shouldStore(value)) values.set(key, value);
    return value;
  } };
}

function response(url, text, type = "text/html", status = 200) {
  return { ok: status === 200, status, url, headers: { get: key => key.toLowerCase() === "content-type" ? type : null },
    text: async () => text, json: async () => JSON.parse(text) };
}

// Closed external transports and resolver responses, NOT actual publisher or
// search reads. These drive the real search -> scout -> binding -> provider ->
// normalizer -> geographic gates -> public Live projection with reader off.
async function ordinaryLiveJourney({ denied = false } = {}) {
  const host = denied ? "denied-calendar.example" : "local-calendar.example";
  const calendarUrl = `https://${host}/eventkalender`;
  const detailUrl = `https://${host}/eventkalender/autumn-concert`;
  const listing = Array.from({ length: 5 }, (_, index) => ({
    url: `https://listing.example/events/${index}`, title: "Events calendar",
  }));
  const event = { ...capturedEvent, name: "Autumn concert", url: detailUrl,
    location: { "@type": "Place", name: "Harbour Stage",
      geo: { "@type": "GeoCoordinates", latitude: anchor.lat, longitude: anchor.lng } } };
  const html = `<html lang="da"><head><title>Events calendar</title>
    <script type="application/ld+json">${JSON.stringify(event)}</script></head><body></body></html>`;
  const reads = [];
  const fetcher = async input => {
    const url = new URL(input);
    reads.push(url.href);
    if (url.hostname === "search.example") {
      assert.ok(!/J-dag|J-day|Autumn concert/i.test(url.searchParams.get("q")), "ordinary locality discovery, never the answer in the query");
      return response(url.href, JSON.stringify({ results: [...listing, { url: calendarUrl, title: "Events calendar" }] }), "application/json");
    }
    if (url.pathname === "/robots.txt") {
      return response(url.href, `User-agent: *\n${denied && url.hostname === host ? "Disallow: /" : "Allow: /"}\n`, "text/plain");
    }
    if (url.hostname === host && url.pathname === "/eventkalender") return response(url.href, html);
    if (url.hostname === "listing.example" && url.pathname.startsWith("/events/")) {
      return response(url.href, '<html lang="en"><head><title>Events guide</title></head><body>No structured calendar.</body></html>');
    }
    return response(url.href, "", "text/plain", 404);
  };
  const sourceSearch = createSearxngSourceSearch({ endpoint: "https://search.example/search", fetcher,
    maxQueries: 2, hardQueryLimit: 2, queryPaceMs: 0 });
  const discover = createRequestTimeEventDiscovery({ sourceSearch, fetcher, cache: memoryCache() });
  const values = new Map();
  let warm;
  const supply = resolveDefaultEventSupply({ PARRANDA_AGNOSTIC_EVENTS: "enabled", PARRANDA_EVENT_READER: "disabled" }, {
    requestTimeDiscovery: discover,
    eventReader: null,
    eventCache: {
      peek: key => values.get(key),
      warm: (key, factory) => { warm = Promise.resolve().then(factory).then(value => {
        values.set(key, value); return value;
      }); return warm; },
    },
    collectEvents: input => collectAnchorEvents({ ...input, fetcher }),
  });
  const input = { payload: { scope: "around_place", anchor, place_query: "Harbour City", selected_date: selectedDate }, now,
    placeResolver: async () => [{ ...anchor, label: "Harbour City, Test Country", confidence: "medium",
      provenance: "nominatim_osm", spatial_scope: spatialScope,
      admin_context: { locality: "Harbour City", country: "Test Country" } }], eventSupply: supply };
  const pending = await executeLiveEventQuery(input);
  assert.equal(pending.status, 200);
  assert.equal(pending.body.live_events.pending, true);
  await warm;
  const result = await executeLiveEventQuery(input);
  assert.equal(result.status, 200);
  assert.equal(result.body.live_events.pending, undefined);
  assert.equal(result.body.route_mutation, false);
  assert.equal(result.body.day_anchor_mutation, false);
  return { result, reads, calendarUrl, detailUrl };
}

test("a second discovered publisher reaches ordinary Live with its own Schedule clock and no model", async () => {
  const { result, reads, calendarUrl, detailUrl } = await ordinaryLiveJourney();
  const live = result.body.live_events;
  assert.equal(live.tonight.length, 1, JSON.stringify(live.acquisition));
  const event = live.tonight[0];
  assert.equal(event.title, "Autumn concert");
  assert.equal(event.starts_at, "2026-11-06T19:59:00.000Z");
  assert.equal(event.ends_at, "2026-11-06T22:59:00.000Z");
  assert.equal(event.timezone, "Europe/Copenhagen");
  assert.equal(event.source_url, detailUrl);
  assert.equal(event.trust_level, "low");
  assert.equal(event.route_eligible, false, "single-observation discovery never graduates to a route stop");
  assert.ok(reads.includes(calendarUrl));
  assert.equal(reads.filter(url => new URL(url).hostname === "search.example").length, 2);
  assert.equal(live.acquisition.request_time_discovery.status, "found");
});

test("publisher diversity never reads or publishes a calendar denied by robots", async () => {
  const { result, reads, calendarUrl } = await ordinaryLiveJourney({ denied: true });
  assert.deepEqual(result.body.live_events.tonight, []);
  assert.ok(!reads.includes(calendarUrl), "denied calendar body has zero reads");
  assert.equal(reads.filter(url => new URL(url).hostname === "search.example").length, 2);
});

// Explicit TEST-ONLY reviewed binding. This demonstrates the existing mapless
// publisher-area contract, NOT automatic qualification, permission for the real
// site, or a newly configured runtime source. The Event atoms are real.
const reviewedFixture = { id: "captured-source-fixture", label: "Captured calendar fixture",
  adapter: "schema_org_html", endpoint: capturedEvent.url, source_identity: "visitorservice.kk.dk",
  bbox: [12.4, 55.6, 12.8, 55.8], status: "active", runtime_policy: "bounded_refresh",
  timezone: "Europe/Copenhagen", source_scoped_pulse: true, pulse_only: true,
  source_tier: "official", source_family: "official_municipal_calendar", reviewed_at: now };
const capturedHtml = `<script type="application/ld+json">${JSON.stringify(capturedEvent)}</script>`;

test("captured citywide facts remain correctly timed, mapless and route-ineligible under the existing reviewed-area contract", async () => {
  let lookups = 0;
  const collected = await collectAnchorEvents({ anchor, selectedDate, now, registry: [reviewedFixture],
    placeContext: { locality: "København", country: "Danmark" }, eventReader: null,
    venueResolver: async () => { lookups++; return [{ ...anchor, confidence: "medium" }]; },
    fetcher: async url => response(String(url), capturedHtml) });
  const live = shapeCollectedLiveEvents(collected, { scope: { kind: "around_place", anchor, radius_m: 3000 } });
  assert.equal(live.tonight.length, 1, JSON.stringify(live.acquisition));
  const event = live.tonight[0];
  assert.equal(event.title, capturedEvent.name);
  assert.equal(event.starts_at, "2026-11-06T19:59:00.000Z");
  assert.equal(event.timezone, "Europe/Copenhagen");
  assert.equal(event.lat, null);
  assert.equal(event.lng, null);
  assert.equal(event.anchor_distance_km, null);
  assert.equal(event.geographic_relevance, "source_scope");
  assert.equal(event.route_eligible, false);
  assert.equal(lookups, 0);
  for (const kind of ["near_me", "in_place"]) {
    assert.deepEqual(shapeCollectedLiveEvents(collected, { scope: { kind, anchor, radius_m: 3000, trusted_place_scope: spatialScope } }).tonight, []);
  }
});

test("a new unverified mapless calendar cannot mint source-area eligibility or borrow the city center", async () => {
  let lookups = 0;
  const collected = await collectAnchorEvents({ anchor, selectedDate, now,
    registry: [{ ...reviewedFixture, source_scoped_pulse: false, source_tier: "unknown",
      source_family: "unknown_source_family", reviewed_at: null }],
    placeContext: { locality: "København", country: "Danmark" }, eventReader: null,
    venueResolver: async () => { lookups++; return [{ ...anchor, confidence: "medium" }]; },
    fetcher: async url => response(String(url), capturedHtml) });
  assert.deepEqual(collected.tonight, []);
  assert.equal(lookups, 0);
  assert.ok(collected.acquisition.rejection_summary.some(row => row.reason === "missing_event_coordinates" && row.count === 1));
});

test("selected historical date never revives the captured event after its source-owned end", async () => {
  const collected = await collectAnchorEvents({ anchor, selectedDate, now: "2026-11-07T12:00:00Z",
    registry: [reviewedFixture], eventReader: null, fetcher: async url => response(String(url), capturedHtml) });
  assert.deepEqual(collected.tonight, []);
  assert.deepEqual(collected.this_week, []);
});
