const assert = require("node:assert/strict");
const test = require("node:test");

const {
  normalizePlaceCandidate,
  validatePlaceCandidate,
  validateCandidateTrust,
} = require("../server/place-candidates/contract");

test("normalizes a curated catalog stop into the PlaceCandidate contract", () => {
  const candidate = normalizePlaceCandidate({
    id: "barcelona-casa-vicens",
    city: "barcelona",
    name: "Casa Vicens",
    kind: "museum",
    lat: 41.4036,
    lng: 2.1507,
    area: "gracia",
    macro: "northwest-local",
    tags: ["kultur", "klassiker", "kultur"],
    vibes: ["curious"],
    timeFit: ["morning", "afternoon"],
    routeRoles: ["anchor", "culture"],
    source: {
      kind: "city_catalog",
      id: "barcelona-pilot-catalog",
      url: "https://example.com/casa-vicens",
    },
    trust: {
      sourceTier: "curated",
      confidence: "high",
      humanVerified: true,
      freshness: "fresh",
    },
    cityPackOwned: true,
  });

  assert.deepEqual(candidate, {
    id: "barcelona-casa-vicens",
    city: "barcelona",
    label: "Casa Vicens",
    type: "museum",
    candidate_kind: "real_place",
    is_structural: false,
    source: {
      kind: "city_catalog",
      id: "barcelona-pilot-catalog",
      url: "https://example.com/casa-vicens",
    },
    trust: {
      source_tier: "curated",
      confidence: "high",
      human_verified: true,
      freshness: "fresh",
    },
    freshness: "fresh",
    tags: ["kultur", "klassiker"],
    vibes: ["curious"],
    time_fit: ["morning", "afternoon"],
    route_roles: ["anchor", "culture"],
    confidence: "high",
    city_pack_owned: true,
    lat: 41.4036,
    lng: 2.1507,
    area: "gracia",
    macro: "northwest-local",
  });

  assert.doesNotThrow(() => validatePlaceCandidate(candidate));
});

test("normalizes official live event venues without making them city-pack owned", () => {
  const candidate = normalizePlaceCandidate({
    id: "official-barcelona-open-data-123-venue",
    city: "barcelona",
    label: "Centre Civic Example",
    type: "event",
    candidate_kind: "event_venue",
    lat: 41.39,
    lng: 2.17,
    area: "eixample",
    tags: ["kultur", "music"],
    route_roles: ["optional_detour"],
    source: {
      kind: "live_event_feed",
      id: "barcelona-open-data-agenda",
      label: "Open Data BCN",
    },
    trust: {
      source_tier: "official",
      confidence: "medium",
      human_verified: false,
      freshness: "live",
    },
  });

  assert.equal(candidate.candidate_kind, "event_venue");
  assert.equal(candidate.source.kind, "live_event_feed");
  assert.equal(candidate.city_pack_owned, false);
  assert.equal(candidate.trust.source_tier, "official");
  assert.equal(candidate.freshness, "live");
  assert.doesNotThrow(() => validatePlaceCandidate(candidate));
});

test("preserves the structural versus real-place distinction", () => {
  const anchor = normalizePlaceCandidate({
    id: "barcelona-old-town-anchor",
    city: "barcelona",
    label: "Old town routing anchor",
    type: "district-group",
    structuralRouteAnchor: true,
    lat: 41.383,
    lng: 2.18,
    area: "gothic",
    source: { kind: "routing_config", id: "barcelona-area-model" },
    trust: {
      source_tier: "computed",
      confidence: "high",
      human_verified: true,
      freshness: "fresh",
    },
    city_pack_owned: true,
  });

  assert.equal(anchor.candidate_kind, "structural_anchor");
  assert.equal(anchor.is_structural, true);
  assert.doesNotThrow(() => validatePlaceCandidate(anchor));
});

test("supports generated and map/search candidates with lower confidence", () => {
  const generated = normalizePlaceCandidate({
    id: "auto-rio-draft-001",
    city: "rio-de-janeiro",
    label: "Draft place from map search",
    type: "cafe",
    candidate_kind: "map_result",
    source: { kind: "map_search", label: "future provider" },
    trust: {
      source_tier: "inferred",
      confidence: "needs_review",
      human_verified: false,
      freshness: "unknown",
    },
    tags: ["mat"],
  });

  assert.equal(generated.city_pack_owned, false);
  assert.equal(generated.confidence, "needs_review");
  assert.doesNotThrow(() => validatePlaceCandidate(generated));
});

test("rejects missing identity, invalid coordinate pairs, and weak trust objects", () => {
  const valid = normalizePlaceCandidate({
    id: "rome-test",
    city: "rome",
    label: "Rome Test",
    type: "bar",
    source: { kind: "city_catalog" },
    trust: {
      source_tier: "curated",
      confidence: "high",
      human_verified: true,
      freshness: "fresh",
    },
  });

  assert.throws(() => validatePlaceCandidate({ ...valid, id: "" }), /id/);
  assert.throws(() => validatePlaceCandidate({ ...valid, lat: 41.9 }), /lat and .*lng/);
  assert.throws(() => validatePlaceCandidate({ ...valid, lat: 120, lng: 12 }), /lat/);
  assert.throws(
    () =>
      validateCandidateTrust({
        source_tier: "vibes",
        confidence: "certain",
        human_verified: "yes",
        freshness: "forever",
      }),
    /source_tier|confidence|human_verified|freshness/,
  );
});
