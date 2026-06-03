const assert = require("node:assert/strict");
const test = require("node:test");

const {
  normalizeConfidence,
  confidenceAtLeast,
  maxConfidence,
  minConfidence,
  normalizeFreshness,
  maxFreshness,
  sourceTierConfidence,
} = require("../server/candidates/confidence");

test("normalizeConfidence folds the current high/strong drift", () => {
  // display-gates.js renames high → strong; the spine canonicalizes back.
  assert.equal(normalizeConfidence("strong"), "high");
  assert.equal(normalizeConfidence("high"), "high");
  // signal-quality.js weak/fallback fold into the canonical low end.
  assert.equal(normalizeConfidence("weak"), "low");
  assert.equal(normalizeConfidence("fallback"), "needs_review");
  // passthrough + safe default.
  assert.equal(normalizeConfidence("medium"), "medium");
  assert.equal(normalizeConfidence(""), "needs_review");
  assert.equal(normalizeConfidence("garbage"), "needs_review");
});

test("confidence ordering is needs_review < low < medium < high", () => {
  assert.ok(confidenceAtLeast("high", "medium"));
  assert.ok(confidenceAtLeast("medium", "medium"));
  assert.ok(!confidenceAtLeast("low", "medium"));
  // strong is just an alias for high, so it clears a high bar.
  assert.ok(confidenceAtLeast("strong", "high"));
});

test("max/min confidence fold arrays and varargs", () => {
  assert.equal(maxConfidence("low", "high", "medium"), "high");
  assert.equal(maxConfidence(["low", "needs_review"]), "low");
  assert.equal(minConfidence("low", "high", "medium"), "low");
  assert.equal(maxConfidence(), "needs_review");
});

test("freshness ladder normalizes legacy tokens and picks the freshest", () => {
  assert.equal(normalizeFreshness("today"), "fresh");
  assert.equal(normalizeFreshness("evergreen"), "fresh");
  assert.equal(normalizeFreshness("live"), "live");
  assert.equal(normalizeFreshness(""), "unknown");
  assert.equal(maxFreshness(["stale", "live", "fresh"]), "live");
});

test("source tiers keep curated/verified/official strong and inferred weak", () => {
  assert.equal(sourceTierConfidence("official"), "high");
  assert.equal(sourceTierConfidence("verified"), "high");
  assert.equal(sourceTierConfidence("curated"), "high");
  assert.equal(sourceTierConfidence("editorial"), "medium");
  assert.equal(sourceTierConfidence("inferred"), "low");
  assert.equal(sourceTierConfidence("fallback"), "needs_review");
});
