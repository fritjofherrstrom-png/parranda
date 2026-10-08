# Parranda — checks och evidens

Välj checks efter ändrat beteende och återanvänd fortfarande giltig evidens.
Ingen ny runtime-matris körs för enbart dokument. Budgetar är inte benchmarks.

## Kommandon från repo

```sh
npm test
node --require ./tests/helpers/no-live-network.js --require ./tests/helpers/file-deadline.js --test --test-timeout=600000 tests/RELEVANT-FILE.test.js
npm run test:frontend
node --test frontend/tests/RELEVANT-FILE.test.mjs
npm run check:frontend
npm run build:frontend
node scripts/check-frontend-dist-drift.js
npm run validate:self-hosted
git diff --check
```

`RELEVANT-FILE` är kommandoexemplets filval, inte en verklig testfil. Byt till
den existerande regressionens path. Root kräver både root och frontend-
dependencies eftersom harness kan montera frontend. Root network guard
förbjuder externa värdar; börja inte med `PARRANDA_TEST_LIVE_NETWORK=enabled`.
Chromium kan kräva befintlig installation eller dokumenterad CI-browser.
Lokala SKIP är redovisade observationsgränser, inte browser-PASS.

| Ändring | Minsta meningsfulla kontroll |
| --- | --- |
| Dokument | Paths/länkar, metadata och diff; bevarade instruktioner |
| Resolver/source/selection | Fixture/replay av exakt fel, negativa trustfall och relevant integration |
| Lifecycle/state | Pending/completion, cancellation och sent svar efter senaste input |
| UI | Typecheck + relevanta harness/browserflöden + rebuild/dist-kontroll |
| Source Catalog | Isolerad DB/schema för berörd persistens; ingen migration mot användardata |
| Modelläsare | Giltigt/ogiltigt citat, injection, malformed response/timeout och tillitsgräns |

## Kärnresor inför produktacceptans

- [ ] Sök annat ankare än GPS-position; vald geografisk identitet består.
- [ ] Isolerad kall cache: en inlämning ger relevant dag eller korrekt slutligt hinder.
- [ ] Warm cache provas separat och ersätter inte kallstartsevidens.
- [ ] Snabba preferens-/rytmbyten publicerar senaste val, behåller giltiga pins.
- [ ] Bortvald identitet saknas; substitution provas med verklig lämplig ersättare.
- [ ] Styrkt nattöppet över midnatt, tidig kaffe, okända timmar och framtida dag.
- [ ] Live behåller datum/scope; större område/senare datum är märkta, rutt ändras inte.
- [ ] Modelloberoende supply är användbar; appstart ensam räcker inte.
- [ ] Mobil 320/390/430 px, långa titlar/datum och egen Safari-runtime.
- [ ] Maps innehåller publicerade stopp och ordning, fysisk överlämning redovisas.

Frys SHA/image, källa och cacheläge innan QA. PASS/FAIL/INCONCLUSIVE och ägare
finns i `docs/TechDesign-Parranda-MVP.md`. Ett tillförlitligt felmeddelande kan
PASS:a felkontraktet utan att bevisa färdig-dag-kapabilitet. Ingen ny QA-körning
är bokad av dessa checklistor. Bevara staging, snapshots, cache och volymer.
