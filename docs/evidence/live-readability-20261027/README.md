# Läsbart Live — 2026-10-27

Användarens riktiga Borrby-bilder visade versala tidsrader med ”DAGAR ENLIGT
KÄLLAN” och en lång sammanhängande titel/plats/utgivare/länk. Denna UI-ändring
ger händelserna en gemensam läsordning: titel, tid, plats och källinformation.

- Datum och klockslag visas i normal text. En period behåller sina observerade
  gränser och lokala klockslag; dess osäkra sessionsdagar förklaras separat med
  ”Se aktuella dagar och tider hos arrangören.” Den blir aldrig ett dagligt schema.
- Samma tidskomponent används i Live-kort, sheet, utvecklade tillfällen,
  ruttstopp och Blitz. Programmets observerade datumspann har ingen påhittad
  återkomst- eller heldagsuppgift.
- Bara tydliga telefon-/e-postsuffix utelämnas från platsvisningen. Ursprungliga
  händelseobjekt, platsnamn/adresser och sparade dagar ändras inte.
- Länkens faktiska destination och obligatorisk attribution förblir synliga.
  Hela kalendernamnet finns under Källinformation. Ungefärlig plats,
  obekräftat återkommande tillfälle och helgdags-/programuppgifter består.

## Evidens

Ursprunglig bas: main/release c6d85fcd. Integrerad main: df7d82a (#659).
Ingen backend, källpolicy, modellaktivering eller ny dependency i denna ändring.
Källupptäckt och modellpilot ägs av den separata lokala research-chatten.

- Monterade EN/SV- och tidskontroller: 171 PASS, 0 FAIL. De nya regressionsfallen
  kördes först RED (8 fall, sedan 4 för de kvarvarande tidskonsumenterna).
- Riktig Chromium-rendering vid 320/390/430 px: 10 PASS, 0 FAIL. Kontrollerar
  normal text, läsordning, kontaktstädning, synlig osäkerhet/attribution,
  källdisclosure samt befintliga klock-/kalender-/sheet-kontrakt.
- Efter integration med #659: 156 berörda frontendkontroller PASS. Typecheck
  upptäckte en nullable distance-prop; en ren typkorrigering ger därefter PASS.
- Frontendbygget passerar. De tio browserkontrollerna passerar även med den
  nya byggda CSS:en. Detta är kontrollerad renderingevidens, inte ett påstående
  om källupptäckt eller driftsatt UI.

Oberoende helhetsreview hittade ett kontaktstädningsfall som kunde dölja en
adress efter ett telefonnummer eller en e-postadress. Två monterade EN/SV-
regressioner reproducerade felet RED; städningen kräver nu ett slutet suffix
av enbart kontakter. Slutliga berörda kontroller: 173 PASS. Typecheck och
frontendbygge passerar efter fixen. Se INDEPENDENT_REVIEW.md för den frysta
granskningen; den beskrivna P2-punkten är rättad i den efterföljande fixen.

Exakt-head CI, deployment och nya riktiga Borrby-bilder redovisas med sina
respektive revisioner i PR:ens handoff. Lokala rapporter,
RED/GREEN-loggar och tidigare riktiga Borrby-svar/bilder bevaras i projektets
syskonkatalog parranda-event-discovery-evidence-20261027/.

## Kvarvarande separat källglapp

Det första driftprovet på #658 visade befintliga kalenderhändelser men inga
officiella programme-rader. Två breda regionala utgivare räknades som lokal
källmix och stoppade fortsatt discovery. Denna formatteringsändring löser
presentationen; den separata källfixen behöver egen regression och acceptance.
