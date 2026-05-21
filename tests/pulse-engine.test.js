const assert = require("node:assert/strict");
const test = require("node:test");

const { buildCityPulse } = require("../server/pulse-engine");
const { buildEngineContext, buildCityNow } = require("../server/pulse-engine/context");
const {
  normalizeSignal,
  buildSignalLabel,
  CHIPPABLE_SIGNAL_TYPES,
} = require("../server/pulse-engine/normalize");
const { scoreSignals } = require("../server/pulse-engine/rank");
const goldenHourGenerator = require("../server/pulse-engine/generators/golden-hour");
const liveEventsGenerator = require("../server/pulse-engine/generators/live-events");

const fakeCity = {
  key: "test-city",
  label: "Teststad",
  timezone: "Europe/Madrid",
  center: { lat: 41.3874, lng: 2.1686 },
};

function fakeContext(overrides = {}) {
  return buildEngineContext({
    cityConfig: fakeCity,
    date: "2026-05-20",
    now: new Date("2026-05-20T16:00:00Z"),
    lang: "sv",
    ...overrides,
  });
}

test("buildCityNow returnerar city-lokal tid via Intl", () => {
  const now = new Date("2026-05-20T14:30:00Z"); // 16:30 i Madrid (CEST)
  const cityNow = buildCityNow(now, "Europe/Madrid");
  assert.equal(cityNow.year, 2026);
  assert.equal(cityNow.month, 5);
  assert.equal(cityNow.day, 20);
  assert.equal(cityNow.hour, 16);
  assert.equal(cityNow.minute, 30);
  assert.equal(cityNow.isoDate, "2026-05-20");
});

test("buildEngineContext kräver tz och date", () => {
  assert.throws(() =>
    buildEngineContext({ cityConfig: fakeCity, date: null }),
  );
  assert.throws(() =>
    buildEngineContext({
      cityConfig: { ...fakeCity, timezone: undefined },
      date: "2026-05-20",
    }),
  );
});

test("normalizeSignal fyller på defaults och behåller legacy fält", () => {
  const ctx = fakeContext();
  const raw = {
    type: "evening_window",
    title: "Test signal",
    reason: "Något händer",
    kind: "Stadens rytm",
  };
  const sig = normalizeSignal(raw, ctx);
  assert.equal(sig.type, "evening_window");
  assert.equal(sig.title, "Test signal");
  assert.equal(sig.reason, "Något händer");
  assert.equal(sig.why_it_matters, "Något händer");
  assert.equal(sig.kind, "Stadens rytm");
  assert.equal(sig.city, "test-city");
  assert.equal(sig.source.kind, "editorial");
  assert.equal(sig.trust_level, "editorial");
  assert.equal(sig.signal_label, "Kvällsfönster");
});

test("normalizeSignal returnerar null för ogiltiga raw signals", () => {
  const ctx = fakeContext();
  assert.equal(normalizeSignal(null, ctx), null);
  assert.equal(normalizeSignal({}, ctx), null);
  assert.equal(normalizeSignal({ type: "evening_window" }, ctx), null);
  assert.equal(normalizeSignal({ title: "no type" }, ctx), null);
});

test("buildSignalLabel ger null för icke-chippable typer", () => {
  assert.equal(buildSignalLabel("local_timing_advice", "sv"), null);
  assert.equal(buildSignalLabel("evening_window", "sv"), "Kvällsfönster");
  assert.equal(buildSignalLabel("evening_window", "en"), "Evening window");
  assert.equal(buildSignalLabel("golden_hour", "en"), "Golden hour");
  assert.equal(buildSignalLabel("live_event_nearby", "sv"), "Live event");
  assert.ok(CHIPPABLE_SIGNAL_TYPES.has("crowd_warning"));
  assert.ok(!CHIPPABLE_SIGNAL_TYPES.has("local_timing_advice"));
});

test("scoreSignals rankar live event före editorial fallback", () => {
  const ctx = fakeContext();
  const a = normalizeSignal(
    { type: "local_timing_advice", title: "Editorial filler", score: 0 },
    ctx,
  );
  const b = normalizeSignal(
    {
      type: "live_event_nearby",
      title: "Real event",
      score: 6,
      source: { kind: "live_feed", label: "Open Data BCN" },
    },
    ctx,
  );
  const ranked = scoreSignals([a, b], ctx);
  assert.equal(ranked[0].title, "Real event");
});

test("golden-hour generator emittar EJ utanför eligible månader", () => {
  const winter = fakeContext({
    date: "2026-12-15",
    now: new Date("2026-12-15T16:30:00Z"),
  });
  const out = goldenHourGenerator(winter);
  assert.deepEqual(out, []);
});

test("golden-hour generator emittar EJ kl 07:00 (för tidigt)", () => {
  const ctx = fakeContext({ now: new Date("2026-05-20T05:00:00Z") }); // 07:00 Madrid
  const out = goldenHourGenerator(ctx);
  assert.deepEqual(out, []);
});

test("golden-hour generator emittar EJ kl 01:00 (sunset för länge sedan)", () => {
  const ctx = fakeContext({ now: new Date("2026-05-19T23:00:00Z") }); // 01:00 next day
  const out = goldenHourGenerator(ctx);
  assert.deepEqual(out, []);
});

test("golden-hour generator emittar TONIGHT vid 14:00 i maj", () => {
  const ctx = fakeContext({ now: new Date("2026-05-20T12:00:00Z") }); // 14:00 Madrid
  const out = goldenHourGenerator(ctx);
  assert.equal(out.length, 1);
  assert.equal(out[0].type, "golden_hour");
  assert.equal(out[0].source.kind, "computed");
});

test("golden-hour generator emittar ACTIVE när nu ligger nära sunset", () => {
  // Madrid sunset ~21:15 lokal i slutet av maj
  const ctx = fakeContext({ now: new Date("2026-05-20T19:15:00Z") }); // 21:15 Madrid
  const out = goldenHourGenerator(ctx);
  assert.equal(out.length, 1);
  // SV title uses the natural "Kvällsljuset" framing, not the English
  // "Golden hour" loanword. The chip label ("Solnedgång") still carries
  // the categorical tag separately.
  assert.ok(/kvällsljuset/i.test(out[0].title));
  assert.doesNotMatch(out[0].title, /golden hour/i);
});

test("golden-hour generator använder Kvällsljuset på SV och Golden hour på EN", () => {
  // Active window, both languages.
  const ctxSv = fakeContext({ now: new Date("2026-05-20T19:15:00Z"), lang: "sv" });
  const ctxEn = fakeContext({ now: new Date("2026-05-20T19:15:00Z"), lang: "en" });
  assert.match(goldenHourGenerator(ctxSv)[0].title, /Kvällsljuset är här nu/);
  assert.match(goldenHourGenerator(ctxEn)[0].title, /Golden hour is happening now/);

  // Upcoming window.
  const ctxUpcomingSv = fakeContext({ now: new Date("2026-05-20T18:00:00Z"), lang: "sv" });
  const ctxUpcomingEn = fakeContext({ now: new Date("2026-05-20T18:00:00Z"), lang: "en" });
  assert.match(goldenHourGenerator(ctxUpcomingSv)[0].title, /Kvällsljuset närmar sig kl/);
  assert.match(goldenHourGenerator(ctxUpcomingEn)[0].title, /Golden hour is coming up at/);

  // Tonight window (afternoon).
  const ctxTonightSv = fakeContext({ now: new Date("2026-05-20T12:00:00Z"), lang: "sv" });
  const ctxTonightEn = fakeContext({ now: new Date("2026-05-20T12:00:00Z"), lang: "en" });
  assert.match(goldenHourGenerator(ctxTonightSv)[0].title, /Kvällsljuset landar runt/);
  assert.match(goldenHourGenerator(ctxTonightEn)[0].title, /Tonight's golden hour lands around/);
});

test("live-events generator emittar safe_headline med kindLabel + venue/city, aldrig source-label", () => {
  // With a venue: prefer "{KindLabel} på {venue}".
  const ctxWithVenue = fakeContext({
    events: [
      {
        id: "evt-venue",
        title: "Concert al barri de Sant Antoni amb cor i orquestra",
        start_date: "2026-05-20",
        end_date: "2026-05-20",
        source_language: "ca",
        source_label: "Open Data BCN",
        venue: "Centre Cívic Cotxeres de Sants",
        match_tags: ["music"],
      },
    ],
  });
  const withVenue = liveEventsGenerator(ctxWithVenue)[0];
  assert.equal(withVenue.safe_headline, "Konsert på Centre Cívic Cotxeres de Sants");
  assert.doesNotMatch(withVenue.safe_headline, /Open Data BCN/);

  // Without a venue: fall back to "{KindLabel} i {cityLabel}".
  const ctxNoVenue = fakeContext({
    events: [
      {
        id: "evt-novenue",
        title: "Concert sense local fix",
        start_date: "2026-05-20",
        end_date: "2026-05-20",
        source_language: "ca",
        source_label: "Open Data BCN",
        match_tags: ["music"],
      },
    ],
  });
  const noVenue = liveEventsGenerator(ctxNoVenue)[0];
  assert.equal(noVenue.safe_headline, "Konsert i Teststad");
  assert.doesNotMatch(noVenue.safe_headline, /Open Data BCN/);

  // English UI: "{KindLabel} at {venue}".
  const ctxEnglish = fakeContext({
    lang: "en",
    events: [
      {
        id: "evt-en",
        title: "Concert al barri de Sant Antoni",
        start_date: "2026-05-20",
        end_date: "2026-05-20",
        source_language: "ca",
        source_label: "Open Data BCN",
        venue: "Centre Cívic Cotxeres de Sants",
        match_tags: ["music"],
      },
    ],
  });
  const english = liveEventsGenerator(ctxEnglish)[0];
  assert.equal(english.safe_headline, "Concert at Centre Cívic Cotxeres de Sants");
});

test("live-events generator droppar events som redan slutat", () => {
  const ctx = fakeContext({
    now: new Date("2026-05-20T15:00:00Z"),
    events: [
      {
        id: "past",
        title: "Yesterday",
        start_date: "2026-05-18",
        end_date: "2026-05-19",
      },
      {
        id: "today",
        title: "Today",
        start_date: "2026-05-20",
        end_date: "2026-05-20",
      },
    ],
  });
  const out = liveEventsGenerator(ctx);
  assert.equal(out.length, 1);
  assert.equal(out[0].id, "official-today");
});

test("live-events generator droppar events som inte startat än", () => {
  const ctx = fakeContext({
    now: new Date("2026-05-20T15:00:00Z"),
    events: [
      {
        id: "future",
        title: "Next week",
        start_date: "2026-05-25",
        end_date: "2026-05-25",
      },
      {
        id: "today",
        title: "Today",
        start_date: "2026-05-20",
        end_date: "2026-05-20",
      },
    ],
  });
  const out = liveEventsGenerator(ctx);
  assert.equal(out.length, 1);
  assert.equal(out[0].id, "official-today");
});

test("live-events generator sätter source.kind: live_feed och label", () => {
  const ctx = fakeContext({
    events: [
      {
        id: "evt1",
        title: "Konsert",
        start_date: "2026-05-20",
        end_date: "2026-05-20",
        source_label: "Open Data BCN",
        source_url: "https://opendata.bcn",
      },
    ],
  });
  const out = liveEventsGenerator(ctx);
  assert.equal(out[0].source.kind, "live_feed");
  assert.equal(out[0].source.label, "Open Data BCN");
  assert.equal(out[0].source.url, "https://opendata.bcn");
});

test("buildCityPulse returnerar signals[] för noop-stad utan fel", async () => {
  const noopCity = {
    key: "empty",
    label: "Empty City",
    timezone: "Europe/Madrid",
    center: { lat: 41.0, lng: 2.0 },
    services: {
      fetchLiveEventsForDates: async () => ({}),
      fetchWeatherForDates: async () => ({}),
      signalGenerators: [],
    },
  };
  const result = await buildCityPulse(noopCity, {
    date: "2026-12-15",
    now: new Date("2026-12-15T03:00:00Z"),
    lang: "sv",
  });
  assert.equal(result.city, "empty");
  assert.ok(Array.isArray(result.signals));
  // December + 03:00 → no golden hour, no live events → honest empty
  assert.deepEqual(result.signals, []);
});

test("buildCityPulse wakes a noop city up via city-agnostic live events", async () => {
  const wakeCity = {
    key: "wake",
    label: "Wake City",
    timezone: "Europe/Madrid",
    center: { lat: 41.3874, lng: 2.1686 },
    services: {
      fetchLiveEventsForDates: async () => ({
        "2026-05-20": [
          {
            id: "wake-1",
            title: "Music night",
            start_date: "2026-05-20",
            end_date: "2026-05-20",
            source_label: "Open Data BCN",
            match_tags: ["music"],
          },
        ],
      }),
      fetchWeatherForDates: async () => ({}),
      signalGenerators: [],
    },
  };
  const result = await buildCityPulse(wakeCity, {
    date: "2026-05-20",
    now: new Date("2026-05-20T03:00:00Z"),
    lang: "sv",
  });
  const liveSignals = result.signals.filter((s) => s.type === "live_event_nearby");
  assert.equal(liveSignals.length, 1);
  assert.equal(liveSignals[0].source.label, "Open Data BCN");
  assert.equal(liveSignals[0].signal_label, "Live event");
});
