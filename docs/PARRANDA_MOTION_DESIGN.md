# Motion i Parranda

Rörelse ska göra väntan begriplig utan att göra en lugn promenadplanerare hetsig.
Detta dokument bevarar Fritjofs accepterade riktning från simulatorproven och
underlaget `parranda-motion-design.md`, implementerad genom #637 och #639.

## Gemensamt språk

- Återanvänd **RingMark**, den lilla ringen som ritar sig själv, för arbete.
- Låt ordmärkets ring stå stilla. Lägg inte till en vandrande figur eller ett
  andra konkurrerande arbetsmotiv.
- Laddningsskeletonens staplar delar en långsam sheen; stationerna andas i en
  mjuk våg. Ingen blinkande hel yta och inga ember-stationer som tänds i tur.
- Behåll det godkända lugna tempot: 2,4 s ritning och 2,8 s skeletoncykel med
  ease-in-out. Ringens långsamma 4,8 s rotation och ruttens wash med vila är
  sekundära delar av samma godkända uttryck.
- Använd motion-safe. Vid reducerad rörelse är arbetsringar, sheen, stationsvåg
  och ruttens wash stilla; statusorden finns kvar.
- Håll högst en prominent rörelse i den synliga vyn. Små statusringar och lugna
  bakgrundsaccenters faktiska samspel ska bedömas i vyn, inte bara räknas i DOM.
- Lägg status i dokumentflödet där läsaren arbetar. Ingen flytande pill eller
  toast över Justera-kontrollerna och ingen extra framgångstoast.

## Laddning och ombyggnad

- På telefon följer laddningsformen dagens ordning: kompakt rubrik → kartans
  låga översikt → fakta → stopp. Översikten står still (ingen panorering eller
  zoom) tills den förstoras, så den fångar aldrig tummen som skrollar. På bred
  skärm hålls kartans andra kolumn redan under laddningen.
- Vid ombyggnad behålls den tidigare dagen synligt, men markeras som inte
  aktuell. Justera-panelen visar arbete och därefter resultat eller fel.
- Ett nytt val som ännu inte besvarats är inte bevisat saknat i den gamla dagen.
  Aktivt arbete får visa ”letar platser”; efter fel eller avbrott upphör dess
  arbetsring och valet är neutralt ”ännu inte bedömt”.
- Förändringsraden med Ångra beskriver det faktiskt publicerade resultatet.
  Markera nytillkomna stopp med samma plats-/förekomstidentitet som jämförelsen,
  aldrig enbart med namnet.
- Ett uttryckligt källomtag använder den befintliga frusna frågan, single-flight
  och Ångra. Statusen får inte innebära automatisk bakgrundshämtning.

Visa en snabb mock eller simulatorvariant före nya visuellt djärva rörelser.
Redan accepterade rörelseval ska inte startas om som en ny designutforskning.
