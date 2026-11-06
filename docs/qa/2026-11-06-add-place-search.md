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

The full frontend run at the pre-review UI head ran 1,075 tests: 1,055 passed
and 20 failed. The same 20 named failures reproduce on unchanged main f3f429e4.
The complete root run ran 5,812 tests: 5,716 passed, 92 failed and four skipped.
Of its failures, 87 reproduce on unchanged main (20 frontend and 67 root storage/
publication cases). Three UI contract findings were corrected; transient uncommitted
bundle-name failures disappeared after the generated assets were committed, and
all seven autocomplete browser cases pass in isolation. The final Linux CI is
the authoritative whole-runtime gate; no green macOS full-suite claim is made.

The independent read-only review found four Important issues: rhythm after Add,
releasing its pin, subtracting the wrong visible source frame, and abandoning the
new preview's pending Live completion. Each has a reproducing RED test and a
GREEN fix. Search now accepts at most six frozen visible IDs strictly as a
subtractive filter. Preview follows its own Live completion privately and waits
for terminal facts or the admitted upgrade before it can be confirmed; expiry
or cancellation preserves the original answer. Actual prior removals survive
releasing Add without converting the new identity into a rejection.

One Minor finding is deferred: richer search-row presentation of the source
place type, match explanation and actual known opening windows. Current rows
show the name, optional address/source link and an explicit unknown-hours notice.

Implementation decisions: optional visible IDs cannot establish source facts;
an incorrect supplied list can hide suggestions but cannot admit a place. Waiting
for the preview's existing Live producer preserves exact publication at the cost
of its bounded completion latency. No new provider or acquisition is added.

macOS cannot establish Linux's descriptor-relative file-store
acceptance. A failing local baseline is distinguished from feature regressions.

## Delivery status

Independent review is complete. Four Important findings were fixed with RED →
GREEN regressions (202/202 affected tests; then 113/113 calendar, interaction,
navigation and UI-contract tests). The pre-fix candidate 31c8899b passed the entire
[Linux CI workflow](https://github.com/fritjofherrstrom-png/parranda/actions/runs/42190893826),
including root/frontend tests, typecheck, build/drift and Docker/Source Catalog
smoke checks. That run does not cover the subsequent four fixes; the current
PR head has its own CI gate.

Prepared [PR #686](https://github.com/fritjofherrstrom-png/parranda/pull/686);
no merge or deployment. Current CI and final candidate/QA
head are reported in the PR/handoff after the checks finish. Next owner is Codex
to observe the final CI; integration remains gated on that evidence and a separate integration decision.
