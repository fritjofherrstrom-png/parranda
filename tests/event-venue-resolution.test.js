"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  buildEventVenueQueries,
  buildEventVenueQuery,
  resolveEventVenueGeometry,
} = require("../server/place-candidates/event-venue-resolution");

const ANCHOR = { lat: 59.3293, lng: 18.0686 };

function event(overrides = {}) {
  return {
    id: "local-market",
    title: "Local market",
    address: "Square 1",
    place_context: "Market Hall",
    city: "Example City",
    ...overrides,
  };
}

function candidate(overrides = {}) {
  return {
    lat: ANCHOR.lat + 0.001,
    lng: ANCHOR.lng + 0.001,
    confidence: "medium",
    provenance: "nominatim_osm",
    attribution: "OpenStreetMap contributors",
    license: "ODbL",
    ...overrides,
  };
}

test("venue query uses only compact source-owned location atoms", () => {
  assert.equal(
    buildEventVenueQuery(event()),
    "Square 1, Market Hall, Example City",
  );
  assert.equal(buildEventVenueQuery(event({ address: "Market Hall", place_context: "Market Hall" })), "Market Hall, Example City");
  assert.equal(buildEventVenueQuery({ title: "No venue" }), null);
  assert.equal(buildEventVenueQuery({ title: "No venue", country: "BE" }), null, "country alone is not a venue");
});

test("source country is retained within the query budget without foreign anchor context", () => {
  const placeContext = { country: "France", region: "Île-de-France" };
  assert.equal(buildEventVenueQuery(event({ country: "BE" }), { placeContext }), "Square 1, BE, Market Hall, Example City");
  assert.equal(buildEventVenueQuery(event({ address: "x".repeat(198), country: "BE", place_context: null, city: null }), { placeContext }), null,
    "an oversized source query must fail closed rather than silently lose its country");
});

test("one trusted in-radius match adds compact derived geometry", async () => {
  let query = null;
  const input = event();
  const out = await resolveEventVenueGeometry([input], {
    anchor: ANCHOR,
    resolver: async (value) => {
      query = value;
      return [candidate()];
    },
  });

  assert.equal(query, "Square 1, Example City", "the source's own address with its town is tried first");
  assert.equal(out.events[0].lat, ANCHOR.lat + 0.001);
  assert.equal(out.events[0].venue_resolution.source, "trusted_place_resolver");
  assert.equal(out.events[0].venue_resolution.query_basis, "source_address");
  assert.equal(out.summary.resolved_count, 1);
  assert.equal(input.lat, undefined, "input remains unchanged");
});

test("resolver-attested regional bounds recover a distant venue without weakening local radius rules", async () => {
  const regionalScope = {
    kind: "region",
    bounds: { south: 59.2, north: 59.7, west: 17.9, east: 18.3 },
  };
  const regionalCandidate = candidate({ lat: 59.5, lng: 18.1 });
  let query = null;
  const out = await resolveEventVenueGeometry([
    event({ city: null, address: null, place_context: "Regional market hall" }),
  ], {
    anchor: ANCHOR,
    radiusM: 3000,
    spatialScope: regionalScope,
    placeContext: { region: "Trusted Region", country: "Trusted Country" },
    resolver: async (value) => {
      query = value;
      return [regionalCandidate];
    },
  });
  const local = await resolveEventVenueGeometry([event()], {
    anchor: ANCHOR,
    radiusM: 3000,
    resolver: async () => [regionalCandidate],
  });

  assert.equal(query, "Regional market hall, Trusted Region, Trusted Country");
  assert.equal(out.events[0].lat, regionalCandidate.lat);
  assert.equal(out.events[0].venue_resolution.geometry_scope, "resolver_attested_region");
  assert.equal(local.events[0].lat, undefined, "the same point stays outside the local radius");
  assert.equal(local.events[0].venue_resolution.status, "not_found");
});

test("regional venue resolution still rejects candidates outside trusted bounds", async () => {
  const out = await resolveEventVenueGeometry([event()], {
    anchor: ANCHOR,
    spatialScope: {
      kind: "region",
      bounds: { south: 59.2, north: 59.7, west: 17.9, east: 18.3 },
    },
    resolver: async () => [candidate({ lat: 59.8, lng: 18.1 })],
  });
  assert.equal(out.events[0].lat, undefined);
  assert.equal(out.events[0].venue_resolution.status, "not_found");
  assert.equal(out.summary.not_found_count, 1);
});

test("ambiguous, weak and out-of-radius results fail closed", async () => {
  const cases = [
    [candidate(), candidate({ lat: ANCHOR.lat + 0.002 })],
    [candidate({ confidence: "low" })],
    [candidate({ lat: 57.7, lng: 11.97 })],
  ];
  for (const [index, candidates] of cases.entries()) {
    const out = await resolveEventVenueGeometry([event()], {
      anchor: ANCHOR,
      radiusM: 3000,
      resolver: async () => candidates,
    });
    assert.equal(out.events[0].lat, undefined);
    assert.equal(out.events[0].venue_resolution.status, index === 0 ? "ambiguous" : "not_found");
  }
});

test("resolution is bounded, reuses duplicate venue queries and fails soft", async () => {
  const calls = [];
  const out = await resolveEventVenueGeometry([
    event({ id: "a" }),
    event({ id: "b" }),
    event({ id: "c", address: "Other 2", place_context: "Other Hall" }),
    event({ id: "d", address: "Third 3", place_context: "Third Hall" }),
  ], {
    anchor: ANCHOR,
    limit: 2,
    resolver: async (query) => {
      calls.push(query);
      if (query.startsWith("Other")) throw new Error("provider detail must stay private");
      return [candidate()];
    },
  });

  assert.equal(calls.length, 2, "only two unique bounded resolver calls run");
  assert.equal(out.events[0].venue_resolution.status, "resolved");
  assert.equal(out.events[1].venue_resolution.status, "resolved", "same venue reuses the result");
  assert.equal(out.events[2].lat, undefined, "resolver failure stays mapless");
  assert.equal(out.events[2].venue_resolution.status, "failed");
  assert.equal(out.events[3].lat, undefined, "rows beyond the cap stay mapless");
  assert.equal(out.events[3].venue_resolution, undefined, "unattempted rows make no resolver claim");
  assert.deepEqual(out.summary, {
    limit: 2,
    attempted_count: 2,
    resolved_count: 2,
    ambiguous_count: 0,
    not_found_count: 0,
    failed_count: 1,
  });
});

test("venue lookups try the address, then the venue name, then the combined query", () => {
  assert.deepEqual(
    buildEventVenueQueries(event({
      address: "via Giovanni Palatucci, 5",
      place_context: "Risiera di San Sabba – Monumento Nazionale",
      city: "Trieste",
    })),
    [
      "via Giovanni Palatucci, 5, Trieste",
      "Risiera di San Sabba – Monumento Nazionale, Trieste",
      "Risiera di San Sabba, Trieste",
      "via Giovanni Palatucci, 5, Risiera di San Sabba – Monumento Nazionale, Trieste",
    ],
  );
  assert.deepEqual(
    buildEventVenueQueries(event({ city: null })),
    ["Square 1, Market Hall"],
    "without a town or place context a bare street is never sent on its own",
  );
  assert.deepEqual(
    buildEventVenueQueries(event({ address: null, city: null }), { placeContext: { locality: "River City", country: "Italy" } }),
    ["Market Hall, River City, Italy"],
  );
});

test("a later variant recovers a venue the combined query misses; a venue outside the area stops the lookups", async () => {
  const asked = [];
  const out = await resolveEventVenueGeometry([event({ address: "Harbour Road 5", place_context: "Old Warehouse – Concert Hall" })], {
    anchor: ANCHOR,
    resolver: async (query) => {
      asked.push(query);
      return query === "Old Warehouse, Example City" ? [candidate()] : [];
    },
  });
  assert.deepEqual(asked, ["Harbour Road 5, Example City", "Old Warehouse – Concert Hall, Example City", "Old Warehouse, Example City"]);
  assert.equal(out.summary.resolved_count, 1);
  assert.equal(out.events[0].venue_resolution.query_basis, "source_venue");

  const far = [];
  const outside = await resolveEventVenueGeometry([event()], {
    anchor: ANCHOR,
    resolver: async (query) => {
      far.push(query);
      return [candidate({ lat: ANCHOR.lat + 0.5 })];
    },
  });
  assert.deepEqual(far, ["Square 1, Example City"], "the venue is known and too far; other spellings cannot change that");
  assert.equal(outside.summary.not_found_count, 1);
  assert.equal(outside.events[0].lat, undefined);
});
