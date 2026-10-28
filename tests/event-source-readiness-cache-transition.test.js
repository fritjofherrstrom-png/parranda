"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const { createHash } = require("node:crypto");
const { eventCacheKey, collectAnchorEvents, resolveDefaultEventSupply } = require("../server/place-candidates/agnostic-event-supply");
const { spatialScopeCacheKey } = require("../server/place-candidates/spatial-scope");
const { createSourceCache } = require("../server/place-candidates/source-cache");
const ANCHOR = { lat: 48.5, lng: 2.5 }, NOW = "2026-10-28T12:00:00Z", DATE = "2026-10-28";
const FEED = { id: "fixture-local", label: "Fixture calendar", base: "https://fixture.example/events/", bbox: [2, 48, 3, 49] };
function legacyKey() {
  return createHash("sha256").update(JSON.stringify(["48.50000", "2.50000", NOW.slice(0, 13), 3000,
    spatialScopeCacheKey(null), FEED.id, DATE, "tonight"])).digest("hex");
}
const args = { anchor: ANCHOR, now: NOW, selectedDate: DATE };
const env = { PARRANDA_AGNOSTIC_EVENTS: "enabled", PARRANDA_EVENT_FEEDS: JSON.stringify([FEED]) };
const empty = options => collectAnchorEvents({ ...options, fetcher: async () => new Response('{"data":[]}') });

test("operator-supplied caches use a semantic policy key, not an unversioned v23 key", async () => {
  const key = eventCacheKey(ANCHOR, NOW, [FEED.id], 3000, null, DATE);
  assert.notEqual(key, legacyKey(), "v23 cannot attest runtime readiness and nullable source contracts");
  const requested = [], tasks = [];
  const supply = resolveDefaultEventSupply(env, { requestTimeDiscovery: null,
    eventCache: { peek: request => { requested.push(request); return null; }, warm: (request, producer) => {
      requested.push(request); const task = producer(); tasks.push(task); return task;
    } }, collectEvents: empty });
  assert.equal((await supply(args)).pending, true);
  await Promise.all(tasks);
  assert.ok(requested.every(value => value !== legacyKey()));
});

test("new default namespace survives restart while legacy v23 files stay byte-identical", async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "event-readiness-cache-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const legacy = createSourceCache({ namespace: "agnostic-events-v23", dir: directory, ttlMs: 60000 });
  await legacy.get(legacyKey(), async () => ({ legacy_policy: true }));
  const legacyFile = path.join(directory, "agnostic-events-v23", `${legacyKey()}.json`);
  const bytes = fs.readFileSync(legacyFile, "utf8");
  const tasks = []; let collections = 0;
  const options = { requestTimeDiscovery: null, collectEvents: settings => {
    collections++; const task = empty(settings); tasks.push(task); return task;
  } };
  const supply = resolveDefaultEventSupply({ ...env, PARRANDA_CACHE_DIR: directory }, options);
  assert.equal((await supply(args)).pending, true);
  await Promise.all(tasks); await new Promise(resolve => setImmediate(resolve));
  const settled = await supply(args);
  assert.equal(settled.acquisition.source_health.status, "healthy");
  assert.ok(fs.existsSync(path.join(directory, "agnostic-events-v24")), "persist the new acquisition contract separately");
  const restarted = resolveDefaultEventSupply({ ...env, PARRANDA_CACHE_DIR: directory }, options);
  assert.equal((await restarted(args)).pending, undefined);
  assert.equal(collections, 1, "current-policy healthy empty is reused after restart");
  assert.equal(fs.readFileSync(legacyFile, "utf8"), bytes);
});

test("catalogue removal and restoration isolate readiness with unchanged facts and bounded reacquisition", async t => {
  const { datatourismeFeedForContext } = require("../server/pulse-sources/datatourisme-event-provider");
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "readiness-catalog-context-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const locals = Array.from({ length: 3 }, (_, index) => ({ ...FEED, id: `local-${index}`,
    base: `https://calendar-${index}.example/events/`, priority: 100 + index,
    source_tier: "official", confidence: "medium", source_family: "municipal_open", fallback_timezone: "Europe/Paris" }));
  const unavailable = datatourismeFeedForContext({ anchor: ANCHOR, placeContext: { country_code: "fr" } });
  let offered = true, collections = 0, sourceRequests = 0;
  const tasks = [];
  const fetcher = async url => {
    const host = new URL(url).hostname;
    assert.match(host, /^calendar-[0-2]\.example$/);
    sourceRequests++;
    return new Response(JSON.stringify({ data: host === "calendar-0.example" ? [{ id: "fixture-concert",
      name: { en: "Fixture concert" }, start_time: "2026-10-28T18:00:00Z", end_time: "2026-10-28T20:00:00Z",
      location: { position: { coordinates: [ANCHOR.lng, ANCHOR.lat] }, name: { en: "Fixture hall" } },
      info_url: { en: "https://calendar-0.example/concert" }, data_source: "fixture", publisher: "Fixture publisher" }] : [] }));
  };
  const options = { requestTimeDiscovery: null,
    sourceCatalog: { listApprovedEventFeedsForAnchor: async () => offered ? [unavailable] : [] },
    collectEvents: settings => { collections++; const task = collectAnchorEvents({ ...settings, fetcher }); tasks.push(task); return task; } };
  const runtime = { ...env, PARRANDA_EVENT_FEEDS: JSON.stringify(locals), PARRANDA_CACHE_DIR: directory };
  const supply = resolveDefaultEventSupply(runtime, options);
  assert.equal((await supply(args)).pending, true);
  await Promise.all(tasks); await new Promise(resolve => setImmediate(resolve));
  const before = await supply(args);
  assert.equal(before.tonight.length, 1);
  assert.equal(before.acquisition.source_health.status, "partial");
  assert.equal(before.acquisition.runtime_readiness.unavailable_candidate_count, 1);
  const initialRequests = sourceRequests;
  const initialFiles = fs.readdirSync(path.join(directory, "agnostic-events-v24"));
  const originalBytes = fs.readFileSync(path.join(directory, "agnostic-events-v24", initialFiles[0]), "utf8");
  offered = false;
  const next = await supply(args);
  assert.equal(next.pending, true, "changed preflight context must not reuse the old credential-warning answer");
  assert.equal(next.acquisition.runtime_readiness, undefined);
  await Promise.all(tasks); await new Promise(resolve => setImmediate(resolve));
  const removed = await supply(args);
  const restarted = await resolveDefaultEventSupply(runtime, options)(args);
  for (const actual of [removed, restarted]) {
    assert.deepEqual(actual.tonight, before.tonight, "same source facts and selected sources");
    assert.deepEqual(actual.feeds.map(feed => feed.id), before.feeds.map(feed => feed.id));
    assert.equal(actual.acquisition.source_health.status, "healthy");
    assert.equal(actual.acquisition.source_health.result, "events_found");
    assert.equal(actual.acquisition.runtime_readiness, undefined);
    assert.equal(actual.acquisition.source_health.unavailable_candidate_count, undefined);
    assert.ok(!actual.acquisition.source_health.reasons.includes("source_credentials_unavailable"));
  }
  assert.equal(collections, 2);
  assert.equal(sourceRequests, initialRequests * 2, "one bounded collection per changed context; no extra retries");
  assert.equal(fs.readFileSync(path.join(directory, "agnostic-events-v24", initialFiles[0]), "utf8"), originalBytes);
  offered = true;
  const restored = await supply(args);
  assert.equal(restored.pending, undefined);
  assert.equal(restored.acquisition.runtime_readiness.unavailable_candidate_count, 1);
  assert.equal(restored.acquisition.source_health.status, "partial");
  assert.equal(collections, 2, "returning to the original preflight context reuses its own cached answer");
});
