const assert = require("node:assert/strict");
const test = require("node:test");

const {
  normalizeTimeSensitiveSourceEvent,
  normalizeTimingRelevance,
} = require("../server/pulse-sources");

const NOW = "2026-07-10T18:30:00.000Z";

function event(overrides = {}) {
  return {
    id: "night-market-1",
    title: "Riverfront night market",
    source_url: "https://example.test/events/night-market-1",
    source_label: "Official city calendar",
    source_type: "official_open_data",
    source_tier: "official",
    city: "any-city",
    lat: "41.9",
    lng: "12.49",
    area: "riverfront",
    address: "River Street 7",
    starts_at: "2026-07-10T17:00:00.000Z",
    ends_at: "2026-07-10T22:00:00.000Z",
    last_checked: "2026-07-10T09:00:00.000Z",
    confidence: "strong",
    tags: ["market", "evening"],
    intents: ["markets", "nightlife"],
    route_role_hint: "market_stop",
    ...overrides,
  };
}

test("current time-sensitive source event is normalized as relevant now", () => {
  const normalized = normalizeTimeSensitiveSourceEvent(event(), { now: NOW });

  assert.equal(normalized.candidate_kind, "source_event");
  assert.equal(normalized.timing_relevance, "now");
  assert.equal(normalized.confidence, "strong");
  assert.equal(normalized.lat, 41.9);
  assert.equal(normalized.lng, 12.49);
  assert.equal(normalized.route_role_hint, "market_stop");
  assert.equal(normalized.address, "River Street 7");
  assert.deepEqual(normalized.intents, ["markets", "nightlife"]);
  assert.ok(normalized.timing_reasons.includes("has_source_backing"));
});

test("future event is not classified as now", () => {
  const normalized = normalizeTimeSensitiveSourceEvent(
    event({
      id: "future-market",
      starts_at: "2026-07-12T17:00:00.000Z",
      ends_at: "2026-07-12T22:00:00.000Z",
    }),
    { now: NOW },
  );

  assert.equal(normalized.timing_relevance, "future");
  assert.notEqual(normalized.timing_relevance, "now");
});

test("same-day evening event is classified as tonight before it starts", () => {
  const normalized = normalizeTimeSensitiveSourceEvent(
    event({
      starts_at: "2026-07-10T20:00:00.000Z",
      ends_at: "2026-07-10T23:00:00.000Z",
    }),
    { now: NOW },
  );

  assert.equal(normalized.timing_relevance, "tonight");
});

test("same-day daytime upcoming event is classified as today", () => {
  const normalized = normalizeTimeSensitiveSourceEvent(
    event({
      starts_at: "2026-07-10T14:00:00.000Z",
      ends_at: "2026-07-10T16:00:00.000Z",
    }),
    { now: "2026-07-10T10:00:00.000Z" },
  );

  assert.equal(normalized.timing_relevance, "today");
});

test("reviewed timezone classifies evening by venue-local hour", () => {
  const normalized = normalizeTimeSensitiveSourceEvent(
    event({
      starts_at: "2026-09-12T15:00:00.000Z",
      ends_at: "2026-09-12T20:00:00.000Z",
    }),
    {
      now: "2026-09-12T13:00:00.000Z",
      timezone: "Europe/Athens",
    },
  );

  assert.equal(normalized.timing_relevance, "tonight");
  assert.equal(normalized.timezone, "Europe/Athens");
});

test("reviewed timezone prevents UTC date from masking a local next day", () => {
  const normalized = normalizeTimeSensitiveSourceEvent(
    event({
      starts_at: "2026-07-14T22:30:00.000Z",
      ends_at: "2026-07-14T23:30:00.000Z",
    }),
    {
      now: "2026-07-14T21:30:00.000Z",
      timezone: "Europe/Stockholm",
    },
  );

  assert.equal(normalized.timing_relevance, "future");
});

test("local date-only facts stay local and never become UTC midnight instants", () => {
  const normalized = normalizeTimeSensitiveSourceEvent(
    event({
      starts_at: "2026-07-15",
      ends_at: "2026-07-17",
    }),
    { now: NOW, timezone: "Europe/Stockholm" },
  );

  assert.equal(normalized.starts_at, undefined);
  assert.equal(normalized.ends_at, undefined);
  assert.equal(normalized.starts_on, "2026-07-15");
  assert.equal(normalized.ends_on, "2026-07-17");
  assert.deepEqual(normalized.time_window, {
    kind: "all_day",
    starts_on: "2026-07-15",
    ends_on: "2026-07-17",
  });
  assert.equal(normalized.timing_relevance, "unknown");
});

test("daily windows do not become continuous multi-day events between openings", () => {
  const dailyEvent = event({
    starts_at: null,
    ends_at: null,
    starts_on: "2026-07-15",
    ends_on: "2026-07-17",
    time_window: {
      kind: "daily",
      local_start: "10:00",
      local_end: "17:00",
    },
  });
  const betweenOpenings = normalizeTimeSensitiveSourceEvent(dailyEvent, {
    now: "2026-07-15T18:00:00.000Z",
    timezone: "Europe/Stockholm",
  });
  const duringOpening = normalizeTimeSensitiveSourceEvent(dailyEvent, {
    now: "2026-07-16T10:00:00.000Z",
    timezone: "Europe/Stockholm",
  });
  const afterFinalOpening = normalizeTimeSensitiveSourceEvent(dailyEvent, {
    now: "2026-07-17T16:00:00.000Z",
    timezone: "Europe/Stockholm",
  });

  assert.equal(betweenOpenings.timing_relevance, "future");
  assert.equal(duringOpening.timing_relevance, "now");
  assert.equal(afterFinalOpening.timing_relevance, "stale");
  assert.equal(duringOpening.starts_at, undefined);
  assert.deepEqual(duringOpening.time_window, {
    kind: "daily",
    starts_on: "2026-07-15",
    ends_on: "2026-07-17",
    local_start: "10:00",
    local_end: "17:00",
    timezone: "Europe/Stockholm",
  });
});

test("continuous multi-day events remain explicit instants", () => {
  const normalized = normalizeTimeSensitiveSourceEvent(
    event({
      starts_at: "2026-07-15T08:00:00.000Z",
      ends_at: "2026-07-17T15:00:00.000Z",
    }),
    { now: "2026-07-16T02:00:00.000Z", timezone: "Europe/Stockholm" },
  );

  assert.equal(normalized.timing_relevance, "now");
  assert.equal(normalized.time_window.kind, "continuous");
});

test("ambiguous DST folds fail closed unless the source provides an explicit offset", () => {
  const ambiguous = normalizeTimeSensitiveSourceEvent(
    event({
      starts_at: "2026-10-25 02:30:00",
      ends_at: "2026-10-25 03:30:00",
    }),
    { now: "2026-10-24T12:00:00.000Z", timezone: "Europe/Stockholm" },
  );
  const explicit = normalizeTimeSensitiveSourceEvent(
    event({
      starts_at: "2026-10-25T02:30:00+02:00",
      ends_at: "2026-10-25T03:30:00+01:00",
    }),
    { now: "2026-10-24T12:00:00.000Z", timezone: "Europe/Stockholm" },
  );

  assert.equal(ambiguous.starts_at, undefined);
  assert.equal(ambiguous.timing_relevance, "unknown");
  assert.equal(explicit.starts_at, "2026-10-25T00:30:00.000Z");
  assert.equal(explicit.ends_at, "2026-10-25T02:30:00.000Z");
});

test("expired or stale events are downgraded instead of promoted", () => {
  const expired = normalizeTimeSensitiveSourceEvent(
    event({
      starts_at: "2026-07-09T17:00:00.000Z",
      ends_at: "2026-07-09T22:00:00.000Z",
      confidence: "strong",
    }),
    { now: NOW },
  );
  const stale = normalizeTimeSensitiveSourceEvent(event({ freshness: "stale", confidence: "medium" }), { now: NOW });

  assert.equal(expired.timing_relevance, "stale");
  assert.equal(expired.confidence, "low");
  assert.equal(stale.timing_relevance, "stale");
  assert.equal(stale.confidence, "low");
});

test("explicit timing relevance cannot promote an expired event", () => {
  const normalized = normalizeTimeSensitiveSourceEvent(
    event({
      timing_relevance: "now",
      starts_at: "2026-07-09T17:00:00.000Z",
      ends_at: "2026-07-09T22:00:00.000Z",
      confidence: "strong",
    }),
    { now: NOW },
  );

  assert.equal(normalized.timing_relevance, "stale");
  assert.equal(normalized.confidence, "low");
  assert.ok(normalized.timing_reasons.includes("timing_stale"));
  assert.ok(!normalized.timing_reasons.includes("timing_now"));
});

test("event without source or provenance cannot receive strong confidence", () => {
  const normalized = normalizeTimeSensitiveSourceEvent(
    event({
      source_url: "",
      source_label: "",
      provenance: null,
      confidence: "strong",
    }),
    { now: NOW },
  );

  assert.equal(normalized.confidence, "medium");
  assert.ok(normalized.timing_reasons.includes("missing_source_backing"));
  assert.ok(!normalized.timing_reasons.includes("confidence_strong"));
});

test("local-language event metadata is preserved without blocking normalization", () => {
  const normalized = normalizeTimeSensitiveSourceEvent(
    event({
      title: "Θερινή αγορά στη γειτονιά",
      source_language: "el",
      event_language: "el",
      translation_status: "provided",
      translation_confidence: "medium",
      translated_atoms: ["category", "status"],
    }),
    { now: NOW },
  );

  assert.equal(normalized.title, "Θερινή αγορά στη γειτονιά");
  assert.equal(normalized.source_language, "el");
  assert.equal(normalized.event_language, "el");
  assert.equal(normalized.translation_status, "provided");
  assert.equal(normalized.translation_confidence, "medium");
  assert.deepEqual(normalized.translated_atoms, ["category", "status"]);
  assert.equal(normalized.timing_relevance, "now");
});

test("contract is city-agnostic and does not branch on specific city keys", () => {
  const bologna = normalizeTimeSensitiveSourceEvent(event({ city: "bologna", title: "Seasonal street market" }), {
    now: NOW,
  });
  const simrishamn = normalizeTimeSensitiveSourceEvent(event({ city: "simrishamn", title: "Harbor culture night" }), {
    now: NOW,
  });

  assert.equal(bologna.timing_relevance, simrishamn.timing_relevance);
  assert.equal(bologna.candidate_kind, "source_event");
  assert.equal(simrishamn.candidate_kind, "source_event");

  const source = require("node:fs").readFileSync(require.resolve("../server/pulse-sources/time-sensitive-event"), "utf8");
  assert.ok(!/barcelona|rome|athens|tiber/i.test(source));
});

test("normalizeTimingRelevance handles invalid or missing time honestly", () => {
  assert.equal(normalizeTimingRelevance(null, {}), "unknown");
  assert.equal(normalizeTimingRelevance("future", {}), "future");
  assert.equal(normalizeTimingRelevance("made_up", { now: new Date(NOW) }), "unknown");
});
