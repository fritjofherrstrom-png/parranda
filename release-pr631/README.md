# PR631 — merged and deployed, 2026-10-22 Europe/Stockholm

## Exact release

- PR: https://github.com/fritjofherrstrom-png/parranda/pull/631
- Candidate: `a1441a0c73d556959e02fa7bcd0db5c6fc69371a`
- Previous main/public: `0643bc56202a8d1d552ea09e302a0bb0a1cd2aca`
- Normal merge / current main / public health: `aebafefba182dbf3cf8cc96ac24a8db29a762858`
- Merge parents: previous main, then candidate. Tree matches candidate exactly: `67b01048ad1a33229cd75982fe46c21da831ed21`.
- Both web and source-worker use local immutable image ID `sha256:f6d04bea57d4e8c6b0a58b80e4dc9de5e8cb316bd41ccd0e317f73cb106d8236`.
- Actual runtime: Node22.23.4/Linux/arm64. Metadata-only promotion of the already verified candidate image; identical RootFS, source/dependencies and dist; build SHA/revision updated for actual main. 282 source/runtime files and 12 dist files checked. No registry-publish/registry-manifest attestation is claimed by the local image identity.
- Public target: https://tions-dry-tells-chef.trycloudflare.com/?lang=en ; existing Pi QA port18518. No other PR was merged or closed.

## What changed

Relaxed complete-set selection no longer uses an internal 6km fallback as a distance goal for modern no-limit requests. It can select an equally relevant compact route; explicit walking limits and all eligibility gates remain. This is not a promise of a shorter route for every supply/anchor.

Cards are compact, keep edit actions together, and show unknown hours only after expansion. Existing source facts can provide a narrow category and branch address without invented descriptions. Old normalized caches/saved days may lack these optional fields. No public cache refresh was forced.

There is no blanket two-source admission gate. This release does not correct the reported Flat Service/HAVEX classification, Chinese London name or establish whether Holešovice shops are operating.

## CI and controlled Pi verification

- Candidate CI https://github.com/fritjofherrstrom-png/parranda/actions/runs/39652985817 : SUCCESS.
- Actual main CI https://github.com/fritjofherrstrom-png/parranda/actions/runs/39665014935 : SUCCESS.
- Main root4912PASS/0FAIL/3SKIP (4915total), frontend926PASS/0FAIL/0SKIP; typecheck/build/dist/container and separate PostgreSQL-worker SQLsmoke1PASS.
- Main CI runtime Node22.23.3/Linux/x64. The three skips are listed separately in CI_SUMMARY.json: two opt-in live httpfs extension-download tests and one disposable-DB integration. Separate SQL smoke passing does not turn the skipped integration into a PASS.
- Accepted controlled Pi proof: ../pi-runtime-a1441a0 . Built UI -> actual Pi HTTP handlers/normalizers/composer, with controlled raw sources/resolver/weather/clock. Relaxed4/.3km versus Full6/7km; compact cards and mobile fit/44px targets; Keep across recomposition/reload; Remove6->5, Undo without compose. This is not fresh-provider/venue-opening/physical-Safari acceptance.

## Actual public observation — INCONCLUSIVE, no published route

A single bounded fresh-browser London journey used ordinary free text and explicit Greater London disambiguation. No API interception, injected GPS/clock/source, source/cache intervention or manual provider retry.

- Exact public SHA before/after: PASS. No JavaScript, asset, HTTP500 or API-contract errors observed.
- Viewer clock Europe/Stockholm was already 2026-10-22; London local date was 2026-10-21. The product requests used viewer-local today2026-10-22 and tomorrow2026-10-23. No clock manipulation.
- Today's balanced request completed after ~40s with source_error=`timeout_or_abort`, insufficient_geocoded_candidates/incomplete_geometry, zero published stops.
- Tomorrow/Culture/Relaxed then completed with source_error=`provider_timed_out` and the same blockers, zero published stops. Total observer~59s, within unchanged bounds.
- **No day was delivered in this public run. Public Relaxed-vs-Full, expanded stop cards, ordinary route reload and Live-navigation acceptance remain INCONCLUSIVE/not reached.** No success is inferred from health, candidate counts, controlled evidence or HTTP200/202.
- No repeated provider attempts were made. This is an observed source-bound failure, not proof of freshness or a newly introduced source regression. No pre/post source baseline was captured to establish causality.
- The technical release is retained because startup/configuration and controlled runtime pass, with no demonstrated new regression; the public product journey is not marked accepted. Public receipt and screenshots are in public-smoke/.

## Safety and rollback

Web healthy; web/worker running with zero restarts, no fatal startup signals, and reader explicitly disabled. Both use the same verified image and actual main SHA. Configuration, network settings and mounts are preserved; DB/search/tunnel identities/configuration and all three volume settings unchanged. Automatic deployment remains disabled; no deployment settings changed.

Previous web and worker are stopped, retained under names ending `-rollback-pr631-20261021`, with old image `sha256:31397e3a76e7e7a9a2efedbb3e05744176adce6f58b591281b675830614b884d` and exact old configuration. Rollback helper restores only those guarded original IDs and checks old SHA/health. It was not needed or invoked. No containers/images/volumes were pruned during activation.

This public evidence excludes private Docker snapshots, environment values, credentials and signed place/job capabilities. Older evidence snapshots remain immutable and retain their original scope.
