"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createOpenDataLoader, mapOsmElement } = require("../server/place-candidates/open-data-loader");
const { createOsmMarketEventProvider } = require("../server/pulse-sources/osm-market-event-provider");
const { normalizeProviderCollectionOutcome } = require("../server/pulse-sources/provider-collection-outcome");
const { collectAnchorEvents, resolveDefaultEventSupply } = require("../server/place-candidates/agnostic-event-supply");
const { createSourceCache } = require("../server/place-candidates/source-cache");
const { executeLiveEventQuery } = require("../server/place-candidates/live-event-query");
const { osmMarketFeedForAnchor } = require("../server/pulse-sources/osm-market-event-provider");

const ANCHOR = { lat: 48.1173, lng: -1.6778 };
const DATE = "2026-07-20";

function recordsWithOutcome(error, { stale = false, records = [], status = "error_failed_closed" } = {}) {
  return Object.assign(records, {
    loader_status: status,
    loader_error: error,
    loader_metadata: { cache: { served_stale: stale } },
  });
}

async function collectLoaderOutcome(loader) {
  return createOsmMarketEventProvider({ anchor: ANCHOR, loader }).create().collect({ date: DATE });
}

const KNOWN_FAILURES = [
  ["http_non_200", "source_http_not_ok"],
  ["provider_slot_busy", "source_capacity_unavailable"],
  ["provider_rate_limited", "source_provider_backoff"],
  ["provider_rejected_client", "source_provider_rejected"],
  ["provider_unavailable", "source_provider_unavailable"],
  ["provider_unreachable", "source_provider_unreachable"],
  ["provider_timed_out", "source_provider_timeout_hold"],
  ["parse_error", "source_payload_invalid"],
  ["fetch_error", "source_fetch_failed"],
  ["no_endpoint", "source_endpoint_unavailable"],
  ["stale_cache_refresh_failed", "source_stale_unavailable"],
];

for (const [underlying, expected] of KNOWN_FAILURES) {
  test(`OSM Live preserves the closed ${underlying} category through outcome normalization`, async () => {
    let reads = 0;
    const collected = await collectLoaderOutcome(async () => {
      reads++;
      return recordsWithOutcome(underlying);
    });
    assert.equal(collected.collection_status.status, "failed");
    assert.equal(collected.collection_status.reason, expected);
    assert.equal(reads, 1, "reason projection never re-acquires the source");
    assert.deepEqual(collected.time_sensitive_events, []);
    assert.deepEqual(normalizeProviderCollectionOutcome(JSON.parse(JSON.stringify(collected.collection_status))), collected.collection_status,
      "public/cache outcome normalization must retain the closed reason, without raw loader text");
  });
}

test("a stale marker alone remains a failed fresh observation, not successful empty", async () => {
  const collected = await collectLoaderOutcome(async () => recordsWithOutcome(null, { stale: true, status: "loaded:0" }));
  assert.equal(collected.collection_status.status, "failed");
  assert.equal(collected.collection_status.reason, "source_stale_unavailable");
  assert.deepEqual(collected.time_sensitive_events, []);
});

test("genuine successful empty remains empty and unknown errors never become public diagnostics", async () => {
  const empty = await collectLoaderOutcome(async () => recordsWithOutcome(null, { status: "loaded:0" }));
  assert.equal(empty.collection_status.status, "empty");
  assert.equal(empty.collection_status.reason, "source_empty");
  for (const error of ["constructor", "__proto__", "provider_rate_limited?token=PRIVATE_FIXTURE_SECRET", "https://user:PRIVATE_FIXTURE_SECRET@invalid.test/"]) {
    const failed = await collectLoaderOutcome(async () => recordsWithOutcome(error));
    assert.equal(failed.collection_status.reason, "source_collect_failed");
    assert.ok(!JSON.stringify(failed).includes("PRIVATE_FIXTURE_SECRET"));
  }
});


test("a mapper exception stays distinct from loader acquisition failure without exposing its message", async () => {
  const market = mapOsmElement({ type: "node", id: 42, lat: ANCHOR.lat, lon: ANCHOR.lng,
    tags: { name: "Weekly fixture market", amenity: "marketplace", opening_hours: "Mo,Th 09:00-13:00" } });
  assert.equal(market.osm_marketplace, true, "precondition: a real mapped eligible market reaches the schedule mapper");
  const collected = await createOsmMarketEventProvider({
    anchor: ANCHOR,
    loader: async () => recordsWithOutcome(null, { records: [market], status: "loaded:1" }),
    timezoneResolver: () => { throw new Error("PRIVATE_FIXTURE_SECRET; mapper details must remain private"); },
  }).create().collect({ date: DATE });
  assert.equal(collected.collection_status.status, "failed");
  assert.equal(collected.collection_status.reason, "source_mapping_failed");
  assert.deepEqual(collected.time_sensitive_events, []);
  assert.ok(!JSON.stringify(collected).includes("PRIVATE_FIXTURE_SECRET"));
});

test("the real Overpass loader timeout remains a timeout at the OSM Live boundary", async () => {
  let physicalRequests = 0;
  const loader = createOpenDataLoader({
    endpoint: "https://overpass.fixture.invalid/api/interpreter",
    radiusKm: 5,
    fetcher: async () => {
      physicalRequests++;
      throw Object.assign(new Error("fixture abort; never export exception text"), { name: "AbortError" });
    },
  });
  const records = await loader({ ...ANCHOR, anchorMode: "coordinates", requestedIntents: ["market"] });
  assert.equal(records.loader_status, "error_failed_closed");
  assert.equal(records.loader_error, "timeout_or_abort", "precondition: the real loader identified the timeout");
  assert.equal(physicalRequests, 1);

  const collected = await createOsmMarketEventProvider({
    anchor: ANCHOR,
    loader: async () => records,
  }).create().collect({ date: DATE });
  assert.equal(collected.collection_status.status, "failed");
  assert.equal(collected.collection_status.reason, "source_timeout");
  assert.deepEqual(collected.time_sensitive_events, []);
  assert.equal(physicalRequests, 1, "diagnostic projection must not retry the source");
});

test("real loader HTTP failure and its later provider hold stay distinct without a second transport", async () => {
  let physicalRequests = 0;
  const loader = createOpenDataLoader({
    endpoint: "https://overpass.fixture.invalid/api/interpreter", radiusKm: 5,
    fetcher: async () => {
      physicalRequests++;
      return { ok: false, status: 503, headers: { get: () => null } };
    },
  });
  const provider = createOsmMarketEventProvider({ anchor: ANCHOR, loader }).create();
  const failedRequest = await provider.collect({ date: DATE });
  const heldRequest = await provider.collect({ date: DATE });
  assert.equal(failedRequest.collection_status.reason, "source_http_not_ok");
  assert.equal(heldRequest.collection_status.reason, "source_provider_backoff");
  assert.equal(physicalRequests, 1, "existing endpoint hold still prevents a new native query");
  assert.ok([failedRequest, heldRequest].every(value => value.collection_status.status === "failed" && value.time_sensitive_events.length === 0));
});

test("the settled Live API preserves failure reason through its actual warm event-cache path", async () => {
  let reads = 0;
  const producers = [];
  const eventCache = createSourceCache({ namespace: "osm-outcome-integration", ttlMs: 60000 });
  const supply = resolveDefaultEventSupply({ PARRANDA_AGNOSTIC_EVENTS: "enabled" }, {
    eventCache,
    marketLoader: async () => { reads++; return recordsWithOutcome("provider_slot_busy"); },
    collectEvents: options => {
      const work = collectAnchorEvents({ ...options, registry: [osmMarketFeedForAnchor(ANCHOR)] });
      producers.push(work);
      return work;
    },
  });
  const query = () => executeLiveEventQuery({
    payload: { scope: "around_place", anchor: ANCHOR, selected_date: DATE, time: "this_week", language: "sv" },
    eventSupply: supply, now: DATE + "T06:00:00Z",
  });
  const pending = await query();
  assert.equal(pending.body.live_events.pending, true);
  await Promise.all(producers);
  await new Promise(resolve => setImmediate(resolve));
  for (let repeat = 0; repeat < 2; repeat++) {
    const settled = await query();
    assert.equal(settled.status, 200);
    assert.equal(settled.body.live_events.pending, undefined);
    const feed = settled.body.live_events.feeds.find(feed => feed.adapter === "osm_market_schedules");
    assert.ok(feed, "the actual selected source must be present");
    assert.equal(feed.status, "failed");
    assert.equal(feed.reason, "source_capacity_unavailable");
    assert.equal(settled.body.live_events.acquisition.source_health.status, "unavailable");
    assert.equal(settled.body.live_events.acquisition.source_health.result, "unknown");
    assert.equal(settled.body.live_events.acquisition.source_health.responding_source_count, 0);
    assert.ok(settled.body.live_events.acquisition.source_health.reasons.includes("source_failures_present"));
    assert.equal(settled.body.route_mutation, false);
    assert.equal(settled.body.day_anchor_mutation, false);
  }
  assert.equal(reads, 1, "warm API reads do not re-run the failed producer");
});
