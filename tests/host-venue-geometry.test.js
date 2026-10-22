"use strict";

// A venue's own programme places its events at that venue, on evidence only.
// Shapes from the 2026-10-18 venue-lane measurement; deterministic.
const assert = require("node:assert/strict");
const test = require("node:test");

const { placeAtHostVenue, validHostVenue } = require("../server/place-candidates/host-venue-geometry");
const { collectAnchorEvents } = require("../server/place-candidates/agnostic-event-supply");
const { scoutLocalEventSources } = require("../server/pulse-sources/local-event-source-scout");
const { feedsFromScout } = require("../server/pulse-sources/request-time-event-discovery");

const SUNSET = { name: "Sunset/Sunside", lat: 48.8597, lng: 2.3486, wikidata_ref: "Q3504218" };
const ALCAZAR = { name: "Teatro Alcázar", lat: 40.4187, lng: -3.7004, wikidata_ref: "Q5999999" };
const SHIP = { name: "Das Schiff", lat: 53.5459, lng: 9.9846, wikidata_ref: "Q1170000" };
const AURORA = { name: "Aurora Theatre", lat: 53.5459, lng: 9.9846, wikidata_ref: "Q1234567" };
const row = (fields) => ({ id: fields.title, title: fields.title, starts_at: "2026-10-20T19:30:00+02:00", ...fields });

for (const place of ["Rex", "Aurora West Theatre", "Aurora Theatre, Satellite Stage"]) {
  test(`a programme naming ${place} cannot lend the host point to that row or unnamed siblings`, () => {
    const rows = [row({ title: "Named concert", place_context: place }), row({ title: "Unnamed concert" })];
    const placed = placeAtHostVenue(rows, AURORA);
    assert.equal(placed[0], rows[0], "an explicit unknown/conflicting venue is not a host match or an absent name");
    assert.equal(placed[1], rows[1], "the conflicting venue blocks the source-wide programme assumption");
  });
}

test("one matching venue field cannot hide a conflicting venue field", () => {
  const event = row({ title: "Conflicting fields", place_context: AURORA.name, venue_name: "Rex" });
  assert.equal(placeAtHostVenue([event], AURORA)[0], event);
});

test("exact host identity still works when another row names a different venue", () => {
  const rows = [row({ title: "Host concert", place_context: "THE AURORA THEATRE" }), row({ title: "Other concert", place_context: "Rex" })];
  const placed = placeAtHostVenue(rows, AURORA);
  assert.equal(placed[0].venue_resolution?.basis, "host_venue_name");
  assert.deepEqual([placed[0].lat, placed[0].lng], [AURORA.lat, AURORA.lng]);
  assert.equal(placed[1], rows[1]);
});


test("an event naming the host venue gets its point, with the basis kept", () => {
  // A genuinely absent point, not the old iCal parser's spurious lone zero.
  const [placed] = placeAtHostVenue([row({ title: "Charlotte Reinhardt", place_context: "Sunside" })],
    SUNSET, { placeContext: { locality: "Paris" } });
  assert.deepEqual([placed.lat, placed.lng], [SUNSET.lat, SUNSET.lng]);
  assert.equal(placed.venue_resolution.source, "host_venue");
  assert.equal(placed.venue_resolution.basis, "host_venue_name");
  assert.equal(placed.venue_resolution.ref, "Q3504218");
  assert.equal(placed.venue_resolution.license, "CC0-1.0");
});

test("an event naming another venue is not placed at the host, and its site's unnamed rows are not either", () => {
  const rows = [
    row({ title: "SIX el Musical", place_context: "Teatro Gran Vía", area: "Madrid" }),
    row({ title: "Unnamed row on the same site" }),
  ];
  const placed = placeAtHostVenue(rows, ALCAZAR, { placeContext: { locality: "Madrid" } });
  assert.deepEqual(placed, rows, "a site that lists several venues proves nothing for rows that name none");
});

test("unnamed rows of a single-venue programme are placed at the host", () => {
  const rows = [row({ title: "HAMBURGER WERDEN IN 90 MINUTEN" }), row({ title: "DAS ZIEL IST IM WEG", place_context: "Hamburg" })];
  const placed = placeAtHostVenue(rows, SHIP, { placeContext: { locality: "Hamburg" } });
  assert.deepEqual(placed.map((event) => event.venue_resolution?.basis), ["host_venue_programme", "host_venue_programme"],
    "naming only the town names no venue");
  assert.ok(placed.every((event) => event.lat === SHIP.lat && event.lng === SHIP.lng));
});

test("a located row away from the host shows a multi-venue site; located rows are never moved", () => {
  const elsewhere = row({ title: "Open air", lat: 53.56, lng: 10.02 });
  const unnamed = row({ title: "Matinee" });
  const placed = placeAtHostVenue([elsewhere, unnamed], SHIP);
  assert.equal(placed[0], elsewhere);
  assert.equal(placed[1], unnamed);
  const near = row({ title: "On board", lat: SHIP.lat + 0.0005, lng: SHIP.lng });
  const [kept, placedUnnamed] = placeAtHostVenue([near, unnamed], SHIP);
  assert.equal(kept, near, "existing coordinates are never replaced");
  assert.equal(placedUnnamed.venue_resolution.basis, "host_venue_programme");
});

test("generic words and the town do not make a match", () => {
  const konzerthaus = { name: "Konzerthaus Berlin", lat: 52.5136, lng: 13.3918, wikidata_ref: "Q685920" };
  const generic = row({ title: "Somewhere", place_context: "Theater Berlin" });
  const [alone] = placeAtHostVenue([generic], konzerthaus, { placeContext: { locality: "Berlin" } });
  assert.equal(alone.venue_resolution.basis, "host_venue_programme", "'Theater Berlin' names no particular venue: never a name match");
  const placed = placeAtHostVenue([generic, row({ title: "Elsewhere", place_context: "Volksbühne" })], konzerthaus, { placeContext: { locality: "Berlin" } });
  assert.deepEqual(placed.map((event) => event.venue_resolution), [undefined, undefined], "another named venue in the source stops the programme rule");
  const opera = { name: "Komische Oper Berlin", lat: 52.5157, lng: 13.3854, wikidata_ref: "Q457541" };
  const [named] = placeAtHostVenue([row({ title: "La Bohème", place_context: "Komische Oper" })], opera, { placeContext: { locality: "Berlin" } });
  assert.equal(named.venue_resolution.basis, "host_venue_name");
  const qualified = row({ title: "Unverified branch", place_context: "Komische Oper, Schillertheater" });
  assert.equal(placeAtHostVenue([qualified], opera, { placeContext: { locality: "Berlin" } })[0], qualified,
    "a second venue qualifier is not a verified alias of the host");
});

for (const point of [
  { lat: 91, lng: AURORA.lng }, { lat: AURORA.lat, lng: 181 },
  { lat: 0, lng: 0 }, { lat: "0", lng: "0" }, { lat: 0 },
  { lat: 52.52, lng: 13.39 }, { lat: 0, lng: AURORA.lng }, { lat: AURORA.lat, lng: 0 },
]) {
  test(`explicit event geometry ${JSON.stringify(point)} is never replaced by the host`, () => {
    const event = row({ title: "Located by source", place_context: AURORA.name, ...point });
    const unnamed = row({ title: "No venue" });
    const placed = placeAtHostVenue([event, unnamed], AURORA);
    assert.equal(placed[0], event, "presence is not validity: invalid/partial coordinates must not be repaired to a host point");
    assert.equal(placed[1], unnamed, "an invalid or distant point does not prove a single-venue programme");
  });
}

test("an invalid host venue changes nothing", () => {
  const rows = [row({ title: "Unnamed" })];
  for (const host of [null, {}, { ...SHIP, wikidata_ref: "L1" }, { ...SHIP, lat: 999 }, { ...SHIP, name: "" }]) {
    assert.equal(placeAtHostVenue(rows, host), rows);
    assert.equal(validHostVenue(host), null);
  }
});

// --- end to end: venue seed -> scout -> feed -> collection ---------------------

const PAGE = `<!doctype html><html lang="de"><head><title>Spielplan</title>
<script type="application/ld+json">[
 {"@context":"https://schema.org","@type":"TheaterEvent","name":"Die Wendeltreppe","startDate":"2026-10-20T19:30:00+02:00","endDate":"2026-10-20T21:30:00+02:00","url":"https://www.ship.example/spielplan/wendeltreppe"},
 {"@context":"https://schema.org","@type":"TheaterEvent","name":"Stand-Up Comedy","startDate":"2026-10-21T20:00:00+02:00","endDate":"2026-10-21T22:00:00+02:00","url":"https://www.ship.example/spielplan/stand-up"}
]</script></head><body><h1>Spielplan</h1></body></html>`;
const text = (body, type = "text/html; charset=utf-8") => ({ ok: true, status: 200, headers: { get: (name) => (/content-type/i.test(name) ? type : null) }, text: async () => body });
const fetcher = async (url) => {
  if (String(url).endsWith("/robots.txt")) return text("User-agent: *\nAllow: /\n", "text/plain");
  if (String(url) === "https://www.ship.example/") return text(PAGE);
  return { ok: false, status: 404, headers: { get: () => null }, text: async () => "" };
};

test("a venue's own programme without coordinates reaches Live at the venue, without a geocoder", async () => {
  const anchor = { lat: 53.5511, lng: 9.9937 };
  const seed = { url: "https://www.ship.example/", label: "Das Schiff", lat: SHIP.lat, lng: SHIP.lng, wikidata_ref: SHIP.wikidata_ref,
    family: "venue", discovery_method: "wikidata_venue_website", trust_tier: "inferred" };
  const scouted = await scoutLocalEventSources({ place: { name: "Hamburg", label: "Hamburg" }, anchor,
    bounds: { south: 53.47, north: 53.63, west: 9.87, east: 10.11 }, seeds: [seed], fetcher, eventReader: null });
  const feeds = feedsFromScout(scouted, { timezone: "Europe/Berlin" });
  assert.equal(feeds.length, 1);
  assert.deepEqual(feeds[0].host_venue, { name: "Das Schiff", lat: SHIP.lat, lng: SHIP.lng, wikidata_ref: SHIP.wikidata_ref });
  const collected = await collectAnchorEvents({ anchor, now: "2026-10-19T10:00:00Z", time: "this_week", registry: feeds,
    fetcher, radiusM: 3000, timeoutMs: 5000, venueResolver: async () => assert.fail("no geocoder needed"), placeContext: { locality: "Hamburg" } });
  const events = [...(collected.tonight || []), ...(collected.this_week || [])];
  assert.ok(events.length >= 1, JSON.stringify(collected.acquisition?.rejection_summary));
  for (const event of events) {
    assert.equal(event.venue_resolution?.source, "host_venue");
    assert.equal(event.venue_resolution?.basis, "host_venue_programme");
  }
});

test("a seed without venue identity, or an interface on another site, carries no host venue", async () => {
  const anchor = { lat: 53.5511, lng: 9.9937 };
  const scouted = await scoutLocalEventSources({ place: { name: "Hamburg", label: "Hamburg" }, anchor,
    bounds: { south: 53.47, north: 53.63, west: 9.87, east: 10.11 }, fetcher, eventReader: null,
    seeds: [{ url: "https://www.ship.example/", label: "search hit", discovery_method: "bounded_source_search" }] });
  assert.equal(feedsFromScout(scouted, { timezone: "Europe/Berlin" })[0].host_venue, undefined);
});
