# Blitz: ett förslag, öppettid och möjlighet att besöka

Avgränsad korrigering från main `7fb8c10cf3a47dd8ddedf2deb3a3314fc30c322c`.
Ägare: Codex, gren `codex/blitz-now-usability-20261016`.
Ingen ändring av Planner, gångbudget, rytm, källinsamling eller source trust.

## Observation och belagd grundorsak

I den sparade qa606/run1-körningen svarade `/api/blitz` den 16 oktober 2026
klockan 00:38 Stockholm med `status: available`, Museum Tre Kronor av typen
`museum` och `time_band: late`. Kortet sade ”Ett källstött nästa drag utifrån
platsen, tiden och dina val”. API och kort saknade öppettidsbedömning.
Väderpoängen `rain_favors_indoor` gynnade den inomhusklassade museumtypen.
Inget i svaret beskrev eller belade en utomhusaktivitet vid museet.

Detta bevisar ett publicerings-/presentationsfel, inte att museet faktiskt var
stängt. Den interna käll-/cacheposten med eventuella timmar fångades inte.
Även kända timmar försvann i samma formattering. Identitet och kontext i
`tests/fixtures/blitz-now-observation.json` är trimmade från det observerade
svaret; testernas öppettider är separata, uttryckligen styrda kontroller.

Den verkliga kedjan är:

1. Betrodd loader → external-open-provider → normaliserad kandidat.
2. Betrodd lokal tid → Blitz fönster för den aktuella minuten.
3. Befintlig opening-hours-bedömning och candidate-pool: känt stängt utesluts,
   källans öppet-schema prioriteras inom samma intressetäckning, okänt tillåts
   som obekräftat alternativ.
4. `blitz-candidate-mode.formatMove` tappade bedömningen. Nu publiceras dess
   begränsade `availability.status` och `reason`, utan rått öppettidsschema.
5. `anywhereBlitzView` och `BlitzCard` visar skillnaden även för reservvalet.

## Bevarad policy och precisionsgräns

`status: available` betyder att API:t hittade ett tillåtet förslag. Det är
varken ett påstående om en öppen verksamhet eller bevis för att ett besök kan
genomföras nu. `available_in_window` betyder endast att det stödda källschemat
överlappar kontrollminuten i den betrodda lokala zonen. Det bevisar inte färska
driftförhållanden, inträde, lediga platser, sista insläpp eller öppet vid ankomst.
Kortet säger därför ”Källans schema anger öppet vid kontrollen” och ber
användaren kontrollera att hen hinner fram.

`unknown` betyder att öppet vid kontrollen inte kan bekräftas. Saknad/ostödd
information och saknad betrodd lokal tid uppgraderas inte. Äldre API-svar utan
bedömning behandlas likadant i vyn. Kortet kallar resultatet ett platsförslag,
visar osäkerheten uttryckligen och ber användaren kontrollera öppettider.
Live-event behåller sin separata källtidsvisning och får ingen verksamhetsbadge.

Ingen ny antagningspolicy införs. Att kräva bekräftade timmar för alla
inomhusförslag skulle vara en separat produkt-/truständring: det kan ge mer
användbara garanterat tidsbedömda förslag men också blockera genuina platser
vars timmar saknas eller inte stöds av parsern. Den avvägningen är inte löst
genom att kalla okänt stängt eller hitta på en utomhusaktivitet.

## Verifiering och scope

`tests/blitz-now-availability.test.js` provar verklig normalisering, grindar,
rangordning och publicering: känt stängt, okänt, nattöppet över midnatt,
uttryckligt kartlagd utsiktsplats med 24/7-belägg, okända utomhustimmar,
reservval, okänd zon och avvisning av publikt injicerade timmar via riktig HTTP.
En museikandidat med känt stängt räddas inte av taggen `outdoor`.

`frontend/tests/blitz-availability-http-browser.test.mjs` använder riktig
BlitzCard/view i native Chromium och riktig buildApp-HTTP med middleware.
Endast loader, klocka och väder styrs. SV/EN kontrolleras för okänt och
källbelagt nattöppet samt osäkert reservval. Inga produkt-API-svar ersätts.
Detta är kontrollerad kontraktsverifiering, inte färsk provider-/publik acceptans
och inte ett bevis på Museum Tre Kronors verkliga öppettider.

Positionssamtycke, reload, pin/exclusion, Fortsätt och separata Blitz-felorsaker
från PR606 omfattas av befintliga riktade regressioner. Den läsande kontrollen
av qa606:s långa Lagom-etapper ändrar ingen gångpolicy och redovisas separat.
