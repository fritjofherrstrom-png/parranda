"use strict";

/**
 * The GLOBAL live-event family — "what's on near these coordinates" for ANY
 * anchor, key-gated, no per-city rows. Deterministic (injected fetcher, injected
 * clock, no network). The point under test: live events are NOT a region hack —
 * an arbitrary coordinate anywhere gets the same code path.
 */

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  collectAnchorEvents,
  resolveDefaultEventSupply,
  resolveGlobalEventKey,
  GLOBAL_FEED_DESCRIPTOR,
  HELSINKI_LINKED_EVENTS_FEED,
} = require("../server/place-candidates/agnostic-event-supply");
const { buildDiscoveryUrl, mapDiscoveryEvent } = require("../server/pulse-sources/ticketmaster-source-provider");

const NOW = "2026-07-06T12:00:00Z";
// Arbitrary anchors far outside every municipal bbox — the whole point.
const STOCKHOLM = { lat: 59.3293, lng: 18.0686 };
const NEW_YORK = { lat: 40.7128, lng: -74.006 };

function discoveryPayload() {
  const ev = (id, name, dateTime, tz, lat, lng, venue) => ({
    id,
    name,
    url: `https://www.ticketmaster.com/event/${id}`,
    dates: { start: { dateTime }, timezone: tz, status: { code: "onsale" } },
    classifications: [{ segment: { name: "Music" } }],
    _embedded: { venues: [{ name: venue, location: { latitude: String(lat), longitude: String(lng) } }] },
  });
  return {
    _embedded: {
      events: [
        ev("gig1", "Arena concert tonight", "2026-07-06T19:00:00Z", "Europe/Stockholm", 59.3326, 18.0649, "Stora salen"),
        ev("gig2", "Thursday theatre", "2026-07-09T18:00:00Z", "Europe/Stockholm", 59.331, 18.07, "Dramaten"),
        // Cancelled → freshness stale → normalizer drops it from live buckets.
        { ...ev("gig3", "Cancelled show", "2026-07-06T20:00:00Z", "Europe/Stockholm", 59.33, 18.06, "X"), dates: { start: { dateTime: "2026-07-06T20:00:00Z" }, timezone: "Europe/Stockholm", status: { code: "cancelled" } } },
        // Coordinate-less venue → dropped (nothing mapless is ever shown).
        { id: "gig4", name: "Ghost venue", url: "https://x/4", dates: { start: { dateTime: "2026-07-06T21:00:00Z" } }, _embedded: { venues: [{ name: "?" }] } },
      ],
    },
  };
}

function fetcherFor(payload, log = []) {
  return async (url) => {
    log.push(String(url));
    return { ok: true, json: async () => payload };
  };
}

test("the discovery URL is pure coordinate+radius+window — no city names, no region params", () => {
  const url = new URL(
    buildDiscoveryUrl({ key: "k", anchor: NEW_YORK, radiusKm: 3, startDateTime: "2026-07-06T12:00:00Z", endDateTime: "2026-07-13T12:00:00Z" }),
  );
  assert.equal(url.searchParams.get("latlong"), "40.7128,-74.006");
  assert.equal(url.searchParams.get("unit"), "km");
  assert.equal(url.searchParams.get("startDateTime"), "2026-07-06T12:00:00Z");
  for (const [k, v] of url.searchParams.entries()) {
    assert.ok(!/city|country|market|dma/i.test(k), `no geo-name param: ${k}=${v}`);
  }
});

test("mapDiscoveryEvent keeps real coords + event-level timezone, drops coordless events", () => {
  const mapped = mapDiscoveryEvent(discoveryPayload()._embedded.events[0]);
  assert.equal(mapped.title, "Arena concert tonight");
  assert.equal(mapped.lat, 59.3326);
  assert.equal(mapped.timezone, "Europe/Stockholm");
  assert.match(mapped.source_url, /ticketmaster\.com\/event\/gig1/);
  assert.equal(mapDiscoveryEvent(discoveryPayload()._embedded.events[3]), null, "coordless → dropped");
});

test("an anchor with NO municipal feed gets live events via the global family (any coordinate)", async () => {
  assert.equal(GLOBAL_FEED_DESCRIPTOR.source_tier, "verified", "commercial discovery is not official authority");
  assert.equal(GLOBAL_FEED_DESCRIPTOR.source_family, "global_commercial");
  for (const anchor of [STOCKHOLM, NEW_YORK]) {
    const out = await collectAnchorEvents({
      anchor,
      now: NOW,
      fetcher: fetcherFor(discoveryPayload()),
      globalKey: "test-key",
    });
    assert.equal(out.coverage, "covered", "global family covers arbitrary coordinates");
    assert.equal(out.feed.id, GLOBAL_FEED_DESCRIPTOR.id);
    assert.equal(out.feed.family, "global_commercial");
    const tonightIds = out.tonight.map((e) => e.id);
    assert.deepEqual(tonightIds, ["tm-gig1"], "tonight bucket from the global source");
    assert.equal(out.tonight[0].timezone, "Europe/Stockholm", "EVENT-level timezone carried");
    assert.deepEqual(out.this_week.map((e) => e.id), ["tm-gig2"]);
    assert.ok(!tonightIds.includes("tm-gig3"), "cancelled event never shown as live");
  }
});

test("without a key the same anchors return honest absence — never invented events", async () => {
  let fetched = false;
  const out = await collectAnchorEvents({
    anchor: STOCKHOLM,
    now: NOW,
    fetcher: async () => {
      fetched = true;
      return { ok: true, json: async () => discoveryPayload() };
    },
    // no globalKey
  });
  assert.equal(out.coverage, "uncovered");
  assert.equal(fetched, false, "no key → no network call");
  assert.deepEqual(out.tonight, []);
});

test("a municipal open feed still wins where it covers the anchor (hyper-local first)", async () => {
  const HELSINKI = { lat: 60.17, lng: 24.94 };
  const log = [];
  const out = await collectAnchorEvents({
    anchor: HELSINKI,
    now: NOW,
    // The municipal feed is present (a deployment configured it); it must win over
    // the global provider where it covers the anchor.
    registry: [HELSINKI_LINKED_EVENTS_FEED],
    fetcher: fetcherFor({ data: [] }, log),
    globalKey: "test-key",
  });
  assert.equal(out.coverage, "covered");
  assert.equal(out.feed.family, "municipal_open");
  assert.ok(log.every((u) => !u.includes("ticketmaster")), "global provider not called when a municipal feed covers");
});

test("resolveGlobalEventKey is env-gated and fail-closed", () => {
  assert.equal(resolveGlobalEventKey({}), null);
  assert.equal(resolveGlobalEventKey({ PARRANDA_TICKETMASTER_KEY: "  " }), null);
  assert.equal(resolveGlobalEventKey({ PARRANDA_TICKETMASTER_KEY: "abc" }), "abc");
});

test("default supply: key present → ANY anchor is covered (pending then cached); no key → unchanged behavior", async () => {
  const supply = resolveDefaultEventSupply({
    PARRANDA_AGNOSTIC_EVENTS: "enabled",
    PARRANDA_TICKETMASTER_KEY: "test-key",
  });
  const first = await supply({ anchor: NEW_YORK, now: NOW });
  assert.equal(first.coverage, "covered", "global family makes any coordinate covered");
  assert.equal(first.feed.id, GLOBAL_FEED_DESCRIPTOR.id);
  assert.equal(first.pending, true, "cold anchor answers honest pending instantly");

  const withoutKey = resolveDefaultEventSupply({ PARRANDA_AGNOSTIC_EVENTS: "enabled" });
  const absent = await withoutKey({ anchor: NEW_YORK, now: NOW });
  assert.equal(absent.coverage, "uncovered", "no key → prior honest behavior, byte-stable");
});
