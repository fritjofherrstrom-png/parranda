const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { buildEngineContext } = require("../server/pulse-engine/context");
const {
  normalizeSignal,
  normalizeEditorialPitch,
  BANNED_EDITORIAL_PITCH_PATTERNS,
} = require("../server/pulse-engine/normalize");
const goldenHourGenerator = require("../server/pulse-engine/generators/golden-hour");
const liveEventsGenerator = require("../server/pulse-engine/generators/live-events");

const repoRoot = path.resolve(__dirname, "..");

const fakeCity = {
  key: "test-city",
  label: "Barcelona",
  timezone: "Europe/Madrid",
  center: { lat: 41.3874, lng: 2.1686 },
};

function buildContext(overrides = {}) {
  return buildEngineContext({
    cityConfig: fakeCity,
    date: "2026-05-20",
    now: new Date("2026-05-20T19:15:00Z"),
    lang: "en",
    ...overrides,
  });
}

function liveEvent() {
  return {
    id: "barcelona-open-data-music",
    title: "Concert de barri a Barcelona",
    start_date: "2026-05-20",
    end_date: "2026-05-20",
    source_language: "ca",
    source_label: "Open Data BCN",
    source_id: "barcelona-open-data-agenda",
    venue: "Centre Cívic Example",
    match_tags: ["music", "kultur"],
  };
}

function assertCleanPitch(signal, { providerTitle, sourceLabels = [] } = {}) {
  const pitch = signal.editorial_pitch;
  assert.equal(typeof pitch, "string", `${signal.type} should carry editorial_pitch`);
  assert.ok(pitch.trim(), `${signal.type} pitch should not be empty`);
  assert.match(pitch, /[.!?]$/, "pitch should end in punctuation");

  const words = pitch.split(/\s+/).filter(Boolean);
  assert.ok(words.length >= 4, `pitch too short: ${pitch}`);
  assert.ok(words.length <= 24, `pitch too long: ${pitch}`);

  if (signal.blurb) {
    assert.notEqual(
      pitch.trim().toLowerCase(),
      signal.blurb.trim().toLowerCase(),
      "editorial_pitch must not duplicate blurb",
    );
  }

  const lower = pitch.toLowerCase();
  for (const value of [signal.title, providerTitle].filter(Boolean)) {
    assert.ok(
      !lower.startsWith(String(value).trim().toLowerCase()),
      `pitch must not start with title/provider title: ${pitch}`,
    );
  }

  for (const label of sourceLabels) {
    assert.doesNotMatch(pitch, new RegExp(escapeRegExp(label), "i"));
  }

  for (const pattern of BANNED_EDITORIAL_PITCH_PATTERNS) {
    assert.doesNotMatch(pitch, pattern);
  }
}

test("Pulse generators emit clean editorial_pitch where authored", () => {
  const goldenRaw = goldenHourGenerator(buildContext({ lang: "en" }))[0];
  const golden = normalizeSignal(goldenRaw, buildContext({ lang: "en" }));
  assert.equal(golden.type, "golden_hour");
  assert.equal(golden.editorial_pitch, "This is the window where view stops earn their place.");
  assertCleanPitch(golden);

  const liveCtx = buildContext({ lang: "en", events: [liveEvent()] });
  const liveRaw = liveEventsGenerator(liveCtx)[0];
  const live = normalizeSignal(liveRaw, liveCtx);
  assert.equal(live.type, "live_event_nearby");
  assert.equal(live.editorial_pitch, "Let the evening hinge on a real room, not another landmark.");
  assertCleanPitch(live, {
    providerTitle: "Concert de barri a Barcelona",
    sourceLabels: ["Open Data BCN"],
  });
});

test("editorial_pitch has SV/EN parity for authored city-agnostic signals", () => {
  const goldenSvCtx = buildContext({ lang: "sv" });
  const goldenEnCtx = buildContext({ lang: "en" });
  const goldenSv = normalizeSignal(goldenHourGenerator(goldenSvCtx)[0], goldenSvCtx);
  const goldenEn = normalizeSignal(goldenHourGenerator(goldenEnCtx)[0], goldenEnCtx);
  assert.ok(goldenSv.editorial_pitch);
  assert.ok(goldenEn.editorial_pitch);
  assert.notEqual(goldenSv.editorial_pitch, goldenEn.editorial_pitch);
  assertCleanPitch(goldenSv);
  assertCleanPitch(goldenEn);

  const liveSvCtx = buildContext({ lang: "sv", events: [liveEvent()] });
  const liveEnCtx = buildContext({ lang: "en", events: [liveEvent()] });
  const liveSv = normalizeSignal(liveEventsGenerator(liveSvCtx)[0], liveSvCtx);
  const liveEn = normalizeSignal(liveEventsGenerator(liveEnCtx)[0], liveEnCtx);
  assert.ok(liveSv.editorial_pitch);
  assert.ok(liveEn.editorial_pitch);
  assert.notEqual(liveSv.editorial_pitch, liveEn.editorial_pitch);
  assertCleanPitch(liveSv, { providerTitle: liveEvent().title, sourceLabels: ["Open Data BCN"] });
  assertCleanPitch(liveEn, { providerTitle: liveEvent().title, sourceLabels: ["Open Data BCN"] });
});

test("normalizeSignal rejects duplicate, provider-led, source-labeled, or filler pitches", () => {
  const ctx = buildContext();
  const base = {
    type: "live_event_nearby",
    title: "Concert de barri a Barcelona",
    blurb: "Concert at Centre Cívic Example.",
    source: { kind: "live_feed", label: "Open Data BCN" },
  };

  assert.equal(normalizeSignal({ ...base, editorial_pitch: base.blurb }, ctx).editorial_pitch, undefined);
  assert.equal(
    normalizeSignal({ ...base, editorial_pitch: "Concert de barri a Barcelona starts here." }, ctx)
      .editorial_pitch,
    undefined,
  );
  assert.equal(
    normalizeSignal({ ...base, editorial_pitch: "Open Data BCN makes this one clear." }, ctx)
      .editorial_pitch,
    undefined,
  );
  assert.equal(
    normalizeSignal({ ...base, editorial_pitch: "Worth checking out if you are nearby." }, ctx)
      .editorial_pitch,
    undefined,
  );
  assert.equal(
    normalizeEditorialPitch({ ...base, editorial_pitch: "Let the room set the pace" }),
    "Let the room set the pace.",
  );
});

test("server-side editorial_pitch implementation stays city-agnostic", () => {
  const files = [
    "server/pulse-engine/generators/live-events.js",
    "server/pulse-engine/generators/golden-hour.js",
    "server/pulse-engine/normalize.js",
  ];

  for (const file of files) {
    const source = fs.readFileSync(path.join(repoRoot, file), "utf8");
    assert.doesNotMatch(source, /city\s*={2,3}\s*["'](?:barcelona|rome)["']/i);
    assert.doesNotMatch(source, /city\.key\s*={2,3}\s*["'](?:barcelona|rome)["']/i);
    assert.doesNotMatch(source, /if\s*\([^)]*(?:barcelona|rome)[^)]*\)/i);
  }
});

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
