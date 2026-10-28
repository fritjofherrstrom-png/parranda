"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { collectAnchorEvents } = require("../server/place-candidates/agnostic-event-supply");
const { datatourismeFeedForContext } = require("../server/pulse-sources/datatourisme-event-provider");
const ANCHOR = { lat: 48.5, lng: 2.5 }, NOW = "2026-10-28T12:00:00Z";
const CONTEXT = { country_code: "fr", locality: "Fixture district" };
const locals = Array.from({ length: 3 }, (_, index) => ({ id: `local-${index}`, label: `Fixture calendar ${index}`,
  base: `https://calendar-${index}.example/events/`, bbox: [2, 48, 3, 49], priority: 100 + index }));
function transport(calls) {
  return async url => {
    const host = new URL(url).hostname;
    calls.push(host);
    if (host === "app.ticketmaster.com") return new Response(JSON.stringify({ page: { totalElements: 0 } }));
    if (host === "openholidaysapi.org") return new Response(JSON.stringify(url.endsWith("/Countries")
      ? [{ isoCode: "FR", officialLanguages: ["FR"], name: [{ language: "FR", text: "Fixture country" }] }] : []));
    assert.ok(/^calendar-[0-2]\.example$/.test(host), "an unavailable prerequisite must not make a source request");
    return new Response(JSON.stringify({ data: [] }));
  };
}

test("missing adapter credentials do not consume a source slot or disappear as healthy empty", async () => {
  const unavailable = datatourismeFeedForContext({ anchor: ANCHOR, placeContext: CONTEXT });
  const calls = [];
  const out = await collectAnchorEvents({ anchor: ANCHOR, now: NOW, selectedDate: "2026-10-28",
    registry: [unavailable, ...locals], globalKey: "synthetic-global-key", fetcher: transport(calls) });
  assert.deepEqual(out.feeds.map(feed => feed.id).sort(), [...locals.map(feed => feed.id), "ticketmaster-global"].sort(),
    "collectable calendars retain the existing three local plus one global slots");
  assert.equal(out.acquisition.selected_source_count, 4);
  assert.equal(out.acquisition.source_cap, 4);
  assert.equal(out.acquisition.source_health.responding_source_count, 4);
  assert.equal(out.acquisition.source_health.unavailable_source_count, 0, "selected-source counters exclude unattempted candidates");
  const readiness = out.acquisition.runtime_readiness;
  assert.equal(readiness.unavailable_candidate_count, 1);
  assert.equal(readiness.unavailable_sources[0].id, unavailable.id);
  assert.equal(readiness.unavailable_sources[0].reason, "source_credentials_unavailable");
  assert.equal(out.acquisition.source_health.status, "partial", "missing configuration is still disclosed");
  assert.equal(out.acquisition.source_health.result, "unknown", "not confirmed absence across the unavailable source");
  assert.equal(calls.length, 4, "no extra source attempts or retry loops");
});

test("an unavailable-only plan is explicit unknown without pending or a provider request", async () => {
  const source = { ...datatourismeFeedForContext({ anchor: ANCHOR, placeContext: CONTEXT }),
    runtime_ready: true, runtime_readiness: { status: "ready" } };
  const out = await collectAnchorEvents({ anchor: ANCHOR, now: NOW, registry: [source],
    fetcher: () => assert.fail("no acquisition without prerequisites") });
  assert.equal(out.pending, undefined);
  assert.equal(out.acquisition.selected_source_count, 0);
  assert.equal(out.acquisition.source_health.status, "unavailable");
  assert.equal(out.acquisition.source_health.result, "unknown");
  assert.equal(out.acquisition.runtime_readiness.unavailable_sources[0].attempted, false);
  assert.deepEqual(out.feeds, []);
});

test("a configured adapter retains its slot; unrelated outside-scope candidates add no warning", async () => {
  const source = datatourismeFeedForContext({ anchor: ANCHOR, placeContext: CONTEXT });
  let countryReads = 0;
  const out = await collectAnchorEvents({ anchor: ANCHOR, now: NOW, registry: [source, ...locals],
    datatourismeKey: "synthetic-adapter-key", fetcher: async url => {
      if (new URL(url).hostname === "api.datatourisme.fr") {
        countryReads++;
        return new Response(JSON.stringify({ objects: [], meta: { page: 1, total: 0, total_pages: 0 } }));
      }
      return new Response(JSON.stringify({ data: [] }));
    } });
  assert.equal(countryReads, 1);
  assert.equal(out.feeds[0].id, source.id);
  assert.equal(out.acquisition.runtime_readiness, undefined);
  const outside = await collectAnchorEvents({ anchor: ANCHOR, now: NOW,
    registry: [{ ...source, bbox: [100, 0, 101, 1] }, ...locals], fetcher: transport([]) });
  assert.equal(outside.acquisition.runtime_readiness, undefined);
  assert.equal(outside.acquisition.source_health.status, "healthy");
  assert.equal(outside.acquisition.source_health.result, "empty");
});

test("ordinary Live retains readiness through pending, completion and the failed-empty hold", async () => {
  const { resolveDefaultEventSupply } = require("../server/place-candidates/agnostic-event-supply");
  const { executeLiveEventQuery } = require("../server/place-candidates/live-event-query");
  const { createSourceCache } = require("../server/place-candidates/source-cache");
  const calls = [], work = [];
  const cache = createSourceCache({ namespace: "readiness-fixture", ttlMs: 60000 });
  let stored = 0;
  const suppliedCache = { peek: key => cache.peek(key), warm: (key, producer, options) => cache.warm(key, async () => {
    const value = await producer();
    if (options.shouldStore(value)) stored++;
    return value;
  }, options) };
  const supply = resolveDefaultEventSupply({ PARRANDA_AGNOSTIC_EVENTS: "enabled",
    PARRANDA_EVENT_FEEDS: JSON.stringify(locals), PARRANDA_TICKETMASTER_KEY: "synthetic-global-key" }, {
    eventCache: suppliedCache, requestTimeDiscovery: null,
    collectEvents: options => {
      const task = collectAnchorEvents({ ...options, fetcher: transport(calls) }); work.push(task); return task;
    },
  });
  const query = () => executeLiveEventQuery({ payload: { scope: "around_place", anchor: ANCHOR,
    place_query: "Fixture district", selected_date: "2026-10-28" }, now: NOW, eventSupply: supply,
    placeResolver: async () => [{ ...ANCHOR, label: "Fixture district", confidence: "medium", admin_context: CONTEXT }] });
  const first = (await query()).body.live_events;
  assert.equal(first.pending, true);
  assert.equal(first.acquisition.source_health.status, "pending");
  assert.equal(first.acquisition.runtime_readiness.unavailable_candidate_count, 1);
  await Promise.all(work); await new Promise(resolve => setImmediate(resolve));
  const response = await query(), live = response.body.live_events;
  assert.equal(live.pending, undefined);
  assert.equal(live.acquisition.source_health.status, "partial");
  assert.equal(live.acquisition.source_health.result, "unknown");
  assert.equal(live.acquisition.runtime_readiness.unavailable_sources[0].reason, "source_credentials_unavailable");
  assert.equal(stored, 0, "an unavailable source cannot mint a healthy-empty cache entry");
  assert.equal(response.body.route_mutation, false);
  assert.equal(response.body.day_anchor_mutation, false);
  await query();
  assert.equal(work.length, 1, "terminal absence stays held, not a new warm loop");
});

test("useful local facts survive the readiness warning, JSON cache and process-style restart", async t => {
  const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
  const { resolveDefaultEventSupply } = require("../server/place-candidates/agnostic-event-supply");
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "readiness-positive-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const tasks = []; let collections = 0;
  const configured = locals.map(row => ({ ...row, source_tier: "official", confidence: "medium", source_family: "municipal_open", fallback_timezone: "Europe/Paris" }));
  const env = { PARRANDA_AGNOSTIC_EVENTS: "enabled", PARRANDA_EVENT_FEEDS: JSON.stringify(configured), PARRANDA_CACHE_DIR: directory };
  const options = { requestTimeDiscovery: null, collectEvents: settings => {
    collections++;
    const task = collectAnchorEvents({ ...settings, fetcher: async url => {
      if (new URL(url).hostname === "calendar-0.example") return new Response(JSON.stringify({ data: [{ id: "fixture-concert",
        name: { en: "Fixture concert" }, start_time: "2026-10-28T18:00:00Z", end_time: "2026-10-28T20:00:00Z",
        location: { position: { coordinates: [ANCHOR.lng, ANCHOR.lat] }, name: { en: "Fixture hall" } },
        info_url: { en: "https://calendar-0.example/concert" }, data_source: "fixture", publisher: "Fixture publisher" }] }));
      return transport([])(url);
    } });
    tasks.push(task); return task;
  } };
  const input = { anchor: ANCHOR, now: NOW, selectedDate: "2026-10-28", placeContext: CONTEXT };
  const supply = resolveDefaultEventSupply(env, options);
  assert.equal((await supply(input)).pending, true);
  await Promise.all(tasks); await new Promise(resolve => setImmediate(resolve));
  const live = await supply(input);
  assert.equal(live.tonight.length, 1, JSON.stringify({ feeds: live.feeds, acquisition: live.acquisition }));
  assert.equal(live.acquisition.source_health.status, "partial");
  assert.equal(live.acquisition.source_health.result, "events_found");
  const restarted = await resolveDefaultEventSupply(env, options)(input);
  assert.deepEqual(restarted.tonight, live.tonight);
  assert.deepEqual(restarted.acquisition.runtime_readiness, live.acquisition.runtime_readiness);
  assert.equal(restarted.acquisition.source_health.result, "events_found");
  assert.equal(collections, 1);
});
