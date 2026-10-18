"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { mapDiscoveryEvent } = require("../server/pulse-sources/ticketmaster-source-provider");

function discoveryEvent(location = { latitude: "59.3326", longitude: "18.0649" }) {
  return {
    id: "coordinate-control",
    name: "Source-owned concert",
    url: "https://www.ticketmaster.com/event/coordinate-control",
    dates: {
      start: { dateTime: "2026-10-25T19:00:00Z" },
      timezone: "Europe/Stockholm",
      status: { code: "onsale" },
    },
    _embedded: { venues: [{ name: "Source-owned venue", location }] },
  };
}

test("Ticketmaster refuses coerced or out-of-range venue coordinates", () => {
  const malformed = [
    null, undefined, "", "   ", false, true, [], ["59.3"], {},
    "not-a-coordinate", Infinity, -Infinity,
  ];
  for (const value of malformed) {
    assert.equal(mapDiscoveryEvent(discoveryEvent({ latitude: value, longitude: "18.0649" })), null,
      `invalid latitude primitive (${typeof value}) must not manufacture geometry`);
    assert.equal(mapDiscoveryEvent(discoveryEvent({ latitude: "59.3326", longitude: value })), null,
      `invalid longitude primitive (${typeof value}) must not manufacture geometry`);
  }
  for (const latitude of [-90.001, 90.001, "-91", "91"]) {
    assert.equal(mapDiscoveryEvent(discoveryEvent({ latitude, longitude: "18.0649" })), null);
  }
  for (const longitude of [-180.001, 180.001, "-181", "181"]) {
    assert.equal(mapDiscoveryEvent(discoveryEvent({ latitude: "59.3326", longitude })), null);
  }
});

test("Ticketmaster keeps real numeric and numeric-string coordinates, including zero", () => {
  for (const location of [
    { latitude: "59.3326", longitude: "18.0649" },
    { latitude: 59.3326, longitude: 18.0649 },
    { latitude: 0, longitude: "0" },
    { latitude: "-90", longitude: "180" },
  ]) {
    const mapped = mapDiscoveryEvent(discoveryEvent(location));
    assert.ok(mapped);
    assert.equal(mapped.lat, Number(location.latitude));
    assert.equal(mapped.lng, Number(location.longitude));
    assert.equal(mapped.provenance.attribution, "Ticketmaster Discovery API");
    assert.equal(mapped.provenance.license, null);
  }
});

async function collectPayload(payload) {
  const { createTicketmasterProvider } = require("../server/pulse-sources/ticketmaster-source-provider");
  return createTicketmasterProvider({
    key: "fixture-only-key",
    anchor: { lat: 59.3326, lng: 18.0649 },
    now: "2026-10-18T12:00:00Z",
    fetcher: async () => ({ ok: true, json: async () => payload }),
  }).create().collect();
}

test("Ticketmaster malformed successful responses cannot attest a healthy empty calendar", async () => {
  for (const payload of [null, [], "invalid", {}, { fault: {} },
    { _embedded: {} }, { _embedded: { events: {} } }]) {
    const result = await collectPayload(payload);
    assert.equal(result.collection_status.status, "failed");
    assert.equal(result.collection_status.reason, "source_payload_invalid");
    assert.deepEqual(result.time_sensitive_events, []);
  }
});

test("Ticketmaster unusable provider rows cannot become confirmed absence", async () => {
  const result = await collectPayload({ _embedded: { events: [discoveryEvent({ latitude: null, longitude: "18.0649" })] } });
  assert.equal(result.collection_status.status, "failed");
  assert.equal(result.collection_status.reason, "source_payload_invalid");
  assert.deepEqual(result.time_sensitive_events, []);
});

test("Ticketmaster explicit empty event arrays and zero-result pages remain healthy empty", async () => {
  for (const payload of [{ _embedded: { events: [] } }, { page: { totalElements: 0 } }]) {
    const result = await collectPayload(payload);
    assert.equal(result.collection_status.status, "empty");
    assert.equal(result.collection_status.reason, "source_empty");
  }
});
