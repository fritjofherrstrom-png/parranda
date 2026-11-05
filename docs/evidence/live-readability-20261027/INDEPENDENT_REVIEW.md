# Final whole-branch source review

Reviewer: complete_live_readability_review. Date: 2026-10-27.

Base: `df7d82a85917dff534dec71c610a461e72fa5eba`.
Candidate: `9a07f08c2254b69a985c4ad29df1da04a875e4cf` plus the nullable-distance annotation represented in `final-source-review.diff`. Reviewed that complete authoritative source/test delta, the spec/plan, implementation handoff and ledger rulings, and the surrounding callers and data contracts. The prior interrupted review supplied no verdict and is not treated as approval.

## Strengths

- Card and sheet use one title → timing → place → source hierarchy. All five timing surfaces use the same timing component; the sheet preserves its explicit empty-timing override for undated navigation rows, selected dates, and exact occurrence-selection callbacks.
- Period formatting keeps source date/clock facts and renders its session uncertainty separately. Daily hours, stated occurrence dates, unknown times and holiday dates retain distinct behavior. Programme context uses the existing date-only formatting branch without a daily, all-day, or period-session claim.
- The destination helper and exact href remain intact. Homepage classification stays visible, feed attribution has a named native disclosure, and mandatory credits and the existing geography/recurrence/holiday/programme caveats remain outside that disclosure.
- New mounted assertions cover the reported hierarchy and temporal semantics in EN/SV; browser assertions check actual reading order, natural case, credit visibility and card wrapping at 320/390/430px. Existing navigation assertions retain exact slot/action boundaries after adapting to the source disclosure.

## Issues

### Critical

None found.

### Important

1. **[P2] Restrict contact cleanup to a proven contact-only suffix.** `frontend/src/components/planner/LiveEventSummary.tsx:10–12` finds a phone/email anywhere after a separator, then discards the entire remainder with `slice(0, match.index)`. It never establishes that the remaining text contains only contacts. A source place such as `Kiviks Musteri; tel: 0414-719 00; Kiviks Stora Väg 7, Kivik` renders only `Kiviks Musteri`; `Bygdegården; info@bygdegarden.example; Stibyvägen 10, Gärsnäs` likewise loses its address. The exact current function produced both results in the one permitted tiny local read-only probe. Although canonical objects remain unchanged, both card and sheet now hide useful source location facts, exceeding the spec's permission to omit obvious contact suffixes. Conservatively retain the original when non-contact text follows a matched contact, or remove only recognized contact tokens while retaining the rest. Add focused examples for an interior phone and interior email followed by an address/entrance detail, alongside the existing genuine contact-suffix case.

### Minor

None raised.

## Verification scope

No suites, typecheck, build, browsers or external services were run by this reviewer. Existing supplied evidence is acknowledged within its stated scope: 171 focused tests and 10 Chromium checks before current-main integration; 156 focused tests afterward; nullable-distance typecheck correction, successful typecheck/build, and 10 post-build browser checks. The novel probe only evaluated the exact local cleanup function against three strings, including the existing suffix-shaped control, and made no repository changes. No inference of deployed acceptance or new-head CI success is made.

## Declined to judge

- Backend local-source discovery, source coverage/yield, model choice and model-reader activation: explicitly owned by the separate user task; no backend delta in this branch.
- Real deployed Borrby acceptance, exact-head CI and physical Safari behavior: require runtime/external evidence outside this read-only source-review assignment; remain root-owned landing checks.
- Generated dist artifact integrity: root is rebuilding/committing those artifacts independently; this review covers the authoritative source/test package and does not approve an uncommitted generated snapshot.
- Whether every feed label should be visible without expansion: the implementation handoff explicitly rules for the native source disclosure while retaining destination and mandatory notes visibly; this is an accepted presentation decision, not a defect.
- Adding live-clock repainting or broader provenance fields to route/Blitz contracts: the unchanged surrounding contracts already had these limits; no new timing-input or attribution loss was found in this delta, so expanding them is outside this fix.

## Recommendations and assessment

Fix the contact-tail truncation and verify that narrow behavior. No other material source-review issue was identified; no broader refactor is requested.

**Verdict: With fixes.** The shared presentation and timing integration align with the plan, but the cleanup must preserve address/location text after an interior contact before this source candidate is ready. Root retains ownership of new-head CI, committed dist and deployed acceptance.
