# Landing autocomplete acceptance

Frozen runtime source: `417a0bb8e70e7b3d5c99381fd429bdb2b2c39a6c` (local Node 24 + committed Astro dist). Evidence commit adds only this directory. Main remains `4b55cb091256e27a793f5c849f1c52b48c896ace`. Owner: Codex for implementation, integration and runtime QA, PR #565 targeting main.

PASS criteria: suggestions appear attached to the field while typing; names have source-backed context; a selected row fills the field and carries its authenticated identity to Planner/Blitz; no stale response replaces current input; mobile has no horizontal overflow. This acceptance does not cover place/event supply, deployment or production throughput.

## Actual provider and UI results: PASS

- Public Photon, no fixture results: `aspud` yielded Aspudden in Stockholms kommun first, followed by distinguishable namesakes. `asp` with a prior server-verified choice in that area yielded the same district first. Without prior geography, short prefixes are global; Swedish UI language is not Sweden evidence.
- `montrou` yielded Montrouge first, with source-backed Hauts-de-Seine / Île-de-France / France context. No named-place production rule was introduced.
- Default desktop browser and mobile override requested at 390×844: field-attached list and keyboard selection worked. Effective mobile DOM viewport was 351×760 due to browser scaling; document clientWidth and scrollWidth both 351 (no horizontal overflow). The list opens above the field when there is insufficient room below.
- Arrow Down + Enter filled the canonical qualified query. “Bygg min dag” navigated to Planner with that query; no browser error/warning logs. Real-provider selected receipt also resolved through Blitz with the same label and Photon provenance.
- Local QA deliberately set openDataLoader/eventSupply to null and weatherProvider to a null fixture. Planner honestly showed no composed day. That is a supply-disabled control, not a demonstrated recognition failure or acceptance of route quality.

[Structured results](runtime.json) omit signed receipts. [Desktop field](field-desktop.png), [mobile field](field-mobile.png), [selected Planner](selected-planner.png).

## Deterministic checks

Independent read-only review: Ready, no outstanding material findings. Fixed regressions cover distinct state labels, memory-only prefix caching and city-node routing without invented bounds. Focused provider/cache/public guard checks: 42 PASS. Landing/routing/harness delta: 12 PASS. Typecheck, build, committed dist parity and self-hosted production validator PASS. Exact final-head CI is recorded in the PR handoff; this runtime record never promotes earlier-head checks to final-head CI.

Limits: public provider capacity/availability is not certified. Pacing, bounded queue, timeouts, coalescing and a bounded 256-entry memory cache protect this lane; the endpoint is configurable. Suggestions failing leaves ordinary free-text submit available. No merge, deployment or source-PR reconciliation occurred; #563/#564/#562/#501 remain excluded.
