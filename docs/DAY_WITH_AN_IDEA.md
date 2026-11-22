# A day with an idea

The day view now explains the character of the **published places**, not the interests requested. A short localized headline and named-place sequence are derived at render time from the current primary route; this adds no acquisition, ranking, routing or model call. Replaced/removed/undone/restored routes therefore have no separately persisted narrative to go stale.

## Useful visit content, not category padding

A bounded bilingual `visit_content` can add one short factual reason to visit a place. This first slice explicitly opts in three catalog places: Museu Picasso in Barcelona, Diporto and TAF in Athens. Their original publisher pages were read on 2026-11-15. These are Parranda-authored factual paraphrases with a source/date, not copied articles or a Europe-wide description feed. Other places retain the ordinary stop presentation; absence is not filled with invented praise.

The note is readable in the collapsed stop row; its source and text-review date are available when expanded. This date does **not** assert current venue opening, availability or which works are on display today.

## Ownership and publication

- Author notes explicitly in catalog provenance; `why_included`, arbitrary provider prose and caller flags never opt in.
- Hydrate after final engine/walking/event selection, using exact catalog ID, type and coordinates; exclude live-event identities. Notes do not promote trust, eligibility or ranking.
- Portable publication validates the complete note against the owning catalog place. Its dedicated source-URL policy does not enlarge website/source witnesses elsewhere.
- The accepted result already carries the bilingual note through the normal saved-day lifecycle. The client validates the bounded display object and selects the current language.
- Museu Picasso also receives the verified existing `art_museum` classification. A name containing “art museum” remains insufficient to manufacture that classification.

## Verification

Focused contracts: `tests/curated-visit-content.test.js`, `frontend/tests/planner-day-idea.test.mjs`, `frontend/tests/planner-visit-content.test.mjs`. The local app/engine/publication test uses real bundled catalog data with controlled geocoding and clock; UI tests use controlled responses. Neither is real-provider browser acceptance.

The shared module is covered by the existing Docker build/runtime `COPY shared` graph; the required image build remains an exact-head CI gate. Source-path sibling PRs #704/#705 are not included or activated by this feature.
