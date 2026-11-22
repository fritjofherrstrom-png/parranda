"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { collectAnchorEvents, resolveDefaultEventSupply, eventCacheKey } = require("../server/place-candidates/agnostic-event-supply");
const { createSourceCache } = require("../server/place-candidates/source-cache");
const { LIVE_COLLECTION_READ } = require("../server/planner/live-completion");
const REQUEST = { anchor: { lat: 59.3326, lng: 18.0649 }, now: "2026-10-24T08:00:00Z", selectedDate: "2026-10-25" };
const ENV = { PARRANDA_AGNOSTIC_EVENTS: "enabled", PARRANDA_TICKETMASTER_KEY: "fixture-only-key", PARRANDA_EVENT_READER: "disabled" };
const tick = () => new Promise(resolve => setImmediate(resolve));

function createHarness(dir, payload) {
  let calls = 0, clock = 0, completed;
  const completion = () => new Promise(resolve => { completed = resolve; });
  let done = completion();
  const supply = resolveDefaultEventSupply({ ...ENV, PARRANDA_CACHE_DIR: dir }, {
    eventReader: null, requestTimeDiscovery: null, failedRefreshClock: () => clock,
    collectEvents: async args => {
      try {
        return await collectAnchorEvents({ ...args, fetcher: async input => {
          calls++;
          const query = new URL(input).searchParams;
          assert.equal(query.get("size"), "40", "the existing one-page provider budget remains unchanged");
          return { ok: true, status: 200, json: async () => payload };
        } });
      } finally { completed(); }
    },
  });
  return { supply, calls: () => calls, done: async () => { await done; await tick(); },
    advance: value => { clock = value; }, next: () => { done = completion(); } };
}

function temporaryCache(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "parranda-ticketmaster-contract-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test("persisted pre-integrity event pools cannot bypass corrected Ticketmaster normalization", async t => {
  const dir = temporaryCache(t);
  const key = eventCacheKey(REQUEST.anchor, REQUEST.now, ["ticketmaster-global"], 3000, null, REQUEST.selectedDate);
  await createSourceCache({ namespace: "agnostic-events-v15", dir }).get(key, async () => ({
    coverage: "covered", selected_date: REQUEST.selectedDate, tonight: [], this_week: [],
    acquisition: { source_health: { status: "healthy", result: "empty" } },
  }));
  const h = createHarness(dir, { _embedded: { events: [] } });
  assert.equal((await h.supply(REQUEST)).pending, true, "old pools cannot attest the corrected coordinate/clock/occurrence contract");
  await h.done();
  assert.equal(h.calls(), 1);
  assert.ok(fs.existsSync(path.join(dir, "agnostic-events-v15")), "versioning never deletes or clears prior caches");
});

test("invalid Ticketmaster evidence is failure-held for exactly two minutes, never healthy-empty cached", async t => {
  const dir = temporaryCache(t);
  const h = createHarness(dir, { fault: {} });
  const first = await h.supply(REQUEST);
  assert.equal(first.pending, true);
  await h.done();
  const failed = first[LIVE_COLLECTION_READ]();
  assert.equal(failed.acquisition.source_health.status, "unavailable");
  assert.equal(failed.acquisition.source_health.result, "unknown");
  assert.equal(failed.feeds[0].reason, "source_payload_invalid");
  for (const clock of [0, 119999]) {
    h.advance(clock);
    const held = await h.supply(REQUEST);
    assert.equal(held.pending, undefined);
    assert.equal(held.acquisition.source_health.result, "unknown");
    assert.equal(h.calls(), 1);
  }
  const namespace = path.join(dir, "agnostic-events-v25");
  const persisted = fs.existsSync(namespace) ? fs.readdirSync(namespace).filter(file => file.endsWith(".json")) : [];
  assert.deepEqual(persisted, [], "cache lookup may create its directory, but never persists failed evidence");
  h.advance(120000);
  h.next();
  assert.equal((await h.supply(REQUEST)).pending, true);
  await h.done();
  assert.equal(h.calls(), 2, "only the next explicit read after expiry refreshes the source");
  assert.deepEqual(first[LIVE_COLLECTION_READ](), failed, "a later generation cannot rewrite the original producer outcome");
});

test("healthy Ticketmaster empty pages retain the twenty-minute persistent cache and never serialize the key", async t => {
  const dir = temporaryCache(t);
  const before = Date.now();
  const h = createHarness(dir, { page: { totalElements: 0 } });
  const first = await h.supply(REQUEST);
  assert.equal(first.pending, true);
  await h.done();
  const after = Date.now();
  const settled = await h.supply(REQUEST);
  assert.equal(settled.acquisition.source_health.status, "healthy");
  assert.equal(settled.acquisition.source_health.result, "empty");
  assert.equal(h.calls(), 1);
  const namespace = path.join(dir, "agnostic-events-v25");
  const files = fs.readdirSync(namespace).filter(file => file.endsWith(".json"));
  assert.equal(files.length, 1);
  const serialized = fs.readFileSync(path.join(namespace, files[0]), "utf8");
  const record = JSON.parse(serialized);
  assert.ok(record.expiresAt >= before + 20 * 60 * 1000 && record.expiresAt <= after + 20 * 60 * 1000);
  assert.ok(!serialized.includes(ENV.PARRANDA_TICKETMASTER_KEY));
  assert.ok(!JSON.stringify(settled).includes(ENV.PARRANDA_TICKETMASTER_KEY));
  const restarted = createHarness(dir, { fault: {} });
  const restored = await restarted.supply(REQUEST);
  assert.equal(restored.pending, undefined);
  assert.equal(restored.acquisition.source_health.result, "empty");
  assert.equal(restarted.calls(), 0, "fresh persistent evidence avoids another provider request");
});
