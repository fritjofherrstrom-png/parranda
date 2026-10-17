# Independent source/cache contract review

Date: 2026-10-16 (Europe/Stockholm)

Reviewed the uncommitted source/cache delta in `codex/first-attempt-preference-integrity-20261016` against reference `337bfdc3b2b888c69e14e593e1fd3ef67443c92f`. This review is not an exact-final-head certification.

## Scope and method

Read `overture-source.js`, `overture-sample-cache.js`, `source-cache.js`, `overture-stac-assets.js`, the Overture wrapping/factory changes in `open-data-loader.js`, and focused renewal, persistence, manifest and HTTP/browser tests. Reviewed actual cache/background operation ownership and query-identity binding. Native prefetch/Parquet changes remain a separate review responsibility; those files were still being implemented during this review.

No production source files were changed by this reviewer. No providers, Pi, shared/public cache, release or deployment endpoints were invoked. Reproductions used actual source/cache components, private temporary disk directories and controlled clocks/metadata boundaries.

## Findings and verified corrections

### P2: resident expired web cache hid a worker's newer disk renewal — fixed

The first implementation of `inspect()` preferred resident memory unconditionally. With two real cache instances sharing a private disk namespace, web cached the first sample, time advanced beyond expiry, and worker wrote a newer proved sample. Worker returned its new value; web still inspected its expired resident value. Its next `get()` rejected the fresh disk value using the old entry's acceptance timestamp and unnecessarily reacquired.

The correction reads non-hydrating disk evidence when resident memory has expired and selects the newer entry. `validateCached` receives the actual candidate entry's expiry, eliminating indirect timestamp lookup. The new regression makes an unnecessary producer throw, checks web `peek()` and `get()` both see worker renewal, and passes.

### P2: proved empty coverage could not renew with the real identity verifier — fixed

The first unchanged-sample branch called `inspectOvertureAssets([])`, which correctly refuses an empty identity request. Consequently an actual source instance with freshly complete empty manifest returned `fetch_error` when renewing its previous empty receipt, despite no object needing HEAD or native acquisition. The independent offline reproduction produced a receipt on first acquisition and `fetch_error` on renewal, with zero queries.

The correction handles a freshly complete empty manifest before object verification. It preserves acquisition time only for an exact valid previous sample, advances verification time, and does not execute HEAD/native work. The regression uses the default identity verifier, verifies successful empty renewal, then verifies metadata failure still produces source failure without a receipt. It passes.

## Remaining assessment

No further actionable source/cache contract finding was identified within this bounded review after those corrections:

- A v6 envelope binds exact cache key, normalized record hash, query/normalizer hash, release and ordered strong-validator object identities. Earlier bare v5 values are not silently promoted or migrated.
- Unchanged renewal requires fresh complete official manifest selection and matching current object identities; acquisition time remains distinct from verification time. Changed release/object/query/window triggers acquisition. Failed verification neither serves expired rows nor extends cache expiry.
- Successful empty coverage is distinct from failed metadata/native acquisition.
- Source receipts remain private/non-enumerable on returned arrays, and receipt acceptance does not upgrade source trust, opening hours, identity, operating status or licensing facts.
- Cancellation still prevents late producers from persisting; same-key work is coalesced. Request selection remains separate from the cached source sample.

## Independent verification

`node --test tests/overture-renewal.test.js tests/overture-sample-cache.test.js tests/source-cache-inspection.test.js tests/overture-stac-window.test.js` passed 61 tests, zero failures/skips, during implementation (before the final empty-renewal regression was appended).

After both corrections, `node --test tests/overture-renewal.test.js tests/overture-sample-cache.test.js` passed 40 tests, zero failures/skips. This includes the final empty-renewal and shared-disk worker/web regressions.

These controlled tests do not prove fresh real-provider London/Paris latency, Node22/arm64 Pi resource behavior, a final commit's full CI, or public acceptance. The original PR608 browser/CI failure and its eventual verification remain separate. Final-head review, complete CI and native boundary verification must use the actual integrated candidate rather than inheriting this working-tree review as a complete release certificate.
