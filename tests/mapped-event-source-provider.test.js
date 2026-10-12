"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const { createMappedEventSourceProvider } = require("../server/pulse-sources/mapped-event-source-provider");
const { buildVenueRegistry, REGISTRY_SCHEMA } = require("../server/pulse-sources/reviewed-event-venues");
const {
  collectAnchorEvents,
  createLocalEventProvider,
  resolveEventFeedRegistry,
  resolveEventFeedsForAnchor,
} = require("../server/place-candidates/agnostic-event-supply");
const { nuxtPage } = require("./helpers/devalue-fixture");

const FEEDS_FILE = path.join(__dirname, "../config/reviewed-event-feeds.json");
const registry = () => resolveEventFeedRegistry({ PARRANDA_EVENT_FEEDS_FILE: FEEDS_FILE });
const response = (body) => ({ ok: true, status: 200, text: async () => (typeof body === "string" ? body : JSON.stringify(body)) });

// Real records from www.goteborg.com/evenemang (12 October 2026), trimmed.
const LISEBERG = {
  id: 115091, type: "event", link: "https://www.goteborg.com/evenemang/halloween-pa-liseberg/",
  title: { rendered: "Halloween på Liseberg 2026" }, modified: "2026-10-08T11:35:42",
  information: {
    dates: [
      { start: "2026-10-02T15:00", note: "", noteEn: "", end: "2026-10-02T22:00" },
      // The day before the window: inside the cheap pre-filter's slack only.
      { start: "2026-10-12T12:00", note: "", noteEn: "", end: "2026-10-12T20:00" },
      { start: "2026-10-13T12:00", note: "", noteEn: "", end: "2026-10-13T20:00" },
      { start: "2026-10-27T15:00", note: "", noteEn: "", end: "2026-10-27T21:00" },
    ],
    place: { id: 1218, title: "Liseberg", slug: "liseberg" },
    contact: { location: {
      address: "Liseberg, Örgrytevägen, Gothenburg, Sweden", lat: 57.6952191, lng: 11.9924641, zoom: 16,
      name: "Liseberg", street_number: "5", street_name: "Örgrytevägen", post_code: "402 22", country: "Sweden",
    } },
  },
};
const KULTURNATTA = {
  id: 318704, type: "event", link: "https://www.goteborg.com/evenemang/kulturnatta/",
  title: { rendered: "Kulturnatta 2026" }, modified: "2026-08-13T10:49:22",
  information: {
    dates: [{ start: "2026-10-16T17:00", note: "", noteEn: "" }],
    place: false,
    contact: { location: { address: "Göteborg, Sverige", lat: 57.70887, lng: 11.97456, zoom: 13, name: "Göteborg", city: "Göteborg", country: "Sverige" } },
  },
};
const TRADGARN = {
  id: 397012, type: "event", link: "https://www.goteborg.com/evenemang/arne-alligator-djungeltrumman-tradgarn/",
  title: { rendered: "Arne Alligator &#038; Djungeltrumman &#8211; Trädgår&#8217;n" }, modified: "2026-08-17T12:12:43",
  information: {
    dates: [
      { start: "2026-10-14T12:00", note: "", noteEn: "" },
      // An end clock after midnight without its date is not a stated end.
      { start: "2026-10-15T22:00", note: "", noteEn: "", end: "2026-10-15T02:00" },
    ],
    place: { id: 2454, title: "Trädgår’n", slug: "tradgarn" },
    contact: { location: { address: "Nya allén 11, 411 38 Gothenburg, Sweden", lat: 57.7044636, lng: 11.9758045, zoom: 13,
      name: "Nya allén 11", street_number: "11", street_name: "Nya allén", post_code: "411 38", country: "Sweden" } },
  },
};
// The same post is embedded twice (calendar list and a teaser).
const GOTEBORG_PAGE = nuxtPage({ data: { calendar: [LISEBERG, KULTURNATTA, TRADGARN], teaser: [LISEBERG] }, page: { type: "page" } });

// Real records from bibliotek.kk.dk/api/v1/events (13 October 2026), trimmed.
const DPL_RECORDS = [
  { uuid: "fdfff94a-a261-4e73-b24f-4e307e86f816", title: "Fortælling og live-tegning med Rasmus Klump (3-8 år) ",
    url: "https://bibliotek.kk.dk/hovedbiblioteket/arrangementer/born-og-unge/fortaelling-og-live-tegning-med-rasmus-klump-3-8-ar",
    date_time: { start: "2026-10-13T10:00:00+02:00", end: "2026-10-13T10:30:00+02:00" }, all_day: false,
    address: { locationType: "physical", location: "4. sal", street: "Krystalgade 15", zip_code: 1172, city: "København K", country: "DK" },
    branches: ["Hovedbiblioteket"], state: "Active", updated_at: "2026-09-22T16:10:25+02:00",
    categories: ["Børn og unge"], tags: ["For familier", "Børn 3-5 år", "Børn 6-9 år"] },
  { uuid: "e73aca9d-2307-44e6-bb9b-ac73dff31692", title: "Åbent kastanjeværksted",
    url: "https://bibliotek.kk.dk/norrebro-bibliotek/arrangementer/born-og-unge/abent-kastanjevaerksted/2026-10-13",
    date_time: { start: "2026-10-13T10:00:00+02:00", end: "2026-10-13T16:00:00+02:00" }, all_day: false,
    address: { locationType: "physical", location: "Børneafdelingen", street: "Nørrebrogade 208", zip_code: 2200, city: "København N", country: "DK" },
    branches: ["Nørrebro Bibliotek"], state: "Active", updated_at: "2026-09-30T09:26:56+02:00", categories: ["Børn og unge"], tags: [] },
  { uuid: "20fcea9f-99c7-45a4-a8c1-61448f328594", title: "Skriveworkshop: Skriv dine bi-karakterer frem",
    url: "https://bibliotek.kk.dk/hovedbiblioteket/arrangementer/skriveworkshops/skriveworkshop-skriv-dine-bi-karakterer-frem-0",
    date_time: { start: "2026-11-20T10:00:00+01:00", end: "2026-11-20T12:00:00+01:00" }, all_day: false,
    address: { locationType: "physical", location: "4. sal, LIVE", street: "Krystalgade 15", zip_code: 1172, city: "København K", country: "DK" },
    branches: ["Hovedbiblioteket"], state: "Active", updated_at: "2026-09-03T11:03:03+02:00", categories: ["Skriveworkshops"], tags: [] },
];
const DPL_CANCELLED = { ...DPL_RECORDS[1], uuid: "cancelled-copy", title: "Aflyst værksted", state: "Cancelled" };
const DPL_ONLINE = { ...DPL_RECORDS[1], uuid: "online-copy", title: "Online foredrag", address: { locationType: "online" } };
const DPL_UNKNOWN_BRANCH = {
  ...DPL_RECORDS[1], uuid: "unknown-branch", title: "Værksted et ukendt sted",
  address: { locationType: "physical", street: "Ukendtvej 1", zip_code: 2200, city: "København N", country: "DK" },
};

// Points produced by scripts/resolve-event-source-venues.js on 13 October 2026.
const VENUES = buildVenueRegistry({
  schema: REGISTRY_SCHEMA,
  venues: [
    { country: "DK", postal_code: "1172", street: "Krystalgade 15", name: "Hovedbiblioteket", lat: 55.680876, lng: 12.573653,
      geometry_source: "nominatim_osm", osm_ref: "node/340526209", match: "house_number_and_postcode",
      license: "ODbL", attribution: "© OpenStreetMap contributors", resolved_at: "2026-10-13" },
    { country: "DK", postal_code: "2200", street: "Nørrebrogade 208", name: "Nørrebro Bibliotek", lat: 55.699199, lng: 12.542721,
      geometry_source: "nominatim_osm", osm_ref: "node/340536031", match: "house_number_and_postcode",
      license: "ODbL", attribution: "© OpenStreetMap contributors", resolved_at: "2026-10-13" },
  ],
});

function goteborgProvider(fetcher, extra = {}) {
  return createMappedEventSourceProvider({
    endpoint: "https://www.goteborg.com/evenemang", wireProfile: "nuxt_wordpress_acf_events_v1",
    timezone: "Europe/Stockholm", sourceLanguage: "sv", label: "Göteborg & Co", fetcher, ...extra,
  });
}

function dplProvider(fetcher, extra = {}) {
  return createMappedEventSourceProvider({
    endpoint: "https://bibliotek.kk.dk/api/v1/events", wireProfile: "dpl_cms_events_v1",
    timezone: "Europe/Copenhagen", sourceLanguage: "da", label: "Københavns Biblioteker", venueRegistry: VENUES, fetcher, ...extra,
  });
}

test("embedded Nuxt calendar: each stated occurrence in the window becomes one event in the source zone", async () => {
  const calls = [];
  const result = await goteborgProvider(async (url, init) => { calls.push({ url, init }); return response(GOTEBORG_PAGE); })
    .create().collect({ date: "2026-10-13T08:00:00.000Z" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.redirect, "manual");
  assert.equal(result.collection_status.status, "ok");
  const ids = result.time_sensitive_events.map((event) => event.id);
  assert.deepEqual(ids, [
    "115091@2026-10-13T10:00:00.000Z",
    "397012@2026-10-14T10:00:00.000Z",
    "397012@2026-10-15T20:00:00.000Z",
    "318704@2026-10-16T15:00:00.000Z",
  ], "the 2, 12 and 27 Oct occurrences fall outside the window; the teaser copy is not repeated");
  const liseberg = result.time_sensitive_events[0];
  assert.equal(liseberg.title, "Halloween på Liseberg 2026");
  assert.equal(liseberg.starts_at, "2026-10-13T10:00:00.000Z", "12:00 CEST");
  assert.equal(liseberg.ends_at, "2026-10-13T18:00:00.000Z");
  assert.equal(liseberg.time_window.kind, "continuous");
  assert.equal(liseberg.place_context, "Liseberg");
  assert.equal(liseberg.address, "Örgrytevägen 5, 402 22");
  assert.equal(liseberg.lat, 57.6952191);
  assert.equal(liseberg.lng, 11.9924641);
  assert.equal(liseberg.source_url, "https://www.goteborg.com/evenemang/halloween-pa-liseberg/");
  assert.equal(liseberg.venue_resolution, undefined, "a publisher pin is source geometry");
  assert.equal(result.time_sensitive_events[1].title, "Arne Alligator & Djungeltrumman – Trädgår’n");
  const lateShow = result.time_sensitive_events[2];
  assert.equal(lateShow.starts_at, "2026-10-15T20:00:00.000Z");
  assert.equal(lateShow.ends_at, undefined, "an end before the start is dropped, not moved to the next day");
});

test("a city-level map pin is not venue geometry, and a missing end is never guessed", async () => {
  const result = await goteborgProvider(async () => response(GOTEBORG_PAGE)).create().collect({ date: "2026-10-13" });
  const kulturnatta = result.time_sensitive_events.find((event) => event.title === "Kulturnatta 2026");
  assert.equal(kulturnatta.lat, undefined);
  assert.equal(kulturnatta.lng, undefined);
  assert.equal(kulturnatta.place_context, undefined);
  assert.equal(kulturnatta.starts_at, "2026-10-16T15:00:00.000Z");
  assert.equal(kulturnatta.ends_at, undefined);
});

test("occurrences after the autumn clock change use winter time", async () => {
  const result = await goteborgProvider(async () => response(GOTEBORG_PAGE)).create().collect({ date: "2026-10-26" });
  const late = result.time_sensitive_events.find((event) => event.id.startsWith("115091@"));
  assert.equal(late.starts_at, "2026-10-27T14:00:00.000Z", "15:00 CET");
});

test("library API: offset instants, branch venue and a reviewed registry point with its own attribution", async () => {
  const result = await dplProvider(async () => response([...DPL_RECORDS, DPL_CANCELLED, DPL_ONLINE, DPL_UNKNOWN_BRANCH]))
    .create().collect({ date: "2026-10-13T06:00:00.000Z" });
  assert.equal(result.collection_status.status, "ok");
  const titles = result.time_sensitive_events.map((event) => event.title);
  assert.ok(!titles.includes("Aflyst værksted"), "cancelled events are dropped");
  assert.ok(!titles.includes("Online foredrag"), "online events have no walkable venue");
  assert.ok(!titles.includes("Skriveworkshop: Skriv dine bi-karakterer frem"), "outside the window");
  const story = result.time_sensitive_events.find((event) => event.id === "fdfff94a-a261-4e73-b24f-4e307e86f816");
  assert.equal(story.title, "Fortælling og live-tegning med Rasmus Klump (3-8 år)");
  assert.equal(Date.parse(story.starts_at), Date.parse("2026-10-13T08:00:00Z"));
  assert.equal(Date.parse(story.ends_at), Date.parse("2026-10-13T08:30:00Z"));
  assert.equal(story.starts_on, "2026-10-13");
  assert.equal(story.place_context, "Hovedbiblioteket");
  assert.equal(story.address, "Krystalgade 15, 1172 København K");
  assert.equal(story.lat, 55.680876);
  assert.equal(story.lng, 12.573653);
  assert.equal(story.venue_resolution.source, "reviewed_venue_registry");
  assert.equal(story.venue_resolution.license, "ODbL");
  assert.equal(story.venue_resolution.osm_ref, "node/340526209");
  assert.deepEqual(story.tags, ["Børn og unge", "For familier", "Børn 3-5 år", "Børn 6-9 år"]);
  const unknown = result.time_sensitive_events.find((event) => event.id === "unknown-branch");
  assert.equal(unknown.lat, undefined, "an address outside the registry stays mapless");
  assert.equal(unknown.venue_resolution, undefined);
});

test("a source whose records all fall outside the window is empty, not broken", async () => {
  const result = await dplProvider(async () => response([DPL_RECORDS[2]])).create().collect({ date: "2026-10-13" });
  assert.equal(result.collection_status.status, "empty");
  assert.equal(result.collection_status.reason, "source_empty");
});

test("collection fails visibly on HTTP errors, malformed payloads, cross-origin redirects and missing configuration", async () => {
  for (const [fetcher, reason] of [
    [async () => ({ ok: false, status: 503 }), "source_http_503"],
    [async () => response("<html>"), "source_payload_invalid"],
    [async () => response({ not: "a list" }), "source_payload_invalid"],
    [async () => response([{ unrelated: true }]), "source_payload_invalid"],
    [async () => ({ ...response([]), url: "https://elsewhere.example/api" }), "source_redirect_cross_origin"],
  ]) {
    const result = await dplProvider(fetcher).create().collect({ date: "2026-10-13" });
    assert.equal(result.collection_status.status, "failed");
    assert.equal(result.collection_status.reason, reason);
  }
  const page = await goteborgProvider(async () => response("<html><body>no state</body></html>")).create().collect({ date: "2026-10-13" });
  assert.equal(page.collection_status.reason, "source_payload_invalid");
  const noProfile = await dplProvider(async () => response([]), { wireProfile: "unknown_profile" }).create().collect({ date: "2026-10-13" });
  assert.equal(noProfile.collection_status.status, "unavailable");
  const noZone = await dplProvider(async () => response([]), { timezone: "Not/AZone" }).create().collect({ date: "2026-10-13" });
  assert.equal(noZone.collection_status.reason, "source_timezone_unavailable");
});

test("reviewed manifest rows bind Göteborg and Danish libraries to known wire profiles and their own geography", () => {
  const feeds = registry().filter((feed) => feed.adapter === "mapped_events");
  assert.ok(feeds.length >= 7);
  for (const feed of feeds) {
    assert.ok(["dpl_cms_events_v1", "nuxt_wordpress_acf_events_v1"].includes(feed.wire_profile), feed.id);
    assert.ok(feed.timezone && feed.source_language, feed.id);
    assert.equal(feed.pulse_only, true, `${feed.id}: unknown reuse terms stay Pulse-only`);
    assert.equal(feed.terms_status, "unknown");
  }
  const at = (lat, lng) => resolveEventFeedsForAnchor({ lat, lng }, registry()).map((feed) => feed.id);
  assert.ok(at(57.7065, 11.9670).includes("goteborg-co-event-calendar"));
  assert.ok(at(55.6761, 12.5683).includes("dpl-copenhagen-libraries"));
  assert.ok(at(56.1567, 10.2108).includes("dpl-aarhus-libraries"));
  assert.ok(!at(59.3293, 18.0686).some((id) => id.startsWith("dpl-") || id.startsWith("goteborg-")), "Stockholm keeps its own sources");
});

test("the shipped venue registry covers every branch address the Copenhagen fixture names", () => {
  const { loadReviewedVenueRegistry, lookupReviewedVenue } = require("../server/pulse-sources/reviewed-event-venues");
  const shipped = loadReviewedVenueRegistry();
  for (const record of DPL_RECORDS) {
    const entry = lookupReviewedVenue(shipped, { country: record.address.country, postal_code: record.address.zip_code, street: record.address.street });
    assert.ok(entry, record.address.street);
    assert.equal(entry.license, "ODbL");
  }
});

test("Göteborg events reach the shared Live supply with source geometry inside the anchor radius", async () => {
  const feed = registry().find((row) => row.id === "goteborg-co-event-calendar");
  const result = await collectAnchorEvents({
    anchor: { lat: 57.6955, lng: 11.9900 }, registry: [feed], selectedDate: "2026-10-13", now: "2026-10-13T08:00:00Z",
    fetcher: async (url) => { assert.equal(new URL(url).hostname, "www.goteborg.com"); return response(GOTEBORG_PAGE); },
  });
  const events = [...result.tonight, ...result.this_week];
  const liseberg = events.find((event) => event.title === "Halloween på Liseberg 2026");
  assert.ok(liseberg, JSON.stringify(result.acquisition || result.feeds));
  assert.equal(liseberg.lat, 57.6952191);
  assert.equal(liseberg.route_eligible, false, "Pulse-only source");
});

test("Copenhagen library events reach the shared Live supply with the registry point and its attribution", async () => {
  const feed = registry().find((row) => row.id === "dpl-copenhagen-libraries");
  const result = await collectAnchorEvents({
    anchor: { lat: 55.6990, lng: 12.5430 }, registry: [feed], selectedDate: "2026-10-13", now: "2026-10-13T06:00:00Z",
    fetcher: async (url) => { assert.equal(new URL(url).hostname, "bibliotek.kk.dk"); return response(DPL_RECORDS); },
  });
  const events = [...result.tonight, ...result.this_week];
  const workshop = events.find((event) => event.title === "Åbent kastanjeværksted");
  assert.ok(workshop, JSON.stringify(result.acquisition || result.feeds));
  assert.equal(workshop.lat, 55.699199);
  assert.equal(workshop.venue_resolution.source, "reviewed_venue_registry");
  assert.equal(workshop.venue_resolution.attribution, "© OpenStreetMap contributors");
});

test("a provider cannot claim registry geometry for a row the registry did not resolve", async () => {
  const feed = registry().find((row) => row.id === "dpl-copenhagen-libraries");
  const provider = createLocalEventProvider(feed, { fetcher: async () => response(DPL_RECORDS) });
  assert.ok(provider, "mapped_events is an allowlisted adapter");
  const forged = { ...DPL_RECORDS[1], uuid: "forged", address: { ...DPL_RECORDS[1].address, street: "Ukendtvej 9" } };
  const result = await collectAnchorEvents({
    anchor: { lat: 55.6990, lng: 12.5430 }, registry: [feed], selectedDate: "2026-10-13", now: "2026-10-13T06:00:00Z",
    fetcher: async () => response([forged]),
  });
  const events = [...result.tonight, ...result.this_week];
  assert.ok(!events.some((event) => event.title === forged.title && event.venue_resolution?.source === "reviewed_venue_registry"));
});

test("Göteborg and Copenhagen events reach the public Live API", async (t) => {
  const { buildApp } = require("../server/app");
  const { requestJson } = require("./helpers/planner-reservoir-compare");
  const { resolveDefaultEventSupply } = require("../server/place-candidates/agnostic-event-supply");
  for (const city of [
    { name: "Göteborg", anchor: { lat: 57.6955, lng: 11.9900 }, host: "www.goteborg.com", body: GOTEBORG_PAGE, title: "Halloween på Liseberg 2026", date: "2026-10-13", now: "2026-10-13T08:00:00Z" },
    { name: "København", anchor: { lat: 55.6990, lng: 12.5430 }, host: "bibliotek.kk.dk", body: DPL_RECORDS, title: "Åbent kastanjeværksted", date: "2026-10-13", now: "2026-10-13T06:00:00Z" },
  ]) {
    let cached = null;
    let refresh;
    const supply = resolveDefaultEventSupply({ PARRANDA_AGNOSTIC_EVENTS: "enabled", PARRANDA_EVENT_FEEDS_FILE: FEEDS_FILE }, {
      eventCache: { peek: () => cached, warm: (_key, load) => { refresh = load().then((value) => { cached = value; }); } },
      collectEvents: (opts) => collectAnchorEvents({ ...opts, fetcher: async (url) => {
        if (new URL(url).hostname !== city.host) return { ok: false, status: 404 };
        return response(city.body);
      } }),
    });
    const server = buildApp({
      clock: { now: () => city.now }, eventSupply: supply, openDataLoader: null, reviewedPlaceSource: null,
      placeResolver: async () => [{ ...city.anchor, label: city.name, confidence: "medium", provenance: "fixture_resolver" }],
    }).listen(0);
    t.after(() => { server.close(); server.closeAllConnections(); });
    const request = { path: "/api/live-events?lang=en", body: { place_query: city.name, anchor: city.anchor, selected_date: city.date, time: "this_week", scope: "around_place" } };
    const cold = await requestJson(server, request);
    assert.equal(cold.body.live_events.pending, true);
    await refresh;
    const { status, body } = await requestJson(server, request);
    assert.equal(status, 200);
    const events = [...body.live_events.tonight, ...body.live_events.this_week];
    assert.ok(events.some((event) => event.title === city.title), `${city.name}: ${JSON.stringify(body.live_events).slice(0, 600)}`);
  }
});
