# Dense catalogue renewal and bounded fallback —22Oct2026

Owner: Codex. Base main:e504b6b26e742a6932a589886b00b69a8a32f285. Branch:codex/catalog-runtime-recovery-20261022. Final SHA/CI/runtime acceptance belong in the PR/release report; no release PASS is inferred here.

## Confirmed cause

Public Paris and London produced no day with Food/Culture/Views. Both retained600-record Sept23.1 catalogue samples remain on the preserved cache volume, expired since20/21Oct; unused Docker build-cache pruning did not delete them. Current Oct21.0 acquisition of a different, dense official Parquet asset fails: a3,154,769-byte footer can exceed one10s operation; after successful metadata, hundreds of projected reads can exhaust the old45s native watchdog. This is separate from PR633's now-fixed64MiB metadata materialization fault. Stockholm acceptance did not prove Paris/London recovery.

Immutable dense asset:part-00007-a2c7689b-daa2-5233-9780-d37ccfc3ea74-c000.zstd.parquet, length725017426, ETag "e92948dbce4b18503f5633f019a52b20-11", release2026-10-21.0. Offline fixture hash and source URL are in tests/fixtures/overture-dense-footer-20261021/identity.json.

## Resulting behavior

- Bounded512KiB transfer pieces and short-gap coalescing retain every original projected byte and charge extra allocated pages to the original aggregate32MiB allowance after reserving every asset's baseline plan. Metadata errors cancel siblings promptly and preserve the initiating error.
- Four transfer workers,10s operations,64MiB JS heap,128MB DuckDB,32MiB sparse and64MiB total scratch remain. The network/native deadline deliberately changes45→75s; the owning server and built client change60→90s/30polls. No retries, reacquisition loop or status-only promise is introduced.
- Evidence for changed time budget: an isolated actual Node22/arm64 acquisition with four workers and a90s diagnostic ceiling completed600 newly fetched London records in55,473ms. It wrote only an owned diagnostic directory. The resulting receipt pins the current official release and strong asset identity. This proves the old45s cutoff was premature in that run, not a provider SLA.
- User explicitly approved fallback on source failure for at most seven days since original verifiedAt. Only identity-bound validated samples qualify. Neither receipt nor expiry is renewed; healthy new/empty answers take precedence; aborted owners cannot use fallback. Opening-hours, permanent closures, preference/geometry gates and unknown facts are unchanged. The existing source detail contains one discreet explanation.

## Rejected experiments and limits

Segmenting/coalescing with16KiB then64KiB gaps still reached45s on Pi; eight workers failed a10s operation at19.8s and were rejected. Final code uses four. A historical2MiB comparison mislabeled4MiB also showed only7% gain at eight, not a general concurrency fix. Fixed512KiB probes over wired/WiFi both transferred at approximately275–299KiB/s; no interface or deployment config was changed.

Offline footer replay uses zero controlled data pages: it proves metadata/transport planning and memory, not final venue rows. Actual generated-Parquet regressions compare full ordered SQL/provenance. Controlled latency uses650ms overhead and300KiB/s/read with a virtual clock; it is a model, not live acceptance. Built UI/real local HTTP tests use controlled providers/clocks and explicitly test fresh, unchanged, changed, failed, stale and too-old answers.

Public ParisTomorrow, LondonToday and Berlin, exact candidate/main CI and immutable image acceptance are still required at this commit. No cache is manually seeded or cleared. No physical venue's present-day opening is asserted from catalogue status. Unknown future source/network conditions cannot be guaranteed; fallback is finite and does not disguise failed renewal.

## Reproduce

node --test tests/overture-parquet-prefetch.test.js tests/overture-large-metadata.test.js tests/bounded-overture-query.test.js
node --require ./tests/helpers/no-live-network.js --test tests/overture-renewal-http-browser.test.js tests/overture-sample-cache.test.js tests/planner-cold-lifecycle.test.js frontend/tests/planner-lifecycle.test.mjs
npm test
npm run check:frontend
npm run build:frontend
node scripts/check-frontend-dist-drift.js

Local runtime:Node24.15.0/macOS/arm64. Production and image acceptance:Node22/Linux/arm64. CI uses Node22/Linux/x64; separate skips are retained.
