"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { scoutLocalEventSources } = require("../server/pulse-sources/local-event-source-scout");
const { feedsFromScout } = require("../server/pulse-sources/request-time-event-discovery");
const { collectAnchorEvents } = require("../server/place-candidates/agnostic-event-supply");
const { anchor, place, bounds, memoryCache, tick } = require("./helpers/request-time-review-fixtures");

const page = "https://venue.example/calendar";
const start = "https://venue.example/public/cal.ics";
const calendar = ["BEGIN:VCALENDAR", "VERSION:2.0", "BEGIN:VEVENT", "UID:redirect-concert",
  "DTSTART:20261013T170000Z", "SUMMARY:Redirect concert", "GEO:65.84;24.13",
  "URL:https://venue.example/concert", "END:VEVENT", "END:VCALENDAR"].join("\r\n");

// Only HTTP is simulated. Like native fetch, it follows redirects unless the
// caller explicitly requests manual handling. Every outbound read is observed.
function transport(routes, requests) {
  async function fetcher(url, options = {}, automaticHops = 0) {
    requests.push(String(url));
    options.signal?.throwIfAborted();
    const route = routes.get(String(url));
    assert.ok(route, `unexpected outbound read: ${url}`);
    const result = typeof route === "function" ? await route(options) : route;
    if (result.location && options.redirect !== "manual") {
      if (automaticHops >= 20) throw new Error("native redirect limit");
      return fetcher(new URL(result.location, url).href, options, automaticHops + 1);
    }
    const response = new Response(result.body || "", { status: result.location ? 302 : (result.status || 200),
      headers: result.location ? { location: result.location } : { "content-type": result.type || "text/calendar" } });
    Object.defineProperty(response, "url", { value: String(url) });
    return response;
  }
  return fetcher;
}

async function boundCollection({ redirects, policy = "User-agent: *\nDisallow: /private/\n", policyGate = null, policyStatus = 200, entry = start, payload = calendar }) {
  const requests = [];
  let collecting = false;
  const routes = new Map([
    [page, { body: `<a href="${entry}">Calendar</a>`, type: "text/html" }],
    ["https://venue.example/robots.txt", async () => ({ body: collecting && policyGate ? await policyGate : policy, type: "text/plain", status: collecting ? policyStatus : 200 })],
    ["https://calendar.example/robots.txt", { body: policy, type: "text/plain" }],
    ["https://venue.example/public/final.ics", { body: payload }],
    ["https://venue.example/private/final.ics", { body: payload }],
    ["https://calendar.example/private/final.ics", { body: payload }],
    ["https://calendar.example/public/final.ics", { body: payload }],
    ...redirects,
  ]);
  const fetcher = transport(routes, requests);
  const scout = await scoutLocalEventSources({ place, anchor, bounds, seeds: [{ url: page }], fetcher,
    cache: memoryCache(), maxLinkedPages: 0, maxLinkedPagesPerSeed: 0, eventReader: null });
  assert.equal(scout.results[0].robots.status, "allowed");
  const feeds = feedsFromScout(scout, { timezone: "Europe/Helsinki" });
  assert.equal(feeds.length, 1, "real scout binds the allowed starting feed");
  collecting = true;
  requests.length = 0;
  return { requests, promise: collectAnchorEvents({ anchor, registry: feeds, now: "2026-10-12T20:00:00Z",
    selectedDate: "2026-10-13", fetcher }) };
}

for (const destination of ["https://venue.example/private/final.ics", "https://calendar.example/private/final.ics"]) {
  test(`scout → binding → iCal provider → collector never reads denied redirect ${destination}`, async () => {
    const run = await boundCollection({ redirects: [[start, { location: destination }]] });
    const result = await run.promise;
    assert.equal(run.requests.includes(destination), false, "denied destination must never be read");
    assert.equal(result.tonight.length, 0);
    assert.equal(result.acquisition.source_health.failed_source_count, 1);
    assert.notEqual(result.acquisition.source_health.result, "verified_empty");
  });
}

test("an allowed redirect waits for destination policy before reading its event body", async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const destination = "https://venue.example/public/final.ics";
  const run = await boundCollection({ redirects: [[start, { location: destination }]], policyGate: gate });
  try {
    await tick(); await tick();
    assert.equal(run.requests.includes(destination), false, "no speculative destination fetch while permission is pending");
  } finally { release("User-agent: *\nAllow: /\n"); }
  const result = await run.promise;
  assert.equal(run.requests.includes(destination), true);
  assert.equal(result.tonight[0].title, "Redirect concert");
  assert.equal(result.tonight[0].route_eligible, false);
});

test("allowed same-origin redirect hops retain source-backed occurrences", async () => {
  const run = await boundCollection({ redirects: [[start, { location: "/public/middle.ics" }],
    ["https://venue.example/public/middle.ics", { location: "/public/final.ics" }]] });
  const result = await run.promise;
  assert.equal(result.tonight[0].title, "Redirect concert");
  assert.equal(result.acquisition.source_health.failed_source_count, 0);
});

test("redirects cannot change the bound publisher origin even when the other origin is public", async () => {
  const destination = "https://calendar.example/public/final.ics";
  const run = await boundCollection({ redirects: [[start, { location: destination }]], policy: "User-agent: *\nAllow: /\n" });
  const result = await run.promise;
  assert.equal(run.requests.includes(destination), false);
  assert.equal(result.acquisition.source_health.failed_source_count, 1);
});

test("a redirect loop is stopped before repeating a feed read", async () => {
  const middle = "https://venue.example/public/middle.ics";
  const run = await boundCollection({ redirects: [[start, { location: middle }], [middle, { location: start }]] });
  const result = await run.promise;
  assert.equal(run.requests.filter(url => url === start).length, 1);
  assert.equal(result.acquisition.source_health.failed_source_count, 1);
});

for (const [hops, accepted] of [[3, true], [4, false]]) test(`${hops} feed redirect hops are ${accepted ? "accepted" : "bounded before the next read"}`, async () => {
  const urls = [start, "https://venue.example/public/one.ics", "https://venue.example/public/two.ics",
    "https://venue.example/public/three.ics", "https://venue.example/public/final.ics"];
  const redirects = urls.slice(0, hops).map((url, index) => [url, { location: urls[index + 1] }]);
  redirects.push([urls[hops], { body: calendar }]);
  const run = await boundCollection({ redirects });
  const result = await run.promise;
  assert.equal(result.tonight.length, accepted ? 1 : 0);
  assert.equal(run.requests.includes(urls[hops]), accepted);
});

for (const destination of ["https://venue.example/private/landing", "https://calendar.example/private/landing"]) {
  test(`real scout blocks redirected landing page before binding ${destination}`, async () => {
    const requests = [];
    const routes = new Map([[page, { location: destination }],
      [destination, { body: `<a href="${start}">Calendar</a>`, type: "text/html" }],
      ["https://venue.example/robots.txt", { body: "User-agent: *\nDisallow: /private/\n", type: "text/plain" }]]);
    const scout = await scoutLocalEventSources({ place, anchor, bounds, seeds: [{ url: page }],
      fetcher: transport(routes, requests), maxLinkedPages: 0, maxLinkedPagesPerSeed: 0 });
    const feeds = feedsFromScout(scout);
    const result = await collectAnchorEvents({ anchor, registry: feeds, now: "2026-10-12T20:00:00Z", fetcher: transport(routes, requests) });
    assert.equal(requests.includes(destination), false);
    assert.equal(feeds.length, 0);
    assert.equal(result.coverage, "uncovered");
  });
}

for (const destination of ["https://venue.example/private/final.ics", "https://calendar.example/private/final.ics"]) {
  test(`real TEC provider also refuses denied redirected destination ${destination}`, async () => {
    const entry = "https://venue.example/wp-json/tribe/events/v1/events";
    const run = await boundCollection({ entry, redirects: [[entry, { location: destination }]] });
    const result = await run.promise;
    assert.equal(run.requests.includes(destination), false);
    assert.equal(result.acquisition.source_health.failed_source_count, 1);
  });
}

test("unknown redirect policy never becomes allowed", async () => {
  const destination = "https://venue.example/public/final.ics";
  const run = await boundCollection({ redirects: [[start, { location: destination }]], policyStatus: 503 });
  const result = await run.promise;
  assert.equal(run.requests.includes(destination), false);
  assert.equal(result.acquisition.source_health.failed_source_count, 1);
});

test("a missing Location never causes an invented destination read", async () => {
  const run = await boundCollection({ redirects: [[start, { status: 302 }]] });
  const result = await run.promise;
  assert.equal(run.requests.some(url => url.endsWith("/null") || url.endsWith("/undefined")), false);
  assert.equal(result.acquisition.source_health.failed_source_count, 1);
});

for (const [label, policy, destination] of [
  ["wildcard", "User-agent: *\nDisallow: /private/*\n", "https://venue.example/private/final.ics"],
  ["end anchor", "User-agent: *\nDisallow: /private/final.ics$\n", "https://venue.example/private/final.ics"],
  ["query-specific", "User-agent: *\nDisallow: /public/final.ics?restricted=1$\n", "https://venue.example/public/final.ics?restricted=1"],
  ["actual user agent", "User-agent: parranda\nDisallow: /private/\nUser-agent: parranda-source-scout\nAllow: /private/\n", "https://venue.example/private/final.ics"],
]) test(`redirect access honors ${label} robots rules through the real bound collection`, async () => {
  const run = await boundCollection({ policy, redirects: [[start, { location: destination }], [destination, { body: calendar }]] });
  const result = await run.promise;
  assert.equal(run.requests.includes(destination), false);
  assert.equal(result.acquisition.source_health.failed_source_count, 1);
});

for (const [label, destination, accepted] of [
  ["denied path", "https://venue.example/private/detail", false],
  ["another origin", "https://calendar.example/private/detail", false],
  ["allowed same-origin path", "https://venue.example/public/detail", true],
]) test(`configured schema.org provider → collector handles redirected ${label}`, async () => {
  let collecting = false;
  const requests = [];
  const html = '<script type="application/ld+json">' + JSON.stringify({ "@context": "https://schema.org", "@type": "Event",
    name: "Redirect schema concert", startDate: "2026-10-13T20:00:00+03:00", url: "https://venue.example/concert",
    location: { "@type": "Place", name: "Fixture venue", geo: { latitude: 65.84, longitude: 24.13 } } }) + '</script>';
  const routes = new Map([[page, () => collecting ? { location: destination } : { body: html, type: "text/html" }],
    [destination, { body: html, type: "text/html" }],
    ["https://venue.example/robots.txt", { body: "User-agent: *\nDisallow: /private/\n", type: "text/plain" }]]);
  const fetcher = transport(routes, requests);
  // This provider also has an operator-configured entry path. The discovered
  // iCal/TEC binding path is exercised above; no fabricated binding is used.
  const feeds = [{ id: "configured-schema", label: "Configured schema events", adapter: "schema_org_html",
    endpoint: page, bbox: bounds, timezone: "Europe/Helsinki", status: "active" }];
  collecting = true; requests.length = 0;
  const result = await collectAnchorEvents({ anchor, registry: feeds, now: "2026-10-12T20:00:00Z", selectedDate: "2026-10-13", fetcher });
  assert.equal(requests.includes(destination), accepted);
  assert.equal(result.tonight.length, accepted ? 1 : 0);
  assert.equal(result.acquisition.source_health.failed_source_count, accepted ? 0 : 1);
});

test("redirect policy retrieval uses the same User-Agent as the actual event request", async () => {
  const { createEventsCalendarProvider } = require("../server/pulse-sources/events-calendar-source-provider");
  const requests = [];
  const destination = "https://venue.example/private/final.ics";
  const routes = new Map([[start, { location: destination }], [destination, { body: calendar }],
    ["https://venue.example/robots.txt", options => ({ type: "text/plain", body:
      new Headers(options.headers).get("user-agent") === "FixtureBot/1.0"
        ? "User-agent: *\nDisallow: /private/\n" : "User-agent: *\nAllow: /\n" })]]);
  const provider = createEventsCalendarProvider({ endpoint: start, format: "ical", userAgent: "FixtureBot/1.0", fetcher: transport(routes, requests) });
  await assert.rejects(provider.create({ key: null }).collect(), /source_redirect_robots_disallowed/);
  assert.equal(requests.includes(destination), false);
});
