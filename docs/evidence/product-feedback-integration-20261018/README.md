# Combined opening-hours, Live feedback and wording candidate

Owner: Codex. Target branch: `codex/product-feedback-integration-20261018`.
Main/base: `166609cd4482f38ff52fe91ad5f657181d2a7b54`.

## Exact included ancestry

- #622 `05a329d474df4d745fc8ee05664a9e9d67cbc778`: selected-stop hours,
  identity-bound venue websites and bounded website checks.
- #623 `5970b1ea542351d97494a09a4cd2f92613fedc4a`: published Keep confirmation,
  actual Live change attribution and explicit first-priority shortfall feedback.
- #624 `ed28720dae7b59dd980ee3c2f1a99d06d275ffc4`: consistent sv/en vocabulary,
  including neutral Blitz availability and capacity messages.

All three original heads are preserved as ancestors. The product source hunks
merged automatically, including both StopLine changes and AnywherePlanner.
Generated HTML conflicted; the final dist was rebuilt from all combined source,
including its CSS. No old dist output is accepted as combined evidence.

## Integration delta and evidence

Two #623 mounted locators still named `Clear the order`; #624 now renders
`Clear order`. Before adapting the two locators the same suite had seven PASS /
two FAIL; afterward all nine pass. Assertions for clearing, Undo, exact priority,
save/restore and no extra composition remain unchanged.

The #622 built browser fixture supplied an object-only server clock. The real
composition accepts a callable clock, so it read wall date while browser time
was fixed. A new published-context assertion failed (October18 versus17); the
fixture now implements both callable and `.now()` interfaces, like corrected
#623. All previous selected-date/closure/source/identity assertions remain.
This corrects the evidence fixture, not product time policy. Earlier browser
receipts with mixed clocks are historical evidence with that limitation.

The existing built Live/HTTP fixture now uses actual selected-website enrichment
with controlled HTML. It proves refusal preserves the previous day and exact
Undo, confirmed Keep retains dated website hours, ordinary URL reload revalidates
the same occurrence and preserves hours/provenance, and release removes the pin
without losing the hours. The second journey still proves ordinary priority
composition labels the actual added Live occurrence and Undo restores the day.
The three built hours cases preserve missing/failed-source usable routes and
withhold an observed closed stop and its detour suggestion.

Focused checks: 14 mounted/built-browser tests and 100 hours/Live/backend
regressions PASS, zero failures/skips. These counts overlap the full suite.
Final exact-head full-suite/CI/review results belong to the PR/delivery receipt.

The built application talks to real local HTTP handlers, middleware, composer,
publisher and event normalizer. Only source/resolver/weather/clock boundaries
are controlled; product API replies are not intercepted. External browser map
assets are intentionally aborted, so map-tile availability is not acceptance.
Built combined journeys are English; sv/en message and selected-hours coverage
also use mounted components and the Blitz real-HTTP/component browser fixture.
Allowlisted summaries exclude signed place references and raw storage receipts.

## Commands and release limits

Run `npm run check:frontend`, `npm run build:frontend`, then the browser files
`frontend/tests/planner-{live-feedback,selected-hours}-http-browser.test.mjs`
and `frontend/tests/planner-priority-feedback.test.mjs` via the ordinary root
network guard. `PARRANDA_TEST_CHROMIUM` selects an installed Chromium. Full
checks: `npm test`, `npm run test:frontend`,
`node scripts/check-frontend-dist-drift.js`, `git diff --check`.

Unknown hours do not block otherwise usable routes. Source schedules do not
promise open-now, arrival or holiday-exception verification. Real venue/source
availability, physical Safari and Node22/arm64 Pi acceptance are not established
by these controlled checks. Source coordinate errors remain separate. No new
source, trust gate, quota, retry loop or timeout increase is included.

This is a main-targeted integration for review/CI, not a merge or deployment.
Main/public staging/cache/deployment settings remain untouched. Landing requires
exact-head review/CI followed by the user's separate coordinated release decision.
After any authorized ancestry-preserving merge, reconcile #622/#623/#624 against
their then-current heads; preserve any new deltas. No other PR is included.
