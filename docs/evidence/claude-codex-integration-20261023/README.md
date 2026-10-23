# Reviewed Claude + Codex integration — 23 October 2026

Integration/release owner: Jean Bob (Hermes). This record describes the reviewed candidate, not a completed main merge, deployment or public acceptance.

## Source identity and scope

Accepted public/main base: `a3e4edaabc7f3834e71451cb9a1b2fcabe76b582`.

Ancestry-preserved sources:
- Claude #625 `d706aea6bc2e073c5deae7bf54a15184fad8e766` — shorter, distinguishable place choices.
- Claude #632 `0a297abfc0bb7a2dd1ab1b5da386ae6889eda84f` — venue-first structured request-time Live discovery.
- Claude #636 `4afe3b9a02cec9e8fc66b064de98875c433a600c` — geographically honest map groups.
- Claude #640 `c8a4a0076112307f8acd998040c5b4817f9e89db` — injected object/function clocks in the composer.
- Codex `1604dd16fe8ec0c739abac6ab8236eabfffda5f6` — conservative source-owned radius pruning and a compatible test-only callable clock.

Parent corrections were independently approved at tree `63d6628328574bab2b4a07d9a8eac846bd9b2a0d`, committed as `510ff00231723763ca4ae390360def9cb95623a1`. The independently reviewed #640 merge is `00359a70d8e5497db8ead73719cf4e1fd943c916`, tree `5793fd2385ce97a2334fcedca0a4205f2f50339b`. The reviewed complete code merge is `f1b953a10066df4e32386d38df7feded1a0d2bcd`, tree `198f13dd7752cc6a316ab17c6e88cc359ee144d9`. This receipt and the historical test-clock comment clarification are documentation-only follow-ups.

#634 is deliberately excluded: its abandoned producer can retain the only native slot and deny a new cold anchor a day. Existing cancellation ownership is preserved. #637/#638/#639 are not included by this integration; no unreviewed loading/adjustment UI or unrelated cleanup is silently absorbed.

## Corrections and independent review

- Place choices retain the original first-five membership before ordering. Only colliding shortened presentations fall back to original full source labels; queries, signed receipts and geometry stay unchanged.
- Live never assigns host coordinates to short/different/conflicting venue names or replaces explicit invalid/zero event geometry. Missing iCal GEO is genuinely absent. Search failure stays retryable rather than becoming a one-hour verified-empty answer. Seed/host primitive validation precedes Number conversion; normalized caches are versioned (seed v2/discovery v6).
- Map nudges protect the whole 44px target within the 11px bound. Coincident/max-zoom members have finite inspection, route-change/Escape/outside cleanup and control-local double-tap isolation. One accepted nonblocking P3 remains: a rare no-zoom-increase fallback can open inspection while its aria-action still promises zoom.
- #640 accepts function or object.now clocks with Date/ISO/epoch results, retaining explicit caller fallback versus unknown-time semantics. Codex's fixture-only callable clock does not compete with that production correction.
- Catalogue pruning is enabled only by the source's `sample-radius-v1` token. Its lower bound conservatively mirrors actual FLOAT/DOUBLE SQL arithmetic. Generic rectangle reading, SQL fields/order, source identity, receipts, cache/renewal/fallback, four range workers, memory/disk caps, 75s native and 90s owning-job budgets remain unchanged.

Independent manifest-bound verdicts: backend SPEC/QUALITY PASS (83 own final invocations); map APPROVE with the P3 above (16 tests plus 7,121 pure source/dist layout checks); clock SPEC/QUALITY PASS (10 own tests); catalogue numeric SPEC/QUALITY APPROVE (27 own tests including actual DuckDB/IPC); catalogue lifecycle/evidence/compatibility: no blockers (8 own contract tests). These counts overlap other suites and must not be added as unique coverage.

## Executed evidence and limits

- Supplied Codex full-suite raw log: 4,933 tests = 4,930 PASS, 0 FAIL, 3 SKIP; exit 0. Verified from the portable archive, but executed by the producer on Node24/macOS/arm64, not our full Linux CI.
- Exact Codex source on this Pi/Linux arm64/Node22.23.4: 90 PASS, 0 FAIL, 2 explicit live-httpfs skips in six affected files. Real DuckDB and OS IPC exercise ordered 600-row equivalence, receipt identity, FLOAT boundary, budgets, cancellation and fallback against controlled external transports.
- Base/candidate London and Paris immutable-footer plans were independently reproduced byte-for-byte on Node22/Linux/arm64, including source assets, ETag, range digest and physical allocation. London: 27,172,039 -> 25,730,530 transferred bytes (5.3051%); Paris: 27,609,163 -> 26,067,262 (5.5847%). These are actual DuckDB metadata replays with controlled zero bodies, not decoded venue pages or observed real-source latency gains.
- A separate combined affected run passed 59 engine/native/source/receipt tests. Its three browser cases failed before setup because a long temporary root exceeded Chromium's Unix socket path limit. No product assertion was reached. With only the owned temporary path shortened, those three cases passed separately: second hand, fika and culture each published/rendered 4/5/6 stops for calm/balanced/full, with trust, selected-hours, closure, walking and identity assertions intact. This is not a fresh full 62-test PASS or public provider acceptance.
- Earlier unchanged map evidence: eight native cases passed; the ninth initially zoomed a pair offscreen because its fixture did not recenter. The corrected max-zoom case passed separately at zoom22. Full exact-head CI must execute the final nine-case file; it is not waived by these separate results.
- Frontend typecheck/build and 51 focused frontend tests passed on unchanged UI bytes; all twelve committed dist files were independently verified. Normal postcommit distguard passed. No new physical Safari/VoiceOver acceptance is claimed.

The supplied ZIP SHA-256 is `b92d60cb6e65eafa507bd215efc2e912efb81fc9273c1c1fe85e39e7169838c7`; its bundle head/tree/base and complete diff were verified. The prior reported 24-test review's separate raw log and the coordinate probe's actual coordinate payload are not in that package: those historical results are not claimed as independently reexecuted. No new coordinate prepass is introduced.

## Release gates

Required before calling delivery complete:
1. Full CI on the exact published integration head, normal committed-dist guard and container/database smoke checks.
2. Fresh main/head/runtime/owner guards, ancestry-preserving expected-head merge and green main CI. Do not enable permanent auto-deploy or overwrite another release owner.
3. Immutable image provenance, complete runtime source inventory, non-root HTTP/native capability and bounded actual Linux/arm64/Pi source observation, preserving protected DB/search/tunnel/config/volumes and rollback.
4. Actual public place/day/map/Live/reload journeys on the deployed main SHA, without fixtures, clock/GPS overrides, network replacement or manual serving-cache mutation.

No claim is made that this modest byte saving alone resolves the earlier long cold acquisition. Proactive renewal and a local geographic index remain separate work. Reader-disabled and existing Ticketmaster credentials must be preserved privately; no new paid API/model reader or trust policy is activated.
