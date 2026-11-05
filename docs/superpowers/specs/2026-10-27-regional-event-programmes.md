# Regionala festivalprogram

Användaren har valt festival som lokal kontext tillsammans med dess lokala
programpunkter. Österlen lyser är ett testfall, aldrig en specialregel.

## Verifierad orsak

Main cf18a576 hittar länken till årets program, men de två sparade originalsidorna
ger noll eventmanifest. Programadaptern förstår varken dagrubrikerna 30/10,
31/10 och 1/11 eller dokumentets programstruktur. I aktuell drift är sökning och
worker aktiva, modelläsaren avstängd och områdets aktuella scoutmål saknas.
Direktdiscovery kompletterar dessutom inte en ensam befintlig lokal kalender.

## Första leverans

- Läs en strikt synlig struktur: explicit programtitel och år, datumrubrik,
  ortsrubrik och klockslag med kort radtitel före första radbrytningen.
  År och datum hämtas ur samma programstruktur, aldrig ur bildnamn, URL-ankare,
  bokningsdeadline eller arkivlänk. Kontrollerade numeriska dag/månad-rubriker
  får användas tillsammans med det uttryckliga programåret.
- Behåll programmets titel, källsida och observerade datumomfång som `programme`
  på varje accepterad programpunkt. Visa sammanhanget i Live. Datumomfånget
  beskriver de lästa programpunkterna, aldrig kontinuerliga öppettider.
- Bevara ort och radens faktiska namn tillsammans vid platsuppslag. En ort
  blir ingen påhittad evenemangskoordinat. Befintliga venue/trust/robots/
  datum/geografigränser och Pulse-only för nya källor består.
- Distinkta programpunkter på samma samlingssida måste ha egna stabila
  förekomstidentiteter, även när titel och starttid är lika på olika orter.
- Låt direktdiscovery komplettera en tunn lokal källmix inom befintlig budget
  och cache. En redan svarande kalender är inte fullständig lokal täckning.
- Prioritera exakt match mellan programmets angivna ort och serverns betrodda
  locality inom samma aktiva period när den befintliga platsuppslagsbudgeten
  fördelas. Matchningen är ingen koordinat eller tillitsuppgradering.
- Nya resultat använder separat cacheversion så att äldre tomma/smala svar
  inte kringgår förbättringen. Gamla cachefiler behåller sin ursprungliga ålder.

Ingen ny betaltjänst, modellaktivering, ortslista, schemaläggningstjänst,
ändrad källpolicy eller automatisk ruttinsättning ingår. Enbart PDF/affisch,
fri prosa utan säker struktur och fristående regional festival utan en
accepterad lokal programpunkt är kvarvarande format-/presentationsluckor.

## Acceptans

Offline originalreplay måste hitta en riktig programkälla och datumkorrekta
rader från alla tre dagarna. En orelaterad programfixture måste också fungera.
Negativa fall: saknat år/datum, gammal årgång i aktuell period, felaktigt datum,
deadline i brödtext, skilda orter vid samma tid, okänd geografi och robotsblock.
Verifiera hela scout → probation → collection → normalisering → Live-vägen
med kontrollerade externa gränser. Runtime/discovery från riktig sökmotor
bevisas separat; parserreplay är inte komplett eventtäckning.

Ägare/integration: Codex. Oberoende kodreview före PR. Bas: cf18a576.
Target: main via egen PR; merge/deploy samordnas separat med pågående release.
