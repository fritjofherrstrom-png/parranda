# Nearby start order implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Break equivalent any-place loop geometry ties in favour of a nearby first stop.
**Architecture:** Private optimizer option, off by default; agnostic non-edited loop caller enables it. Existing later policies and final walking validation keep precedence.
**Tech Stack:** Existing CommonJS Node engine, node:test, real Express HTTP.
**Spec:** `docs/superpowers/specs/2026-11-06-nearby-start-order-design.md`

## Global Constraints

- No source, trust, acquisition, distance budget or UI changes.
- Exact existing geometry objective remains primary; compare first gap only on equality.
- Legacy/template and arc order stay unchanged; do not reorder manual day edits.
- Keep existing enumeration and refinement bounds.
- No merge, deploy, GPS watch or public cache changes.

## Review Focus

- Published order must reflect the correction, not merely an unused helper option.
- A shorter first gap must not buy a worse geometry objective.
- Known windows, meal periods and dayparts must remain authoritative.
- Strict edits, explicit start/end and event boundaries must not gain a bypass.
- Larger admitted sets must retain every identity within existing bounded search.

### Task 1: Correct equivalent loop ordering and verify public composition

**Files:**
- Modify: `server/route-engine.js`
- Create: `tests/nearby-start-order.test.js`
- Create: `docs/evidence/nearby-start-order-20261106/README.md`

**Interfaces:**
- Consumes: existing `optimizeStopOrder` positional arguments and its `{orderedStops, geometry}` result.
- Produces: optional final `{preferNearbyStart: true}` private option; unchanged return shape.

- [ ] Write a generic near-start geometry-tie regression and a real HTTP test showing the published first stop. Add controls for disabled/default option, arcs, stronger geometry, strict edit, source windows/dayparts and bounded larger sets.
- [ ] Run the new file against unchanged code; expect the enabled-option/published-order regression to fail while controls pass. Keep the observed output.
- [ ] Add one shared geometry comparison and activate it only at the scoped agnostic caller; use it in exhaustive and bounded refinement comparisons.
- [ ] Run `node --require ./tests/helpers/no-live-network.js --test tests/nearby-start-order.test.js tests/stop-order-bound.test.js tests/agnostic-compose-daypart-ordering.test.js tests/source-window-ordering.test.js tests/time-aware-meal-ordering.test.js`; expect all pass.
- [ ] Record controlled HTTP evidence and limitations; run frontend dist guard because tracked build inputs are unchanged. Commit the coherent candidate.
- [ ] Obtain one independent whole-branch review, fix Important findings through RED→GREEN if any, then publish draft and obtain full candidate CI.
