# Food evidence correctness — bounded fix

Owner: Codex. Branch `codex/food-evidence-correctness-20261028`, from GitHub main
`260280137d6e7caaf86edb855f4fecbdfd1b4e9d`. Reuse this chat's isolated worktree;
preserve other checkouts. Deliver a reviewed main-targeted PR, no merge/deploy
or paid/model activation.

## Evidence and design

The actual Pi v6 Overture sample already contains the reported candidate ID,
name `Elvis Presley Statue`, restaurant type, mat tag and a website pointing to
a news article whose path names a statue. Fit then correctly follows that
incorrect category into strong Food coverage. This rules out a UI-only error
or a later identity merge as the origin of this observed wrong type.
The exact raw Parquet row has not been recovered: bounded inspection timed out;
do not claim its precise primary label or source-generation interpretation.
The frozen normalized snapshot and its source receipt are the regression input.

Use a conservative consistency guard on food-business records when two
source-owned fields explicitly describe a different function: a named physical
feature designation in the name AND the same feature designation in an
article/news/wiki website path. An explicit eatery/business designation in the
name prevents this veto. Bare ambiguous brands, article URLs alone, names alone,
unknown hours and missing websites do not trigger it. No new positive category
is inferred; the contradictory row is excluded from Overture output.

Apply the guard both to fresh normalization and to selection of already cached
samples, before ranking/corroboration. Preserve original receipts/disk data and
normal source gates; no cache deletion or broader acquisition.

Alternatives: changing Food vocabulary would hide correct restaurant matches;
requiring corroboration for every directory restaurant would remove legitimate
sparse supply; assigning monument from the name would invent a new positive
claim. The bounded two-field veto addresses the observed contradiction without
those policy changes. It does not detect every upstream category error.

## Execution and verification

- [x] Preserve the real source snapshot; reproduce false Food coverage (RED).
- [x] Add a small pure guard, fresh/cached integration, genuine-business and
  single-field negative controls; verify existing taxonomy/food tests (GREEN).
- [x] Independently review and fix material findings.

Publication condition: a main-targeted PR with exact-head CI green. The PR body
records its final SHA, check results and delivery status; this source document
does not assert a completed CI run or deployed acceptance.

Baseline: 23 Overture source/taxonomy tests PASS, 0 FAIL. Local initial loading
was slow; no runtime/model change or live compose was performed. Fixture/source
replay does not certify a deployed Honolulu journey.

Review: one P2 (missing trattoria/osteria business designators) reproduced and
fixed RED/GREEN; no other material finding. Focused checks: 111 PASS / 0 FAIL.
Full retained-cache replay: 600 source records, 80 selected, exactly the observed
row withheld, original receipt/hash unchanged, zero new acquisitions. The
independent reviewer declined upstream raw-cause, universal/multilingual
completeness and deployed acceptance; those limits remain explicit.
