# PR633 release and actual public day recovery — 2026-10-22

## Exact identity

- Candidate654d979e23b05bbda15b4779f61c074bf95f04c8; previous main/publicaebafefba182dbf3cf8cc96ac24a8db29a762858.
- Normal ancestry-preserving merge/current main/public: **e504b6b26e742a6932a589886b00b69a8a32f285**.
- Merge tree equals candidate:96b8b8b66af5528df4ea2fe52d58070be959e2cd; parents previous main then candidate.
- Actual web and worker image ID: **sha256:f79fa2cd629e1406abbca849792a2ce9590ebf9467babcb688d4282c08362aa5**.
- Node22.23.4/Linux/arm64. Candidate image941b1b6... consists of verified prior image plus sole changed runtime file; no frontend/dependency changes. Actual main image has identical candidate RootFS, only build SHA/revision metadata changed.282runtime files and12dist files match. Image ID/local alias is not a registry-manifest attestation.
- PR https://github.com/fritjofherrstrom-png/parranda/pull/633 . No other PR was merged or closed.

## CI and preceding proof

- Candidate CI https://github.com/fritjofherrstrom-png/parranda/actions/runs/39801309177 SUCCESS, Node22.23.4/Linux/x64.
- Actual main CI https://github.com/fritjofherrstrom-png/parranda/actions/runs/39803766115 SUCCESS, Node22.23.3/Linux/x64.
- Each: root4913PASS/0FAIL/3SKIP, frontend926/926, typecheck/build/dist/container validation and separate PostgreSQL-worker smoke1PASS. Three opt-in skips are separately listed in CI_SUMMARY.json, never promoted to PASS.
- Local root4913PASS/0FAIL/3SKIP, Node24.15/macOSarm64; final literal range assertions separately rerun1PASS on identical product code, then included in exact-head CI. Independent read-only review approved, no blockers.
- [RED/GREEN, real native acquisition, prior-source comparison and controlled UI evidence](https://github.com/fritjofherrstrom-png/parranda/tree/654d979e23b05bbda15b4779f61c074bf95f04c8/docs/evidence/overture-metadata-memory-20261022). Do not confuse the earlier controlled resolver/weather replay with public acceptance below.

## Actual public acceptance — PASS for the stated journey

Exact user URL: https://tions-dry-tells-chef.trycloudflare.com/anywhere?place=stockholm&place_ref=n25929985&planner=open&prefs=food%2Cculture%2Cviews&lang=en

One fresh ephemeral browser; actual public HTTP/source pipeline, real time, no response interception, injected coordinates/clock, source fixture, manual cache seed/clear or retry-to-green loop. One ordinary reload after successful publication. Total42050ms within unchanged observer bounds.

- Initial request:5published and rendered stops, approximately1.4km; real walking-validation valid=true. Casa Del Cava, Nobel Prize Museum, PaneFresco, Museum Tre Kronor, Strömparterren. Coverage Food/Culture; Views remains honestly partial.
- Ordinary reload: same5IDs/names/order and1.4km, same selected intent/ref/rhythm. No claim that venues are open or walking geometry is street-network verified; preserve the payload's actual confidence/availability semantics.
- Expanded card: unknown-hours count1; collapsed count0.
- Live open, sort By time, Next7days, close/reopen: PASS without another route compose. Not exact public Keep/Replace/Remove or full fresh event-provider acceptance.
- Public health before/after exact main SHA. No JS, same-origin document/script/style or HTTP5xx errors observed. Third-party basemap tiles/WebGL/physical Safari are outside this acceptance: captured headless screenshots show markers on a blank basemap; cause not investigated and no map regression or map-render PASS is asserted.
- Source health is not universally PASS: initial source_error=null; reload retains primary timeout_or_abort while still publishing the identical directory-supported day. Event surface also honestly reports some unavailable sources. No source error was suppressed.

## Actual cache renewal

Read-only before snapshot:600records, source release2026-09-23.1, acquired2026-10-17T11:43:34Z, verified2026-10-20T17:31:11Z, expired2026-10-20T23:31:11Z. Those data were still present; not deleted by deploy.

After the ordinary public request:600records from **2026-10-21.0**, actually acquired/verified **2026-10-22T15:37:26Z**, expires21:37:26Z. Correct strong ETag/object identity; source asset714390669bytes. This is actual new-source acquisition through the deployed application, not a manually warmed cache or relabelled old data. See before/after JSON.

## What failed and what prevents this exact recurrence

A real official3MBfooter has512rowgroups/53leaves/27136metadata rows. SELECT * materialized unused metadata into JS and exhausted the existing64MiB native child's heap. The isolated child failed while web health remained200. Primary map timeout then left only ineligible fallback posts, so no route was published. Previous0643 and PR631 had identical failing native-reader files; previous immutable image reproduces the same failure offline.

Product change only overture-parquet-prefetch.js: project necessary metadata columns and relevant paths before JS materialization; tie parser work to the already bounded footer size. Preserve depth64,8MiBfooter,32MiBsparse acquisition,45squery and64MiBJS heap bounds, strong source identity, license and all eligibility/closure rules. No two-source gate, city rule, fabricated facts or old-cache freshness promotion.

Real captured footer is now in standard CI under64MiB; original code was RED/OOM, memory-only change exposed parser-work RED, both fixes GREEN. Frozen91planned ranges/8441856allocated bytes and digest match the original complete-metadata reference, preventing a count increase via silently dropped source ranges. Existing native tests assert complete ordered query equivalence and hostile transport/resource behavior. This protects the demonstrated fault; no claim of universal immunity to future upstream outages or unknown data formats.

Operationally this release was accepted only after actual public publication AND rendered stops/reload, rather than health alone. The earlier source-blocked PR631 observation was not product acceptance; failing to prioritize that earlier was a delivery gap.

## Preserved runtime and rollback

Web healthy; both web/worker running, zero restarts, reader disabled, no fatal startup signals. Same exact image/SHA. All other configuration, mounts and stable network settings preserved. DB/search/tunnel IDs/configuration and all3volume settings unchanged; normal source-cache contents renewed through the application. Automatic deploy remains disabled; no deployment settings changed.

Previous aebafef web/worker retained stopped under suffix-rollback-pr633-20261022 with exact old image/config, in addition to older retained rollback assets. Guarded rollback helper is prepared and was not invoked. No database migration, volume/container/image pruning, source-policy change or unrelated fix.

Private Docker snapshots/environment values and signed place/job capabilities are excluded. Raw terminal JSON is private; public receipt is allowlisted and sanitized. The first diagnostic preload had a quoting error before native work; it was corrected separately. The first candidate-layer build used an invalid bare-ID FROM syntax and failed before changing any runtime; a guarded existing local image tag was then used and all source/dist identities verified. These observer/build-wrapper failures are separate from the reproduced product OOM.
