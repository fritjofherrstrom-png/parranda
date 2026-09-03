"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  placeSourceAdapterContract,
  placeFeedsFromReviewedSourceProfiles,
  resolveReviewedPlaceSourceProfileFeeds,
} = require("../server/place-candidates/reviewed-place-source-profile");

const NOW = "2026-08-20T12:00:00.000Z";

function profile() {
  const candidate = {
    id: "regional-place-guide",
    source_label: "Regional place guide",
    url: "https://guide.example/places",
    status: "viable_place_provider_probe",
    adapter: "schema_org_place_html",
    maps_to_existing_provider: true,
    trust_tier: "official",
    source_identity: "guide.example",
  };
  return {
    profile_key: "place-source-profile-v1:test-region",
    place_context: {
      label: "Test region",
      bounds: { west: 13, south: 55, east: 14, north: 56 },
    },
    source_families: [{ family: "official_destination_guide", candidates: [candidate] }],
    runtime_review: {
      status: "approved",
      reviewed_at: "2026-08-01T00:00:00.000Z",
      expires_at: "2026-09-01T00:00:00.000Z",
      feeds: [],
      place_sources: [{
        candidate_id: candidate.id,
        id: "reviewed-regional-places",
        label: "Regional place guide",
        endpoint: candidate.url,
        adapter: candidate.adapter,
        adapter_contract_revision: "schema-org-place-html-v1",
        evidence_family: "official",
        source_tier: "official",
        source_identity: candidate.source_identity,
        license: "CC-BY 4.0",
        terms_status: "open_license",
        source_health: "healthy",
        runtime_policy: "bounded_refresh",
        max_items: 30,
      }],
    },
  };
}

test("a fresh operator review binds one exact place source", () => {
  const [feed] = placeFeedsFromReviewedSourceProfiles([profile()], { now: NOW });
  assert.equal(feed.id, "reviewed-regional-places");
  assert.equal(feed.adapter, "schema_org_place_html");
  assert.equal(feed.evidence_family, "official");
  assert.deepEqual(feed.bbox, [13, 55, 14, 56]);
  assert.equal(feed.max_items, 30);
});

test("a fresh review can bind the closed map-linked HTML adapter", () => {
  const value = profile();
  value.source_families[0].candidates[0].adapter = "map_linked_place_html";
  value.runtime_review.place_sources[0].adapter = "map_linked_place_html";
  value.runtime_review.place_sources[0].adapter_contract_revision = "map-linked-place-html-v2";

  const [feed] = placeFeedsFromReviewedSourceProfiles([value], { now: NOW });
  assert.equal(feed.adapter, "map_linked_place_html");
  assert.equal(feed.adapter_contract_revision, "map-linked-place-html-v2");
  assert.equal(feed.endpoint, "https://guide.example/places");
  assert.equal(placeSourceAdapterContract("map_linked_place_html"), "map-linked-place-html-v2");
});

test("a fresh review can bind the bounded list-detail adapter contract", () => {
  const value = profile();
  value.source_families[0].candidates[0].adapter = "schema_org_place_list_detail_html";
  value.runtime_review.place_sources[0].adapter = "schema_org_place_list_detail_html";
  value.runtime_review.place_sources[0].adapter_contract_revision = "schema-org-place-list-detail-html-v1";

  const [feed] = placeFeedsFromReviewedSourceProfiles([value], { now: NOW });
  assert.equal(feed.adapter, "schema_org_place_list_detail_html");
  assert.equal(feed.adapter_contract_revision, "schema-org-place-list-detail-html-v1");
  assert.equal(feed.max_items, 12);
  assert.equal(
    placeSourceAdapterContract("schema_org_place_list_detail_html"),
    "schema-org-place-list-detail-html-v1",
  );
});

test("list-detail approvals fail closed on an unknown parser revision", () => {
  const value = profile();
  value.source_families[0].candidates[0].adapter = "schema_org_place_list_detail_html";
  value.runtime_review.place_sources[0].adapter = "schema_org_place_list_detail_html";
  value.runtime_review.place_sources[0].adapter_contract_revision = "schema-org-place-list-detail-html-v0";

  assert.deepEqual(placeFeedsFromReviewedSourceProfiles([value], { now: NOW }), []);
});

test("an approval bound to the previous map-linked adapter contract fails closed", () => {
  const value = profile();
  value.source_families[0].candidates[0].adapter = "map_linked_place_html";
  value.runtime_review.place_sources[0].adapter = "map_linked_place_html";
  value.runtime_review.place_sources[0].adapter_contract_revision = "map-linked-place-html-v1";

  assert.deepEqual(placeFeedsFromReviewedSourceProfiles([value], { now: NOW }), []);
});

test("the reviewed bridge binds candidates from the dedicated place-source discovery lane", () => {
  const value = profile();
  value.place_source_candidates = value.source_families[0].candidates;
  value.place_source_candidates[0].candidate_kind = "place_list";
  value.source_families = [];
  const feeds = placeFeedsFromReviewedSourceProfiles([value], { now: NOW });
  assert.equal(feeds.length, 1);
  assert.equal(feeds[0].endpoint, "https://guide.example/places");
});

test("discovery without approval never activates a place source", () => {
  const value = profile();
  value.runtime_review.status = "unreviewed";
  value.runtime_review.reviewed_at = null;
  value.runtime_review.expires_at = null;
  assert.deepEqual(placeFeedsFromReviewedSourceProfiles([value], { now: NOW }), []);
});

test("expired, endpoint-swapped, adapter-swapped and unhealthy place sources fail closed", () => {
  const mutations = [
    (value) => { value.runtime_review.expires_at = "2026-08-19T00:00:00.000Z"; },
    (value) => { value.runtime_review.place_sources[0].endpoint = "https://other.example/places"; },
    (value) => { value.runtime_review.place_sources[0].adapter = "schema_org_place_json"; },
    (value) => { value.runtime_review.place_sources[0].source_health = "unknown"; },
    (value) => { value.runtime_review.place_sources[0].terms_status = "unknown"; },
    (value) => { value.source_families[0].candidates[0].maps_to_existing_provider = false; },
  ];
  for (const mutate of mutations) {
    const value = profile();
    mutate(value);
    assert.deepEqual(placeFeedsFromReviewedSourceProfiles([value], { now: NOW }), []);
  }
});

test("only closed official/editorial evidence families and matching tiers are accepted", () => {
  const community = profile();
  community.runtime_review.place_sources[0].evidence_family = "community";
  assert.deepEqual(placeFeedsFromReviewedSourceProfiles([community], { now: NOW }), []);

  const editorial = profile();
  editorial.runtime_review.place_sources[0].evidence_family = "editorial";
  editorial.runtime_review.place_sources[0].source_tier = "editorial";
  assert.equal(placeFeedsFromReviewedSourceProfiles([editorial], { now: NOW }).length, 1);

  const disguised = profile();
  disguised.runtime_review.place_sources[0].source_tier = "editorial";
  assert.deepEqual(placeFeedsFromReviewedSourceProfiles([disguised], { now: NOW }), []);
});

test("the server-owned env contract rejects malformed and unknown rows", () => {
  assert.deepEqual(resolveReviewedPlaceSourceProfileFeeds({
    PARRANDA_REVIEWED_PLACE_SOURCE_PROFILES: "{bad",
  }), []);
  const value = profile();
  value.runtime_review.reviewed_at = new Date(Date.now() - 60_000).toISOString();
  value.runtime_review.expires_at = new Date(Date.now() + 60_000).toISOString();
  const feeds = resolveReviewedPlaceSourceProfileFeeds({
    PARRANDA_REVIEWED_PLACE_SOURCE_PROFILES: JSON.stringify([value]),
  });
  assert.equal(feeds.length, 1);
});
