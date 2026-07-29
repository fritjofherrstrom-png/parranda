/**
 * Compose follow-up policy — the ONE place that decides whether a finished
 * compose schedules a silent re-ask, and with what budget. Extracted from the
 * planner component so the regression-prone sequencing rules are unit-tested:
 *
 *   - LIVE REFRESH: while live acquisition reports `pending`, up to three
 *     capped refreshes (9/12/18 s). Exhaustion is reported so the UI can say
 *     "couldn't verify" instead of spinning forever.
 *   - ONE-SHOT UPGRADE: a USER-initiated compose (never a silent one) that
 *     returned structure while corroboration was still warming, composed
 *     without structure, or hit an explicit transient trusted-source failure,
 *     gets exactly one silent retry. A proven empty source, ambiguity, or an
 *     unresolved place never retries — those are honest results.
 *
 * Pure + deterministic; the caller owns timers, aborts and state.
 */

export const LIVE_REFRESH_DELAYS_MS = [9000, 12000, 18000];

/**
 * @param {object} input
 * @param {boolean} input.composed              classification.status === "composed"
 * @param {boolean} input.structureOnly         classification.status === "structure_only"
 * @param {boolean} input.hasStructure          the safe response carries place_structure
 * @param {boolean} input.transientSourceRetry  shared-module verdict (shouldRetryTransientSource)
 * @param {boolean} input.livePending           safe.live_events?.pending === true
 * @param {boolean} input.silent                this compose was itself a silent re-ask
 * @param {number}  input.pollAttempt           live-refresh attempts already spent
 * @param {number[]} [input.delays]
 * @returns {{ schedule: boolean, delayMs: number|null, nextPollAttempt: number,
 *             upgradePending: boolean, liveRefreshExhausted: boolean }}
 */
export function planComposeFollowup({
  composed = false,
  structureOnly = false,
  hasStructure = false,
  transientSourceRetry = false,
  livePending = false,
  silent = false,
  pollAttempt = 0,
  delays = LIVE_REFRESH_DELAYS_MS,
} = {}) {
  const needsStructureUpgrade = structureOnly || (composed && !hasStructure);
  const canRefreshLive = livePending && pollAttempt < delays.length;
  const canRunOneShotUpgrade = !silent && (needsStructureUpgrade || transientSourceRetry);
  // Exhaustion is a fact about the LIVE ladder alone — it can be true while a
  // one-shot upgrade still schedules (the upgrade won't refresh live again:
  // its follow-up runs with the ladder already spent).
  const liveRefreshExhausted = livePending && !canRefreshLive;

  if (!canRefreshLive && !canRunOneShotUpgrade) {
    return {
      schedule: false,
      delayMs: null,
      nextPollAttempt: pollAttempt,
      upgradePending: false,
      liveRefreshExhausted,
    };
  }

  return {
    schedule: true,
    delayMs: canRefreshLive ? delays[pollAttempt] : delays[0],
    // A pure one-shot upgrade must not reopen the live ladder on its follow-up.
    nextPollAttempt: canRefreshLive ? pollAttempt + 1 : delays.length,
    upgradePending: needsStructureUpgrade || transientSourceRetry,
    liveRefreshExhausted,
  };
}
