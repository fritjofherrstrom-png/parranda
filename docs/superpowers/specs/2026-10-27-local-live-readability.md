# Lokal källtäckning och läsbart Live

Fritjof har bett oss fortsätta efter riktig deploy/Borrby-kontroll och rätta den
röriga formatteringen i sina screenshots, särskilt ”DAGAR ENLIGT KÄLLAN”.
Ägare/integration/runtime-QA: Codex. Bas main/release c6d85fcd. Egen UI-PR mot main.
Källupptäckten och modellpiloten fortsätter i den separat återupptagna chatten;
denna leverans ändrar presentationen av redan källbelagda händelser.

## Verifierat nuläge

Borrbys riktiga sjudagarsfråga använder två regionala kalendrar, en helgdagskälla
och Ticketmaster. Ingen request-time discovery sker; programme-rader i svaret
är noll. De två breda kalenderkällornas publishers/families uppfyller nuvarande
diversitetsgräns. Sparad HTTP-evidens och skärmbilder finns utanför repo i
parranda-event-discovery-evidence-20261027/release-pr658.

Datum, tider, namn, rå platssträng, geografisk osäkerhet och långa källnamn
visas nu som en sammanhängande textrad. Periodens osäkra dagar hamnar i versal
blå tidsrubrik. Vissa platssträngar innehåller dessutom telefon och e-post.

## Beslut och leverans

- Visa varje Live-händelse med tydlig hierarki mellan titel, tid, plats och
  källinformation. Normal läsbar text ersätter långa versala tidsrader.
- Perioder behåller sina observerade datum/tider och en kort begriplig separat
  förklaring att aktuella dagar/tider behöver kontrolleras hos arrangören.
  Ett datumspann får inte förvandlas till en daglig eller exakt återkomstregel.
- Platsen är en egen rad. Uppenbara telefon-/e-postsuffix kan utelämnas från
  platsvisningen med originalet bevarat i data. Inga nya platsfakta härleds.
- Källänkens faktiska destination, upphov/attribution, licenskrav, ungefärlig
  plats, obekräftade tillfällen och programme-kontext förblir tillgängliga och
  tydliga. Förkorta utan att märka en annan länk som om den gick till utgivaren.
- Samma information ska vara begriplig i Live-kort, sheet och andra ytor som
  visar periodtider. EN/SV fungerar och kalender-/datum-/tidszonfakta bevaras.

## Verifiering

Monterade UI-fall baserade på Borrby-exemplen, period kontra daily/occurrences,
attribution/destinationslänk, mobil radbrytning och dolda kontaktdata. Rebuild av
frontend/dist, oberoende helhetsreview och CI. Därefter kontrollerad deploy och
nya riktiga screenshots; inga injicerade event eller manuella program-seeds.

Modellpilotens användarunderlag är bevarat separat. Inga modell-API:er eller
betaltjänster aktiveras i dessa två fixar.
