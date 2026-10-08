# Parranda — gemensam arbetshistorik

## Aktuellt uppdrag

- 2026-10-08: Fritjof bad att läsa senaste repo/staging bf91fa9 och starta
  utifrån fyra arbetsmallar. Arbetsantagande: repoankrad MVP-research och setup.
- Dokumentägare: Codex. Gren: `codex/parranda-mvp-readiness` från GitHub main
  `4b55cb091256e27a793f5c849f1c52b48c896ace`.
- Granskat runtime-head: `bf91fa9eccac3345b8c49c9eed507c19f62c4ed7`, draft #569,
  exakt-SHA health och GitHub CI SUCCESS. Ingen ny dag-/kallstart-/telefon-QA.
- Befintligt PRD bevaras i `docs/mvp-readiness/PRD-Parranda-MVP-bf91fa9.md`.
  Teknisk design är ett reviewutkast. Main saknar ännu kandidatens integration.

## Beslut och gränser

- Bevara AGENTS.md:s leveransregler. Arbetsmallar och exempel utvidgar inte scope.
- Ingen ny runtime-implementation, merge, deployment, tjänst eller betalning.
- Budget, last, lanseringsmarknad/datum och produktacceptans är öppna.
- Ingen ny agentkonfiguration, skillinstallation eller verktygsadapter behövs.
- Rekommenderat nästa kapabilitetssteg: kalla första kärnresan, följt av minsta
  reproducerade fix; inget nytt providerfel eller kompositionsfel är bevisat här.

## Status

- [x] Main/kandidat/CI och staging health avstämda.
- [x] Begränsad research med primärkällor; begränsningar redovisade.
- [x] Befintligt PRD bevarat och tekniskt underlag skrivet som utkast.
- [x] Gemensamma agentunderlag skapade för review.
- [x] Dokumentkontroll: paths/länkar, JSON och manifests stämmer; gamla AGENTS-
  regler bevarade; PRD är byte-identisk med kandidatbloben. Appchecks inte omkörda.
- [ ] Produktavstämning och lanseringsbeslut.
- [ ] Oberoende review/landingbeslut för runtime #569.
- [ ] Isolerad kalla-kärnresan-QA på vald exakt SHA/image.
- [ ] Fysisk Safari/Maps-acceptans och publik lansering.

## Nästa handling och ägare

Codex lämnar granskbara dokument; Fritjof kan korrigera arbetsantagande och
prioritet. Enligt #569:s body äger Jean Bob dess runtime-QA. Inget nytt uppdrag
har skickats till den ägaren. Vid fortsatt arbete: läs aktuell GitHub main,
heads/CI och dokument-PR, inte denna daterade snapshot som releasebevis.
Se `docs/research-Parranda.md` för exakt ancestryinventering och evidensgräns.

## Fortsättning 2026-10-08 — discovery från betrodda punktplatser

Fritjof har därefter uttryckligen bett att starta den prioriterade implementationen. Tidigare dokument-only-gräns ovan beskriver det tidigare uppdraget. PR #572 har nu landat525606d inklusive #563–570; main759ca8d är bas för integrationen i PR #571 (`codex/trusted-point-discovery`, Codex äger implementation/integration och deterministic QA).

Separat privat lokal discovery-aperture låter en betrodd punktplats utan provider-bounds köa källsökning. Planner/Live behåller rutt/helplats-geografin. Signerade v2-kvitton bevarar invalid-bounds-state; v1 behåller identiteten men ett boundsfritt gammalt kvitto måste förnyas för ny aperture. Geocoder cache-v6 bevarar stagingens context-aware identity och undviker gamla förlorade bounds-state; inga gamla filer tas bort.

218 berörda deterministic tests PASS med extern nätverkstrafik blockerad. Publik runtime525606d saknar denna nya fix. Ingen merge/deployment av #571; ingen latens-, rikare-dag- eller workeracceptans. Slutreview och aktuell kandidat-CI behövs före landingbeslut. Exakta aktuella SHA/evidens hålls i #571 body, inte i denna daterade historik.
