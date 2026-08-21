"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  buildSourceDiscoveryHealth,
  normalizeSourceDiscoveryHealth,
} = require("../server/pulse-sources/source-discovery-health");

const NOW = new Date("2026-08-19T10:00:00.000Z");

function discovery(overrides = {}) {
  return {
    status: "complete",
    reasons: ["bounded_source_scout_complete"],
    source_search: {
      status: "complete",
      queried_count: 6,
      responding_query_count: 6,
      failed_query_count: 0,
      result_count: 1,
      accepted_seed_count: 1,
    },
    source_scout: {
      status: "complete",
      inspected_source_count: 1,
      blocked_source_count: 0,
      failed_source_count: 0,
    },
    manifest_candidates: [],
    ...overrides,
  };
}

test("discovery health distinguishes observing, review, empty and broken search states", () => {
  const observing = buildSourceDiscoveryHealth({
    result: discovery({ manifest_candidates: [{ id: "candidate" }] }),
    qualificationStatus: "observing",
    observedAt: NOW,
  });
  assert.equal(observing.status, "observing");
  assert.equal(observing.qualification.candidate_count, 1);

  const review = buildSourceDiscoveryHealth({
    result: discovery({ manifest_candidates: [{ id: "candidate" }] }),
    qualificationStatus: "qualified_for_review",
    observedAt: NOW,
  });
  assert.equal(review.status, "review_required");

  const empty = buildSourceDiscoveryHealth({
    result: discovery({
      status: "empty",
      source_search: {
        status: "empty",
        queried_count: 6,
        responding_query_count: 6,
        failed_query_count: 0,
        result_count: 0,
        accepted_seed_count: 0,
      },
      source_scout: null,
    }),
    observedAt: NOW,
  });
  assert.equal(empty.status, "healthy_empty");

  const failed = buildSourceDiscoveryHealth({
    result: discovery({
      status: "empty",
      source_search: {
        status: "partial",
        queried_count: 6,
        responding_query_count: 2,
        failed_query_count: 4,
      },
    }),
    observedAt: NOW,
  });
  assert.equal(failed.status, "search_failed");
  assert.notEqual(failed.status, "healthy_empty");
});

test("missing source-search wiring is explicit and health normalization drops unknown fields", () => {
  const health = buildSourceDiscoveryHealth({
    result: { status: "empty", reasons: ["no_trusted_website_seeds"] },
    observedAt: NOW,
  });
  assert.equal(health.status, "environment_not_wired");

  const normalized = normalizeSourceDiscoveryHealth({
    ...health,
    endpoint: "https://secret.example/search?token=hidden",
    raw_results: [{ secret: true }],
  });
  assert.equal(normalized.endpoint, undefined);
  assert.equal(normalized.raw_results, undefined);
  assert.doesNotMatch(JSON.stringify(normalized), /secret|token|hidden/);
});
