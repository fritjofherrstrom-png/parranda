# Live Readability Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans or subagent-driven-development with explicit file ownership.

**Goal:** Make source-backed Live events easy to scan while retaining timing and source uncertainty.
**Architecture:** Shared frontend event presentation and timing metadata; backend event facts stay unchanged. The separate local-research task owns discovery/pilot.
**Tech Stack:** Existing React/TypeScript and pulse-view.mjs; no new dependencies.
**Spec:** ../specs/2026-10-27-local-live-readability.md

## Constraints and review focus

- Preserve source URLs/destination identity, attribution and required credits.
- A period never implies daily opening or a confirmed occurrence.
- Programme date span must not inherit an unrelated recurrence claim.
- Display cleanup must not alter canonical place/address facts or invent location.
- Card/sheet/other timing consumers remain coherent in EN/SV and on narrow screens.

### Task 1: Frontend presentation

Files: frontend/src/components/planner/Live{Card,Sheet,EventSource}.tsx,
EventOccurrences.tsx, timing consumers/lib declarations as necessary and focused frontend tests.
Consumes existing PulseEvent. Produces shared readable presentation and separately rendered timing notice where required.
- [ ] Reproduce current Borrby period/place/source clutter in mounted UI expectations; observe RED.
- [ ] Implement minimal shared hierarchy and clear period notice; retain semantic controls for daily/occurrences/unknown timing.
- [ ] Verify EN/SV, source link identity, contact-suffix cleanup and card/sheet consistency; report exact commands/results and files.

### Task 2: Integration (root)

- [ ] Check current main and follow-up source heads; this UI change can ship independently. Run affected verification before CI.
- [ ] Build/typecheck frontend, commit dist, whole-branch review and exact-head CI.
- [ ] Main-targeted PR, coordinate current main/head/runtime, deploy and capture real Borrby screenshots.
