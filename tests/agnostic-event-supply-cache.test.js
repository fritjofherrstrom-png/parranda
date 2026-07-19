/**
 * Background-warm event supply — the live municipal feed is slow + high-variance,
 * so the default supply must NEVER block the route on it: a cold covered anchor
 * returns honest `pending` immediately and warms out-of-band; an uncovered anchor
 * returns absence immediately.
 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  resolveDefaultEventSupply,
  eventCacheKey,
  HELSINKI_LINKED_EVENTS_FEED,
  shouldCacheEventSupplyResult,
} = require("../server/place-candidates/agnostic-event-supply");

const ORIGINAL_FETCH = global.fetch;

// Coverage is opt-in — the product default has no baked-in city. A deployment
// configures its region's open feed via env; here the Helsinki fixture stands in.
const FEEDS_ENV = JSON.stringify([HELSINKI_LINKED_EVENTS_FEED]);

test("default supply is null unless env-enabled, a function when enabled", () => {
  assert.equal(resolveDefaultEventSupply({}), null);
  assert.equal(typeof resolveDefaultEventSupply({ PARRANDA_AGNOSTIC_EVENTS: "enabled" }), "function");
});

test("a cold covered anchor returns pending immediately — does not await the slow feed", async () => {
  // The supply must return WITHOUT awaiting the fetch result (warm is fire-and-forget).
  let fetched = false;
  global.fetch = async () => {
    fetched = true;
    throw new Error("feed slow/unreachable");
  };
  try {
    const supply = resolveDefaultEventSupply({ PARRANDA_AGNOSTIC_EVENTS: "enabled", PARRANDA_EVENT_FEEDS: FEEDS_ENV });
    const out = await supply({ anchor: { lat: 60.17, lng: 24.94 }, now: "2026-06-28T18:00:00Z" });
    assert.equal(out.coverage, "covered");
    assert.equal(out.pending, true, "honest pending, not a fabricated empty");
    assert.equal(out.acquisition.source_health.status, "pending");
    assert.equal(out.acquisition.source_health.result, "pending");
    assert.deepEqual(out.tonight, []);
    assert.ok(out.feed && out.feed.id, "feed identified for the covered anchor");
  } finally {
    global.fetch = ORIGINAL_FETCH;
  }
  // The warm was kicked (fire-and-forget) — the result was not awaited by the route.
  assert.equal(fetched, true);
});

test("an uncovered anchor returns honest absence immediately (no warm, no pending)", async () => {
  const supply = resolveDefaultEventSupply({ PARRANDA_AGNOSTIC_EVENTS: "enabled" });
  const out = await supply({ anchor: { lat: 41.9, lng: 12.5 }, now: "2026-06-28T18:00:00Z" });
  assert.equal(out.coverage, "uncovered");
  assert.equal(out.acquisition.source_health.status, "uncovered");
  assert.ok(!out.pending);
  assert.deepEqual(out.tonight, []);
});

test("eventCacheKey is deterministic and buckets by ~1 km + hour", () => {
  const k1 = eventCacheKey({ lat: 60.1699, lng: 24.9384 }, "2026-06-28T18:30:00Z");
  const k2 = eventCacheKey({ lat: 60.1701, lng: 24.9388 }, "2026-06-28T18:55:00Z");
  assert.equal(k1, k2, "nearby anchor + same hour → same key (cache reuse)");
  const k3 = eventCacheKey({ lat: 60.1699, lng: 24.9384 }, "2026-06-28T19:30:00Z");
  assert.notEqual(k1, k3, "a different hour → different key (freshness)");
});

test("eventCacheKey separates different approved source plans", () => {
  const anchor = { lat: 60.1699, lng: 24.9384 };
  const now = "2026-06-28T18:30:00Z";
  const localOnly = eventCacheKey(anchor, now, ["municipal-local"]);
  const localAndGlobal = eventCacheKey(anchor, now, ["municipal-local", "ticketmaster-global"]);
  const samePlanDifferentInputOrder = eventCacheKey(anchor, now, ["ticketmaster-global", "municipal-local"]);

  assert.notEqual(localOnly, localAndGlobal, "adding an approved source invalidates the old cache entry");
  assert.equal(
    localAndGlobal,
    samePlanDifferentInputOrder,
    "source-plan identity is stable regardless of caller ordering",
  );
});

test("event supply cache keeps healthy empties but retries partial empty acquisition", () => {
  const result = (status, outcome) => ({
    coverage: "covered",
    acquisition: { source_health: { status, result: outcome } },
  });

  assert.equal(
    shouldCacheEventSupplyResult(result("healthy", "empty")),
    true,
    "a responding calendar with no current events is a proven cacheable empty",
  );
  assert.equal(
    shouldCacheEventSupplyResult(result("partial", "empty")),
    false,
    "an empty result with a failed source remains retryable",
  );
  assert.equal(
    shouldCacheEventSupplyResult(result("unavailable", "unknown")),
    false,
    "an unavailable source result is never frozen into the event cache",
  );
});

test("event supply cache may serve bounded events despite another source failing", () => {
  assert.equal(
    shouldCacheEventSupplyResult({
      coverage: "covered",
      acquisition: { source_health: { status: "partial", result: "events_found" } },
    }),
    true,
    "real surfaced events remain useful while source health stays visibly partial",
  );
  assert.equal(shouldCacheEventSupplyResult({ coverage: "covered" }), false);
  assert.equal(shouldCacheEventSupplyResult({ coverage: "uncovered" }), false);
});

test("one neutral warm cache reranks for different preferences without refetching", async () => {
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), "parranda-event-preferences-"));
  let fetchCount = 0;
  const event = (id, title, keyword) => ({
    id,
    name: { en: title },
    start_time: "2026-06-28T18:00:00Z",
    end_time: "2026-06-28T20:00:00Z",
    location: { position: { coordinates: [24.94, 60.17] }, name: { en: `Venue ${id}` } },
    info_url: { en: `https://example.org/${id}` },
    data_source: "fixture",
    keywords: [{ name: { en: keyword } }],
  });
  global.fetch = async () => {
    fetchCount += 1;
    return {
      ok: true,
      json: async () => ({
        data: [
          event("a-concert", "Jazz concert", "music"),
          event("z-loppis", "Harbour loppis", "second hand"),
        ],
      }),
    };
  };

  try {
    const supply = resolveDefaultEventSupply({
      PARRANDA_AGNOSTIC_EVENTS: "enabled",
      PARRANDA_EVENT_FEEDS: FEEDS_ENV,
      PARRANDA_CACHE_DIR: cacheDir,
    });
    const request = { anchor: { lat: 60.17, lng: 24.94 }, now: "2026-06-28T12:00:00Z" };
    const cold = await supply({ ...request, preferences: ["culture"] });
    assert.equal(cold.pending, true);
    let culture = cold;
    for (let attempt = 0; attempt < 50 && culture.pending; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      culture = await supply({ ...request, preferences: ["culture"] });
    }
    assert.equal(culture.pending, undefined, "the bounded background warm completed");
    const secondHand = await supply({ ...request, preferences: ["second_hand"] });
    assert.equal(culture.tonight[0].id, "a-concert");
    assert.equal(secondHand.tonight[0].id, "z-loppis");
    assert.equal(fetchCount, 1, "preference changes rerank cached evidence instead of recollecting providers");
  } finally {
    global.fetch = ORIGINAL_FETCH;
    fs.rmSync(cacheDir, { recursive: true, force: true });
  }
});
