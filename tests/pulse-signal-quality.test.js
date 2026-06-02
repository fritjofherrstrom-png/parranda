const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { buildCityPulse } = require("../server/pulse-engine");
const { buildEngineContext } = require("../server/pulse-engine/context");
const { normalizeSignal } = require("../server/pulse-engine/normalize");
const {
  classifySignalQuality,
  isActionableSignal,
  isDisplayableSignal,
  isPromotableSignal,
} = require("../server/pulse-engine/signal-quality");

const root = path.join(__dirname, "..");

function context(overrides = {}) {
  return buildEngineContext({
    cityConfig: {
      key: "quality-city",
      label: "Quality City",
      timezone: "Europe/Madrid",
      center: { lat: 41.3874, lng: 2.1686 },
    },
    date: "2026-05-20",
    now: new Date("2026-05-20T16:00:00Z"),
    lang: "en",
    ...overrides,
  });
}

test("clear official live signals are displayable, promotable and actionable", () => {
  const signal = normalizeSignal(
    {
      type: "live_event_nearby",
      title: "Neighbourhood concert",
      venue: "Centre Civic Example",
      when: "Today",
      official_event_id: "evt-1",
      source: {
        kind: "live_feed",
        label: "Official Agenda",
        url: "https://example.test/events/evt-1",
      },
      trust_level: "official",
    },
    context(),
  );

  assert.equal(signal.signal_quality.confidence, "strong");
  assert.equal(signal.signal_quality.displayable, true);
  assert.equal(signal.signal_quality.promotable, true);
  assert.equal(signal.signal_quality.actionable, true);
  assert.ok(signal.signal_quality.reasons.includes("has_place_target"));
  assert.ok(signal.signal_quality.reasons.includes("has_timing"));
  assert.ok(signal.signal_quality.reasons.includes("has_source"));
});

test("weak placeholder live signals are not displayable or promotable", () => {
  const signal = normalizeSignal(
    {
      type: "live_event_nearby",
      title: "Concert at Barcelona venue",
      safe_headline: "Concert at Barcelona venue",
      venue: "Barcelona venue",
      when: "Today",
      official_event_id: "evt-placeholder",
      source: { kind: "live_feed", label: "Official Agenda" },
      trust_level: "official",
    },
    context(),
  );

  assert.equal(signal.signal_quality.confidence, "weak");
  assert.equal(signal.signal_quality.displayable, false);
  assert.equal(signal.signal_quality.promotable, false);
  assert.equal(isDisplayableSignal(signal), false);
  assert.equal(isPromotableSignal(signal), false);
});

test("URL-only live signals are displayable but not place-drawer actionable", () => {
  const signal = normalizeSignal(
    {
      type: "live_event_nearby",
      title: "Neighbourhood concert",
      when: "Today",
      source: {
        kind: "live_feed",
        label: "Official Agenda",
        url: "https://example.test/events/evt-url-only",
      },
      trust_level: "official",
    },
    context(),
  );

  assert.equal(signal.signal_quality.confidence, "medium");
  assert.equal(signal.signal_quality.displayable, true);
  assert.equal(signal.signal_quality.promotable, false);
  assert.equal(signal.signal_quality.actionable, true);
  assert.equal(isActionableSignal(signal), true);
  assert.ok(signal.signal_quality.reasons.includes("has_source_url"));
  assert.equal(Boolean(signal.official_event_id || signal.place_query || signal.related_stop_id), false);
});

test("computed rhythm signals stay honest medium-confidence signals", () => {
  const signal = normalizeSignal(
    {
      type: "evening_window",
      title: "The city is shifting into evening mode",
      source: { kind: "computed", label: "city local time" },
      trust_level: "verified",
      freshness: "live",
      when: "Soon",
    },
    context(),
  );

  assert.equal(signal.signal_quality.confidence, "medium");
  assert.equal(signal.signal_quality.displayable, true);
  assert.equal(signal.signal_quality.promotable, true);
  assert.equal(signal.signal_quality.actionable, false);
  assert.doesNotMatch(JSON.stringify(signal.signal_quality), /official/i);
});

test("buildCityPulse suppresses weak placeholder live signals before ranking", async () => {
  const city = {
    key: "weak-live-city",
    label: "Weak Live City",
    timezone: "Europe/Madrid",
    center: { lat: 41.3874, lng: 2.1686 },
    services: {
      fetchWeatherForDates: async () => ({}),
      fetchLiveEventsForDates: async () => ({
        "2026-05-20": [
          {
            id: "weak-1",
            title: "Concert at Barcelona venue",
            start_date: "2026-05-20",
            end_date: "2026-05-20",
            source_label: "Official Agenda",
            venue: "Barcelona venue",
            match_tags: ["music"],
          },
        ],
      }),
      signalGenerators: [],
    },
  };

  const result = await buildCityPulse(city, {
    date: "2026-05-20",
    now: new Date("2026-05-20T03:00:00Z"),
    lang: "en",
  });

  assert.equal(
    result.signals.some((signal) => signal.type === "live_event_nearby"),
    false,
  );
});

test("signal quality defaults to English semantics and Swedish only when requested elsewhere", () => {
  const quality = classifySignalQuality({
    type: "live_event_nearby",
    title: "Neighbourhood concert",
    where: "Centre Civic Example",
    when: "Today",
    official_event_id: "evt-2",
    source: { kind: "live_feed", label: "Official Agenda" },
    trust_level: "official",
  });

  assert.equal(quality.confidence, "strong");
  assert.deepEqual(
    quality.reasons.filter((reason) => /stark|svag|medel/i.test(reason)),
    [],
  );
});

test("signal quality layer has no city-specific branches", () => {
  const source = fs.readFileSync(path.join(root, "server/pulse-engine/signal-quality.js"), "utf8");
  const stripped = source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

  assert.doesNotMatch(stripped, /city\s*={2,3}\s*["'](?:barcelona|rome|athens)["']/i);
  assert.doesNotMatch(stripped, /city\.key\s*={2,3}\s*["'](?:barcelona|rome|athens)["']/i);
  assert.doesNotMatch(stripped, /plannerCityKey/i);
});
