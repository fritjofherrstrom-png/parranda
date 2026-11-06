# Verified venue mentions implementation plan

> Execution scope: Fritjof authorized implementation with “ok go” (1568199026170400821). Jean Bob owns this independent main-based branch and its integration/QA. No ranking change, crawler, paid API or takeover of adjacent feature work.

**Goal:** Show real, physically bound article references in the ordinary stop disclosure and preserve them through saved/published days.

**Architecture:** A small immutable server-reviewed reference corpus and an independent exact public-article destination policy produce relations after existing place identity resolution and eligibility, in `candidateProvenance`. The producer ignores caller-provided mention/trust claims and matches independently reviewed physical identity. It therefore avoids transferring endorsement metadata through ambiguous merges or changing evidence scores. An explicit copy in `toSourceCandidate` carries the resulting relation to the route engine. The closed public projector validates both destination authority and the complete relation against the independent corpus and actual final stop. The UI only validates bounded display shape/binding; it does not invent server authority.

**Stack:** Existing Node/CommonJS, JSON source data, React/TypeScript, bounded public projection and saved-day JSON, node:test and existing mounted Planner harness. No new dependency.

## Task 1 — Correct the verified example's source data, RED→GREEN

- Test: `tests/venue-mentions-source.test.js`.
- Modify: only the Roscioli coordinate atoms in `server/catalog.js` if the discriminating test proves the current mismatch.
- Test the actual catalog producer against source-owned Eater coordinates (41.894501, 12.473962), not a wider tolerance or renamed fixture. Preserve initial assertion failure, then change only those two atoms and rerun.
- Evidence: owned `REAL-SOURCE-IDENTITY-safe.json`, actual previously acquired primary body and JSON pointer. This is an explicit factual content correction, not an engine/ranking policy change. No other venue data edits.

## Task 2 — Reviewed article producer, RED→GREEN

- Test: `tests/venue-mentions.test.js`, through actual `candidateProvenance`.
- Create: `server/place-candidates/reviewed-venue-mentions.json`, `server/place-candidates/venue-mentions.js`, `server/place-candidates/venue-mention-policy.js`.
- Modify: `server/candidates/candidate-pool.js`, `candidateProvenance` only.
- First RED asserts actual corrected Roscioli candidate emits the two independently verified article references in provenance.
- Registry records retain a stable venue identity, source-attested name aliases/address/point, article URL/title, publication/update facts separately, review timestamp, source hash/locator, relation `listed`, and explicit unknown independence/sponsorship.
- The reference corpus is internal reviewed producer configuration, not a public payload or generalized source scraper. Exact destinations are independently approved by policy, not collected from a candidate or final result.
- Match the reviewed physical place conservatively; explicit address conflicts, another branch, unrecognized/structural venue, or ambiguity yields no relation. Public `venue_mentions`, labels/flags like `human_verified`, and arbitrary article URLs do not become evidence. No articles means the optional field is omitted.
- Add only the needed bounded, source-identity and mutation/forgery controls; already-passing negative controls are preservation evidence, not claimed new RED.

## Task 3 — Engine and public/saved transport, RED→GREEN

- Modify `server/planner/agnostic-engine-compose.js` only at provenance construction: retain/revalidate the source-owned relations against the actual mapped label/point.
- Modify `server/planner/published-day-fields.js`: add a bounded VenueMention form under Provenance and validate it against the reviewed corpus and actual Stop, not URL syntax alone.
- Modify `server/planner/published-day-publication.js`: union only independently reviewed public article destinations with existing source witnesses during trusted retention, before clone. Never derive allowlists from the final stop's own claims.
- Tests: focused extensions/new tests at actual source→role→engine/public projection, real publication/store JSON roundtrip→GET→client parser. A permitted URL must not legalize a wrong venue, title, relation, extra article or publication date. Forged fields from public input cannot populate registry authority.
- The generic existing snapshot JSON store requires no DB migration. Do not widen old alternative route builders unless actually required by the current user journey.

## Task 4 — Quiet stop-detail presentation, RED→GREEN

- Create `frontend/src/components/planner/VenueMentions.tsx` and bounded display helper/declarations as necessary.
- Minimal additive insertion in existing `StopLine.tsx`; no AnywherePlanner, Live recovery or stop redesign changes.
- Existing colors/type tokens and a compact “Nämnd i” / “Mentioned in” disclosure, linked publication/title, known source date, clear sponsorship uncertainty. No logo wall, rating/recommendation count or external fetch on opening.
- Mounted tests use the real Planner harness and saved-entry helpers: source response→open→save→unmount→restore retains exact relation; changed/no relation and wrong physical binding do not leave a stale badge. Test sv/en, long title/mobile bounds, safe links, independent website/source-information actions and existing edit controls.
- Client display normalization is not source certification. The server public projector remains authoritative.

## Task 5 — Review, CI, native acceptance and delivery

- Execute focused offline regressions and frontend typecheck/test/build. Perform complete required acceptance once via exact-head CI instead of repeated Pi-wide suites.
- Freeze a manifest/tree, obtain independent full-delta SPEC+QUALITY review, and address concrete regressions only. Re-read main and the adjacent exact heads before merge/integration.
- Build/package the actual frontend dist and actual image; verify runtime bytes/modes/configuration before ordinary native user-flow acceptance. No browser response/storage/clock injection for native evidence.
- Show a real reference on an ordinary selected stop, follow the outbound article, and retain screenshots at readable size. Keep fixture/mounted evidence separate from native/public observation.
- Follow actual merge/release authorization, current CI, destination/ownership and rollback gates; do not silently absorb PR684/685/686 or Claude changes. Separate implemented, merged, deployed and observed behavior in the final receipt.

## Public relation shape (new design)

`provenance.venue_mentions[]`: stable `venue_id`; immutable source article identity; `publisher`, `publisher_id`, optional known publisher group; `article_url`, `article_title`; `relation_kind`; nullable known `published_on`/`updated_on`; `verified_at`; a source hash/reference; physical binding to the actual published label/coordinates; `independence` and `sponsorship` with explicit `unknown` values. Bound cardinality and every string. Deduplicate article identity separately from publisher identity. No claim of independent recommendation count.

Detailed source and authority inventory: owned `SEAM-AUDIT.md`. Adjacent PR heads/paths: owned `OWNERS-safe.json`. Source reference metadata is narrow reviewed content; it must not make source acquisition or the planning engine depend on a named city.
