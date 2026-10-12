"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createRequestTimeEventDiscovery, feedsFromScout } = require("../server/pulse-sources/request-time-event-discovery");
const { createSearxngSourceSearch } = require("../server/pulse-sources/source-search-provider");
const { collectAnchorEvents, resolveDefaultEventSupply } = require("../server/place-candidates/agnostic-event-supply");
const { LIVE_COLLECTION_READ, createLiveCompletionStore } = require("../server/planner/live-completion");

const { memoryCache, response, anchor, input, tick, scoutHtml } = require("./helpers/request-time-review-fixtures");

for (const [label, endpoint] of [
  ["same-origin path", "https://venue.example/private/cal.ics"],
  ["another origin", "https://calendar.example/private/cal.ics"],
]) test(`endpoint binding respects robots for its own ${label} before a provider can read it`, async () => {
  const requests = [];
  const scouted = await scoutHtml(`<html><a href="${endpoint}">Calendar</a></html>`, async url => {
    requests.push(url);
    assert.ok(url.endsWith("/robots.txt"), "disallowed calendar must not be fetched");
    return response(url, "User-agent: *\nDisallow: /private/\n", 200, "text/plain");
  });
  assert.equal(scouted.results[0].robots.status, "allowed", "HTML page itself is allowed");
  assert.equal(scouted.manifest_candidates[0].review.robots_status, "disallowed");
  assert.equal(scouted.manifest_candidates[0].review.robots_checked_url, endpoint);
  const feeds = feedsFromScout(scouted, { timezone: "Europe/Helsinki" });
  assert.equal(feeds.length, 0, "no activation based on the page's borrowed verdict");
  const collected = await collectAnchorEvents({ anchor, registry: feeds, now: "2026-10-12T20:00:00Z",
    selectedDate: "2026-10-13", fetcher: async () => assert.fail("denied endpoint reached a provider") });
  assert.equal(collected.coverage, "uncovered");
  assert.deepEqual(requests.sort(), [...new Set(["https://venue.example/robots.txt", new URL("/robots.txt", endpoint).href])].sort());
});

test("another origin's robots outage is unknown and never borrows page allowance", async () => {
  const scouted = await scoutHtml('<a href="https://calendar.example/cal.ics">Calendar</a>', async url => {
    assert.ok(url.endsWith("/robots.txt"));
    return url.startsWith("https://calendar.example/") ? response(url, "", 503)
      : response(url, "User-agent: *\nAllow: /", 200, "text/plain");
  });
  assert.equal(scouted.manifest_candidates[0].review.robots_status, "unknown");
  assert.equal(feedsFromScout(scouted).length, 0);
});

test("binding rejects endpoint drift after its robots verdict was recorded", async () => {
  const scouted = await scoutHtml('<a href="/public/cal.ics">Calendar</a>', async url =>
    response(url, "User-agent: *\nAllow: /", 200, "text/plain"));
  const manifest = scouted.manifest_candidates[0];
  manifest.review.robots_checked_url = "https://venue.example/another-path";
  assert.equal(feedsFromScout(scouted).length, 0);
});

test("an allowed linked endpoint reaches the real iCal provider and collector", async () => {
  const endpoint = "https://venue.example/public/cal.ics";
  const scouted = await scoutHtml(`<a href="${endpoint}">Calendar</a>`, async url => {
    assert.equal(url, "https://venue.example/robots.txt");
    return response(url, "User-agent: *\nDisallow: /private/\n", 200, "text/plain");
  });
  const feeds = feedsFromScout(scouted, { timezone: "Europe/Helsinki" });
  assert.equal(feeds.length, 1);
  const collected = await collectAnchorEvents({ anchor, registry: feeds, now: "2026-10-12T20:00:00Z", selectedDate: "2026-10-13",
    fetcher: async url => {
      assert.equal(url, endpoint);
      return response(url, ["BEGIN:VCALENDAR", "VERSION:2.0", "BEGIN:VEVENT", "UID:allowed-event",
        "DTSTART:20261013T170000Z", "SUMMARY:Fixture concert", "GEO:65.84;24.13",
        "URL:https://venue.example/concert", "END:VEVENT", "END:VCALENDAR"].join("\r\n"), 200, "text/calendar");
    } });
  assert.equal(collected.tonight.length, 1);
  assert.equal(collected.tonight[0].route_eligible, false);
});

