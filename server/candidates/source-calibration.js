/**
 * Candidate Intelligence Spine — Source Calibration v1.
 *
 * Parranda's edge is "source broadly, judge better" — and judging better means
 * a source family's INFLUENCE is not a fixed global weight. A known food writer
 * matters more for a food intent; official open data matters more in a thin
 * city; generic map consensus should be softened in a local lens or an
 * over-touristed city. This module turns those product intuitions into a pure,
 * bounded, inspectable calibration signal.
 *
 * HARD GUARDRAILS (so calibration cannot turn Parranda into a review app):
 *   - Calibration NEVER sees popularity / review volume / rating. Consensus can
 *     corroborate existence (handled by the reducer) but must never become
 *     ranking power. There is deliberately no consensus input here.
 *   - Calibration NEVER overrides gates. Gates run first; calibration only
 *     reorders already-eligible candidates.
 *   - Calibration NEVER touches intent coverage. Coverage stays lexicographically
 *     primary in ranking; calibration is a bounded tiebreak among comparably
 *     fitting candidates.
 *   - Curated/verified Parranda candidates keep priority when fit is comparable.
 *     That guarantee lives in the ranker (curated gets a flat dominant priority);
 *     this module calibrates the SOURCE-BACKED set among itself.
 *
 * Influence is clamped to [-1, 1]. Each rule emits a reason for inspect.
 *
 * Pure / side-effect free. No fixed per-city weights, no city hacks — rules key
 * on density / category / intent / lens / family / diversity / freshness so a
 * lesson learned in one city generalizes.
 */

const INFLUENCE_MIN = -1;
const INFLUENCE_MAX = 1;

// Catalog density bands — how much curated ground-truth a city has. Thin/absent
// is where source-backed evidence must carry more weight.
const DENSITY_RICH_MIN = 25; // mirrors place-candidates/readiness planner threshold
function classifyCatalogDensity(realPlaceCount) {
  const count = Number.isFinite(realPlaceCount) ? realPlaceCount : 0;
  if (count <= 0) return "absent";
  if (count >= DENSITY_RICH_MIN) return "rich";
  return "thin";
}

// Which intents lean on which source families. Keyed by canonical intent
// (see intent-vocabulary.js) → families that are especially credible for it.
const INTENT_FAMILY_AFFINITY = {
  food: { editorial: 0.3, community: 0.1 }, // food writers / local guides
  bars: { live: 0.2, community: 0.2 }, // nightlife: live + community pulse
  markets: { official: 0.2, community: 0.1 },
  museums: { official: 0.2, editorial: 0.2 },
  scenic: { map: 0.2, official: 0.1 }, // open geo data knows viewpoints
  swimming: { official: 0.2, map: 0.2 }, // open geo + official beach/water data
};

const FAMILY_BASELINE = {
  official: 0.3,
  editorial: 0.2,
  community: 0.1,
  live: 0.1,
  map: 0.0,
  computed: 0.0,
  environmental: 0.0,
  catalog: 0.3,
};

/**
 * @param {object} input
 * @param {string} input.family       source family (map/official/editorial/…)
 * @param {string} [input.tier]       source tier (official/inferred/…)
 * @param {string[]} [input.intents]  canonical requested intents
 * @param {string} [input.lens]       experience lens (local/first_time/…)
 * @param {string} input.density      catalog density (rich/thin/absent)
 * @param {number} [input.diversity]  provenance diversity (distinct families)
 * @param {string} [input.freshness]  live/fresh/stale/unknown
 * @returns {{ influence: number, level: "elevated"|"baseline"|"reduced", reasons: string[] }}
 */
function calibrateSource(input = {}) {
  const family = String(input.family || "").toLowerCase();
  const intents = Array.isArray(input.intents) ? input.intents : [];
  const lens = String(input.lens || "").toLowerCase();
  const density = String(input.density || "rich").toLowerCase();
  const diversity = Number.isFinite(input.diversity) ? input.diversity : 0;
  const freshness = String(input.freshness || "unknown").toLowerCase();
  const reasons = [];

  let influence = 0;

  // --- family baseline ------------------------------------------------------
  if (FAMILY_BASELINE[family] !== undefined) {
    influence += FAMILY_BASELINE[family];
    reasons.push(`family_baseline:${family}:${signed(FAMILY_BASELINE[family])}`);
  }

  // --- density adaptivity ---------------------------------------------------
  // When curation is thin/absent, credible open/official sources carry more.
  if ((density === "thin" || density === "absent")) {
    if (family === "official" || (family === "map" && diversity >= 2)) {
      influence += 0.2;
      reasons.push(`thin_city_boost:${family}:+0.2`);
    }
  } else if (density === "rich" && family === "map" && diversity <= 1) {
    // In a dense city, a lone generic map node is more likely noise.
    influence -= 0.1;
    reasons.push("rich_city_lone_map:-0.1");
  }

  // --- intent × family affinity --------------------------------------------
  for (const intent of intents) {
    const affinity = INTENT_FAMILY_AFFINITY[intent];
    if (affinity && affinity[family] !== undefined) {
      influence += affinity[family];
      reasons.push(`intent_affinity:${intent}->${family}:+${affinity[family]}`);
    }
  }

  // --- lens adaptivity ------------------------------------------------------
  if (lens === "local" || lens === "rediscover") {
    if (family === "editorial" || family === "community") {
      influence += 0.2;
      reasons.push(`local_lens_boost:${family}:+0.2`);
    } else if (family === "map") {
      influence -= 0.1;
      reasons.push("local_lens_softens_generic_map:-0.1");
    }
  }
  // first_time / balanced / surprise: no penalty to generic consensus sources —
  // a tourist legitimately wants the famous places.

  // --- corroboration / diversity -------------------------------------------
  if (diversity >= 3) {
    influence += 0.3;
    reasons.push("corroborated_3plus:+0.3");
  } else if (diversity === 2) {
    influence += 0.2;
    reasons.push("corroborated_2:+0.2");
  } else if (diversity <= 1) {
    influence -= 0.1;
    reasons.push("single_family:-0.1");
  }

  // --- freshness ------------------------------------------------------------
  if (freshness === "live") {
    influence += 0.1;
    reasons.push("fresh_live:+0.1");
  } else if (freshness === "stale") {
    influence -= 0.2;
    reasons.push("stale:-0.2");
  } else if (freshness === "unknown") {
    influence -= 0.05;
    reasons.push("freshness_unknown:-0.05");
  }

  influence = clamp(Number(influence.toFixed(3)), INFLUENCE_MIN, INFLUENCE_MAX);

  return {
    influence,
    level: influence >= 0.25 ? "elevated" : influence <= -0.25 ? "reduced" : "baseline",
    reasons,
  };
}

function signed(value) {
  return value >= 0 ? `+${value}` : `${value}`;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

module.exports = {
  INFLUENCE_MIN,
  INFLUENCE_MAX,
  DENSITY_RICH_MIN,
  FAMILY_BASELINE,
  INTENT_FAMILY_AFFINITY,
  classifyCatalogDensity,
  calibrateSource,
};
