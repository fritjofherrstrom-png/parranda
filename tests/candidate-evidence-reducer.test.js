const assert = require("node:assert/strict");
const test = require("node:test");

const { createEvidence } = require("../server/candidates/evidence");
const { reduceEvidence } = require("../server/candidates/evidence-reducer");

const NOW = "2026-06-03";

function existence(family, tier, overrides = {}) {
  return createEvidence({
    claim_type: "existence",
    value: true,
    provider_id: `${family}-provider`,
    source_family: family,
    source_tier: tier,
    observed_at: NOW,
    freshness: "fresh",
    ...overrides,
  });
}

test("empty evidence yields needs_review and no consensus", () => {
  const derived = reduceEvidence([], { now: NOW });
  assert.equal(derived.existence_confidence, "needs_review");
  assert.equal(derived.provenance_diversity, 0);
  assert.deepEqual(derived.consensus, { volume_band: "none", sentiment_band: "unknown" });
  assert.deepEqual(derived.reasons, ["no_evidence"]);
});

test("multiple independent source families raise existence via diversity", () => {
  const derived = reduceEvidence(
    [
      existence("map", "inferred"),
      existence("official", "official"),
      existence("community", "inferred"),
    ],
    { now: NOW },
  );
  assert.equal(derived.provenance_diversity, 3);
  // 3 families → diversity-based high, and an official tier is also high.
  assert.equal(derived.existence_confidence, "high");
});

test("a single curated/verified family retains strong trust", () => {
  const curated = reduceEvidence([existence("catalog", "curated")], { now: NOW });
  assert.equal(curated.provenance_diversity, 1);
  // diversity alone would be "low", but the curated tier lifts existence to high.
  assert.equal(curated.existence_confidence, "high");

  const inferred = reduceEvidence([existence("map", "inferred")], { now: NOW });
  // a single weak external family stays low — cannot fake strong trust.
  assert.equal(inferred.existence_confidence, "low");
});

test("consensus is banded, not raw — 4.8 and 4.6 land in the same band", () => {
  const hi = reduceEvidence(
    [
      existence("map", "inferred"),
      createEvidence({
        claim_type: "sentiment",
        value: 4.8,
        provider_id: "map",
        source_family: "map",
        source_tier: "inferred",
      }),
      createEvidence({
        claim_type: "popularity",
        value: 1800,
        provider_id: "map",
        source_family: "map",
        source_tier: "inferred",
      }),
    ],
    { now: NOW },
  );
  const lo = reduceEvidence(
    [
      existence("map", "inferred"),
      createEvidence({
        claim_type: "sentiment",
        value: 4.6,
        provider_id: "map",
        source_family: "map",
        source_tier: "inferred",
      }),
      createEvidence({
        claim_type: "popularity",
        value: 1700,
        provider_id: "map",
        source_family: "map",
        source_tier: "inferred",
      }),
    ],
    { now: NOW },
  );
  assert.equal(hi.consensus.sentiment_band, "strong");
  assert.equal(lo.consensus.sentiment_band, "strong"); // no 4.8-beats-4.6 edge
  assert.equal(hi.consensus.volume_band, "lots");
  assert.equal(lo.consensus.volume_band, "lots");
  // crucially: heavy consensus does NOT lift a single weak family's existence.
  assert.equal(hi.existence_confidence, "low");
});

test("volume and sentiment bands map at their thresholds", () => {
  const mk = (claim_type, value) =>
    reduceEvidence([createEvidence({ claim_type, value, provider_id: "m", source_family: "map" })], {
      now: NOW,
    }).consensus;
  assert.equal(mk("popularity", 0).volume_band, "none");
  assert.equal(mk("popularity", 50).volume_band, "some");
  assert.equal(mk("popularity", 400).volume_band, "lots");
  assert.equal(mk("sentiment", 3.0).sentiment_band, "mixed");
  assert.equal(mk("sentiment", 4.0).sentiment_band, "positive");
  assert.equal(mk("sentiment", 4.5).sentiment_band, "strong");
});

test("freshness derives from best claim but is capped by observed age", () => {
  const fresh = reduceEvidence([existence("catalog", "curated", { freshness: "live", observed_at: NOW })], {
    now: NOW,
  });
  assert.equal(fresh.freshness, "live");

  const old = reduceEvidence(
    [existence("catalog", "curated", { freshness: "live", observed_at: "2026-01-01" })],
    { now: NOW },
  );
  // ~5 months old → capped down despite the "live" claim.
  assert.equal(old.freshness, "stale");
});

test("zero-weight evidence is carried but cannot raise confidence or promote", () => {
  const derived = reduceEvidence(
    [
      existence("official", "official", { weight: 0 }),
      createEvidence({
        claim_type: "popularity",
        value: 9000,
        provider_id: "m",
        source_family: "map",
        source_tier: "inferred",
        weight: 0,
      }),
    ],
    { now: NOW },
  );
  assert.equal(derived.existence_confidence, "needs_review");
  assert.equal(derived.provenance_diversity, 0);
  assert.equal(derived.consensus.volume_band, "none");
  assert.deepEqual(derived.reasons, ["all_evidence_zero_weight"]);
});

test("a zero-weight claim does not add to provenance diversity", () => {
  const derived = reduceEvidence(
    [existence("official", "official", { weight: 1 }), existence("map", "inferred", { weight: 0 })],
    { now: NOW },
  );
  // only the weighted official family counts.
  assert.equal(derived.provenance_diversity, 1);
});

test("reducer is pure: same inputs + same now → deep-equal output", () => {
  const evidence = [existence("official", "official"), existence("map", "inferred")];
  const a = reduceEvidence(evidence, { now: NOW });
  const b = reduceEvidence(evidence, { now: NOW });
  assert.deepEqual(a, b);
  // and it did not mutate the input.
  assert.equal(evidence.length, 2);
});
