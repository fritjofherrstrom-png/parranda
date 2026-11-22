# Forma dagen med intressen

Godkänd design för Parrandas Planner, 7 november 2026. Utgår från `main` på `c8cae52c`.

## Vad användaren ska kunna göra

Den som valt en plats kan beskriva vad den vill göra och få en dag som speglar kombinationen. Samma plats och datum ska till exempel kunna ge en fyndrunda med loppmarknad, second hand och fika eller en dag med parker, utsikt och bad. Dagens sammanfattning visar vilka val som fick plats. Intressena gäller den valda dagen.

## Val i första versionen

| Grupp | Intressen |
| --- | --- |
| Mat & fika | Restauranger, Frukost & brunch, Kaféer, Bagerier, Billig mat |
| Konst & historia | Konstmuseer, Historiska museer, Konstgallerier, Historiska platser |
| Ute & vid vattnet | Utsiktsplatser, Parker & trädgårdar, Vid vattnet, Badplatser |
| Marknader & fynd | Marknader, Loppmarknader, Second hand, Antikbutiker |
| Kväll & live | Vinbarer, Cocktailbarer, Bryggerier & öl, Livemusik |

Grupperna hjälper användaren hitta. Det är de enskilda intressena som påverkar dagen. Second hand är samma val oavsett var det visas. Kultur och övriga befintliga snabbval behåller sina betydelser, även i äldre sparade dagar och delade länkar.

## Hur det fungerar

**Justera → Intressen** visar snabbvalen och en ingång till **Alla intressen**. I det grupperade urvalet syns dagens aktuella intressen och går att ta bort. Användaren kan välja och ordna upp till sju intressen över grupperna. Det är samma tak som dagens delning använder. Det går att börja från ett tomt urval och att flytta ett valt intresse till första plats.

**Uppdatera dagen** skickar valen tillsammans. Användaren kan också stänga urvalet och återgå till sin tidigare dag. Det tidigare förslaget är tillgängligt medan det nya byggs. När ett svar kommer visar dagen vilka intressen som är med och vilka som saknas i förslaget. Val och ordning följer med när dagen sparas, delas eller återställs. Befintliga regler för datum, behållna och bortvalda stopp, öppettider och gångavstånd gäller.

Om inget valt intresse går att bekräfta i en genomförbar dag ligger föregående förslag kvar med en förklaring. Valen är redigerbara. När det saknas ett tidigare förslag visar Planner samma förklaring och en väg tillbaka till intressevalet.

Urvalet använder Planners befintliga Linje-stil, med samma struktur på mobil och dator. Valen har tydlig fokusmarkering, fungerar med tangentbord och får namn och status på svenska och engelska.

## Vad som räknas som träff

- **Frukost & brunch**, **Vinbarer** och **Cocktailbarer** kräver respektive källkategori. De typerna finns i den nuvarande Overture-mappningen. I dag går deras precision förlorad när de förs vidare som restaurang eller bar.
- **Konstmuseer**, **Historiska museer**, **Bagerier**, **Loppmarknader** och **Antikbutiker** kan använda de undertyper som redan följer med källans platsfakta. En saknad undertyp räknas som okänd.
- **Vid vattnet** utgår från källbelagda vattennära besöksplatser. **Badplatser** utgår från källans badklassning. Varken en hamn eller en strandpromenad räcker som belägg för bad.
- **Billig mat** använder den uttryckliga lägsta prisnivån från källan. En okänd prisnivå kan inte ge en budgetträff.
- **Livemusik** kräver en verifierbar spelning för valt datum. En spelning kan läggas in automatiskt när den uppfyller Planners ordinarie krav för ett Live-stopp. Om en spelning finns i Live men en dag inte går att komponera utifrån den visas spelningen i Live och Planner berättar att något dagsförslag inte kunde byggas kring den.

En kategori ändrar hur redan tillåtna kandidater prioriteras och vad som räknas som en träff. Den ger ingen plats högre källtillit. Vid gles täckning berättar Planner vad som fick plats i förslaget. Det lokala utbudet kan variera mellan platser och datum.

## Upplägg och leverans

En platt lista med alla val skulle göra allt synligt direkt men ge längre skanning på mobil. Dagstyper med färdiga kombinationer skulle ge en snabbare start men göra det svårare att förstå och justera varje val. Förslaget är grupperade flerval i den befintliga Planner-panelen. Det bygger vidare på önskemålet om ett brett urval och låter användaren kombinera fritt.

De fem grupperna levereras som ett sammanhållet lyft. Codex äger implementation och lokal verifiering från aktuell GitHub-main. Varje nytt intresse ska ha ett källformat testfall som matchar och ett närliggande fall som skiljs från det. Kontrollera att blandade val ger olika dagar från samma plats och datum, och att saknade träffar, äldre delningar och användarens befintliga dagval hanteras. Testa med tät och gles lokal data samt med verifierad och saknad livemusik. Verifiera även den byggda vyn på mobil och dator, inklusive att den nya dagen byggs först när valen tillämpas.
