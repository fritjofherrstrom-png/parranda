"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { normalizeTimeSensitiveSourceEvent } = require("../server/pulse-sources/time-sensitive-event");
const { fuseTimeSensitiveEvents } = require("../server/pulse-sources/event-fusion");
const { toEventView } = require("../server/place-candidates/agnostic-event-supply");
const { budget } = require("../server/planner/published-day-fields");

const URL = "https://festival.example/programme-2026";
const PROGRAMME = { title: "Autumn Lights 2026", source_url: URL,
  starts_on: "2026-10-30", ends_on: "2026-11-01" };
function event(overrides = {}) {
  return normalizeTimeSensitiveSourceEvent({ id: "concert", title: "Harbour concert",
    source_url: URL, source_provider_id: "festival", source_identity: "festival.example",
    starts_on: "2026-10-31", starts_at: "2026-10-31T17:00:00Z",
    ends_at: "2026-10-31T19:00:00Z", place_context: "Harbour Hall", confidence: "low",
    source_tier: "verified", programme: PROGRAMME, ...overrides,
  }, { timezone: "Europe/Stockholm", now: new Date("2026-10-27T10:00:00Z") });
}

test("a source programme survives normalization and Live without supplying venue geometry", () => {
  const normalized = event({ programme: { ...PROGRAMME, lat: 55.6, lng: 14.2, route_eligible: true } });
  assert.deepEqual(normalized.programme, PROGRAMME);
  assert.equal(normalized.lat, undefined);
  assert.equal(normalized.lng, undefined);
  const view = toEventView(normalized, { id: "festival", label: "Festival publisher" }, { routeEligible: false });
  assert.deepEqual(view.programme, PROGRAMME);
  assert.equal(view.route_eligible, false);
});

test("incoherent programme metadata is dropped without inventing a replacement source or date", () => {
  const invalid = [
    { ...PROGRAMME, source_url: "https://other.example/programme" },
    { ...PROGRAMME, source_url: "javascript:alert(1)" },
    { ...PROGRAMME, starts_on: "2026-02-30" },
    { ...PROGRAMME, starts_on: "2026-11-02" },
    { ...PROGRAMME, starts_on: "2026-01-01" },
    { ...PROGRAMME, ends_on: "2026-10-30" },
    { ...PROGRAMME, title: "" },
  ];
  for (const programme of invalid) {
    const normalized = event({ programme });
    assert.ok(normalized, "the independent source occurrence remains valid");
    assert.equal(normalized.programme, undefined);
    assert.equal(normalized.starts_on, "2026-10-31");
    assert.equal(normalized.source_url, URL);
  }
});

test("corroboration retains the programme and the publisher that owns its context", () => {
  const primary = event({ id: "direct", programme: undefined, source_url: "https://venue.example/concert",
    source_provider_id: "venue", source_identity: "venue.example", source_tier: "official", confidence: "strong",
    lat: 55.601, lng: 14.201 });
  const secondary = event({ lat: 55.601, lng: 14.201 });
  const [fused, ...rest] = fuseTimeSensitiveEvents([primary, secondary]);
  assert.equal(rest.length, 0);
  assert.equal(fused.source_url, "https://venue.example/concert");
  assert.deepEqual(fused.programme, PROGRAMME);
  assert.equal(fused.field_provenance.programme, "festival.example");
});

test("published event facts preserve coherent programme context using only already attested public URLs", () => {
  const view = toEventView(event(), { id: "festival", label: "Festival publisher" }, { routeEligible: false });
  const copy = budget({ publicSourceUrls: new Set([URL]) }).copy("Event", view);
  assert.deepEqual(copy.programme, PROGRAMME);
  for (const programme of [{ ...PROGRAMME, ends_on: "2026-10-29" },
    { ...PROGRAMME, source_url: "https://unattested.example/programme" }]) {
    assert.throws(() => budget({ publicSourceUrls: new Set([URL]) }).copy("Event", { ...view, programme }));
  }
});
