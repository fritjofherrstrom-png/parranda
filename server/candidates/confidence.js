/**
 * Candidate Intelligence Spine — shared confidence + freshness vocabulary.
 *
 * This module exists to STOP confidence drift. Parranda currently carries at
 * least four different confidence ladders:
 *   - place-candidates/contract.js + pulse-sources/source-descriptor.js
 *       → high | medium | low | needs_review
 *   - pulse-sources/display-gates.js
 *       → strong | medium | low | needs_review   (renames high → strong)
 *   - pulse-engine/signal-quality.js
 *       → strong | medium | weak | fallback
 *
 * The spine declares ONE canonical confidence ladder and provides adapters so
 * the legacy vocabularies can be folded in without inventing a fifth scale.
 *
 * Canonical confidence ladder (ordered weakest → strongest):
 *     needs_review < low < medium < high
 *
 * Canonical freshness ladder (ordered stalest → freshest):
 *     unknown < stale < fresh < live
 *
 * Everything here is pure and side-effect free.
 */

const CONFIDENCE_LEVELS = ["needs_review", "low", "medium", "high"];
const CONFIDENCE_RANK = CONFIDENCE_LEVELS.reduce((rank, level, index) => {
  rank[level] = index;
  return rank;
}, {});

// Adapter: fold drifting legacy tokens into the canonical ladder.
const CONFIDENCE_ALIASES = {
  // display-gates.js renames high → strong
  strong: "high",
  // signal-quality.js weak/fallback
  weak: "low",
  fallback: "needs_review",
  // common informal tokens
  unknown: "needs_review",
  none: "needs_review",
};

const FRESHNESS_LEVELS = ["unknown", "stale", "fresh", "live"];
const FRESHNESS_RANK = FRESHNESS_LEVELS.reduce((rank, level, index) => {
  rank[level] = index;
  return rank;
}, {});

const FRESHNESS_ALIASES = {
  today: "fresh",
  this_week: "fresh",
  evergreen: "fresh",
  recent: "fresh",
};

// Provenance tiers describe WHO said it. They are not themselves a confidence,
// but each tier implies how much existence-weight a single source of that tier
// can carry on its own. This is where "a curated/verified place retains
// stronger trust" is encoded, and where bare external-consensus tiers
// (inferred/fallback) are kept weak so popularity alone cannot promote.
const SOURCE_TIER_CONFIDENCE = {
  official: "high",
  verified: "high",
  curated: "high",
  computed: "medium",
  editorial: "medium",
  inferred: "low",
  fallback: "needs_review",
};

function normalizeConfidence(value) {
  const token = compact(value).toLowerCase();
  if (!token) return "needs_review";
  if (CONFIDENCE_RANK[token] !== undefined) return token;
  if (CONFIDENCE_ALIASES[token]) return CONFIDENCE_ALIASES[token];
  return "needs_review";
}

function confidenceRank(value) {
  return CONFIDENCE_RANK[normalizeConfidence(value)];
}

function confidenceAtLeast(value, minimum) {
  return confidenceRank(value) >= confidenceRank(minimum);
}

function confidenceAtMost(value, maximum) {
  return confidenceRank(value) <= confidenceRank(maximum);
}

function maxConfidence(...values) {
  return foldConfidence(values, Math.max, "needs_review");
}

function minConfidence(...values) {
  return foldConfidence(values, Math.min, "high");
}

function sourceTierConfidence(tier) {
  const token = compact(tier).toLowerCase();
  return SOURCE_TIER_CONFIDENCE[token] || "needs_review";
}

function normalizeFreshness(value) {
  const token = compact(value).toLowerCase();
  if (!token) return "unknown";
  if (FRESHNESS_RANK[token] !== undefined) return token;
  if (FRESHNESS_ALIASES[token]) return FRESHNESS_ALIASES[token];
  return "unknown";
}

function freshnessRank(value) {
  return FRESHNESS_RANK[normalizeFreshness(value)];
}

function maxFreshness(...values) {
  const flat = flatten(values);
  if (!flat.length) return "unknown";
  return flat
    .map((value) => normalizeFreshness(value))
    .reduce((best, current) =>
      freshnessRank(current) > freshnessRank(best) ? current : best,
    );
}

function foldConfidence(values, picker, seed) {
  const flat = flatten(values);
  if (!flat.length) return seed;
  const rank = flat
    .map((value) => confidenceRank(value))
    .reduce((acc, current) => picker(acc, current));
  return CONFIDENCE_LEVELS[rank];
}

function flatten(values) {
  return values
    .flat(Infinity)
    .filter((value) => value !== undefined && value !== null && value !== "");
}

function compact(value) {
  return String(value === undefined || value === null ? "" : value)
    .replace(/\s+/g, " ")
    .trim();
}

module.exports = {
  CONFIDENCE_LEVELS,
  CONFIDENCE_RANK,
  CONFIDENCE_ALIASES,
  FRESHNESS_LEVELS,
  SOURCE_TIER_CONFIDENCE,
  normalizeConfidence,
  confidenceRank,
  confidenceAtLeast,
  confidenceAtMost,
  maxConfidence,
  minConfidence,
  sourceTierConfidence,
  normalizeFreshness,
  freshnessRank,
  maxFreshness,
};
