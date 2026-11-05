# Confirmed day saving implementation plan

> **For agentic workers:** Use superpowers:executing-plans to implement inline; final independent review only.

**Goal:** Save the actual accepted day and never claim storage success after a failed write.
**Architecture:** Keep saved-query IDs and upsert behavior. Compare saved version contents independently of save time/view sort; make saved-list writes transactional from the UI's perspective.
**Tech Stack:** Existing React/TypeScript, pure .mjs storage helpers, Node test runner and mounted jsdom planner harness.
**Spec:** docs/superpowers/specs/2026-11-05-confirmed-day-saving-design.md

## Global constraints

- Public Linje layout, public sharing authority, source trust and privacy remain unchanged.
- No new provider/model/paid service or runtime activation.
- Independent main-based branch; #678 remains a separate unlanded PR with its own release decision.

## Review focus

- Same query, changed source/stop answer: Save must remain possible and restore the replacement.
- Same answer with a different savedAt/view sort: remain Saved.
- Commitments/classification/inputs change without stop changes: do not falsely claim the old version is current.
- Quota/security failure: keep prior persisted records and focus; explicit retry succeeds without another compose.
- Removal failure: do not hide a day that is still persisted; successful retry removes only that query.

### Task 1: Confirm the version and the write

**Files:** frontend/src/lib/anywhere-storage.{mjs,d.mts}; frontend/src/components/AnywherePlanner.tsx; frontend/tests/anywhere-storage.test.mjs; frontend/tests/planner-confirmed-saving.test.mjs.
**Interfaces:** export isSavedEntryVersion(saved, current): boolean; local writeLS returns boolean. Save/removal errors stay component state and use existing text/status styles.

- [x] Add mounted regressions for a rebuilt same-query answer, a rejected Save and rejected removal. Run on unchanged product; expect behavioral failures.
- [x] Add the version comparison and its focused fact/commitment/time/view controls. Save/removal commit UI state only after successful storage; translated failure permits retry.
- [x] Run focused tests and related persistence/navigation/Live controls. Expected: all pass; no new compose on save/retry/restore.
- [x] Run frontend typecheck, build, dist consistency and diff checks. Expected: PASS; no layout-source changes.
- [x] Commit the implementation and run the complete local frontend suite under the network guard; Linux exact-head CI remains the full acceptance gate.

## Delivery gates

Independent whole-branch review; fix any Important/Critical with a regression. Publish a main-targeted PR and obtain exact-head CI. No merge/deploy.

## Verification record

Three original mounted regressions RED→GREEN. A legacy entry and a one-shot-receipt language view were also reproduced RED→GREEN before their fixes. Final affected suite114PASS/0FAIL/0SKIP; final typecheck/build PASS. The broad local pre-final diagnostic had1038PASS/20FAIL: server-publication preconditions expected ready but storage returned unavailable. One such test also fails on an untouched main6a archive; macOS has no /proc/self/fd and the unchanged publication store explicitly requires Linux. This is not a final-head full-suite PASS. Exact-head Linux CI is still required.
