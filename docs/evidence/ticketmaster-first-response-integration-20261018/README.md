# Ticketmaster and first-day response: local integration

Owner: Codex, local integration and evidence. Hermes remains the implementation
owner of PR627. Target branch:
`codex/ticketmaster-first-response-integration-20261018`.

Frozen inputs:

- Base/main: `25e688391c874efca6969cba729cba816efc41d1`.
- First-day response: `02b37271f91104dd50264729d3348e9eeb36757a`.
- PR627: `e58be893af51ac68bf8941c8d1d511705cfe255f`.

The input branches change different product files and merge without conflict.
No product-source conflict resolution or new product policy is included.
Frontend output is rebuilt from the combined sources. Existing frozen refs
are preserved. Candidate identity is the enclosing merge commit; the external
delivery receipt records the exact SHA/tree and final full-run result.
Nothing is pushed, merged into main or deployed by this local preparation.

## Reused evidence and new integration delta

PR627 CI run39142624190 completed/success on exact `e58be893…`:
root4,730 PASS/0FAIL/3skips, frontend889/889, frontend typecheck/build/dist,
container and separate SQL/PostgreSQL smoke all pass. These results belong to
PR627, not a new combined-head CI run. The first-day source correction has its
separate exact-head local full-run evidence in the adjacent first-day report.

Independent read-only review found no blockers in PR627. A separate reviewer
reran22 affected backend tests and the original14-contract built-UI/HTTP
journey on exact PR627. No provider/public/Pi claim follows from those fixtures.

The integration test preserves every original14 assertion and runs the journey
with both ready places and a new isolated cold place producer. In the cold
case, the real `createBackgroundSource` and `composeOpenDataLoaders` face a
stalled primary. The existing12-record/3-category rescue threshold and
ten-second primary window remain unchanged. Two source-fixture food rows and
two park rows make the fixture varied; an assertion requires every published
initial stop to remain a museum under explicit Culture.

Ticketmaster transport is separately held pending until the first real day
publishes. The browser must receive a genuine planner202; the map must still
be outstanding at publication; Live must still be pending with a real
completion capability. The same original jobs then complete. The unchanged
14-step Keep/Undo/reload/Remove/Replace/release journey follows, including
exact occurrence, priority, Full rhythm, shorter extent and exclusions.
One directory acquisition across all completions, edits and reloads is required.

Focused combined run:35 PASS/0FAIL/0skips, including both14/14 browser journeys.
Independent review of the new fixture/gates/assertions found no blocker or
weakened assertion. This is controlled source evidence through real built UI,
Express, normalization, composition and publication; no product API mock,
actual commercial provider, physical Safari, WebGL or Pi acceptance is claimed.

Local runtime: Node24.15.0/macOS27.0.1 arm64. CI uses Node22; Hermes' scoped
Node22/Linux-arm64 source-mount evidence belongs to PR627 only. No new image
is built here. The independent raw-name diagnosis is linked in
[the place-quality report](../place-name-quality-20261018/README.md).

## Commands and landing condition

With the installed Chromium executable configured in `PARRANDA_TEST_CHROMIUM`:

```sh
node --require ./tests/helpers/no-live-network.js --require ./tests/helpers/file-deadline.js --test frontend/tests/ticketmaster-live-http-browser.test.mjs tests/planner-first-delivery.test.js tests/ticketmaster-integrity.test.js tests/ticketmaster-occurrence.test.js tests/ticketmaster-occurrence-fusion.test.js tests/ticketmaster-cache.test.js
npm run check:frontend
npm run build:frontend
node scripts/check-frontend-dist-drift.js
npm test
git diff --check
```

The drift checker compares with HEAD, so its pre-merge-commit comparison to
old `02b3727` is expected to differ from the new frontend. The authoritative
check is after committing the combined source and rebuilt output. Builds and
browser tests run sequentially to avoid removing dist while a test reads it.

The delivery receipt must report final combined-head full-run counts and its
separate skips. Publication/new-head CI and any merge/deploy remain separate
decisions. PR627 stays open/draft and no unrelated PR is absorbed or closed.
