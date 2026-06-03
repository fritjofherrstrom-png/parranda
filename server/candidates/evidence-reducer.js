/**
 * Candidate Intelligence Spine — Evidence reducer v1.
 *
 * Pure function: reduce(evidence[], { now }) -> derived{}.
 *
 * Turns a candidate's raw evidence ledger into Parranda's belief about it.
 * The reducer is the ONLY place confidence is produced — providers never
 * hand-declare it. This is what keeps "external consensus is input evidence,
 * not the final answer" structurally true.
 *
 * Key invariants:
 *   - Existence confidence is driven by provenance STRENGTH and DIVERSITY,
 *     not by popularity. Three independent source families agreeing beats one
 *     family shouting loudly.
 *   - Consensus (popularity / sentiment) is BANDED, never raw. A 4.8 vs a 4.6
 *     never produces a ranking edge here; bands only confirm "exists & matters".
 *   - Determinism: the only time input is `now`, passed explicitly, so the
 *     reducer stays pure and unit-testable.
 *
 * @param {Array} evidence            Evidence[] (already normalized or raw).
 * @param {object} [opts]
 * @param {string|null} [opts.now]    Reference time (ISO date/timestamp).
 * @returns {object} derived summary
 */

const {
  normalizeConfidence,
  confidenceRank,
  CONFIDENCE_LEVELS,
  maxConfidence,
  sourceTierConfidence,
  normalizeFreshness,
  maxFreshness,
  freshnessRank,
} = require("./confidence");
const { normalizeEvidenceList, EXISTENCE_CLAIM_TYPES } = require("./evidence");

// Age beyond which even a "fresh"/"live" claim is capped down to "stale".
const STALE_AGE_DAYS = 45;

// Review-volume band thresholds (review_count). Deliberately coarse.
const VOLUME_SOME_MIN = 1;
const VOLUME_LOTS_MIN = 400;

// Sentiment (0..5 rating) band thresholds. Banded on purpose — no raw ranking.
const SENTIMENT_POSITIVE_MIN = 3.5;
const SENTIMENT_STRONG_MIN = 4.3;

function reduceEvidence(evidence, { now = null } = {}) {
  const items = normalizeEvidenceList(evidence);
  const reasons = [];

  if (!items.length) {
    return emptyDerived("no_evidence");
  }

  // `weight` is the source's reliability for a claim. v1 uses it as a minimal
  // contribution gate: zero-weight (or negative) evidence is carried in the
  // ledger but cannot raise confidence, diversity, or consensus — so it can
  // never promote a candidate. Graded weighting is reserved for a later step.
  const contributing = items.filter((item) => Number(item.weight) > 0);
  if (!contributing.length) {
    return emptyDerived("all_evidence_zero_weight");
  }

  const existenceItems = contributing.filter((item) => EXISTENCE_CLAIM_TYPES.has(item.claim_type));
  const categoryItems = contributing.filter((item) => item.claim_type === "category");

  // --- Provenance diversity: distinct source families asserting the place ---
  const existenceFamilies = distinctFamilies(existenceItems);
  const provenanceDiversity = existenceFamilies.size;
  if (provenanceDiversity) {
    reasons.push(`provenance_families_${provenanceDiversity}`);
  }

  // --- Existence confidence: max(strongest tier, diversity-implied) ---------
  const tierBased = existenceItems.length
    ? maxConfidence(existenceItems.map((item) => sourceTierConfidence(item.source_ref.source_tier)))
    : "needs_review";
  const diversityBased = diversityConfidence(provenanceDiversity);
  const existenceConfidence = maxConfidence(tierBased, diversityBased);
  reasons.push(`existence_tier_${tierBased}`, `existence_diversity_${diversityBased}`);

  // --- Category confidence: strongest tier among category claims ------------
  const categoryConfidence = categoryItems.length
    ? maxConfidence(categoryItems.map((item) => sourceTierConfidence(item.source_ref.source_tier)))
    : "needs_review";

  // --- Freshness: best freshness among evidence, capped by observed age -----
  const freshness = deriveFreshness(contributing, now, reasons);

  // --- Consensus: banded popularity + sentiment (never raw ranking) ---------
  const consensus = deriveConsensus(contributing, reasons);

  return {
    existence_confidence: existenceConfidence,
    category_confidence: categoryConfidence,
    provenance_diversity: provenanceDiversity,
    freshness,
    consensus,
    reasons,
  };
}

function emptyDerived(reason) {
  return {
    existence_confidence: "needs_review",
    category_confidence: "needs_review",
    provenance_diversity: 0,
    freshness: "unknown",
    consensus: { volume_band: "none", sentiment_band: "unknown" },
    reasons: [reason],
  };
}

function distinctFamilies(items) {
  return new Set(items.map((item) => item.source_ref.source_family).filter(Boolean));
}

function diversityConfidence(diversity) {
  if (diversity >= 3) return "high";
  if (diversity === 2) return "medium";
  if (diversity === 1) return "low";
  return "needs_review";
}

function deriveFreshness(items, now, reasons) {
  let best = maxFreshness(items.map((item) => item.freshness));

  // Age guard: if the freshest-claimed item is actually old, cap it down.
  const ages = items
    .map((item) => ageInDays(item.observed_at, now))
    .filter((age) => Number.isFinite(age));
  if (ages.length) {
    const youngest = Math.min(...ages);
    if (youngest > STALE_AGE_DAYS && freshnessRank(best) > freshnessRank("stale")) {
      best = "stale";
      reasons.push(`freshness_capped_age_${youngest}d`);
    }
  }
  return normalizeFreshness(best);
}

function deriveConsensus(items, reasons) {
  const popularity = items
    .filter((item) => item.claim_type === "popularity")
    .map((item) => toNumber(item.value))
    .filter((value) => Number.isFinite(value));
  const sentiment = items
    .filter((item) => item.claim_type === "sentiment")
    .map((item) => toNumber(item.value))
    .filter((value) => Number.isFinite(value));

  const volumeBand = bandVolume(popularity.length ? Math.max(...popularity) : null);
  const sentimentBand = bandSentiment(sentiment.length ? average(sentiment) : null);

  if (volumeBand !== "none") reasons.push(`consensus_volume_${volumeBand}`);
  if (sentimentBand !== "unknown") reasons.push(`consensus_sentiment_${sentimentBand}`);

  return { volume_band: volumeBand, sentiment_band: sentimentBand };
}

function bandVolume(count) {
  if (!Number.isFinite(count) || count < VOLUME_SOME_MIN) return "none";
  if (count >= VOLUME_LOTS_MIN) return "lots";
  return "some";
}

function bandSentiment(rating) {
  if (!Number.isFinite(rating)) return "unknown";
  if (rating >= SENTIMENT_STRONG_MIN) return "strong";
  if (rating >= SENTIMENT_POSITIVE_MIN) return "positive";
  return "mixed";
}

function ageInDays(observedAt, now) {
  if (!observedAt || !now) return NaN;
  const left = isoDay(now);
  const right = isoDay(observedAt);
  if (!left || !right) return NaN;
  const leftMs = Date.parse(`${left}T00:00:00Z`);
  const rightMs = Date.parse(`${right}T00:00:00Z`);
  if (!Number.isFinite(leftMs) || !Number.isFinite(rightMs)) return NaN;
  return Math.round((leftMs - rightMs) / 86400000);
}

function isoDay(value) {
  const match = String(value || "").match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : null;
}

function toNumber(value) {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/[^0-9.+-]/g, ""));
    return Number.isFinite(parsed) ? parsed : NaN;
  }
  return NaN;
}

function average(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

module.exports = {
  reduceEvidence,
  STALE_AGE_DAYS,
  VOLUME_LOTS_MIN,
  SENTIMENT_POSITIVE_MIN,
  SENTIMENT_STRONG_MIN,
  // exported for tests / introspection
  bandVolume,
  bandSentiment,
  CONFIDENCE_LEVELS,
  confidenceRank,
};
