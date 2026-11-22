# Live recovery implementation plan

> **For agentic workers:** Use superpowers:executing-plans inline; one fresh independent whole-branch review at the end.

**Goal:** Recover the original Live read after a transient gateway response and refresh the matching overview after explicit lookup, keeping the day unchanged.
**Architecture:** Reuse the bounded capability-follow loop; retain a separate day/generation-bound display observation for matching selected-day queries.
**Tech Stack:** Existing React/TypeScript, .mjs contracts, Node tests and mounted planner harness.
**Spec:** docs/superpowers/specs/2026-11-06-live-recovery-design.md

## Global constraints

- Existing 120s maximum capability lifetime/cadence and token-only request body remain. No new collection or route replay.
- Structured failures and invalid successful envelopes fail closed; upgrade remains separately authorized.
- Query observations never enter original/saved/shared day state or grant public publication/route authority.
- No providers, dependencies, infrastructure, layout or runtime activation changes.

## Review focus

- HTML gateway errors vs genuine503 refusal, malformed200, expiry and cancellation.
- Permanent gateway errors terminate at the original lifetime; upgrade errors never get an accidental new attempt.
- Same-date/scope/time observations refresh card health and facts without storage or Maps mutation.
- Another period/scope/date, pending or a superseded body cannot relabel the overview.
- Intent changes, recomposition, restore/undo and late original completion cannot lend another day stale query facts.

### Task 1: Recover the original completion read

**Files:** frontend/src/lib/live-completion.mjs; frontend/tests/live-completion-gateway.test.mjs; frontend/tests/planner-live-recovery.test.mjs.
**Interface:** Existing followLiveCompletion outcome and callback contracts remain unchanged.

- [x] Add real Response HTML502→terminal and related gateway/lifetime/refusal/cancel controls; recovery cases failed before the fix.
- [x] Continue the original loop only for 502/504 or unreadable 503, within unchanged bounds. Route-upgrade handling is unchanged.
- [x] Verify unit and mounted completion/race regressions PASS. Commit with Task 2 because both correct the same recovery flow.

### Task 2: Match explicit lookup observations to the overview

**Files:** frontend/src/components/AnywherePlanner.tsx; frontend/tests/planner-live-recovery.test.mjs.
**Interface:** Internal read-only observation {day,intentId,events}; existing LiveCard props/rendering unchanged.

- [x] Add mounted partial/healthy-empty recovery and mismatched/pending/late-body cases; matching-card cases failed before the fix.
- [x] Admit only a terminal accepted reply with exact around_place/tonight/date match, bind to day+generation, and derive existing card buckets/health/source from it. Original response/sheet/publication/route storage ownership stays separate.
- [x] Verify relevant Live/navigation/storage controls, typecheck and build. The displayed response's installed intent closes the before-debounce held-day gap while supporting legacy saved entries and route-less views. Source-failed query envelopes cannot mask successful original completion. Review findings were reproduced RED then corrected GREEN, including a healthy-empty precedence control and Undo.
- [ ] Verify committed dist, independent review and exact-head Linux CI.

Local verification after review corrections: 38 new regressions and 149 affected existing checks pass; typecheck and frontend rebuild pass. Committed dist, review correction readback and exact-head Linux CI remain. One existing real-publication test fails on macOS both here and on an untouched f3f429e archive (Linux publication-store dependency); it remains a CI observation limit, not a passing local check.

## Delivery

Independent whole-branch review under superpowers:requesting-code-review. Fix Important/Critical findings with regression proof. Publish a main-targeted PR and obtain exact-head Linux CI. Historical502 origin cause and broad provider health remain unproven. Public #680 acceptance is retained within its original scope; do not launch another provider/day matrix to make this frontend fix appear green.
