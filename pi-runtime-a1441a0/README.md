# PR631 — avgränsad Pi-verifiering

**PASS med styrda källor/klocka. Ingen merge eller deploy.**

- Kandidat: `a1441a0c73d556959e02fa7bcd0db5c6fc69371a`.
- Tree: `67b01048ad1a33229cd75982fe46c21da831ed21`.
- Bas och fortsatt publik version: `0643bc56202a8d1d552ea09e302a0bb0a1cd2aca`.
- Immutable image-ID/digest: `sha256:018fefa843ff46181a1d0fd809079e3c225622c41ebd9cb9e8179a0294f2d757`.
- Node **22.23.4/Linux/arm64**. CI använde Node22.23.3/Linux/x64; tidigare lokal verifiering Node24.15.0/macOSarm64. Browsern körs på Macen via egen SSH-loopback, backend/built UI kommer från imagen på Pi:n.
- Imagekontroll: rätt SHA/revision/arkitektur, native DuckDB PASS; alla282 kontrollerade runtimefiler och samtliga12 distfiler matchar kandidaten. Enda tolerans: redan dokumenterad Astro-island-uid-normalisering i HTML.

## Vad provet visade

Byggd frontend → riktig HTTP/middleware/handlers på Pi:n → bildens riktiga OSM-/Overture-normaliserare och kompositionsmotor. Endast råkällor, platsresolver, väder och datum är styrda. Ingen produkt-API-interception eller browserinjektion av koordinater.

En vanlig fritextinmatning gav Relaxed4 relevanta stopp/0,3km och Full6 relevanta stopp/7km i samma kontrollerade utbud. Platskortet visade begränsad källkategori/adress och okända tider endast inne i öppnad plats. Mobil390px utan sidöverspill, kontroller≥44px. Behåll bestod genom omkomposition och verklig vanlig reload; Ta bort behöll de övriga identiteterna; Ångra återställde utan nytt compose-anrop. Inga browser-JavaScript-fel eller oväntade backend-utrop registrerades. Slutligt observerprov1PASS/0FAIL/0SKIP, cirka6sekunder.

Detta är inte en universell garanti för dessa avstånd/stoppantal. Det är inte färsk provideracceptans, bekräftade öppettider, verklig gångvägs-/WebGL-acceptans eller fysisk Safari. Denna avgränsade Pi-resa certifierar inte ny Live-providerinsamling; befintlig Live-val/reload-evidens från riktade HTTP-browserprov och grön exact-head-CI behåller sin tidigare scope.

## Bevarad publik yta och rollback

Publik `/api/health` återläst före/efter:ok och0643bc5. Web/worker-identiteter, image, full konfigurationsdigest och restartcount är oförändrade; reader uttryckligen avstängd i båda. DB/search/tunnel och volymkonfiguration matchar de privata originalsnapshotarna på Pi:n. Inga delade volymer monterades i provcontainern; ingen publik paus, cachetömning eller källregeländring gjordes.

QA-containern, dess interna nät och den egna SSH-forwarden är borttagna, exit0. Kandidatimage och konkret rollbacktagg `parranda-rollback:pr631-0643bc5-20261021` bevaras. Rollback-image är den fortfarande publika `sha256:31397e3a76e7e7a9a2efedbb3e05744176adce6f58b591281b675830614b884d`; originalkonfiguration finns privat och publiceras inte.

## Avvikelser — bevarad evidens

Pi-disken hade1,7GiB ledigt. Enbart oanvänd byggcache rensades: första försök0B, en avgränsad fallback äldre än24h med4GB kvar frigjorde5,999GB. Inga images/containrar/volymer prunades. Efter bygge/prov återstod4,5GiB; skyddade resurser är oförändrade.

Första imagebygget föll i esbuild-installation med `ETXTBSY`. Ett enda nytt byggförsök med samma arkiv/parametrar passerade. Senare PASS bevisar inte den bakomliggande filsystemorsaken; båda loggarna bevaras. Nodebasen löstes till22.23.4; inga paketmanifest eller låsfiler ändrades. Npm-auditvarningarna följer samma låsta beroendegraf som basen och ingår i byggloggen; ingen automatisk audit-fix kördes och ingen ny generell säkerhetsattestation görs.

Första browserförsöket avbröts av en felaktig relativ import i det flyttade externa provverktyget, före reload. Endast observersökvägen rättades till samma kandidat-repo. Samma image och oförändrade produktassertions/tidsgränser användes vid det fulla PASS-försöket. Första misslyckade loggen behålls separat; fel-HTML och felbilder publiceras inte.

## Rekommendation

Inga nya bekräftade produktblockerare hittades i denna avgränsade runtimekontroll. Rekommenderat nästa steg är separat godkännande av normal ancestry-bevarande merge av PR631 och kontrollerad deploy till befintlig publik QA, med omedelbar head/main/CI/deployment-gate-kontroll, identiskt merge-träd, grön main-CI och bevarad rollback. Detta underlag är inte självt ett releasegodkännande. Katalogklassning/filialstatus/namnfel kvarstår dokumenterade; inget tvåkällskrav införs.
