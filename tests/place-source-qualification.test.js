"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  bindManifestCandidate,
  qualifyDiscoveredPlaceSourceProfile,
} = require("../server/pulse-sources/place-source-qualification");

function candidate(overrides = {}) {
  return {
    id: "scout-place-guide",
    candidate_kind: "place_list",
    family: "official_place_guide",
    source_label: "Regional guide",
    url: "https://guide.example/places",
    source_identity: "guide.example",
    adapter: "schema_org_place_html",
    status: "viable_place_provider_probe",
    maps_to_existing_provider: true,
    trust_tier: "official",
    terms_status: "open_license",
    source_health: "healthy",
    runtime_policy: "review_needed",
    corroboration_required: false,
    ...overrides,
  };
}

function profile(overrides = {}) {
  return {
    profile_key: "place-source-profile-v1:test-region",
    runtime_review: {
      status: "unreviewed",
      reviewed_at: null,
      expires_at: null,
      feeds: [],
      place_sources: [],
    },
    place_context: {
      label: "Test Region",
      lat: 55.6,
      lng: 13,
      bounds: { west: 12.8, south: 55.4, east: 13.3, north: 55.8 },
    },
    source_families: [],
    place_source_candidates: [candidate()],
    ...overrides,
  };
}

function manifest(overrides = {}) {
  return {
    id: "scout-place-guide",
    label: "Regional guide",
    endpoint: "https://guide.example/places",
    adapter: "schema_org_place_html",
    bbox: [12.8, 55.4, 13.3, 55.8],
    source_tier: "official",
    source_family: "official_place_guide",
    source_identity: "guide.example",
    max_items: 40,
    status: "review-needed",
    runtime_policy: "review_required",
    review: { terms_status: "open_license", robots_status: "allowed" },
    ...overrides,
  };
}

const healthyProbe = async () => ({
  status: "ok",
  accepted_place_count: 4,
  distinct_place_type_count: 3,
  raw_records: [{ secret: "must not persist" }],
});

test("two healthy UTC-day probes qualify an exact place source for review without activation", async () => {
  const first = await qualifyDiscoveredPlaceSourceProfile({
    profile: profile(),
    manifests: [manifest()],
    now: new Date("2026-08-01T10:00:00Z"),
    probe: healthyProbe,
  });
  assert.equal(first.qualification.status, "observing");
  assert.equal(first.qualification.candidates[0].healthy_probe_count, 1);

  const second = await qualifyDiscoveredPlaceSourceProfile({
    profile: profile(),
    manifests: [manifest()],
    previousQualification: first.qualification,
    now: new Date("2026-08-02T10:00:00Z"),
    probe: healthyProbe,
  });
  const state = second.qualification.candidates[0];
  assert.equal(second.qualification.status, "qualified_for_review");
  assert.equal(state.healthy_probe_count, 2);
  assert.equal(state.place_bearing_probe_count, 2);
  assert.equal(state.review_candidate.status, "review-needed");
  assert.equal(state.review_candidate.runtime_policy, "review_required");
  assert.equal(state.activation_performed, false);
  assert.equal(second.profile.runtime_review.status, "unreviewed");
  assert.equal(second.profile.runtime_review.place_sources.length, 0);
  assert.doesNotMatch(JSON.stringify(second), /must not persist|raw_records|secret/);
});

test("map-linked candidates preserve their exact adapter through qualification", async () => {
  const adapters = [];
  const mapCandidate = candidate({ adapter: "map_linked_place_html" });
  const mapManifest = manifest({ adapter: "map_linked_place_html" });
  const first = await qualifyDiscoveredPlaceSourceProfile({
    profile: profile({ place_source_candidates: [mapCandidate] }),
    manifests: [mapManifest],
    now: new Date("2026-08-01T10:00:00Z"),
    probe: async (feed) => {
      adapters.push(feed.adapter);
      return healthyProbe();
    },
  });
  const second = await qualifyDiscoveredPlaceSourceProfile({
    profile: profile({ place_source_candidates: [mapCandidate] }),
    manifests: [mapManifest],
    previousQualification: first.qualification,
    now: new Date("2026-08-02T10:00:00Z"),
    probe: async (feed) => {
      adapters.push(feed.adapter);
      return healthyProbe();
    },
  });

  assert.deepEqual(adapters, ["map_linked_place_html", "map_linked_place_html"]);
  assert.equal(second.qualification.status, "qualified_for_review");
  assert.equal(second.qualification.candidates[0].review_candidate.adapter, "map_linked_place_html");
  assert.deepEqual(second.profile.runtime_review.place_sources, []);
});

test("list-detail candidates preserve their exact bounded adapter through qualification", async () => {
  const adapter = "schema_org_place_list_detail_html";
  const listCandidate = candidate({ adapter });
  const listManifest = manifest({ adapter, max_items: 100 });
  const result = await qualifyDiscoveredPlaceSourceProfile({
    profile: profile({ place_source_candidates: [listCandidate] }),
    manifests: [listManifest],
    now: new Date("2026-08-01T10:00:00Z"),
    probe: async (feed) => {
      assert.equal(feed.adapter, adapter);
      assert.equal(feed.max_items, 12);
      return healthyProbe();
    },
  });

  assert.equal(result.qualification.candidates[0].review_candidate.adapter, adapter);
  assert.deepEqual(result.profile.runtime_review.place_sources, []);
});

test("same-day probes replace evidence and cannot satisfy repeated-day qualification", async () => {
  const first = await qualifyDiscoveredPlaceSourceProfile({
    profile: profile(),
    manifests: [manifest()],
    now: new Date("2026-08-01T09:00:00Z"),
    probe: healthyProbe,
  });
  const second = await qualifyDiscoveredPlaceSourceProfile({
    profile: profile(),
    manifests: [manifest()],
    previousQualification: first.qualification,
    now: new Date("2026-08-01T18:00:00Z"),
    probe: healthyProbe,
  });
  assert.equal(second.qualification.status, "observing");
  assert.equal(second.qualification.candidates[0].observation_count, 1);
});

test("empty, failed and stale-current probes stay observing", async () => {
  for (const result of [
    { status: "empty", accepted_place_count: 0, distinct_place_type_count: 0 },
    { status: "failed", accepted_place_count: 0, distinct_place_type_count: 0 },
  ]) {
    const qualified = await qualifyDiscoveredPlaceSourceProfile({
      profile: profile(),
      manifests: [manifest()],
      now: new Date("2026-08-02T10:00:00Z"),
      previousQualification: {
        schema_version: 1,
        status: "observing",
        activation_performed: false,
        candidates: [{
          candidate_id: "scout-place-guide",
          endpoint: "https://guide.example/places",
          adapter: "schema_org_place_html",
          source_identity: "guide.example",
          observations: [{
            candidate_id: "scout-place-guide",
            endpoint: "https://guide.example/places",
            adapter: "schema_org_place_html",
            source_identity: "guide.example",
            observed_at: "2026-08-01T10:00:00.000Z",
            status: "healthy",
            result: "places_found",
            accepted_place_count: 4,
          }],
        }],
      },
      probe: async () => result,
    });
    assert.equal(qualified.qualification.status, "observing");
  }
});

test("binding fails closed on identity, endpoint, adapter, robots and policy drift", () => {
  assert.ok(bindManifestCandidate(manifest(), candidate()));
  for (const changed of [
    manifest({ endpoint: "https://other.example/places" }),
    manifest({ adapter: "schema_org_place_json" }),
    manifest({ source_identity: "other.example" }),
    manifest({ runtime_policy: "bounded_refresh" }),
    manifest({ review: { terms_status: "open_license", robots_status: "unknown" } }),
  ]) {
    assert.equal(bindManifestCandidate(changed, candidate()), null);
  }
  assert.equal(bindManifestCandidate(manifest(), candidate({ status: "rejected" })), null);
  assert.equal(bindManifestCandidate(manifest(), candidate({ maps_to_existing_provider: false })), null);
});

test("unknown terms remain explicit review work and never create a runtime source", async () => {
  const unknownProfile = profile({
    place_source_candidates: [candidate({ terms_status: "unknown" })],
  });
  const unknownManifest = manifest({
    review: { terms_status: "unknown", robots_status: "allowed" },
  });
  const first = await qualifyDiscoveredPlaceSourceProfile({
    profile: unknownProfile,
    manifests: [unknownManifest],
    now: new Date("2026-08-01T10:00:00Z"),
    probe: healthyProbe,
  });
  const second = await qualifyDiscoveredPlaceSourceProfile({
    profile: unknownProfile,
    manifests: [unknownManifest],
    previousQualification: first.qualification,
    now: new Date("2026-08-02T10:00:00Z"),
    probe: healthyProbe,
  });
  assert.equal(second.qualification.status, "qualified_for_review");
  assert.ok(second.qualification.candidates[0].reasons.includes("terms_review_required"));
  assert.deepEqual(second.profile.runtime_review.place_sources, []);
});
