# Independent review — compact days and source-backed stop cards

Reviewer: `/root/compact_days_review` (independent read-only review; no product edits).
Repository: `/Users/fritjof/Developer/parranda-branches/codex-pr617-review-fixes-20261017`
Branch: `codex/compact-days-place-cards-20261021`
Base: `0643bc56202a8d1d552ea09e302a0bb0a1cd2aca`
Final reviewed candidate: `8aa85a2ce6c554a633ae9a7d8c4e132fa0774319`
Final reviewed tree: `e1cbd8106dd48f20b29a8bb94fdcf69a7200044f`
The initial review included the complete tracked working diff and untracked helper/tests. Readback first covered the complete base-to-`36a6bdb` diff, including `tests/compact-day-cards-http-browser.test.js` and committed `frontend/dist` changes; the subsequent `36a6bdb..8aa85a2` delta was reviewed separately in full. Worktree status was clean at final readback.

## Current outcome

No confirmed outstanding blocking defect found in the final combined diff. One malformed-saved-data rendering defect was reproduced, reported to the owner, fixed by the owner, and independently rechecked. Final frozen-SHA readback is complete. `git diff --check` passed for the complete base-to-HEAD diff.

## Resolved actionable finding

**Malformed saved place kind could throw during every stop render.** Initial `frontend/src/lib/stop-card-facts.mjs:119` passed `details.kind` directly to `Object.hasOwn` without requiring a string. JSON metadata `{"place_details":{"kind":{"toString":null},"address":"Source Street 1"}}` with an otherwise valid museum stop reproduced `TypeError: Cannot convert object to primitive value`. `StopLine` calls the helper before disclosure, and saved-entry restoration installs `entry.safeResponse` directly; therefore such malformed saved metadata could prevent rendering the route even when collapsed. This did not establish a live provider/public-payload injection path because server publication already normalizes the field.

The owner added object/string guards and the focused regression test `malformed saved kind cannot crash a stop or erase its valid address`. Independent rerun: 13/13 stop-card-facts tests pass. The valid address survives while the malformed kind is ignored. Owner's additional RED/GREEN evidence: `cards/review-malformed-kind-red.log` and `cards/review-malformed-kind-green.log`.

## Reviewed constraints

- Rhythm/no-limit set selection receives no internal numeric walking goal; explicit legacy `soft_target` requests retain a numeric target.
- Changed candidate selection keeps the existing admission, preference, source-trust, operational-closure and pin machinery.
- The source-detail helper uses a closed vocabulary, compatible canonical type, bounded address and control-character rejection; output does not create freeform prose or preference evidence.
- Complete source-owned visit addresses remain identity discriminators before reconciliation. An ambiguous addressless entity cannot select or bridge conflicting source branches under the pre-existing identity rules.
- Kind/type normalization is repeated at the route publication boundary; cross-type merged details do not change canonical type or fit.
- Existing real-id edit handlers and busy behavior remain; unknown-hours text moves inside disclosure, while source-closed saved facts retain the collapsed indicator.
- Maps/Website destinations retain their prior normalization and external-link handling. Provenance text is reachable through the nested native details disclosure.

## Independent verification

Local platform: macOS, Node `v24.15.0`.

1. New backend fixtures with no-live-network/file-deadline guards: `tests/day-rhythm-compactness.test.js` + `tests/place-details-contract.test.js` — **8/8 PASS**. Includes compact Relaxed geometry, 4/5/6 rhythm fixture counts, legacy 6 km request, exclusion of closed/wrong-interest/unattributed nearby supply, repeated farther Keep, source atoms through real HTTP composition, and public-payload non-injection.
2. Focused frontend card/hour fixtures plus identity/ambiguity/store-identity tests — **81/81 PASS** before the new malformed-kind regression test was added.
3. Post-fix `frontend/tests/stop-card-facts.test.mjs` — **13/13 PASS**, including the reproduced saved-kind defect.

Commands used:

```text
node --require ./tests/helpers/no-live-network.js --require ./tests/helpers/file-deadline.js --test --test-timeout=600000 tests/day-rhythm-compactness.test.js tests/place-details-contract.test.js
node --test frontend/tests/stop-card-facts.test.mjs frontend/tests/planner-line-facts.test.mjs frontend/tests/planner-stop-hours.test.mjs tests/entity-resolution.test.js tests/entity-resolution-ambiguity.test.js tests/store-identity.test.js
node --test frontend/tests/stop-card-facts.test.mjs
```

## Final frozen-SHA evidence readback

The product delta relative to the initial independent review consists of the previously verified object/string guards and the later four-line layout fix grouping Replace/Remove in one inline-flex wrapper. The new real-browser test and generated distribution were also reviewed. No reload behavior or source-policy change was added.

Reviewed owner-provided evidence, without rerunning the browser/build/full suite:

- `cards/built-ui-date-only.log`: built UI through real HTTP handlers, controlled resolver/weather/raw OSM and Overture source normalizers, actual composer. The test does not intercept product API responses or inject browser coordinates. **1/1 PASS** on Node v24.15.0/macOS arm64.
- `built-ui/receipt.json`: Relaxed has four relevant stops, 0.3 km total and 0.1 km longest leg; Full has six relevant stops and 7 km total. Keep survives ordinary reload; the browser retains the real `performance` navigation entry `reload`, and the separately recorded saved-entry helper verdict applies. Remove retains the other five identities; Undo restores the prior published route without another compose. No page errors were recorded.
- Mobile receipt: 390 px document width at a 390 px viewport; all recorded edit/link/provenance controls are at least 44 px high and wide. Independently viewed `built-ui/mobile-expanded-card.png`; the compact card fits and the source kind, address, unknown-hours fact, edit controls, Maps link and provenance disclosure are readable.
- `dist-check-final.log`: the committed distribution matches the actual build with the guard's documented island-UID normalization. Source, asset replacements, and HTML references are included in the reviewed combined diff. No duplicate build was run.

## Final layout/test delta (`36a6bdb..8aa85a2`)

Reviewed all four changed files: `StopLine.tsx`, `anywhere-contract.test.mjs`, rebuilt AnywherePlanner asset and its HTML reference. The layout change makes Replace/Remove one flex item so they wrap together; handlers, identity binding, busy semantics and existing 44 px button sizes are unchanged. The contract-test change removes exactly two source-text assertions demanding the superseded unknown-hours badge/banner. The same test and its contaminated-field assertions remain, and the approved expanded-hours behavior is covered by mounted and built-HTTP tests. No test, map code, map timeout or skip was removed or changed in this delta. Worktree was clean and delta `git diff --check` passed.

Owner-provided evidence readback:

- `cards/after-full-findings-focused.log`: **76/76 PASS** for the affected focused frontend checks.
- `built-regressions-final.log`: **12/12 PASS**, including the compact-card real-HTTP flow, existing native composition lifecycle (dominance, clear/undo/reload, remove, replace, refusal, sharing/date scope, intentional zero and restart) and map tap/hover checks at 320, 390 and 1280 px. The existing native browser test specifically asserts Replace/Remove share a mobile row.
- `dist-check-final.log`: rebuilt distribution matches the committed build under the guard's documented island-UID normalization.

The owner reported the initial full-suite run at `36a6bdb` had 4908 pass / 4 fail / 3 skip: two failures came from obsolete source-pattern assertions and separated mobile controls; one map-hover failure counted both nested and parent failures. The first two causes have concrete fixes and focused passing evidence. The map-hover failure has no demonstrated root cause or product fix; a later focused pass is only a later observation. The full-suite rerun on exact `8aa85a2` was still in progress at this review update and remains root-owned verification.

## Scope and limits

This is independent code review plus deterministic focused testing and readback of owner-provided built-browser evidence. It does not establish new-provider runtime acceptance, supply completeness, release Node 22/Linux, physical mobile/Safari behavior or live source health. No source policy was changed or recommended; no two-source gate, new provider, merge or deployment was requested by this review. The root agent owns full-suite/build/browser execution and final CI/landing decisions. The full suite on exact `8aa85a2` was still running when this delta review finished; its eventual result is not claimed here.


## Owner final verification after independent review

Recorded by the integration owner after the independent code review: the unchanged final head `8aa85a2ce6c554a633ae9a7d8c4e132fa0774319` completed the full suite with4912PASS/0FAIL/3SKIP (`full-suite-final.tap`,4915total). The reviewer did not independently repeat this full run. Typecheck, build, committed-dist and self-hosted-config checks pass. The initial unexplained map-hover failure remains documented; final full and focused map checks pass, with no map code or timeout change. No source-policy, push, merge, deploy or public-cache operation occurred.
