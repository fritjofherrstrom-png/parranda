const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  SourceProviderRegistry,
  collectPulseSourcesForCity,
  buildSourceProviderInspect,
  SOURCE_PROVIDER_INSPECT_EVENT_LIMIT,
  SOURCE_PROVIDER_INSPECT_TIME_SENSITIVE_EVENT_LIMIT,
  normalizeSourceDescriptor,
  normalizeSourceEvent,
  normalizeSourceSignal,
} = require("../server/pulse-sources");
const { buildCityPulse } = require("../server/pulse-engine");
const { buildDisplayGate, normalizeConfidence } = require("../server/pulse-sources/display-gates");

const root = path.join(__dirname, "..");
const city = { key: "test-source-city", label: "Test Source City" };

function descriptor(overrides = {}) {
  return {
    id: "test-official-agenda",
    label: "Test Official Agenda",
    city: city.key,
    role: "official_live_baseline",
    sourceType: "official_open_data",
    sourceUrl: "https://example.test/agenda",
    status: "active",
    intendedUse: "live",
    supportedLanguages: ["en"],
    updateCadence: "daily",
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
    sourceOwnedFields: ["title", "venue", "address", "start_date", "source_url", "lat", "lng"],
    parrandaOwnedFields: ["known_place_id", "tags"],
    ...overrides,
  };
}

function providerSpec(overrides = {}) {
  const sourceDescriptor = descriptor(overrides.descriptor || {});
  return {
    descriptor: sourceDescriptor,
    provider: {
      async collect() {
        if (overrides.throw) {
          throw new Error("provider boom");
        }
        return {
          events: overrides.events || [
            {
              id: "event-1",
              title: "Official neighbourhood concert",
              venue: "Centre Example",
              address: "Street 1",
              start_date: "2026-06-02",
              source_url: "https://example.test/agenda/event-1",
              lat: 41.4,
              lng: 2.1,
            },
          ],
          signals: overrides.signals || [],
          time_sensitive_events: overrides.time_sensitive_events || [],
        };
      },
    },
  };
}

test("source descriptor validates role, trust and cache policy", () => {
  const normalized = normalizeSourceDescriptor(descriptor());

  assert.equal(normalized.role, "official_live_baseline");
  assert.equal(normalized.label, "Test Official Agenda");
  assert.equal(normalized.trust.source_tier, "official");
  assert.equal(normalized.trust.confidence, "high");
  assert.equal(normalized.cachePolicy.kind, "memory");
  assert.equal(normalized.cachePolicy.ttlSeconds, 300);

  assert.throws(
    () => normalizeSourceDescriptor(descriptor({ role: "barcelona_only_magic" })),
    /role has unsupported value/,
  );
  assert.throws(
    () => normalizeSourceDescriptor(descriptor({ trust: { source_tier: "official" } })),
    /trust.confidence/,
  );
  assert.throws(
    () => normalizeSourceDescriptor(descriptor({ cachePolicy: { kind: "forever" } })),
    /cachePolicy.kind has unsupported value/,
  );
});

test("duplicate provider ids reject at registry creation", () => {
  assert.throws(
    () => new SourceProviderRegistry([providerSpec(), providerSpec()]),
    /duplicate id test-official-agenda/,
  );
});

test("disabled, review-needed, and candidate providers do not run by default", async () => {
  let runs = 0;
  const specs = ["disabled", "review-needed", "candidate"].map((status) => ({
    descriptor: descriptor({ id: `source-${status}`, status }),
    provider: {
      async collect() {
        runs += 1;
        return { events: [{ id: status, title: status }], signals: [] };
      },
    },
  }));

  const result = await collectPulseSourcesForCity(city, { providerSpecs: specs });

  assert.equal(runs, 0);
  assert.deepEqual(result.events, []);
  assert.equal(result.source_status.length, 3);
  assert.ok(result.source_status.every((status) => status.status === "skipped"));
});

test("provider throw returns empty result and failed source_status", async () => {
  const result = await collectPulseSourcesForCity(city, {
    providerSpecs: [providerSpec({ throw: true })],
  });

  assert.deepEqual(result.events, []);
  assert.deepEqual(result.time_sensitive_events, []);
  assert.equal(result.source_status.length, 1);
  assert.equal(result.source_status[0].status, "failed");
  assert.equal(result.source_status[0].time_sensitive_events, 0);
  assert.match(result.source_status[0].reason, /provider boom/);
});

test("provider registry prevents cross-city leakage", async () => {
  let runs = 0;
  const result = await collectPulseSourcesForCity(city, {
    providerSpecs: [
      {
        descriptor: descriptor({ city: "other-city" }),
        provider: {
          async collect() {
            runs += 1;
            return { events: [{ id: "leak", title: "Should not run" }], signals: [] };
          },
        },
      },
    ],
  });

  assert.equal(runs, 0);
  assert.deepEqual(result.events, []);
  assert.deepEqual(result.time_sensitive_events, []);
  assert.equal(result.source_status[0].reason, "city_mismatch");
});

test("registry filters by role and can explicitly enable candidate providers", async () => {
  let activeRuns = 0;
  let candidateRuns = 0;
  const result = await collectPulseSourcesForCity(city, {
    roles: ["weather_context"],
    enabledStatuses: ["active", "candidate"],
    providerSpecs: [
      {
        descriptor: descriptor({ id: "active-live", role: "official_live_baseline" }),
        provider: {
          async collect() {
            activeRuns += 1;
            return { events: [{ id: "active", title: "Active live" }], signals: [] };
          },
        },
      },
      {
        descriptor: descriptor({
          id: "candidate-weather",
          role: "weather_context",
          sourceType: "weather",
          status: "candidate",
          intendedUse: "pulse",
        }),
        provider: {
          async collect() {
            candidateRuns += 1;
            return { events: [], signals: [{ id: "rain", title: "Rain easing", type: "weather_shift" }] };
          },
        },
      },
    ],
  });

  assert.equal(activeRuns, 0);
  assert.equal(candidateRuns, 1);
  assert.equal(result.signals.length, 1);
  assert.equal(result.source_status.find((status) => status.id === "active-live").reason, "role_filtered");
});

test("weak or no-geo event cannot show as nearby", () => {
  const event = normalizeSourceEvent(
    {
      id: "weak",
      title: "Thin event",
      source_url: "https://example.test/event",
      confidence: "low",
    },
    descriptor(),
  );

  assert.equal(event.display_gate.may_show_in_pulse, true);
  assert.equal(event.display_gate.may_show_as_nearby, false);
  assert.equal(event.display_gate.may_create_place_candidate, false);
});

test("confidence normalization stays canonical and unknown values fall back to needs_review", () => {
  assert.equal(normalizeConfidence("strong"), "strong");
  assert.equal(normalizeConfidence("medium"), "medium");
  assert.equal(normalizeConfidence("low"), "low");
  assert.equal(normalizeConfidence("needs_review"), "needs_review");
  assert.equal(normalizeConfidence("high"), "strong");
  assert.equal(normalizeConfidence("weak"), "low");
  assert.equal(normalizeConfidence("certain"), "needs_review");

  const gate = buildDisplayGate({
    confidence: "certain",
    source: { url: "https://example.test/event" },
    source_owned: { title: "Mystery event", start_date: "2026-06-02" },
  });
  assert.ok(gate.reasons.includes("confidence_needs_review"));
  assert.ok(!gate.reasons.includes("confidence_certain"));
});

test("source-url-only event cannot create a place candidate", () => {
  const event = normalizeSourceEvent(
    {
      id: "url-only",
      title: "Official listing",
      start_date: "2026-06-02",
      source_url: "https://example.test/event",
      confidence: "medium",
    },
    descriptor(),
  );

  assert.equal(event.display_gate.may_show_in_live_list, true);
  assert.equal(event.display_gate.may_create_place_candidate, false);
  assert.equal(event.display_gate.may_show_as_nearby, false);
});

test("no-time source-url-only event is not eligible for live or route promotion", () => {
  const event = normalizeSourceEvent(
    {
      id: "no-time",
      title: "Official listing without date",
      source_url: "https://example.test/event",
      confidence: "medium",
    },
    descriptor(),
  );

  assert.equal(event.display_gate.may_show_in_pulse, true);
  assert.equal(event.display_gate.may_show_in_live_list, false);
  assert.equal(event.display_gate.may_influence_routes, false);
  assert.equal(event.display_gate.may_create_place_candidate, false);
  assert.equal(event.display_gate.may_show_as_nearby, false);
});

test("provider coordinates or known place can create a place candidate", () => {
  const withCoords = normalizeSourceEvent(
    {
      id: "coords",
      title: "Official listing",
      venue: "Centre Example",
      start_date: "2026-06-02",
      lat: 41.4,
      lng: 2.1,
    },
    descriptor(),
  );
  const knownPlaceGate = buildDisplayGate({
    confidence: "medium",
    source: { url: "https://example.test/event" },
    source_owned: { title: "Known place event", start_date: "2026-06-02" },
    parranda_owned: { known_place_id: "centre-example" },
  });

  assert.equal(withCoords.display_gate.may_create_place_candidate, true);
  assert.equal(withCoords.display_gate.may_show_as_nearby, true);
  assert.equal(knownPlaceGate.may_create_place_candidate, true);
  assert.equal(knownPlaceGate.may_show_as_nearby, true);
});

test("numeric string coordinates are canonicalized and pass coordinate gates", () => {
  const event = normalizeSourceEvent(
    {
      id: "string-coords",
      title: "Official listing",
      venue: "Centre Example",
      address: "Street 1",
      start_date: "2026-06-02",
      lat: "41.4",
      lng: "2.1",
      parranda_owned: {
        geocode: {
          lat: "41.41",
          lng: "2.11",
        },
      },
    },
    descriptor(),
  );

  assert.equal(event.source_owned.lat, 41.4);
  assert.equal(event.source_owned.lng, 2.1);
  assert.equal(event.lat, 41.4);
  assert.equal(event.lng, 2.1);
  assert.equal(event.parranda_owned.geocode.lat, 41.41);
  assert.equal(event.parranda_owned.geocode.lng, 2.11);
  assert.equal(event.display_gate.may_create_place_candidate, true);
  assert.equal(event.display_gate.may_show_as_nearby, true);
});

test("invalid string coordinates do not pass coordinate gates", () => {
  const event = normalizeSourceEvent(
    {
      id: "bad-string-coords",
      title: "Official listing",
      start_date: "2026-06-02",
      source_url: "https://example.test/event",
      lat: "north",
      lng: "",
      parranda_owned: {
        geocode: {
          lat: "Infinity",
          lng: "NaN",
        },
      },
    },
    descriptor(),
  );

  assert.equal(event.source_owned.lat, null);
  assert.equal(event.source_owned.lng, null);
  assert.equal(event.lat, null);
  assert.equal(event.lng, null);
  assert.equal(event.parranda_owned.geocode.lat, null);
  assert.equal(event.parranda_owned.geocode.lng, null);
  assert.equal(event.display_gate.may_create_place_candidate, false);
  assert.equal(event.display_gate.may_show_as_nearby, false);
});

test("normalizeSourceSignal supports future non-event context signals", () => {
  const signal = normalizeSourceSignal(
    {
      id: "weather-1",
      title: "Rain clears after lunch",
      type: "weather_shift",
      confidence: "medium",
      source_owned: {
        title: "Rain clears after lunch",
        source_url: "https://example.test/weather",
      },
      parranda_owned: {
        route_bias: { indoor: -0.2, views: 0.3 },
      },
    },
    descriptor({
      id: "weather-feed",
      role: "weather_context",
      sourceType: "weather",
      intendedUse: "pulse",
      sourceOwnedFields: ["title", "source_url"],
      parrandaOwnedFields: ["route_bias"],
    }),
  );

  assert.equal(signal.signal_type, "weather_shift");
  assert.equal(signal.source.role, "weather_context");
  assert.equal(signal.source_owned.title, "Rain clears after lunch");
  assert.deepEqual(signal.parranda_owned.route_bias, { indoor: -0.2, views: 0.3 });
  assert.equal(signal.display_gate.may_show_in_pulse, true);
});

test("registry collects and dedupes normalized source events", async () => {
  const registry = new SourceProviderRegistry([
    providerSpec({
      events: [
        {
          id: "same",
          title: "Official neighbourhood concert",
          venue: "Centre Example",
          address: "Street 1",
          start_date: "2026-06-02",
          lat: 41.4,
          lng: 2.1,
        },
        {
          id: "same",
          title: "Official neighbourhood concert",
          venue: "Centre Example",
          address: "Street 1",
          start_date: "2026-06-02",
          lat: 41.4,
          lng: 2.1,
        },
      ],
    }),
  ]);

  const result = await registry.collect(city);

  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].source.id, "test-official-agenda");
  assert.equal(result.events[0].source_owned.title, "Official neighbourhood concert");
  assert.equal(result.events[0].display_gate.may_create_place_candidate, true);
});

test("registry collects time-sensitive source events through the generic bridge", async () => {
  const result = await collectPulseSourcesForCity(city, {
    providerSpecs: [
      providerSpec({
        time_sensitive_events: [
          {
            id: "market-tonight",
            title: "Night market by the river",
            starts_at: "2026-07-10T18:00:00.000Z",
            ends_at: "2026-07-10T22:00:00.000Z",
            confidence: "strong",
            tags: ["market"],
            intents: ["markets"],
            route_role_hint: "market_stop",
            lat: "41.4",
            lng: "2.1",
          },
        ],
      }),
    ],
    context: { now: new Date("2026-07-10T19:00:00.000Z") },
  });

  assert.equal(result.events.length, 1, "legacy normalized events stay separate");
  assert.equal(result.signals.length, 0);
  assert.equal(result.time_sensitive_events.length, 1);
  assert.equal(result.time_sensitive_events[0].candidate_kind, "source_event");
  assert.equal(result.time_sensitive_events[0].timing_relevance, "now");
  assert.equal(result.time_sensitive_events[0].confidence, "strong");
  assert.equal(result.time_sensitive_events[0].source_label, "Test Official Agenda");
  assert.equal(result.time_sensitive_events[0].source_url, "https://example.test/agenda");
  assert.equal(result.time_sensitive_events[0].lat, 41.4);
  assert.equal(result.time_sensitive_events[0].lng, 2.1);
  assert.equal(result.source_status[0].time_sensitive_events, 1);
});

test("time-sensitive bridge keeps expired explicit-now events stale", async () => {
  const result = await collectPulseSourcesForCity(city, {
    providerSpecs: [
      providerSpec({
        time_sensitive_events: [
          {
            id: "expired",
            title: "Expired market",
            timing_relevance: "now",
            starts_at: "2026-07-09T18:00:00.000Z",
            ends_at: "2026-07-09T22:00:00.000Z",
            confidence: "strong",
          },
        ],
      }),
    ],
    context: { now: new Date("2026-07-10T19:00:00.000Z") },
  });

  assert.equal(result.time_sensitive_events.length, 1);
  assert.equal(result.time_sensitive_events[0].timing_relevance, "stale");
  assert.equal(result.time_sensitive_events[0].confidence, "low");
});

test("time-sensitive bridge cannot mint strong confidence without source backing", async () => {
  const result = await collectPulseSourcesForCity(city, {
    providerSpecs: [
      providerSpec({
        descriptor: {
          id: "source-less-provider",
          label: undefined,
          sourceUrl: undefined,
        },
        time_sensitive_events: [
          {
            id: "source-less",
            title: "Unbacked happening",
            starts_at: "2026-07-10T18:00:00.000Z",
            ends_at: "2026-07-10T22:00:00.000Z",
            source_label: "",
            source_url: "",
            provenance: null,
            confidence: "strong",
          },
        ],
      }),
    ],
    context: { now: new Date("2026-07-10T19:00:00.000Z") },
  });

  assert.equal(result.time_sensitive_events.length, 1);
  assert.equal(result.time_sensitive_events[0].confidence, "medium");
  assert.ok(result.time_sensitive_events[0].timing_reasons.includes("missing_source_backing"));
});

test("source provider inspect mode caps event rows without exposing raw payloads", () => {
  const normalizedEvents = Array.from({ length: SOURCE_PROVIDER_INSPECT_EVENT_LIMIT + 2 }, (_value, index) =>
    normalizeSourceEvent(
      {
        id: `event-${index + 1}`,
        title: `Event ${index + 1}`,
        venue: `Venue ${index + 1}`,
        address: "Street 1",
        start_date: "2026-06-02",
        source_url: `https://example.test/event-${index + 1}`,
        lat: 41.4 + index,
        lng: 2.1 + index,
        raw_summary: `Raw provider body ${index + 1}`,
      },
      descriptor(),
      { index },
    ),
  );
  const compatEvents = normalizedEvents.map((event) => ({
    id: `compat-${event.id}`,
    source_event_id: event.id,
  }));

  const inspect = buildSourceProviderInspect({
    city: city.key,
    date: "2026-06-02",
    providerSpecs: [providerSpec()],
    source_status: [{ id: "test-official-agenda", status: "ok", events: normalizedEvents.length, signals: 0 }],
    normalized_events: normalizedEvents,
    compat_events: compatEvents,
  });

  assert.equal(inspect.normalized_event_count, SOURCE_PROVIDER_INSPECT_EVENT_LIMIT + 2);
  assert.equal(inspect.event_rows.length, SOURCE_PROVIDER_INSPECT_EVENT_LIMIT);
  assert.equal(inspect.truncated_event_count, 2);
  assert.equal(inspect.event_rows[0].converted_to_live_event, true);
  assert.equal(inspect.event_rows[0].source_owned.raw_summary, undefined);
});

test("source provider inspect mode caps time-sensitive events without raw payloads", () => {
  const normalizedTimeSensitiveEvents = Array.from(
    { length: SOURCE_PROVIDER_INSPECT_TIME_SENSITIVE_EVENT_LIMIT + 2 },
    (_value, index) => ({
      id: `source-event-${index + 1}`,
      title: `Source Event ${index + 1}`,
      candidate_kind: "source_event",
      timing_relevance: "today",
      starts_at: "2026-07-10T14:00:00.000Z",
      ends_at: "2026-07-10T16:00:00.000Z",
      confidence: "medium",
      route_role_hint: "market_stop",
      source_label: "Official city calendar",
      source_url: `https://example.test/source-event-${index + 1}`,
      source_type: "official_open_data",
      source_tier: "official",
      city: city.key,
      area: "center",
      lat: 41.4,
      lng: 2.1,
      timing_reasons: ["timing_today", "has_source_backing", "confidence_medium"],
      raw_payload: { should: "not leak" },
    }),
  );

  const inspect = buildSourceProviderInspect({
    city: city.key,
    date: "2026-07-10",
    providerSpecs: [providerSpec()],
    source_status: [
      {
        id: "test-official-agenda",
        status: "ok",
        events: 0,
        signals: 0,
        time_sensitive_events: normalizedTimeSensitiveEvents.length,
      },
    ],
    normalized_time_sensitive_events: normalizedTimeSensitiveEvents,
  });

  assert.equal(inspect.normalized_time_sensitive_event_count, SOURCE_PROVIDER_INSPECT_TIME_SENSITIVE_EVENT_LIMIT + 2);
  assert.equal(inspect.time_sensitive_event_rows.length, SOURCE_PROVIDER_INSPECT_TIME_SENSITIVE_EVENT_LIMIT);
  assert.equal(inspect.truncated_time_sensitive_event_count, 2);
  assert.equal(inspect.time_sensitive_event_rows[0].candidate_kind, "source_event");
  assert.equal(inspect.time_sensitive_event_rows[0].timing_relevance, "today");
  assert.equal(inspect.time_sensitive_event_rows[0].source.url, "https://example.test/source-event-1");
  assert.equal(inspect.time_sensitive_event_rows[0].raw_payload, undefined);
});

test("city-pulse source inspect includes time-sensitive event rows without rendering them as live events", async () => {
  const pulse = await buildCityPulse(
    {
      ...city,
      timezone: "Europe/Rome",
      services: {
        pulseSourceProviders: [
          providerSpec({
            events: [],
            time_sensitive_events: [
              {
                id: "river-market",
                title: "River night market",
                starts_at: "2026-07-10T18:00:00.000Z",
                ends_at: "2026-07-10T22:00:00.000Z",
                confidence: "strong",
                source_url: "https://example.test/river-market",
                source_label: "Official city calendar",
                route_role_hint: "market_stop",
              },
            ],
          }),
        ],
      },
    },
    {
      date: "2026-07-10",
      now: new Date("2026-07-10T19:00:00.000Z"),
      inspectSources: true,
      lang: "en",
    },
  );

  assert.deepEqual(pulse.events, [], "time-sensitive source events are not legacy live events");
  assert.equal(pulse.source_provider_inspect.normalized_time_sensitive_event_count, 1);
  assert.equal(pulse.source_provider_inspect.time_sensitive_event_rows[0].timing_relevance, "now");
  assert.equal(pulse.source_provider_inspect.time_sensitive_event_rows[0].route_role_hint, "market_stop");
});

test("buildCityPulse defaults `now` so the staleness guardrail holds on the real (now-less) /api path", async () => {
  // The real /api/city-pulse route calls buildCityPulse WITHOUT `now`. The
  // staleness downgrade must still apply — an expired event a provider claims
  // is "now" must not be trusted verbatim just because the caller omitted now.
  const pulse = await buildCityPulse(
    {
      ...city,
      timezone: "Europe/Rome",
      services: {
        pulseSourceProviders: [
          providerSpec({
            events: [],
            time_sensitive_events: [
              {
                id: "expired-market",
                title: "Yesteryear market",
                timing_relevance: "now",
                starts_at: "2020-01-01T18:00:00.000Z",
                ends_at: "2020-01-01T22:00:00.000Z",
                confidence: "strong",
                source_url: "https://example.test/old-market",
                source_label: "Official city calendar",
              },
            ],
          }),
        ],
      },
    },
    { date: "2026-07-10", inspectSources: true, lang: "en" }, // NOTE: no `now`
  );

  const row = pulse.source_provider_inspect.time_sensitive_event_rows[0];
  assert.equal(row.timing_relevance, "stale", "expired event must be stale even without an injected now");
  assert.equal(row.confidence, "low", "a stale event cannot keep strong confidence");
});

test("pulse source registry core has no city-specific branches", () => {
  const files = [
    "server/pulse-sources/source-descriptor.js",
    "server/pulse-sources/provider-registry.js",
    "server/pulse-sources/normalize-event.js",
    "server/pulse-sources/display-gates.js",
    "server/pulse-sources/dedupe.js",
    "server/pulse-sources/time-sensitive-event.js",
  ];
  const source = files.map((file) => fs.readFileSync(path.join(root, file), "utf8")).join("\n");
  const stripped = source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

  assert.doesNotMatch(stripped, /city\s*={2,3}\s*["'](?:barcelona|rome|athens)["']/i);
  assert.doesNotMatch(stripped, /city\.key\s*={2,3}\s*["'](?:barcelona|rome|athens)["']/i);
  assert.doesNotMatch(stripped, /plannerCityKey/i);
});
