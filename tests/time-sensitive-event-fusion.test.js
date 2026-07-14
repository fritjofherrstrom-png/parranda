"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  buildSourceProviderInspect,
  collectPulseSourcesForCity,
  eventsRepresentSameOccurrence,
  fuseTimeSensitiveEvents,
  normalizeSourceDescriptor,
} = require("../server/pulse-sources");

const NOW = new Date("2026-07-14T19:00:00.000Z");
const CITY = { key: "fusion-test-city", label: "Fusion Test City" };

function normalizedEvent(overrides = {}) {
  return {
    id: "night-market",
    city: CITY.key,
    title: "Night market by the harbour",
    starts_at: "2026-07-14T18:00:00.000Z",
    ends_at: "2026-07-14T22:00:00.000Z",
    place_context: "Harbour Hall",
    lat: 55.605,
    lng: 13.0038,
    timing_relevance: "now",
    freshness: "fresh",
    candidate_kind: "source_event",
    source_provider_id: "city-calendar",
    source_identity: "city.example",
    source_family: "official_city_calendar",
    source_label: "Official city calendar",
    source_url: "https://city.example/events/night-market",
    source_type: "official_open_data",
    source_tier: "official",
    confidence: "medium",
    provenance: {
      source_label: "Official city calendar",
      source_url: "https://city.example/events/night-market",
      attribution: "City events office",
    },
    tags: ["market"],
    intents: ["markets"],
    ...overrides,
  };
}

function descriptor({ id, publisherId, sourceUrl, sourceFamily, sourceTier = "official" }) {
  return {
    id,
    label: id,
    city: CITY.key,
    role: "official_live_baseline",
    sourceType: "official_open_data",
    sourceUrl,
    publisherId,
    sourceFamily,
    status: "active",
    intendedUse: "live",
    supportedLanguages: ["sv", "en"],
    updateCadence: "hourly",
    parsingRisk: "low",
    trust: {
      source_tier: sourceTier,
      confidence: "medium",
      human_verified: true,
      freshness: "live",
    },
    cachePolicy: { kind: "memory", ttlSeconds: 300 },
    sourceOwnedFields: ["title", "starts_at", "ends_at", "place_context", "lat", "lng"],
    parrandaOwnedFields: [],
  };
}

function provider(sourceDescriptor, events) {
  return {
    descriptor: sourceDescriptor,
    provider: {
      async collect() {
        return { events: [], signals: [], time_sensitive_events: events };
      },
    },
  };
}

test("single-source event stays inspectable without claiming corroboration", () => {
  const [event] = fuseTimeSensitiveEvents([normalizedEvent()]);

  assert.equal(event.fusion_status, "single_source");
  assert.equal(event.source_count, 1);
  assert.equal(event.independent_source_count, 1);
  assert.deepEqual(event.fusion_reasons, ["event_evidence_single_source", "independent_sources_1"]);
  assert.equal(event.sources[0].identity, "city.example");
});

test("independent sources corroborate one occurrence and preserve evidence provenance", () => {
  const official = normalizedEvent();
  const venue = normalizedEvent({
    id: "venue-2026-night-market",
    source_provider_id: "venue-calendar",
    source_identity: "harbourhall.example",
    source_family: "venue_calendar",
    source_label: "Harbour Hall programme",
    source_url: "https://harbourhall.example/programme/night-market",
    source_type: "venue_feed",
    source_tier: "verified",
    confidence: "low",
    starts_at: "2026-07-14T18:05:00.000Z",
    lat: 55.6054,
    lng: 13.004,
    tags: ["evening"],
    provenance: {
      source_label: "Harbour Hall programme",
      source_url: "https://harbourhall.example/programme/night-market",
      attribution: "Harbour Hall",
    },
  });

  assert.equal(eventsRepresentSameOccurrence(official, venue), true);
  const [event] = fuseTimeSensitiveEvents([venue, official]);

  assert.equal(event.fusion_status, "corroborated");
  assert.equal(event.source_count, 2);
  assert.equal(event.independent_source_count, 2);
  assert.equal(event.confidence, "medium");
  assert.deepEqual(event.tags, ["evening", "market"]);
  assert.equal(event.field_provenance.title, "city.example");
  assert.deepEqual(
    event.sources.map((source) => source.identity),
    ["city.example", "harbourhall.example"],
  );
});

test("two provider rows from one publisher are not independent corroboration", () => {
  const rest = normalizedEvent({ source_provider_id: "city-rest" });
  const ical = normalizedEvent({
    id: "night-market-ical",
    source_provider_id: "city-ical",
    source_url: "https://city.example/calendar/night-market.ics",
  });
  const [event] = fuseTimeSensitiveEvents([rest, ical]);

  assert.equal(event.source_count, 2);
  assert.equal(event.independent_source_count, 1);
  assert.equal(event.fusion_status, "single_source");
  assert.ok(event.fusion_reasons.includes("source_rows_not_independent"));
});

test("two adapters over one canonical event URL are one evidence source", () => {
  const canonicalUrl = "https://venue.example/events/night-market";
  const schemaAdapter = normalizedEvent({
    source_provider_id: "schema-adapter",
    source_identity: "schema-discovery.example",
    source_url: canonicalUrl,
  });
  const htmlAdapter = normalizedEvent({
    id: "html-night-market",
    source_provider_id: "html-adapter",
    source_identity: "html-discovery.example",
    source_url: `${canonicalUrl}?utm_source=calendar`,
  });
  const [event] = fuseTimeSensitiveEvents([schemaAdapter, htmlAdapter]);

  assert.equal(event.source_count, 2);
  assert.equal(event.independent_source_count, 1);
  assert.equal(event.fusion_status, "single_source");
  assert.ok(event.fusion_reasons.includes("source_rows_not_independent"));
});

test("title alone never merges different times, places, or missing-time listings", () => {
  const base = normalizedEvent();
  const nextDay = normalizedEvent({
    id: "night-market-next-day",
    starts_at: "2026-07-15T18:00:00.000Z",
    ends_at: "2026-07-15T22:00:00.000Z",
    source_identity: "venue.example",
    source_url: "https://venue.example/next-day",
  });
  const farAway = normalizedEvent({
    id: "night-market-far-away",
    source_identity: "regional.example",
    source_url: "https://regional.example/night-market",
    place_context: "Other Hall",
    lat: 55.67,
    lng: 13.12,
  });
  const missingTimes = [
    normalizedEvent({
      id: "untimed-a",
      starts_at: null,
      ends_at: null,
      source_identity: "a.example",
      source_url: "https://a.example/event",
    }),
    normalizedEvent({
      id: "untimed-b",
      starts_at: null,
      ends_at: null,
      source_identity: "b.example",
      source_url: "https://b.example/event",
    }),
  ];

  assert.equal(eventsRepresentSameOccurrence(base, nextDay), false);
  assert.equal(eventsRepresentSameOccurrence(base, farAway), false);
  assert.equal(eventsRepresentSameOccurrence(missingTimes[0], missingTimes[1]), false);
  assert.equal(fuseTimeSensitiveEvents([base, nextDay, farAway, ...missingTimes]).length, 5);
});

test("weak social evidence stays low until independently backed by a trusted source", () => {
  const social = normalizedEvent({
    source_provider_id: "community-listing",
    source_identity: "community.example",
    source_family: "community_social_listing",
    source_label: "Community listing",
    source_url: "https://community.example/posts/market",
    source_tier: "inferred",
    confidence: "medium",
  });
  const [socialOnly] = fuseTimeSensitiveEvents([social]);
  assert.equal(socialOnly.confidence, "low");
  assert.ok(socialOnly.fusion_reasons.includes("weak_sources_only"));

  const [corroborated] = fuseTimeSensitiveEvents([social, normalizedEvent()]);
  assert.equal(corroborated.fusion_status, "corroborated");
  assert.equal(corroborated.confidence, "medium");
});

test("stale or conflicting evidence wins over promotion", () => {
  const fresh = normalizedEvent();
  const stale = normalizedEvent({
    id: "venue-market",
    source_identity: "venue.example",
    source_url: "https://venue.example/market",
    source_tier: "verified",
    starts_at: "2026-07-14T18:10:00.000Z",
    freshness: "stale",
    timing_relevance: "stale",
    confidence: "strong",
  });
  const [event] = fuseTimeSensitiveEvents([fresh, stale]);

  assert.equal(event.fusion_status, "conflict");
  assert.equal(event.freshness, "stale");
  assert.equal(event.timing_relevance, "stale");
  assert.equal(event.confidence, "low");
  assert.ok(event.conflicts.includes("starts_at_disagreement"));
  assert.ok(event.conflicts.includes("freshness_disagreement"));
});

test("fusion is deterministic, Unicode-safe, and does not mutate provider rows", () => {
  const greekOfficial = normalizedEvent({
    title: "Νυχτερινή αγορά",
    source_identity: "city.gr",
    source_url: "https://city.gr/events/market",
  });
  const greekVenue = normalizedEvent({
    id: "venue-market",
    title: "Νυχτερινή αγορά",
    source_identity: "venue.gr",
    source_url: "https://venue.gr/market",
    source_tier: "verified",
  });
  const input = [greekOfficial, greekVenue];
  const before = structuredClone(input);

  const forward = fuseTimeSensitiveEvents(input);
  const reverse = fuseTimeSensitiveEvents(input.slice().reverse());

  assert.deepEqual(forward, reverse);
  assert.deepEqual(input, before);
  assert.equal(forward.length, 1);
  assert.equal(forward[0].fusion_status, "corroborated");
});

test("provider registry fuses independent event families and exposes compact inspect evidence", async () => {
  const cityDescriptor = descriptor({
    id: "city-rest",
    publisherId: "city-publisher",
    sourceUrl: "https://city.example/events",
    sourceFamily: "official_city_calendar",
  });
  const venueDescriptor = descriptor({
    id: "venue-jsonld",
    publisherId: "venue-publisher",
    sourceUrl: "https://venue.example/programme",
    sourceFamily: "schema_org_event",
    sourceTier: "verified",
  });
  const raw = {
    title: "Harbour night market",
    starts_at: "2026-07-14T18:00:00.000Z",
    ends_at: "2026-07-14T22:00:00.000Z",
    place_context: "Harbour Hall",
    lat: 55.605,
    lng: 13.0038,
    tags: ["market"],
  };
  const specs = [
    provider(cityDescriptor, [{ ...raw, id: "city-market", source_url: "https://city.example/events/market" }]),
    provider(venueDescriptor, [{ ...raw, id: "venue-market", source_url: "https://venue.example/market" }]),
  ];

  const result = await collectPulseSourcesForCity(CITY, { providerSpecs: specs, context: { now: NOW } });
  assert.equal(result.time_sensitive_events.length, 1);
  const event = result.time_sensitive_events[0];
  assert.equal(event.fusion_status, "corroborated");
  assert.equal(event.independent_source_count, 2);
  assert.deepEqual(
    event.sources.map((source) => source.identity),
    ["city-publisher", "venue-publisher"],
  );

  const inspect = buildSourceProviderInspect({
    city: CITY.key,
    providerSpecs: specs,
    source_status: result.source_status,
    normalized_time_sensitive_events: result.time_sensitive_events,
  });
  assert.equal(inspect.time_sensitive_event_rows[0].fusion.status, "corroborated");
  assert.equal(inspect.time_sensitive_event_rows[0].fusion.sources.length, 2);
  assert.equal(inspect.time_sensitive_event_rows[0].fusion.field_provenance.title, "city-publisher");
  assert.equal(inspect.time_sensitive_event_rows[0].raw_payload, undefined);

  const normalizedDescriptor = normalizeSourceDescriptor(cityDescriptor);
  assert.equal(normalizedDescriptor.publisherId, "city-publisher");
  assert.equal(normalizedDescriptor.sourceFamily, "official_city_calendar");
});
