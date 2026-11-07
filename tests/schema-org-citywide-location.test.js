"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { mapSchemaOrgEventToRaw } = require("../server/pulse-sources/schema-org-event-provider");
const { resolveEventVenueGeometry } = require("../server/place-candidates/event-venue-resolution");
const capturedEvent = require("./fixtures/schema-org-single-date-schedule.json");

// Coordinates/resolver outputs below are controlled geometry fixtures, never
// claimed as real provider reads. The source's city-only location is real.
const anchor = { lat: 55.676, lng: 12.568 };
const context = { locality: "København", country: "Danmark", country_code: "dk" };

test("a bare source locality cannot spend a venue lookup or become a city-center point", async () => {
  let calls = 0;
  const raw = mapSchemaOrgEventToRaw(capturedEvent);
  const result = await resolveEventVenueGeometry([raw], { anchor, placeContext: context,
    resolver: async () => { calls++; return [{ ...anchor, confidence: "medium", label: "København" }]; } });
  assert.equal(calls, 0, "the trusted query locality is not a physical event venue");
  assert.equal(result.summary.attempted_count, 0);
  assert.equal(result.events[0].lat, undefined);
  assert.equal(result.events[0].lng, undefined);
});

test("a geocoder's attested settlement geometry cannot stand in for a named venue", async () => {
  const event = { ...mapSchemaOrgEventToRaw(capturedEvent), place_context: "Harbour Stage" };
  const result = await resolveEventVenueGeometry([event], { anchor, placeContext: context,
    resolver: async () => [{ ...anchor, confidence: "medium", label: "Harbour Stage",
      spatial_scope: { source: "resolver_bounds", kind: "settlement",
        bounds: { south: 55.65, north: 55.70, west: 12.54, east: 12.60 } } }] });
  assert.equal(result.summary.resolved_count, 0);
  assert.equal(result.events[0].lat, undefined);
  assert.equal(result.events[0].lng, undefined);
});

test("an actual source address still permits a bounded physical venue match", async () => {
  const event = { ...mapSchemaOrgEventToRaw(capturedEvent), address: "Harbour Street 12" };
  const result = await resolveEventVenueGeometry([event], { anchor, placeContext: context,
    resolver: async () => [{ ...anchor, confidence: "medium", label: "Harbour Street 12",
      spatial_scope: { source: "resolver_bounds", kind: "unknown",
        bounds: { south: 55.6759, north: 55.6761, west: 12.5679, east: 12.5681 } } }] });
  assert.equal(result.summary.resolved_count, 1);
  assert.equal(result.events[0].lat, anchor.lat);
  assert.equal(result.events[0].lng, anchor.lng);
});
