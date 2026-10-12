"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createRequestTimeEventDiscovery, feedsFromScout } = require("../server/pulse-sources/request-time-event-discovery");
const { createSearxngSourceSearch } = require("../server/pulse-sources/source-search-provider");
const { collectAnchorEvents, resolveDefaultEventSupply } = require("../server/place-candidates/agnostic-event-supply");
const { LIVE_COLLECTION_READ, createLiveCompletionStore } = require("../server/planner/live-completion");

const { memoryCache, response, anchor, input, tick, scoutHtml } = require("./helpers/request-time-review-fixtures");

test("event timezone survives scout binding, TEC provider, normalization and selected-local-date bucket", async () => {
  const endpoint = "https://venue.example/wp-json/tribe/events/v1/events";
  const scouted = await scoutHtml(`<a href="${endpoint}">Events</a>`, async url => {
    assert.equal(url, "https://venue.example/robots.txt");
    return response(url, "User-agent: *\nAllow: /", 200, "text/plain");
  });
  const feeds = feedsFromScout(scouted, { timezone: "Europe/Helsinki" });
  assert.equal(feeds.length, 1);
  const collect = async registry => collectAnchorEvents({ anchor, registry,
    now: "2026-10-12T20:00:00Z", selectedDate: "2026-10-13",
    fetcher: async url => {
      assert.equal(url, endpoint);
      return response(url, JSON.stringify({ events: [{ id: "zone-event", title: "Midnight fixture concert",
        url: "https://venue.example/concert", start_date: "2026-10-13 00:30:00", end_date: "2026-10-13 01:30:00",
        timezone: "Europe/Stockholm", venue: { lat: 65.84, lng: 24.13 } }] }), 200, "application/json");
    } });
  const result = await collect(feeds);
  assert.equal(result.tonight.length, 1, "source-local midnight is selected October 13 despite its October 12 UTC instant");
  assert.equal(result.tonight[0].starts_at, "2026-10-12T22:30:00.000Z");
  assert.equal(result.tonight[0].timezone, "Europe/Stockholm");
  assert.equal(result.tonight[0].route_eligible, false);
  const overridden = await collect(feeds.map(feed => ({ ...feed, timezone: "Europe/Helsinki" })));
  assert.equal(overridden.tonight[0].starts_at, "2026-10-12T21:30:00.000Z", "explicit reviewed descriptor override remains authoritative");
  assert.equal(overridden.tonight[0].timezone, "Europe/Helsinki");
});

for (const [format, body, expectedZone, expectedStart] of [
  ["events_calendar", JSON.stringify({ events: [{ id: "fallback", title: "Floating source concert", url: "https://venue.example/concert",
    start_date: "2026-10-13 00:30:00", venue: { lat: 65.84, lng: 24.13 } }] }), "Europe/Helsinki", "2026-10-12T21:30:00.000Z"],
  ["ical", ["BEGIN:VCALENDAR", "BEGIN:VEVENT", "UID:source-zone", "SUMMARY:Source zone concert",
    "DTSTART;TZID=Europe/Stockholm:20261013T003000", "GEO:65.84;24.13", "URL:https://venue.example/concert",
    "END:VEVENT", "END:VCALENDAR"].join("\r\n"), "Europe/Stockholm", "2026-10-12T22:30:00.000Z"],
]) test(`${format} source zone or coordinate fallback survives the complete collection chain`, async () => {
  const result = await collectAnchorEvents({ anchor, now: "2026-10-12T20:00:00Z", selectedDate: "2026-10-13",
    registry: [{ id: "zone-chain", endpoint: "https://venue.example/calendar", adapter: format, bbox: [24,65.75,24.3,65.95],
      fallback_timezone: "Europe/Helsinki", status: "probationary", pulse_only: true }],
    fetcher: async url => response(url, body, 200, format === "ical" ? "text/calendar" : "application/json") });
  assert.equal(result.tonight.length, 1);
  assert.equal(result.tonight[0].timezone, expectedZone);
  assert.equal(result.tonight[0].starts_at, expectedStart);
});

test("coordinate fallback still reaches structured adapters that require a zone for their published slots",async()=>{
  const payload={stages:[{id:10,title:"Source stage",gpsCoordinates:{lat:anchor.lat,lng:anchor.lng}}],
    bookings:[{id:101,title:"Published local orchestra",tags:[{name:"Music"}],dates:[{scene:{id:10},startDate:"2026-10-13T17:00:00.000Z",endDate:"2026-10-13T18:00:00.000Z"}]}]};
  const html=`<script>self.__next_f.push(${JSON.stringify([1,JSON.stringify(payload)])})</script>`;
  const result=await collectAnchorEvents({anchor,now:"2026-10-13T08:00:00Z",selectedDate:"2026-10-13",
    registry:[{id:"fallback-program",endpoint:"https://program.example/program",adapter:"embedded_program_rsc",bbox:[24,65.75,24.3,65.95],
      fallback_timezone:"Europe/Stockholm",source_language:"en",status:"probationary",pulse_only:true}],
    fetcher:async url=>response(url,html)});
  assert.equal(result.tonight.length,1);
  assert.equal(result.tonight[0].timezone,"Europe/Stockholm");
});
