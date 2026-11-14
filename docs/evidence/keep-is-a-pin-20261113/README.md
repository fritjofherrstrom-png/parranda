# Keep is a pin: evidence (13 Nov 2026)

- **`qa-20261112-malmo-keep-receipt.png`**: the QA finding on staging, main 2590f540. Keep on the first Malmö stop (with Cafés and Bakeries picked) re-composed the day:
  - The stops came back in reverse order.
  - A Live event was woven in, and the walk grew from 3.3 to 5.3 km.
  - The receipt read `Changed: Live: event added · +1 stop · 3.3 → 5.3 km` and never named the kept stop.
- **`before-staging-2590f540-keep.png`**: a staging run on 13 Nov with the default Malmö interests.
  - Keep still sent a new compose, with `include_live_completion=1&include_live_route_upgrade=1`.
  - That day happened to come back unchanged.
  - The receipt read `Changed: same stops and distance` and did not name the stop.
- **`after-branch-keep-staging-replay.png`**: this branch's built UI, served locally. The same staging Malmö response was replayed with Playwright `route.fulfill`. This is a staging replay, not a local compose.
  - Keep sent no compose.
  - The receipt reads `Kept: Konstklubben Skåne`, with Undo.
  - The ledger shows "1 place kept", and the stop shows its "Kept" badge.
- **`keep-evidence.json`**: the numbers behind both runs.
  - Composes caused by Keep: staging 1, branch 0.
  - Undo composed nothing.
  - The next adjustment (Full) carries `pinned_candidate_ids`.
- **`keep-evidence.cjs`**: the script that produced the two runs.

The mounted regression test is `frontend/tests/planner-keep-in-place.test.mjs`. On main it reproduces the staging receipt exactly: `Changed: Live: event added · +1 stop · 3.3 → 5.3 km`, with the stops reversed.
