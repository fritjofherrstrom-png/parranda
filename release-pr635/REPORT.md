# PR635 — runtime recovery, 22 October 2026

Status: deployed and accepted for public day/render/reload recovery in the three observed cities. Cold-start speed is not solved as a product performance target.

Main: `a3e4edaabc7f3834e71451cb9a1b2fcabe76b582`  
Candidate: `bf016f310522aaa0751cf77d840466859180f122`  
Tree, identical after normal ancestry-preserving merge: `bd20eef1724b546841f97db403268d5ac69358e0`  
Base / rollback release: `e504b6b26e742a6932a589886b00b69a8a32f285`  
Main image: `sha256:3ac1fc011326d4c96843b3f278bbad18001c41971bf61743e8371ceb80fed753`  
Runtime: Node 22.23.4 / Linux / arm64. Exact 282-file canonical proof includes all 12 built frontend files. Metadata-only candidate/main promotion preserves the product RootFS; actual main SHA is in image environment and revision label.

## Cause and correction

Paris/London had retained, identity-bound catalogue samples whose normal six-hour freshness had expired. The newer official dense Parquet file needed hundreds of projected reads and exceeded the old 45-second watchdog. Segmented metadata and bounded coalescing reduce round trips without dropping logical ranges. Actual Pi acquisition completed 600 fresh London records in 55.5 seconds and Paris records in 63.6 seconds, supporting a 75-second acquisition limit and 90-second owning job/client. Four workers and memory/scratch/operation caps remain; no city rules or repeated provider retry loop.

Approved failure fallback is limited to seven days from original verifiedAt. A fallback cannot renew that verification or the TTL and is not opening-hours evidence. Fresh successful or empty results win; corrupt, mismatched, too-old and abandoned-owner cases cannot use fallback. Therefore fallback alone would not be a permanent repair; actual source renewal is part of this candidate.

Docker cleanup removed unused build cache only. The Paris/London samples were still present. The prior Stockholm-only public acceptance did not establish dense-city recovery; that verification was too narrow.

## Verification available before deploy

[Exact candidate CI](https://github.com/fritjofherrstrom-png/parranda/actions/runs/39826643814): 4923 PASS, 0 FAIL, 0 cancelled, 3 skips out of 4926. Separate frontend step: 927 PASS, 0 FAIL. Typecheck, build, dist, production contract, container build and separate SQL migration smoke passed. Root includes frontend; do not add these counts.

The skips are two opt-in native httpfs-download tests and one opt-in disposable-database Simpleview integration test. Separate SQL smoke does not convert the latter to PASS. Actual Node22/arm64 acquisitions separately exercised native source acquisition, without asserting the two skipped tests ran.

An earlier local unrestricted-concurrency run had the obsolete 60-second assertion plus Live/Undo and map browser failures under load. The assertion was corrected in a test-only follow-up; isolated browser checks passed. Exact final candidate CI is wholly green. The final local concurrency-two full run subsequently passed all4923tests, with3skips. Test deadlines were not increased to mask browser failures.

## Actual release and public acceptance

Normal merge PR635 preserved ancestry. [Main CI](https://github.com/fritjofherrstrom-png/parranda/actions/runs/39828752687), attempt2, completed success on exact main SHA:4923PASS/0FAIL/3SKIP, frontend927PASS, typecheck/build/dist/container/SQL smoke PASS. Attempt1 had one Live immediate-count failure; LIVE_CI_DIAGNOSTIC.md retains its exact scope and uncertainty. There was no head change or test weakening for the rerun. The final local whole suite at --test-concurrency=2 also completed4923PASS/0FAIL/3SKIP on bf016f3. It was not an isolated-only absolution.

Web and source-worker now run the same immutable main image. Public health200 reads back exact main SHA. Both reader settings are disabled. Startup checks found zero restarts, OOM/error state or fatal startup log signals. Database/search/tunnel container identities, mount/configuration and three volume configurations remain unchanged; automatic deployment remains disabled. Stopped rollback web/worker containers and previous immutable image e504b6b are retained. No public cache was manually seeded or cleared.

| Public browser journey | Date | Published stops / reload | Live sort/week/reopen | Cache evidence |
|---|---|---|---|---|
| Paris |23Oct2026|5 /5|PASS|First response used approved September fallback; during the journey exact-anchor sample was actually reacquired as600 October records.|
| London, ordinary Greater London disambiguation button |22Oct2026|5 /5|PASS|Exact-anchor September sample was actually reacquired as600 October records.|
| Berlin |22Oct2026|5 /5|PASS|Already-current October sample unchanged; warm proof only.|

All observed routes passed walking_validation, rendered API stop names in order, avoided collapsed unknown-hours duplication and completed ordinary reload. No page JavaScript or same-origin asset errors were observed. The journey durations (including initial entry, reload, card expansion and Live browsing) were133.8s Paris,70.6s London and32.0s Berlin. These are not isolated acquisition timings and are not acceptable evidence of a fast cold-start experience. Initial London harness attempt stopped at legitimate place disambiguation; the corrected harness performed the ordinary visible Greater London choice, without injected coordinates/API responses. The original omission is preserved as a harness observation, not reported as a source regression.

## What actually changed in source cost

The earlier shorthand “larger source file” was inaccurate. Whole September file728373349bytes; October725017426bytes. The footer grew1584257→3154769bytes and row groups256→512. For the same anchor,5km window and current production planner over saved immutable metadata:

| City | September planned range GETs /bytes | October planned range GETs /bytes |
|---|---|---|
| London |75 /18274632|138 /27172039|
| Paris |57 /13982319|141 /27609163|

This is a matched offline physical-plan comparison using actual metadata and controlled zero data bodies, not a matched live network timing A/B. The same logical catalogue fields are requested; git diff503bd23..bf016f3 for overture-source.js adds only derived place_details from the already retrieved category, not new query columns, descriptions or opening-hours fetching.

Before coalescing, the geographic groups hit12→31 in London and9→34 in Paris; their source rows244774→345945 and178473→343303. Only600 final records are returned, but the current physical reader must fetch much more source data to perform that exact globally ranked selection. This explains why source layout matters even though the overall object is slightly smaller. It does not establish that every latency difference is due solely to layout; networking and runtime differ.

Historical17Oct Pi source acquisition already took44.724s under45s, transferring17488956bytes in136requests. The earlier14–19s measurements were Mac measurements, not matched Pi performance. That margin was too narrow and should have been flagged before calling broad cold acquisition robust. Prior Stockholm-only public acceptance was also too narrow. Build-cache cleanup did not remove the retained source data.

## Remaining limits and next bounded performance work

The higher75s/90s ceilings make room for measured source work, but are not a permanent speed solution. Existing transfer optimization reduces the October London plan from341 separate required data ranges to a smaller bounded coalesced plan; coalescing deliberately reads small gaps to trade some extra bytes for fewer round trips. It does not fetch extra product facts. The7day fallback protects availability on verified refresh failure and never renews original verifiedAt or TTL.

Recommended next work: measure and reduce request-path work, prepare validated replacement generations while current cache is still valid, and evaluate a geographically indexed local read format against exact existing ordered results. Do not silently introduce generic stale-while-revalidate, extend the7day policy, pin old source releases as “fresh”, drop factual gates or increase deadlines again. Reuse the historical rejected eight-worker/large-body/spatial-prepass evidence; do not repeat experiments without a newly discriminating reason. New source releases need format/byte/request-count and actual Pi latency canaries before broad activation. This is a proposed performance follow-up, not an implemented scheduler or a guarantee against external outages.

Unknown venue hours remain unknown. Catalogue acquisition and route rendering do not verify that every business is currently operating. Existing primary map-source failures remain visible in source status even where the catalogue supports a day. Public observations cover their actual resolved anchors/dates, not every district or future provider condition.
