"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  createSearxngSourceSearch,
} = require("../server/pulse-sources/source-search-provider");
const {
  buildSourceDiscoveryHealth,
} = require("../server/pulse-sources/source-discovery-health");
const { runScoutWorkerBatch } = require("../scripts/run-source-scout-worker");

const ENDPOINT = "https://search.example/search";

function response(body, { status = 200, contentType = "application/json" } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    url: ENDPOINT,
    headers: {
      get: (name) =>
        String(name).toLowerCase() === "content-type" ? contentType : null,
    },
    text: async () => body,
  };
}

function payload({ results = [], unresponsive = [] } = {}) {
  return JSON.stringify({ results, unresponsive_engines: unresponsive });
}

function hit(host, title) {
  return { url: `https://${host}/events`, title };
}

// `delay` is stubbed everywhere: pacing and backoff must be provably bounded,
// not slow. Nothing here sleeps.
function search(overrides = {}) {
  return createSearxngSourceSearch({
    endpoint: ENDPOINT,
    delay: async () => {},
    ...overrides,
  });
}

// --------------------------------------------------------------------------
// 1-4. The four distinct truths a metasearch can tell us.
// --------------------------------------------------------------------------

test("useful results with degraded engines stay usable and are never discarded", async () => {
  const run = search({
    fetcher: async () => response(payload({
      results: [hit("kalender.example", "Kalender"), hit("kultur.example", "Kultur")],
      unresponsive: [["bing", "CAPTCHA"], ["qwant", "timeout"]],
    })),
  });

  const result = await run({ queries: ["one town events"] });

  assert.equal(result.status, "partial");
  assert.equal(result.query_outcomes[0].status, "partial");
  // The whole point: degradation downgrades confidence, it does not bin results.
  assert.equal(result.seed_count, 2);
  assert.equal(result.query_outcomes[0].results_despite_degraded_engines, true);
  assert.equal(result.retry_recommended, false);
});

test("useful results with healthy engines are a clean success", async () => {
  const run = search({
    fetcher: async () => response(payload({ results: [hit("kalender.example", "Kalender")] })),
  });

  const result = await run({ queries: ["one town events"] });

  assert.equal(result.status, "complete");
  assert.equal(result.query_outcomes[0].status, "ok");
  assert.equal(result.seed_count, 1);
  assert.equal(result.retry_recommended, false);
});

test("a genuinely unavailable provider is a retryable failure", async () => {
  for (const status of [500, 502, 429]) {
    const run = search({ fetcher: async () => response("", { status }) });
    const result = await run({ queries: ["one town events"] });

    assert.equal(result.status, "failed", String(status));
    assert.equal(result.query_outcomes[0].retryable, true, String(status));
    assert.equal(result.retry_recommended, true, String(status));
    assert.equal(result.query_outcomes[0].attempt_count, 2, String(status));
  }
});

test("a clean zero-result search is an answer, not a provider failure", async () => {
  const run = search({ fetcher: async () => response(payload({ results: [] })) });

  const result = await run({ queries: ["one town events"] });

  assert.equal(result.status, "empty");
  assert.equal(result.query_outcomes[0].status, "empty");
  assert.equal(result.query_outcomes[0].reason, "source_search_query_empty");
  // Nothing to retry: the provider answered and the answer was "nothing".
  assert.equal(result.query_outcomes[0].retryable, false);
  assert.equal(result.retry_recommended, false);
});

test("engines down with no results is degraded, and degraded is retryable", async () => {
  const run = search({
    fetcher: async () => response(payload({ unresponsive: [["google", "CAPTCHA"]] })),
  });

  const result = await run({ queries: ["one town events"] });

  assert.equal(result.query_outcomes[0].status, "degraded");
  assert.equal(result.query_outcomes[0].reason, "source_search_engines_unavailable");
  assert.equal(result.degraded_query_count, 1);
  assert.equal(result.retry_recommended, true);
  // Never a healthy empty: we did not learn that this place has nothing.
  assert.notEqual(result.status, "empty");
});

// --------------------------------------------------------------------------
// 5. Mixed runs: good answers survive bad neighbours.
// --------------------------------------------------------------------------

test("results from healthy queries survive when other queries fail", async () => {
  const run = search({
    maxQueries: 4,
    fetcher: async (url) => {
      const query = new URL(url).searchParams.get("q");
      if (query.includes("alpha")) return response(payload({ results: [hit("alpha.example", "A")] }));
      if (query.includes("beta")) return response("", { status: 503 });
      if (query.includes("gamma")) return response(payload({ unresponsive: [["bing", "timeout"]] }));
      return response(payload({ results: [] }));
    },
  });

  const result = await run({ queries: ["alpha", "beta", "gamma", "delta"] });

  assert.equal(result.seed_count, 1);
  assert.equal(result.seeds[0].url, "https://alpha.example/events");
  assert.equal(result.status, "partial");
  assert.deepEqual(
    result.query_outcomes.map((row) => row.status),
    ["ok", "failed", "degraded", "empty"],
  );
  // Seeds exist, so the run is not asking to be retried wholesale.
  assert.equal(result.retry_recommended, false);
});

// --------------------------------------------------------------------------
// Bounded pacing and retry: helpful, never a polling loop.
// --------------------------------------------------------------------------

test("queries are paced and retries draw from one bounded run budget", async () => {
  const waits = [];
  let calls = 0;
  const run = createSearxngSourceSearch({
    endpoint: ENDPOINT,
    maxQueries: 5,
    retryBudget: 2,
    delay: async (ms) => { waits.push(ms); },
    fetcher: async () => {
      calls += 1;
      return response(payload({ unresponsive: [["google", "CAPTCHA"]] }));
    },
  });

  const result = await run({ queries: ["a", "b", "c", "d", "e"] });

  // 5 queries + exactly 2 retries from the shared budget. A per-query retry
  // would have cost 10 calls against a provider that is plainly down.
  assert.equal(calls, 7);
  assert.equal(result.queried_count, 5);
  // 4 pacing waits (none before the first query) + 2 retry backoffs.
  assert.equal(waits.filter((ms) => ms === 250).length, 4);
  assert.equal(waits.length, 6);
});

test("contract and configuration errors are not retried", async () => {
  for (const [status, body] of [[404, ""], [403, ""], [200, "not json"]]) {
    let calls = 0;
    const run = search({
      fetcher: async () => { calls += 1; return response(body, { status }); },
    });
    const result = await run({ queries: ["one town events"] });

    assert.equal(calls, 1, `${status} should not retry`);
    assert.equal(result.query_outcomes[0].retryable, false, String(status));
  }
});

// --------------------------------------------------------------------------
// 6. A run we cannot believe schedules a bounded retry instead of parking.
// --------------------------------------------------------------------------

function scoutTarget() {
  return {
    target_key: "source-scout-target-v1:resilience",
    lease_token: "lease-resilience",
    place_label: "Test Region, Test Country",
    anchor: { lat: 55.6, lng: 13 },
    place_context: { region: "Test Region", country_code: "tc" },
    spatial_scope: { bounds: { west: 12.8, south: 55.4, east: 13.3, north: 55.8 } },
    attempt_count: 1,
  };
}

async function runWorkerWith(sourceSearch) {
  const calls = { completed: [], failed: [] };
  let claims = 0;
  const result = await runScoutWorkerBatch({
    catalog: {
      claimScoutTarget: async () => (claims++ === 0 ? scoutTarget() : null),
      loadSourceQualification: async () => null,
      recordDiscovery: async () => ({ status: "recorded", profile_key: "k" }),
      completeScoutTarget: async (_t, reason, options) => {
        calls.completed.push({ reason, options });
        return { status: "completed" };
      },
      failScoutTarget: async (_t, reason, options) => {
        calls.failed.push({ reason, options });
        return { status: "retry_wait", retry_at: "2026-08-02T00:05:00.000Z" };
      },
    },
    runtime: { now: () => new Date("2026-08-01T12:00:00Z") },
    discover: async () => ({
      status: "empty",
      reasons: ["no_trusted_website_seeds"],
      source_search: sourceSearch,
    }),
  });
  return { result, calls };
}

test("a degraded search retries the target instead of parking it for a refresh cycle", async () => {
  const { result, calls } = await runWorkerWith({
    status: "degraded",
    queried_count: 10,
    responding_query_count: 0,
    degraded_query_count: 10,
    retry_recommended: true,
  });

  assert.equal(calls.completed.length, 0);
  assert.equal(calls.failed.length, 1);
  assert.equal(result.results[0].status, "retry_scheduled");
  assert.equal(result.results[0].discovery_status, "search_failed");
});

test("a provider outage also retries rather than completing", async () => {
  const { calls } = await runWorkerWith({
    status: "failed",
    queried_count: 10,
    responding_query_count: 0,
    retry_recommended: true,
  });

  assert.equal(calls.completed.length, 0);
  assert.equal(calls.failed.length, 1);
});

test("a clean empty search still completes on the ordinary refresh cadence", async () => {
  const { calls } = await runWorkerWith({
    status: "empty",
    queried_count: 10,
    responding_query_count: 10,
    degraded_query_count: 0,
    retry_recommended: false,
  });

  // This one really did answer. It keeps the normal refresh, not a retry.
  assert.equal(calls.failed.length, 0);
  assert.equal(calls.completed.length, 1);
  assert.equal(calls.completed[0].options.nextAttemptAt, undefined);
});

// --------------------------------------------------------------------------
// 7. Persisted observability reflects what actually happened.
// --------------------------------------------------------------------------

test("per-query evidence explains the run without raw provider payloads", async () => {
  const run = search({
    maxQueries: 2,
    fetcher: async (url) => {
      const query = new URL(url).searchParams.get("q");
      return query.includes("alpha")
        ? response(payload({
            results: [hit("alpha.example", "A"), { url: "http://127.0.0.1/private" }],
            unresponsive: [["bing", "CAPTCHA"], ["bing", "CAPTCHA"]],
          }))
        : response(payload({ unresponsive: [["google", "timeout"]] }));
    },
  });

  const result = await run({ queries: ["alpha town events", "beta town events"] });
  const [alpha, beta] = result.query_outcomes;

  assert.equal(alpha.query, "alpha town events");
  assert.equal(alpha.status, "partial");
  // Raw vs accepted separates "provider found nothing" from "we filtered it".
  assert.equal(alpha.raw_result_count, 2);
  assert.equal(alpha.result_count, 1);
  assert.deepEqual(alpha.unresponsive_engines, ["bing"]);
  assert.equal(alpha.results_despite_degraded_engines, true);

  assert.equal(beta.status, "degraded");
  assert.equal(beta.raw_result_count, 0);
  assert.equal(beta.retryable, true);
  assert.equal(beta.results_despite_degraded_engines, false);

  // Bounded: no raw payload, no engine error strings.
  const serialized = JSON.stringify(result.query_outcomes);
  assert.doesNotMatch(serialized, /CAPTCHA|unresponsive_engines":\[\[/);
  assert.ok(serialized.length < 2000);
});

test("a truncated query budget is reported, never silent", async () => {
  const run = search({
    maxQueries: 2,
    fetcher: async () => response(payload({ results: [] })),
  });

  const result = await run({ queries: ["a", "b", "c", "d", "e"] });

  assert.equal(result.generated_query_count, 5);
  assert.equal(result.queried_count, 2);
  assert.equal(result.skipped_query_count, 3);
});

test("degraded search health is search_failed, never healthy_empty", async () => {
  const health = buildSourceDiscoveryHealth({
    result: {
      status: "empty",
      reasons: ["source_search_degraded", "no_trusted_website_seeds"],
      source_search: {
        status: "degraded",
        queried_count: 10,
        responding_query_count: 0,
        degraded_query_count: 10,
        retry_recommended: true,
      },
      source_scout: null,
    },
    observedAt: new Date("2026-08-01T12:00:00Z"),
  });

  assert.equal(health.status, "search_failed");
  assert.notEqual(health.status, "healthy_empty");
  assert.equal(health.search.status, "degraded");
  assert.equal(health.search.retry_recommended, true);
});

// --------------------------------------------------------------------------
// Cache: a retry must be able to learn something new.
// --------------------------------------------------------------------------

test("zero-result and degraded outcomes are never frozen into the cache", async () => {
  const stored = [];
  const cache = {
    get: async (_key, producer, options) => {
      const value = await producer();
      if (options.shouldStore(value)) stored.push(value.status);
      return value;
    },
  };
  const outcomes = [
    { name: "degraded", body: payload({ unresponsive: [["bing", "timeout"]] }) },
    { name: "empty", body: payload({ results: [] }) },
    { name: "ok", body: payload({ results: [hit("alpha.example", "A")] }) },
  ];

  for (const outcome of outcomes) {
    const run = search({ cache, fetcher: async () => response(outcome.body) });
    await run({ queries: [`${outcome.name} town events`] });
  }

  // Only an answer that carried results may be replayed. Caching a negative
  // verdict would make the bounded retry a no-op for exactly the queries we
  // most want to re-ask.
  assert.deepEqual(stored, ["ok"]);
});

// --------------------------------------------------------------------------
// 8. Still city-agnostic.
// --------------------------------------------------------------------------

test("search resilience introduces no place, publisher or engine rules", () => {
  const fs = require("node:fs");
  const source = [
    "../server/pulse-sources/source-search-provider",
    "../scripts/run-source-scout-worker",
  ]
    .map((path) => fs.readFileSync(require.resolve(path), "utf8"))
    .join("\n");

  assert.ok(!/\b(?:prague|praha|malm[oö]|stockholm|porto|aarhus|visby|ystad|bled|bolzano)\b/i.test(source));
  // Retryability is decided by transport and provider semantics, never by
  // which upstream engine happened to fail.
  assert.ok(!/"google"|"bing"|"duckduckgo"|"qwant"/i.test(source));
});
