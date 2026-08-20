"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");

const {
  createSearxngSourceSearch,
} = require("../server/pulse-sources/source-search-provider");

const ENDPOINT = "http://search.internal:8080/search";

function response(body) {
  return {
    ok: true,
    status: 200,
    url: ENDPOINT,
    headers: { get: () => null },
    text: async () => JSON.stringify(body),
  };
}

function hit(host, suffix = "events") {
  return { url: `https://${host}/${suffix}`, title: `${host} programme` };
}

function plan(count, { grouped = false } = {}) {
  const out = [];
  for (let index = 0; index < count; index += 1) {
    const familyIndex = grouped ? Math.floor(index / 3) : index;
    out.push({
      query: `Test place discovery ${index + 1}`,
      query_family: `family_${familyIndex % 8}`,
      term_key: familyIndex.toString(16).padStart(12, "0"),
      label_scope: ["locality", "region", "resolved_label"][index % 3],
    });
  }
  return out;
}

function search(options = {}) {
  return createSearxngSourceSearch({
    endpoint: ENDPOINT,
    queryPaceMs: 0,
    retryBudget: 0,
    delay: async () => {},
    ...options,
  });
}

async function runWithPlan(run, queryPlan) {
  return run({
    queries: queryPlan.map((item) => item.query),
    query_plan: queryPlan,
    place: { label: "Test place", language_hints: ["en"] },
  });
}

test("later source evidence survives the old first-ten cutoff", async () => {
  const queryPlan = plan(14);
  const lateQuery = queryPlan[11].query;
  const requested = [];
  const run = search({
    maxQueries: 10,
    expansionTrancheSize: 4,
    fetcher: async (url) => {
      const query = new URL(url).searchParams.get("q");
      requested.push(query);
      return response({ results: query === lateQuery ? [hit("late-source.example")] : [] });
    },
  });

  const result = await runWithPlan(run, queryPlan);

  assert.equal(queryPlan.slice(0, 10).includes(lateQuery), false, "old fixed prefix misses it");
  assert.ok(requested.includes(lateQuery), "adaptive expansion reaches the later family");
  assert.equal(result.seeds[0].url, "https://late-source.example/events");
  assert.equal(result.queried_count, 14);
  assert.equal(result.expansion_round_count, 1);
});

test("the initial tranche round-robins query families instead of draining the first", async () => {
  const queryPlan = plan(9, { grouped: true });
  const requested = [];
  const run = search({
    maxQueries: 4,
    hardQueryLimit: 4,
    fetcher: async (url) => {
      requested.push(new URL(url).searchParams.get("q"));
      return response({ results: [] });
    },
  });

  const result = await runWithPlan(run, queryPlan);

  assert.deepEqual(requested, [
    queryPlan[0].query,
    queryPlan[3].query,
    queryPlan[6].query,
    queryPlan[1].query,
  ]);
  assert.equal(new Set(result.query_outcomes.map((item) => item.query_family)).size, 3);
});

test("productive expansion continues while later tranches add new identities", async () => {
  const queryPlan = plan(14);
  const run = search({
    maxQueries: 6,
    expansionTrancheSize: 4,
    fetcher: async (url) => {
      const index = Number(new URL(url).searchParams.get("q").split(" ").at(-1));
      return response({ results: [hit(`source-${index}.example`)] });
    },
  });

  const result = await runWithPlan(run, queryPlan);

  assert.equal(result.queried_count, 14);
  assert.equal(result.expansion_round_count, 2);
  assert.equal(result.novel_source_identity_count, 14);
  assert.equal(result.stop_reason, "query_space_exhausted");
});

test("two non-productive expansion tranches stop before exhausting the universe", async () => {
  const queryPlan = plan(18);
  const run = search({
    maxQueries: 6,
    expansionTrancheSize: 4,
    fetcher: async (url) => {
      const query = new URL(url).searchParams.get("q");
      return response({
        results: query === queryPlan[0].query ? [hit("known.example")] : [],
      });
    },
  });

  const result = await runWithPlan(run, queryPlan);

  assert.equal(result.queried_count, 14);
  assert.equal(result.skipped_query_count, 4);
  assert.equal(result.stop_reason, "marginal_novelty_exhausted");
});

test("same-domain result volume does not masquerade as marginal novelty", async () => {
  const queryPlan = plan(18);
  const run = search({
    maxQueries: 6,
    expansionTrancheSize: 4,
    maxResultsPerOrigin: 2,
    fetcher: async (url) => {
      const index = new URL(url).searchParams.get("q").split(" ").at(-1);
      return response({ results: [hit("duplicate.example", `events-${index}`)] });
    },
  });

  const result = await runWithPlan(run, queryPlan);

  assert.equal(result.novel_source_identity_count, 1);
  assert.equal(result.seeds.length, 2);
  assert.equal(result.stop_reason, "marginal_novelty_exhausted");
});

test("broad provider degradation without novelty stops further expansion", async () => {
  const queryPlan = plan(18);
  const run = search({
    maxQueries: 6,
    expansionTrancheSize: 4,
    fetcher: async (url) => {
      const index = Number(new URL(url).searchParams.get("q").split(" ").at(-1));
      if (index === 1) return response({ results: [hit("initial.example")] });
      if (index >= 7 && index <= 9) {
        return response({ results: [], unresponsive_engines: [["engine", "timeout"]] });
      }
      return response({ results: [] });
    },
  });

  const result = await runWithPlan(run, queryPlan);

  assert.equal(result.queried_count, 10);
  assert.equal(result.stop_reason, "provider_health_degraded");
  assert.equal(result.skipped_query_count, 8);
});

test("partial provider responses retain novel evidence and permit bounded expansion", async () => {
  const queryPlan = plan(10);
  const run = search({
    maxQueries: 6,
    expansionTrancheSize: 4,
    fetcher: async (url) => {
      const index = Number(new URL(url).searchParams.get("q").split(" ").at(-1));
      return response({
        results: [hit(`partial-${index}.example`)],
        unresponsive_engines: [["engine", "timeout"]],
      });
    },
  });

  const result = await runWithPlan(run, queryPlan);

  assert.equal(result.status, "partial");
  assert.equal(result.queried_count, 10);
  assert.equal(result.seed_count, 10);
  assert.equal(result.stop_reason, "query_space_exhausted");
});

test("the hard ceiling bounds a pathological productive query universe", async () => {
  const queryPlan = plan(40);
  const run = search({
    maxQueries: 10,
    hardQueryLimit: 24,
    expansionTrancheSize: 4,
    maxSeeds: 30,
    fetcher: async (url) => {
      const index = new URL(url).searchParams.get("q").split(" ").at(-1);
      return response({ results: [hit(`source-${index}.example`)] });
    },
  });

  const result = await runWithPlan(run, queryPlan);

  assert.equal(result.queried_count, 24);
  assert.equal(result.skipped_query_count, 16);
  assert.equal(result.stop_reason, "hard_safety_ceiling");
});

test("a normal small query set remains one simple bounded tranche", async () => {
  const queryPlan = plan(3);
  let calls = 0;
  const run = search({
    fetcher: async () => {
      calls += 1;
      return response({ results: [] });
    },
  });

  const result = await runWithPlan(run, queryPlan);

  assert.equal(calls, 3);
  assert.equal(result.expansion_round_count, 0);
  assert.equal(result.stop_reason, "query_space_exhausted");
});

test("adaptive breadth contains no place, publisher or search-engine branches", () => {
  const source = [
    "../server/pulse-sources/source-search-provider",
    "../server/pulse-sources/local-event-source-scout",
  ].map((path) => fs.readFileSync(require.resolve(path), "utf8")).join("\n");

  assert.doesNotMatch(source, /\b(?:stockholm|malm[oö]|prague|praha|helsinki|felanitx)\b/i);
  assert.doesNotMatch(source, /"(?:google|bing|qwant|duckduckgo)"/i);
});
