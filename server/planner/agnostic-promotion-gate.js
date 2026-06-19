/**
 * Agnostic route promotion gate (v1).
 *
 * Decides whether an agnostic-composed route is honest enough to be PROMOTED —
 * i.e. returned as the actual Planner route for a resolved, non-citypack place —
 * versus kept as a diagnostic-only experiment block with the baseline returned.
 *
 * This is where the fake-confidence guardrail lives. The bar is deliberately
 * conservative and was set by product decision:
 *
 *   promote  ⇔  calibration.status ∈ {thin_usable, usable}      // never "blocked"/env-not-wired
 *              ∧ calibration.level ∈ {low, medium}              // never citypack-high
 *              ∧ every cap ∈ ALLOWED_CAPS                       // strict allowlist
 *              ∧ strongAnchor                                   // resolved confidently
 *
 * `usable` is structurally unreachable for any-place (all-external candidates
 * always trip capped_by_external_only_sources → thin_usable), but it is allowed
 * so the gate stays correct if that ever changes. The strict allowlist means
 * below_planner_threshold / thin_day / unresolved_roles / role_order_fallback /
 * any future cap all block promotion in v1 without having to enumerate them.
 *
 * Pure / side-effect free.
 */

const PROMOTABLE_STATUSES = new Set(["thin_usable", "usable"]);
const PROMOTABLE_LEVELS = new Set(["low", "medium"]);

// The ONLY caps compatible with a promoted v1 route. Each is an honest
// "thin but usable" limitation the honesty panel can explain; none implies the
// route is structurally unsound.
const ALLOWED_CAPS = new Set([
  "capped_by_external_only_sources",
  "capped_by_derived_timezone",
  "capped_by_partial_context",
  "capped_by_heuristic_walking",
]);

/**
 * @param {object} params
 * @param {object|null} params.calibration  calibrateAgnosticRouteReadiness() result
 * @param {boolean} params.strongAnchor     whether the place anchor resolved with
 *   high confidence (never promote invented geography for a weak resolve)
 * @returns {{promote: boolean, reasons: string[], blocked_caps: string[]}}
 */
function evaluateAgnosticPromotion({ calibration = null, strongAnchor = false } = {}) {
  const reasons = [];

  if (!calibration || typeof calibration !== "object") {
    return { promote: false, reasons: ["no_calibration"], blocked_caps: [] };
  }

  const status = calibration.status || null;
  const level = calibration.level || null;
  const caps = Array.isArray(calibration.caps) ? calibration.caps : [];
  // Only `capped_by_*` tokens are real limitations; the always-present
  // `experimental_agnostic_route` marker (and any non-capped_by reason) is not a
  // promotion blocker. Mirror calibration's own cappedByTokens filter.
  const realCaps = caps.filter((cap) => String(cap).startsWith("capped_by_"));
  const blockedCaps = realCaps.filter((cap) => !ALLOWED_CAPS.has(cap));

  if (!strongAnchor) reasons.push("anchor_not_strong");
  if (!PROMOTABLE_STATUSES.has(status)) reasons.push(`status_not_promotable:${status || "none"}`);
  if (!PROMOTABLE_LEVELS.has(level)) reasons.push(`level_not_promotable:${level || "none"}`);
  if (blockedCaps.length) reasons.push("capped_by_non_promotable");

  const promote = reasons.length === 0;
  if (promote) reasons.push("promoted_thin_usable");

  return { promote, reasons, blocked_caps: blockedCaps };
}

module.exports = {
  ALLOWED_CAPS,
  PROMOTABLE_STATUSES,
  PROMOTABLE_LEVELS,
  evaluateAgnosticPromotion,
};
