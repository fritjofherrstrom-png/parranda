const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  SourceProviderRegistry,
  collectPulseSourcesForCity,
  normalizeSourceDescriptor,
  normalizeSourceEvent,
  normalizeSourceSignal,
} = require("../server/pulse-sources");
const { buildDisplayGate } = require("../server/pulse-sources/display-gates");

const root = path.join(__dirname, "..");
const city = { key: "test-source-city", label: "Test Source City" };

function descriptor(overrides = {}) {
  return {
    id: "test-official-agenda",
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
        };
      },
    },
  };
}

test("source descriptor validates role, trust and cache policy", () => {
  const normalized = normalizeSourceDescriptor(descriptor());

  assert.equal(normalized.role, "official_live_baseline");
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
  assert.equal(result.source_status.length, 1);
  assert.equal(result.source_status[0].status, "failed");
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

test("pulse source registry core has no city-specific branches", () => {
  const files = [
    "server/pulse-sources/source-descriptor.js",
    "server/pulse-sources/provider-registry.js",
    "server/pulse-sources/normalize-event.js",
    "server/pulse-sources/display-gates.js",
    "server/pulse-sources/dedupe.js",
  ];
  const source = files.map((file) => fs.readFileSync(path.join(root, file), "utf8")).join("\n");
  const stripped = source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

  assert.doesNotMatch(stripped, /city\s*={2,3}\s*["'](?:barcelona|rome|athens)["']/i);
  assert.doesNotMatch(stripped, /city\.key\s*={2,3}\s*["'](?:barcelona|rome|athens)["']/i);
  assert.doesNotMatch(stripped, /plannerCityKey/i);
});
