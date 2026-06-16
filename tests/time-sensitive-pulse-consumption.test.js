const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { buildCityPulse } = require("../server/pulse-engine");
const {
  buildTimeSensitiveEventSignal,
  timeSensitiveEventsToPulseSignals,
} = require("../server/pulse-engine/time-sensitive-events");

const NOW = new Date("2026-08-05T10:00:00.000Z");

function cityWithEvents(events = []) {
  return {
    key: "pulse-source-city",
    label: "Pulse Source City",
    timezone: "Europe/Helsinki",
    center: { lat: 60.17, lng: 24.94 },
    services: {
      fetchWeatherForDates: async (dates = []) =>
        Object.fromEntries(dates.map((date) => [date, null])),
      fetchLiveEventsForDates: async (dates = []) =>
        Object.fromEntries(dates.map((date) => [date, []])),
      signalGenerators: [],
      pulseSourceProviders: [providerSpec(events)],
    },
  };
}

function providerSpec(events = []) {
  return {
    descriptor: {
      id: "test-time-sensitive-events",
      label: "Test Linked Events",
      city: "pulse-source-city",
      role: "official_live_baseline",
      sourceType: "official_open_data",
      sourceUrl: "https://events.test/",
      status: "active",
      intendedUse: "live",
      supportedLanguages: ["en"],
      updateCadence: "hourly",
      parsingRisk: "low",
      trust: {
        source_tier: "official",
        confidence: "high",
        human_verified: false,
        freshness: "live",
      },
      cachePolicy: {
        kind: "memory",
        ttlSeconds: 300,
        staleTtlSeconds: 1800,
      },
      sourceOwnedFields: ["title", "starts_at", "ends_at", "source_url", "lat", "lng"],
      parrandaOwnedFields: ["tags", "route_role_hint"],
    },
    provider: {
      async collect() {
        return { events: [], signals: [], time_sensitive_events: events };
      },
    },
  };
}

function event(overrides = {}) {
  return {
    id: "event-1",
    title: "Open-air concert in the park",
    starts_at: "2026-08-05T09:00:00Z",
    ends_at: "2026-08-05T12:00:00Z",
    source_url: "https://events.test/event-1",
    place_context: "Central Park",
    lat: 60.181667,
    lng: 24.924204,
    confidence: "strong",
    tags: ["music", "culture"],
    route_role_hint: "culture_stop",
    ...overrides,
  };
}

test("source-backed time-sensitive events become gated Pulse signals", async () => {
  const pulse = await buildCityPulse(cityWithEvents([event()]), {
    date: "2026-08-05",
    now: NOW,
    lang: "en",
  });

  const signal = pulse.signals.find((entry) => entry.id === "source-event-event-1");
  assert.ok(signal, "expected source event to be consumed as a Pulse signal");
  assert.equal(signal.type, "live_event_nearby");
  assert.equal(signal.title, "Open-air concert in the park");
  assert.equal(signal.source.kind, "live_feed");
  assert.equal(signal.source.label, "Test Linked Events");
  assert.equal(signal.signal_quality.displayable, true);
  assert.equal(signal.signal_quality.promotable, true);
  assert.equal(signal.time_sensitive_source_event.timing_relevance, "now");
  assert.equal(signal.time_sensitive_source_event.candidate_kind, "source_event");
});

test("time-sensitive event salience can outrank generic rhythm context", async () => {
  const pulse = await buildCityPulse(cityWithEvents([event()]), {
    date: "2026-08-05",
    now: NOW,
    lang: "en",
  });

  assert.equal(pulse.signals[0].id, "source-event-event-1");
  assert.ok(pulse.signals[0].score > 0);
});

test("stale, future, and weak-provenance events are not consumed as Pulse signals", async () => {
  const stale = event({
    id: "stale",
    starts_at: "2020-01-01T09:00:00Z",
    ends_at: "2020-01-01T12:00:00Z",
    timing_relevance: "now",
  });
  const future = event({
    id: "future",
    starts_at: "2026-09-01T09:00:00Z",
    ends_at: "2026-09-01T12:00:00Z",
  });
  const noSource = event({
    id: "no-source",
    source_url: "",
    source_label: "",
    confidence: "strong",
  });

  assert.deepEqual(
    timeSensitiveEventsToPulseSignals(
      [
        { ...stale, timing_relevance: "stale", confidence: "low" },
        { ...future, timing_relevance: "future", confidence: "strong" },
        { ...noSource, timing_relevance: "now", confidence: "medium", provenance: null },
      ],
      { city: { key: "x", label: "X" }, date: "2026-08-05", lang: "en" },
    ),
    [],
  );

  const pulse = await buildCityPulse(cityWithEvents([stale, future]), {
    date: "2026-08-05",
    now: NOW,
    lang: "en",
  });
  assert.equal(
    pulse.signals.some((signal) => signal.id === "source-event-stale" || signal.id === "source-event-future"),
    false,
  );
});

test("market events become market timing signals without becoming route stops", () => {
  const signal = buildTimeSensitiveEventSignal(
    {
      id: "market-1",
      title: "Night market by the river",
      source_url: "https://events.test/market-1",
      source_label: "Official Calendar",
      starts_at: "2026-08-05T17:00:00Z",
      ends_at: "2026-08-05T22:00:00Z",
      timing_relevance: "tonight",
      confidence: "strong",
      place_context: "Riverfront",
      tags: ["market", "food"],
      route_role_hint: "market_stop",
      lat: 60.18,
      lng: 24.92,
    },
    { city: { key: "x", label: "X" }, lang: "en" },
  );

  assert.equal(signal.type, "market_timing");
  assert.equal(signal.kindLabel, "Market timing");
  assert.equal(signal.related_stop_id, undefined);
  assert.equal(signal.linked_wildcard_id, undefined);
  assert.deepEqual(signal.route_hints.preferred_tags.sort(), ["food", "market", "market_stop"].sort());
});

test("time-sensitive Pulse consumption has no city-specific branches", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "server/pulse-engine/time-sensitive-events.js"),
    "utf8",
  );
  const stripped = source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

  assert.doesNotMatch(stripped, /barcelona|rome|athens|helsinki/i);
});
