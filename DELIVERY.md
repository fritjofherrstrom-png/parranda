# Avgränsad leverans: kompakt dag, platskort och tvåkällsavvägning

Produktgren: `codex/compact-days-place-cards-20261021`.
Bas och oförändrad publik release: `0643bc56202a8d1d552ea09e302a0bb0a1cd2aca`.
Sluthead: `8aa85a2ce6c554a633ae9a7d8c4e132fa0774319`.
Tree: `e1cbd8106dd48f20b29a8bb94fdcf69a7200044f`.
Status: lokalt verifierad kandidat med ren workingtree. Ingen push, merge, deploy eller ändrad källregel.

**Slutkontroll på exakt sluthead: 4912 PASS, 0 FAIL, 3 SKIP (4915 totalt).** Typkontroll, frontendbygge, distkontroll och self-hosted-konfigurationskontroll PASS. Oberoende review omfattar slutdiffen. Extern CI, Node22/Linuxarm64-Pi och publik acceptans av den här kandidaten är inte körda.

Fyra spårbara commits finns i `commits.txt`; full slutdiff i `final.diff`.

## Vad som ändras

- Modern rytm skickar inget kilometermål till seturvalet. Ett internt 6km-standardvärde får inte sträcka ut Relaxed. Explicita kilometermål och vanliga trust-, öppettids-, preferens- och gånggrindar behålls.
- Okända öppettider visas bara inne i den öppnade platsen. Känd stängning hålls separat och synlig.
- Kompakta redigeringskontroller, sekundära Maps-/webblänkar och källinformation i disclosure.
- Ett slutet, typkompatibelt `place_details`-kontrakt bevarar källkategori och källans filialadress genom identitetsförening, motor och publicering. Detta är korta kategorifakta, inte fritt genererade platsbeskrivningar, lageruppgifter, recensioner eller besökslöften. Äldre källcacher/sparade dagar utan fältet fungerar; ingen offentlig cache töms för att fylla fältet.

## Verifiering och gränser

RED/GREEN och riktade körningar finns i `rhythm/`, `cards/` och `place-details-*.log`.
Byggd frontend använder riktig lokal HTTP, riktiga handlers, båda rånormaliserarna och den faktiska kompositionsmotorn. Endast extern källa, platsresolver, väder och klocka är styrda. Ingen produkt-API-interception eller injicerad browserposition. Underlag och skärmbilder: `built-ui/receipt.json`.

Det byggda provet verifierar fritext, kompakt Relaxed med fyra stopp, Full med sex, Behåll genom vanlig reload, Ta bort med övriga identiteter kvar, Ångra och 390px-kort utan sidöverspill och med minst44px-kontroller. Ett första fel om pin-reload var ett fel i provets klockverktyg: full Playwright-clock tömde `PerformanceNavigationTiming`. Testet styr nu endast Date och verifierar riktig navigationstyp `reload`. Produktens reloadkod ändrades inte. De misslyckade observationerna ligger kvar som sådana i loggarna.

Lokal runtime: Node24.15.0/macOSarm64, Chromium153.0.8010.12. Detta är inte Node22/Linuxarm64-Pi-acceptans, fysisk Safari eller färsk provideracceptans.

## Källfrågan är inte löst av kort- eller motorfixen

Se `source-tradeoff/README.md`: sparade katalogposter kring Holešovice40→1 och centralt42→1 vid ett förenklat krav på två redan matchade familjer. Kartkopian är äldre och underliggande oberoende ursprung är inte styrkt; siffrorna är inte en aktuell komplett butikscensus eller publicerad rutt.

CestaDomů, RecycleStore och SueRyder är konkreta bortfall med positivt operatörsstöd. FlatService och HAVEX-auto visar motsägande verksamhetstyp. Ett tvåkällstal för existens bevisar inte rätt kategori eller att en filial är öppen. Permanent stängning av SecondhandPrague.cz är inte bevisad av denna avgränsade kontroll; en kvarvarande operatörssida bevisar inte heller motsatsen.

FlatServices exakta råtaxonomi är ännu inte återfångad. Londons kinesiska primärnamn har inget engelskt alternativ i den bevarade råposten; korrekt fysisk identitet och punkt är fortfarande osäkra. Ingen stadsspecifik namn-/koordinaträttning eller automatisk översättning har införts. Dessa fel ska inte uppfattas som rättade av den här kandidaten.

## Återkörning

Från motsvarande repo och sluthead:

```sh
npm test -- --test-reporter=tap
npm run check:frontend
npm run build:frontend
node scripts/check-frontend-dist-drift.js
npm run validate:self-hosted
node --require ./tests/helpers/no-live-network.js --test tests/compact-day-cards-http-browser.test.js
node source-tradeoff/REPRODUCE_OFFLINE.cjs /absolut/sökväg/till/repo
```

Offline-skriptet körs från evidenspaketet och läser dess sparade poster. Inga provider- eller delade cacheanrop sker. Testdatabas och live-nät är egna opt-in-gränser; skips redovisas separat i slutresultatet.

## Första fullvarvets fynd och slutkontroll

`full-suite.tap` gäller första head36a6:4908PASS/4FAIL/3SKIP. Två gamla källtextassertions krävde den nu avsiktligt borttagna dubbla öppettidspresentationen; de ersätts av redan tillagda starkare monterade och byggda beteendeprov. Testet för kontaminerade fält finns kvar. Det riktiga mobilprovet fann dessutom att Byt/Ta bort kunde brytas till olika rader; kontrollerna hålls nu ihop som en enhet och hela befintliga redigeringsresan passerar.

En desktophover på kartmarkör1 föll också (deltest och föräldratest räknas var för sig). Orsaken är fortfarande okänd. Kartkod, karttest, timeout och skips ändrades inte. Alla kartbredder passerade först i riktad körning och sedan i hela `full-suite-final.tap` på slutheadet. Detta är inte ett påstående om att ett intermittent kartfel är rättat.

`RESULTS.json` redovisar de tre skips separat: två opt-in-DuckDB/httpfs-nätprov och ett opt-in-PostgreSQLprov. Ingen av dem räknas som PASS. Ingen databas- eller nativbiblioteksimplementation ändras här.

## Leveransläge

Rekommendation: ta denna motor-/kortkandidat till gransknings-PR och exact-head-CI, före nytt releasebeslut. Behåll nuvarande källpolicy. Nästa källbeslut bör utgå från `source-tradeoff/README.md`, inte slå på en generell tvåkällsgrind utifrån ett enskilt missvisande förslag.
