# Overture native metadata memory failure — 2026-10-22

Owner Codex. Branch codex/overture-metadata-memory-20261022. Base/current public aebafefba182dbf3cf8cc96ac24a8db29a762858. Previous public0643bc56202a8d1d552ea09e302a0bb0a1cd2aca. No source-policy, opening-hours, selection, timeout, heap or data/disk-byte budget changes.

## Confirmed mechanism

The user URL Stockholm/place_ref=n25929985, Food/Culture/Views/Balanced, yields no route. Actual public response has loaded23 mostly knowledge-only candidates,0 eligible pool and primary timeout; failed readiness insufficient_geocoded_candidates/incomplete_geometry. Counts/coordinates alone do not mean eligible places. Public failure summary is sanitized; signed selection/job capabilities are excluded.

The exact Stockholm Overture cache still exists600rows, release2026-09-23.1, verified2026-10-20T17:31:11Z, expired2026-10-20T23:31:11Z. At observation it is expired39h; it was not erased or refreshed by this investigation. The current source resolves release2026-10-21.0. One relevant source file has512rowgroups/53leaves/27136metadata rows; its3MB footer was captured through pinned ETag/range transport. Original SELECT * -> getRowObjectsJson exhausts existing64MiB Node heap. Old/current bounded query/process/prefetch/STAC/license-footer hashes are identical; previous immutable image also crashes with the same footer offline/network disabled. Rolling back only PR631 therefore does not remove this demonstrated acquisition fault.

## Minimal fix and RED/GREEN

Only product file: server/place-candidates/overture-parquet-prefetch.js. Project needed range metadata and relevant paths in DuckDB before materializing JS. Keep original column IDs, all sources leaves for unchanged license projection, bbox stats and all fields exposed by the pinned DuckDB version that consumers use. The512group footer also crosses the old fixed2million parser-operation ceiling; bound work linearly to the already8MiB-capped footer (max(oldfloor,2N+1)), preserving depth64, end-of-buffer checks and fail-closed validation.

RED original:64MiB child OOM. Memory-only patch exposes second RED:valid footer rejected by fixed operation ceiling. Both fixed:13native regression passes/0fail/0skip;137source/cache regression passes/0fail/2opt-in network skips. Original full-metadata planner reference used a larger diagnostic heap and operation allowance solely to freeze physical range output, not production acceptance; fixed64MiB replay retains91ranges/8441856allocated bytes and identical range digest. Final strengthened assertion1PASS.

The checked-in official footer fixture is metadata only; test supplies zero pages. It proves memory/planning/identity, not valid real data-page decoding. Existing smaller real-native fixtures assert complete ordered SQL equivalence, source-license projection, unknown bbox/dateline/index handling, unchanged32MiB allocation and hostile transport/cancellation behavior.

## Actual Pi and UI evidence

One isolated current Node22.23.4/Linux/arm64 image with only this source file overlaid fetched600real records from release2026-10-21.0 in21534ms, with correct strong source receipt and13types. No shared/public source cache write/clear, no production web/worker changes, no repeated-until-green provider loop. The first diagnostic preload had a quoting SyntaxError before acquisition; corrected observer only, recorded separately. Native original-image OOM is a distinct actual product failure.

Built UI -> actual local HTTP handlers/source selection/composer then replayed those real acquired records, actual public resolver attestation and controlled weather: rendered5stops, including restaurants/culture. No product API-response interception. Local host Node24.15/macOSarm64; this UI replay is not public/provider acceptance or a claim that venues are open. Real source acquisition above is a separate actual Pi result. No public repair is claimed until the changed release actually delivers/render a day.

Read-only independent review approved with no blockers. Full root suite and exact-head CI status are reported separately when complete. Frontend source/dist and dependency graph are unchanged.
