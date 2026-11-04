# Mobile day UX implementation plan

> **For agentic workers:** Use superpowers:executing-plans. The user chose direct implementation without further design questions; Codex owns implementation and integration, with a fresh whole-branch review.

**Goal:** Make the published mobile day easier to read and act on while preserving Linje and truthful publication states.

**Architecture:** Refine existing presentational components and reuse the existing intent/publication ledger. No composer, provider, persistence or timeout changes.

**Tech stack:** Existing React/TypeScript, Astro, Tailwind, Node22 jsdom harness.

**Spec:** User's 4November instruction to build the recommended mobile package without further design questions; this short design records Codex's detail decisions.

## Design and alternatives

Preserve Linje. YOUR DAY / DIN DAG precedes the city, with one small absolute selected date under it; Today/Tomorrow is optional context, never a replacement for the date. Near-me keeps its honest location label. Keep Change and Adjust as existing accessible controls. Compact map becomes 160px high on phones and still expands to the existing interactive map. Source caveats and partial/missing pick evidence stay visible. Use a 24px mobile section gap rather than40px, retaining more space on desktop. Keep the existing route readable during updates and describe a pending ordinary Keep by its requested identity. After10seconds of loading, explicitly say the previous day remains on screen. No fake progress or provider-stage promise.

A bigger replacement of Follow the day was considered and deferred: it changes the core interaction and deserves its own bounded pass after this one. PR674's open-stop restyling stays separate; do not take its old generated assets.

## Global constraints

- Base current GitHub main6a55514c; branch codex/mobile-day-ux-20261104; owner Codex.
- Preserve Linje palette/fonts/tokens, source and walking honesty, unknown-weather handling, request generation, cancellation, atomic publication and Undo.
- No new dependencies, provider calls, longer timeouts, backend changes or paid services.
- Publication approval for676 does not authorize a new merge/deploy. Deliver a reviewable main-targeted PR after verification.

## Review focus

- Restored/past/invalid dates must never borrow today's date.
- Long city and stop names must wrap at320px without sacrificing controls.
- Pending Keep names current intent only; obsolete responses cannot confirm a newer choice.
- Partial source and pick coverage stay visible and remain historical response facts.
- Desktop map, mobile expansion,44px controls and reduced motion remain usable.

## Task1: Compact day overview

Files: planner/DayHeader.tsx, planner/AnchorCard.tsx, planner/DayPlaceholder.tsx, AnywherePlanner.tsx; relevant hierarchy/navigation/contract tests.

- [x] Update real-component title/date assertions and add the displayed-date-once assertion; run targeted tests and verify expected RED.
- [x] Render user-requested title/date hierarchy; move displayed date out of AnchorCard summary into DayHeader. Keep the selected preferences/rhythm once and all output coverage evidence.
- [x] Reduce collapsed map and matching placeholder to160px, mobile main gaps to24px. Do not alter expanded/desktop map geometry.
- [x] Run hierarchy, date/navigation and relevant presentation contracts; confirm GREEN.

## Task2: Readable retained day and meaningful pending feedback

Files: AnywherePlanner.tsx, planner/DayHeader.tsx, planner/StopLine.tsx; planner-adjust-rebuild.test.mjs and existing commitment-race tests.

- [x] Add a real mounted Keep test: pending current identity, previous-day explanation after10seconds, stale answer not falsely confirmed; verify RED.
- [x] Derive pending ordinary pin names by comparing current intent to the displayed answer's validated commitment snapshot; render through optional DayHeader update copy. Reuse loadingStage for long-wait explanation.
- [x] Remove route text/leg/map fading while retaining explicit stale state and existing busy controls. Do not alter state machine or publication decisions.
- [ ] Run affected lifecycle/race/Live/refusal/source tests, typecheck, frontend suite, build/dist check. Browser suites may need configured Chromium; report skips honestly.

## Finish

- [ ] Inspect mobile390/320 and desktop in one bounded browser pass with controlled frontend-only evidence; preserve public runtime.
- [ ] Run Impeccable detector once over changed UI targets, review actionable findings within incumbent style.
- [ ] Fresh whole-branch review, fix confirmed blockers, commit and push reviewable main-targeted PR; exact-head CI.
- [ ] Handoff actual head, main, UI evidence and remaining publication step. #674 remains separate.

## Execution record

Expected RED: four requested title/Keep failures,29existingPASS after setting test NODE_ENV correctly. Initial production-container test environment had React act setup errors; those were not product failures. A fresh review found a real aria-busy ancestor issue; bounded Boolean assertion reproduced RED, then moving live status outside busy ancestry passed GREEN. The original DOM-object assertion produced an excessively large diagnostic; it was corrected to a Boolean check.

33focused hierarchy/update tests PASS. Later51affected a11y/language/race/update tests PASS. Typecheck and build PASS. Full Mac frontend attempt1031PASS/22FAIL: two remaining old title/date expectations corrected and included in the later51PASS; twenty remaining real-publication/native failures match the known Mac storage limitation, not claimed green. Prior sandboxed run had permission-denied setup failures; not counted as product failures. Linux exact-head CI is the remaining whole-suite gate.

Read-only review: one Important accessibility finding fixed; long-name risk reproduced and corrected in stop/Blitz text wrapping. No compositor/provider/state-machine changes. Source/pick limitations remain visible. Mechanical detector returned[] for the changed UI before the final wrapping-only fixes. Controlled built-UI checks at390/320px show no final horizontal overflow; long waiting status has no busy ancestor. Same-fixture edited first-stop top684→632px. These are fixture UI checks, not a new public provider acceptance.

Authoritative integration now uses isolated local Git checkout /private/tmp/parranda-mobile-day-ux-20261104. Pi review worktree still holds an earlier uncommitted version and must not be mistaken for the PR head. SSH became unreachable during verification; public health remained6a55514. Two bounded reconnects failed before authentication; cause unknown. No public service mutation.
