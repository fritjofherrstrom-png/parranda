"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  buildAnchorEventSourcePlan,
  fuseAndBoundEventEvidence,
} = require("../server/place-candidates/anchor-event-acquisition");
const {
  collectAnchorEvents,
  GLOBAL_FEED_DESCRIPTOR,
} = require("../server/place-candidates/agnostic-event-supply");

const ANCHOR = { lat: 59.3293, lng: 18.0686 };
const NOW = "2026-07-14T12:00:00Z";
const BBOX = [18.0, 59.25, 18.2, 59.4];

function feed(id, overrides = {}) {
  return {
    id,
    label: id,
    base: `https://${id}.example/events/`,
    bbox: BBOX,
    license: "CC-BY 4.0",
    source_tier: "official",
    confidence: "medium",
    source_family: "municipal_open",
    source_identity: `${id}.example`,
    priority: 100,
    ...overrides,
  };
}

function linkedEvent({ id, title, lat, lng, place = "Central Hall", source = "source" }) {
  const location = { name: { en: place } };
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    location.position = { type: "Point", coordinates: [lng, lat] };
  }
  return {
    id,
    name: { en: title },
    start_time: "2026-07-14T19:00:00Z",
    end_time: "2026-07-14T21:00:00Z",
    location,
    info_url: { en: `https://${source}.example/events/${id}` },
    data_source: source,
    publisher: source,
  };
}

test("source planning is deterministic, capped, and reserves one global-family slot", () => {
  const registry = [
    feed("local-four", { priority: 4 }),
    feed("local-two", { priority: 2 }),
    feed("local-five", { priority: 5 }),
    feed("local-one", { priority: 1 }),
    feed("local-three", { priority: 3 }),
  ];
  const plan = buildAnchorEventSourcePlan({
    anchor: ANCHOR,
    registry,
    globalSource: GLOBAL_FEED_DESCRIPTOR,
    globalEnabled: true,
  });

  assert.deepEqual(plan.map((source) => source.id), [
    "local-one",
    "local-two",
    "local-three",
    "ticketmaster-global",
  ]);
  assert.equal(plan.length, 4, "network fan-out stays bounded");
});

test("source planning skips review-only rows and prefers independent publishers", () => {
  const registry = [
    feed("publisher-a-first", { priority: 1, source_identity: "publisher-a.example" }),
    feed("publisher-a-copy", { priority: 2, source_identity: "publisher-a.example" }),
    feed("review-only", { priority: 0, status: "review-needed", source_identity: "review.example" }),
    feed("publisher-b", { priority: 3, source_identity: "publisher-b.example" }),
  ];
  const plan = buildAnchorEventSourcePlan({
    anchor: ANCHOR,
    registry,
    maxSources: 2,
    maxLocalSources: 2,
  });

  assert.deepEqual(plan.map((source) => source.id), ["publisher-a-first", "publisher-b"]);
});

test("multiple approved sources fuse corroborating evidence and reject unbounded rows", async () => {
  const registry = [
    feed("source-a", { priority: 1 }),
    feed("source-b", { priority: 2, source_tier: "verified", source_family: "venue_feed" }),
  ];
  const payloadA = {
    data: [
      linkedEvent({
        id: "market-a",
        title: "Tuesday night market",
        lat: ANCHOR.lat + 0.002,
        lng: ANCHOR.lng + 0.002,
        source: "source-a",
      }),
    ],
  };
  const payloadB = {
    data: [
      // Same occurrence without coordinates: it may corroborate source A, but
      // could never survive on its own.
      linkedEvent({ id: "market-b", title: "Tuesday night market", source: "source-b" }),
      linkedEvent({
        id: "far-away",
        title: "Far away concert",
        lat: 59.0,
        lng: 18.0,
        source: "source-b",
      }),
      linkedEvent({ id: "mapless", title: "Unlocated happening", place: "Unknown room", source: "source-b" }),
    ],
  };
  const calls = [];
  const fetcher = async (url) => {
    calls.push(String(url));
    return {
      ok: true,
      json: async () => (String(url).includes("source-a.example") ? payloadA : payloadB),
    };
  };

  const out = await collectAnchorEvents({ anchor: ANCHOR, now: NOW, registry, fetcher });

  assert.equal(calls.length, 2, "both bounded sources are collected");
  assert.deepEqual(out.feeds.map((source) => source.id), ["source-a", "source-b"]);
  assert.equal(out.tonight.length, 1);
  assert.equal(out.tonight[0].title, "Tuesday night market");
  assert.equal(out.tonight[0].fusion_status, "corroborated");
  assert.equal(out.tonight[0].independent_source_count, 2);
  assert.equal(out.tonight[0].sources.length, 2);
  assert.ok(out.tonight[0].anchor_distance_km < 1);
  assert.deepEqual(out.acquisition.rejection_summary, [
    { reason: "missing_event_coordinates", count: 1 },
    { reason: "outside_anchor_radius", count: 1 },
  ]);
});

test("coordinate-less evidence alone cannot become an anchor event", () => {
  const bounded = fuseAndBoundEventEvidence(
    [
      {
        id: "mapless",
        title: "Mapless market",
        starts_at: "2026-07-14T19:00:00Z",
        place_context: "Unknown room",
        source_provider_id: "source-a",
        source_identity: "source-a.example",
        source_url: "https://source-a.example/mapless",
      },
    ],
    { anchor: ANCHOR, radiusM: 3000 },
  );

  assert.deepEqual(bounded.events, []);
  assert.equal(bounded.rejected[0].reason, "missing_event_coordinates");
});

test("one failed/empty source does not erase a healthy independent source", async () => {
  const registry = [feed("healthy", { priority: 1 }), feed("broken", { priority: 2 })];
  const fetcher = async (url) => {
    if (String(url).includes("broken.example")) throw new Error("network down");
    return {
      ok: true,
      json: async () => ({
        data: [
          linkedEvent({
            id: "healthy-event",
            title: "Healthy source concert",
            lat: ANCHOR.lat,
            lng: ANCHOR.lng,
            source: "healthy",
          }),
        ],
      }),
    };
  };

  const out = await collectAnchorEvents({ anchor: ANCHOR, now: NOW, registry, fetcher });
  assert.equal(out.coverage, "covered");
  assert.equal(out.tonight.length, 1);
  assert.equal(out.feeds.find((source) => source.id === "healthy").status, "ok");
  assert.equal(out.feeds.find((source) => source.id === "broken").status, "failed");
  assert.equal(out.feeds.find((source) => source.id === "broken").reason, "source_fetch_failed");
  assert.equal(out.acquisition.source_health.status, "partial");
  assert.equal(out.acquisition.source_health.result, "events_found");
  assert.equal(out.acquisition.source_health.failed_source_count, 1);
  assert.ok(out.acquisition.source_health.reasons.includes("source_failures_present"));
});

test("successful empty sources report healthy empty coverage", async () => {
  const registry = [feed("empty-a", { priority: 1 }), feed("empty-b", { priority: 2 })];
  const out = await collectAnchorEvents({
    anchor: ANCHOR,
    now: NOW,
    registry,
    fetcher: async () => ({ ok: true, json: async () => ({ data: [] }) }),
  });

  assert.deepEqual(out.feeds.map((source) => source.status), ["empty", "empty"]);
  assert.equal(out.acquisition.source_health.status, "healthy");
  assert.equal(out.acquisition.source_health.result, "empty");
  assert.equal(out.acquisition.source_health.responding_source_count, 2);
  assert.equal(out.acquisition.source_health.failed_source_count, 0);
  assert.ok(out.acquisition.source_health.reasons.includes("no_current_events_found"));
});

test("all failed sources report unavailable evidence instead of no events", async () => {
  const registry = [feed("failed-a", { priority: 1 }), feed("failed-b", { priority: 2 })];
  const out = await collectAnchorEvents({
    anchor: ANCHOR,
    now: NOW,
    registry,
    fetcher: async () => { throw new Error("network down"); },
  });

  assert.deepEqual(out.feeds.map((source) => source.status), ["failed", "failed"]);
  assert.equal(out.acquisition.source_health.status, "unavailable");
  assert.equal(out.acquisition.source_health.result, "unknown");
  assert.equal(out.acquisition.source_health.failed_source_count, 2);
  assert.ok(out.acquisition.source_health.reasons.includes("all_sources_unavailable"));
  assert.ok(!out.acquisition.source_health.reasons.includes("no_current_events_found"));
  assert.ok(!JSON.stringify(out.acquisition.source_health).includes("network down"), "raw provider errors stay internal");
});

test("bounded source health reports when all collected evidence is rejected", async () => {
  const registry = [feed("far-source", { priority: 1 })];
  const out = await collectAnchorEvents({
    anchor: ANCHOR,
    now: NOW,
    registry,
    fetcher: async () => ({
      ok: true,
      json: async () => ({
        data: [
          linkedEvent({
            id: "far-only",
            title: "Far-only event",
            lat: 58.5,
            lng: 17.5,
            source: "far-source",
          }),
        ],
      }),
    }),
  });

  assert.equal(out.acquisition.source_health.status, "healthy", "the source itself answered successfully");
  assert.equal(out.acquisition.source_health.result, "empty", "nothing bounded was safe to show");
  assert.equal(out.acquisition.source_health.raw_event_count, 1);
  assert.equal(out.acquisition.source_health.normalized_event_count, 1);
  assert.equal(out.acquisition.source_health.accepted_event_count, 0);
  assert.ok(out.acquisition.source_health.reasons.includes("all_event_evidence_rejected"));
});

test("bounded sources start concurrently rather than serially", { timeout: 1500 }, async () => {
  const registry = [feed("parallel-a", { priority: 1 }), feed("parallel-b", { priority: 2 })];
  let started = 0;
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const fetcher = async () => {
    started += 1;
    if (started === 2) release();
    await gate;
    return { ok: true, json: async () => ({ data: [] }) };
  };

  const out = await collectAnchorEvents({ anchor: ANCHOR, now: NOW, registry, fetcher });
  assert.equal(started, 2);
  assert.equal(out.acquisition.selected_source_count, 2);
});
