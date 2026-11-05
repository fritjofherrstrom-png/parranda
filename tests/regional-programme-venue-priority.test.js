"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { collectAnchorEvents } = require("../server/place-candidates/agnostic-event-supply");

const ANCHOR = { lat: 55.6, lng: 14.2 };
const SOURCE_URL = "https://coast-programme.example/programme";
const SOURCE = {
  id: "coast-programme", endpoint: SOURCE_URL, adapter: "official_program_article",
  bbox: [14, 55.4, 14.4, 55.8], timezone: "Europe/Stockholm", source_language: "en",
  source_tier: "unknown", confidence: "low", source_family: "venue_calendar",
  source_identity: "coast-programme.example", status: "probationary", pulse_only: true,
  runtime_trust: "request_time_single_observation",
};

// A real programme adapter reads every area; the source's first rows happen
// outside the selected locality and must not spend its sole venue lookup.
function programme({ localDay = "30/10" } = {}) {
  const remote = Array.from({ length: 6 }, (_, i) =>
    `<h3>Other Hamlet ${i + 1}</h3><p>18:${String(i).padStart(2, "0")}-20:00 Remote concert ${i + 1}<br>A stated programme activity.</p>`).join("");
  return `<h2>Programme Lantern Coast 2026</h2><h2>30/10</h2>${remote}
    ${localDay === "30/10" ? "" : `<h2>${localDay}</h2>`}
    <h3>Éast–Quay</h3><p>19:00-21:00 Local lantern concert<br>A stated programme activity.</p>`;
}

async function collect({ locality = "EAST QUAY", html = programme(), resolverResult = "nearby" } = {}) {
  const queries = [];
  const result = await collectAnchorEvents({
    anchor: ANCHOR, registry: [SOURCE], now: "2026-10-30T08:00:00Z", selectedDate: "2026-10-30",
    placeContext: locality === null ? null : { locality, country: "Sweden" },
    venueResolutionLimit: 1, eventReader: null,
    fetcher: async url => {
      assert.equal(String(url), SOURCE_URL);
      return { ok: true, status: 200, text: async () => html };
    },
    venueResolver: async query => {
      queries.push(query);
      if (resolverResult === "none") return [];
      return [{ label: query, lat: resolverResult === "outside" ? 57 : 55.601, lng: 14.201,
        confidence: "high", provenance: "controlled_fixture_resolver" }];
    },
  });
  return { result, queries };
}

test("an exact folded programme area gets the existing venue lookup before earlier other areas", async () => {
  const { result, queries } = await collect();
  assert.equal(queries.length, 1, "the existing cap remains authoritative");
  assert.match(queries[0], /^Local lantern concert, Éast–Quay/);
  assert.deepEqual(result.tonight.map(event => event.title), ["Local lantern concert"]);
  assert.equal(result.tonight[0].lat, 55.601);
  assert.equal(result.tonight[0].route_eligible, false);
  assert.equal(result.tonight[0].trust_level, "low");
  assert.equal(result.tonight[0].source_url, SOURCE_URL);
  assert.equal(result.tonight[0].programme.title, "Programme Lantern Coast 2026");
  assert.equal(result.acquisition.venue_resolution.limit, 1);
  assert.equal(result.acquisition.venue_resolution.attempted_count, 1);
});

for (const locality of [null, "", "West Quay", "East", "East Quay Coast", "---"]) {
  test(`programme locality ${JSON.stringify(locality)} preserves ordinary lookup order`, async () => {
    const { result, queries } = await collect({ locality });
    assert.equal(queries.length, 1);
    assert.match(queries[0], /^Remote concert 1, Other Hamlet 1/);
    assert.deepEqual(result.tonight.map(event => event.title), ["Remote concert 1"]);
  });
}

test("a matching area on a later day cannot consume the active period's first lookup", async () => {
  const { result, queries } = await collect({ html: programme({ localDay: "31/10" }) });
  assert.equal(queries.length, 1);
  assert.match(queries[0], /^Remote concert 1, Other Hamlet 1/);
  assert.deepEqual(result.tonight.map(event => event.title), ["Remote concert 1"]);
  assert.deepEqual(result.this_week, []);
});

test("ordinary article rows with a matching area retain existing timing order", async () => {
  const html = `<h1>Harbour festival 2026</h1><h2>Programme at Other Hamlet</h2>
    <h3>30 October</h3><ul><li>18:00 Early ordinary concert</li></ul>
    <h2>Programme at Éast–Quay</h2><h3>30 October</h3><ul><li>19:00 Late ordinary concert</li></ul>`;
  const { result, queries } = await collect({ html });
  assert.equal(queries.length, 1);
  assert.match(queries[0], /^Other Hamlet/);
  assert.deepEqual(result.tonight.map(event => event.title), ["Early ordinary concert"]);
  assert.equal(result.tonight[0].programme, undefined);
});

for (const resolverResult of ["none", "outside"]) {
  test(`an exact local programme area with ${resolverResult} venue geometry invents no map point`, async () => {
    const { result, queries } = await collect({ resolverResult });
    assert.equal(queries.length, 1);
    assert.match(queries[0], /^Local lantern concert, Éast–Quay/);
    assert.deepEqual(result.tonight, []);
    assert.deepEqual(result.this_week, []);
    assert.equal(result.acquisition.venue_resolution.resolved_count, 0);
    assert.ok(result.acquisition.source_health.rejected_event_count >= 7);
  });
}
