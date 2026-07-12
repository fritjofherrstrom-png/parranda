/**
 * Background-warm event supply — the live municipal feed is slow + high-variance,
 * so the default supply must NEVER block the route on it: a cold covered anchor
 * returns honest `pending` immediately and warms out-of-band; an uncovered anchor
 * returns absence immediately.
 */

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  resolveDefaultEventSupply,
  eventCacheKey,
  HELSINKI_LINKED_EVENTS_FEED,
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
