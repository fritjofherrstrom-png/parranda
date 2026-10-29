# Universal Preference Coverage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans task-by-task. Track RED/GREEN and exact commands in the delivery ledger.

**Goal:** Recover explicitly classified second-hand/area places and retain assessed preference coverage through publication.
**Architecture:** Extend the existing finite source maps and query builder. Aggregate only current admitted role assessments for the same physical ID; preserve all existing source and geometry gates.
**Tech Stack:** Node >=22, CommonJS, node:test, DuckDB, existing HTTP/browser harness.
**Spec:** `docs/superpowers/specs/2026-10-25-universal-preference-coverage.md`.

## Global Constraints

- Base `e4021a89cb43accb79d4c99e56a3b6fc2fbe8f4b`; one combined local branch, Codex owns integration.
- No merge/deploy/public cache mutation; no paid APIs or model reader.
- No new radius, result/time/memory budgets, source/trust policy, city rules or arbitrary names.
- Keep weak matches weak, unknown hours unknown and closed/inactive sources excluded under existing rules.
- Deterministic tests inject external provider boundaries only. Built browser uses real product API.

## Review Focus

- Mixed new/used shops versus generic clothing/car/electronics: only explicitly supported merchandise classes gain second-hand meaning (Task 1).
- Relations without valid center, duplicate IDs and closed candidates retain existing safety behavior (Task 1).
- Cache identity includes changed source contract, including old negative results (Task 1).
- Unsupported/alternate-only bookstore and wrong hierarchy/license never gain eligibility (Task 2).
- Unavailable/rejected secondary roles cannot grant fit; partial versus exact and same-ID dedupe remain honest (Task 3).

### Task 1: Bounded OSM source coverage (root)

Files: `server/place-candidates/open-data-loader.js`, `tests/universal-osm-coverage.test.js`, affected focused loader tests only if they assert the old query contract.
Interface: exported `buildOverpassQuery`, `mapOsmElement`, `createOpenDataLoader` remain compatible; finite structured compound selectors are source-owned.

- [ ] Write tests for clothes/books + yes/only, ordinary/false/unknown second-hand tags, car/electronics negatives, Cyrillic names; real loader through controlled fetch. Run RED before product changes.
- [ ] Test relation selectors within existing category quotas/deadline/radius, valid/invalid center, lifecycle/hours preservation, duplicate IDs and changed cache identity. Run RED.
- [ ] Implement minimal map/query/cache-contract changes. Run GREEN plus `tests/open-data-loader.test.js`, `tests/open-data-loader-api.test.js` and relevant source-cache tests.
- [ ] Commit Task 1 paths only and ledger RED/GREEN.

### Task 2: Explicit used-bookstore mapping (directory implementer)

Files: `server/place-candidates/overture-source.js`, focused new or existing taxonomy tests, `docs/OVERTURE_TAXONOMY_COMPATIBILITY.md`.
Interface: add an exact primary to the existing finite map; real SQL uses the same map. Existing cache receipts must detect changed query identity.

- [ ] Add failing real mapper and DuckDB/SQL tests using the actual current `used_bookstore` hierarchy. Check ordinary bookstore/alternate-only/name-only and invalid/license/status controls.
- [ ] Add explicit primary → existing second-hand route type/tags, preserve unknown hours/trust; update compatibility doc. Verify query/cache identity handles change.
- [ ] Run targeted taxonomy/source/renewal regressions GREEN. Root reviews and commits only these paths.

### Task 3: Preserve assessed same-ID preference coverage (engine implementer)

Files: `server/planner/agnostic-engine-compose.js`, `tests/universal-role-coverage.test.js`.
Interface: existing mapper exports/signatures stay stable; union assessed current requested exact/partial facts for an eligible same identity, with exact taking precedence only where actually assessed exact.

- [ ] RED through real role selection/composition: Green+Views plain parks, explicit panorama parks, Food+Coffee cafés; assert final covered/partial/missing and unique IDs. Negative controls include unavailable/nonadmitted secondary evidence and single-interest output.
- [ ] Fix earliest safe aggregation boundary. No type/name reclassification, trust upgrade, role-order change or output-count increase.
- [ ] GREEN focused engine/promotion/preference/manual-intent regressions. Root reviews and commits only these paths.

### Task 4: Combined verification and delivery (root)

Files: `tests/universal-preference-http-browser.test.js`, `docs/evidence/universal-preference-20261025/*`.

- [ ] Add bounded built-UI → real HTTP/handlers → actual loader/mapping/composition regression with controlled external data, date and weather. Assert source-only negative cases, exact/partial coverage and published IDs; no product API response interception.
- [ ] Verify meaningful same-anchor candidate counts/distances and explicit unknown opening hours. Reuse valid frozen audit without calling it fresh source acceptance; no provider loops.
- [ ] Run relevant regressions, full root suite once on final code, frontend checks/tests/build/dist and git diff check. Record skips and Node/OS architecture separately.
- [ ] Independent whole-diff review; fix material findings with discriminating RED→GREEN, then required affected verification. Freeze local commits, exact head/tree/base, tests and publication recommendation. No automatic release.
