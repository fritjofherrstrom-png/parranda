# Full med ett eller två intressen — lokal kandidat

Bas: `55a73693a7d56cc5828a4ae3da13e6cadd9e3ca5`.
Gren: `jean/full-focused-preferences`.
Worktree: `/home/hermes/parranda-full-focused-preferences`.
Evidens: `/home/hermes/parranda-full-focused-evidence/` (RED/GREEN JSONL med hela returnerade primary_route, loggar och manifest med head/checksummor).

## Reproducerad rotorsak och ändring

Två antalsberoende cuts kördes före den riktiga dagsmotorn:

1. `composeAgnosticRouteOutput` gav `limitPerRole: 6` bara vid exakt ett intresse; två intressen använde standardens top-3-role-surface.
2. `mapPlannerReservoirToSourceCandidates` gav samma djup 6 bara vid exakt ett intresse; två intressen begränsades till standardens två platser per vald roll.

På rik, godkänd, kontrollerad pool (sex second_hand + ett museum) blev acquisition/identity 7 → eligible 7 → role surface 4 → combination 2 → engine reservoir 3 → publicerad Full-route 3. Ingen trust-, tids- eller geometristunnhet orsakade denna cut.

Nu bestämmer närvaron av dagsrytm reservoir-djupet oberoende av antalet intressen. Samma pool blir 7 → 7 → 7 → 2 → 7 → publicerad Full-route 6. Engine väljer fortfarande den faktiska densiteten. Befintliga gates, experimental-admission-undantag, preference-focus, pins, excludes, availability och distance-policy är oförändrade.

Single-interest på rik godkänd pool fungerade redan på basen; fixen avser den reproducerade två-intresse-cutten, och nya vertikala finalizer-tester skyddar båda single-interest-fallen.

## RED → GREEN och verifiering

- `red.log`/`red.jsonl`: bas-SHA ovan, ett riktigt assertion-fail (3 != 6), inte setupfel.
- `green-slice1.log`/JSONL: exakt samma test och pool, 1 PASS/0 FAIL efter minimal produktändring.
- `regressions.log`: avslutad 263 PASS/0 FAIL. Inkluderar 6 nya end-to-end-compose-tester samt rhythm, preference, activity-suitability, current-day anchoring, reservoir, engine, pins och walking-finalizer-regressioner.
- `recorded-regression.log`: avslutad 16 PASS/0 FAIL. Recorded London intake/admission/reservoir (35/31/4) oförändrade, role surface nu 23 i stället för historiska 20. Uppdaterat enbart denna berörda snapshot-assertion; walking-/trust-/coverage-assertions kvar.
- `controls.log`: tidigare kontrollförsök hade testsetupfel (icke-existerande exclusions-helper). INCONCLUSIVE; korrigerat till den riktiga `withoutExcludedCandidates`, därefter grönt i regressions.log. Inte produkt-RED.
- `git diff --check`: PASS.

### Konkreta publicerade dagar

Kontrollerade källattribuerade/corroborerade fixturer, inte live-provideracceptans. Dag 2026-10-22, clock 2026-10-14T07:00:00Z, timezone Europe/Stockholm, öppet 09:00–20:00, verkliga lat/lng inom cirka 0,56 km; engine använder egna heuristiska walking-legs och riktiga finalization/publication.

| Identisk pool / intressen | Calm stopp | Full stopp | Calm gångminuter / km | Full gångminuter / km |
|---|---:|---:|---:|---:|
| 6 vintage-shop / second_hand | 4 | 6 | 19 / 1,3 | 20 / 1,2 |
| 6 museum / culture | 4 | 6 | 19 / 1,3 | 20 / 1,2 |
| 6 vintage-shop + 1 museum / båda | 4 | 6 | 20 / 1,3 | 22 / 1,3 |

Alla innehållsstopp tillhör efterfrågat intresseunion, båda intressen förekommer i två-intressedagarna, alla behåller provisional/low-trust. Öppettidsfakta och gångminuter finns i publicerad route. Engine publicerar **inte** schemalagda besökstider eller dwell-minuter; ingen sådan precision eller bevisad heltids-optimalitet påstås.

Negativa kontroller: två tillgängliga platser stannar på två för alla tre preferensfallen; helt stängd pool ger ingen route och `insufficient_geocoded_candidates`; uncorroborated supply blir högst två, unattributed supply ger ingen route. Pinned kandidat bevaras, loader-exclude kommer inte tillbaka och en pin återupplivar inte en stängd plats.

## Begränsningar / återstående granskning

Två broad backend-försök saknar sluttotal: första stoppades av tool 420 s ceiling; andra av 400 s command timeout. Den andra hann observera 2284 ok och 2 not-ok men är **INCONCLUSIVE som fullsuite**. En not-ok var berörd London-snapshot (nu riktat grönt); den andra var saknad absolut `frontend/node_modules/esbuild` i `place-sign-fit`, ett setupfel som inte fixats i detta scope. Inga Node-testchildprocesser från försöken kvar; inga andra processer stoppade. Ingen ytterligare broad rerun.

Node 22.22.3. Återanvänt `/home/hermes/parranda/node_modules` via NODE_PATH efter att identiska lockfilchecksummor verifierats (`284b7fc6553cf615b77d10322c4b9c6ac537901023a3e8ab468bef47323bfc76`). Inga install-/lockfiländringar.

Ingen full CI-, frontend-, browser-, staging- eller live-provideracceptans påstås. Ingen push/PR/merge/deploy/runtimeändring. Oberoende diffgranskning görs av parent efter leverans; kandidaten är lokalt testad, inte märkt oberoende review-godkänd.

## Reproduktion

```sh
cd /home/hermes/parranda-full-focused-preferences
NODE_PATH=/home/hermes/parranda/node_modules node \
  --require ./tests/helpers/no-live-network.js \
  --require ./tests/helpers/file-deadline.js \
  --test --test-timeout=600000 tests/full-focused-preferences.test.js \
  tests/day-rhythm-*.test.js tests/preference-focus.test.js \
  tests/activity-intent-suitability.test.js tests/current-day-preference-anchoring.test.js \
  tests/agnostic-engine-*.test.js tests/agnostic-route-output.test.js \
  tests/planner-reservoir-comparison.test.js tests/pin-walking-budget.test.js \
  tests/pinned-candidates.test.js tests/pin-refusal-reasons.test.js \
  tests/agnostic-route-walking-validation.test.js
NODE_PATH=/home/hermes/parranda/node_modules node \
  --require ./tests/helpers/no-live-network.js --require ./tests/helpers/file-deadline.js \
  --test --test-timeout=600000 tests/large-area-route-selection.test.js
```
