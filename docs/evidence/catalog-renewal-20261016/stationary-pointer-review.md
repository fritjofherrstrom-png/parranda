# Stationary-pointer correction review addendum

Date: 2026-10-16, Europe/Stockholm.

Disposition: **no actionable finding in the narrow stationary-pointer correction.** The correction preserves explicit marker selection when layout moves another marker under a stationary pointer while retaining deliberate hover inspection of another marker.

Reviewed base HEAD: `f42f5bf94f4391681f72fb2f3e16bdfa73ee60c8`. The correction was an uncommitted working delta when reviewed. This addendum covers only `frontend/src/components/planner/RouteMap.tsx`, `frontend/tests/anywhere-contract.test.mjs`, and `tests/route-map-selection.test.js`; it supplements `INDEPENDENT_REVIEW.md` and does not repeat or expand its source/native/cache review. The integration owner owns the clean production rebuild, actual final commit SHA, published-head CI and draft PR608 update.

## Code and interaction assessment

- `mouseenter` now receives the real MouseEvent on both numbered discs and their touch targets. While a click owns the tooltip, a restored enter of the selected badge remains ignored. An enter of a different badge is ignored when its client coordinates equal the latest document mouse position. A deliberate entry with changed coordinates opens the other badge with transient hover ownership.
- The click handler records its own coordinates, so this protection does not depend on a preceding mousemove. Touch compatibility hover cannot downgrade the selected badge; a tap on a different badge still reaches its explicit click selection. The existing focus and blur handlers bypass this hover-only guard, and Escape, route replacement, click replacement and hover leave retain their existing ownership boundaries.
- The document mousemove listener uses capture and passive observation, does not cancel events or update React state, and removes the exact handler with capture enabled on unmount. Route replacement clears the tooltip anchor, so a retained last coordinate cannot suppress initial hover on the next route.
- The static contract assertions were updated to require the event argument on both surfaces; neither assertion was removed or weakened. The new browser regression moves actual DOM targets under a stationary pointer and verifies that a real leave and return to the same coordinates can still inspect the moved marker.

## Evidence inspected and independent control

Read `map-stationary-review-red.log`: the new regression fails against the prior behavior because the clicked tooltip changes from Stop A to Stop B after layout-generated enter. Read `map-stationary-final-green.log`: **7 tests, 7 PASS, 0 FAIL, 0 SKIP**. These are integration-owner executions of the mounted real RouteMap/React/MapLibre/production-CSS harness, covering expansion plus leave/scroll, transient hover, replacement click/Escape, mixed click and hover, stationary layout plus deliberate return, focus/blur, touch and new-route clearing.

The reviewer independently ran a minimal local Chrome DOM event-order control, without writing inside the repository or making network requests. After a click at `(60,60)`, moving another button beneath the stationary pointer produced `mouseenter` at `(60,60)` with previous document mouse coordinates `(60,60)` and no mousemove. Leaving to `(350,220)` and returning produced `mouseenter` at `(60,60)` while previous coordinates were `(350,220)`, followed by the document mousemove. This directly verifies the event-order premise used by the guard on the installed Chromium engine. The Playwright default browser executable was unavailable on the first launch; using the already installed Chrome succeeded, with no browser installation or dependency change.

The unchanged 110-view acceptance was not rerun. This review makes no new Safari or other-engine runtime claim. No provider acquisition, shared cache change, Pi operation, deployment, source edit, push or merge was performed.

Reviewed working-file SHA256 values:

```text
a70995a89cfbbc63784cc24d7cc65cf7a60689b435c43e430c78dced7ca9f239  frontend/src/components/planner/RouteMap.tsx
3c07d60b3d55e16afd0333ba189e2ffcd523b2c598f8a98ef68b03291ea5e996  frontend/tests/anywhere-contract.test.mjs
84a51e3a0b42e3a3142da6a4e5cfa8e46f551aa064551515736c8a81a33f5760  tests/route-map-selection.test.js
```

The integration owner should retain these hashes or review any later source delta, then report the final published SHA and its CI accurately. This disposition clears the reviewed UI correction; it does not represent merge or deployment authorization.

## Exact-commit addendum

The reviewer independently resolved final code commit **`7e3e30ff18a1d01864673a88964471bf7a6d7616`** and tree **`a331a35a1893dcd0ce106725264c40cdccceee84`** from Git. Reading each of the three reviewed files directly from this commit produced the exact SHA256 values recorded above; the disposition therefore applies to this code commit. Its remaining file delta is the rebuilt AnywherePlanner bundle and its anywhere HTML reference.

The reviewer also inspected the integration owner's `final-unified-browser.log`: the built unified-city browser controls report **4 tests, 4 PASS, 0 FAIL, 0 SKIP** for Rome, Barcelona, Athens and Stockholm. Clean build, typecheck, frontend-contract and production-dist comparison results were reported by the integration owner; this addendum does not represent independent re-execution of those checks. No tests were rerun and no repository files were modified for this addendum. Final evidence packaging and remote CI at the actual published head remain separate delivery checks.

## CI precondition investigation

Published evidence head `8fa46c6` subsequently had a failing complete CI run, `38906505287`: 4,316 total, 4,312 PASS, 1 FAIL, 3 SKIP. The reviewer inspected the retained CI log. The only failure is `tests/route-map-selection.test.js:164`, waiting 15 seconds for `window.stationaryEnter === true`. The test did not reach its Stop A versus Stop B product assertion. The other mounted interaction controls passed. This is an unresolved final-CI blocker; the earlier reviewed code disposition must not be represented as a complete passing workflow.

The reviewer used the systematic-debugging workflow to inspect the event precondition. The harness moves MapLibre-transformed DOM elements with CSS individual `translate`, then assumes the browser will automatically dispatch the new mouseenter without further native input. Its current trace does not prove the post-mutation hit geometry on the failing CI platform. The network guard only intercepts Node network connections, and the file-deadline helper only fails an overlong process; neither changes browser hit testing or mouse events.

A finite independent control outside the repository used two absolutely positioned 44px div targets inside an overflow-hidden frame, with MapLibre-like transforms and the same native launch flags. Runtime: macOS arm64, installed Chrome **155.0.8059.84**. It is a minimal DOM control, not a mounted product test or a Linux-CI reproduction.

After the native click at `(82,130)`, the control moved A away and translated B by `-90px` under the unchanged pointer. After two requestAnimationFrame callbacks:

```json
{"hit":"b","rect":{"x":60,"y":108,"width":44,"height":44},"trace":[],"previous":{"x":82,"y":130}}
```

`document.elementFromPoint(82,130)` already returned B and its rectangle was centered at that point, yet no enter or leave event had been observed. Exactly one `page.mouse.move(82,130)` then requested native input processing at the identical coordinates. It produced the following actual event trace; every event had `isTrusted === true`, and previous document mouse coordinates remained `(82,130)`:

```json
[
  {"kind":"mouseleave","target":"a","x":82,"y":130,"trusted":true},
  {"kind":"mouseenter","target":"b","x":82,"y":130,"trusted":true},
  {"kind":"mousemove","target":"b","x":82,"y":130,"trusted":true}
]
```

This demonstrates that correct transformed hit geometry and automatic boundary-event scheduling are separate harness assumptions, even on installed local Chrome. It does not establish the precise cause of the Linux timeout, whose retained failure lacks a geometry trace. A test-only correction can explicitly prove B's rectangle and hit target, request one native hit-test refresh at the identical coordinates, require the trusted enter with unchanged coordinates, retain the original Stop A preservation assertion and deliberate leave/return assertion, and demonstrate old-product RED versus corrected-product GREEN. No product logic, assertion, timeout, source policy or resource boundary needs to change for this discriminating control. The integration owner owns that test correction, focused RED/GREEN evidence, final review and exact-head CI.

## Test-only hit-test correction review

Reviewed working delta against published HEAD **`8fa46c6b9e620070e29e24e3479d9767ea7eb544`**: only `tests/route-map-selection.test.js` differs. **No actionable finding.** The test retains the original Stop A preservation, deliberate return to inspect Stop B, subsequent leave dismissal and existing timeouts. It now rounds the original clicked center to integer native mouse coordinates, proves that B's target owns that exact point with its rectangle centered there, issues one native mouse move at those unchanged coordinates, and additionally requires a trusted enter and no coordinate displacement in the trace. It does not dispatch synthetic DOM events, remove a product assertion or bypass the demonstrated regression. The trace listeners belong to the disposable test page and are removed when its context closes.

The reviewer inspected `map-hit-test-final-green.log`: **7 tests, 7 PASS, 0 FAIL, 0 SKIP**. The stationary case records the point `(138,159)`, `targetUnderPointer: true`, exact B center `(138,159)`, and native trusted enter plus move at `(138,159)`. The unchanged later leave/return assertions pass.

The reviewer also inspected `map-hit-test-old-product-red.log`, using the identical strengthened fixture against the previous f42 product behavior. Its geometry and native trace are the same, then the retained product assertion fails with actual Stop B versus expected Stop A. This confirms that the test still discriminates the actual selection regression after removing its unsupported automatic-event-scheduling assumption.

The product `RouteMap.tsx` was independently hashed both from HEAD and the restored working file; both remain `a70995a89cfbbc63784cc24d7cc65cf7a60689b435c43e430c78dced7ca9f239`. The reviewed new test SHA256 is **`6ed21a30b238ee458d78671d53f3cce7a5ac1d4876dd5c090d65678d199a6985`**. No repository edits, test reruns or provider calls were made by this review. The integration owner owns the post-restore focused run, test-only commit, updated evidence and complete CI at the actual new published head. This approval clears the test-only correction; it does not mark the previous failed CI run as passing.

Exact-commit confirmation: the reviewer independently resolved **`a7ce65bb00edd1b79696d525c1bfbc1fd45c1186`**, tree **`2e58d2e2e543c695b48286becb6dfd93f5b66169`**, and hashed the committed test directly: it matches `6ed21a30b238ee458d78671d53f3cce7a5ac1d4876dd5c090d65678d199a6985`. The commit changes only that test; comparing its `server` and `frontend` trees with `8fa46c6` produces no delta. The reviewer inspected `map-hit-test-restored-final-green.log`: **7 tests, 7 PASS, 0 FAIL, 0 SKIP**, with the same verified B geometry and trusted unchanged-coordinate trace after product restoration. The reviewed approval applies to this exact test-only commit. Its evidence-only descendant still requires complete final published-head CI.
