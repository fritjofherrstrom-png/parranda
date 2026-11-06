# Save the accepted day, with an honest result

Fritjof wants a smarter, more useful Parranda while preserving public Linje. The next bounded return-path improvement is reliable explicit saving. Existing exact same-tab navigation already preserves an accepted answer; it does not need replacement.

## Contract and approach

The Save indicator describes the accepted version on screen, not merely its place/date/preferences query. Rebuilding that same query can produce different stops or source facts and must offer Save again. Saving the new answer replaces the older saved answer for that query, retaining the existing newest-first twelve-query list. The entry's savedAt metadata and Live-sheet sorting alone do not make it a different day; source observation timestamps remain answer facts.

Commit the saved-list UI only after localStorage accepts the write. If saving or removal throws, keep the prior list, preserve the displayed day, announce a short translated failure and allow an explicit retry. Do not delete older saved days to make space or retry automatically.

The exact-navigation display intentionally drops one-shot place receipts and execution capabilities. Dropping those fields does not change the saved answer; source observation dates, weather, facts and user choices do. Preserve this distinction across language navigation. Older entries with no persisted request remain displayable and saveable without inventing request inputs.

Alternatives considered by Codex: random durable version IDs would change the saved-list product contract and add unnecessary history; comparing only query IDs is the reproduced defect. Compare the persisted answer fields while retaining current query IDs. This is an implementation choice under the user's existing instruction to build without more design questions.

## Scope and safeguards

No layout redesign, public-partial publication relaxation, new account/service, API/source acquisition, new position consent or trusted fact is introduced. Local data remains private and cannot authorize public publication. Existing auto-LAST and same-tab navigation remain separate contracts; this fix does not claim recovery after device/browser storage is cleared.

## Ownership and landing

Codex owns implementation and fixture QA. Branch codex/accepted-day-return-20261105 starts from current main 6a55514c031e60e518d3a699f2da62d32be244be, independently of #678. #678 is ready/unmerged at aa4f90b with green exact-head CI; its release decision is deferred, it neither blocks nor supplies ancestry to this work. #677 remains closed/rejected. Deliver a reviewed main-targeted PR with affected tests, frontend build/dist and exact-head CI; no new merge/deploy mandate is inferred.
