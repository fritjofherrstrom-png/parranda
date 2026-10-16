# Independent combined candidate review

Date: 2026-10-16, Europe/Stockholm.

Latest decision: the narrow correction at `f42f5bf94f4391681f72fb2f3e16bdfa73ee60c8` clears the reproduced P2 finding; see the exact-head addendum below. The original `ec7e13b` failure remains recorded as history. Remote final-head CI remains a separate integration-owner requirement.

Reviewed candidate: `ec7e13b9c058ce5b184c4dafd79d87f7c75ff50b`.

Reviewed tree: `6f77c8d0691984d77363c47101396aff1d576555`.

Remote-main reference supplied by the integration owner: `dad368233963b7766afb532339cbabc7ac2e8fb1`. Previous PR608 checkpoint: `337bfdc3b2b888c69e14e593e1fd3ef67443c92f`.

## Finding on the original candidate, corrected below

### P2 — a tapped marker prevents later marker hover from revealing its name

`frontend/src/components/planner/RouteMap.tsx:419` returns from every hover open while the current anchor has interaction `click`, including when the pointer deliberately moves to a different marker. After tapping Stop 1 and moving the pointer to Stop 2, Stop 1's name stays selected. The existing native map acceptance requires every visible number to reveal its own name on hover and exercises exactly this mixed mouse/touch sequence.

An independent UI reader reproduced the failure at the reviewed commit with:

```sh
PARRANDA_MAP_PROOF=/tmp/parranda-ui-review-ec7e13b-legibility node --require ./tests/helpers/no-live-network.js --require ./tests/helpers/file-deadline.js --test --test-timeout=600000 tests/route-map-legibility.test.js
```

Result: **1 test, 0 PASS, 1 FAIL**, about 14.3 seconds. The failing assertion is `page.waitForFunction` at `tests/route-map-legibility.test.js:116:24`, timing out after 2000 ms at the next marker's hover. The harness used real RouteMap, React, MapLibre, production CSS and local Chromium; external requests were refused. The private proof directory contains the first-layout geometry result. `.github/workflows/ci.yml` installs Chromium and executes this test through `npm test`.

The selection correction must retain the demonstrated click/resize/leave behavior while resolving this existing interaction contract. The new selection-only suite is insufficient to clear this finding because it clears the click with Escape before testing hover again. No production or test files were changed by the reviewers.

## Combined source and lifecycle assessment

No additional actionable source/native/lifecycle finding was identified in this review. This does not clear the UI failure above.

- Read the complete substantive server delta from the supplied main reference, including source-snapshot readiness, lifecycle settlement and cancellation, request-scoped operator evidence, candidate-area matching, app wiring, Overture acquisition/normalization/cache, manifest renewal, parent/child IPC and sparse native acquisition. Read the changed UI and its relevant acceptance tests with a separate read-only UI reviewer.
- Reused the bounded source/cache review in `renewal-contract-review.md`, native review in `native-final-review.md`, and original PR608 review in `docs/evidence/first-attempt-preference-integrity-20261016/INDEPENDENT_REVIEW.md`. Their moving-tree scopes remain explicit; their earlier file hashes are not represented as this commit's hashes.
- Independently read the entire native implementation at this exact commit, including the later whole-IPC-message 2 MiB limit and consistent strong quoted ETag length limit of 200. Those final guards fail closed and do not change SQL, mapping, row selection or accepted source facts.
- The v6 envelope binds normalized records, exact cache key, release, source object paths/strong validators/lengths, query plus normalizer hash, acquisition time, verification time and records hash. Unidentified old arrays do not gain freshness. v5 remains in its prior namespace.
- Unchanged renewal re-reads the complete official release manifest and verifies matching current objects; changed identity requires acquisition. Failure does not expose expired rows or extend their TTL. Empty coverage requires a successfully complete manifest and has a distinct receipt path.
- Original global SQL remains authoritative. The native change replaces only its pinned source paths with private local files; spatial row-group exclusion is conservative and retained row groups preserve their original order. Existing normalization retains license, confidence, source family, operating-status and identity gates.
- Background acquisition remains sample-owned while selection is request-owned. Cancellation removes old producer ownership and late completion cannot overwrite a replacement cache entry or publish into a canceled planner lifecycle. Readiness uses the existing candidate admission, trusted local availability window, identity, exclusions and reach policy; final composition retains walking/publication authority.
- Resource limits remain a 45-second native wall deadline, one native child per process, DuckDB 128 MB/one thread, Node old-space 64 MiB, 600 rows, 2 MiB whole IPC envelope, at most four range requests, 32 MiB physical source materialization and 64 MiB combined source plus spill. These are code boundaries, not measured Pi runtime acceptance.

## Independent execution and reused evidence

In addition to the reproduced native UI failure, this reviewer ran a focused, network-denied in-memory generation control against the real `createOvertureSource`, v6 sample adapter and `createOvertureBackgroundSource`. The controlled query for generation 1 ignored cancellation; generation 2 completed first; generation 1 then completed late. Assertions passed: the old source returned `fetch_error`, the new selected record remained generation 2, and both decoded v6 cache and retained raw envelope still held generation 2. No provider or filesystem cache was touched.

The integration owner's retained `final-source-delta.log` reports **82 tests, 80 PASS, 0 FAIL, 2 legacy httpfs SKIP** for the final source working files immediately before this commit. This reviewer inspected that log and code, without repeating that broad subset. Reported frontend/type/build/dist and serial browser results are integration-owner evidence; they do not supersede the independently reproduced legibility failure. The complete root suite and remote CI are owned by the integration owner and were not completed by this reviewer.

Exact SHA256 values inspected at this commit:

```text
3cd707cb99791862ed18828912ac74969a02ac46cc3ed7eeca3e9a2e4c0d05ec  server/place-candidates/overture-parquet-prefetch.js
0696f3aa306996e80916e6917d45da7e925e1cceb56f82ebf699e8a244161f3b  server/place-candidates/bounded-overture-query.js
2f53f920132ae3c24808bbccce277a87ceb925f8be1df28365c624e1017d9815  server/place-candidates/overture-query-process.js
02061b05acafde8684e02a1a1b44690bfc5e14e94bf6681e0abe71104a83689d  tests/overture-parquet-prefetch.test.js
```

## Limits and delivery decision

**The exact candidate above is not cleared for a passing test push until the P2 map interaction failure is corrected and the affected acceptance is verified.** No source-side correctness blocker was found within this bounded review.

Reviewers made no implementation change, provider call, public/shared cache change, Pi action, deployment, image build, push or merge. Real cold catalog runs, additional cities and within-city GPS controls belong to the integration owner's separate evidence. This review does not establish venue opening hours, comprehensive city coverage, Safari behavior, Node22/arm64 Pi resource behavior or remote CI success. The optional modern Parquet page-index layouts remain the explicit format boundary described in the native review.

## Exact-head correction addendum

Reviewed corrected code commit: **`f42f5bf94f4391681f72fb2f3e16bdfa73ee60c8`**.

Reviewed corrected tree: **`978e9080dbae3ccbec6305af8f77e19ae00ea831`**.

The reviewer independently verified both values from Git. The delta from `ec7e13b` contains only `RouteMap.tsx`, the focused selection test, rebuilt AnywherePlanner JavaScript and its anywhere HTML reference. There are no server/source/native/cache changes. The four native SHA256 values above remain unchanged.

The correction scopes hover suppression to the currently clicked marker's badge index. Restored hover over that same marker cannot downgrade the persistent click; entering a different marker opens that marker's name with transient hover ownership, and its leave clears it normally. Removing the added unconditional click guard on context/candidate-dot mousemove restores the base inspection behavior. Two independent read-only readers found no further concrete concern in this narrow correction.

The new regression was first run against the old behavior: `map-hover-review-red.log` records a real Chromium failure waiting for Stop B. This distinguishes the correction from a test that only restates the implementation. The integration owner then ran the unchanged full legibility acceptance and all six selection controls serially. This reviewer inspected the actual `map-final-green.log`: **7 tests, 7 PASS, 0 FAIL, 0 SKIP**. The unchanged acceptance covers 18 days at 320/390/1280 widths, collapsed/expanded plus zoom/pan, reporting **110 passing views**. Selection controls cover click during expansion, leave/scroll, transient hover, replacement click/Escape, same-marker restored hover followed by another-marker hover, focus/blur, touch and route replacement.

Verified corrected file SHA256 values:

```text
bf3664e8de0d9afd478e2916205f0ebbf3c06a32e9bf8991038503af5c40255b  frontend/src/components/planner/RouteMap.tsx
4783b001cfc6be33b1f718099b31b1bcd75e1c441659d6f6263c112235855fb6  tests/route-map-selection.test.js
```

A build run concurrently with the temporary browser harness initially picked up harness-only Tailwind classes and changed unrelated shared CSS. The reviewer identified this artifact contamination; the integration owner rebuilt after all harness cleanup. The frozen correction now has only the expected AnywherePlanner bundle/HTML changes, with no shared CSS or landing/index-page drift. The reviewer inspected the clean build/dist evidence and ran `git diff --check` successfully. No scanner or production CSS change was introduced.

**Disposition: the reproduced P2 is corrected and verified; no remaining actionable finding was identified within this combined read-only review.** The old `ec7e13b` local full-suite attempt was interrupted after the blocker and is not PASS evidence. No second broad local suite or provider acquisition was run by this review. The integration owner owns the remaining built HTTP/unified browser result, evidence-only commit, authorized test push and complete CI at the actual final published head. An evidence-only descendant with identical code does not invalidate the inspected code delta, but its SHA and CI must still be reported accurately. This disposition is not authorization for merge, deployment, Pi work, image changes or public/shared-cache changes, and does not upgrade the runtime limits recorded above.
