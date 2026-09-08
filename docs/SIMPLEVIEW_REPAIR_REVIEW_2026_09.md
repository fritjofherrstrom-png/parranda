# Simpleview repair and source-supply review — 2026-09-08

This report describes the local repair, not a deployment or live-source
acceptance. Base: `141f96946415997dfb42d22f5a5ed908848f254b` (#494).

## Recovery and preserved behavior

The abandoned Pi worktree had 15 unmerged index entries despite having no
visible conflict markers. It and stash
`6a933a6cb31c43005eddac4df306970043d5b743` were read only. A separate local clone
reconstructed the change over current main; the stash is retained as
`refs/backup/pi-simpleview-stash`. No Pi files, index, stash, services or sources
were changed.

The merge reconciliation joined complete but independent test additions:

- `place-source-qualification.test.js`: missing upstream test terminator.
- `schema-org-place-source.test.js`: upstream warm-path assertions and its
  terminator were lost before the Simpleview block; restored both.
- `source-profile-catalog.test.js`: Simpleview setup was inserted inside the
  upstream approval call, a persisted-record object and a claim test. Separated
  each into complete upstream and Simpleview tests.
- `source-scout-worker.test.js`: missing upstream test terminator.
- `local-place-source-scout.test.js`: earlier terminator repair was already
  present and was verified, not applied a second time.
- `reviewed-place-source-profile.test.js`: no duplicate test titles were found.

AST checks of all six changed existing test files preserve every upstream
test title, with no nested or duplicate test blocks. No #494 adapter code or
tests were discarded. Its experience-card contract and an independently
captured unchanged profile-revision hash remain regression-tested.

## Correctness and security changes beyond syntax repair

The first repaired focused run was 129/130: qualification omitted the
Simpleview adapter revision/evidence/limits. The binding is now complete.
Independent review then drove these changes:

- The generic worker fetcher silently displaced DNS-pinned HTTPS. Simpleview
  now keeps its pinned default; only its explicit test transport seam can
  override it. The production worker/wrapper chain is regression-tested.
- String-based IP checks missed expanded/mapped IPv6 private destinations.
  Normalized IP range validation rejects every nonpublic answer before fetch.
- Regex parsing could borrow facts from comments, inert markup and nested
  entities. A bounded parsed DOM enforces list-card and microdata ownership.
- Malformed or conflicting optional NewMind coordinates fail agreement checks;
  broad activity labels no longer manufacture precise place categories.
- The original global revision change invalidated unchanged #494 approvals.
  New terms/budget bindings are scoped to Simpleview. Its unpublished contract
  moves from v1 to `simpleview-europe-product-detail-html-v2`.
- Fixed budgets are validated at the reviewed bridge and claimed target, not
  silently repaired after approval. New approvals containing Simpleview bind
  all selected feeds in immutable audit data. SQL claim/completion and worker
  validation reject altered endpoints, bounds, terms, budgets or adapter
  identities. The discriminator comes from the immutable approval map, not
  solely the target's mutable adapter label.

Direct dependencies added: pinned `parse5@7.3.0` (HTML parsing) and
`ipaddr.js@2.2.0` (normalized address classification). No HTML is executed.

## Operational contract

The separate `simpleview_europe_product_detail_html` adapter accepts one
query-free HTTPS list, at most 20 links, 20 details and 20 emitted items;
256 KiB list body, 64 KiB per detail, 1 MiB aggregate; 8-second requests
(including body consumption), bounded DNS lookup and 30-second total work.
Redirects are capped at three and cannot change the approved list endpoint or
canonical detail URL. Discovered details stay inside the reviewed list's
directory subtree, not necessarily beneath the list's final path component.

Only allowlisted identity, name, category, address, coordinates and factual
provenance survive collection. No raw HTML, descriptions, images or ratings
are persisted. Terms must be `open_license` or `api_terms_compatible`, with a
fresh approved healthy source. Planner cannot traverse lists or details.

## Independently checked neighboring streams

Live GitHub state on 2026-09-08:

- #494 merged as the base above; experience-card adapter remains separate.
- #495 open, mergeable, CI successful at
  `f456ecb32805de5beac82e04b052b442cd154427`.
- #496 open draft, mergeable, CI successful at
  `798f9a1fd9f57648d3ce87c696543ec3fc8c270c`.

A separate detached checkout combined these exact #495/#496 heads without
conflict (tree `90bbe4b6a133b2d130376ad8908e2521ab354951`).
`node --test tests/budget-aware-candidate-supply.test.js tests/visit-sweden-napi-source.test.js`
passed 24/24, including the failed-primary/NAPI single-live-fetch regression.
The older double-fetch report is not a remaining blocker on these heads.
No change was pushed to either neighboring branch. This focused combined test
does not replace their full combined CI or live acceptance.

## Verification and acceptance boundary

The focused eight-file source suite passed 144/144. Frontend tests passed
239/239; TypeScript, production build, committed-dist drift check and
`npm run validate:self-hosted` passed. Only Astro island UID build noise was
restored after normalized equality was checked; no frontend source changed.

`tests/simpleview-catalog-postgres.test.js` runs against real isolated
PostgreSQL with all repository migrations, revision-bound approval, worker
persistence and a separate connection/catalog read. It also tests
review-needed exclusion, old v1 rows and tampered target rejection. It uses
synthetic HTML and never an application database environment variable. Default
test runs skip it unless `PARRANDA_TEST_DATABASE_URL` is explicitly set; CI
executes it against its disposable Source Catalog database. Local execution
uses an isolated PostgreSQL container with no host ports or production mounts.

Final `npm test -- --test-reporter=tap`: 2,753 tests, 2,752 passed, zero
failures, one explicitly skipped PostgreSQL integration test (executed
separately: 1/1 passed against the final source tree). This root command also
discovers frontend tests; 239/239 above is the separate frontend command.
Final independent security/correctness review: **APPROVED**, no remaining
blocking findings; reviewer independently ran 115 focused tests. The final
adapter/source-ID and post-lease tampering regressions passed against real
PostgreSQL. These are local results; the PR's exact-head GitHub CI status must
be read separately, not inferred from this report.

Visit Plymouth and Visit Isle of Wight remain **NOT PERMITTED** under the
recorded restrictive terms, absent written permission or a separately licensed
feed. No new legal clearance is claimed. Minimal structural parser fixtures
and synthetic SQL persistence are **INVALID ACCEPTANCE** for real licensed
provider / Pi / route contribution. No such acceptance was attempted here.

Next product step: operate a permission-compatible source through the actual
persisted lifecycle for a large unsupported and a smaller/regional place, and
measure real route contribution and a review-needed negative control. A new
parser alone is not increased live supply coverage.
