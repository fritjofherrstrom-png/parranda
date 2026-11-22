# Walking geometry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement task-by-task.

**Goal:** Render real pedestrian geometry for modern days, with honest pins-only fallback.

**Architecture:** Keep existing candidate selection. A server-owned opt-in OSRM
runtime routes the final selected chain once and the existing validator admits
its geometry and metrics. Explicit pedestrian metadata controls the map.

**Tech Stack:** Node/Express, React/MapLibre, existing deterministic node:test suites.

**Spec:** docs/superpowers/specs/2026-11-01-walking-geometry-design.md

## Global Constraints

- No city-specific behavior, paid service, merge, deploy or changes to #674.
- No live network in deterministic tests; no public payload router/config injection.
- Default heuristic runtime remains available; no invented walking geometry or ETA.
- FOSSGIS maximum one request/second per process, bounded cache and no unbounded queue.

## Review Focus

- Invalid geometry, null metrics and distant snaps must not authorize a solid line.
- Final endpoints/edits must be the same chain that is routed and published.
- Timeout, busy provider and no-route preserve a usable pins-only estimate.
- Dense old saved geometry must not be mistaken for attested foot geometry.
- Shared snapshots must retain valid new metadata without accepting arbitrary fields.

### Task 1: Router and runtime — router agent

Files: server/walking-router.js, server/walking-runtime.js, corresponding tests.
Produces `resolveDefaultWalkingRuntime(env, dependencies) -> {walkingRouter,walkingConfig}`;
router results preserve existing fields and add `mode: walking`, optional attribution.

- [x] Write and observe failing prefix/shape/foot-mode/cache/rate tests.
- [x] Implement strict adapter and bounded opt-in runtime; verify focused tests.

### Task 2: Final-chain integration — root

Files: server/app.js, server/planner/agnostic-route-output.js,
server/planner/agnostic-route-walking-validation.js, published-day-fields.js,
new tests/pedestrian-final-chain.test.js, projection tests, deployment docs/config.

- [x] Prove current modern API ignores configured final router with a failing test.
- [x] Resolve server runtime, always validate configured final chain after edits/weave,
  publish explicit mode and attribution only after successful validation.
- [x] Verify fallback, retained endpoints, invalid/budget failure and injection.
- [x] Preserve allowed mode/attribution in closed published projection; test roundtrip.
- [x] Document configuration/operation and forward opt-in environment through compose.

### Task 3: Map presentation — renderer agent

Files: RouteMap.tsx, route-map-presentation.mjs/.d.mts, relevant map tests.
Consumes `geometry_source`, `geometry_mode`, `geometry_attribution` from final route.

- [x] Write/observe failing real-short-path and dense-untrusted-path tests.
- [x] Remove bows; render exact path only for explicit osrm + walking metadata.
- [x] Keep pins/cluster/fit and required attribution; verify focused frontend tests.

### Task 4: Delivery — root and fresh reviewer

- [x] Run required suites/typecheck; rebuild tracked dist and verify drift.
- [x] Run bounded real walking-router check plus controlled mobile/desktop preview.
- [x] Obtain independent review; fix concrete issues and repeat affected checks.
- [ ] Create reviewable main-targeted draft PR, report SHA/CI/evidence and limits.

Execution follows the user's instruction to continue; established V5 behavior is
not reopened as a design questionnaire. Implementation choices above are Codex's.

Execution notes: explicit pedestrian configuration gates ordinary final routing;
generic event-only router injections retain their old lifecycle. Numeric strings
remain compatible at the legacy validator seam while null facts are rejected.
The native adapter itself requires numeric metrics. A supplemental custom-input
test was dropped after confirming those legacy fields are not the modern API
contract; existing final endpoint/order tests remain. Broad local npm test found
87 failure identities independently reproduced on untouched main (macOS sharing
storage); V5 regressions found in that run were fixed and affected suites rerun.
One concurrent map-initialization timeout did not reproduce in a single isolated
6/6 run; no timeout or product code was changed to hide it.
