# Cold place acquisition repair implementation plan

> **For agentic workers:** use superpowers:executing-plans. Codex owns implementation and release verification; independent agents perform bounded read-only audits.

**Goal:** make real cold place acquisition produce usable, provenance-bound supply inside the existing limits, then verify the ordinary browser journey.

**Architecture:** first attribute the entire bounded operation using external diagnostic hooks. Fix only demonstrated defects in acquisition or native packaging; retain source identity, cache generation, normalization, eligibility and publication gates.

**Tech stack:** Node22/arm64 production, DuckDB1.5.5, pinned Parquet ranges, built Astro/React UI and real HTTP handlers. Host Node24 is a separately reported environment.

**Spec:** user request 2026-10-17 to fix the errors; `PARRANDA_VERIFIERAD_DELRELEASE_20261017.md` is evidence, not additional authorization. Product contracts: `docs/PARRANDA_ENGINE_GOALS.md`, `docs/AGNOSTIC_ENGINE_NORTH_STAR.md`.

## Global constraints

- Base: `2c3d71fff24b477507bb0458bb2222824d125176`; branch `codex/cold-source-repair-20261017`.
- Preserve Hermes' frozen `d7fff88…` experiment and all public caches/volumes.
- No city rules, fabricated facts, new providers, paid APIs, reader activation, weakened gates, arbitrary timeout/budget increases or retry-until-green loops.
- Existing limits: native45s, metadata5s, DuckDB128MB/one thread, private temp64MiB, projected allocation32MiB, concurrency≤4.
- One owner and one active provider probe at a time; external hooks retain terminal phase/counters rather than unbounded payload logs.
- Reuse prior CI only for unchanged code. New final code needs its own focused tests/full CI and runtime proof.

## Review focus

- Source errors must never turn old/partial data into fresh successful coverage.
- Sparse-file or projection optimizations must preserve the complete original SQL result, including dateline/unknown spatial statistics.
- Timeouts/cancellation must terminate owned work and clean private files without touching shared state.
- Real browser success must include a published day, not merely HTTP200, candidate count or server health.
- Native image must execute actual SQL as the runtime user; packaging failure must stop the build.

## Tasks

- [x] Read current main, packet, runtime identity and preserve the unreleased experiment.
- [x] Capture a complete bounded native trace: network counts/bytes, last phase and terminal outcome. Reuse pinned public metadata where valid.
- [x] State the demonstrated fault and write a discriminatory RED regression through the real affected components.
- [ ] Apply the smallest generic correction; obtain GREEN plus negative identity/budget/cancellation controls. Do not apply coalescing merely because its offline tests pass.
- [x] Verify native packaging with actual SQL; reuse reviewed build guard only if still relevant and test its failure paths.
- [ ] Run affected source/cache/HTTP regressions, frontend check/build/dist, full suite and independent final diff review.
- [ ] Freeze exact SHA/image; bounded isolated runtime/browser acceptance. Publish a main-targeted PR with current CI and evidence boundaries, then complete authorized release only after actual acceptance and rollback preflight.

## Evidence

External working evidence: `/Users/fritjof/Developer/parranda-evidence/cold-source-repair-20261017`. No raw secrets or private container configuration in repository artifacts. Update this plan with concrete files/tests once the diagnostic identifies the fault.

## Findings and implementation ledger

- Complete original trace: at the 45s deadline, 196 HTTP requests had started, 192 completed and four remained active; no final SQL phase had started. The network work is a demonstrated limiting phase in this probe, not a claim that all public failures have one cause.
- Rejected: bigger merged ranges failed the existing per-request deadline. A spatial prepass retained all twelve groups, so it saved no London pages. Node22 connection reuse works. Eight parallel requests improved a fixed small transfer by only about 7%; the existing concurrency four is retained. These experiments are excluded from the product diff.
- Independent native build guard is committed in 3404434. It executes actual SQL as the final runtime user and verifies the locked platform/API versions. It does not establish why the old optional package was omitted.
- Independent bounded SQL-memory correction is committed in 8398992. Real DuckDB RED OOM becomes GREEN with the same 600-row result by narrowing source facts to licenses before the window operation. This is distinct from the observed transfer deadline.
- Current physical correction: after existing spatial group pruning, rewrite only the private Parquet footer to retain sources.list.element.license and omit the nine unused source leaves from HTTP acquisition. Keep retained physical chunks, types, null/list semantics and the complete original ordered SQL result. The original source identity and receipt remain pinned.
- Real-component RED: the old reader transferred an unused record_id chunk despite already returning the expected SQL rows. GREEN: the retained-license reader returns the identical result without that transfer. Double/decimal/dateline, null/empty list, unknown license, field-ID/unknown-field preservation and malformed/encrypted footer controls use actual DuckDB and controlled local HTTP, not live-provider evidence.
- Independent review added discriminating RED checks for flattened schema depth, row-group ordinal after pruning and first data/dictionary offset when an earlier index page exists. The minimal corrections pass. Combined projection/prefetch/memory/bounded run: 29 PASS, two existing legacy skips.
- Preliminary host full suite (before final physical projection): 4540 PASS, one map-page load timeout and three skips. The complete map file then passed 7/7 in isolation. Neither result alone settles candidate attribution. No map code or timeouts changed. The final run will report its exact runtime/concurrency and CI remains unchanged.
- The private native image overlays only the three frozen source modules on the verified Node22/arm64 baseline. It is a diagnostic image identified by module hashes, not an already accepted full-tree release image. The one 45s cold probe completed with 600 rows in 44,724ms (all136 requests complete, no failed requests, valid source-asset receipt, private temp cleaned). This is a narrow-margin native PASS, not yet a published day or a full-tree image acceptance. No public image or shared cache changed.
