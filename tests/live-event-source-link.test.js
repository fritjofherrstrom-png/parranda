"use strict";

/**
 * Live source links say where they lead. A reviewed feed label is attribution
 * (who listed the event); the source-owned URL is classified — never fetched,
 * rewritten or invented — as a site root ("site_home"), some other page
 * ("page"), or no describable link (null). Deterministic fixtures only: this is
 * not provider or Pi acceptance.
 */

const assert = require("node:assert/strict");
const test = require("node:test");

const { classifyEventSourceLink } = require("../server/pulse-sources/event-source-link");
const {
  collectAnchorEvents,
  rankCollectedEventsForPreferences,
  toEventView,
} = require("../server/place-candidates/agnostic-event-supply");
const { weaveEveningEvent } = require("../server/candidates/evening-event-weave");
const { weaveEveningEventRouteStop } = require("../server/candidates/event-route-stop-weave");
const { buildAnywhereBlitzDecision } = require("../server/blitz-anywhere");

const NO_LINK = { source_link_kind: null, source_link_host: null };

test("site roots and bare locale roots are homepages; any other http(s) URL is only a page", () => {
  const cases = [
    // Site root.
    ["https://museum.example.com/", "site_home", "museum.example.com"],
    ["https://museum.example.com", "site_home", "museum.example.com"],
    ["https://www.museum.example.com//", "site_home", "museum.example.com"],
    ["http://museum.example.com:8080/", "site_home", "museum.example.com"],
    // Locale root.
    ["https://museum.example.com/sv", "site_home", "museum.example.com"],
    ["https://museum.example.com/en/", "site_home", "museum.example.com"],
    ["https://museum.example.com/en-GB/", "site_home", "museum.example.com"],
    // Campaign tags never select content, so the root stays a root.
    ["https://museum.example.com/?utm_source=feed&utm_medium=api", "site_home", "museum.example.com"],
    // Deep link — "page" means only "not a site root", never "the event page".
    ["https://venue.example/events/jazz-night", "page", "venue.example"],
    ["https://venue.example/sv/evenemang/jazz-night", "page", "venue.example"],
    ["https://museum.example.com/index.html", "page", "museum.example.com"],
    // Query-only: `/?p=123`-style URLs address one item, so no homepage claim.
    ["https://calendar.example/?id=42", "page", "calendar.example"],
    ["https://calendar.example/?utm_source=feed&id=42", "page", "calendar.example"],
    // A fragment route can address one item as well.
    ["https://calendar.example/#/events/42", "page", "calendar.example"],
  ];
  for (const [url, kind, host] of cases) {
    assert.deepEqual(classifyEventSourceLink(url), { source_link_kind: kind, source_link_host: host }, url);
  }
});

test("invalid, relative, non-http(s) and credential-bearing URLs have no describable link", () => {
  for (const url of [
    null,
    undefined,
    42,
    "",
    "   ",
    "not a url",
    "/events/42",
    "events/42",
    "javascript:alert(1)",
    "mailto:info@venue.example",
    "ftp://venue.example/events/42",
    "data:text/html,hello",
    // Userinfo is the classic way to make a link read as another site.
    "https://visit.example@evil.example/",
    "https://user:secret@venue.example/events/42",
  ]) {
    assert.deepEqual(classifyEventSourceLink(url), NO_LINK, String(url));
  }
});

test("the host is the parsed hostname: case-folded, and an IDN look-alike stays in ASCII", () => {
  assert.equal(classifyEventSourceLink("https://VENUE.Example/Events/1").source_link_host, "venue.example");
  assert.equal(classifyEventSourceLink("https://malmö.example/").source_link_host, "xn--malm-8qa.example");
});

test("an event view keeps the feed label and the exact URL, and adds where that URL leads", () => {
  const feed = { id: "official", label: "Visit Example", license: "CC-BY 4.0" };
  const event = (id, sourceUrl) => ({
    id,
    title: `Event ${id}`,
    starts_at: "2026-09-25T17:00:00Z",
    source_label: "Visit Example",
    source_url: sourceUrl,
  });

  const home = toEventView(event("home", "https://museum.example.com/"), feed);
  assert.equal(home.source_label, "Visit Example");
  assert.equal(home.source_url, "https://museum.example.com/", "the URL is never rewritten");
  assert.equal(home.source_link_kind, "site_home");
  assert.equal(home.source_link_host, "museum.example.com");

  const page = toEventView(event("page", "https://venue.example/events/late-show"), feed);
  assert.equal(page.source_link_kind, "page");
  assert.equal(page.source_link_host, "venue.example");

  // Provenance-only URLs are classified the same way.
  const provenanceOnly = toEventView({
    id: "prov",
    title: "Provenance only",
    provenance: { source_url: "https://gallery.example/sv/" },
  }, feed);
  assert.equal(provenanceOnly.source_url, "https://gallery.example/sv/");
  assert.equal(provenanceOnly.source_link_kind, "site_home");

  const none = toEventView({ id: "none", title: "No link" }, feed);
  assert.equal(none.source_url, null);
  assert.deepEqual(
    { source_link_kind: none.source_link_kind, source_link_host: none.source_link_host },
    NO_LINK,
  );
});

// The reviewed localized-API adapter links the organizer's `external_website_url`
// while the row is labelled with the reviewed FEED — the documented case of a
// "Visit Stockholm" card opening another site.
const ANCHOR = { lat: 59.33, lng: 18.07 };
const NOW = "2026-09-25T10:00:00Z";
const REGISTRY = [{
  id: "visit-example",
  label: "Visit Example",
  adapter: "localized_events_api",
  endpoint: "https://events.example/api/public-v1/events/",
  bbox: [17.5, 59, 18.5, 59.7],
  timezone: "Europe/Stockholm",
  license: "CC-BY 4.0",
  source_language: "en",
  source_tier: "official",
  confidence: "medium",
  source_family: "official_tourism_open_api",
  source_identity: "events.example",
  status: "active",
}];
const apiRecord = (id, externalWebsiteUrl, offset) => ({
  id,
  title: { en: `Concert ${id}` },
  start_date: "2026-09-25",
  end_date: "2026-09-25",
  start_time: "19:00",
  end_time: "22:00",
  external_website_url: externalWebsiteUrl,
  venue_name: `Stage ${id}`,
  location: { latitude: 59.331 + offset, longitude: 18.071 },
});

test("real adapter path: organizer URLs are classified while the feed label stays attribution", async () => {
  const out = await collectAnchorEvents({
    anchor: ANCHOR,
    now: NOW,
    registry: REGISTRY,
    fetcher: async (url) => ({
      ok: true,
      status: 200,
      url,
      text: async () => JSON.stringify({ results: [
        apiRecord("home", "https://museum.example.com/", 0),
        apiRecord("page", "https://venue.example/events/concert-page", 0.001),
        apiRecord("relative", "/events/relative", 0.002),
      ] }),
    }),
  });

  const byId = new Map(out.tonight.map((view) => [view.id, view]));
  assert.deepEqual([...byId.keys()].sort(), ["home", "page", "relative"]);
  for (const view of byId.values()) {
    assert.equal(view.source_label, "Visit Example", "the label names the feed, not the destination");
  }
  assert.equal(byId.get("home").source_url, "https://museum.example.com/");
  assert.equal(byId.get("home").source_link_kind, "site_home");
  assert.equal(byId.get("home").source_link_host, "museum.example.com");
  assert.equal(byId.get("page").source_link_kind, "page");
  assert.equal(byId.get("page").source_link_host, "venue.example");
  assert.equal(byId.get("relative").source_url, "/events/relative", "kept exactly as the source gave it");
  assert.equal(byId.get("relative").source_link_kind, null);
  assert.equal(byId.get("relative").source_link_host, null);
});

test("a pool cached before the classification existed is served with it, highlights and browse alike", () => {
  // `agnostic-events-v6` entries written by the previous build hold views
  // without link fields; they must not reach the Planner unclassified.
  const legacyView = (index) => ({
    id: `legacy-${index}`,
    title: `Legacy ${index}`,
    starts_at: `2026-09-25T1${index}:00:00Z`,
    timezone: "Europe/Stockholm",
    timing_relevance: "tonight",
    cultural_tier: "cultural",
    salience_score: 5,
    source_label: "Visit Example",
    source_url: index % 2 ? `https://venue${index}.example/events/${index}` : `https://site${index}.example/`,
  });
  const cached = {
    coverage: "covered",
    tonight: [],
    this_week: [],
    _rankable_events: { tonight: Array.from({ length: 8 }, (_, index) => legacyView(index)), this_week: [] },
  };

  const served = rankCollectedEventsForPreferences(cached, []);
  const rows = [...served.tonight, ...served.browse.tonight.more];
  assert.equal(rows.length, 8, "six highlights plus the browse rows");
  assert.ok(served.browse.tonight.more.length > 0);
  for (const row of rows) {
    assert.deepEqual(
      { source_link_kind: row.source_link_kind, source_link_host: row.source_link_host },
      classifyEventSourceLink(row.source_url),
      row.id,
    );
  }
  assert.ok(rows.some((row) => row.source_link_kind === "site_home"));
  assert.ok(rows.some((row) => row.source_link_kind === "page"));
  assert.equal("_rankable_events" in served, false);
});

test("the evening anchor, woven route stop and route interrupt carry where their link leads", async () => {
  // An injected supply may hand over views without link fields; the weaves
  // derive them from the same source_url instead of trusting their absence.
  const event = {
    id: "ev-home",
    title: "Harbour jazz",
    starts_at: "2026-07-12T19:00:00Z",
    ends_at: "2026-07-12T21:00:00Z",
    timezone: "Europe/Stockholm",
    timing_relevance: "tonight",
    cultural_tier: "cultural",
    route_eligible: true,
    source_label: "Visit Example",
    source_url: "https://museum.example.com/",
    lat: 41.9,
    lng: 12.521,
  };
  const structure = weaveEveningEvent(
    { provenance: "agnostic_anchor", district_day: { areas: [] } },
    { tonight: [event], this_week: [] },
  );
  const anchor = structure.district_day.evening_event;
  assert.equal(anchor.source_label, "Visit Example");
  assert.equal(anchor.source_url, "https://museum.example.com/");
  assert.equal(anchor.source_link_kind, "site_home");
  assert.equal(anchor.source_link_host, "museum.example.com");

  const route = {
    route_shape: "open",
    estimated_km: 2,
    main_stops: [
      { id: "b", label: "B", lat: 41.9, lng: 12.5 },
      { id: "c", label: "C", lat: 41.9, lng: 12.51 },
    ],
    legs: [{ from_label: "B", to_label: "C", distance_km: 0.8, estimated_walk_minutes: 10 }],
  };
  const woven = await weaveEveningEventRouteStop({
    result: { days: [{ experimental_agnostic_route_applied: true, primary_route: route }] },
    placeStructure: structure,
  });
  assert.equal(woven.applied, true, woven.blockers.join(","));
  const stop = woven.result.days[0].primary_route.main_stops.at(-1);
  assert.equal(stop.is_live_event, true);
  assert.deepEqual(stop.source, {
    kind: "live_event_feed",
    label: "Visit Example",
    url: "https://museum.example.com/",
    link_kind: "site_home",
    link_host: "museum.example.com",
  });
  assert.equal(woven.interrupt.event.source_url, "https://museum.example.com/");
  assert.equal(woven.interrupt.event.source_link_kind, "site_home");
  assert.equal(woven.interrupt.event.source_link_host, "museum.example.com");
});

test("a Blitz Live move says where its link leads, separately from the listing feed", async () => {
  const stockholm = { lat: 59.3293, lng: 18.0686 };
  const liveEvent = {
    id: "live-home",
    title: "Independent harbour concert",
    lat: stockholm.lat + 0.004,
    lng: stockholm.lng,
    starts_at: "2026-08-10T13:30:00Z",
    ends_at: "2026-08-10T19:00:00Z",
    timezone: "Europe/Stockholm",
    timing_relevance: "now",
    salience_score: 8,
    preference_score: 2,
    cultural_tier: "cultural",
    route_eligible: true,
    source_label: "Visit Example",
    source_url: "https://museum.example.com/en/",
  };
  const out = await buildAnywhereBlitzDecision({
    coords: stockholm,
    openDataLoader: async () => [{
      id: "node/2",
      name: "Neighbourhood gallery",
      type: "museum",
      lat: 59.3297,
      lng: 18.0688,
      tags: ["culture"],
      sources: [
        { provider: "osm", family: "map", tier: "inferred", url: "https://www.openstreetmap.org/node/2" },
        { provider: "wikidata", family: "open_knowledge", tier: "inferred", url: "https://www.wikidata.org/wiki/Q2" },
      ],
    }],
    eventSupply: async () => ({
      coverage: "covered",
      tonight: [liveEvent],
      this_week: [],
      acquisition: { source_health: { status: "healthy", result: "events_found", selected_source_count: 1, responding_source_count: 1 } },
    }),
    weatherProvider: async () => ({
      temperatureMax: 22,
      precipitationProbabilityMax: 5,
      weatherCode: 1,
      timezone_resolution: { timezone: "Europe/Stockholm", timezone_source: "weather_provider_auto" },
    }),
    clock: { now: () => "2026-08-10T14:00:00Z" },
    preferences: ["culture"],
  });

  assert.equal(out.best_move.kind, "live_event");
  assert.equal(out.best_move.source.label, "Visit Example");
  assert.equal(out.best_move.source.url, "https://museum.example.com/en/");
  assert.equal(out.best_move.source.link_kind, "site_home");
  assert.equal(out.best_move.source.link_host, "museum.example.com");
});
