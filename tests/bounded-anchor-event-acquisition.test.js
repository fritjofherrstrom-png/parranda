"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  buildAnchorEventSourcePlan,
  fuseAndBoundEventEvidence,
} = require("../server/place-candidates/anchor-event-acquisition");
const {
  collectAnchorEvents,
  buildScopedEventSourcePlan,
  GLOBAL_FEED_DESCRIPTOR,
  isEphemeralHappening,
  isPulseDisplayEvent,
  toEventView,
} = require("../server/place-candidates/agnostic-event-supply");
const { normalizeTimeSensitiveSourceEvent } = require("../server/pulse-sources/time-sensitive-event");

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

test("route-scoped source planning can find a reviewed feed at a route edge", () => {
  const routeCenterOutsideFeed = { lat: 59.5, lng: 18.3 };
  const plan = buildScopedEventSourcePlan({
    anchor: routeCenterOutsideFeed,
    sourceAnchors: [routeCenterOutsideFeed, ANCHOR],
    registry: [feed("edge-municipal")],
  });
  assert.deepEqual(plan.map((source) => source.id), ["edge-municipal"]);
});

test("reviewed schema.org HTML and iCal sources share the bounded acquisition path", async () => {
  const registry = [
    feed("venue-jsonld", {
      adapter: "schema_org_html",
      base: "https://venue.example/calendar",
      source_identity: "venue.example",
      source_family: "venue_calendar",
      priority: 1,
    }),
    feed("municipal-ics", {
      adapter: "ical",
      base: "https://city.example/calendar.ics",
      source_identity: "city.example",
      source_family: "municipal_calendar",
      priority: 2,
    }),
  ];
  const schemaEvent = {
    "@type": "Event",
    "@id": "https://venue.example/events/courtyard-jazz",
    name: "Courtyard jazz session",
    startDate: "2026-07-14T19:00:00Z",
    endDate: "2026-07-14T21:00:00Z",
    url: "https://venue.example/events/courtyard-jazz",
    location: {
      name: "The Courtyard",
      geo: { latitude: ANCHOR.lat + 0.001, longitude: ANCHOR.lng + 0.001 },
    },
  };
  const ical = [
    "BEGIN:VCALENDAR",
    "BEGIN:VEVENT",
    "UID:harbour-market",
    "SUMMARY:Harbour makers market",
    "DTSTART:20260714T180000Z",
    "DTEND:20260714T200000Z",
    `GEO:${ANCHOR.lat + 0.002};${ANCHOR.lng + 0.002}`,
    "LOCATION:Harbour Hall",
    "URL:https://city.example/events/harbour-market",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
  const calls = [];
  const fetcher = async (url) => {
    calls.push(String(url));
    if (String(url).includes("venue.example")) {
      return {
        ok: true,
        text: async () => `<script type="application/ld+json">${JSON.stringify(schemaEvent)}</script>`,
      };
    }
    return {
      ok: true,
      headers: { get: () => "text/calendar" },
      text: async () => ical,
    };
  };

  const out = await collectAnchorEvents({ anchor: ANCHOR, now: NOW, registry, fetcher });

  assert.equal(calls.length, 2);
  assert.deepEqual(out.feeds.map((row) => [row.id, row.status]), [
    ["venue-jsonld", "ok"],
    ["municipal-ics", "ok"],
  ]);
  assert.deepEqual(out.feeds.map((row) => row.adapter), ["schema_org_html", "ical"]);
  assert.deepEqual(out.tonight.map((event) => event.title).sort(), [
    "Courtyard jazz session",
    "Harbour makers market",
  ]);
  assert.equal(out.acquisition.source_health.event_bearing_source_count, 2);
  assert.equal(out.acquisition.source_health.result, "events_found");
  assert.ok(out.tonight.every((event) => Number.isFinite(event.anchor_distance_km)));
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

test("resolver-attested regional bounds admit relevant regional events without changing local radius behavior", () => {
  const regionalScope = {
    kind: "region",
    bounds: { south: 59.2, north: 59.7, west: 17.9, east: 18.3 },
  };
  const regionalEvent = {
    id: "regional-market",
    title: "Regional makers market",
    starts_at: "2026-07-14T19:00:00Z",
    ends_at: "2026-07-14T21:00:00Z",
    lat: 59.5,
    lng: 18.1,
    source_provider_id: "regional-calendar",
    source_identity: "regional.example",
    source_url: "https://regional.example/market",
  };
  const local = fuseAndBoundEventEvidence([regionalEvent], { anchor: ANCHOR, radiusM: 3000 });
  const regional = fuseAndBoundEventEvidence([regionalEvent], {
    anchor: ANCHOR,
    radiusM: 3000,
    spatialScope: regionalScope,
  });
  const outside = fuseAndBoundEventEvidence([
    { ...regionalEvent, id: "outside", lat: 59.8 },
  ], {
    anchor: ANCHOR,
    radiusM: 3000,
    spatialScope: regionalScope,
  });

  assert.equal(local.events.length, 0);
  assert.equal(local.rejected[0].reason, "outside_anchor_radius");
  assert.equal(regional.events.length, 1);
  assert.equal(regional.geometry_scope, "resolver_attested_region");
  assert.ok(regional.events[0].anchor_distance_km > 3);
  assert.equal(outside.events.length, 0);
  assert.equal(outside.rejected[0].reason, "outside_trusted_spatial_scope");

  const detachedScope = fuseAndBoundEventEvidence([regionalEvent], {
    anchor: ANCHOR,
    radiusM: 3000,
    spatialScope: {
      kind: "region",
      bounds: { south: 59.45, north: 59.65, west: 18.0, east: 18.2 },
    },
  });
  assert.equal(detachedScope.events.length, 0, "bounds that do not contain the anchor cannot widen trust");
  assert.equal(detachedScope.geometry_scope, "anchor_radius");
});

test("regional collection threads trusted scope through normalization and fusion", async () => {
  const regionalScope = {
    kind: "region",
    bounds: { south: 59.2, north: 59.7, west: 17.9, east: 18.3 },
  };
  const registry = [feed("regional-source", {
    bbox: [17.9, 59.2, 18.3, 59.7],
  })];
  const out = await collectAnchorEvents({
    anchor: ANCHOR,
    now: NOW,
    registry,
    spatialScope: regionalScope,
    fetcher: async () => ({
      ok: true,
      json: async () => ({
        data: [linkedEvent({
          id: "regional-evening",
          title: "Regional evening market",
          lat: 59.5,
          lng: 18.1,
          source: "regional-source",
        })],
      }),
    }),
  });

  assert.equal(out.tonight.length, 1);
  assert.equal(out.tonight[0].id, "regional-evening");
  assert.equal(out.acquisition.geometry_scope, "resolver_attested_region");
});

test("daily windows remain surfaceable during opening and future between openings", () => {
  const raw = {
    id: "daily-market",
    title: "Daily makers market",
    source_url: "https://calendar.example/daily-market",
    source_label: "Reviewed calendar",
    source_provider_id: "reviewed-calendar",
    source_identity: "calendar.example",
    source_family: "destination_calendar",
    source_tier: "verified",
    confidence: "medium",
    place_context: "Market Hall",
    lat: ANCHOR.lat + 0.001,
    lng: ANCHOR.lng + 0.001,
    starts_on: "2026-07-14",
    ends_on: "2026-07-16",
    time_window: {
      kind: "daily",
      starts_on: "2026-07-14",
      ends_on: "2026-07-16",
      local_start: "10:00",
      local_end: "17:00",
    },
  };
  const duringOpening = normalizeTimeSensitiveSourceEvent(raw, {
    now: "2026-07-14T12:00:00.000Z",
    timezone: "Europe/Stockholm",
  });
  const betweenOpenings = normalizeTimeSensitiveSourceEvent(raw, {
    now: "2026-07-14T18:00:00.000Z",
    timezone: "Europe/Stockholm",
  });
  const bounded = fuseAndBoundEventEvidence([duringOpening], { anchor: ANCHOR, radiusM: 3000 });
  const view = toEventView(bounded.events[0], feed("reviewed-calendar"), {
    eventTimezone: "Europe/Stockholm",
  });

  assert.equal(duringOpening.timing_relevance, "now");
  assert.equal(betweenOpenings.timing_relevance, "future");
  assert.equal(isEphemeralHappening(duringOpening, new Date("2026-07-14T12:00:00.000Z")), true);
  assert.equal(view.starts_on, "2026-07-14");
  assert.equal(view.ends_on, "2026-07-16");
  assert.equal(view.time_window.kind, "daily");
});

test("a longer reviewed daily window may inform Pulse without becoming a route event", () => {
  const longDaily = normalizeTimeSensitiveSourceEvent({
    id: "summer-exhibition",
    title: "Summer exhibition",
    source_url: "https://calendar.example/summer-exhibition",
    source_label: "Reviewed calendar",
    source_provider_id: "reviewed-calendar",
    source_identity: "calendar.example",
    source_tier: "verified",
    confidence: "medium",
    place_context: "Gallery Hall",
    lat: ANCHOR.lat + 0.001,
    lng: ANCHOR.lng + 0.001,
    starts_on: "2026-06-01",
    ends_on: "2026-09-15",
    time_window: {
      kind: "daily",
      local_start: "10:00",
      local_end: "17:00",
    },
  }, {
    now: NOW,
    timezone: "Europe/Stockholm",
  });

  assert.equal(isPulseDisplayEvent(longDaily, new Date(NOW)), true);
  assert.equal(isEphemeralHappening(longDaily, new Date(NOW)), false);
  const view = toEventView(longDaily, feed("reviewed-calendar"), {
    eventTimezone: "Europe/Stockholm",
    routeEligible: false,
  });
  assert.equal(view.pulse_display_eligible, true);
  assert.equal(view.route_eligible, false);
});

test("provider collection surfaces a longer daily window as Pulse-only", async () => {
  const registry = [feed("seasonal-calendar", {
    adapter: "localized_events_api",
    endpoint: "https://seasonal-calendar.example/events/",
    timezone: "Europe/Stockholm",
    source_language: "en",
  })];
  const out = await collectAnchorEvents({
    anchor: ANCHOR,
    now: NOW,
    registry,
    fetcher: async (url) => ({
      ok: true,
      status: 200,
      url: String(url),
      text: async () => JSON.stringify({
        count: 1,
        results: [{
          id: "summer-exhibition",
          title: { en: "Summer exhibition" },
          external_website_url: "https://seasonal-calendar.example/events/exhibition",
          venue_name: "Gallery Hall",
          address: "Gallery Street 4",
          location: { latitude: ANCHOR.lat + 0.001, longitude: ANCHOR.lng + 0.001 },
          start_date: "2026-06-01",
          end_date: "2026-09-15",
          start_time: "10:00",
          end_time: "17:00",
          categories: [{ title: "Exhibitions", slug: "exhibitions", subcategories: [] }],
        }],
      }),
    }),
  });

  assert.equal(out.tonight.length, 1);
  assert.equal(out.tonight[0].id, "summer-exhibition");
  assert.equal(out.tonight[0].pulse_display_eligible, true);
  assert.equal(out.tonight[0].route_eligible, false);
  assert.equal(out.acquisition.source_health.accepted_event_count, 1);
  assert.equal(out.acquisition.rejection_summary.some((row) => row.reason === "not_ephemeral_happening"), false);
});

test("coordinate-less daily evidence may corroborate matching geometry but never survives alone", () => {
  const shared = {
    title: "Daily harbour market",
    starts_at: null,
    ends_at: null,
    starts_on: "2026-07-14",
    ends_on: "2026-07-16",
    time_window: {
      kind: "daily",
      starts_on: "2026-07-14",
      ends_on: "2026-07-16",
      local_start: "10:00",
      local_end: "17:00",
      timezone: "Europe/Stockholm",
    },
    timezone: "Europe/Stockholm",
    timing_relevance: "now",
    place_context: "Harbour Hall",
  };
  const wixEvidence = {
    ...shared,
    id: "wix-market",
    source_provider_id: "destination-wix",
    source_identity: "destination.example",
    source_url: "https://destination.example/events-1/market",
    source_tier: "verified",
    confidence: "low",
  };
  const geometryEvidence = {
    ...shared,
    id: "official-market",
    source_provider_id: "official-calendar",
    source_identity: "city.example",
    source_url: "https://city.example/events/market",
    source_tier: "official",
    confidence: "medium",
    lat: ANCHOR.lat + 0.001,
    lng: ANCHOR.lng + 0.001,
  };

  const alone = fuseAndBoundEventEvidence([wixEvidence], { anchor: ANCHOR, radiusM: 3000 });
  const corroborated = fuseAndBoundEventEvidence(
    [wixEvidence, geometryEvidence],
    { anchor: ANCHOR, radiusM: 3000 },
  );

  assert.equal(alone.events.length, 0);
  assert.equal(alone.rejected[0].reason, "missing_event_coordinates");
  assert.equal(corroborated.events.length, 1);
  assert.equal(corroborated.events[0].fusion_status, "corroborated");
  assert.equal(corroborated.events[0].independent_source_count, 2);
  assert.equal(corroborated.events[0].lat, geometryEvidence.lat);
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

test("source health distinguishes accepted pre-cap events from surfaced rows", async () => {
  const registry = [feed("many-events", { priority: 1 })];
  const events = Array.from({ length: 8 }, (_unused, index) => linkedEvent({
    id: `event-${index}`,
    title: `Distinct happening ${index}`,
    lat: ANCHOR.lat + index * 0.0001,
    lng: ANCHOR.lng + index * 0.0001,
    place: `Venue ${index}`,
    source: "many-events",
  }));
  const out = await collectAnchorEvents({
    anchor: ANCHOR,
    now: NOW,
    registry,
    fetcher: async () => ({ ok: true, json: async () => ({ data: events }) }),
  });

  assert.equal(out.tonight.length, 6, "public bucket stays capped");
  assert.equal(out.acquisition.source_health.accepted_event_count, 8, "accepted count is measured before cap");
  assert.equal(out.acquisition.source_health.surfaced_event_count, 6, "surfaced count describes capped output");
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
