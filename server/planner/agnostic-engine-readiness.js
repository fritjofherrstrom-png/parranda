/**
 * Agnostic engine-path readiness verdict (observability).
 *
 * Consolidates the signals already produced by the convergence work into one
 * honest, machine-readable answer to a single question: *is the engine
 * agnostic_compose path ready to become the default synthesizer, and if not,
 * what exactly is still blocking it?*
 *
 * This is a READ-ONLY summary. It changes no behavior, promotes nothing, and is
 * attached to the experiment block for inspect/dogfood so a human tester (or a
 * later gate-flip decision) can see retirement-readiness at a glance. It exists
 * specifically to enable retiring the legacy synthesizer once the engine path is
 * proven — not as a permanent diagnostic.
 *
 * Pure / side-effect free.
 */

// Promotion decision, framed for evaluation: would the gate let this engine
// route REPLACE the baseline?  eligible = yes · blocked = no (with reasons) ·
// unknown = the engine path did not run / produced no gate verdict.
function promotionDecision(promotion) {
  if (!promotion || typeof promotion.promote !== "boolean") return "unknown";
  return promotion.promote ? "eligible" : "blocked";
}

// The reasons a promotable verdict was withheld — promotion reasons (minus the
// success marker) plus any non-promotable caps. These ARE the "what remains
// before legacy can be retired" list. Empty when eligible.
function promotionBlockers(promotion) {
  if (!promotion) return [];
  const reasons = Array.isArray(promotion.reasons)
    ? promotion.reasons.filter((reason) => reason && reason !== "promoted_thin_usable")
    : [];
  const blockedCaps = Array.isArray(promotion.blocked_caps) ? promotion.blocked_caps : [];
  return [...new Set([...reasons, ...blockedCaps])];
}

/**
 * @param {object} experiment  the agnostic_route_output_experiment block
 * @returns {object} engine-path readiness verdict
 */
function buildEngineReadinessVerdict(experiment = {}) {
  const synthesizedVia = experiment.synthesized_via || null;
  const enginePathActive = synthesizedVia === "agnostic_compose_engine";
  const promotion = experiment.promotion || null;
  const calibration = experiment.readiness_calibration || null;
  const route = experiment.experimental_route || null;
  const ordering = route && route.agnostic_daypart_ordering ? route.agnostic_daypart_ordering : null;

  const decision = promotionDecision(promotion);
  const blockers = promotionBlockers(promotion);

  // What still stands between the engine path and becoming the default
  // synthesizer. The single honest readout this whole layer exists to produce.
  let remaining;
  if (!enginePathActive) {
    remaining = ["engine_path_not_active"];
  } else if (decision === "eligible") {
    remaining = [];
  } else if (decision === "blocked") {
    remaining = blockers.length ? blockers : ["promotion_blocked_unspecified"];
  } else {
    remaining = ["no_promotion_verdict"];
  }

  return {
    engine_path_active: enginePathActive,
    synthesized_via: synthesizedVia,
    promotion_decision: decision,
    promotion_blockers: blockers,
    daypart: ordering
      ? {
          applied: ordering.applied === true,
          fallback: ordering.fallback === true,
          reason: ordering.reason || null,
        }
      : null,
    daypart_arc: Array.isArray(route?.daypart_arc) ? route.daypart_arc : null,
    calibration: calibration ? { status: calibration.status || null, level: calibration.level || null } : null,
    // Retirement-readiness: the engine path is ready to be default only when it
    // is active AND clears the promotion gate. Legacy stays the safety net until
    // this is true across real dogfood rounds.
    retirement_ready: enginePathActive && decision === "eligible",
    remaining_for_default: remaining,
  };
}

module.exports = {
  buildEngineReadinessVerdict,
  promotionDecision,
  promotionBlockers,
};
