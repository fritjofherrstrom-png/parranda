# Main catch-up: beslut och genomförandesekvens

> **Historiskt underlag från integrationsarbetet den 1 oktober.**
> [#543](https://github.com/fritjofherrstrom-png/parranda/pull/543) landades
> den 2 oktober med merge-commit `98fd53ec0a846045044f52be1fbd5fa917bdda6e`;
> kandidat `a3dcebcc42883b270e013beea4fcab766e72df57`. Samtliga 22 inkluderade
> PR-headar är ancestors till landad main. Nyare SHA-bunden Ystad/Live-QA
> och det avslutade fika-provet finns på PR:n. Fika och cacheidentitet är
> INCONCLUSIVE och accepterade som dokumenterade observationsgränser,
> inte runtime-PASS. Följ inte nedanstående gamla draft-/QA-beställningar
> som aktuella nästa steg. Läs aktuell GitHub-status och `AGENTS.md`.

## Exakt-head QA och avgränsad providerfix

Hermes verifierade `8de0a6ac46c8fbe9afaa52d73fafb2093d4b3b4d` med samma
image för QA-web/worker och grön CI. [Grundrapporten](https://github.com/fritjofherrstrom-png/parranda/pull/543#issuecomment-5936114912)
och [råsvaren](https://github.com/fritjofherrstrom-png/parranda/pull/543#issuecomment-5936570780)
visar verkliga uteblivna dagsleveranser: Malmö har complete/failed=1, medan
Ystad har partial/bounded_lifecycle_snapshot/pending=1. API200 är inte en
upstream-status. De avgränsade [loggfönstren](https://github.com/fritjofherrstrom-png/parranda/pull/543#issuecomment-5937039654)
är tomma; Malmös specifika provider-/native-fel kan inte fastställas därifrån.

Ystads [cache-readback](https://github.com/fritjofherrstrom-png/parranda/pull/543#issuecomment-5937079123)
visar 78 Overture-poster, inklusive fyra vintagebutiker, skrivna 45,985 s efter
requeststart och före sista statuspoll. Inget senare koordinatstyrt Ystad-anrop
finns i den sparade tidslinjen. En kontrollerad offline-jämförelse med main
reproducerar att kandidaten avslutar en tom snapshot vid 45 s medan main
fortsätter vänta på samma källa. Cachefilen saknar request-ID och snapshotens
skapandetid är inte uppmätt, men detta ger konkret stöd för tappat sent utbud.

Providerfixen reserverar därför kompositionstid bara när snapshoten har rader.
Tomt underlag fortsätter invänta den redan startade hämtningen inom samma
60-sekundersbudget. Inga extra provideranrop införs; deadline, cancellation,
trust/availability-gates och den publicerade dagens oföränderlighet kvarstår.
Nya regressionsfall fallerade före fixen och verifierar sen supply, hard
deadline/abort samt att icke tomt partiellt underlag behåller reserven.

#543 förblir draft. Fixen behöver egen exakt-head CI och ett riktat
runtime-fall för sen supply; tidigare QA gäller fortfarande endast `8de0a6a`.
Fika under verkliga återstående öppettider samt terminal Live Hela området/
Nära mig och period/cache-jämförelse återstår. Uppsala, Göteborg, Rome och
redan passerade mobilfall ska inte göras om som bred QA.

## Källan för integrationen

GitHub/main och de publicerade PR-headarna är källan för denna kandidat.
Main vid granskningen är `ceee59e7b4dac36b7c8832a2dee0146179d02932`.
De 27 öppna PR:erna före denna nya integrations-PR finns med full SHA, målgren
och beslut i [grafögonblicksbilden](evidence/main-catchup-pr-graph-2026-10-01.json).
Ancestry-kontrollen gjordes mot kandidatens kod-head `1986905`; senare
dokumentation och ombyggnad av frontend ändrar inte medlemskapet.

Pi:n är runtime-/QA-evidens. Dess arbetskataloger används inte för att välja
kod, lösa konflikter eller fylla luckor i integrationen. De 35 staged filerna i
`/home/hermes/review-510-integrated` är orörda och ingår inte som en egen patch.
Pi-readback 2026-10-01 15:32 Europe/Stockholm visar den katalogen på `591fab9`,
publik staging på `0234d2b`, separat Planner-QA på `14ced72` och Live-QA på
`5764f60`. Ingen av dessa images är den samlade kandidaten.

## Rekommenderat beslut: en main-riktad integrations-PR

Publicera och granska hela kandidaten mot main. Behåll merge-ancestry i den
slutliga mergen; squash skulle försvåra kopplingen mellan landad kod och gamla
PR-headar. Individuella PR-headars gröna CI ersätter inte kandidatens egen CI.

| PR:er | Beslut efter accepterad integration till main |
| --- | --- |
| #516, #517, #518, #519, #521, #522, #523, #528, #532, #533, #534, #536, #537, #538, #539 | Exakta headar ingår via #538; tillämpa dem inte igen. Kontrollera slutbeteendet eftersom senare commit ändrar äldre implementationer. |
| #540, #541 | Exakta headar ingår i den samlade Live-integrationens ancestry. |
| #542 | Exakt head ingår; rättar tappet av ett tillgängligt, uttryckligen valt intresse vid dagens tidsankring. |
| #507, #520, #524 | Exakta headar är separat mergade i kandidaten: borttagen Claude-kontext, rättad gap-dokumentation och läsbar legacy-Pulse. |
| #527 | Exakt head är mergad. Integrationsfixen anpassar ändringsbesked och ångra till `calm/balanced/full/free`, utan kilometerpayload. |
| #526, #529 | Headarna ingår inte. Kartbeteendet har portats och vidareutvecklats i #538: kontrollutrymme, separata tappytor, stop-id och zoom/resize. Stäng som ersatta med hänvisning till implementation och karttester. |
| #530, #535 | Uteslutna: deras kilometerband/mål motsäger den nya dagsrytmens kontrakt. Stäng som övergivna, inte som mergade. Eventuellt fortfarande relevant skydd måste omformuleras mot dagsrytm innan det återinförs. |
| #501 | Behåll separat utkast. Faktiska gångnätskostnader är värdefulla, men grenen inför en egen opt-in-leverantör och äldre kilometerbedömning. Anpassa till dagsrytm och verifiera leverantören i ett eget arbete. Den blockerar inte denna catch-up. |

De 22 ingående headarna verifierades med `git merge-base --is-ancestor`.
#526/#529:s beslut bygger också på diff, nuvarande RouteMap och tester, inte
enbart på ancestry. Ingen original-PR-gren behöver flyttas eller skrivas om
för att main ska kunna ta emot denna samlade kandidat.

## Vad som redan är sammanställt

Kandidaten utgår från #542 på #538. #541, inklusive #540, är inmergad.
Konflikten i `frontend/dist/anywhere/index.html` löstes genom att bygga aktuell
kombinerad frontend. Därefter integrerades #520, #524, #507 och #527.
Även #527:s dist-konflikter löstes med en ombyggnad, utan att kopiera en hel
gammal eller annan integrationsgrens `AnywherePlanner.tsx`.

Integrationen av #527 avslöjade en verklig kompatibilitetsmiss: dess nya
ändringsbesked refererade till borttagna `WALK_PRESETS`. Kandidaten använder
`DAY_RHYTHMS`; mounted UI-tester kontrollerar både besked/ångra och att nya
anrop skickar dagsrytm och `no_limit`, utan `walking_km_target`.

Slutgranskningen hittade också att API:t inte skickade `day_rhythm` vidare till
citypack-motorn: både Lugn och Fylld gav samma peak-dag. Kandidaten skickar nu
den normaliserade rytmen även i den vägen. Ett API-regressionstest reproducerar
felet före fixen och kontrollerar faktisk profil/stoppdensitet för alla fyra
rytmer efter fixen. Äldre anrop utan rytm behåller motorns null/default-väg.

## WIP `796ceb1` är synlig och måste bedömas i slutdiffen

Commiten är 22 filer, 329 tillagda och 52 borttagna rader. Den ingår redan i
den publicerade integrationens Git-historik; ingen dirty Pi-katalog behövs för
att få med den. En main-riktad PR visar dess nettoeffekt tillsammans med
senare rättningar. Granska dessa kontrakt i den aktuella koden:

- Modern Planner skickar dagsrytm i stället för kilometerönskemål. API:t
  sätter `no_limit` och tar bort kilometerbandet i modern agnostisk komposition.
  Äldre delningslänkar och sparade `short/long`-val migreras till `calm/full`.
- Densiteten följer rytmen; distansen mäts som resultat. Den gamla engine-koden
  har fortfarande geometriska komfortheuristiker och ett internt standardtal.
  Tester av `not_requested` är inte ett bevis på fullständig neutralitet för
  varje äldre engine-väg. Påstå inte att all distans-/tempoheuristik tagits bort.
- Källägda adresser och webbplatser kan skilja namnlikadana kartpunkter åt;
  det är inte operatörsverifiering. Två självständigt adresserade filialer ska
  förbli separata. Publika payloads får inte injicera sådana bevis.
- Walking-fit för stödroller tillhör främst den äldre target-vägen; dagens
  `no_limit` får inte återaktivera ett önskat kilometerutfall. #534:s borttagna
  `walking-target-note` ska inte återinföras.

Relevanta kontroller finns i `tests/source-location-evidence.test.js`,
`tests/day-rhythm-engine.test.js`, `tests/walking-fit-selection.test.js`,
frontendens contract/share/storage-tester, commitment-race-tester och nya
`tests/current-day-preference-anchoring.test.js`. Leverantörers aktuella
uppgifter och faktisk besökbarhet kräver separat runtime-evidens.

## Genomförandesekvens

1. **Frys kandidaten och granska hela main-diffen.** Publicera denna kandidat
   som draft-PR med `main` som bas. Kontrollera det publicerade head-SHA:t,
   medlemskapet och WIP-kontrakten ovan. Om main eller en PR-head flyttas:
   granska det nya deltat, bygg om vid behov och verifiera den nya kandidaten.
2. **Kör kandidatens egen CI.** Node 22, hela deterministiska sviten inklusive
   installerad Chromium, frontend-typecheck/test/build/dist-drift, Compose,
   imagebygge och source-catalog-migration. Förtroende får inte lånas från de
   äldre enskilda PR:ernas gröna checkar.
3. **Gör riktad runtime-acceptans på exakt fryst image.** Använd en ny ren
   checkout från den publicerade GitHub-headen och isolerade QA-volymer/portar.
   Behåll de äldre QA-/publika containrarna för jämförelse. Kör bara berörda
   fall nedan. Varken hela geografiska QA-program eller mer Pi-inventory behövs.
4. **Kontrollera deploy-kopplingen och landa kandidaten.** Workflow
   `deploy-self-hosted.yml` kan publicera/deploya efter grön main-CI om
   `PARRANDA_SELF_HOSTED_DEPLOY=enabled`. Denna sessions GitHub-behörighet gav
   403 för repository variables, så den aktuella variabeln är inte verifierad.
   Den behöver kontrolleras innan main-mergen för att rätt runtime ska ändras.
   Gör därefter en vanlig merge med matchning mot godkänt head-SHA; ta inte bort
   originalbrancher som används av arbetskataloger eller QA.
5. **Verifiera main och städa PR-grafen.** Hämta nya main, kontrollera att alla
   22 frysta PR-headar är ancestors och att main-CI är grön. Kontrollera vilka
   PR:er GitHub redan markerat mergade; stäng resterande absorberade PR:er med
   integrationslänk. Stäng #526/#529 som ersatta och #530/#535 som övergivna
   enligt tabellen. Lämna #501 som enda separat implementation från denna lista.

Detta ersätter vågplanen. Efter landning är main den nya integrationsbasen;
inga nya funktioner ska fortsätta staplas på den gamla integrationsgrenen.
Arkitekturarbetet `day_view_v1`, hooks och borttagning av `/:city` i #519:s
förslag är ett senare arbete, inte ett villkor för catch-up.

## Begränsad runtime-matris

| Fall | Vad som behöver observeras på nya headen |
| --- | --- |
| Vald fika + shopping idag efter morgonen | En starkt matchad fika med källstödd tillgänglighet i återstående dag behålls efter tidsankringen. Ordning, daypart och geometri hänger ihop; stängd/okänd fika ges inte påhittat tillgänglighetsbevis. Kör under verklig återstående öppettid. En kontrollerad klockreplay ska märkas som replay. |
| Uppsala och Ystad identitet/besök | Aktuell operatörsuppgift ska hindra en gammal eller fel typ av besökspunkt. Saknas punkten i leverantörssvaret är det inte ett observerat veto. De tidigare specifika punkterna är regressionsfall, inte krav på en namngiven vinnare. |
| Göteborg partiellt kallt utbud | Tillgängliga relevanta källrader får komponera inom ursprunglig Planner-budget; skilj cold och warm. Overpass/Overture-fel kan göra fallet INCONCLUSIVE och får inte bli ett fabricerat PASS eller onödigt förlängd Planner-budget. |
| Live #540/#541 | Vald dag/vecka och Near me/Near route/Whole area ska använda rätt datum, period och geometri. Kall källa får avsluta inom Live-budgeten; närliggande platser får inte dela fel cache. Live-byte ändrar inte Planner-dagen. |
| Lokal källupptäckt #541 | Där discovery är konfigurerat: web och worker på samma SHA, faktisk kö/claim/probe/review och en verklig godkänd källa som går att läsa. Äldre worker på `14ced72` är unhealthy i readback och kan inte certifiera detta. Ingen bulk-approval eller backdatering för att få ett positivt resultat. |
| Kombinerad UI | Verifiera mobilens kartkontroller/tappytor, Live-funktionerna och #527:s ändringsbesked/ångra i serverad build. Fixture-Chromium verifierar presentation, inte faktiska källor. |

Exportera SHA, image, vald lokal tid/datum, indata, källhälsa och råa utfall.
Använd PASS/FAIL/INCONCLUSIVE/NOT OBSERVED per fall. Health-SHA visar rätt
kodversion, inte produktacceptans. Anslutning från lokal miljö är
`ssh parranda-pi`; LAN-/SSH-åtkomst finns inte i denna Cloud Environment.

## Status för denna kandidat

Källintegration och medlemskontroll är verifierade. Den tidigare headen
`f15ef47` hade helt grön CI. Citypack-API-fixen ger en ny head som behöver egen
CI och blir Hermes runtime-mål. Aktuellt fullständigt SHA, CI-resultat och
överlämning finns i integrations-PR #543:s beskrivning; använd inte en äldre
handoff-head som acceptans för senare kod.
Exakt-head runtime-acceptans är ännu inte utförd. Main-merge, PR-stängningar
och publicering/deploy av en runtime är inte utförda.

Äldre handoff-dokument beskriver respektive historiskt head. Denna sekvens och
den nya integrations-PR:ens frysta SHA gäller för catch-up.
