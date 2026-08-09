"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  MAX_BOUNDED_SCOPE_DIAGONAL_KM,
  MAX_SECONDARY_ANCHORS,
  normalizeNominatimSpatialScope,
  sanitizeTrustedSpatialScope,
  deriveSecondaryAnchors,
  allowsRegionalClusterSelection,
  pointWithinTrustedSpatialScope,
  resolveTrustedRegionalSpatialScope,
  spatialScopeCacheKey,
} = require("../server/place-candidates/spatial-scope");

test("normalizes Nominatim south/north/west/east bounds into a compact trusted scope", () => {
  const scope = normalizeNominatimSpatialScope({
    addresstype: "municipality",
    boundingbox: ["55.4", "55.8", "13.8", "14.5"],
  });

  assert.equal(scope.source, "nominatim_bounds");
  assert.equal(scope.kind, "municipality");
  assert.equal(scope.collection_mode, "regional_bounded");
  assert.deepEqual(scope.bounds, { south: 55.4, north: 55.8, west: 13.8, east: 14.5 });
  assert.ok(scope.diagonal_km <= MAX_BOUNDED_SCOPE_DIAGONAL_KM);
});

test("invalid and antimeridian-crossing raw bounds fail closed", () => {
  assert.equal(normalizeNominatimSpatialScope({ boundingbox: ["x", "2", "3", "4"] }), null);
  assert.equal(normalizeNominatimSpatialScope({ boundingbox: ["1", "2", "170", "-170"] }), null);
  assert.equal(normalizeNominatimSpatialScope({ boundingbox: ["2", "1", "3", "4"] }), null);
});

test("small places stay local and broad regions never mint secondary collection anchors", () => {
  const local = normalizeNominatimSpatialScope({ addresstype: "town", boundingbox: ["55.54", "55.59", "14.31", "14.39"] });
  const broad = normalizeNominatimSpatialScope({ addresstype: "region", boundingbox: ["42", "46", "2", "8"] });

  assert.equal(local.collection_mode, "local_anchor");
  assert.deepEqual(deriveSecondaryAnchors(local, { lat: 55.56, lng: 14.35 }), []);
  assert.equal(broad.collection_mode, "broad_anchor_only");
  assert.deepEqual(deriveSecondaryAnchors(broad, { lat: 44, lng: 5 }), []);
});

test("bounded elongated regions yield at most two deterministic anchors on their longest axis", () => {
  const scope = sanitizeTrustedSpatialScope({
    source: "test_resolver",
    kind: "region",
    bounds: { south: 55.3, north: 55.9, west: 14.0, east: 14.3 },
  });
  const anchors = deriveSecondaryAnchors(scope, { lat: 55.6, lng: 14.15 });

  assert.ok(anchors.length > 0 && anchors.length <= MAX_SECONDARY_ANCHORS);
  assert.ok(anchors.every((anchor) => anchor.lng === 14.15));
  assert.deepEqual(anchors, deriveSecondaryAnchors(scope, { lat: 55.6, lng: 14.15 }));
});

test("only bounded municipality and region scopes may relocate collection to another cluster", () => {
  const bounds = { south: 55.3, north: 55.9, west: 14.0, east: 14.3 };
  assert.equal(allowsRegionalClusterSelection({ kind: "region", bounds }), true);
  assert.equal(allowsRegionalClusterSelection({ kind: "municipality", bounds }), true);
  assert.equal(allowsRegionalClusterSelection({ kind: "settlement", bounds }), false);
  assert.equal(allowsRegionalClusterSelection({ kind: "district", bounds }), false);
  assert.equal(
    allowsRegionalClusterSelection({ kind: "region", bounds: { south: 42, north: 46, west: 2, east: 8 } }),
    false,
  );
});

test("trusted regional scope accepts only coordinates inside resolver-attested bounds", () => {
  const scope = {
    kind: "region",
    bounds: { south: 55.3, north: 55.9, west: 14.0, east: 14.3 },
  };
  assert.equal(resolveTrustedRegionalSpatialScope(scope).collection_mode, "regional_bounded");
  assert.equal(pointWithinTrustedSpatialScope({ lat: 55.6, lng: 14.15 }, scope), true);
  assert.equal(pointWithinTrustedSpatialScope({ lat: 56.0, lng: 14.15 }, scope), false);
  assert.equal(resolveTrustedRegionalSpatialScope({ ...scope, kind: "settlement" }), null);
});

test("scope cache keys are stable, bounded and differ across reviewed bounds", () => {
  const a = { kind: "region", bounds: { south: 55.3, north: 55.9, west: 14.0, east: 14.3 } };
  const b = { kind: "region", bounds: { south: 55.3, north: 55.9, west: 13.8, east: 14.3 } };
  assert.equal(spatialScopeCacheKey(a), spatialScopeCacheKey(structuredClone(a)));
  assert.notEqual(spatialScopeCacheKey(a), spatialScopeCacheKey(b));
  assert.equal(spatialScopeCacheKey(null), "none");
});
