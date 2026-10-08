# Parranda — stack och setup

Repoinspektion: 2026-10-08. Kommandon är kontrollerade mot manifests/scripts;
appinstallation, test och build är inte körda i dokumentleveransen.

| Område | Befintligt val | Gräns |
| --- | --- | --- |
| Frontend | Astro + React + TypeScript + Tailwind | `frontend/dist` versioneras och serveras |
| Server | Node >=22 + Express, CommonJS | `.nvmrc`/CI 22; observerad host 24.15.0 |
| Karta | MapLibre, legacy även Leaflet | Uppskattning, inte live-ETA |
| Data | OSM/Wikidata/Overture/NAPI + reviewed sources | Trusted acquisition; inga public providerrows |
| Persistens | Source-cache på disk, optional PostgreSQL Catalog | Full Catalog har DB/worker; enklare profile har inte allt |
| Användarsparning | Befintliga lokala snapshots | Inga nya konton eller authprovider |
| Drift | Befintlig tunnelstaging och self-hosted Docker/Caddy-kontrakt | Source merge är inte deployment |

## Kommandon

```sh
nvm use
npm ci
npm --prefix frontend ci
npm start
npm run dev:full
npm test
npm run check:frontend
npm run test:frontend
npm run build:frontend
node scripts/check-frontend-dist-drift.js
npm run validate:self-hosted
```

`npm start` och `dev:full` är alternativa devprofiler, inte två samtidiga
servrar på samma port. `dev:full` gör externa provideranrop och använder
skrivbar lokal cache; det aktiverar inte hela PostgreSQL/scout-stacken.
Ingen lintscript är definierad. Låsta paketversioner finns i lockfiles.

Frontend state/requests använder befintliga hooks, AbortControllers,
lifecycle-status och identitetsledger. Servern normaliserar/validerar publikt
input och owns trusted facts. Följ befintlig module seam vid focused fixes.

Valfri AI-läsare: `server/pulse-sources/quoted-event-reader.js`, offentlig
begränsad dokumenttext, strict schema/exakta citat, inga externa action tools.
Behåll operatorns modellval; providerretention/träning och kostnadstak är öppna.
Inga nya SDK/config-/kontoändringar behövs för dokumenten.

Se `docs/TechDesign-Parranda-MVP.md` och `docs/SELF_HOSTED_PRODUCTION.md` för
gränser. Kontrollera den faktiska branchens migrationskontrakt: bf91fa9:s
gemensamma city-entry är ännu inte main.
