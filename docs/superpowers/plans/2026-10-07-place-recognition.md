# Place Recognition Implementation Plan

> Execute inline with superpowers:executing-plans; use one independent whole-branch review.

Goal: generic geographic recognition and selectable, continuous place identity.
Architecture: provider-owned structural matching plus signed resolution receipts; existing intake and consumers retain their trust gates.
Tech: Node/Express, React/Astro, built-in crypto; no new dependencies.
Spec: docs/superpowers/specs/2026-10-07-place-recognition-design.md
Constraints: no named-place rules, no autocomplete, seven-day receipts, 30 km soft bias, explicit coordinates win, no merge/deploy.
Review focus: forged selection/context, expired saved choice, delayed responses after selection/navigation, venue compatibility, selection propagation to all consumers.

### Task 1: Structural matching and contextual search
- [ ] Write and observe failing provider-shaped regressions in tests/place-recognition.test.js.
- [ ] Add allowlisted aliases/admin matching and context-aware ranking in server/place-candidates/place-resolver.js; preserve full query and existing venue/coordinate semantics.
- [ ] Run resolver/dominance/Wikidata/spatial suites and commit.

### Task 2: Authenticated place choice and API continuity
- [ ] Write failing signed-choice/intake/API/Live regressions.
- [ ] Create server/place-candidates/place-selection.js exposing createPlaceSelectionStore({cacheDir,secret,now}) with issue(candidate,query) and read(token,query?) methods.
- [ ] Extend resolveAgnosticIntake with placeSelection, placeSelectionStore, placeBias; return selection_id. Wire Planner/Live/Blitz to one buildApp-owned store and distinguish invalid selections.
- [ ] Run affected API/intake/Live/Blitz suites and commit.

### Task 3: User choice and retained inputs
- [ ] Write failing mounted Planner tests and pure payload/storage/Live continuity regressions.
- [ ] Render a small PlaceChoices component in AnywherePlanner; carry placeSelection through requested anchor, saved/restore, language and Blitz. Add explicit location-hint action. Scope commitment identity and share labels to chosen geography.
- [ ] Run frontend tests/check/build and commit generated dist.

### Task 4: Reviewable delivery
- [ ] Run required backend/frontend checks, inspect full diff and obtain independent review; fix material findings with regression tests.
- [ ] Freeze candidate, perform bounded local native/browser and provider QA, document PASS/FAIL/INCONCLUSIVE by scope.
- [ ] Publish main-targeted PR, attach it, obtain exact-head CI and report candidate/main, evidence, limitations and owner. Preserve worktree and branches.
