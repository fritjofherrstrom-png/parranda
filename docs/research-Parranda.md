# Parranda — repoankrad MVP-research

**Research status: Partial research.** Kontrollerad 2026-10-08 genom GitHub,
repo, staging health/landing och ett begränsat urval officiella webbkällor.
Ingen användarintervju, betalningsviljestudie, komplett konkurrensanalys eller
ny kallstarts-/telefonacceptans har utförts. Detta är faktiska preliminära
fynd, inte Part 1:s researchbeställning.

## Uppdrag och källgräns

Användaren bad att läsa senaste Parranda, kandidaten `bf91fa9` och dess staging,
och sätta igång utifrån fyra bifogade arbetsmallar. Arbetsantagandet är att
tillämpa research → befintligt PRD → teknisk design → agentunderlag på befintlig
produkt. Mallarnas exempel skapar inga nya produktkrav, tjänster eller
godkännanden. Produktmål hämtas ur repo och kandidatens befintliga PRD.

## Vad produkten redan är

Mobilanpassad webb/PWA på svenska och engelska. Planner komponerar en dag,
Live/Pulse visar källbelagda lokala händelser och Blitz föreslår ett nästa drag.
Citypacks är ett förbättringslager; any-place är produktens riktning. Specifika
intressen, platsankare, datum och användarens stoppbeslut ska överleva hela
kedjan. Tillit, okända öppettider och ofullständig täckning måste framgå.

Målgruppen i befintligt PRD är människor som vill upptäcka en plats utan att
själva sammanställa kartor, öppettider och kalendrar. Det är en arbetsbeskrivning,
inte en empiriskt validerad persona eller beslutad lanseringsmarknad.

Källor: `CODEX.md`, `docs/PARRANDA_ENGINE_GOALS.md`,
`docs/AGNOSTIC_ENGINE_NORTH_STAR.md` och den oförändrade
[PRD-snapshoten](mvp-readiness/PRD-Parranda-MVP-bf91fa9.md).

## Fryst leveransbild

| Lager | Faktiskt kontrollerat läge |
| --- | --- |
| GitHub main | `4b55cb091256e27a793f5c849f1c52b48c896ace` |
| Granskningskandidat | `bf91fa9eccac3345b8c49c9eed507c19f62c4ed7`, draft PR #569 |
| Runtime | Angiven tunnel svarade med `ok:true`, `runtime_profile:staging-563-564` och exakt kandidat-SHA |
| Kandidat-CI | `npm test` check SUCCESS, [run 37712320404](https://github.com/fritjofherrstrom-png/parranda/actions/runs/37712320404) |
| Main-CI | `npm test` check success, [run 37476814648](https://github.com/fritjofherrstrom-png/parranda/actions/runs/37476814648) |
| Deployment | Lästa self-hosted-jobb var skipped; repo-variable-listan var tom. Inget produktionsdeploy påstås |
| Ny egen runtimekontroll | Health och svensk landing via språkval. Ingen komponerad dag eller fysisk Safari kontrollerad |

[PR #569](https://github.com/fritjofherrstrom-png/parranda/pull/569) rapporterar
3577 root PASS/3 SKIP, 478 frontend PASS och originalreproduktion i mobilbredd
Chromium. Det är tidigare rapporterad evidens; räknarna har inte körts om här.
PR:n väntar enligt sin senaste body på oberoende review och användarfeedback.
Kall providerresiliens, karttiles och fysisk Safari är uttryckliga gränser.

### Publicerade PR-heads och ancestry

Kontrollerat med `git merge-base --is-ancestor HEAD bf91fa9`:

| PR | Publicerat head | I kandidatens ancestry |
| --- | --- | --- |
| #563 | `998af4abe08471f4019343b29539d40bc9c5ddff` | Ja |
| #564 | `8e15a803e48a63235713695b3a084f7d820404bc` | Ja |
| #565 | `6e15d453c37ab52dc03d7e40f7f0aeaf213dcf21` | Ja |
| #566 | `80d3ef554434af305085890e00d5063c58f04629` | Ja |
| #567 | `679ce183f4945247aa490a29424d34f3a16cae16` | Ja |
| #568 | `266b24e897cbc57f217f78d1ef6003f5f7b01fdc` | Ja |
| #562 | `66e2b7ef84e9e95ccf1a10352bf4131a2878c067` | Nej; kandidat har separat datumprioriteringsarbete, kräver diffavstämning |
| #501 | `058e253d0b7a6359d6c2fa51d93247a2857b9202` | Nej |

Alla ovanstående publicerade heads visade SUCCESS på sin `npm test` check.
Det betyder inte att de är landade. Dokumentgrenen utgår från main och
inkluderar ingen av kandidaternas runtime-implementation. PRD-snapshoten är
kopierad som dokument, inte integrerad Git-ancestry. Ingen PR har pensionerats.

## Konkurrenter: kontrollerade erbjudanden och produktinferens

| Produkt | Officiellt beskrivet erbjudande | Konsekvens för Parranda, vår inferens |
| --- | --- | --- |
| Google Maps | Personliga rekommendationer och Gemini-stödda frågor om platser/resor | Enbart AI-frågor eller rekommendationer särskiljer inte Parranda |
| Wanderlog | Itinerary, karta, ruttoptimering, reservationer, samarbete och AI-assistent | Kartvy och reseplanering räcker inte som differentiering; undvik att kopiera hela reseadministrationen |
| Komoot | Upptäckt och planering av rutter för vandring och cykling | Behåll Parrandas fokus på dagens relevanta upplevelser; nya transportlägen behövs inte för att prova kärnvärdet |

Källor, lästa 2026-10-08: [Google Maps](https://www.google.com/maps/about/),
[Wanderlog](https://wanderlog.com/), [Komoot](https://www.komoot.com/).
Detta är leverantörernas beskrivningar, ingen egen jämförande produkttestning.
Priser, användartal och marknadsstorlek utvärderas inte här.

**Hypotes att prova:** Parranda ger värde genom en sammanhängande, tids- och
preferensmedveten lokal dag som kan justeras utan att användarens beslut tappas,
med synlig källsäkerhet. Några lyckade fixtures bevisar inte den hypotesen.

## Tekniska fakta och öppna kapacitetsbeslut

Stacken finns redan: Node/Express, Astro/React/TypeScript/Tailwind, MapLibre,
OSM/Overpass, Wikidata, Overture, Sverige-avgränsad NAPI och Source Catalog.
PostgreSQL behövs i full Source Catalog-profil; enklare profilen använder
source-cache på disk. Planner ska använda befintlig motor och tillitsgränser.

Autocomplete använder Photon i kandidaten, inte publik Nominatim.
Nominatim-policy kräver högst 1 anrop/s, identifierande header och attribution;
publik autocomplete tillåts inte. Photon-demo tillåter rimlig användning men
kan strypas/blockeras och ger ingen tillgänglighetsgaranti. Källor lästa
2026-10-08: [Nominatim-policy](https://operations.osmfoundation.org/policies/nominatim/),
[Photon README](https://github.com/komoot/photon#demo-server).

**Inferens:** per-process rate gates och demoendpoints räcker inte som
kapacitetslöfte för flera repliker eller publik tillväxt. Välj drift/provider
utifrån beslutad last och budget; inget nytt avtal eller byte beslutas här.

Den valfria citerande eventläsaren skickar begränsad offentlig dokumenttext
till en modell och verifierar citat server-side. Den kan inte skapa koordinater,
licens, ägarskap, godkännande eller ruttval. Modelloberoende eventkällor behövs
fortfarande. `store:false` i koden bevisar inte hela leverantörens retention-
eller träningspolicy; konto-/providerinställningar och kostnadstak är öppna.
Inga modellpriser eller nya modellval fastställs.

## Prioriterad rekommendation

1. Reviewa och besluta om befintlig integrationskandidat innan nästa runtime-
   lager läggs ovanpå den. Bevara ancestry vid eventuell integration och
   jämför #562 separat. Merge/deploy ingår inte i dokumentleveransen.
2. Prova den befintliga kalla första kärnresan på fryst kandidat i en isolerad
   cache. Rotera punkt/stadsdel, större ort och liten ort. En inlämning ska ge
   relevant färdig dag eller ett korrekt slutligt hinder; warm-cache-framgång
   kan inte ersätta kallstartsevidens.
3. Fixa endast en reproducerad förlust i den kedjan. Klassificera först om
   orsaken ligger i insamling, tillit, urval, komposition eller UI-publicering.
   Ett okänt providerfel förblir okänt efter en senare lyckad körning.
4. Fördjupa därefter relevanta ersättningar, öppettidstäckning och variation
   där verklig supply finns. Ny composer, bred omskrivning och mer diagnostik
   utan konkret kapabilitet är inte rekommendationen.

## Handoff Context

- Stage: research, preliminära fynd.
- App name: Parranda.
- User level: Inte formellt klassificerad; använd konkreta svenska förklaringar.
- Target platform: Befintlig mobilanpassad webb/PWA, sv/en.
- Budget: Inte angiven; inga nya betaltjänster eller ekonomiska löften.
- Timeline: Inte angiven; användarens "det är dags" anger start, inte ett datum.
- AI in product scope: Befintlig valfri offentlig eventläsare, ingen ny AI-chat.
- Research status: Partial research; begränsad primärkälls-/repoanalys.
- Constraints: Any-place, inga stadsundantag eller påhittade fakta, bevarade val,
  modelloberoende supply, main och publicerade heads är leveranstruth.
- Decisions: Befintliga kontrakt/PRD återanvänds. Rekommendationerna ovan är
  förslag; ingen ny lanseringsmarknad, budget, merge eller deploy beslutad.
- Open questions: Lanseringsmål/marknad/datum, budget/last, accepterade runtime-
  observationsgränser, kommunikation vid geografisk utvidgning och providerdrift.
- Source files: De fyra `part*.md`-mallarna i Downloads; ovanstående repo-
  kontrakt; PRD-snapshot från bf91fa9; GitHub PR/CI och citerade primärkällor.
