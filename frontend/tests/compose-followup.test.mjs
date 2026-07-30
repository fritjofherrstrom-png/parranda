// The compose follow-up policy: which finished composes schedule a silent
// re-ask, with what delay, and when the live ladder reads as exhausted. These
// rules previously lived inline in the planner component — the layer where
// hand-caught regressions (snapshot pausing, ladder never ending) came from.
import { test } from "node:test";
import assert from "node:assert/strict";
import { planComposeFollowup, LIVE_REFRESH_DELAYS_MS } from "../src/lib/compose-followup.mjs";

test("a settled compose with structure and no live pending schedules nothing", () => {
  const plan = planComposeFollowup({ composed: true, hasStructure: true });
  assert.deepEqual(plan, {
    schedule: false,
    delayMs: null,
    nextPollAttempt: 0,
    upgradePending: false,
    liveRefreshExhausted: false,
  });
});

test("a user compose that composed WITHOUT structure gets exactly one silent upgrade", () => {
  const plan = planComposeFollowup({ composed: true, hasStructure: false, silent: false });
  assert.equal(plan.schedule, true);
  assert.equal(plan.delayMs, LIVE_REFRESH_DELAYS_MS[0]);
  assert.equal(plan.upgradePending, true);
  // The follow-up must arrive with the live ladder spent, so a pure structure
  // upgrade can never reopen live refreshing on its own.
  assert.equal(plan.nextPollAttempt, LIVE_REFRESH_DELAYS_MS.length);

  // …and the silent follow-up itself never chains another upgrade.
  const followup = planComposeFollowup({
    composed: true,
    hasStructure: false,
    silent: true,
    pollAttempt: plan.nextPollAttempt,
  });
  assert.equal(followup.schedule, false);
});

test("a user structure-only result gets one bounded chance to become a route", () => {
  const plan = planComposeFollowup({ structureOnly: true, hasStructure: true, silent: false });
  assert.equal(plan.schedule, true);
  assert.equal(plan.delayMs, LIVE_REFRESH_DELAYS_MS[0]);
  assert.equal(plan.upgradePending, true);
  assert.equal(plan.nextPollAttempt, LIVE_REFRESH_DELAYS_MS.length);

  const followup = planComposeFollowup({
    structureOnly: true,
    hasStructure: true,
    silent: true,
    pollAttempt: plan.nextPollAttempt,
  });
  assert.equal(followup.schedule, false, "a persistent thin result never loops");
});

test("an explicit transient trusted-source failure retries once — silently composed retries never chain", () => {
  const plan = planComposeFollowup({ transientSourceRetry: true, silent: false });
  assert.equal(plan.schedule, true);
  assert.equal(plan.upgradePending, true);
  assert.equal(planComposeFollowup({ transientSourceRetry: true, silent: true }).schedule, false);
});

test("live pending walks the 9/12/18 ladder then reports exhaustion", () => {
  let attempt = 0;
  for (const expected of LIVE_REFRESH_DELAYS_MS) {
    const plan = planComposeFollowup({ livePending: true, silent: attempt > 0, pollAttempt: attempt });
    assert.equal(plan.schedule, true, `attempt ${attempt} schedules`);
    assert.equal(plan.delayMs, expected);
    assert.equal(plan.liveRefreshExhausted, false);
    assert.equal(plan.upgradePending, false, "a live refresh alone is not an upgrade");
    attempt = plan.nextPollAttempt;
  }
  const spent = planComposeFollowup({ livePending: true, silent: true, pollAttempt: attempt });
  assert.equal(spent.schedule, false);
  assert.equal(spent.liveRefreshExhausted, true, "still pending after the ladder → exhausted");
});

test("exhausted live + a pending one-shot upgrade still schedules, and exhaustion stays true", () => {
  const plan = planComposeFollowup({
    composed: true,
    hasStructure: false,
    livePending: true,
    silent: false,
    pollAttempt: LIVE_REFRESH_DELAYS_MS.length,
  });
  assert.equal(plan.schedule, true);
  assert.equal(plan.delayMs, LIVE_REFRESH_DELAYS_MS[0]);
  assert.equal(plan.liveRefreshExhausted, true);
  assert.equal(plan.upgradePending, true);
});

test("live resolved (not pending) clears exhaustion regardless of spent attempts", () => {
  const plan = planComposeFollowup({ livePending: false, silent: true, pollAttempt: LIVE_REFRESH_DELAYS_MS.length });
  assert.equal(plan.liveRefreshExhausted, false);
  assert.equal(plan.schedule, false);
});
