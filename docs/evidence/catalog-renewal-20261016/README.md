# Generic catalog acquisition and cache renewal — PR608

Owner: Codex. Branch: `codex/first-attempt-preference-integrity-20261016`.
No merge, deploy, Pi image or public/shared-cache mutation is included.

- Main/base: `dad368233963b7766afb532339cbabc7ac2e8fb1`.
- Preserved PR checkpoint: `337bfdc3b2b888c69e14e593e1fd3ef67443c92f`.
- Source/native/cache candidate: `ec7e13b9c058ce5b184c4dafd79d87f7c75ff50b`.
- Final code candidate: `7e3e30ff18a1d01864673a88964471bf7a6d7616`.
- Final code tree: `a331a35a1893dcd0ce106725264c40cdccceee84`.
- A following evidence-only commit changes this directory, not product or tests.
  Its full published head and exact-head CI result are reported in PR608.

## Proven boundary and correction

The supplied London/Paris recovery traces show an expired exact-key v5 sample
and an absent current-anchor sample respectively. The old native 45-second hard
stop could not produce complete rows. Separate 120-second diagnostics returned
600 rows after about 77/57 seconds. Seeding those new rows restored warm days;
that did not repair cold acquisition. Setup/manifest selection was quick and
already selected one file. The old traces support slow remote I/O; they do not
prove the unavailable historic Kyoto/Copenhagen producer/cache generations.

The original globally ranked 600-row SQL, full official STAC asset selection,
normalization and fact gates now run over private, pinned sparse Parquet files.
HEAD and every range use strong ETags, exact length/range validation and
If-Match. At most four transfers fetch projected chunks of every spatially
intersecting row group. Unknown/nonfinite statistics retain the group. A bounded
derived footer preserves exactly those row groups and original metadata/order,
so correctness does not depend on DuckDB's cast/pruning order. No nearest-N,
early row cut, new source, redirect or retry loop is introduced.

Limits remain native 45s including setup/prefetch, one child, one DuckDB thread,
128MB DuckDB, 64MiB Node heap, 600 rows and 2MiB whole IPC envelope. Physical
source blocks are capped at 32MiB, combined source blocks/spill at 64MiB.
Metadata stays at 5s and planner hard deadline at 60s. Child cancellation and
actual close retain slot ownership and temporary-directory cleanup.

V6 binds records to exact anchor/query/normalizer, source release, complete
canonical assets, strong ETags/lengths, record digest and separate acquiredAt /
verifiedAt. After the normal six-hour expiry, a newly read complete manifest
and matching source-object identities can reverify unchanged input without bulk
reacquisition. Changed identity requires new collection. Failed verification
neither returns expired rows nor extends expiry. Old unidentified v5 arrays
stay untouched and cannot gain freshness. This receipt proves source-object
identity, not current venue opening hours. Future sampling/normalizer changes
must revise their versioned contract.

A shared-disk control proves expired resident web state sees the worker's newer
verified disk generation. Complete empty manifests have explicit evidence;
legacy arrays, wrong query/window, tampered records, weak identity and receipt
time inconsistencies fail closed. Canceled or older producers cannot publish
or overwrite a replacement generation.

## Browser verification blocker, separately corrected

The old PR CI Stockholm failure showed a click during map expansion followed by
layout-generated mouseout clearing the name. Explicit click ownership now
survives leave/layout while hover/focus retain their dismissal contracts.
Independent review then reproduced another-marker hover regression; the narrow
fix at f42f5bf passed the unchanged 110-view map acceptance and six interaction
controls. The subsequent built HTTP/unified run exposed a second real boundary:
a different marker moving under the stationary pointer replaced that selection.
The final correction distinguishes layout enter from actual pointer movement.

`map-stationary-review-red.log` fails against prior behavior. The final seven
native controls pass, including deliberate leave/return to the same coordinates,
click/leave/scroll, hover, Escape, focus/blur, touch and route replacement.
The unchanged built Rome/Barcelona/Athens/Stockholm tests now all pass. No map
layout policy, timeout, acceptance assertion or test was removed. The static
wiring assertion now requires the actual event argument. Dist was rebuilt cleanly
after all temporary browser harness directories had been removed.

## Real source controls and geographic scope

All six use Node24.15.0 / macOS arm64 with private fresh source state. Each does
one acquisition. Catalog release: 2026-09-23.1, 600 rows, strong object identity.
No public/shared cache is read, cleared, warmed or seeded.

| Case | Cold native/source time | Published built UI |
| --- | ---: | --- |
| London |17.7s native /18.6s total|Acquisition only|
| Paris |14.6s native /14.8s total|Acquisition only|
| Berlin central simulated GPS |16.2s|5 culture stops|
| Berlin western inner-city pin |13.8s|5 culture stops|
| Tokyo central pin |14.0s|5 culture stops|
| Tokyo Shibuya-area pin |17.6s|5 culture stops|

London/Paris exact ordered normalized records equal the supplied older diagnostic
results. Different runtime conditions mean this is equivalence evidence, not a
matched Pi performance A/B. Four further cases use the ordinary explicit GPS
action, real built UI, HTTP, lifecycle, cache and composer with real cold catalog.
Every published stop belongs to that case's source sample, the request/source
anchor matches, rendered order matches the API, and walking_validation is valid.
GPS, primary map failure, weather and clock are controlled. These are not
Photon/geocoder, Pi, real-street routing or venue admission/hours acceptance.
Screenshots and machine-readable per-case results are included.

## Verification, exact scope and skips

- Final frozen source delta: **82 total /80 PASS /0 FAIL /2 SKIP**.
- Relevant source regression run: 171 PASS before two review fixes; those fixes
  have their own RED/GREEN and independent source/cache retest.
- Frontend full suite: 690 PASS before the final narrow pointer delta.
- Final changed frontend contract: 34 PASS; typecheck and clean build PASS.
- Final mounted marker controls: 7 PASS. Final unchanged built unified UI: 4 PASS.
- Earlier unchanged 110-view acceptance plus six interaction controls: 7 PASS at
  f42f5bf. This older result is reused within its scope, not called final-head CI.
- Controlled built UI → real HTTP renewal test: PASS. Only external providers,
  resolver/weather are controlled; product API responses are not browser-mocked.
- Final committed-dist comparison and self-hosted contract: PASS.

`results.json` retains full-suite and historical failures separately. The ec7
local full-suite run was interrupted after the reproduced hover blocker and is
**ABORTED, not PASS**. Complete final verification runs in the existing Node22 /
Linux x64 PR CI on the actual published head. Its live status and link belong in
the PR, avoiding an endless documentation-commit/CI cycle.

Separate normal skips: two legacy real-child httpfs extension download tests,
and root PostgreSQL test without a disposable database. The new local Parquet /
HTTP prefetch tests do run. CI separately exercises the actual PostgreSQL lifecycle.
No browser skip is introduced. No Node22/arm64 Pi image is built in this task.

Earlier concurrent build/frontend test raced dist removal; the stable-build
frontend rerun passed. Concurrent browser/frontend load also had Rome/initial
map timeouts; later serial PASS alone does not prove their cause. The original
CI38857644357 at337bfdc remains historical RED. Final CI must clear the actual
candidate; these older observations are not silently overwritten.

## Remaining evidence limits

The historical Kyoto/Copenhagen cold/warm producer IDs and raw cache generations
are unavailable; causality from intervening Full calls stays INCONCLUSIVE.
Berlin's museum-as-Second-hand count is fixed; absent relevant Second hand supply
is a different source gap. Vasakronan/Parque Infantil historical misclassification
was not established, so no name blacklist or speculative mapping is added.
Partial match is not promoted to full coverage.

Photon and fresh primary provider availability remain INCONCLUSIVE. No new
provider loops were used. Modern optional Parquet page-index layouts are not
established; pinned DuckDB1.5.5 does not consume those indexes. Legacy index-page
offsets, decimal/double coordinates, dateline, absent stats and budget rejection
are covered. Future larger source inputs must fail honestly at resource bounds.
Public QA remains the user-designated7fb8c10; no public-version reread or change
is claimed here. No city-specific rule, widened radius, relaxed fact/trust/walking
policy, model reader, new source, unrelated feature or other-PR action is included.

## Reproduce controlled verification

```sh
npm ci
npm --prefix frontend ci
npm run check:frontend
npm run build:frontend
npm run test:frontend
node --require ./tests/helpers/no-live-network.js --test tests/overture-parquet-prefetch.test.js tests/overture-renewal.test.js tests/overture-sample-cache.test.js tests/source-cache-inspection.test.js tests/bounded-overture-query.test.js
node --require ./tests/helpers/no-live-network.js --test tests/overture-renewal-http-browser.test.js tests/unified-city-planner-browser.test.js tests/route-map-selection.test.js
npm test
node scripts/check-frontend-dist-drift.js
npm run validate:self-hosted
```

Use installed Chromium via PARRANDA_TEST_CHROMIUM locally when needed. Do not run
frontend builds concurrently with the temporary mounted map harness. No live
network opt-in is needed for deterministic tests. External real-source controls
were finite observations, not automated live-provider loops in the test suite.

Reviews: INDEPENDENT_REVIEW.md covers combined source and first hover correction;
stationary-pointer-review.md confirms final file hashes and exact code commit.
The earlier native/source reviews retain their own stated moving-tree scopes.
Next owner/action: user reviews this draft and exact-head CI, then decides
separately on landing/release. Codex remains the accountable code owner.
