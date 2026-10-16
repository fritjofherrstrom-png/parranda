# Independent native prefetch review

Scope: uncommitted native delta against 337bfdc3b2b888c69e14e593e1fd3ef67443c92f, reviewed 2026-10-16. Read-only code review; no product/test edits, external provider requests, Pi work, shared-cache access, commits or deploys by this reviewer.

Files: `server/place-candidates/overture-parquet-prefetch.js`, `bounded-overture-query.js`, `overture-query-process.js`, `tests/overture-parquet-prefetch.test.js` and focused bounded-child tests.

## Findings and disposition

1. **Aggregate physical budget preflight — corrected while review was active.** Initially, per-file preflight counted actual prior allocations but not prior queued chunk allocations, allowing aggregate planned physical allocation to exceed the source cap before a post-write check. Current code reserves cumulative physical block intervals for all files, preflights footer allocation before footer writes, and checks the cumulative reservation before projected data acquisition. A new two-asset actual-Parquet regression passes. The interval-based counting also avoids an unbounded per-block loop.

2. **Metadata integer coercion — corrected while review was active.** Initial generic `Number(value)` accepted null and empty strings as zero. Current helper requires a number or a nonempty decimal-integer string, then a nonnegative safe integer (with field-specific minimum). Summed retained row count is revalidated. Real metadata values are decimal strings; all fixture controls still pass.

3. **Legacy Parquet `index_page_offset` — corrected and independently verified.** Original chunk start considered dictionary and data offsets but omitted `index_page_offset`, despite installed DuckDB metadata exposing it and DuckDB v1.5.5 `ColumnReader::FileOffset()` taking the minimum of all three. Current source includes an existing non-null legacy index offset in the range start. The implementer recorded a discriminator RED: actual range80–139 versus expected60–119. I read that RED log and independently ran the updated regression GREEN together with the actual-Parquet controls. This was a format-layout compatibility defect; no claim that currently observed London/Paris files contain this optional field.

4. **Modern ColumnIndex/OffsetIndex — evidence boundary, not a reproduced current-reader failure.** Real installed `parquet_metadata()` does not expose column_index/offset_index pointer fields, so the current conditional copy branches cannot acquire them using that table output. Pinned v1.5.5 reader source inspected here does not use those modern page-index structures; therefore I have not demonstrated a current-output defect from retaining those optional pointers. The real DuckDB-generated fixtures do not carry modern page indexes. Do not describe them as testing all optional Parquet index layouts.

Primary source for item 3: [DuckDB v1.5.5 column_reader.cpp](https://raw.githubusercontent.com/duckdb/duckdb/v1.5.5/extension/parquet/column_reader.cpp), FileOffset at source lines 141–153. Modern index metadata absence was verified directly from installed `@duckdb/node-api` 1.5.5 output, without network acquisition. Reader source was checked via official repository; no provider query was made.

## Correctness and boundary review

- Original stratified SQL, its global 600-row ranking/order, eligible taxonomy/confidence/license projection, distance calculation and final limit remain the query authority. Prefetch substitutes private local paths only.
- Both spatial axes are conservatively intersected at row-group level. Missing/nonfinite spatial statistics retain groups. Dateline splits agree with the SQL; the outward epsilon protects seven-decimal boundary rounding.
- Selected groups are retained in original order in the derived footer. Root row count is recomputed. Unknown footer fields are copied; compact parsing is bounded by footer bytes, operation count, varint length and nesting depth.
- Strong quoted non-weak ETag, exact content length, canonical asset origin/path, If-Match range acquisition, exact Content-Range/ETag/length, capped streaming body and redirect rejection are enforced. Changed object generation, whole-body fallback, wrong ranges, truncation and excess bytes fail closed and delete partial materialization.
- Concurrency is at most four range requests. No explicit retry loop. Native wall deadline remains 45 seconds, one active child per process, Node old-space 64MiB, DuckDB 128MB and one thread. Private source physical bytes reserve part of the existing 64MiB total spill boundary. Parent retains its slot until actual child exit; deadline/cancel kills the process and removes its private directory.
- Footer inspection initially has a 32MiB spill allocation; final query receives 64MiB minus source physical allocation. No public cache or provider state was mutated by these checks.

## Executed verification

Runtime: Node v24.15.0, macOS arm64, installed DuckDB 1.5.5. This is not Node22/arm64 Pi acceptance.

Command:

```sh
node --require ./tests/helpers/no-live-network.js --require ./tests/helpers/file-deadline.js --test --test-timeout=600000 tests/overture-parquet-prefetch.test.js tests/bounded-overture-query.test.js
```

Final result: **21 tests, 19 PASS, 0 FAIL, 2 SKIP**, 1.80 seconds. No remaining native correctness findings were identified within this review scope. The two separate skips require explicit live-network httpfs extension download and belong to the legacy remote child path. Native sparse equivalence tests ran with actual DuckDB and local HTTP ranges. DECIMAL/DOUBLE, dateline, unknown statistics, full ordered 600-row sample equivalence, object identity/range failures, cumulative physical budget, cancellation and real child lifetime checks passed.

Files at the final native verification snapshot:

- prefetch SHA256 790a79dfdd32b2fe401c5bd4b5c1edbe8c5d90da4598174d9e368d51a5ddce32
- bounded child parent SHA256 0efc3317b848fde03629514bf56ab5cfe650ded6ee921b5822942adc962949c9
- child process SHA256 bad845f54c68e47e1b6ea6b7ec6b511a2c472be5ca681cb4deecb8fb6afcb17a
- prefetch tests SHA256 c6cb7868328190c4a795255f55c0422788df854ea6a8516b3edea475946e5758

## Remaining evidence limits

No live cold provider acquisition or measured London/Paris runtime speedup was executed by this reviewer. Controlled correctness and physical-I/O reduction do not establish source availability, provider latency, venue opening hours or public acceptance. PR608 browser/CI blocker is outside this native review. This review is against a moving working tree, not a final commit; root must tie retained results to final content and rerun changed assertions as required.
