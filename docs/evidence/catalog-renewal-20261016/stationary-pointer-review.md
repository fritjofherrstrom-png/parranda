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
