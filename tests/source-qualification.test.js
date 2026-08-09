"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  qualifyDiscoveredSourceProfile,
} = require("../server/pulse-sources/source-qualification");

function candidate(overrides = {}) {
  return {
    id: "regional-events",
    source_label: "Regional events",
    url: "https://events.example/api/events",
    adapter: "the_events_calendar",
    maps_to_existing_provider: true,
    status: "viable_provider_probe",
    family: "official_tourism_calendar",
    source_identity: "events.example",
    source_language: "sv",
    trust_tier: "institution",
    terms_status: "open_license",
    ...overrides,
  };
}

function profile(candidateOverrides = {}) {
  return {
    profile_key: "place-source-profile-v1:test-region",
    runtime_review: { status: "unreviewed", reviewed_at: null, expires_at: null, feeds: [] },
    place_context: {
      label: "Test Region",
      lat: 55.6,
      lng: 13,
      bounds: { west: 12.8, south: 55.4, east: 13.3, north: 55.8 },
    },
    source_families: [{
      family: "official_tourism_calendar",
      candidates: [candidate(candidateOverrides)],
    }],
  };
}

function manifest(overrides = {}) {
  return {
    id: "regional-events",
    label: "Regional events",
    endpoint: "https://events.example/api/events",
    adapter: "events_calendar",
    bbox: [12.8, 55.4, 13.3, 55.8],
    source_identity: "events.example",
    source_family: "official_tourism_calendar",
    source_language: "sv",
    source_tier: "institution",
    review: { terms_status: "open_license" },
    ...overrides,
  };
}

function collection({ accepted = 1, status = "healthy", result = "events_found" } = {}) {
  return {
    coverage: "covered",
    acquisition: {
      source_health: {
        status,
        result,
        failed_source_count: status === "failed" ? 1 : 0,
        unavailable_source_count: status === "unavailable" ? 1 : 0,
        normalized_event_count: accepted,
        accepted_event_count: accepted,
        rejected_event_count: 0,
        reasons: status === "healthy" ? ["events_available"] : ["provider_failed"],
      },
    },
  };
}

const baseInput = {
  anchor: { lat: 55.6, lng: 13 },
  spatialScope: {
    source: "resolver_bounds",
    kind: "region",
    bounds: { west: 12.8, south: 55.4, east: 13.3, north: 55.8 },
  },
  placeContext: { region: "Test Region", country: "Test Country", country_code: "tc" },
};

test("one real provider probe is evidence, not automatic activation", async () => {
  const inputProfile = profile();
  let probeInput = null;
  const result = await qualifyDiscoveredSourceProfile({
    ...baseInput,
    profile: inputProfile,
    manifests: [manifest()],
    now: "2026-08-01T10:00:00Z",
    collectEvents: async (input) => {
      probeInput = input;
      return collection();
    },
  });

  assert.equal(result.qualification.status, "observing");
  assert.equal(result.qualification.activation_performed, false);
  assert.equal(result.qualification.candidates[0].healthy_probe_count, 1);
  assert.equal(result.qualification.candidates[0].event_bearing_probe_count, 1);
  assert.ok(result.qualification.candidates[0].reasons.includes("repeated_probe_evidence_required"));
  assert.equal(probeInput.registry.length, 1);
  assert.equal(probeInput.registry[0].confidence, "low");
  assert.equal(probeInput.registry[0].runtime_policy, "bounded_refresh");
  assert.deepEqual(inputProfile, profile(), "qualification is post-hoc and does not mutate discovery");
  assert.equal("raw" in result.qualification.candidates[0].observations[0], false);
});

test("qualification probes the discovered source through the real provider and event gates", async () => {
  const result = await qualifyDiscoveredSourceProfile({
    ...baseInput,
    profile: profile(),
    manifests: [manifest()],
    now: "2026-08-01T10:00:00Z",
    fetcher: async () => ({
      ok: true,
      status: 200,
      headers: { get: () => "application/json" },
      text: async () => JSON.stringify({
        events: [{
          id: 42,
          title: { rendered: "Regional evening market" },
          start_date: "2026-08-01T18:00:00+02:00",
          end_date: "2026-08-01T21:00:00+02:00",
          url: "https://events.example/events/evening-market/",
          venue: {
            venue: "Market Square",
            city: "Test Region",
            geo_lat: "55.6",
            geo_lng: "13",
          },
          categories: [{ name: "market" }],
        }],
      }),
    }),
  });

  const observation = result.qualification.candidates[0].observations[0];
  assert.equal(observation.status, "healthy");
  assert.equal(observation.normalized_event_count, 1);
  assert.equal(observation.accepted_event_count, 1);
  assert.equal(result.qualification.status, "observing");
  assert.equal(result.qualification.activation_performed, false);
});

test("two distinct healthy probe days with accepted evidence qualify only for review", async () => {
  const first = await qualifyDiscoveredSourceProfile({
    ...baseInput,
    profile: profile(),
    manifests: [manifest()],
    now: "2026-08-01T10:00:00Z",
    collectEvents: async () => collection(),
  });
  const second = await qualifyDiscoveredSourceProfile({
    ...baseInput,
    profile: profile(),
    manifests: [manifest()],
    previousQualification: first.qualification,
    now: "2026-08-08T10:00:00Z",
    collectEvents: async () => collection({ accepted: 2 }),
  });

  assert.equal(second.qualification.status, "qualified_for_review");
  assert.equal(second.qualification.qualified_candidate_count, 1);
  assert.equal(second.qualification.candidates[0].status, "qualified_for_review");
  assert.equal(second.qualification.candidates[0].observation_count, 2);
  assert.equal(second.qualification.activation_performed, false);
  assert.equal(second.profile.runtime_review.status, "unreviewed");
});

test("retries on one UTC day replace evidence instead of manufacturing repetition", async () => {
  const first = await qualifyDiscoveredSourceProfile({
    ...baseInput,
    profile: profile(),
    manifests: [manifest()],
    now: "2026-08-01T08:00:00Z",
    collectEvents: async () => collection(),
  });
  const retry = await qualifyDiscoveredSourceProfile({
    ...baseInput,
    profile: profile(),
    manifests: [manifest()],
    previousQualification: first.qualification,
    now: "2026-08-01T18:00:00Z",
    collectEvents: async () => collection({ accepted: 3 }),
  });

  assert.equal(retry.qualification.status, "observing");
  assert.equal(retry.qualification.candidates[0].observation_count, 1);
  assert.equal(retry.qualification.candidates[0].observations[0].accepted_event_count, 3);
});

test("stale qualification history cannot combine with a fresh probe", async () => {
  const prior = {
    schema_version: 1,
    activation_performed: false,
    candidates: [{
      candidate_id: "regional-events",
      endpoint: "https://events.example/api/events",
      adapter: "events_calendar",
      source_identity: "events.example",
      observations: [{
        candidate_id: "regional-events",
        endpoint: "https://events.example/api/events",
        adapter: "events_calendar",
        source_identity: "events.example",
        observed_at: "2026-06-01T10:00:00.000Z",
        status: "healthy",
        result: "events_found",
        accepted_event_count: 1,
      }],
    }],
  };
  const result = await qualifyDiscoveredSourceProfile({
    ...baseInput,
    profile: profile(),
    manifests: [manifest()],
    previousQualification: prior,
    now: "2026-08-01T10:00:00Z",
    collectEvents: async () => collection(),
  });

  assert.equal(result.qualification.status, "observing");
  assert.equal(result.qualification.candidates[0].observation_count, 1);
  assert.equal(result.qualification.candidates[0].healthy_probe_count, 1);
});

test("healthy empty probes prove availability but never invent useful event yield", async () => {
  const first = await qualifyDiscoveredSourceProfile({
    ...baseInput,
    profile: profile(),
    manifests: [manifest()],
    now: "2026-08-01T10:00:00Z",
    collectEvents: async () => collection({ accepted: 0, result: "empty" }),
  });
  const second = await qualifyDiscoveredSourceProfile({
    ...baseInput,
    profile: profile(),
    manifests: [manifest()],
    previousQualification: first.qualification,
    now: "2026-08-08T10:00:00Z",
    collectEvents: async () => collection({ accepted: 0, result: "empty" }),
  });

  assert.equal(second.qualification.status, "observing");
  assert.equal(second.qualification.candidates[0].healthy_probe_count, 2);
  assert.equal(second.qualification.candidates[0].event_bearing_probe_count, 0);
  assert.ok(second.qualification.candidates[0].reasons.includes("accepted_event_evidence_required"));
});

test("bounded probe scheduling rotates across sources without discarding prior evidence", async () => {
  const ids = ["source-a", "source-b", "source-c"];
  const multiProfile = profile();
  multiProfile.source_families[0].candidates = ids.map((id) => candidate({
    id,
    url: `https://events.example/api/${id}`,
  }));
  const multiManifests = ids.map((id) => manifest({
    id,
    endpoint: `https://events.example/api/${id}`,
  }));
  const firstCalls = [];
  const first = await qualifyDiscoveredSourceProfile({
    ...baseInput,
    profile: multiProfile,
    manifests: multiManifests,
    now: "2026-08-01T10:00:00Z",
    collectEvents: async (input) => {
      firstCalls.push(input.registry[0].id);
      return collection();
    },
  });
  const secondCalls = [];
  const second = await qualifyDiscoveredSourceProfile({
    ...baseInput,
    profile: multiProfile,
    manifests: multiManifests,
    previousQualification: first.qualification,
    now: "2026-08-08T10:00:00Z",
    collectEvents: async (input) => {
      secondCalls.push(input.registry[0].id);
      return collection();
    },
  });

  assert.deepEqual(firstCalls, ["source-a", "source-b"]);
  assert.deepEqual(secondCalls, ["source-c", "source-a"]);
  assert.equal(second.qualification.candidate_count, 3);
  assert.equal(second.qualification.candidates.find((item) => item.candidate_id === "source-b").observation_count, 1);
});

test("a latest provider failure removes a prior review-ready verdict fail-soft", async () => {
  const prior = {
    schema_version: 1,
    activation_performed: false,
    candidates: [{
      candidate_id: "regional-events",
      endpoint: "https://events.example/api/events",
      adapter: "events_calendar",
      source_identity: "events.example",
      observations: [
        {
          candidate_id: "regional-events",
          endpoint: "https://events.example/api/events",
          adapter: "events_calendar",
          source_identity: "events.example",
          observed_at: "2026-08-01T10:00:00.000Z",
          status: "healthy",
          result: "events_found",
          accepted_event_count: 1,
        },
        {
          candidate_id: "regional-events",
          endpoint: "https://events.example/api/events",
          adapter: "events_calendar",
          source_identity: "events.example",
          observed_at: "2026-07-25T10:00:00.000Z",
          status: "healthy",
          result: "events_found",
          accepted_event_count: 1,
        },
      ],
    }],
  };
  const result = await qualifyDiscoveredSourceProfile({
    ...baseInput,
    profile: profile(),
    manifests: [manifest()],
    previousQualification: prior,
    now: "2026-08-08T10:00:00Z",
    collectEvents: async () => collection({ accepted: 0, status: "failed", result: "failed" }),
  });

  assert.equal(result.qualification.status, "observing");
  assert.ok(result.qualification.candidates[0].reasons.includes("latest_probe_not_healthy"));
});

test("manifest identity drift and social-only candidates cannot enter provider qualification", async () => {
  let calls = 0;
  const drift = await qualifyDiscoveredSourceProfile({
    ...baseInput,
    profile: profile(),
    manifests: [manifest({ endpoint: "https://other.example/api/events" })],
    collectEvents: async () => {
      calls += 1;
      return collection();
    },
  });
  const social = await qualifyDiscoveredSourceProfile({
    ...baseInput,
    profile: profile({ family: "community_social_listing", corroboration_required: true }),
    manifests: [manifest()],
    collectEvents: async () => {
      calls += 1;
      return collection();
    },
  });
  const permissionRequired = await qualifyDiscoveredSourceProfile({
    ...baseInput,
    profile: profile({ status: "needs_adapter_or_permission", terms_status: "permission_required" }),
    manifests: [manifest({ review: { terms_status: "permission_required" } })],
    collectEvents: async () => {
      calls += 1;
      return collection();
    },
  });

  assert.equal(drift.qualification.status, "unavailable");
  assert.equal(social.qualification.status, "unavailable");
  assert.equal(permissionRequired.qualification.status, "unavailable");
  assert.equal(calls, 0);
});

test("invalid trusted anchors fail closed before provider collection", async () => {
  let calls = 0;
  const result = await qualifyDiscoveredSourceProfile({
    ...baseInput,
    anchor: { lat: 95, lng: 13 },
    profile: profile(),
    manifests: [manifest()],
    collectEvents: async () => {
      calls += 1;
      return collection();
    },
  });

  assert.equal(result.qualification.status, "unavailable");
  assert.deepEqual(result.qualification.reasons, ["qualification_input_invalid"]);
  assert.equal(calls, 0);
});
