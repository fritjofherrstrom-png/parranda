const assert = require("node:assert/strict");
const test = require("node:test");

const { buildMasthead, PREFERRED_TYPES_FOR_HEADLINE } = require("../server/pulse-engine/masthead");

const FALLBACK = {
  headline: "Maj sätter Rom i kvällsläge — låt eftermiddagen bygga upp en sen kväll.",
  subhead: "Vårkvällarna gör Rom extra promenadvänligt.",
};

function signal(overrides) {
  const type = overrides.type;
  const isLive = type === "live_event_nearby";
  const isComputed = ["golden_hour", "evening_window", "crowd_warning", "local_timing_advice"].includes(type);

  return {
    id: overrides.id || `id-${type}`,
    type,
    title: overrides.title || `Title for ${type}`,
    reason: overrides.reason || `Reason for ${type}`,
    signal_label: overrides.signal_label || null,
    when: overrides.when || "Today",
    source: overrides.source || (isLive
      ? { kind: "live_feed", label: "Official Agenda", url: "https://example.test/event" }
      : isComputed
        ? { kind: "computed", label: "city local time" }
        : { kind: "editorial" }),
    trust_level: overrides.trust_level || (isLive ? "official" : isComputed ? "verified" : "editorial"),
    official_event_id: isLive ? (overrides.official_event_id || "evt-test") : overrides.official_event_id,
    venue: isLive ? (overrides.venue || "Centre Civic Example") : overrides.venue,
    ...overrides,
  };
}

test("masthead prefers live_event_nearby over local_timing_advice", () => {
  const result = buildMasthead({
    signals: [
      signal({ type: "local_timing_advice", title: "Editorial filler" }),
      signal({ type: "live_event_nearby", title: "Konsert ikväll", signal_label: "Live event" }),
    ],
    fallback: FALLBACK,
  });
  assert.equal(result.source, "signal");
  assert.equal(result.signal_type, "live_event_nearby");
  assert.equal(result.headline, "Konsert ikväll");
  assert.equal(result.signal_label, "Live event");
});

test("masthead keeps foreign provider titles out of the page headline (uses safe_headline, drops kind-with-source chip)", () => {
  const result = buildMasthead({
    lang: "en",
    signals: [
      signal({
        type: "live_event_nearby",
        title:
          "Trobada 'Comadreo Decidida por la VIHDA – El comadreig de les que lluiten per viure'",
        source_language: "ca",
        safe_headline: "Cultural event at Centre Civic Example",
        // Chip-shape value — should NEVER be promoted into the H1.
        kind: "Cultural event · Open Data BCN",
        kindLabel: "Cultural event",
        signal_label: "Live event",
      }),
    ],
    fallback: FALLBACK,
  });

  assert.equal(result.source, "signal");
  assert.equal(result.signal_type, "live_event_nearby");
  assert.equal(result.headline, "Cultural event at Centre Civic Example");
  assert.doesNotMatch(result.headline, /Comadreo|VIHDA|lluiten/);
  assert.doesNotMatch(
    result.headline,
    /Open Data BCN/,
    "the source label must not leak into the page H1",
  );
});

test("masthead falls back to kindLabel when foreign title has no safe_headline", () => {
  // Defensive: an older/imperfect generator that emits a foreign title
  // but no safe_headline must still produce a clean headline. kindLabel
  // is the next safest field (no source label, no chip shape).
  const result = buildMasthead({
    lang: "sv",
    signals: [
      signal({
        type: "live_event_nearby",
        title: "Concert al barri de Sant Antoni",
        source_language: "ca",
        kindLabel: "Konsert",
        kind: "Konsert · Open Data BCN",
        signal_label: "Live event",
      }),
    ],
    fallback: FALLBACK,
  });

  assert.equal(result.source, "signal");
  assert.equal(result.headline, "Konsert");
  assert.doesNotMatch(result.headline, /Open Data BCN/);
});

test("masthead compacts long signal headlines when no safer label exists", () => {
  const result = buildMasthead({
    signals: [
      signal({
        type: "golden_hour",
        title:
          "Golden hour is lining up with a long waterfront drift that should not overwhelm the masthead layout on narrow screens",
      }),
    ],
    fallback: FALLBACK,
  });

  assert.match(result.headline, /\.\.\.$/);
  assert.ok(result.headline.length <= 89);
});

test("masthead prefers golden_hour when no live event is present", () => {
  const result = buildMasthead({
    signals: [
      signal({ type: "local_timing_advice", title: "Editorial" }),
      signal({ type: "golden_hour", title: "Golden hour pågår just nu" }),
    ],
    fallback: FALLBACK,
  });
  assert.equal(result.source, "signal");
  assert.equal(result.signal_type, "golden_hour");
  assert.equal(result.headline, "Golden hour pågår just nu");
});

test("masthead falls back to first signal when no preferred type present", () => {
  const result = buildMasthead({
    signals: [
      signal({ type: "local_timing_advice", title: "Generic timing", reason: "Generic reason" }),
    ],
    fallback: FALLBACK,
  });
  assert.equal(result.source, "signal");
  assert.equal(result.signal_type, "local_timing_advice");
  assert.equal(result.headline, "Generic timing");
  assert.equal(result.subhead, "Generic reason");
});

test("masthead skips unrenderable preferred signals and picks the next renderable signal", () => {
  const result = buildMasthead({
    signals: [
      signal({ type: "live_event_nearby", title: "   ", reason: "Should not render" }),
      signal({ type: "golden_hour", title: "Golden hour pågår just nu", reason: "Use this one" }),
    ],
    fallback: FALLBACK,
  });

  assert.equal(result.source, "signal");
  assert.equal(result.signal_type, "golden_hour");
  assert.equal(result.headline, "Golden hour pågår just nu");
  assert.equal(result.subhead, "Use this one");
});

test("masthead does not promote weak placeholder live signals", () => {
  const fallback = { headline: "Barcelona has useful Pulse later", subhead: "Only strong signals get hero treatment." };
  const result = buildMasthead({
    lang: "en",
    signals: [
      signal({
        type: "live_event_nearby",
        title: "Concert at Barcelona venue",
        safe_headline: "Concert at Barcelona venue",
        venue: "Barcelona venue",
        reason: "Concert on today in Barcelona. Worth adding to the plan if the timing works.",
      }),
    ],
    fallback,
  });

  assert.equal(result.source, "fallback");
  assert.equal(result.headline, fallback.headline);
  assert.doesNotMatch(result.headline, /Barcelona venue/i);
});

test("masthead trims signal and fallback text", () => {
  const result = buildMasthead({
    signals: [signal({ type: "evening_window", title: "  Kvällsläge  ", reason: "  Senare tempo  " })],
    fallback: { headline: "  Fallback headline  ", subhead: "  Fallback subhead  " },
  });

  assert.equal(result.headline, "Kvällsläge");
  assert.equal(result.subhead, "Senare tempo");

  const fallbackOnly = buildMasthead({
    signals: [signal({ type: "evening_window", title: "", reason: "No headline" })],
    fallback: { headline: "  Fallback headline  ", subhead: "  Fallback subhead  " },
  });

  assert.equal(fallbackOnly.source, "fallback");
  assert.equal(fallbackOnly.headline, "Fallback headline");
  assert.equal(fallbackOnly.subhead, "Fallback subhead");
});

test("masthead falls back honestly when signals[] is empty", () => {
  const result = buildMasthead({ signals: [], fallback: FALLBACK });
  assert.equal(result.source, "fallback");
  assert.equal(result.signal_id, null);
  assert.equal(result.signal_type, null);
  assert.equal(result.headline, FALLBACK.headline);
  assert.equal(result.subhead, FALLBACK.subhead);
});

test("masthead falls back honestly when signals is missing", () => {
  const result = buildMasthead({ fallback: FALLBACK });
  assert.equal(result.source, "fallback");
  assert.equal(result.headline, FALLBACK.headline);
});

test("masthead subhead falls through reason → why_it_matters → blurb → fallback", () => {
  const a = buildMasthead({
    signals: [signal({ type: "evening_window", reason: "R", why_it_matters: "W", blurb: "B" })],
    fallback: FALLBACK,
  });
  assert.equal(a.subhead, "R");

  const b = buildMasthead({
    signals: [signal({ type: "evening_window", reason: "", why_it_matters: "W", blurb: "B" })],
    fallback: FALLBACK,
  });
  assert.equal(b.subhead, "W");

  const c = buildMasthead({
    signals: [signal({ type: "evening_window", reason: "", why_it_matters: "", blurb: "B" })],
    fallback: FALLBACK,
  });
  assert.equal(c.subhead, "B");

  const d = buildMasthead({
    signals: [signal({ type: "evening_window", reason: "", why_it_matters: "", blurb: "" })],
    fallback: FALLBACK,
  });
  assert.equal(d.subhead, FALLBACK.subhead);
});

test("masthead never consults moments — confirmed by API shape", () => {
  // Function signature only accepts signals + fallback. There is no
  // moments parameter — this test is the structural guarantee.
  const fn = String(buildMasthead);
  assert.doesNotMatch(fn, /moments/);
});

test("PREFERRED_TYPES_FOR_HEADLINE is the documented set", () => {
  assert.ok(PREFERRED_TYPES_FOR_HEADLINE.has("live_event_nearby"));
  assert.ok(PREFERRED_TYPES_FOR_HEADLINE.has("golden_hour"));
  assert.ok(PREFERRED_TYPES_FOR_HEADLINE.has("evening_window"));
  assert.ok(PREFERRED_TYPES_FOR_HEADLINE.has("crowd_warning"));
  assert.ok(!PREFERRED_TYPES_FOR_HEADLINE.has("local_timing_advice"));
});
