# Oberoende kodreview

Bas: `dad368233963b7766afb532339cbabc7ac2e8fb1`.
Review genomförd av separat läsande Codex-agent över den kombinerade diffen,
inklusive nya filer. Agenten gjorde inga produktändringar. Slutligt head/tree
och fullsvit anges i PR:n efter commit; detta dokument är inte ett mergebeslut.

## Fångade och åtgärdade fynd

1. Readiness använde först hela kalenderdagen medan kompositionen använde den
   återstående betrodda lokala dagen. Morgonöppna platser kunde felaktigt avsluta
   väntan. Reproducerat RED, rättat med samma lokala tidsfönster/reach och riktig
   context-resolver. Identiska väderanrop delas; aktuell klocka läses på nytt.
2. Operatörsbelägg tillfördes efter readiness. Riktig lokal HTTP-reproduktion
   visade terminalt 200 utan rutt medan directory-jobbet fortfarande pågick,
   eftersom berikningen lade till stängningar som underkände alla råkandidater.
   Rättat genom bedömning av faktiskt berikat snapshot. Nytt HTTP RED→GREEN
   använder riktig operatörsparsing av styrd käll-HTML, inte enbart påhittad
   ready-flagga. Samma producent levererar sedan fem relevanta stopp.
3. Den första rättningen kunde berika den frysta snapshotkopian en andra gång.
   Ett befintligt diskriminerande test fångade `enrich=2` mot kontraktets `1`.
   Den frysta kopian markeras nu som redan berikad. Den riktiga operatörskontrollen
   har dessutom en serialiserad requestsession med högst fyra identiteter och
   ursprunglig sexsekundersbudget, även för misslyckade/oklara sidförsök.

4. Roots sista UI-kontroll reproducerade primärkällfel med lyckade
   bakgrundsjobb (`complete/failed=0`). Reviewern granskade tillägget som läser
   befintligt `source_status.error` och bevarar historisk feltext, manuell retry
   och den publicerade dagen. Inga källräknare, metadata eller återförsök ändras.
   Sv/en RED→GREEN samt ett publicerad-dag-fall tillkom. Frisk kontroll har null
   error; a11y-kontrollen kräver inte längre ett bristpåstående efter källfel.

## Slutlig delta-bedömning

Reviewern rapporterade inga kvarstående konkreta fynd efter rättningarna.
Riktad kontroll: befintligt memoiseringstest och de två nya sessionsgränsproven
passerade 3/3. URL/namn/adress binder operatörsfakta till rätt identitet; tomma
partialsnapshot startar inte operatörsbudgeten. Sena svar/avbrott får inte
återstarta snapshot-timers eller ersätta ett publicerat svar.

Övrig genomläst yta: per-medlems canonical matchning, server-only candidateSurface,
bevarad default/micro-base-policy, partial kontra strong, historisk källtext,
manuell same-date recovery, async cancellation/generation och vädermemoisering.
Olika verkliga micro-base-koordinater kan kräva olika väderkontext; det är inte
retry av samma providerbegäran. Ingen verklig publik provideracceptans utfördes.

Draft-PR är möjlig efter roots återstående slutkontroller. Historiska
provider-/cacheorsaker och de två objektens råklassning är fortsatt INCONCLUSIVE.
