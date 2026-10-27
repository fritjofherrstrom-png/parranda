# Explicit rhythm and trusted meal context

Owner Codex. Branch `codex/rhythm-meal-context-20261027`, base `721c026a9d8fe591f14ffb0c315348ea1d6dc7a0`. Product commits `5929b05` and `e74529c8a2c309ced66382a16bbaae009d92e078`. These are initial product commits; the review correction commit, final integration head and CI are recorded in the PR. Public release `cf18a5761d1fd9f919db49e28e7262c15bd4b001` was not changed during these tests.

## Proven causes and changes

- The built UI reproduced 5 stops → Remove → 4 → Relaxed → 4 → Full → 4, while a fresh Full request with the same exclusion could supply 6. `chooseRhythm` retained the old manual `target_stop_count`. Only an explicit changed rhythm now releases that old extent, using release_extent on the existing date/place-scoped edit. Removed IDs stay in that scoped intent, Keep commitments remain separate, and Undo restores the previous response/intent. Independent review rejected the initial permanent-ledger migration because it leaked removals into tomorrow; the final implementation does not use it. Other adjustments, retry and ordinary reload keep their prior contracts.
- At trusted local12:45, source-backed lunch (11–15) was fourth and dinner (18–23) was second. Existing ordering received no trusted meal context. A private server context now reaches bounded set selection and ordering so Food priority1 can retain the complementary meal and favour a suitable first meal and, for Full at midday, a distinct later dinner. Existing walk-order tolerances and final walking validation still decide. Strict retained edits win. This is a plan over admitted places, not new opening-hours evidence.

## Verification

- Rhythm: three mounted regressions RED on old code;67 relevant mounted tests GREEN.
- Meals: four RED failures with three negative controls on old code; initial affected root regression60 PASS/0 FAIL/0 skips. Independent-review corrections added two complementary-meal selection cases, date-scope and recipient cases; **the final affected suite is182 PASS/0 FAIL/0 skips** and supersedes these intermediate counts.
- Final built390px Chromium UI → real local HTTP → handlers/engine:3 PASS/0 FAIL. Remove/Relaxed/Full/Undo/reload, lunch-first/dinner-last,4→6 extent, forged client context rejected. No product API response was replaced. External map assets were blocked.
- Typecheck, build and committed-dist check passed. Dist was generated from the changed source in the rhythm commit; the server-only meal change needs no separate frontend bundle change.
- Full local frontend:985 PASS/20 FAIL/0 skips. The failures expect actual immutable publication `ready` but receive `unavailable` on macOS: existing secure store anchors through Linux `/proc/self/fd`. This is **not** a green full suite. Linux exact-head CI remains the completion gate; no tests or store security were weakened.

## Commands and limits

Local runtime: macOS arm64 Node24.15.0, Chromium153. CI uses Linux Node22; Pi production uses Linux arm64 Node22. These controlled tests are not public provider, real restaurant inventory, physical Safari/iPhone, or Pi runtime acceptance. Sources/resolver/weather/clock are fixtures; real source transports were not retried. Known closed places stay excluded, unknown hours stay unknown, partial Food/café fit gains no meal slot, future/unknown timezone gains no current-hour urgency. Existing admitted supply may still be scarce; no new places, trust rules or budgets were added.

```sh
node --require ./tests/helpers/no-live-network.js --test tests/time-aware-meal-ordering.test.js tests/day-composition-priority.test.js tests/day-composition-reservoir-priority.test.js tests/current-day-preference-anchoring.test.js tests/day-rhythm-composition.test.js tests/day-edit-retained-publication.test.js tests/day-rhythm-compactness.test.js
node --require ./tests/helpers/no-live-network.js --test tests/time-aware-meal-http-browser.test.js tests/rhythm-edit-http-browser.test.js
npm run test:frontend
npm run check:frontend
npm run build:frontend
node scripts/check-frontend-dist-drift.js
```

Set `PARRANDA_TEST_CHROMIUM` to an installed Chromium executable if Playwright's default is unavailable. `PARRANDA_MEAL_SCREENSHOT` optionally saves the controlled mobile journey. Run build after frontend tests, never concurrently with temporary frontend harness generation. Sanitized targeted logs accompany this README. Full CI link/result is recorded in the PR. The independent review found two Important issues; both received new RED regressions followed by a single focused correction pass. See INDEPENDENT_REVIEW.md and the review/affected/native logs.

Final review pass also proves released Relaxed and Full publications parse on an empty recipient without permanent exclusions, and a second pending Remove cannot be replaced by an older accepted edit. Both variants were observed RED before correction. Controlled mobile screenshot: [meal-mobile.png](meal-mobile.png).

The same meal-selection finding was also reproduced with Food as the sole interest: six lunch-only venues hid the seventh dinner before the engine. The existing six-place role cut now retains a complementary period within the same source tier and bound; no pin or rejected candidate is promoted. Sole-interest RED→GREEN;16 meal tests and60 related role/admission/rescue/priority tests pass.

## Final source integration

- Current main `c6d85fcd9318c12169f53344312244c4780acd26` (PR658 regional event programmes) was merged with ancestry in `fe969d6`; source merged cleanly. Generated HTML conflicts were resolved by rebuilding actual combined source.
- Final engine refinement `d4d93c7` keeps complementary meals reachable for a single Food interest within the existing six-per-role bound. No source tier or availability is upgraded.
- UI source `f0b1674bcf8412148e599c12cd4b94026f050339`, independently APPROVED in the other chat, is merged with ancestry. Known source kinds/consistent icons appear on optional place cards; non-eligible Maps tips explain that they cannot be added. Server permission and the ordinary shortened-day contract remain intact. Exact historical Landskrona park refusal cause remains unproven; no gate was relaxed to make Add appear.
- On the combined source:60 affected UI tests, typecheck/build,3 built meal/rhythm HTTP-browser tests, plus the actual Remove4→source-permitted Add→4 integration all PASS,0JSerrors. Wide390px mobile pictures accompany the logs. The broader Linux/Node22 exact-head CI is the remaining final gate; its URL/result is in the PR.
- CI/release scope must distinguish current main and this candidate from public `cf18a576`. No merge to main, Pi change, public cache clearing or deploy was performed here.
