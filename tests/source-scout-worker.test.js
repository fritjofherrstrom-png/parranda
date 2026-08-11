"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  parseArguments,
  runScoutWorkerBatch,
} = require("../scripts/run-source-scout-worker");

function target(id = "one") {
  return {
    target_key: `source-scout-target-v1:${id}`,
    lease_token: `lease-${id}`,
    place_label: "Test Region, Test Country",
    anchor: { lat: 55.6, lng: 13 },
    place_context: { region: "Test Region", country: "Test Country", country_code: "tc" },
    spatial_scope: {
      source: "resolver_bounds",
      kind: "region",
      collection_mode: "regional_bounded",
      bounds: { west: 12.8, south: 55.4, east: 13.3, north: 55.8 },
      width_km: 31,
      height_km: 44,
      diagonal_km: 54,
    },
    attempt_count: 1,
  };
}

function profile(id = "one") {
  return {
    profile_key: `place-source-profile-v1:${id}`,
    runtime_review: { status: "unreviewed", reviewed_at: null, expires_at: null, feeds: [] },
    place_context: {
      label: "Test Region",
      lat: 55.6,
      lng: 13,
      bounds: { west: 12.8, south: 55.4, east: 13.3, north: 55.8 },
    },
    source_families: [],
  };
}

test("worker CLI stays bounded and watch polling cannot be configured aggressively", () => {
  assert.deepEqual(parseArguments(["--limit", "5", "--watch", "--interval-ms", "30000"]), {
    watch: true,
    limit: 5,
    intervalMs: 30000,
    errors: [],
  });
  assert.deepEqual(parseArguments(["--limit", "6"]).errors, ["invalid_limit"]);
  assert.deepEqual(parseArguments(["--interval-ms", "1000"]).errors, ["invalid_interval_ms"]);
});

test("worker claims a target, discovers through trusted seams, and writes review-needed evidence", async () => {
  const claimed = [target(), null];
  const calls = [];
  const catalog = {
    claimScoutTarget: async () => claimed.shift(),
    recordDiscovery: async (value) => {
      calls.push(["record", value]);
      return { status: "recorded", profile_key: value.profile_key, catalog_status: "review_needed" };
    },
    completeScoutTarget: async (value, reason) => {
      calls.push(["complete", value, reason]);
      return { status: "completed" };
    },
    failScoutTarget: async () => {
      throw new Error("should not fail");
    },
  };
  const runtime = {
    placeResolver: async () => [],
    openDataLoader: async () => [],
    sourceSearch: async () => ({ status: "empty", seeds: [] }),
    sourceScout: async () => ({}),
  };
  let discoveryInput = null;
  const result = await runScoutWorkerBatch({
    catalog,
    runtime,
    limit: 5,
    discover: async (input) => {
      discoveryInput = input;
      return {
        status: "complete",
        reasons: ["bounded_source_scout_complete"],
        source_profile: profile(),
      };
    },
  });

  assert.equal(result.status, "ok");
  assert.equal(result.claimed, 1);
  assert.equal(result.completed, 1);
  assert.equal(discoveryInput.placeQuery, "Test Region, Test Country");
  assert.equal(discoveryInput.sourceSearch, runtime.sourceSearch);
  assert.deepEqual(discoveryInput.bounds, target().spatial_scope.bounds);
  assert.equal(calls[0][0], "record");
  assert.equal(calls[0][1].runtime_review.status, "unreviewed");
  assert.deepEqual(calls[1].slice(0, 1), ["complete"]);
});

test("worker carries prior probe evidence through the bounded qualifier without activating it", async () => {
  const claimed = [target(), null];
  const priorQualification = {
    schema_version: 1,
    status: "observing",
    candidates: [],
    activation_performed: false,
  };
  let qualificationInput = null;
  let recordedProfile = null;
  const catalog = {
    claimScoutTarget: async () => claimed.shift(),
    loadSourceQualification: async (key) => {
      assert.equal(key, profile().profile_key);
      return priorQualification;
    },
    recordDiscovery: async (value) => {
      recordedProfile = value;
      return { status: "recorded", profile_key: value.profile_key, catalog_status: "review_needed" };
    },
    completeScoutTarget: async () => ({ status: "completed" }),
    failScoutTarget: async () => { throw new Error("should not fail"); },
  };
  const result = await runScoutWorkerBatch({
    catalog,
    runtime: {
      now: () => new Date("2026-08-01T10:00:00Z"),
      fetcher: async () => { throw new Error("qualifier controls this seam"); },
      sourceQualifier: async (input) => {
        qualificationInput = input;
        return {
          profile: {
            ...input.profile,
            source_qualification: {
              schema_version: 1,
              status: "qualified_for_review",
              activation_performed: false,
            },
          },
          qualification: { status: "qualified_for_review" },
        };
      },
    },
    discover: async () => ({
      status: "complete",
      reasons: ["bounded_source_scout_complete"],
      source_profile: profile(),
      manifest_candidates: [{ id: "candidate-one" }],
    }),
  });

  assert.equal(result.results[0].qualification_status, "qualified_for_review");
  assert.equal(recordedProfile.source_qualification.activation_performed, false);
  assert.equal(recordedProfile.runtime_review.status, "unreviewed");
  assert.equal(qualificationInput.previousQualification, priorQualification);
  assert.deepEqual(qualificationInput.anchor, target().anchor);
  assert.deepEqual(qualificationInput.spatialScope, target().spatial_scope);
  assert.deepEqual(qualificationInput.manifests, [{ id: "candidate-one" }]);
});

test("qualifier failure stays fail-soft and stores discovery without forged evidence", async () => {
  const claimed = [target(), null];
  let recordedProfile = null;
  const catalog = {
    claimScoutTarget: async () => claimed.shift(),
    loadSourceQualification: async () => null,
    recordDiscovery: async (value) => {
      recordedProfile = value;
      return { status: "recorded", profile_key: value.profile_key, catalog_status: "review_needed" };
    },
    completeScoutTarget: async () => ({ status: "completed" }),
    failScoutTarget: async () => { throw new Error("should not fail"); },
  };
  const result = await runScoutWorkerBatch({
    catalog,
    runtime: {
      sourceQualifier: async () => { throw new Error("https://secret.example/token"); },
    },
    discover: async () => ({
      status: "complete",
      reasons: ["bounded_source_scout_complete"],
      source_profile: profile(),
      manifest_candidates: [],
    }),
  });

  assert.equal(result.status, "ok");
  assert.equal(result.results[0].qualification_status, "failed");
  assert.equal(recordedProfile.source_qualification, undefined);
  assert.doesNotMatch(JSON.stringify(result), /secret\.example|token/);
});

test("worker failures back off through the lease and never fabricate a profile", async () => {
  const claimed = [target(), null];
  const calls = [];
  const catalog = {
    claimScoutTarget: async () => claimed.shift(),
    recordDiscovery: async () => {
      throw new Error("should not record");
    },
    completeScoutTarget: async () => {
      throw new Error("should not complete");
    },
    failScoutTarget: async (value, reason) => {
      calls.push([value, reason]);
      return { status: "retry_wait" };
    },
  };
  const result = await runScoutWorkerBatch({
    catalog,
    runtime: {},
    discover: async () => ({ status: "failed", reasons: ["trusted_place_loader_failed"] }),
  });

  assert.equal(result.status, "failed");
  assert.equal(result.failed, 1);
  assert.equal(calls[0][1], "trusted_place_loader_failed");
});

test("a proven empty scout completes without storing an empty review profile", async () => {
  const claimed = [target(), null];
  const calls = [];
  const catalog = {
    claimScoutTarget: async () => claimed.shift(),
    recordDiscovery: async () => {
      throw new Error("empty discovery must not create a review profile");
    },
    completeScoutTarget: async (value, reason) => {
      calls.push([value, reason]);
      return { status: "completed" };
    },
    failScoutTarget: async () => {
      throw new Error("a proven empty scout is not a provider failure");
    },
  };
  const result = await runScoutWorkerBatch({
    catalog,
    runtime: {},
    discover: async () => ({
      status: "empty",
      reasons: ["no_trusted_website_seeds"],
      source_profile: profile(),
    }),
  });

  assert.equal(result.status, "ok");
  assert.equal(result.completed, 1);
  assert.equal(result.results[0].profile_key, null);
  assert.equal(calls[0][1], "no_trusted_website_seeds");
});

test("an idle worker performs no discovery and reports a compact state", async () => {
  let discovered = false;
  const result = await runScoutWorkerBatch({
    catalog: { claimScoutTarget: async () => null },
    runtime: {},
    discover: async () => { discovered = true; },
  });

  assert.equal(discovered, false);
  assert.deepEqual(result, {
    status: "idle",
    claimed: 0,
    completed: 0,
    failed: 0,
    results: [],
  });
});
