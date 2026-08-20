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

test("adaptive breadth persists only compact yield and stop evidence", () => {
  const health = buildSourceDiscoveryHealth({
    result: discovery({
      source_search: {
        status: "complete",
        generated_query_count: 18,
        queried_count: 14,
        skipped_query_count: 4,
        expansion_round_count: 2,
        novel_source_identity_count: 7,
        stop_reason: "marginal_novelty_exhausted",
        responding_query_count: 14,
        result_count: 30,
        accepted_seed_count: 12,
        query_outcomes: [
          { query_family: "local_discovery", query: "must-not-persist" },
          { query_family: "generic_calendar" },
        ],
        query_tranches: [
          { query_count: 6, novel_source_identity_count: 5, untrustworthy_query_count: 0 },
          { query_count: 4, novel_source_identity_count: 2, untrustworthy_query_count: 1 },
          { query_count: 4, novel_source_identity_count: 0, untrustworthy_query_count: 0 },
        ],
      },
    }),
    observedAt: NOW,
  });

  assert.equal(health.search.generated_query_count, 18);
  assert.equal(health.search.queried_count, 14);
  assert.equal(health.search.stop_reason, "marginal_novelty_exhausted");
  assert.deepEqual(health.search.represented_query_families, [
    "local_discovery",
    "generic_calendar",
  ]);
  assert.equal(health.search.query_tranches.length, 3);
  assert.doesNotMatch(JSON.stringify(health), /must-not-persist/);
});
