// The compose follow-up policy: which finished composes schedule a silent
// re-ask. These rules previously lived inline in the planner component — the
// layer where hand-caught regressions (snapshot pausing, ladder never ending)
// came from.
import { test } from "node:test";
import assert from "node:assert/strict";
import { planComposeFollowup, UPGRADE_DELAY_MS } from "../src/lib/compose-followup.mjs";

test("server supply lifecycle replaces speculative one-shot composition", () => {
  assert.equal(planComposeFollowup({ supplyLifecycleComplete: true, structureOnly: true, transientSourceRetry: true }).schedule, false);
});

test("pending Live never schedules a recompose", () => {
  // The old ladder re-ran the whole route up to four times while Live was
  // pending. The original compose's Live result now arrives through its own
  // completion capability, so the policy has no Live input at all.
  for (const input of [{ composed: true, hasStructure: true, livePending: true }, { supplyLifecycleComplete: true, composed: true, livePending: true }]) {
    assert.deepEqual(planComposeFollowup(input), { schedule: false, delayMs: null, upgradePending: false });
  }
});

test("a settled compose with structure schedules nothing", () => {
  assert.deepEqual(planComposeFollowup({ composed: true, hasStructure: true }), {
    schedule: false,
    delayMs: null,
    upgradePending: false,
  });
});

test("a user compose that composed WITHOUT structure gets exactly one silent upgrade", () => {
  const plan = planComposeFollowup({ composed: true, hasStructure: false, silent: false });
  assert.deepEqual(plan, { schedule: true, delayMs: UPGRADE_DELAY_MS, upgradePending: true });
  // …and the silent follow-up itself never chains another upgrade.
  assert.equal(planComposeFollowup({ composed: true, hasStructure: false, silent: true }).schedule, false);
});

test("a user structure-only result gets one bounded chance to become a route", () => {
  const plan = planComposeFollowup({ structureOnly: true, hasStructure: true, silent: false });
  assert.equal(plan.schedule, true);
  assert.equal(plan.upgradePending, true);
  assert.equal(
    planComposeFollowup({ structureOnly: true, hasStructure: true, silent: true }).schedule,
    false,
    "a persistent thin result never loops",
  );
});

test("an explicit transient trusted-source failure retries once — silently composed retries never chain", () => {
  const plan = planComposeFollowup({ transientSourceRetry: true, silent: false });
  assert.equal(plan.schedule, true);
  assert.equal(plan.upgradePending, true);
  assert.equal(planComposeFollowup({ transientSourceRetry: true, silent: true }).schedule, false);
});
