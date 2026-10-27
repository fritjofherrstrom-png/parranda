# Parranda — gemensam arbetshistorik

## Produktspår bekräftat av Fritjof — 2026-10-27

- Fritjof återförde en diskussion från en försvunnen sidochatt: överväg en
  billig modell som förstärker motorn och hjälper Parranda att bli den avsedda
  produkten. Möjliga användningar är att hitta relevanta källor, förstå svårare
  källinnehåll och förbättra användarnas upplevelse.
- Bevara detta som ett öppet produktspår när källupptäckt, Live och motorns
  fortsatta utveckling diskuteras. De deterministiska förbättringarna av
  festivalprogram i PR #658 är en grund att bygga vidare på.
- Modell/provider, avgränsat användningsfall, kostnadstak och förväntad nytta
  återstår att utvärdera. Bekräftelsen gäller att överväga spåret; den innehåller
  inget nytt beslut om betaltjänst eller runtime-aktivering.
- Befintlig policy för källbelagda modelläsarfakta finns i `CODEX.md` och
  `docs/PARRANDA_ENGINE_GOALS.md`. Den aktuella festivalleveransen använder
  befintliga kostnadsfria källor; dess modelläsare förblir avstängd.

## Aktuell Live-kostnadsgräns — 2026-10-12

- Fritjof: inga nya betal-API:er, betald sökning eller modelläsaranrop nu.
  Målet är att motorn hittar aktuella källbelagda evenemang med befintlig egen
  SearXNG, kostnadsfria källor och deterministisk parsning.
- Codex rättar webbprocessens sökkonfiguration och platsuppslagens fördelning
  i befintlig draft #593; ingen ny PR-stack, merge eller Pi-deploy ingår.
- `PARRANDA_EVENT_READER=disabled` gäller detta runtime-prov. Aktivera inte
  betalläsaren som fallback. Äldre text om en möjlig billig modell är inte
  godkännande att använda den i detta arbete.
- GitHub main/PR-head och CI är auktoritativa; äldre MVP-snapshots nedan är
  historiska och fastställer inte den aktuella runtime-versionen.

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
