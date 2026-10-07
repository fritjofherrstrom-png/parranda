# Generic place recognition

User outcome: entering a neighbourhood, suburb, settlement or named area should resolve the intended geography without a citypack. Genuine ambiguity offers a small choice; a chosen geography remains the same during Planner, Live, Blitz and rebuilding saved days. Examples are fixtures only. The user approved this direction and execution and explicitly said dated skill files must not obstruct progress.

Owner: Codex (implementation/integration and runtime QA). Target: codex/place-recognition, PR against current GitHub main 4b55cb091256e27a793f5c849f1c52b48c896ace. Open #563/#564 overlap the UI but are excluded, not parents. Delivery: reviewable candidate with focused regressions, full required checks and frozen local runtime evidence; no deployment change or automatic main merge.

## Resolution

Keep the provider query intact. Match provider-owned names/aliases and comma-separated administrative qualifiers independently; every qualifier must match provider address context. A verified district/settlement/region is preferred to a same-name station. Qualifiers never become trusted geography by themselves. Preserve venue resolution and existing explicit-coordinate precedence.

Request provider-owned namedetails and language; cache keys include language and normalized geographic bias. A previous server-issued place choice or explicitly consented coordinates can supply a soft 30 km search bias. Exactly one structurally exact match inside that circle may resolve competing distant names; a tie remains a choice. An explicitly qualified query takes precedence over proximity. Language is not country evidence. No autocomplete or additional request-time scraping.

## Choice and continuity

Server issues bounded HMAC-authenticated place_selection tokens containing only allowlisted trusted resolution facts, the original query and a seven-day expiry. A process key is persisted as one mode-0600 file under PARRANDA_CACHE_DIR when available; otherwise tokens live for this process. No public coordinates/context/confidence can mint a token. Malformed, changed-query or expired selections fail closed with a distinct blocker and may offer freshly resolved choices. A token cannot be used to switch a GPS-anchored day.

Intake returns selection_id for resolved places and ambiguous candidates. Planner adopts the resolved token and carries it through adjustments, saved inputs, language changes and Blitz. Live uses the same token for place attestation; bad tokens do not fall back to a different identity or widen geography. Saved identities distinguish selected namesakes using the selected label, not token bytes. Expired saved choices explicitly require selection again. Share links use the qualified selected label, not secret tokens.

UI presents labelled candidate buttons and distinct ambiguity/expired/unresolved messages. Optional “Use my location to narrow the search” requests consent only on tap, keeps typed destination mode, and sends coordinates solely as a hint. The existing “Use my location” day-anchor flow remains separate.

## Verification

Regression cases: qualified district versus higher-ranked station; non-Latin aliases; mismatching qualifiers; distant namesakes and close ties; proximity and explicit qualifier precedence; context/language cache isolation; token tampering/query mismatch/expiry/persistent-key restart; explicit GPS wins; Planner selection and rebuild, saved restore, language change, Live/Blitz continuity; near_me/near_route cannot use place tokens. Deterministic tests use provider-shaped fixtures with network blocked. Full npm test, frontend tests/typecheck/build/dist guard, an independent code review and bounded frozen local runtime evidence are required. Recognition success does not certify route supply.
