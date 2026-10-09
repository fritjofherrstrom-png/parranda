/**
 * Compose follow-up policy — the ONE place that decides whether a finished
 * compose schedules a silent re-ask. Extracted from the planner component so
 * the regression-prone sequencing rules are unit-tested:
 *
 *   - ONE-SHOT UPGRADE: a USER-initiated compose (never a silent one) that
 *     returned structure while corroboration was still warming, composed
 *     without structure, or hit an explicit transient trusted-source failure,
 *     gets exactly one silent retry. A proven empty source, ambiguity, or an
 *     unresolved place never retries — those are honest results.
 *
 * Pending Live is NOT a reason to re-ask. The original compose's Live result
 * is read through its own completion capability (live-completion.mjs); a
 * timer-driven recompose would start new acquisition and could replace the
 * day the user is reading.
 *
 * Pure + deterministic; the caller owns timers, aborts and state.
 */

export const UPGRADE_DELAY_MS = 9000;

/**
 * @param {object} input
 * @param {boolean} input.supplyLifecycleComplete the server lifecycle already waited for supply
 * @param {boolean} input.composed              classification.status === "composed"
 * @param {boolean} input.structureOnly         classification.status === "structure_only"
 * @param {boolean} input.hasStructure          the safe response carries place_structure
 * @param {boolean} input.transientSourceRetry  shared-module verdict (shouldRetryTransientSource)
 * @param {boolean} input.silent                this compose was itself a silent re-ask
 * @returns {{ schedule: boolean, delayMs: number|null, upgradePending: boolean }}
 */
export function planComposeFollowup({
  supplyLifecycleComplete = false,
  composed = false,
  structureOnly = false,
  hasStructure = false,
  transientSourceRetry = false,
  silent = false,
} = {}) {
  const needsStructureUpgrade = structureOnly || (composed && !hasStructure);
  const canRunOneShotUpgrade = !supplyLifecycleComplete && !silent && (needsStructureUpgrade || transientSourceRetry);
  if (!canRunOneShotUpgrade) return { schedule: false, delayMs: null, upgradePending: false };
  return { schedule: true, delayMs: UPGRADE_DELAY_MS, upgradePending: true };
}
