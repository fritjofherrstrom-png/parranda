# Rhythm and meal context implementation plan

> For agentic workers: use superpowers:executing-plans; Codex implements in this session and obtains a final independent review.

Goal: make explicit rhythm changes effective after manual shortening, then implement the approved time-aware meal model.
Architecture: reuse scoped commitments/Undo and the real engine's ordering/geometry. Trusted date/time enters privately; no public provenance or availability upgrade.
Tech stack: existing React/TypeScript/Node, mounted jsdom, built Chromium and real HTTP.
Spec: docs/superpowers/specs/2026-10-27-rhythm-meal-context-design.md

## Constraints and review focus
- Preserve removed IDs, newer pins and absolute place/date scope.
- Ordinary reload/retry/interest change must not refill a shortened day.
- Late old responses/completion and Undo must not revive an old count or silently compose.
- Meals later open, known closed, unknown hours, unknown timezone and future dates differ.
- No new source acquisition, hours claims, walking-budget exceptions or unrelated preferences.

## Task1 — explicit rhythm overrides prior extent
- [ ] Add mounted real-component RED covering Remove→Relaxed→Full; no old day_edit in rhythm payload, exclusions/pins retained; control same-step/reload/interest change; Undo and late responses.
- [ ] Run RED before product changes.
- [ ] Update only chooseRhythm's extent transition, leaving other adjustment semantics intact.
- [ ] Run focused GREEN and actual built UI→HTTP→engine regression, with fresh Full control.
- [ ] Build dist, check drift; make traceable local commit.

## Task2 — trusted time-aware meal planning
- [ ] Trace real HTTP time/preference/availability/ordering and freeze discriminatory midday, evening, future/unknown-time controls with actual admitted supply.
- [ ] Add RED for lunch-start and separate later meal; negative facts and geometry/pin constraints.
- [ ] Thread minimal private trusted context and implement bounded ordering through existing policy, leaving source/admission paths intact.
- [ ] Verify real HTTP publication and built UI; source transports/clocks explicitly controlled.
- [ ] Run relevant regressions, frontend suite/typecheck/build/dist serially, full exact-head CI if published, and final independent diff review.
- [ ] Report exact head/base, changes, tests/skips, limits and release recommendation. No blind reuse of old-head acceptance.
