# Integration status and current-day preference fix — 2026-10-01

## Verified GitHub snapshot

Before opening the current-day fix PR, `git fetch` and GitHub reported:

- `origin/main`: `ceee59e`, last commit 2026-09-25 10:28:36 Europe/Stockholm.
- 26 open PRs: 23 drafts, three non-drafts (#519, #540, #541).
- #519: clean merge, successful CI, no submitted reviews. This establishes
  mergeability, not independent product acceptance.
- #538: draft, head `14ced72e901c48a8bcf915fb0ce1bd57ebc7338f`, successful CI.
  Its recorded real-Pi acceptance remains FAIL.
- #540: head `1adb39fb485a7f79f9be6d341e433986fcd01d8b`, successful CI,
  merge conflict against its updated #538 base.
- #541: head `5764f605e2fec71fd93687ae6fcd4ba2c82ecd49`, stacked on #540.

The earlier report's main SHA and main merge history are correct; its open/draft
counts are not. All three non-draft PRs were listed, despite the claim of five.
#532 was missing from the draft inventory.

## What the integration already contains

These exact PR heads are ancestors of #538: #516, #517, #518, #519, #521, #522,
#523, #528, #532, #533, #534, #536, #537 and #539. Do not apply their changes
again when assembling the integration. #538's base is an integration branch,
not main; merging it into that base alone does not ship these changes to main.

#501, #507, #520, #524, #526, #527, #529, #530 and #535 are not ancestors of
#538. That ancestry result does not establish whether individual changes were
copied or superseded. Review their actual diffs before carrying them forward or
closing them.

A read-only `git merge-tree --write-tree` of exact #538 and #541 heads reports
one conflict: `frontend/dist/anywhere/index.html`. `AnywherePlanner.tsx` merges
automatically. Resolve this generated file by rebuilding the combined frontend,
then check source, output drift and mobile behavior; choosing one old build would
discard part of the combined serving contract. A clean source merge does not
establish semantic compatibility or QA acceptance.

## Confirmed blocker and fix

[The real-Pi reproduction](https://github.com/fritjofherrstrom-png/parranda/pull/538#issuecomment-5930609519)
at 13:33 Europe/Stockholm on 1 October selected Pâtisserie David as fika. Its
source hours were 08:00–17:00 and its availability verdict was
`available_in_window`. `anchorSourceCandidatesToCurrentBand` nevertheless
removed it because `coffee_fika_stop` normally maps to morning. The published
Full day contained shopping only. This is a confirmed selection bug, distinct
from the cold-source failures already repaired in `14ced72`.

The modern engine composition now carries the server-owned availability verdict
into its reservoir. For today's trusted current band, a candidate strongly
covering an explicit requested interest and having known remaining-day
availability survives the typical-role trim. Its approximate daypart moves to
the current band **before** engine ordering, geometry and public labeling.
This applies generically to requested experiences, including afternoon shopping.

Unknown or unsupported schedules do not establish availability. Closed-window
candidates remain excluded by the existing gates. Future days and unknown
timezones retain their original behavior. Pins, source admission, confidence,
rhythm, walking validation and the conservative two-candidate floor remain in
their existing paths. Availability means an overlap somewhere in the remaining
day; neither the new daypart nor the public source-hours fact certifies “open
now”, a scheduled arrival or a complete visit-window feasibility check.

The new API regressions reproduce the loss on the unmodified #538 head and cover
current midday/afternoon, later opening, closed windows/days, unknown/unsupported
schedules, public evidence injection, future dates, unknown timezone and
unselected interests. Existing targeted composition/time/ordering tests pass.
Fixtures are evidence of the code correction, not real-Pi acceptance.

Local validation of the fix:

- 108 targeted API/composition/time/ordering tests PASS on Node 22.23.3 and
  Node 24.19.0; three regressions first failed on the unmodified #538 code.
- Full Node 24 suite: 3,213 tests, 3,201 PASS, zero FAIL, 12 SKIP (403.45s).
  Nine browser cases initially skipped because automatic Chromium discovery
  missed `/usr/bin/chromium`; explicit reruns PASS: 15 browser tests, zero FAIL
  or SKIP, including the 110-view legibility harness. Two live DuckDB
  extension-download tests and the disposable
  PostgreSQL integration remain opt-in.
- Frontend typecheck, production build and committed-build drift check PASS.
- Self-hosted production contract validation PASS.

## Integration sequence

1. Review and incorporate this small fix into #538's integration branch.
2. Repeat exact-head real-source and mobile acceptance: today's selected
   shopping + fika must retain an eligible fika with an honest current-day arc.
   Complete the unresolved Uppsala old-point/provider veto and Göteborg source
   coverage cases recorded in #538. Preserve cold/warm measurements separately.
3. Combine #540 and #541 with the accepted integration, regenerate the frontend
   build, and run the combined CI and Live scope/period/mobile checks. The older
   `5764f60` Live QA image does not include the current #538 repairs or this fix.
4. Prepare one reviewed integration PR targeting main. Check the exact final
   image and source SHA before merge. #519 can be reviewed separately, but its
   changes are already in the combined candidate.
5. After main actually contains the changes, reconcile the absorbed PRs and
   inspect remaining drafts individually. Do not close them from ancestry alone.

The architectural sequence proposed in #519 remains a follow-up: day view-model,
hooks, a versioned `day_view_v1`, legacy-route removal and the `server/app.js`
route split. It is not a prerequisite for correcting the demonstrated fika loss.

No main merge, deployment, PR closure or modification of existing PR branches
was performed by this investigation. Real Pi evidence is on another host; this
cloud workspace has not certified that runtime.
