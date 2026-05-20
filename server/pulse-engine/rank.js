/**
 * Rank a list of normalized PulseSignals so the strongest signals
 * surface first on the city page and for Blitz.
 *
 * Scoring layers (low cardinality on purpose — easier to tune):
 *   trust × freshness × signal-type weight × generator-supplied score
 *
 * The generator-supplied `score` (raw input) is treated as a soft
 * weight, not the dominant factor. A live event with no generator
 * score should still outrank a low-priority editorial item.
 */

const TRUST_WEIGHT = {
  verified: 1.4,
  official: 1.3,
  editorial: 1.0,
  inferred: 0.7,
};

const FRESHNESS_WEIGHT = {
  live: 1.4,
  today: 1.2,
  this_week: 1.0,
  evergreen: 0.85,
};

const TYPE_WEIGHT = {
  live_event_nearby: 1.35,
  crowd_warning: 1.2,
  golden_hour: 1.15,
  evening_window: 1.05,
  weather_shift: 1.05,
  good_now_worse_later: 1.05,
  market_timing: 1.0,
  opening_risk: 1.0,
  local_timing_advice: 0.9,
  near_route: 1.0,
};

/**
 * @param {import("./types").PulseSignal[]} signals
 * @param {import("./types").EngineContext} _context
 * @returns {import("./types").PulseSignal[]}
 */
function scoreSignals(signals, _context) {
  if (!Array.isArray(signals) || signals.length === 0) {
    return [];
  }

  const ranked = signals.map((signal) => {
    if (!signal) return null;

    const trust = TRUST_WEIGHT[signal.trust_level] ?? 1;
    const fresh = FRESHNESS_WEIGHT[signal.freshness] ?? 1;
    const typeW = TYPE_WEIGHT[signal.type] ?? 1;
    const raw = typeof signal.score === "number" ? signal.score : 0;

    // The raw score has historically lived in the 0..10 range. Normalize
    // it into a similar magnitude before multiplying by the layered weights.
    const base = 1 + Math.max(0, Math.min(raw, 10)) * 0.1;
    const computed = trust * fresh * typeW * base;

    return {
      ...signal,
      score: Number(computed.toFixed(3)),
    };
  });

  return ranked
    .filter(Boolean)
    .sort((left, right) => (right.score || 0) - (left.score || 0));
}

module.exports = {
  scoreSignals,
  TRUST_WEIGHT,
  FRESHNESS_WEIGHT,
  TYPE_WEIGHT,
};
