"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createHash } = require("node:crypto");
const { venueSeedsFromBindings, createEventVenueSeeds } = require("../server/pulse-sources/event-venue-seeds");
const { validHostVenue } = require("../server/place-candidates/host-venue-geometry");

const HOST = { name: "Aurora Theatre", lat: 53.5459, lng: 9.9846, wikidata_ref: "Q1234567" };
const binding = (lat, lng) => ({
  item: { value: "http://www.wikidata.org/entity/Q1234567" },
  itemLabel: { value: HOST.name },
  classes: { value: "http://www.wikidata.org/entity/Q24354" },
  website: { value: "https://aurora.example/" },
  lat: { value: lat }, lng: { value: lng }, dist: { value: "0.2" },
});
const malformed = [null, "", "   ", false, true, [], {}, "NaN", "Infinity"];

for (const field of ["lat", "lng"]) {
  test(`venue seeds reject malformed ${field} primitives before numeric conversion`, () => {
    for (const value of malformed) {
      const point = { ...HOST, [field]: value };
      assert.deepEqual(venueSeedsFromBindings([binding(point.lat, point.lng)]), [], JSON.stringify({ field, value }));
    }
  });
  test(`host geometry rejects malformed ${field} primitives before numeric conversion`, () => {
    for (const value of malformed) {
      assert.equal(validHostVenue({ ...HOST, [field]: value }), null, JSON.stringify({ field, value }));
    }
  });
}

test("numeric and numeric-string coordinates, including genuine zero axes, retain their meaning", () => {
  for (const [lat, lng] of [[0, 10], [10, 0], ["0", "10"], ["10", "0"], ["53.5459", "9.9846"], [-90, -180]]) {
    const seeds = venueSeedsFromBindings([binding(lat, lng)]);
    assert.equal(seeds.length, 1);
    assert.deepEqual([seeds[0].lat, seeds[0].lng], [Number(lat), Number(lng)]);
    assert.deepEqual(validHostVenue({ ...HOST, lat, lng }), { ...HOST, lat: Number(lat), lng: Number(lng) });
  }
  // Keep the existing policies: seed coordinates allow real 0;0, while the host
  // geometry boundary does not accept that sentinel as a resolved venue.
  assert.equal(venueSeedsFromBindings([binding(0, 0)]).length, 1);
  assert.equal(validHostVenue({ ...HOST, lat: 0, lng: 0 }), null);
});

test("an old normalized seed cache cannot attest the corrected coordinate contract", async () => {
  const endpoint = "https://query.wikidata.org/sparql";
  const anchor = { lat: 53.55, lng: 9.99 };
  const oldKey = createHash("sha256").update(JSON.stringify([endpoint, anchor, 3])).digest("hex").slice(0, 32);
  const oldValue = { status: "ok", reason: null, seeds: [{ ...HOST, lat: 0, url: "https://old.example/" }] };
  const stored = new Map([[oldKey, oldValue]]);
  let fetches = 0;
  const cache = {
    async get(key, produce, { shouldStore } = {}) {
      if (stored.has(key)) return stored.get(key);
      const value = await produce();
      if (shouldStore(value)) stored.set(key, value);
      return value;
    },
  };
  const lookup = createEventVenueSeeds({ endpoint, cache, fetcher: async () => {
    fetches += 1;
    return { ok: true, status: 200, json: async () => ({ results: { bindings: [binding(String(HOST.lat), String(HOST.lng))] } }) };
  } });
  const first = await lookup({ anchor });
  assert.equal(fetches, 1, "old coercion-era geometry must be revalidated, not reused");
  assert.deepEqual([first.seeds[0].lat, first.seeds[0].lng], [HOST.lat, HOST.lng]);
  assert.equal(stored.get(oldKey), oldValue, "versioning must not mutate existing cache entries");
  assert.deepEqual(await lookup({ anchor }), first);
  assert.equal(fetches, 1, "validated current-version seeds still coalesce and cache normally");
});

test("discovery does not reuse host bindings cached before coordinate validation", async () => {
  const { createRequestTimeEventDiscovery } = require("../server/pulse-sources/request-time-event-discovery");
  const anchor = { lat: 53.55, lng: 9.99 };
  const cell = `${Math.round(anchor.lat * 100)}:${Math.round(anchor.lng * 100)}`;
  const legacyKey = `rt-discovery:${createHash("sha256").update(cell).digest("hex").slice(0, 16)}`;
  const old = { status: "found", feeds: [{ host_venue: { ...HOST, lat: 0 } }] };
  let searches = 0;
  const discovery = createRequestTimeEventDiscovery({
    cache: { get: async (key, produce) => key === legacyKey ? old : produce() },
    sourceSearch: async () => { searches += 1; return { status: "ok", seeds: [] }; },
  });
  const result = await discovery({ anchor, placeContext: { locality: "Hamburg" } });
  assert.equal(searches, 1, "old normalized host points are not authoritative under the new contract");
  assert.equal(result.status, "empty");
  assert.deepEqual(result.feeds, []);
});
