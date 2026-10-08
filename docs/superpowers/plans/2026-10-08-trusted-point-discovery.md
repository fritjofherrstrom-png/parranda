# Trusted point discovery implementation plan

> Execute inline with superpowers:executing-plans and test-driven-development.

**Goal:** A trusted resolved point with local administrative context can queue bounded source discovery when its provider supplies no area bounds.
**Architecture:** Intake exposes a separate private discovery scope. A server-calculated 5 km half-side aperture is search geometry, never an administrative area, route scope or coverage claim. Planner and Live pass it only to discovery. Existing provider bounds remain authoritative.
**Spec:** CODEX.md, docs/PARRANDA_ENGINE_GOALS.md, docs/AGNOSTIC_ENGINE_NORTH_STAR.md.
**Owner / target:** Codex / codex/trusted-point-discovery / main-targeted draft PR.
**Base:** GitHub main 4b55cb091256e27a793f5c849f1c52b48c896ace. Independent change; no parent PR or staging ancestry included.
**Landing condition:** focused deterministic checks and CI green; fresh review; inspect unpublished staging 525606d and reconcile #569 selected-place intake before landing. No deployment in scope. Integration owner Codex; exact-head runtime QA owner unassigned, Hermes's bf91fa9 observation is historical evidence only.

## Constraints and review focus

- Public context, bounds and signed-selection-like fields cannot mint trusted discovery identity.
- Ambiguous, weak, invalid, contextless and country-only resolutions do not receive an aperture.
- Keep explicit coordinates fixed; only trusted reverse context can supply their discovery identity.
- Preserve provider bounds; invalid or detached provider bounds cannot silently become a fallback.
- No named-place rules; no source approval, event evidence or coverage promotion.
- No live network in tests. No cold/runtime claim from synthetic fixtures.

### Task 1: intake, geometry and queue contract

Files: server/place-candidates/spatial-scope.js; server/planner/agnostic-place-intake.js; tests/trusted-point-discovery.test.js.
- [x] RED: observed Uppsala point metadata must queue a bounded demand; unrelated point also works; private scope stays outside public intake and ordinary spatialScope; missing context and rejected resolutions remain closed; bounds retain authority.
- [x] Implement a clamped local aperture using the existing 5 km policy; mint it only after accepted trusted resolution and allowlisted local context.
- [x] GREEN: run the focused regression tests and existing intake/catalog tests.

### Task 2: planner and Live wiring

Files: server/app.js; server/place-candidates/live-event-query.js; tests/trusted-point-discovery.test.js.
- [x] RED: one normal flagged Planner request forwards private scope; around-place/near-me Live forwards discovery only; in-place still fails without real area bounds; public injection and detached resolver fail closed.
- [x] Pass discoverySpatialScope independently of spatialScope; retain normal Live radius and all event trust gates.
- [ ] GREEN: run affected suites, diff review and CI. Publish a draft PR with exact SHA/evidence and outstanding staging/review conditions.

## Evidence and ledger

Archive SHA256SUMS checked. Uppsala cold run on bf91fa9: 40.8615 s, one submission plus 11 polls, two provisional Overture stops, no recorded scout target. Captured trusted Photon point has county/country/country_code but no bounds. Deterministic replay rejects that demand; a synthetic bounded control is accepted. NAPI was disabled; Live background work was stopped before completion. Loader error cause remains unknown.

Verification: RED 7 failed / 3 passed before implementation; GREEN 10/10 regressions and 110/110 affected tests. No live provider calls. Code review, CI and publication pending.
