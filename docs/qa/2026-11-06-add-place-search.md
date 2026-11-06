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

The final full frontend run at cce5da7e ran 1,082 tests: 1,062 passed
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

The previously deferred Minor was completed on Fritjof's follow-up request.
Search rows now show localized source place type and match reason, and reuse the
existing selected-day hours renderer for opening windows, all-day schedules and
conditional holiday uncertainty. Missing/malformed facts retain the unknown-hours
notice; raw unknown engine types stay hidden. Four mounted regressions were
observed RED then GREEN in English/Swedish. The 70-test affected UI/hours/contract
set, TypeScript, build and real-HTTP Chrome journey pass. Desktop/mobile search
rows were inspected together; the browser fixture now proves native OSM hours
reach the search row before preview/confirm. Admission and search are unchanged.

Implementation decisions: optional visible IDs cannot establish source facts;
an incorrect supplied list can hide suggestions but cannot admit a place. Waiting
for the preview's existing Live producer preserves exact publication at the cost
of its bounded completion latency. No new provider or acquisition is added.

macOS cannot establish Linux's descriptor-relative file-store
acceptance. A failing local baseline is distinguished from feature regressions.

## Delivery status

Independent review is complete. Four Important findings were fixed with RED →
GREEN regressions (202/202 affected tests; then 113/113 calendar, interaction,
navigation and UI-contract tests). The reviewed/fixed source candidate cce5da7e passed the entire
[Linux CI workflow](https://github.com/fritjofherrstrom-png/parranda/actions/runs/42193241962),
including root/frontend tests, typecheck, build/drift and Docker/Source Catalog
smoke checks. That run covers all four fixes. The evidence/test-only revision 0ec17e2b also
passed its complete [Linux CI](https://github.com/fritjofherrstrom-png/parranda/actions/runs/42228968961).
The follow-up display change has its own current-head CI gate.

Prepared [PR #686](https://github.com/fritjofherrstrom-png/parranda/pull/686);
no merge or deployment. Current CI and final candidate/QA
head are reported in the PR/handoff after the checks finish. Next owner is Fritjof for the separate integration decision after the final
head CI. Code and QA preparation are complete.


## Follow-up integration with main

The follow-up initially had no CI run because PR #686 conflicted with newer
main c8cae52c (landed PRs #685 Live recovery and #687 verified venue mentions).
Main was merged into the feature branch with ancestry preserved. Only generated
HTML conflicted; rebuilding dist resolved it. The automatic source merge retains
both the Live recovery installation guards and exact Add/Undo/publication logic.

After integration: 120/120 affected UI/hours/Live-recovery/reference tests pass;
91/92 affected server tests pass. The single actual disk-publication failure
reproduces identically on unchanged c8cae52c on macOS. The native-source real-HTTP
Chrome journey passes, including known source hours, closure refusal and exact
Save/Undo/reload/share. TypeScript/build pass. Current-head Linux CI remains the
merge gate. Owner: Codex for this feature branch; no change has been merged into
main or deployed by this task.
