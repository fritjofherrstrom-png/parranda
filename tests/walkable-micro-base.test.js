"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  MAX_DERIVED_MICRO_BASE_SHIFT_KM,
  resolveWalkableMicroBase,
} = require("../server/planner/walkable-micro-base");

function record(id, type, lat, lng, tags = []) {
  return {
    id,
    name: id,
    type,
    lat,
    lng,
    tags,
    sources: [{ provider: "fixture-map", family: "map", url: `https://example.test/${id}` }],
  };
}

function cluster(base, prefix = "remote") {
  return [
    record(`${prefix}-food`, "restaurant", base.lat, base.lng, ["food"]),
    record(`${prefix}-museum`, "museum", base.lat + 0.001, base.lng, ["culture"]),
    record(`${prefix}-view`, "viewpoint", base.lat, base.lng + 0.001, ["views"]),
    record(`${prefix}-cafe`, "cafe", base.lat + 0.001, base.lng + 0.001, ["fika"]),
  ];
}

test("explicit coordinates never move to a candidate-derived micro-base", () => {
  const origin = { lat: 55.6, lng: 14.1 };
  const result = resolveWalkableMicroBase({
    origin,
    records: cluster({ lat: 55.636, lng: 14.1 }),
    requestedIntents: ["food", "culture", "views"],
    anchorMode: "coordinates",
  });
  assert.deepEqual(result, { anchor: origin, summary: null });
});

test("typed place may use one compact relevant cluster inside the bounded local aperture", () => {
  const origin = { lat: 55.6, lng: 14.1 };
  const result = resolveWalkableMicroBase({
    origin,
    records: cluster({ lat: 55.636, lng: 14.1 }),
    requestedIntents: ["food", "culture", "views"],
    anchorMode: "place",
  });
  assert.equal(result.summary.applied, true);
  assert.equal(result.summary.mode, "trusted_candidate_cluster");
  assert.equal(result.summary.reason, "insufficient_relevant_supply_at_resolved_anchor");
  assert.equal(result.summary.cluster_candidate_count, 4);
  assert.deepEqual(result.summary.covered_intents.sort(), ["culture", "food", "views"]);
  assert.ok(result.summary.shift_km > 3 && result.summary.shift_km <= MAX_DERIVED_MICRO_BASE_SHIFT_KM);
});

test("local relevant supply keeps the resolver anchor", () => {
  const origin = { lat: 55.6, lng: 14.1 };
  const local = cluster({ lat: 55.601, lng: 14.1 }, "local");
  const remote = cluster({ lat: 55.636, lng: 14.1 });
  const result = resolveWalkableMicroBase({
    origin,
    records: [...local, ...remote],
    requestedIntents: ["food", "culture", "views"],
    anchorMode: "place",
  });
  assert.deepEqual(result, { anchor: origin, summary: null });
});

test("remote injected clusters remain blocked beyond the bounded aperture", () => {
  const origin = { lat: 55.6, lng: 14.1 };
  const result = resolveWalkableMicroBase({
    origin,
    records: cluster({ lat: 55.66, lng: 14.1 }),
    requestedIntents: ["food", "culture", "views"],
    anchorMode: "place",
  });
  assert.deepEqual(result, { anchor: origin, summary: null });
});

test("a cluster that does not cover enough requested axes cannot move the day", () => {
  const origin = { lat: 55.6, lng: 14.1 };
  const remote = [0, 1, 2, 3].map((index) =>
    record(`food-${index}`, "restaurant", 55.636 + index * 0.0002, 14.1, ["food"]),
  );
  const result = resolveWalkableMicroBase({
    origin,
    records: remote,
    requestedIntents: ["food", "culture", "views"],
    anchorMode: "place",
  });
  assert.deepEqual(result, { anchor: origin, summary: null });
});

test("source-less, structural, and inactive map rows cannot choose the composition base", () => {
  const origin = { lat: 55.6, lng: 14.1 };
  const base = cluster({ lat: 55.636, lng: 14.1 });
  const sourceLess = base.map(({ sources: _sources, ...row }) => row);
  const structural = base.map((row) => ({ ...row, is_structural: true }));
  const inactive = base.map((row) => ({ ...row, operational_status: "inactive" }));

  for (const records of [sourceLess, structural, inactive]) {
    const result = resolveWalkableMicroBase({
      origin,
      records,
      requestedIntents: ["food", "culture", "views"],
      anchorMode: "place",
    });
    assert.deepEqual(result, { anchor: origin, summary: null });
  }
});

test("resolver-bounded regional scout anchor wins without merging its remote records", () => {
  const origin = { lat: 55.6, lng: 14.15 };
  const selected = { lat: 55.45, lng: 14.15 };
  const records = cluster(selected);
  const result = resolveWalkableMicroBase({
    origin,
    records,
    requestedIntents: ["food", "culture", "views"],
    anchorMode: "place",
    spatialScope: {
      kind: "region",
      bounds: { south: 55.3, north: 55.9, west: 14, east: 14.3 },
    },
    loaderMetadata: {
      regional_scout: {
        reason: "richer_regional_cluster",
        selected_anchor_coords: selected,
      },
    },
  });
  assert.deepEqual(result.anchor, selected);
  assert.equal(result.summary.mode, "resolver_scoped_cluster");
  assert.equal(result.summary.cluster_candidate_count, 4);
});

test("regional metadata cannot move the route outside resolver-attested bounds", () => {
  const origin = { lat: 55.6, lng: 14.15 };
  const selected = { lat: 56.1, lng: 14.15 };
  const result = resolveWalkableMicroBase({
    origin,
    records: cluster(selected),
    requestedIntents: ["food", "culture"],
    anchorMode: "place",
    spatialScope: {
      kind: "region",
      bounds: { south: 55.3, north: 55.9, west: 14, east: 14.3 },
    },
    loaderMetadata: {
      regional_scout: {
        reason: "richer_regional_cluster",
        selected_anchor_coords: selected,
      },
    },
  });
  assert.deepEqual(result, { anchor: origin, summary: null });
});
