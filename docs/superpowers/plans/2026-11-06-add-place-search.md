# Add Place Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a person search for a source-backed place or intent, preview adding it or replacing one meal, and accept or undo without losing the current day.

**Architecture:** Preserve source-owned search facets through the existing provider/candidate spine. An explicit planner search request returns a bounded safe search projection from that same trusted context; manual day edits select exact server-owned identities. A separate client preview flow uses the existing lifecycle transport and installs a result only after confirmation.

**Tech Stack:** Existing Node/Express CommonJS, shared ESM intent helpers, React/TypeScript/Astro and Tailwind; node:test, mounted planner harness, existing Playwright fixtures.

**Spec:** `docs/superpowers/specs/2026-11-06-add-place-search.md`

## Global Constraints

- Baseline: GitHub main `f3f429e4c5c3b7832ae27956ab85f988346fb47e`; owner Codex; branch `codex/add-place-search-20261106`.
- No new dependencies, providers, paid APIs, source discovery lanes or live network in deterministic tests.
- Search: explicit submit, maximum 80 characters and 6 results, same trusted anchor/date and bounded existing provider aperture.
- The current Linje visual system, source/rights/privacy admission and final walking checks remain authoritative.
- Preserve date, interests, pins, exclusions, retained identities, frozen live occurrences, cancellation and exact save/share semantics.
- Unknown hours stay unknown; cuisine comes only from explicit source data; public rows never become source facts.
- Maximum six published stops; a full day offers replacement or a capacity explanation.
- Source merge and runtime activation are separate. No merge/deploy is part of this feature preparation.

## Review Focus

1. Cuisine-like venue names without factual cuisine must not satisfy a cuisine query.
2. A stale preview after midnight, a date/place change, restore or a late Live result must never overwrite the visible day.
3. An added place outside ordinary selected interests is only the user's exact explicit choice, not permission for unrelated filler.
4. Expired sources, unavailable retained Live occurrences, walking refusal and missing candidate identities must preserve the original answer.
5. Accept, save, share, reload and Undo must carry exactly the same admitted edited generation; public capabilities and private position cannot leak.

---

### Task 1: Preserve source-owned search facts

**Files:** Create `server/place-candidates/place-search-facets.js`; modify `overture-source.js`, `open-data-loader.js`, `external-open-provider.js` in that directory and `server/candidates/entity-resolution.js`; test `tests/place-search-facets.test.js` plus affected source tests.

**Interfaces:** Produce `normalizePlaceSearchFacets(value) -> { cuisines: string[] } | null`, `overturePlaceSearchFacets(primaryCategory)` and `osmPlaceSearchFacets(tags)`. Only source mappers create these facts; external provider retains them; exact identity merges union compatible source-backed facets. Public request fields do not populate them.

- [ ] Write failing tests for explicit Indian cuisine and multiple semicolon cuisine tags, exact Overture primaries, unsupported facets, name-only non-evidence, conflicting/unmerged branches and persistence through external normalization/entity resolution.
- [ ] Run `node --require ./tests/helpers/no-live-network.js --test tests/place-search-facets.test.js`; Expected: failures for missing exports/retention.
- [ ] Implement the bounded source-facet normalizer and carry facts without changing candidate types, evidence strength or default source acquisition.
- [ ] Run that file plus existing Overture/external-provider/entity-resolution tests identified by `rg --files tests`; Expected: all affected tests pass.
- [ ] Commit `feat: preserve factual place search facets`.

### Task 2: Bound search to the existing trusted planner context

**Files:** Create `server/planner/day-place-search.js`, `shared/day-place-search.mjs` and its `.d.mts`; modify `server/app.js` and `server/planner/agnostic-route-output.js`; test `tests/day-place-search.test.js` and `tests/day-place-search-api.test.js`.

**Interfaces:** Shared `normalizeDayPlaceSearch(value) -> { query: string } | null`, max 80 characters. Server `searchDayPlaces({ query, candidates, excludedIds, visibleIds, eligibleIds }) -> { query, items, coverage: 'available_supply' }`, max 6. Planner accepts optional `day_place_search` as search intent and emits a bounded safe `day_place_search` sidecar; no client-provided labels, coordinates, facets or URLs are evidence.

- [ ] Write failing tests for exact/partial names, source address, Swedish/English supported category/cuisine aliases, no matches, duplicate/visible/excluded IDs, no fallback city, closed/inactive/ineligible candidates, oversized/malformed input, output field whitelist and injected source facts.
- [ ] Run both new files with the network guard; Expected: missing implementation failures.
- [ ] Implement pure matching and integration with the retained trusted composition reservoir and existing eligibility. Keep acquisition/time budgets unchanged and do not expose raw records.
- [ ] Run both files and affected intake/source/admission API tests; Expected: search works and legacy request output is unchanged without the new intent.
- [ ] Commit `feat: search trusted places for the current day`.

### Task 3: Exact add and chosen replacement through normal day editing

**Files:** Modify `shared/planner-intent.mjs`/`.d.mts`, `server/planner/day-composition-policy.js`, `server/route-engine.js`, `server/planner/agnostic-route-output.js`, `server/app.js`, `server/planner/published-day-fields.js`, `server/planner/published-day-projection.js`; extend `tests/day-composition-stop-edit.test.js`, `tests/day-edit-retained-publication.test.js` and add `tests/day-place-edit.test.js`.

**Interfaces:** Extend version-1 DayEdit with action `add` (candidate_id is the chosen new ID) and optional `replacement_candidate_id` only for an exact `replace`. Add has target count retained count + 1, max 6; replacement preserves the existing target count/slot. Legacy remove/automatic replace serializations and validation remain byte-compatible when new fields are absent. `dayEditOutcome` reports the chosen added/replacement identity and source/publication refusal atomically.

- [ ] Write failing cases for exact insertion, exact food replacement, pinned target refusal, retained pins outside current preferences, six-stop cap, absent/closed chosen identity, wrong geography, retained Live disappearance, walking failure and publication roundtrip of new intent.
- [ ] Run the edit/publication files; Expected: new intent or chosen identity is currently refused/not preserved.
- [ ] Implement the input evolution, retained/excluded/pinned selection, whole-day walking validation and publication fields using the ordinary admission pipeline. Do not inject a public candidate or use another matching restaurant when the exact choice is unavailable.
- [ ] Run new/affected edit, pin, Live-retention, projection/privacy tests; Expected: exact accepted results and unchanged legacy behavior.
- [ ] Commit `feat: add and replace an exact chosen day place`.

### Task 4: Search and preview without mutating the visible day

**Files:** Create `frontend/src/components/planner/AddPlace.tsx`, `frontend/src/lib/day-place-preview.mjs`/`.d.mts`; modify `frontend/src/components/AnywherePlanner.tsx` and relevant payload types; add `frontend/tests/day-place-preview.test.mjs`, `frontend/tests/planner-add-place.test.mjs`.

**Interfaces:** Preview helper builds search/edit payloads from frozen current intent and uses `fetchPlannerLifecycle`. It returns `{ response, body }` plus cancellation, never writes storage or the visible result. `AddPlace` receives current scope, typed result/preview states and callbacks `onSearch(query)`, `onPreview(candidateId, replaceId?)`, `onConfirm()` and `onCancel()`. Parent adoption is guarded by the same current scope/generation and updates the accepted input/result/commitment snapshot together with an exact Undo baseline.

- [ ] Write failing mounted tests for Enter/search, named/cuisine results, choosing add versus a named replace target, unknown hours, preview order/walking delta, cancellation, source refusal and no current-day/localStorage mutation before confirmation.
- [ ] Add races for late search/preview, midnight, place/date/preference change, existing pin/remove, saved/public/near-me restoration and late Live completion. Cover accept without a second compose, exact Undo and accepted reload/share serialization.
- [ ] Run both new UI test files; Expected: missing field/actions/helper failures.
- [ ] Implement within the existing Linje layout and components. Use real server result geometry for the preview delta; preserve position consent and strip capabilities with existing helpers. UI copy is Swedish/English; results and errors are accessible, keyboard reachable, and announced.
- [ ] Run new UI tests plus existing stop-edit/commitment/publication/lifecycle race suites and TypeScript; Expected: all relevant tests pass.
- [ ] Commit `feat: preview and confirm places added to a day`.

### Task 5: Verify the integrated capability and hand off

**Files:** Add `tests/day-place-search-http-browser.test.js`; update both engine contract documents, `MEMORY.md`, and generated `frontend/dist` through the existing build. Preserve a compact handoff with owner/base/head, evidence scope and remaining runtime coverage.

**Interfaces:** Existing Express + mounted browser fixture proves search → exact preview → confirm → save/share/reload → Undo; no external providers. Default request control remains identical without explicit search/edit intent.

- [ ] Write and run an initially failing HTTP/browser integration for the complete journey, including a source/walking refusal and explicit choice outside baseline interests without unrelated filler; Expected: failure until integration is complete.
- [ ] Complete any integration wiring needed by that fixture and run it with network guard; Expected: PASS.
- [ ] Run root affected tests, frontend suite, `npm run check:frontend`, `npm run build:frontend`, `node scripts/check-frontend-dist-drift.js`, `git diff --check`; Expected: passing affected checks; pre-existing/platform-specific failures must be identified against baseline rather than hidden.
- [ ] Inspect desktop and mobile fixture journeys together in one visual pass; fix material issues in one batch and confirm once. Record fixture scope, no real-provider or physical-Safari claim.
- [ ] Commit changes; obtain one independent whole-branch review under executing-plans and fix Important/Critical findings with RED/GREEN evidence. Prepare the reviewable branch/draft PR handoff, with actual CI if published; do not merge or deploy.
