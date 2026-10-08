# Parranda — tekniskt MVP-underlag

**Status: Utkast för review, 2026-10-08.** Beskriver befintlig arkitektur och
föreslår leveransordning. Ingen ny arkitektur eller implementation är godkänd
genom detta dokument. Kravkälla är den bevarade
[PRD-snapshoten från bf91fa9](mvp-readiness/PRD-Parranda-MVP-bf91fa9.md);
[research](research-Parranda.md) skiljer fynd från rekommendationer.

## Teknisk riktning och alternativ

| Val | Rekommendation och motivering | Alternativ och avvägning |
| --- | --- | --- |
| Produktarkitektur | Fortsätt i befintlig Express-app och Astro/React-ytor; bevara API och tillitsgränser | Ny fullstack-app eller tjänsteuppdelning skulle kräva migration/paritetsarbete utan påvisat MVP-värde |
| Komposition | Förbättra befintlig route-engine först efter reproducerat bortfall | Ny parallell composer duplicerar regler; endast UI-polish löser inte brist på användbar supply |
| Geografi | Serverägda providerfakta och signerad platsselektion i kandidaten | Fri klientgeografi kan uttrycka användarposition men får inte skapa tillit/source scope; providerbyte behöver kapacitetsbeslut |
| Lagring | Behåll diskcache, lokal sparning och optional PostgreSQL Source Catalog | Obligatorisk kontodatabas ökar scope; endast processminne förlorar källcache vid restart |
| Drift | Behåll nuvarande staging och immutable self-hosted-kontrakt | Managed host eller egen geocoder kan bli aktuellt efter last/budget; inget byte eller deploy nu |

Befintliga val hämtas från manifester och implementation, inte en ny
stackrekommendation. Exakta låsta versioner finns i respektive package-lock.
Host hade Node v24.15.0; `.nvmrc` och CI använder 22, `engines` kräver >=22.

## Kedja och ansvar

```text
Landing / PlaceSearchField
  -> server-side Photon-förslag och platsval
  -> signerad selektion eller trusted resolver
  -> normaliserad Planner-request och bounded lifecycle
  -> trusted loaders / fresh reviewed reservoir
  -> candidate spine / intent, availability och trust gates
  -> befintlig route-engine / ordning och walking validation
  -> honesty verdict / publicerad dag
  -> Keep/Remove/Add, lokal sparning och Maps-export

Vald plats + fryst datum -> separat Live-query -> märkta alternativ
Trusted location + aktuell lokal tid -> Blitz nästa drag
```

Main och bf91fa9 har olika moderna city-entry-kontrakt. Den gemensamma
city/any-place-ytan ligger i kandidaten #563–#569 och får inte beskrivas som
landad på main. Följ `docs/FRONTEND_MIGRATION_CONTRACT.md` på vald SHA.

Frontendens Planner håller aktuellt input, AbortControllers och stoppbeslut.
`frontend/src/lib/planner-lifecycle.mjs` driver statusläsning. Serverns
`server/planner/cold-lifecycle.js` äger en fryst normaliserad exekvering.
`server/place-candidates/` äger resolver, cache och acquisition.
`server/candidates/` och `server/planner/` bevarar evidence/intent genom
komposition till den befintliga `server/route-engine.js`.

## Kontrakt per kärnflöde

| PRD-behov | Befintlig söm / planerad verifiering |
| --- | --- |
| Vald plats består | `/api/place-suggestions`, serverutfärdad selektion, `place-selection.js` i kandidat; ändrad/utgången selektion får inte betros |
| En kall inlämning | `/api/route-recommendations` med `Prefer: respond-async`; HTTP 202 följs av `/api/planner-status`, inte ny acquisition |
| Senaste val vinner | Avbryt föregående lifecycle, testa att ett sent gammalt svar inte publiceras |
| Rätt preferenser/öppettider | Befintliga intake/availability/candidate gates; ändra inte fakta för att fylla stoppantal eller promenadmål |
| Keep/Remove/Add | Identitetsledger och retention i rätt datum/platskontext; borttagning utan ersättarpool bevisar inte substitution |
| Live rätt dag/scope | `/api/live-events`, date-scoped cache och separat etiketterad geografisk/datumfallback; aldrig tyst ruttmutation |
| Sparning/Maps | Sparad dag är snapshot; exportera publicerade stopp och ordning, behåll mobile-safe uppdelning |
| Blitz | Aktuell trusted lokal tid; framtida Planner-datum får inte ärva nu-klockan |

Normaliserade candidate records bär identitet, geometri, provenance, källfamilj,
tillit och preference fit. Event records bär publicerat datum/tid och källa;
ett datum utan klockslag är inte bevis för öppet nu eller ruttplanerbarhet.
Ingen ny databasmodell eller migration föreslås.

## Tid, fel och resurser

Den befintliga lifecycle-gränsen är 60 sekunder och högst 20 statusläsningar,
två aktiva exekveringar per process. Det är en gräns, inte ett uppmätt
latensmål. Processägda tokens ligger i minne; restart/expiry ger 410.
Flera repliker kräver affinity eller senare delat lifecycle-state.
Se `docs/BOUNDED_COLD_TO_READY_PLANNER.md` för fulla aktuella budgetar.

Tom verifierad supply, misslyckad källa, pending och otillräcklig trust måste
vara olika utfall. HTTP 200 med tomma `days` är inte lyckad komposition.
Publika payloads kan inte tillföra providerrows, source endpoints, tidszon,
källgodkännande eller evidens. Route geometry och avstånd är uppskattningar.
Provideravbrott motiverar inte obegränsade retries eller större QA-matris.

## Produkt-AI

Den befintliga valfria `quoted-event-reader.js` läser begränsad offentlig
dokumenttext. Strict schema och exakta citat kontrolleras server-side. Modellen
har inga verktyg för att skicka meddelanden, ändra källpolicy, godkänna källor
eller komponera rutter. Original dokument är data, aldrig instruktioner.

Verifiera med deterministiska mocks: giltigt citat, indirekt instruktion,
saknat år, fel citat/tid, tillverkade koordinater, malformed response och
timeout. Fel ger inga accepterade fakta. Modelloberoende adapters och pipeline
finns separat; en modelltimeout måste redovisa sin egen ofullständighet.

Behåll befintlig operatorvald modellkonfiguration. Kostnadstak och faktisk
kontoretention/träningsinställning är öppna före bredare drift. `store:false`
är en requestinställning, ingen full dataskyddsgaranti. Inga modell- eller
prisanspråk från mallarna återanvänds.

## Verifiering och föreslagen första leverans

Först review av bf91fa9 och dess kvarstående landing condition. Inget nytt
runtime-lager staplas på olandat arbete genom denna dokumentgren. Därefter är
minsta användbara steg acceptance av **en inlämning → korrekt slutlig dag**.

- Frys runtime-SHA/image och separat QA-cache. Bevara publikt staging,
  tidigare image, volymer och dirty filer. Ingen cachetömning på användarens miljö.
- Välj en liten roterande kohort: punkt/stadsdel, större ort och mindre ort.
  Kall och varm körning är separata; tidigare warm QA återanvänds bara där den gäller.
- **PASS för fallet:** en inlämning producerar källbelagd, relevant dag och
  bevarar plats/datum/intressen. Saknade matchningar och källa framgår.
- **FAIL:** tappat användarval, uppfunna fakta, gammalt svar publiceras eller
  reproducerad förlust av tillgänglig giltig supply.
- **INCONCLUSIVE för färdig-dag-kapabilitet:** faktiskt provideravbrott eller
  inget tillräckligt verifierbart utbud. Ett korrekt hinder kan separat PASS:a
  felkontraktet. Dokumentera landingbeslut; återförsök inte automatiskt.
- Vid FAIL: ta exakt fall till deterministic fixture, visa RED/GREEN för
  minsta fix och kör enbart berörda checks. Inget nytt fel påstås här.

Source review/integration ägs i detta dokumentspår av Codex. Runtime-QA på
PR #569 ägs enligt dess body av Jean Bob; ny QA är ett förslag, inget skickat
uppdrag eller bokad körning. Fritjof beslutar produktacceptans/landing.

## Setup och leverans

Kommandon har lästs i repo, inte körts som appchecks i detta dokumentarbete:

```sh
nvm use
npm ci
npm --prefix frontend ci
npm run dev:full
npm test
npm run check:frontend
npm run test:frontend
npm run build:frontend
node scripts/check-frontend-dist-drift.js
npm run validate:self-hosted
```

`npm start` har andra providerdefaults än `dev:full`. Full local dev är inte
hela PostgreSQL/scout-profilen. Ingen fristående lintscript finns.
`frontend/dist` är versionerat serving-output och ska byggas/committas när
frontendkälla ändras. Dokumentändringar kräver länk-/metadata-/diffkontroll;
full runtime-matris ska inte köras bara för text.

Main-targeted PR är leveransformen. Runtimeintegration ska använda expected-
head merge guard och bevara ancestry. Merge är inte deployment. Det befintliga
self-hosted-workflowet kan deploya grön main när operatorns flagga aktiveras;
ändra inte flaggan eller infrastrukturen genom detta underlag.

## Öppna beslut

Vilket lanseringsmål, marknad och datum? Vilken budget och förväntad last?
Vilka runtime-observationsgränser accepteras för bf91fa9 och inför publik
lansering? Hur ska större geografiskt urval kommuniceras? Vem äger nästa
isolerade kalla QA efter integrationsbeslutet? Dessa okända värden är inte
utfyllda med mallarnas exempel.

## Handoff Context

- Stage: techdesign, utkast för review av befintlig produkt.
- App name: Parranda.
- User level: Inte klassificerad; konkreta svenska förklaringar.
- Target platform: Mobilanpassad webb/PWA sv/en.
- Budget / timeline: Inte angivna.
- AI in product scope: Befintlig valfri offentlig eventläsare, inga nya AI-ytor.
- Chosen stack: Befintlig Express/Node + Astro/React/TypeScript/Tailwind,
  MapLibre, diskcache och optional PostgreSQL Source Catalog, self-hosting.
- AI coding tool: Codex i denna session; gemensamma leveransregler omfattar Hermes.
- Constraints: Bevara any-place, source trust, specifika preferenser, datum,
  val och befintlig arkitektur. Ingen automatisk main-merge eller deploy.
- Decisions: Återanvänd implementation och PRD; leveransordningen är föreslagen.
- Open questions: Se öppna beslut ovan; PRD är fortfarande utkast.
- Research status: Partial research, ingen ny kallstarts-/telefonacceptans.
- Source files: docs/research-Parranda.md; bevarad PRD-snapshot från bf91fa9;
  CODEX.md, enginekontrakt, package manifests, lifecycle och migrationskontrakt.

```json
{
  "schemaVersion": 1,
  "documentType": "techdesign",
  "appName": "Parranda",
  "status": "draft",
  "stack": {
    "frontend": "Existing Astro and React with TypeScript",
    "backend": "Existing Node.js and Express",
    "database": "Disk source cache; optional PostgreSQL Source Catalog",
    "styling": "Existing Tailwind and legacy CSS",
    "deployment": "Existing self-hosted profile; no deployment in this task"
  },
  "commands": {
    "setup": "npm ci && npm --prefix frontend ci",
    "dev": "npm run dev:full",
    "test": "npm test",
    "typecheck": "npm run check:frontend",
    "lint": "",
    "build": "npm run build:frontend"
  },
  "aiScope": "Existing optional public event extraction",
  "commandsExecutedAsAppVerification": false
}
```
