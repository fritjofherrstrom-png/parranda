/**
 * Persistent-capable source cache (Overpass / geocode) + loader integration.
 *
 * This cache is the prerequisite for turning the live open-data loader on in a
 * deploy without re-hitting Overpass on every request ("no public flip without
 * persistent caching"). Tests cover TTL, in-flight de-duplication, not caching
 * failures, file backing, and that the loader actually serves repeat/concurrent
 * lookups from the cache instead of the network. No live network — fetchers are
 * injected.
 */

const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { createSourceCache } = require("../server/place-candidates/source-cache");
const { createOpenDataLoader, resolveDefaultOpenDataLoader } = require("../server/place-candidates/open-data-loader");

function mutableClock(start = 1000) {
  const state = { t: start };
  const now = () => state.t;
  now.advance = (ms) => {
    state.t += ms;
  };
  return now;
}

// --- cache module ----------------------------------------------------------

test("a hit within TTL does not call the producer again", async () => {
  const cache = createSourceCache({ namespace: "t", ttlMs: 1000, now: mutableClock() });
  let calls = 0;
  const produce = async () => {
    calls += 1;
    return { n: calls };
  };
  assert.deepEqual(await cache.get("k", produce), { n: 1 });
  assert.deepEqual(await cache.get("k", produce), { n: 1 });
  assert.equal(calls, 1);
});

test("an expired entry re-produces", async () => {
  const now = mutableClock();
  const cache = createSourceCache({ namespace: "t", ttlMs: 1000, now });
  let calls = 0;
  const produce = async () => ({ n: (calls += 1) });
  await cache.get("k", produce);
  now.advance(1001);
  assert.deepEqual(await cache.get("k", produce), { n: 2 });
  assert.equal(calls, 2);
});

test("concurrent identical lookups coalesce onto one producer call", async () => {
  const cache = createSourceCache({ namespace: "t", ttlMs: 1000, now: mutableClock() });
  let calls = 0;
  const produce = async () => {
    calls += 1;
    await new Promise((r) => setTimeout(r, 10));
    return { n: calls };
  };
  const [a, b] = await Promise.all([cache.get("k", produce), cache.get("k", produce)]);
  assert.deepEqual(a, { n: 1 });
  assert.deepEqual(b, { n: 1 });
  assert.equal(calls, 1);
});

test("shouldStore=false values are never cached (transient errors re-produce)", async () => {
  const cache = createSourceCache({ namespace: "t", ttlMs: 1000, now: mutableClock() });
  let calls = 0;
  const produce = async () => ({ ok: false, n: (calls += 1) });
  await cache.get("k", produce, { shouldStore: (v) => v.ok === true });
  await cache.get("k", produce, { shouldStore: (v) => v.ok === true });
  assert.equal(calls, 2);
});

test("file backing persists a value across separate cache instances", async () => {
  const dir = path.join(os.tmpdir(), "parranda-source-cache-test", String(process.pid));
  fs.rmSync(dir, { recursive: true, force: true });
  try {
    const first = createSourceCache({ namespace: "geo", ttlMs: 60000, dir, now: mutableClock() });
    let calls = 0;
    await first.get("place-x", async () => ({ n: (calls += 1) }));
    assert.equal(calls, 1);
    assert.equal(first.fileBacked, true);

    // A fresh instance (cold memory) must read the value off disk, not re-produce.
    const second = createSourceCache({ namespace: "geo", ttlMs: 60000, dir, now: mutableClock() });
    let secondCalls = 0;
    const value = await second.get("place-x", async () => ({ n: (secondCalls += 1) }));
    assert.deepEqual(value, { n: 1 });
    assert.equal(secondCalls, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// --- loader integration ----------------------------------------------------

function viewpointPayload() {
  return {
    ok: true,
    json: async () => ({
      elements: [{ type: "node", id: 42, lat: 41.9, lon: 12.5, tags: { name: "V", tourism: "viewpoint", wikidata: "Q1" } }],
    }),
  };
}

test("a cached loader serves a repeat lookup for the same anchor without re-hitting Overpass", async () => {
  let calls = 0;
  const fetcher = async () => {
    calls += 1;
    return viewpointPayload();
  };
  const cache = createSourceCache({ namespace: "overpass", ttlMs: 60000, now: mutableClock() });
  const loader = createOpenDataLoader({ fetcher, cache });

  const first = await loader({ lat: 41.9, lng: 12.5 });
  // ~110 m away → same bucketed key → served from cache.
  const second = await loader({ lat: 41.9001, lng: 12.5001 });

  assert.equal(calls, 1, "second lookup must come from cache");
  assert.equal(first.loader_status, "loaded:1");
  assert.equal(second.loader_status, "loaded:1");
  assert.equal(second.length, 1);
  assert.equal(second[0].type, "viewpoint");
});

test("concurrent loader lookups for the same anchor coalesce to one Overpass call", async () => {
  let calls = 0;
  const fetcher = async () => {
    calls += 1;
    await new Promise((r) => setTimeout(r, 10));
    return viewpointPayload();
  };
  const loader = createOpenDataLoader({ fetcher, cache: createSourceCache({ namespace: "overpass", ttlMs: 60000, now: mutableClock() }) });
  await Promise.all([loader({ lat: 41.9, lng: 12.5 }), loader({ lat: 41.9, lng: 12.5 })]);
  assert.equal(calls, 1);
});

test("a failed Overpass response is not cached (the next lookup retries)", async () => {
  let calls = 0;
  const fetcher = async () => {
    calls += 1;
    return { ok: false, status: 429 };
  };
  const loader = createOpenDataLoader({ fetcher, cache: createSourceCache({ namespace: "overpass", ttlMs: 60000, now: mutableClock() }) });
  const first = await loader({ lat: 1, lng: 1 });
  const second = await loader({ lat: 1, lng: 1 });
  assert.equal(first.loader_status, "error_failed_closed");
  assert.equal(calls, 2, "an error must not be frozen into the cache");
});

test("an uncached loader (no cache option) is byte-for-byte the prior behavior", async () => {
  let calls = 0;
  const fetcher = async () => {
    calls += 1;
    return viewpointPayload();
  };
  const loader = createOpenDataLoader({ fetcher }); // no cache
  await loader({ lat: 41.9, lng: 12.5 });
  await loader({ lat: 41.9, lng: 12.5 });
  assert.equal(calls, 2, "without a cache every lookup hits the fetcher, exactly as before");
});

// --- deploy wiring ---------------------------------------------------------

test("resolveDefaultOpenDataLoader stays null when the flag is unset, and returns a loader when enabled", () => {
  assert.equal(resolveDefaultOpenDataLoader({}), null);
  assert.equal(resolveDefaultOpenDataLoader({ PARRANDA_OPEN_DATA_LOADER: "enabled" }) === null, false);
  assert.equal(typeof resolveDefaultOpenDataLoader({ PARRANDA_OPEN_DATA_LOADER: "enabled" }), "function");
});
