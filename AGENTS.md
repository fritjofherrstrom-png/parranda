# Shared delivery rules for Codex and Hermes

Read `CODEX.md`, `docs/PARRANDA_ENGINE_GOALS.md` and
`docs/AGNOSTIC_ENGINE_NORTH_STAR.md` before planner/agnostic work. These rules
apply to both agents and complement the product contracts; user instructions
take precedence. They are a working routine, not an automated monitor.

## Ownership and landing

- Give each workstream one accountable owner, a target branch and a concrete
  landing condition before adding implementation. Identify the integration
  owner separately from the runtime-QA owner when those roles differ.
- Start new independent work from current GitHub main. Stack only for an actual
  dependency; record its parent PR and how the combined work will reach main.
- Keep GitHub main and published PR heads authoritative. Pi checkouts, dirty
  worktrees, local branch names and cached memories are not canonical releases.
- At every handoff report main SHA, candidate/PR head SHA, QA SHA/image when
  applicable, current CI, actual changes, remaining blockers, next action and
  its owner. Separate completed work from proposals and runtime observation
  limits from demonstrated failures.
- Before adding another layer to an unlanded stack, explicitly flag the
  outstanding landing condition and which PRs it blocks. Resolve or record the
  reason to defer landing. A growing stack must not silently become a new base.
- During sustained work, give concise progress updates with findings and the
  next action. Do not leave long silent intervals or report only an old plan.

## Integration and QA

- Publish integration work as a main-targeted PR so its whole diff, including
  WIP and conflict-resolution commits, is reviewable. Inventory exact source
  PR heads and distinguish included ancestry, replaced work and excluded work.
- Specify the smallest QA needed for a concrete risk, its frozen SHA/image and
  PASS/FAIL/INCONCLUSIVE criteria. Reuse existing evidence within its scope;
  do not silently upgrade old-head or synthetic results to runtime acceptance.
- When a candidate changes, review the delta, obtain its CI and repeat only
  affected verification. Do not restart integration or the full matrix by habit.
- INCONCLUSIVE needs a documented landing decision. It does not automatically
  authorize retries, broader testing or new telemetry. A reproduced regression
  needs a focused fix. Unknown provider causes stay unknown after later success.
- A draft must have an explicit remaining condition and next owner/action.
  Avoid duplicate QA schedules. Close a completed test with evidence and an
  outcome, even when the outcome is INCONCLUSIVE.

## Finish delivery

- Before merge, compare current main/head/CI with the approved candidate and
  obey actual repository rules. Check the known deployment coupling; do not
  equate a source merge with runtime deployment or change deployment settings
  without authorization.
- Use an expected-head guard when merging. Preserve ancestry when landing an
  integration whose old PR membership depends on it; do not squash that graph.
- Verify resulting main, CI and actual workflow outcomes. Reconcile absorbed
  PRs immediately afterward against their current heads; preserve new deltas.
  Distinguish merged/included work from replaced or abandoned approaches.
- Preserve work/QA branches, volumes and dirty files unless removal is explicitly
  authorized. Complete the authorized landing and reconciliation before opening
  another independent feature stack.
- Report what reached main, what remains experimental/unverified, what PRs were
  retired and who owns the next action. Never call preparation a completed merge.

## Handoff format

Use this short record in the PR body or handoff; keep it current:

```text
Owner / target branch / PR:
Main SHA / candidate SHA / QA SHA or image:
Concrete behavior changed:
CI and runtime evidence (with scope and links):
Remaining blocker or accepted observation limit:
Landing condition / next action / next owner:
Dependent PRs to reconcile:
```
