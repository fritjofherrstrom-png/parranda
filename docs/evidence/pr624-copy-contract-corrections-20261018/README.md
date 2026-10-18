# PR624 copy contract correction

Owner: Codex. Target: existing draft PR624 (`claude/ux-copy-sv-en`).
Local implementation branch: `codex/ux-copy-contract-corrections-20261018`.
Parent PR624 head: `1e9e1c7eaa0cb66114987d008f402fb32060c827`.
Main/base: `166609cd4482f38ff52fe91ad5f657181d2a7b54`.
Parent CI39080432854 passed; its evidence is a baseline, not final-head CI.

The approved correction changes two UI messages. Blitz says current opening is
unconfirmed rather than claiming the source schedule is missing: real source
`24/7` can still yield `opening_hours_local_day_unavailable` when trusted local
time is unavailable. The same helper labels the main and backup suggestions.
The busy message describes Parranda's capacity without inventing other users.
No source, availability, trust, routing, priority, GPS or intensity rule changes.

RED: real HTTP -> native BlitzCard in Chromium supplied known `24/7` schedules
for both main and backup, but the old copy claimed unknown source hours.
GREEN: the same scenario, in sv/en, preserves the backend's unknown local-day
assessment and uses neutral copy. Existing missing-hours and late-open checks
remain; backend controls preserve known closure, overnight opening, sourced
outdoor activity and rejection of injected public facts. Clock assertions
verify the actual response uses the controlled instant. External sources and
weather are controlled, not fresh provider or public-runtime acceptance.

Focused groups: 94 mounted/contract checks and 11 HTTP/browser/backend checks
pass. Typecheck/build pass; exact-head full suite, dist guard, CI and review
are recorded in the PR/delivery receipt. Run `npm test`, `npm run test:frontend`,
`npm run check:frontend`, `npm run build:frontend` and
`node scripts/check-frontend-dist-drift.js`. Existing Chromium can be selected
with `PARRANDA_TEST_CHROMIUM`; no live-network opt-in is used.

Frozen PR623 `5970b1ea542351d97494a09a4cd2f92613fedc4a` and opening-hours PR622
`05a329d474df4d745fc8ee05664a9e9d67cbc778` are not imported or altered. A joint
release needs dist rebuilt from combined sources and verification on that exact
head. This correction does not merge, deploy or change staging. Landing remains
a separate decision after exact-head CI/review; Codex owns this correction.
