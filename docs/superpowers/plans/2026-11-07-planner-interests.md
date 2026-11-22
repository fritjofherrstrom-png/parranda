# Planner Interests Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal**. Combine and prioritize 21 source-backed Planner interests, including Cheap eats, and rebuild a day with one action.

**Architecture**. Share the closed Planner keys between UI and publishing. Extend source match evidence and existing role selection. Score Live music on dated Live occurrences and pass match evidence into the same final day truth.

**Tech Stack**. React, Astro, Tailwind, Node and the existing test suites.

**Spec**. docs/superpowers/specs/2026-11-07-planner-interests-design.md

## Global Constraints

Keep the seven-selection bound, original quick-choice meaning, date, anchor and commitments. Preserve the existing source, availability and walking gates. Keep source provenance and exact/partial/missing coverage separate. Use the existing Linje design system and SV/EN copy. No new providers or dependencies. Deliver the five groups together.

## Review Focus

- Shared or saved days with new and legacy keys retain both selection and order.
- Narrow categories distinguish related venues before bounded ranking cuts.
- Unknown prices, ordinary bars and undated programmes cannot become exact matches.
- Canceled and unsuccessful edits preserve the current day while allowing new picks.
- Drafts, focus, max selection and one explicit update work at mobile and desktop widths.

## Task 1. Shared contract and publication

- [ ] Test that the twenty-one grouped keys are unique, legacy keys are accepted, and a mixed selection with an explicit first choice survives a published round trip.
- [ ] Run the focused contract tests and confirm failure with the old keys.
- [ ] Export PLANNER_INTEREST_GROUPS and MAX_PLANNER_PREFERENCES from shared/planner-intent.mjs with declarations. Update server/planner/published-day-fields.js, published-day-publication.js and frontend/src/lib/published-day.mjs to consume the bounded shared keys. Test older exact snapshots.
- [ ] Verify focused backend and frontend publication tests, then commit.

## Task 2. Stable place matches

- [ ] Test source-shaped positive and confusing-negative fixtures for every stable-place choice, including missing or higher prices, and verify the tests fail on the base.
- [ ] Add distinct exact intent definitions in server/candidates/intent-vocabulary.js using the shared public keys. Retain exact approved source categories through OSM/Overture and explicitly low prices through existing trusted catalog/structured source paths. Feed specific intents into existing roles only on requests that choose them. Preserve broader choices and selection gates.
- [ ] Verify intent fit, candidate cuts, provider contracts and mixed-category real-HTTP composition, then commit.

## Task 3. Dated Live match

- [ ] Test a verified dated concert, unrelated same-day event, venue without a dated performance and an occurrence outside the selected day. Verify the explicit Live music request fails on the base.
- [ ] In the existing Live fit and planner weave, use live_music with the existing source, occurrence and route eligibility checks. Publish the exact match only when a qualifying stop is in the day. A standalone Live occurrence remains available from Live when the current composer cannot form a day around it.
- [ ] Verify Live fit and weaving tests and commit.

## Task 4. Linje chooser

- [ ] Test grouped options, edits across groups, one apply, cancel, selection cap and first-choice behavior. Verify failure on the base.
- [ ] Use PLANNER_INTEREST_GROUPS in the AnchorCard chooser. Preserve quick choices and feed an atomic batch into AnywherePlanner. Support return focus and keyboard, expose applied labels in coverage, and retain the previous day on no match with a clear editable explanation.
- [ ] Verify UI regressions and typecheck. The integration owner builds frontend/dist after all tasks are present.

## Integration and delivery

- [ ] Compose different days against the same bounded place/date fixture. Inspect a sparse response and retained route, source/date/commitment invariants, and verify UI operation in built desktop and mobile views.
- [ ] Run both repository test commands, typecheck, built dist drift and diff checks. Review the combined change and publish a reviewable main-targeted draft.
