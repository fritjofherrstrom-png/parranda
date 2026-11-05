"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createRequestTimeEventDiscovery } = require("../server/pulse-sources/request-time-event-discovery");
const { collectAnchorEvents } = require("../server/place-candidates/agnostic-event-supply");

const HOME = "https://lantern.example/";
const PROGRAMME_URL = "https://lantern.example/programme";
const ANCHOR = { lat: 55.6, lng: 14.2 };
const CONTEXT = { locality: "Coast Town", country_code: "se", country: "Sweden" };
function page(year = 2026) {
  return `<html lang="en"><h2>Programme Lantern Coast ${year}</h2>
    <h2>${year === 2026 ? "Friday" : "Thursday"} 30/10</h2>
    <h3>West Quay</h3><p><strong>18:00-20:00 Lantern Pavilion</strong><br>A workshop.</p>
    <h3>East Quay</h3><p><strong>18:00-20:00 Lantern Pavilion</strong><br>A different workshop.</p>
    <h2>31/10</h2><h3>West Quay</h3><p>18:00-20:00 Lantern Pavilion<br>Book before 25 October.</p>
    <h2>1/11</h2><h3>East Quay</h3><p>18:00-20:00 Lantern Pavilion<br>The closing workshop.</p></html>`;
}
function fixture({ robots = "User-agent: *\nAllow: /", year = 2026 } = {}) {
  const calls = [];
  const fetcher = async input => {
    const url = String(input);
    calls.push(url);
    const body = url === `${HOME}robots.txt` ? robots : url === HOME
      ? '<html lang="en"><a href="/programme">Programme 2026</a></html>'
      : url === PROGRAMME_URL ? page(year) : assert.fail(`Unexpected fixture request: ${url}`);
    return { ok: true, status: 200, url, headers: { get: name => name.toLowerCase() === "content-type"
      ? (url.endsWith("robots.txt") ? "text/plain" : "text/html") : null }, text: async () => body };
  };
  const discovery = createRequestTimeEventDiscovery({ fetcher,
    cache: { get: async (_key, producer) => producer() },
    sourceSearch: async () => ({ status: "complete", seeds: [{ url: HOME }] }),
    timezoneForPoint: () => "Europe/Stockholm",
  });
  return { calls, fetcher, discovery };
}
function collect(feeds, fetcher, venueResolver) {
  return collectAnchorEvents({ anchor: ANCHOR, placeContext: CONTEXT, registry: feeds,
    now: "2026-10-30T08:00:00Z", selectedDate: "2026-10-30", eventReader: null,
    fetcher, venueResolver, radiusM: 3000 });
}

test("homepage discovery delivers separate nearby programme activities and their festival context to Live", async () => {
  const { calls, discovery, fetcher } = fixture();
  const found = await discovery({ anchor: ANCHOR, placeContext: CONTEXT });
  assert.equal(found.status, "found");
  assert.equal(found.feeds.length, 1);
  assert.equal(found.feeds[0].adapter, "official_program_article");
  assert.equal(found.feeds[0].pulse_only, true);
  assert.equal(found.feeds[0].runtime_trust, "request_time_single_observation");
  assert.ok(calls.includes(PROGRAMME_URL), "the ordinary scout follows the programme link");
  const queries = [];
  const live = await collect(found.feeds, fetcher, async query => {
    queries.push(query);
    assert.match(query, /Lantern Pavilion, (West|East) Quay/);
    return [{ label: query, lat: 55.601, lng: query.includes("West Quay") ? 14.201 : 14.205,
      confidence: "high", provenance: "controlled_fixture_resolver" }];
  });
  assert.equal(live.tonight.length, 2, "same source page, name and time do not merge distinct areas");
  assert.notEqual(live.tonight[0].id, live.tonight[1].id);
  assert.equal(new Set(live.tonight.map(row => row.place)).size, 2);
  assert.equal(live.acquisition.source_health.accepted_event_count, 4);
  for (const row of [...live.tonight, ...live.this_week]) {
    assert.equal(row.source_url, PROGRAMME_URL);
    assert.equal(row.route_eligible, false);
    assert.deepEqual(row.programme, { title: "Programme Lantern Coast 2026", source_url: PROGRAMME_URL,
      starts_on: "2026-10-30", ends_on: "2026-11-01" });
  }
  assert.ok(queries.length > 0);
});

test("a programme without resolvable venue geometry does not invent a festival map point", async () => {
  const { discovery, fetcher } = fixture();
  const found = await discovery({ anchor: ANCHOR, placeContext: CONTEXT });
  const live = await collect(found.feeds, fetcher, async () => []);
  assert.deepEqual(live.tonight, []);
  assert.deepEqual(live.this_week, []);
  assert.ok(live.acquisition.source_health.rejected_event_count > 0);
});

test("robots exclusions and old programme years cannot become current Live facts", async () => {
  const blocked = fixture({ robots: "User-agent: *\nDisallow: /" });
  assert.equal((await blocked.discovery({ anchor: ANCHOR, placeContext: CONTEXT })).status, "empty");
  assert.deepEqual(blocked.calls, [`${HOME}robots.txt`]);
  const old = fixture({ year: 2025 });
  const found = await old.discovery({ anchor: ANCHOR, placeContext: CONTEXT });
  assert.equal(found.status, "found", "an archived source is discoverable, not current event evidence");
  const live = await collect(found.feeds, old.fetcher, async () => assert.fail("old rows use no venue budget"));
  assert.deepEqual(live.tonight, []);
  assert.deepEqual(live.this_week, []);
});
