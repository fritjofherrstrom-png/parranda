const assert = require("node:assert/strict");
const test = require("node:test");

const { buildMasthead, PREFERRED_TYPES_FOR_HEADLINE } = require("../server/pulse-engine/masthead");

const FALLBACK = {
  headline: "Maj sätter Rom i kvällsläge — låt eftermiddagen bygga upp en sen kväll.",
  subhead: "Vårkvällarna gör Rom extra promenadvänligt.",
};

function signal(overrides) {
  return {
    id: overrides.id || `id-${overrides.type}`,
    type: overrides.type,
    title: overrides.title || `Title for ${overrides.type}`,
    reason: overrides.reason || `Reason for ${overrides.type}`,
    signal_label: overrides.signal_label || null,
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
