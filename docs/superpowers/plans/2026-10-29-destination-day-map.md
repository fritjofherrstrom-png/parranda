# Destination search, day header and map refinement

> Execution: independent scoped tasks in one isolated branch, then integration review and browser verification.

**Goal:** Make destination submission reliable, shorten the day title, show the selected date and compact trusted weather, and draw fluid overview connectors.

**Spec:** User request and three supplied screenshots, 29 October 2026. Keep `Your day` plus city name, omit `A day in`, date smaller below; compact degrees and weather condition; softer map lines. Claude owns the separate Sprint map prototype.

**Architecture:** Reuse the current React/Astro Linje components and existing weather provider. Keep weather presentation independent of the meaningful-weather dayflow narrative. Smooth only map sketches for display, leaving actual geometry and navigation unchanged.

**Base:** GitHub origin/main `7e86d0c650e307a3225c76b950a766606488cd2d`.
**Owner / branch:** Codex / `codex/destination-day-map-20261029`, main-targeted PR.
**Landing condition:** Focused behavior tests, frontend suite/check/build, local mobile/desktop visual verification, independent review. Merge and deployment remain separate from this implementation request.

## Constraints

- Preserve existing Linje typography, palette and functional controls.
- Keep free-text destination submission, exact selected-place identity and ambiguity handling.
- No invented weather, opening hours, route distances or walking paths.
- Selected-date forecast high must be identified accessibly; stale, missing or mismatched data is omitted.
- Preserve source quality, partial-day states, committed-day identity and ordinary-weather narrative silence.
- No duplicate weather acquisition, named-city rules or new dependencies.
- Deterministic tests must not access live providers.

## Review focus

- Pointer blur must not move the submit button before pointer-up.
- Keyboard, touch and text-only search must retain their distinct valid paths.
- Weather/date must describe the displayed day through rebuilds and saved-day restores.
- Zero/negative temperatures and snow/thunder conditions remain accurate.
- Smooth display paths must retain endpoints without changing trusted geometry or fit bounds.

## Tasks

1. **Destination submission:** reproduce open-suggestion blur/reflow and pointer click behavior; add a failing regression, fix the cause, and verify typing, selecting, free-text submission and keyboard use.
2. **Header and weather:** remove redundant title prefix; add the actual displayed date; publish a bounded weather summary from existing trusted daily weather and render degrees plus condition with honest semantics. Test missing/stale/date cases and ordinary-weather compatibility.
3. **Map presentation:** add bounded sketch-only smoothing with unchanged original endpoints; keep detailed geometry intact and a visible overview qualification. Test invalid/duplicate inputs, determinism, no mutation and bounds.
4. **Integration:** run relevant server tests and full frontend suite/check/build, inspect desktop and 390px mobile in the in-app browser, run one design-detector pass, request independent review, then publish a reviewable PR with exact verification limits.
