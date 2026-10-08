# Parranda — proportionerlig review

Använd relevanta punkter för ändringen. En tom checkbox är planerad kontroll,
inte ett påstående om genomförd QA. Följ AGENTS.md för ägare och landing.

## Alla leveranser

- [ ] Konkret beteende/dokumentutfall och scope framgår.
- [ ] Main, kandidat, eventuell QA-SHA/image och aktuell CI redovisas separat.
- [ ] Diffen bevarar orelaterat arbete, source trust och specifika preferenser.
- [ ] Evidensnivå är angiven: fixture, source replay, staging, fysisk enhet.
- [ ] Återstående blocker/observation limit, landing condition och ägare finns.

## Dokument

- [ ] Lokala länkar och paths stämmer; inga mallvariabler återstår.
- [ ] Utkast, användarbeslut och förslag är olika märkta.
- [ ] Research har riktig status; tidigare CI/QA uppgraderas inte till ny evidens.
- [ ] JSON metadata matchar texten; inga nya konton/tjänster/scope uppstår.
- [ ] AGENTS.md:s befintliga instruktioner har bevarats.

## Berörd runtime

- [ ] Reproducerat fel eller konkret ny kapabilitet med fokuserad kontroll.
- [ ] Deterministiska tests använder inga liveanrop.
- [ ] Publika data kan inte injicera source facts/approval/endpoints/timezone.
- [ ] Place/date/intents och Keep/Remove/Add består, senaste svar vinner.
- [ ] Källfel, verifierat tomt och pending skiljs åt; ingen påhittad dag.
- [ ] Frontendkälla har relevant typecheck/browsercheck och rebuild av dist.
- [ ] Berörd mobil layout och Maps-export kontrollerade; Safari har egen runtime.
- [ ] Ny dependenciesändring granskas vid behov; ingen rutinmässig dependency-
  eller infrastrukturändring för att göra en dokumentleverans klar.

## Valfri eventmodell, när berörd

- [ ] Offentlig dokumenttext är data; exakta citat/datum/tider verifieras.
- [ ] Injection, falska citat, malformed output, timeout och datagränser provas.
- [ ] Ingen modelldecision skapar trusted geometri, rättigheter eller approval.
- [ ] Faktisk providerretention och kostnad är dokumenterade vid driftsbeslut.

## Landing, när auktoriserad

- [ ] Aktuell main/head/CI matchar godkänd kandidat och repo-regler.
- [ ] Expected-head merge guard; integrationens ancestry bevaras.
- [ ] Deploymentkoppling kontrollerad separat.
- [ ] Absorberade PR-heads avstämda; nya deltan bevaras och #562 jämförs särskilt.
- [ ] Resulterande main/CI/workflows och nästa ägare rapporterade.
