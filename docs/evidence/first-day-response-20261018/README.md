# First-day response: bounded cold-source correction

Owner: Codex. Branch: `codex/first-day-response-20261018`.
Base: `25e688391c874efca6969cba729cba816efc41d1`.
Candidate identity is the commit containing this report; the delivery receipt
records its full SHA and tree. No merge, deploy or public cache change belongs
to this work. Hermes retains the separate Ticketmaster workstream.

## Observed boundary and proven cause

The previous release's saved public London journey took about 40 seconds from
explicit place choice to the rendered day. Its first async response arrived
after about 30 seconds, followed by three status reads. Later adjustments took
about 2–3 seconds. Those observations neither establish cache temperature nor
record when each source completed. The precise cause of that historical run
is therefore still unproven.

The controlled reproduction proves two generic code boundaries:

1. An eager cold directory returns an empty array carrying a private handle to
   its real producer. `composeOpenDataLoaders` checked only that initial empty
   frame for primary rescue, then waited for the primary. Even if the original
   directory finished meanwhile, adequate supply stayed hidden until the
   primary settled.
2. The lifecycle could acknowledge pending only after that composed loader
   returned. A real outstanding directory job could consequently remain
   invisible to the HTTP consumer throughout the primary wait.

The new regression has four failures on an archive of the exact base (three
timing/acknowledgement cases and one masked-source-failure case) and passes
with the correction. Positive/negative controls preserve fast-primary
merging, the existing wait boundary, inadequate/failed/non-rescue supply,
cancellation, warm direct responses, optional-source behavior and a primary
answer at the boundary with its regional anchor.

## Correction

Watch the captured producer completions from this request; never acquire again
or substitute a newer cache generation. Reuse the existing rescue threshold
(12 records and three categories) and ten-second primary opportunity, measured
from the original primary start. A directory ready earlier can rescue at that
boundary; one ready later does not start another ten-second wait. A settled
primary goes through the ordinary merge. Source failures remain visible and
final candidate admission, opening-hours, preference and walking gates remain
unchanged.

A process-private symbol carries the lifecycle notification. Only an actual
captured eager required-source job signals pending early. Public JSON cannot
create the callback, and optional corroborators do not force healthy direct
responses into polling. Warm cached supply keeps the direct response.

Tradeoff: a genuinely cold job that finishes very quickly can now return 202
and pay the existing three-second polling interval. This is not a claim that
all first requests become faster. The source wait, lifecycle deadline, poll
interval and provider budgets have not been increased.

## Verification and limits

The new browser regression uses the built app, real HTTP handlers/lifecycle,
real Overture normalizer and the actual composer/publication path. It starts
with a new private cache and controlled directory/map transport, resolver,
weather and clock. One URL submission renders five Culture/Balanced stops with
valid walking while the original map request is still outstanding. It checks
one acquisition per source, no second composition, no JavaScript errors and
immutable publication after the late primary failure. Browser interception
blocks external assets only; product API responses are not replaced.

This is controlled verification, not fresh-provider or public acceptance.
The historical public London latency has not been remeasured. No Pi image or
runtime changes were made. Local runtime is Node 24.15.0 / macOS 27.0.1 arm64;
the deployed runtime remains Node 22.23.3 / Linux arm64 on the previous release.

Commands (set `PARRANDA_TEST_CHROMIUM` to the installed Chromium executable):

```sh
node --require ./tests/helpers/no-live-network.js --require ./tests/helpers/file-deadline.js --test tests/planner-first-delivery.test.js tests/planner-first-delivery-http-browser.test.js
npm test
npm run check:frontend
npm run build:frontend
node scripts/check-frontend-dist-drift.js
git diff --check
```

Final local full suite: **4,719 PASS, 0 FAIL, 3 skips** (4,722 tests).
The 12 new cases (11 focused controls plus one built-UI/HTTP case) pass in that
run. Frontend typecheck, build, dist drift and whitespace checks pass; rebuilt
frontend output is unchanged. The three skips are two explicit live-network
DuckDB/httpfs cases and one disposable-PostgreSQL case. No browser case is
skipped. New-head CI and Pi/public acceptance have not been performed.

The first full-run attempt had 4,717 passes, one failure and three skips: a
concurrent frontend build temporarily removed `dist/_astro` while an existing
LiveSheet test read it (`ENOENT`). The same test passed separately on the base
and candidate; the final full run after the completed build is entirely green.
No product or assertion change was used to address that orchestration error.

Exact logs and code identity are in the delivery receipt. The independent
review is in [INDEPENDENT_REVIEW.md](INDEPENDENT_REVIEW.md).

## Separate place-quality findings

The park name `攝政公園` and its Polish Wikipedia URL already occur in the saved
normalized London source row, ID
`overture-011783b7-1962-49ca-a8ea-4542d15b81a5`. Overture ingestion currently
projects `names.primary`; the retained schema also has `common` and
language-specific `rules`. The exact raw name object for this park was not
found locally, so an available source-backed English alternative is not yet
proven. No translation or name correction is invented here.

`SKVP Reading`, ID `overture-151de38a-2158-4b22-85f2-1f6a0cf8e393`, remains a
separately documented raw-source identity/coordinate fault. It is not repaired
with a city rule, name blacklist or a blanket independent-source requirement.
PR625 concerns place-choice labels, not these route-stop names. These findings
do not change the accepted route-supply policy.

Landing condition: review the frozen local candidate and obtain a separate
publication/release decision. No broad provider matrix or new provider loop
is scheduled by this report.
