# Catalogue circle pruning — 22–23 October 2026

Owner: Codex. Branch: `codex/catalog-performance-20261022`.
Base: `a3e4edaabc7f3834e71451cb9a1b2fcabe76b582`.
Local performance candidate only; Hermes owns the separate integration/release.
No public cache, staging, runtime limits, source/trust policy or release changes.

## Concrete change

The Overture sample SQL already rejects points outside a planar radius. Its
private sparse reader can now omit an entire row group when the enclosing
coordinate statistics prove that every point fails that same distance filter.
The generic rectangular reader remains the default. The source opts in with
`sample-radius-v1`, validated across both parent/child boundaries. Footer
rewriting and chunk acquisition use the identical selected groups.

The existing rectangle remains a prefilter. Incomplete, invalid or unsupported
coordinate statistics cannot enable the additional circle exclusion. FLOAT
operations mirror SQL rounding step by step, with outward statistics padding;
DOUBLE arithmetic alone can wrongly exclude a point the actual SQL accepts.
Numeric min/max are enclosing bounds even when optional exactness flags are
absent, as in the saved official catalogue. No SQL, sample ordering, source
receipt, factual column, cache identity, deadline or memory allowance changes.

## Discriminating verification

- Before implementation, actual DuckDB + loopback HTTP acquired the outside
  corner group: RED. The source → real parent → real IPC child → sparse reader
  path also failed the no-corner-transfer assertion before the change.
- GREEN compares every field and the complete ordered 600-row SQL sample
  against the full unpruned Parquet. The complete source/child path also compares
  normalized records and validates the strong source receipt.
- A real FLOAT boundary is accepted by SQL at 0.999738km although ideal DOUBLE
  geometry says 1.000325km. Removing FLOAT arithmetic from the implementation
  makes this regression lose all 600 rows; the mutation is caught.
- Additional controls cover dateline ±180°, poles, exact radius boundary,
  unusable bounds/types, invalid filter before traffic, real HTTP cancellation,
  sparse allocation, renewal, fallback and native lifecycle.
- The saved official 512-group footer runs inside the existing 64MiB JS heap
  and 32MiB sparse cap. An intermediate review found an expanded-footprint
  regression; restoring the original rectangle and treating numeric bounds
  correctly resolved it. A dedicated official replay now guards this case.

## Measured transfer plans, not live latency

Same immutable October asset, same anchors, 5km radius, actual DuckDB footer
parsing and controlled zero-filled data bodies. These replay results do not
decode real venue pages or prove current provider availability.

| Fixture | GETs before → after | Bytes before → after | Reduction |
| --- | --- | --- | --- |
| London | 138 → 128 | 27,172,039 → 25,730,530 | 5.3% |
| Paris | 141 → 132 | 27,609,163 → 26,067,262 | 5.6% |

The strong asset identity is unchanged. Exact data-page SQL equivalence is
proved separately with generated Parquet and actual HTTP, not with zero bodies.
There is no measured Pi latency gain and no claim that this modest saving alone
solves 55–64s cold acquisition. No Node22/Linux/arm64 image or public trial is
part of this local step. Local runtime: Node24.15.0/macOS/arm64, DuckDB1.5.5-r4.

## Reproduce

```sh
node --require ./tests/helpers/no-live-network.js --require ./tests/helpers/file-deadline.js --test --test-timeout=600000 tests/overture-parquet-prefetch.test.js tests/bounded-overture-query.test.js tests/overture-source.test.js tests/overture-sample-cache.test.js tests/overture-renewal.test.js tests/overture-large-metadata.test.js
PARRANDA_REPLAY_SAMPLE_RADIUS=1 PARRANDA_METADATA_REPLAY_FIXTURE=tests/fixtures/overture-dense-footer-20261021 node --max-old-space-size=64 tests/helpers/overture-large-footer-replay.js
npm test -- --test-concurrency=2 --test-reporter=tap
npm run check:frontend
npm run build:frontend
node scripts/check-frontend-dist-drift.js
```

Focused result: 90 PASS, 0 FAIL, 2 explicit live-httpfs skips. Independent
read-only final-diff review: no remaining actionable findings; its native and
large-metadata rerun: 24 PASS, 0 FAIL, 0 SKIP. Exact final commit and full-suite
results belong in the delivery report; they are not inferred from these runs.

## One bounded coordinate probe: do not add a prepass

The approved one-shot probe read only coordinates for the remaining boundary
groups of the same pinned October asset: 1 strong HEAD, 66 verified If-Match/206
GETs, 2,053,369 bytes, four workers, 17.1s, no retry. Actual DuckDB decoded and
attributed 365,193 rows. Every boundary group has a point inside the unchanged
SQL circle/rectangle: London 0/16 empty; Paris 0/17 empty. Thus zero further
non-coordinate chunk bytes could be omitted by an empty-coordinate-group phase.
That phase is not implemented. This proves coordinate distribution only, not
usable venue supply, day delivery, hours or a Pi latency improvement.

## Full-suite clock defect, separate from performance

The first full run found three selected-hours assertions failing in
`product-integration-browser.test.js`. All three reproduce on an untouched
snapshot of base main with the same browser and wall clock. The fixture passes
an object clock where composition consumes a callable clock, so it falls back
to wall time; once October22 is past, selected-day hours are omitted. The test
now supplies a callable Date clock, aligned with its browser date. All original
hours, closed-place, trust, walking and 4/5/6 assertions remain and pass.
This test-only correction is a separate commit; product code is unchanged.

No parallel implementation or provider retry loop is introduced. PR634's
detached warming behavior is not integrated.
