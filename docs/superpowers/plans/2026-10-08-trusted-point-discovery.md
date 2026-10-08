# Trusted point discovery implementation plan

> Execute inline with superpowers:executing-plans and test-driven-development.

**Goal:** A trusted resolved point with local administrative context can queue bounded source discovery when its provider supplies no area bounds.
**Architecture:** Intake exposes a separate private discovery scope. A server-calculated 5 km half-side aperture is search geometry, never an administrative area, route scope or coverage claim. Planner and Live pass it only to discovery. Existing provider bounds remain authoritative.
**Spec:** CODEX.md, docs/PARRANDA_ENGINE_GOALS.md, docs/AGNOSTIC_ENGINE_NORTH_STAR.md.
**Owner / target:** Codex / codex/trusted-point-discovery / main-targeted draft PR.
**Base:** GitHub main 4b55cb091256e27a793f5c849f1c52b48c896ace. Independent change; no parent PR or staging ancestry included.
**Landing condition:** focused deterministic checks and CI green; fresh integration review. Publication gate resolved:525606d landed through #572 into main759ca8d. This branch merges that main and verifies signed-place intake. No deployment in scope. Integration and deterministic QA owner Codex; production/cold runtime acceptance still unproven. Hermes's bf91fa9 observation is historical evidence only.

## Constraints and review focus

- Public context, bounds and signed-selection-like fields cannot mint trusted discovery identity.
- Ambiguous, weak, invalid, contextless and country-only resolutions do not receive an aperture.
- Keep explicit coordinates fixed; only trusted reverse context can supply their discovery identity.
- Preserve provider bounds; invalid or detached provider bounds cannot silently become a fallback.
- No named-place rules; no source approval, event evidence or coverage promotion.
- No live network in tests. No cold/runtime claim from synthetic fixtures.

### Task 1: intake, geometry and queue contract

Files: server/place-candidates/spatial-scope.js; server/place-candidates/place-resolver.js; server/planner/agnostic-place-intake.js; tests/trusted-point-discovery.test.js; tests/place-resolver-dominance.test.js.
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

Review correction: independent review found malformed Nominatim bounds were discarded before intake. Actual forward/reverse provider-fixture replay reproduced the issue (RED). Preserve a private invalid-bounds marker and reject the aperture; version the forward/reverse cache keys and namespace so old entries cannot erase that state. Provider normalization, restart-cache and affected tests now PASS 174/174. Existing cache-layout assertion updated for the new namespace. Only this focused review delta was changed; no new telemetry.

Current public 525606d suggestion observation: the Uppsala settlement still has county/country/code and no spatial scope; this confirms the input shape only. No cold route, queue, coverage or speed inference from that observation. CI and unpublished-source reconciliation remain landing conditions.

## 2026-10-08 published-main integration

525606d is published on release/approved-staging-525606d and included by main759ca8d through #572. Delta bf91fa9→525606d contains Live evidence retention, refreshed frontend dist and #570 docs; it does not fix point discovery. #563–570 heads are included in main and reconciled by the release owner. Merge main into this branch, preserve context-aware query/cache identity and signed-Live rejection semantics. Geocoder cache becomes v6 (v5 was introduced by staging); reverse cache remains v2.

Signed-path correction: preserve malformed Photon extent/snapshot bounds state. Fresh v2 selection receipts carry it. Existing v1 receipts still bind the destination and serve ordinary Live, but a bounds-free v1 receipt cannot newly attest an aperture, because its old snapshot discarded malformed bounds. A fresh suggestion or forward resolver establishes that state. Provider/receipt secrets, tokens and raw logs are never committed.

RED: two signed-path guard failures, with the positive suggestion→Planner/Live→catalog mapping already passing. GREEN:218 affected checks, including3 signed-path tests, no external network. Queue SQL is intercepted for deterministic verification; this is not database-worker/provider acceptance. Final candidate review and CI are next.
