# Förstaförsök och ärliga preferensträffar

Ägare: Codex. Gren: `codex/first-attempt-preference-integrity-20261016`.
Bas: `dad368233963b7766afb532339cbabc7ac2e8fb1` (main efter PR607).
Publik QA enligt beställningen: `7fb8c10cf3a47dd8ddedf2deb3a3314fc30c322c`.
Detta arbete ändrar ingen publik tjänst, cache, deploymentinställning eller Pi-image.
Exakt publicerat kandidat-SHA och slutlig CI redovisas i PR:n.

## Historiskt underlag: observation och gräns

`trace-comparison.json` är en vitlistad sammanställning av sex bevarade QA606-slutsvar,
med filnamn och SHA-256 för originalen. Inga selection receipts, lifecycle tokens,
privata förfrågningskroppar eller autentiseringsuppgifter följer med.

| Fall | Första Lagom | Mellanliggande Fylld | Senare Lagom |
|---|---|---|---|
| Kyoto/Kultur | 18 koordinater och identiteter, 0 eligible; partial/pending=1, provider_unavailable; ingen rutt | 98 poster, 80 eligible, 6 stopp | 98 poster, 80 eligible, 5 stopp |
| Köpenhamn/Grönt | 21 koordinater och identiteter, 0 eligible; complete/pending=0/failed=1, provider_unavailable; ingen rutt | 101 poster, 80 eligible, 6 stopp | 101 poster, 80 eligible, 5 stopp |

Underlaget ändrades faktiskt mellan försöken. Kyoto hade ett kvarvarande jobb i
det publicerade snapshotet; Köpenhamns första insamling var redan terminal.
Koordinaterna saknades alltså inte i det inlästa underlaget: geometry-blockers
beskrev den tomma antagna ruttmängden. Individuella avvisningsorsaker och det
kvarvarande jobbets slutresultat saknas i de historiska spåren.

HTTP 200/202 är inte cachebevis. `cache` är null, och ursprungliga producent-ID:n,
cachegenerationer och provider-rårader finns inte bevarade. Fylld-anropen föregick
de senare lyckade Lagom-anropen, men deras kausala cachepåverkan är **INCONCLUSIVE**.
En senare lyckad körning bevisar varken timeout som grundorsak eller frisk ny
providerinsamling. Ingen sådan förklaring införs i produkten.

## Reproducerade kontraktsfel och rättningar

1. **För tidigt partial-snapshot:** livscykeln räknade råa typmatchande koordinater
   som användbar supply. Knowledge-only-poster kan samtidigt underkännas av den
   befintliga antagningspolicyn. Ett diskriminerande riktigt HTTP-prov gav terminal
   200 vid den befintliga 8s-gränsen före fixen, trots ett faktiskt pågående jobb.
   Nu används riktig normalisering, identitetsupplösning, antagning, kända
   stängningar, stark intentmatchning och aktuell betrodd lokal tids-/reachpolicy.
   Saknas en möjlig minsta ruttmängd inväntas samma producent inom samma 60s-budget.
   De befintliga 8s/15s/60s-gränserna är oförändrade. Ingen återinsamling införs.
   Detta är en readiness-gräns, inte bevis att slutlig geometri/gång/komposition
   kommer att lyckas. Tillräcklig användbar partial supply kan fortfarande ge en
   ärligt begränsad dag; fixen lovar inte komplett providerbevakning.
   Oberoende review reproducerade dessutom att operatörens stängningsbelägg
   tillfördes först efter readiness-beslutet. Nu bedöms det faktiskt berikade
   snapshotet och samma resultat återanvänds. Operatörskontrollen delar högst
   fyra identiteter och sin ursprungliga sexsekundersbudget över partial/final;
   även misslyckade sidor återanvänds inom begäran. Tomma partial-snapshot börjar
   inte förbruka den budgeten. Inga extra försök eller försvagade belägg.
2. **Terminalt svar framställdes som pågående hämtning:** immutable partial/failed
   beskriver underlaget när svaret skapades. UI anger nu avslutad planering utan
   rutt och rätt källbegränsning, även när diagnostisk platsstruktur finns. Läsaren
   kan uttryckligen försöka igen med samma absoluta dag och val. En publicerad
   dag behålls vid uppdatering. Ingen automatisk retry eller utlovad kommande rutt.
   Även primärkällans separata `source_status.error` bevaras i denna förklaring;
   bakgrundsjobbens `complete/failed=0` får inte dölja ett faktiskt primärkällfel.
   Två monterade RED-fall (sv/en) och ett publicerad-dag-kontrollfall verifierar
   denna sista avgränsade UI-rättning. Friska kontrollsvar har inga källfel.
3. **Berlin/Second hand visade främmande träffar:** första området fick väljas
   med noll täckning, och tom on-intent-lista föll tillbaka till alla medlemmar.
   De historiska elva var nio museer, ett galleri och ett slott. Kandidatytans
   server-only `candidateSurface:true` använder nu canonical fit per faktisk
   medlem. Saknad preferens får ingen främmande utfyllnad. Weak blir delvis;
   endast strong blir covered. Rå struktur behålls som diagnostik, men matchlista,
   antal och karta använder filtrerade medlemmar. Default district-composition
   och micro-base-policy är isolerade från denna visningsrättning.

Readiness och komposition delar samma väderläsning för samma koordinater/datum/
betrodda tidszon, även vid fel. Kompositionen läser aktuell klocka på nytt. En
verkligt ändrad micro-base innebär annan geografisk väderkontext, inte en retry
av en misslyckad identisk begäran. Inga nya källor eller trustregler införs.

## Avgränsad identitetskontroll: ingen belagd kandidatfix

- Vasakronan: `overture-37495dda-aa0a-4543-9279-b2eda9df3c30`,
  `59.33271408081055,18.0610294342041`, publicerad typ bar. Ett äldre normaliserat
  v2-cacheobjekt har samma ID/punkt och företagswebbplats, men saknar rå taxonomy
  och är inte QA606:s v5-underlag. Fysisk funktion och historisk mappningsorsak:
  **INCONCLUSIVE**. Namnet används inte som svartlista.
- Parque Infantil do Jardim da Cerca de Graça:
  `overture-ed52f37f-20c3-4313-a22c-7f46d85cd7d9`,
  `38.717559814453125,-9.132593154907227`, typ park. Scenic förblev partial i
  stopp, negotiation och visad text; den räknades inte som satisfied utsikt.
  Exakt råklassning/objektavgränsning: **INCONCLUSIVE**. Inget generellt förbud
  införs för legitima flerfunktionsplatser.

## Reproduktion och verifiering

Lokalt: macOS arm64, Node **24.15.0**, verklig Chrome via `playwright-core`.
Detta är inte Node22/Linux/arm64-imageacceptans. CI använder Node22/Linux x64.
Ingen ny Pi-image byggs i detta uppdrag.

De nya HTTP-/browserproven använder verkliga Express-handlers, privat ny
`createSourceCache`, riktig background source, providerkomposition, antagning
och publicering. Endast externa resolver-/källgränser och klockan är styrda.
Produktens API-svar ersätts inte med `context.route`. Externa browserresurser
blockeras. Detta är **kontrollerad verifiering, inte verklig provideracceptans**.

```sh
node --require ./tests/helpers/no-live-network.js --test tests/planner-cold-admission.test.js tests/planner-source-snapshot-readiness.test.js tests/planner-cold-lifecycle.test.js tests/planner-cold-api.test.js
node --require ./tests/helpers/no-live-network.js --test tests/district-composition.test.js tests/rhythm-density.test.js tests/day-rhythm-engine.test.js tests/day-rhythm-composition.test.js tests/walkable-micro-base.test.js
node --test frontend/tests/planner-terminal-source-state.test.mjs frontend/tests/planner-places-arriving.test.mjs frontend/tests/planner-restored-source-snapshot.test.mjs frontend/tests/day-limitations.test.mjs frontend/tests/candidate-areas-preference-integrity.test.mjs
npm run check:frontend
npm run build:frontend
# Efter commit: jämför nybyggd dist mot den aktuella kandidaten.
node scripts/check-frontend-dist-drift.js
# Ange installerad Chrome-sökväg vid behov; CI installerar Chromium.
PARRANDA_TEST_CHROMIUM=/absolute/path/to/chrome node --require ./tests/helpers/no-live-network.js --test tests/first-attempt-preference-browser.test.js
PARRANDA_TEST_CHROMIUM=/absolute/path/to/chrome npm test
```

RED-loggarna visar faktiska beteendefel före respektive fix. GREEN omfattar
fördröjt samma jobb, verklig åttasekundersgräns, återstående öppettidsfönster,
hard deadline, sena svar, cancellation, generationsisolering och nytt intent.
Rytmregressionerna bevarar 4/5/6 från relevant utbud. Monterade tester täcker
terminal partial/failed på svenska och engelska, manuell återhämtning, bevarad
publicerad dag, save/restore samt att okomplett underlag inte dömer platsen tunn.

Browserbilderna visar styrd, byggd UI: pending efter 8s, fem stopp från samma
jobb, ärlig nollmatchning utan museifyllnad och fem relevanta stopp efter enbart
uttryckligt återförsök. Slutlig fullsvit, separata skips, exakt SHA, oberoende
review och CI-status publiceras i PR:n; äldre loggar uppgraderas inte till nya
sluthead-resultat.

Kvarstående evidensgräns: historisk provider-/cacheorsak och de två historiska
objektens råklassning kan inte avgöras med det bevarade materialet. Det ändras
inte av kontrollerade gröna tester. Ingen publik acceptans hävdas här.
