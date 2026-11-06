# Lägg till en plats i min dag

Status: konkretisering av förslaget som Fritjof godkände med ”ok kör” den 6 november 2026. Genomförandeplanen behöver granskas innan produktkod ändras enligt writing-plans-färdigheten.

## Nytta och scope

Under den befintliga Linje-vyn finns ”Vad vill du lägga till?” med exempel ”Sök en plats, indiskt, second hand…”. Personen söker antingen ett namn eller ett önskemål och väljer en riktig källstödd plats i dagens område. En förhandsvisning visar den ändrade stoppordningen och skillnaden i uppskattad gångtid. Först ”Lägg till i dagen” eller ”Ersätt [valt matstopp]” tillämpar ändringen. Avbryt lämnar den visade dagen orörd. Ångra återställer exakt föregående svar utan ny komposition.

Sökningen gäller den befintliga källreservoaren kring dagens betrodda ankare, inte hela världen. Resultatet säger att inga matchande platser hittades i det sökta underlaget när så är fallet. Det får inte påstå att platsen inte finns. Ett känt namn kan saknas i underlaget. Ny global sökprovider, betaltjänst eller en öppen modellchatt ingår inte.

”Bygg resten av dagen runt den här” före första generering och löftet om en sluttid är följande separata steg; denna leverans skapar platsvalet och det uttryckliga åtagandet i en befintlig dag. Den får inte marknadsföras som färdig tidsplanering.

## Beteende

- Sökning skickas uttryckligen med formulär/Enter, aldrig provideranrop för varje tangenttryckning. Högst 80 tecken och 6 resultat.
- Namn och tillgänglig källägd adress kan sökas. Generiska typer och en sluten synonymordlista används för önskemål. Kökstyp får matcha endast explicit OSM-cuisine eller en granskad motsvarande primärkategori hos Overture. Namnet ”India…” är inte belägg för kökstyp. Ostödda önskemål ger ärligt tomt resultat.
- Visa namn, begriplig typ, tillgänglig adress, matchning och källbelagda öppettider eller ”Öppettider okända”. Visa samma begränsningar som övriga stopp. Aldrig ”öppet nu” från kategori, träff i text eller enbart öppet någon gång under dagen.
- Ett matresultat kan läggas till eller ersätta ett uttryckligen valt befintligt matstopp. Ingen automatisk ersättning eller borttagning. Ett Behåll-markerat stopp kan inte ersättas utan att användaren först släppt det.
- Datum, betrott ankare, intressen, uttryckliga Behåll och bortval består. Vid tillägg består befintliga stopp; vid ersättning består alla utom det valda stoppet. Ny ordning och gångdata publiceras tillsammans efter ordinarie gångkontroll. En sexstoppsdag erbjuder ersättning eller en tydlig kapacitetsgräns, inte ett dolt bortfall.
- Förhandsvisning är preliminär tillämpningsmässigt men bygger på ett verkligt serverberäknat resultat. Ingen påhittad extragång eller lokal DOM-insättning. Ett vägrat/utgånget/avbrutet försök lämnar originaldagen och dess sparade senaste-version intakta.
- Förhandsvisningen blir ogiltig vid ändrad plats, datum, intressen, stoppval, återställning eller navigering. Sena svar kan inte återöppna en gammal sökning eller installera en gammal dag.
- Positionsdagar använder endast sessionens redan uttryckligen godkända position. Sparade eller delade positioner ger ingen ny positionsbehörighet. Befintliga krav på återbyggnad och integritetsgrindar består.
- Spara, återöppna, språkbyte, URL-intent och exakt delning bevarar den accepterade ändringen. Sökfrågor och tillfälliga resultatlistor är inte sparade dagfakta.

## Arkitektur och övervägda vägar

1. Ett rent filter över de redan synliga avstickarna vore litet men skulle missa de platser denna funktion ska kunna hitta. Det avvisas som huvudlösning.
2. Befintlig betrodd källa → gemensam kandidatryggrad → serverfiltrerad sökning → samma composer och gånggrindar väljs. Nytt önskemål blir en fråga; det får aldrig bli offentlig kandidatdata som servern litar på.
3. En fristående extern fritext-/AI-provider med manuellt insatta kartpunkter avvisas här: den inför nya kostnads-, tillits- och geometrianledningar utan att behövas för första versionen.

Sökningen levereras som en uttrycklig opt-in på den befintliga planner-förfrågan, så dess ankare, datum, källa, timeout och cancellation återanvänds. Ingen ytterligare crawler eller provider aktiveras. Källägda sökfacetter måste bevaras genom normalisering, identitetsavstämning och källa-cache utan att påverka tillit eller vanlig rangordning. Resultat projiceras genom en sluten säker DTO, inte råa providerposter.

Manual day edit utökas med ett uttryckligt tillägg och exakt vald ersättningsidentitet. Servern löser alla ID:n mot egna aktuella, behöriga kandidater. Ett tidigare sökresultat är inte en garanti att kandidaten fortfarande kan läggas till. Bekräftelse gäller den redan beräknade förhandsvisningens generation; ingen ny dold komposition körs då.

## Leverans och verifiering

Ägare: Codex i denna chatt. Gren `codex/add-place-search-20261106`, bas GitHub main `f3f429e4c5c3b7832ae27956ab85f988346fb47e`. Befintlig Linje-layout, tokens och komponenter är visuell auktoritet. Inga nya beroenden. Defaultförfrågningar utan ny sök-/redigeringsavsikt behåller sitt beteende. Eventuell kontraktsutökning levereras med kod och tester.

Deterministiska källa-/API-/monterade UI-prov ska täcka faktamatchning, injektionsförsök, exakt kandidatbyte, Behåll/bortval, okända/stängda timmar, gångvägran, datumgränser, sena svar, Avbryt, Ångra och roundtrip. Typecheck, frontendbuild och dist-kontroll krävs. En lokal mobil/desktop-kontroll använder fixture-server; det är inte bevis på verklig lokal källtäckning eller Safari. Ingen merge eller driftaktivering ingår i denna förberedda featureleverans.
