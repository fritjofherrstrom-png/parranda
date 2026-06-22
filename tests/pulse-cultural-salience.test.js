/**
 * Cultural-relevance salience for Pulse.
 *
 * A live city feed mixes real happenings (concerts, exhibitions, festivals) with
 * administrative/civic notices (council/committee meetings). Without salience,
 * timing/confidence ranking treats a council meeting like a concert, so a
 * bureaucratic notice can headline the live experience. These tests cover the
 * generic, multilingual classifier; that the ranker lifts cultural signals above
 * administrative noise; and that the masthead keeps administrative notices out of
 * the page headline whenever a non-administrative signal can lead instead.
 *
 * Scope guard: this is Pulse ranking + masthead only — no Pulse→Blitz, no
 * Pulse→Planner, no route composition.
 */

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  classifyCulturalSalience,
  CULTURAL_WEIGHT,
  ADMINISTRATIVE_WEIGHT,
  NEUTRAL_WEIGHT,
} = require("../server/pulse-engine/cultural-salience");
const { scoreSignals } = require("../server/pulse-engine/rank");
const { buildMasthead } = require("../server/pulse-engine/masthead");

// --- classifier: generic + multilingual -----------------------------------

test("classifies culturally relevant happenings as cultural (EN / Greek / Swedish)", () => {
  for (const title of [
    "Jazz concert at the Megaron",
    "Photography exhibition opening",
    "Summer festival on the square",
    "Συναυλία τζαζ στο Μέγαρο", // Greek: jazz concert
    "Έκθεση φωτογραφίας", // Greek: photography exhibition
    "Konsert i parken ikväll", // Swedish
    "Utställning på museet", // Swedish
  ]) {
    const out = classifyCulturalSalience({ title });
    assert.equal(out.tier, "cultural", title);
    assert.equal(out.weight, CULTURAL_WEIGHT, title);
  }
});

test("classifies civic/admin notices as administrative (EN / Greek / Swedish)", () => {
  for (const title of [
    "City Council Meeting",
    "Finance Committee — public hearing",
    "Συνεδρίαση Δημοτικού Συμβουλίου", // Greek: municipal council session
    "Δημοτικό Συμβούλιο: προϋπολογισμός", // Greek: council budget
    "Kommunfullmäktige sammanträde", // Swedish: municipal council meeting
    "Kommunstyrelsen — protokoll", // Swedish
  ]) {
    const out = classifyCulturalSalience({ title });
    assert.equal(out.tier, "administrative", title);
    assert.equal(out.weight, ADMINISTRATIVE_WEIGHT, title);
  }
});

test("cultural cue wins an ambiguous title so real culture is never wrongly demoted", () => {
  // A concert ABOUT the city council still reads as a cultural happening.
  const out = classifyCulturalSalience({ title: "Concert: songs about the city council" });
  assert.equal(out.tier, "cultural");
});

test("non-cultural / non-admin text is neutral and unweighted", () => {
  for (const title of ["Golden hour is starting", "Quiet now, busier later", ""]) {
    const out = classifyCulturalSalience({ title });
    assert.equal(out.tier, "neutral", title);
    assert.equal(out.weight, NEUTRAL_WEIGHT, title);
  }
});

test("classifier reads tags/intents, not just the title", () => {
  const out = classifyCulturalSalience({ title: "Tonight at the venue", tags: ["concert", "music"] });
  assert.equal(out.tier, "cultural");
});

// --- ranking: cultural lifts, administrative demotes ------------------------

function liveSignal(overrides) {
  return {
    type: "live_event_nearby",
    trust_level: "official",
    freshness: "today",
    score: 5,
    ...overrides,
  };
}

test("a cultural event ranks above an administrative notice with otherwise-equal weights", () => {
  const ranked = scoreSignals(
    [
      liveSignal({ id: "council", title: "Συνεδρίαση Δημοτικού Συμβουλίου" }),
      liveSignal({ id: "concert", title: "Jazz Concert at the Megaron" }),
    ],
    {},
  );
  assert.equal(ranked[0].id, "concert", "the Megaron concert leads, not the council meeting");
  assert.equal(ranked[0].cultural_salience, "cultural");
  assert.equal(ranked[1].cultural_salience, "administrative");
  assert.ok(ranked[0].score > ranked[1].score);
  // Administrative is demoted, never zeroed — it is still a real current signal.
  assert.ok(ranked[1].score > 0);
});

test("neutral signals are byte-identical to pre-salience output (no tag, weight 1)", () => {
  const [neutral] = scoreSignals([liveSignal({ id: "n", title: "Golden hour is starting" })], {});
  assert.equal(neutral.cultural_salience, undefined, "neutral signals carry no salience tag");
  // weight 1 → score equals the plain trust×fresh×type×base product.
  const base = 1 + 5 * 0.1;
  const expected = Number((1.3 * 1.2 * 1.35 * base).toFixed(3)); // official × today × live_event_nearby
  assert.equal(neutral.score, expected);
});

// --- masthead: administrative notices stay out of the headline --------------

// Mirror the proven promotable-signal factory from pulse-masthead.test.js so
// these signals actually render (a real place target, type-aware source/trust),
// then layer on the ranker-supplied cultural_salience tag.
function mastheadSignal(overrides) {
  const type = overrides.type || "live_event_nearby";
  const isLive = type === "live_event_nearby";
  const isComputed = ["golden_hour", "evening_window", "crowd_warning", "local_timing_advice"].includes(type);
  return {
    id: overrides.id || `id-${type}`,
    type,
    title: overrides.title || `Title for ${type}`,
    reason: overrides.reason || `Reason for ${type}`,
    signal_label: overrides.signal_label || null,
    when: overrides.when || "Today",
    source:
      overrides.source ||
      (isLive
        ? { kind: "live_feed", label: "Official Agenda", url: "https://example.test/event" }
        : isComputed
          ? { kind: "computed", label: "city local time" }
          : { kind: "editorial" }),
    trust_level: overrides.trust_level || (isLive ? "official" : isComputed ? "verified" : "editorial"),
    official_event_id: isLive ? (overrides.official_event_id || "evt-test") : overrides.official_event_id,
    venue: isLive ? (overrides.venue || "Megaron Concert Hall") : overrides.venue,
    ...overrides,
  };
}

test("masthead skips an administrative notice when a cultural signal can headline", () => {
  const result = buildMasthead({
    signals: [
      mastheadSignal({ id: "council", title: "City Council Meeting", venue: "Town Hall", cultural_salience: "administrative" }),
      mastheadSignal({ id: "concert", title: "Jazz Concert at the Megaron", venue: "Megaron Concert Hall", cultural_salience: "cultural" }),
    ],
    fallback: { headline: "fb", subhead: "fbs" },
    lang: "en",
  });
  assert.equal(result.source, "signal");
  assert.equal(result.signal_id, "concert", "the cultural happening leads the masthead");
});

test("masthead skips an administrative notice in favor of a neutral renderable signal too", () => {
  const result = buildMasthead({
    signals: [
      mastheadSignal({ id: "council", title: "City Council Meeting", venue: "Town Hall", cultural_salience: "administrative" }),
      mastheadSignal({ id: "golden", type: "golden_hour", title: "Golden hour is starting now" }),
    ],
    fallback: { headline: "fb", subhead: "fbs" },
    lang: "en",
  });
  assert.equal(result.source, "signal");
  assert.equal(result.signal_id, "golden", "a non-administrative signal leads over the council notice");
});

test("an administrative notice may still headline as a last resort when nothing else is renderable", () => {
  const result = buildMasthead({
    signals: [
      mastheadSignal({ id: "council", title: "City Council Meeting", venue: "Town Hall", cultural_salience: "administrative" }),
    ],
    fallback: { headline: "fb", subhead: "fbs" },
    lang: "en",
  });
  assert.equal(result.source, "signal");
  assert.equal(result.signal_id, "council");
});
