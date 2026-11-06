# Add a place — candidate verification

Owner: Codex. Branch: `codex/add-place-search-20261106`. Base/main observed:
`f3f429e4c5c3b7832ae27956ab85f988346fb47e` (6 November 2026).
Landing condition: independent branch review, affected checks and Linux CI;
merge/deployment are separate actions. No provider/model activation is included.

The user approved a place-name or intent search beside the existing day. This
candidate preserves factual cuisine through OSM/Overture and entity resolution,
searches at most six admitted local results after explicit submit, and previews
an exact addition or a chosen unpinned meal replacement. It retains the rest of
the published chain and applies normal walking/publication checks. Confirmation
adopts the preview without composing again. Undo restores the prior answer and
its immutable sharing reference. Missing source hours remain unknown.

## Evidence scope

- Deterministic source-facet tests: 117 passed in Task 1's affected source set.
- Search/intake/admission tests: 62 passed; English `Indian food` also covered.
- Exact edit/retention/publication/privacy/pin/Live tests: 92 passed.
- UI edit/commitment/navigation/lifecycle set: 110 passed, including accept,
  cancellation, midnight, choice/date/place changes, late Live and exact Undo.
- A winding retained-order regression was reproduced and fixed: exact edits
  preserve the existing order before the final walking validation.
- TypeScript passes. Built desktop/mobile preview inspected at 1280×900 and
  390×844; no horizontal overflow. Existing Linje tokens and focus behavior
  remain authoritative. The explicit search form is the only new submit.
- Built Chrome fixture passes search, source closure refusal, exact add outside
  ordinary interests without filler, confirmation without reacquisition,
  Save/Undo/restore/reload, and public read from an empty profile.

The browser fixture uses the real OSM mapper and its native source URL witnesses,
real HTTP, composition and publication projection; resolver/weather/Overpass
responses and immutable storage are controlled. It does not assert Linux file
storage, real provider coverage, deployed runtime or physical Safari acceptance.

The whole local suites, baseline comparison and final review are recorded below
when completed. macOS cannot establish Linux's descriptor-relative file-store
acceptance. A failing local baseline is distinguished from feature regressions.

## Delivery status

Prepared candidate; no merge or deployment. Current CI and final candidate/QA
head are reported in the PR/handoff after the checks finish. Next owner is Codex
for remaining verification/review; integration remains gated on that evidence.
