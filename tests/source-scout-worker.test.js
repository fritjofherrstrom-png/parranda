"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  attachTrustedTimezone,
  nextQualificationProbeAt,
  parseArguments,
  runApprovedPlaceSourceRefresh,
  runScoutWorkerBatch,
} = require("../scripts/run-source-scout-worker");

test("worker manifests accept only a valid weather-provider-attested timezone", async () => {
  const manifest = { id: "program", timezone: null, review: { robots_status: "allowed" } };
  const trusted = await attachTrustedTimezone([manifest], {
    anchor: { lat: 55.6, lng: 13 },
    now: new Date("2026-08-01T10:00:00Z"),
    timezoneResolver: async () => ({
      timezone: "Europe/Stockholm",
      timezone_source: "weather_provider_auto",
    }),
  });
  assert.equal(trusted[0].timezone, "Europe/Stockholm");
  assert.equal(trusted[0].review.timezone_source, "weather_provider_auto");

  const payloadClaim = await attachTrustedTimezone([manifest], {
    anchor: { lat: 55.6, lng: 13 },
    timezoneResolver: async () => ({ timezone: "Europe/Stockholm", timezone_source: "request_payload" }),
  });
  assert.equal(payloadClaim[0].timezone, null);

  const invalid = await attachTrustedTimezone([manifest], {
    anchor: { lat: 55.6, lng: 13 },
    timezoneResolver: async () => ({ timezone: "Not/AZone", timezone_source: "weather_provider_auto" }),
  });
  assert.equal(invalid[0].timezone, null);
});

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

test("worker refresh persists exact approved-profile provenance through the catalog", async () => {
  const target = {
    profile_key: "place-source-profile-v1:test",
    profile_revision: "sha256:profile",
    approval_key: "source-profile-approval-v1:test",
    source_id: "reviewed-guide",
    feed: {
      id: "reviewed-guide",
      endpoint: "https://guide.example/places",
      adapter: "schema_org_place_html",
      adapter_contract_revision: "schema-org-place-html-v1",
      source_identity: "guide.example",
    },
    lease_token: "lease-one",
    attempt_count: 1,
  };
  const calls = [];
  const catalog = {
    recordApprovedPlaceSourceOutcome: async (claimed, outcome) => {
      calls.push({ claimed, outcome });
      return { status: "completed", candidate_count: outcome.records.length };
    },
  };
  const result = await runApprovedPlaceSourceRefresh({
    catalog,
    target,
    now: new Date("2026-08-20T12:00:00.000Z"),
    collect: async () => ({
      status: "ok",
      records: [{ id: "reviewed-place:reviewed-guide:one", name: "One" }],
    }),
  });
  assert.equal(result.status, "completed");
  assert.equal(calls[0].outcome.records[0].source_profile_key, target.profile_key);
  assert.equal(calls[0].outcome.records[0].source_profile_revision, target.profile_revision);
  assert.equal(calls[0].outcome.records[0].source_approval_key, target.approval_key);
  assert.equal(calls[0].outcome.records[0].source_feed_id, target.source_id);
  assert.equal(
    calls[0].outcome.records[0].source_adapter_contract_revision,
    target.feed.adapter_contract_revision,
  );
  assert.equal(calls[0].outcome.records[0].source_observed_at, "2026-08-20T12:00:00.000Z");
});

test("worker owns bounded list-detail traversal and persists only exact detail records", async () => {
  const endpoint = "https://guide.example/places";
  const detailUrls = [`${endpoint}/museum`, `${endpoint}/park`];
  const jsonLd = (payload) => `<script type="application/ld+json">${JSON.stringify(payload)}</script>`;
  const bodies = new Map([
    [endpoint, jsonLd({
      "@context": "https://schema.org",
      "@type": "ItemList",
      itemListElement: detailUrls.map((url) => ({ "@type": "ListItem", item: url })),
    })],
    [detailUrls[0], jsonLd({
      "@type": "Museum",
      "@id": detailUrls[0],
      name: "Worker Museum",
      geo: { latitude: 55.5, longitude: 13.5 },
    })],
    [detailUrls[1], jsonLd({
      "@type": "Park",
      "@id": detailUrls[1],
      name: "Worker Park",
      geo: { latitude: 55.51, longitude: 13.51 },
    })],
  ]);
  const target = {
    profile_key: "place-source-profile-v1:list-detail",
    profile_revision: "sha256:list-detail-profile",
    approval_key: "source-profile-approval-v1:list-detail",
    source_id: "reviewed-list-detail",
    feed: {
      id: "reviewed-list-detail",
      label: "Reviewed list detail",
      endpoint,
      adapter: "schema_org_place_list_detail_html",
      adapter_contract_revision: "schema-org-place-list-detail-html-v1",
      bbox: [13, 55, 14, 56],
      evidence_family: "official",
      source_tier: "official",
      source_identity: "guide.example",
      max_items: 2,
    },
    lease_token: "lease-list-detail",
    attempt_count: 1,
  };
  const writes = [];
  const fetched = [];
  const result = await runApprovedPlaceSourceRefresh({
    catalog: {
      recordApprovedPlaceSourceOutcome: async (_claimed, outcome) => {
        writes.push(outcome);
        return { status: "completed", candidate_count: outcome.records.length };
      },
    },
    target,
    now: new Date("2026-08-20T12:00:00.000Z"),
    runtime: {
      fetcher: async (url) => {
        fetched.push(url);
        return {
          ok: bodies.has(url),
          status: bodies.has(url) ? 200 : 404,
          url,
          redirected: false,
          headers: { get: (name) => String(name).toLowerCase() === "content-type" ? "text/html" : null },
          text: async () => bodies.get(url) || "",
        };
      },
    },
  });

  assert.equal(result.status, "completed");
  assert.deepEqual(fetched, [endpoint, ...detailUrls]);
  assert.deepEqual(writes[0].records.map((record) => record.name), ["Worker Museum", "Worker Park"]);
  assert.ok(writes[0].records.every(
    (record) => record.source_adapter_contract_revision === "schema-org-place-list-detail-html-v1",
  ));
});

test("observing qualification schedules the next proof on a distinct UTC day", async () => {
  assert.equal(
    nextQualificationProbeAt(new Date("2026-08-01T23:59:00Z")).toISOString(),
    "2026-08-02T00:05:00.000Z",
  );
  const completionCalls = [];
  const catalog = {
    claimScoutTarget: async () => target("reprobe"),
    loadSourceQualification: async () => null,
    recordDiscovery: async (value) => ({ status: "recorded", profile_key: value.profile_key }),
    completeScoutTarget: async (_target, _reason, options) => {
      completionCalls.push(options);
      return { status: "completed" };
    },
    failScoutTarget: async () => { throw new Error("should not fail"); },
  };
  let claims = 0;
  catalog.claimScoutTarget = async () => (claims++ === 0 ? target("reprobe") : null);

  const result = await runScoutWorkerBatch({
    catalog,
    runtime: {
      now: () => new Date("2026-08-01T23:59:00Z"),
      sourceQualifier: async ({ profile: value }) => ({
        profile: { ...value, source_qualification: { schema_version: 1, status: "observing" } },
        qualification: { status: "observing" },
      }),
    },
    discover: async () => ({
      status: "complete",
      reasons: ["bounded_source_scout_complete"],
      source_profile: profile("reprobe"),
      manifest_candidates: [],
    }),
  });

  assert.equal(result.status, "ok");
  assert.equal(completionCalls.length, 1);
  assert.equal(completionCalls[0].nextAttemptAt.toISOString(), "2026-08-02T00:05:00.000Z");
});

test("qualified evidence returns to the ordinary bounded refresh cadence", async () => {
  let completionOptions = "not-called";
  let claims = 0;
  const result = await runScoutWorkerBatch({
    catalog: {
      claimScoutTarget: async () => (claims++ === 0 ? target("qualified") : null),
      loadSourceQualification: async () => null,
      recordDiscovery: async (value) => ({ status: "recorded", profile_key: value.profile_key }),
      completeScoutTarget: async (_target, _reason, options) => {
        completionOptions = options;
        return { status: "completed" };
      },
      failScoutTarget: async () => { throw new Error("should not fail"); },
    },
    runtime: {
      now: () => new Date("2026-08-02T10:00:00Z"),
      sourceQualifier: async ({ profile: value }) => ({
        profile: value,
        qualification: { status: "qualified_for_review" },
      }),
    },
    discover: async () => ({
      status: "complete",
      reasons: ["bounded_source_scout_complete"],
      source_profile: profile("qualified"),
      manifest_candidates: [],
    }),
  });

  assert.equal(result.status, "ok");
  assert.equal(completionOptions.nextAttemptAt, undefined);
  assert.equal(completionOptions.discoveryHealth.status, "review_required");
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
  assert.equal(recordedProfile.discovery_health.status, "review_required");
  assert.equal(recordedProfile.discovery_health.qualification.status, "qualified_for_review");
  assert.equal(recordedProfile.runtime_review.status, "unreviewed");
  assert.equal(qualificationInput.previousQualification, priorQualification);
  assert.deepEqual(qualificationInput.anchor, target().anchor);
  assert.deepEqual(qualificationInput.spatialScope, target().spatial_scope);
  assert.deepEqual(qualificationInput.manifests, [{ id: "candidate-one" }]);
});

test("worker persists place-source qualification separately and schedules its next proof", async () => {
  const claimed = [target("places"), null];
  const priorQualification = {
    schema_version: 1,
    status: "observing",
    candidates: [],
    activation_performed: false,
  };
  let qualificationInput = null;
  let recordedProfile = null;
  let completionOptions = null;
  const catalog = {
    claimScoutTarget: async () => claimed.shift(),
    loadPlaceSourceQualification: async (key) => {
      assert.equal(key, profile("places").profile_key);
      return priorQualification;
    },
    recordDiscovery: async (value) => {
      recordedProfile = value;
      return { status: "recorded", profile_key: value.profile_key };
    },
    completeScoutTarget: async (_target, _reason, options) => {
      completionOptions = options;
      return { status: "completed" };
    },
    failScoutTarget: async () => { throw new Error("should not fail"); },
  };
  const result = await runScoutWorkerBatch({
    catalog,
    runtime: {
      now: () => new Date("2026-08-01T23:59:00Z"),
      placeSourceQualifier: async (input) => {
        qualificationInput = input;
        return {
          profile: {
            ...input.profile,
            place_source_qualification: {
              schema_version: 1,
              status: "observing",
              candidate_count: 1,
              activation_performed: false,
            },
          },
          qualification: { status: "observing" },
        };
      },
    },
    discover: async () => ({
      status: "complete",
      reasons: ["bounded_source_scout_complete"],
      source_profile: profile("places"),
      place_manifest_candidates: [{ id: "place-guide" }],
    }),
  });

  assert.equal(result.results[0].place_qualification_status, "observing");
  assert.equal(recordedProfile.place_source_qualification.activation_performed, false);
  assert.equal(recordedProfile.runtime_review.status, "unreviewed");
  assert.equal(qualificationInput.previousQualification, priorQualification);
  assert.deepEqual(qualificationInput.manifests, [{ id: "place-guide" }]);
  assert.equal(completionOptions.nextAttemptAt.toISOString(), "2026-08-02T00:05:00.000Z");
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

test("a proven empty scout persists health without storing an empty review profile", async () => {
  const claimed = [target(), null];
  const calls = [];
  const catalog = {
    claimScoutTarget: async () => claimed.shift(),
    recordDiscovery: async () => {
      throw new Error("empty discovery must not create a review profile");
    },
    completeScoutTarget: async (value, reason, options) => {
      calls.push([value, reason, options]);
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
      source_search: {
        status: "empty",
        queried_count: 6,
        responding_query_count: 6,
        failed_query_count: 0,
        result_count: 0,
        accepted_seed_count: 0,
      },
      source_scout: null,
      source_profile: profile(),
    }),
  });

  assert.equal(result.status, "ok");
  assert.equal(result.completed, 1);
  assert.equal(result.results[0].profile_key, null);
  assert.equal(result.results[0].discovery_status, "healthy_empty");
  assert.equal(calls[0][1], "no_trusted_website_seeds");
  assert.equal(calls[0][2].discoveryHealth.status, "healthy_empty");
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
