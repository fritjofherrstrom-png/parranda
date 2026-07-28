"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  resolveAgnosticCandidateReachPolicy,
  sanitizeCandidateReachPolicy,
} = require("../server/planner/candidate-reach-policy");

const BOUNDS = { south: 43.5, north: 43.9, west: 4.6, east: 5.0 };

test("exact coordinates and local place scopes receive a conservative route reach", () => {
  assert.deepEqual(resolveAgnosticCandidateReachPolicy({ anchorMode: "coordinates" }), {
    policy: "exact_anchor",
    max_origin_distance_km: 3,
    scope_kind: null,
  });
  assert.deepEqual(
    resolveAgnosticCandidateReachPolicy({
      anchorMode: "place",
      spatialScope: { kind: "settlement", bounds: BOUNDS },
    }),
    {
      policy: "local_place_anchor",
      max_origin_distance_km: 3,
      scope_kind: "settlement",
    },
  );
  assert.deepEqual(resolveAgnosticCandidateReachPolicy({ anchorMode: "place" }), {
    policy: "local_place_anchor",
    max_origin_distance_km: 3,
    scope_kind: null,
  });
});

test("municipality and region scopes keep bounded regional flexibility", () => {
  assert.equal(
    resolveAgnosticCandidateReachPolicy({
      anchorMode: "place",
      spatialScope: { kind: "municipality", bounds: BOUNDS },
    }),
    null,
  );
  assert.equal(
    resolveAgnosticCandidateReachPolicy({
      anchorMode: "place",
      spatialScope: { kind: "region", bounds: BOUNDS },
    }),
    null,
  );
});

test("unknown or malformed reach policy values fail closed", () => {
  assert.equal(sanitizeCandidateReachPolicy({ policy: "regional", max_origin_distance_km: 3 }), null);
  assert.equal(sanitizeCandidateReachPolicy({ policy: "exact_anchor", max_origin_distance_km: 100 }), null);
});
