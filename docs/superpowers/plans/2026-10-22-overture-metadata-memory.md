# Bounded Overture metadata memory repair

> **For agentic workers:** Use superpowers:executing-plans in this session. No parallel product changes.

**Goal:** Restore bounded catalogue acquisition when a real immutable Parquet footer causes the existing 64MiB Node child to exhaust its heap; preserve source evidence, query semantics and all budgets.

**Architecture:** Read and project Parquet metadata before materializing it into JS; keep enough physical metadata for unchanged range selection, footer derivation and source-license projection. Diagnose actual row/byte shape before selecting the minimal fix. No timeout or heap increase, source-policy change, cache refresh workaround or city rule.

**Tech stack:** Node22/arm64, DuckDB, existing bounded HTTP ranges and native child.

**Owner / branch:** Codex / codex/overture-metadata-memory-20261022.
**Base:** aebafefba182dbf3cf8cc96ac24a8db29a762858; current public image f6d04bea57d4e8c6b0a58b80e4dc9de5e8cb316bd41ccd0e317f73cb106d8236. PR631 remains frozen.

- [ ] Preserve exact public Stockholm request/result (capabilities private); inspect current cache read-only and compare prior release.
- [ ] Capture immutable official footer identity and data in an owned isolated diagnostic container; replay offline under unchanged heap and prove failure.
- [ ] Add discriminating regression with actual DuckDB/metadata and unchanged semantic/range checks. Observe RED before changing product code.
- [ ] Apply minimal general projection/streaming fix; GREEN regression plus native/cache/source/composition regressions. Validate correct rows and provenance rather than count alone.
- [ ] Verify controlled HTTP/UI with real components, fresh/expired source cache contracts; run full suite/CI once on final candidate, separate skips.
- [ ] Publish exact candidate and focused evidence for release; do not claim source success from health. Public acceptance must actually deliver/render a day. Rollback when a new regression is demonstrated; do not falsify old-data freshness.

Observed so far: real Stockholm request ends without day, loaded23 mostly knowledge-only records, no eligible pool, map timeout. Exact Stockholm Overture sample still exists600 rows but expired39h at observation. Isolated current-image query of release2026-10-21.0 crashes V8 at64MiB in metadata materialization. First diagnostic observer itself had a syntax error before native work; preserved separately, not a product failure. Current/previous source comparison and exact memory mechanism remain to be confirmed.
