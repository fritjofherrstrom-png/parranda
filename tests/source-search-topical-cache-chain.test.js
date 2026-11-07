"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const { createHash } = require("node:crypto");
const { createRequestTimeEventDiscovery } = require("../server/pulse-sources/request-time-event-discovery");
const { resolveDefaultEventSupply } = require("../server/place-candidates/agnostic-event-supply");
const { deriveLocalAnchorSpatialScope, spatialScopeCacheKey } = require("../server/place-candidates/spatial-scope");

const ANCHOR = { lat: 48.5, lng: 2.5 };
const CONTEXT = { locality: "Riveclaire", country_code: "fr" };
const LABEL = "Riveclaire, France";
const SCOPE = { source: "resolver_bounds", kind: "settlement", bounds: { south: 48.49, north: 48.51, west: 2.49, east: 2.51 } };

function scouted() {
  const id = "current-programme";
  const url = "https://programme.example/calendar.ics";
  return {
    results: [{ candidates: [{ id, url, adapter: "ical", source_identity: "programme.example", status: "viable_provider_probe", maps_to_existing_provider: true, family: "venue_calendar" }] }],
    manifest_candidates: [{ id, endpoint: url, adapter: "ical", source_identity: "programme.example", bbox: [2.49, 48.49, 2.51, 48.51], label: "Current programme", review: { robots_status: "allowed", terms_status: "unknown" } }],
  };
}

function foundCache(values) {
  return {
    get: async (key, producer, options) => {
      if (values.has(key)) return values.get(key);
      const value = await producer();
      if (options.shouldStore(value)) values.set(key, value);
      return value;
    },
  };
}

for (const revision of [9, 10]) test(`found-source cache v${revision} cannot bypass current publisher diversity`, async () => {
  const bucket = createHash("sha256").update(`${Math.round(ANCHOR.lat * 100)}:${Math.round(ANCHOR.lng * 100)}`).digest("hex").slice(0, 16);
  const key = `rt-discovery-v${revision}:${bucket}`;
  const legacy = { status: "found", reason: null, feeds: [{ id: "legacy-prefix" }] };
  const bytes = JSON.stringify(legacy);
  const values = new Map([[key, legacy]]);
  let searches = 0;
  const discover = createRequestTimeEventDiscovery({
    cache: foundCache(values),
    sourceSearch: async () => { searches++; return { status: "complete", seeds: [{ url: "https://programme.example/" }] }; },
    scout: async () => scouted(),
    timezoneForPoint: () => "Europe/Paris",
  });
  const input = { anchor: ANCHOR, placeLabel: LABEL, placeContext: CONTEXT };
  const current = await discover(input);
  assert.deepEqual(current.feeds.map(feed => feed.id), ["current-programme"], "legacy found source list cannot attest current topical discovery");
  assert.equal(searches, 1);
  assert.deepEqual(await discover(input), current);
  assert.equal(searches, 1, "current version remains reusable");
  assert.equal(JSON.stringify(values.get(key)), bytes);
});

for (const policy of [null, "event-topic-prefix-v1"]) test(`derived Live pool from ${policy || "unranked discovery"} cannot bypass the new selection`, async () => {
  const scope = deriveLocalAnchorSpatialScope(SCOPE, ANCHOR);
  assert.ok(scope, "valid resolver-owned fixture scope");
  const oldSuffix = createHash("sha256").update(JSON.stringify([
    ...(policy ? [policy] : []), LABEL, CONTEXT, spatialScopeCacheKey(scope),
  ])).digest("hex").slice(0, 20);
  const legacy = { coverage: "covered", tonight: [], this_week: [], acquisition: { source_health: { status: "healthy", result: "empty" } } };
  const legacyBytes = JSON.stringify(legacy);
  const values = new Map();
  let pending;
  let searches = 0;
  let collections = 0;
  const supply = resolveDefaultEventSupply({ PARRANDA_AGNOSTIC_EVENTS: "enabled", PARRANDA_EVENT_READER: "disabled" }, {
    requestTimeDiscovery: async () => { searches++; return { status: "empty", reason: "no_search_results", feeds: [] }; },
    eventCache: {
      peek: key => values.get(key) || (key.endsWith(`:discovery:${oldSuffix}`) ? legacy : null),
      warm: (key, factory) => { pending = Promise.resolve().then(factory).then(value => { values.set(key, value); return value; }); return pending; },
    },
    collectEvents: async () => { collections++; return { coverage: "covered", tonight: [], this_week: [], acquisition: { source_health: { status: "healthy", result: "empty" } } }; },
  });
  const input = { anchor: ANCHOR, placeLabel: LABEL, placeContext: CONTEXT, discoverySpatialScope: SCOPE, now: "2026-11-06T12:00:00Z", selectedDate: "2026-11-06" };
  const first = await supply(input);
  assert.equal(first.pending, true, "old derived event pool must not short-circuit new source discovery");
  await pending;
  const current = await supply(input);
  assert.equal(current.pending, undefined);
  assert.equal(current.acquisition.request_time_discovery.status, "empty");
  assert.equal(searches, 1);
  assert.equal(collections, 1);
  assert.ok([...values.keys()].every(key => !key.endsWith(`:discovery:${oldSuffix}`)));
  assert.equal(JSON.stringify(legacy), legacyBytes);
});
