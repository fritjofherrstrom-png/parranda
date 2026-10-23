"use strict";

// Request-time venue seed -> real scout/binding -> real provider -> Live gates.
// These fixtures are intentionally offline; no geocoder may invent a host match.
const assert = require("node:assert/strict");
const test = require("node:test");
const { collectAnchorEvents } = require("../server/place-candidates/agnostic-event-supply");
const { scoutLocalEventSources } = require("../server/pulse-sources/local-event-source-scout");
const { feedsFromScout } = require("../server/pulse-sources/request-time-event-discovery");
const { extractIcalEvents, mapIcalEventToRaw } = require("../server/pulse-sources/events-calendar-source-provider");

const HOST = { name: "Aurora Theatre", lat: 53.5459, lng: 9.9846, wikidata_ref: "Q1234567" };
const ANCHOR = { lat: 53.5511, lng: 9.9937 };
const PLACE_CONTEXT = { locality: "Hamburg" };
const BOUNDS = { south: 53.47, north: 53.63, west: 9.87, east: 10.11 };
const SEED = { url: "https://aurora.example/", label: HOST.name, lat: HOST.lat, lng: HOST.lng,
  wikidata_ref: HOST.wikidata_ref, family: "venue", discovery_method: "wikidata_venue_website", trust_tier: "inferred" };
const response = (body, type = "text/html") => ({ ok: true, status: 200,
  headers: { get: name => name.toLowerCase() === "content-type" ? type : null }, text: async () => body });

function calendar(geo) {
  return ["BEGIN:VCALENDAR", "VERSION:2.0", "BEGIN:VEVENT", "UID:ical-fixture", "SUMMARY:Fixture concert",
    "DTSTART:20261024T170000Z", "DTEND:20261024T190000Z", `LOCATION:${HOST.name}`,
    ...(geo === undefined ? [] : [`GEO:${geo}`]), "END:VEVENT", "END:VCALENDAR", ""].join("\r\n");
}

async function collectIcal(geo) {
  const ics = calendar(geo);
  const raw = mapIcalEventToRaw(extractIcalEvents(ics)[0]);
  const fetcher = async url => String(url).endsWith("/robots.txt")
    ? response("User-agent: *\nAllow: /", "text/plain")
    : String(url).endsWith(".ics") ? response(ics, "text/calendar")
      : response('<html><a href="/calendar.ics">Calendar</a></html>');
  const scouted = await scoutLocalEventSources({ place: { name: "Hamburg", label: "Hamburg" },
    anchor: ANCHOR, bounds: BOUNDS, seeds: [SEED], fetcher, eventReader: null });
  const feeds = feedsFromScout(scouted, { timezone: "Europe/Berlin" });
  assert.equal(feeds.length, 1, "precondition: real scout/binder finds the iCal interface");
  assert.equal(feeds[0].adapter, "ical");
  assert.deepEqual(feeds[0].host_venue, HOST);
  const collection = await collectAnchorEvents({ anchor: ANCHOR, registry: feeds,
    now: "2026-10-22T10:00:00Z", selectedDate: "2026-10-24", time: "this_week", radiusM: 3000,
    fetcher, eventReader: null, placeContext: PLACE_CONTEXT });
  assert.equal(collection.acquisition.source_health.raw_event_count, 1);
  return { raw, collection, events: [...collection.tonight, ...collection.this_week] };
}

for (const [lat, lng] of [[91, HOST.lng], [0, 0], [52.52, 13.39], [0, HOST.lng], [HOST.lat, 0]]) {
  test(`request-time schema explicit point ${lat};${lng} reaches geography rejection unchanged`, async () => {
    const { collection, events, geocodes } = await collectSchema({ "@type": "Place", name: HOST.name,
      geo: { "@type": "GeoCoordinates", latitude: lat, longitude: lng } });
    assert.equal(events.length, 0);
    assert.equal(geocodes, 0, "source coordinates must not be replaced by either host or geocoder");
    assert.deepEqual(collection.acquisition.rejection_summary, [{ reason: "outside_anchor_radius", count: 1 }]);
  });
}

for (const geo of ["91;9.9846", "0;0", "52.52;13.39", "0;9.9846", "53.5459;0"]) {
  test(`request-time iCal explicit GEO:${geo} reaches geography rejection unchanged`, async () => {
    const { raw, collection, events } = await collectIcal(geo);
    assert.deepEqual([raw.lat, raw.lng], geo.split(";").map(Number));
    assert.equal(events.length, 0);
    assert.deepEqual(collection.acquisition.rejection_summary, [{ reason: "outside_anchor_radius", count: 1 }]);
  });
}

test("a missing iCal GEO is truly absent and retains supported host fallback", async () => {
  const { raw, events } = await collectIcal(undefined);
  assert.equal(Object.hasOwn(raw, "lat"), false, "missing GEO must not manufacture a lone zero latitude");
  assert.equal(Object.hasOwn(raw, "lng"), false);
  assert.equal(events.length, 1);
  assert.deepEqual([events[0].lat, events[0].lng], [HOST.lat, HOST.lng]);
  assert.equal(events[0].venue_resolution?.basis, "host_venue_name");
  assert.equal(events[0].trust_level, "low");
  assert.equal(events[0].route_eligible, false);
});


async function collectSchema(location, { seed = SEED } = {}) {
  const event = { "@context": "https://schema.org", "@type": "MusicEvent", name: "Fixture concert",
    startDate: "2026-10-24T19:00:00+02:00", endDate: "2026-10-24T21:00:00+02:00",
    url: "https://aurora.example/show", ...(location === undefined ? {} : { location }) };
  const page = `<html><script type="application/ld+json">${JSON.stringify(event)}</script></html>`;
  const fetcher = async url => String(url).endsWith("/robots.txt")
    ? response("User-agent: *\nAllow: /", "text/plain") : response(page);
  const scouted = await scoutLocalEventSources({ place: { name: "Hamburg", label: "Hamburg" },
    anchor: ANCHOR, bounds: BOUNDS, seeds: [seed], fetcher, eventReader: null });
  const feeds = feedsFromScout(scouted, { timezone: "Europe/Berlin" });
  assert.equal(feeds.length, 1, "precondition: the real scout/binder finds the JSON-LD interface");
  let geocodes = 0;
  const collection = await collectAnchorEvents({ anchor: ANCHOR, registry: feeds,
    now: "2026-10-22T10:00:00Z", selectedDate: "2026-10-24", time: "this_week", radiusM: 3000,
    fetcher, eventReader: null, placeContext: PLACE_CONTEXT,
    venueResolver: async () => { geocodes += 1; return []; } });
  assert.equal(collection.acquisition.source_health.raw_event_count, 1, "precondition: the provider read the source event");
  return { collection, feeds, events: [...collection.tonight, ...collection.this_week], geocodes };
}

for (const name of ["Rex", "Aurora West Theatre", "Aurora Theatre, Satellite Stage"]) {
  test(`request-time schema venue ${name} is not published at the host point`, async () => {
    const { collection, events, geocodes } = await collectSchema({ "@type": "Place", name });
    assert.equal(events.length, 0, "a host website alone does not prove the event's named venue");
    assert.ok(geocodes > 0, "the row reaches ordinary bounded venue lookup rather than invented host geometry");
    assert.ok(collection.acquisition.rejection_summary.some(row => row.reason === "missing_event_coordinates"));
  });
}

for (const [name, location, basis] of [
  ["exact host", { "@type": "Place", name: HOST.name }, "host_venue_name"],
  ["genuinely nameless programme", undefined, "host_venue_programme"],
]) {
  test(`request-time schema ${name} retains host geometry and low Pulse-only trust`, async () => {
    const { collection, events, geocodes } = await collectSchema(location);
    assert.equal(events.length, 1);
    const [event] = events;
    assert.deepEqual([event.lat, event.lng], [HOST.lat, HOST.lng]);
    assert.equal(event.venue_resolution?.basis, basis);
    assert.equal(event.venue_resolution?.ref, HOST.wikidata_ref);
    assert.equal(event.trust_level, "low");
    assert.equal(event.route_eligible, false);
    assert.equal(event.pulse_display_eligible, true);
    assert.equal(geocodes, 0);
    assert.equal(collection.acquisition.source_health.result, "events_found");
  });
}
