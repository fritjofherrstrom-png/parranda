# Parranda

Parranda är en city-intelligence PWA med planner, Pulse och Blitz. Den ska förstå stadens rytm, inte bara lista platser. Produkten väger in område, tid på dagen, väder, live- och Pulse-signaler, intent, gångbarhet, trovärdighet och lokal täthet för att bygga bättre dagsflöden och nästa-drag-förslag.

Rome var första referensstaden. Barcelona är aktiv för beta- och produktarbete. Athens är ett preview-/thin-city-test där vi provar hur långt den agnostiska motorn kan komma med verified catalog items och ärliga provisional source candidates. Målet är att city packs ska förbättra och accelerera upplevelsen, inte vara ett hårt krav för att Parranda ska fungera.

Det här repot är alpha-versionen för att snabbt kunna visa produkten, få skarp feedback och iterera på route engine, Pulse, Blitz, trust/credibility och multi-city-arkitekturen.

## Nuvarande alpha

- Inline planner via `/:city?planner=open`, med `/:city/plan` bevarad som deep link till samma city-shell/planner-state
- Multi-city shell med Rome, Barcelona och Athens preview i stället för en Rom-låst app
- Pulse-lager för stadens dagsläge: väder, live-events, timingfönster och generiska/city-owned signaler
- Blitz: nästa drag, just nu, baserat på plats, tid, city context och dagsläge
- Route credibility: varje ruttstopp bär canonical trust metadata, och rutten får `trust_summary` / `credibility_tier`
- Honest preview för thin cities: unknown/thin cities får inte tyst Rome-fallback; lågt confidence visas som enkelt/ärligt route-läge
- PWA-stöd med manifest, service worker och mobil preview via LAN
- GitHub Actions CI kör `npm ci` + `npm test` på pull requests och pushes till `main`

## Produktprinciper

- Parranda ska byggas runt en generaliserbar city intelligence engine, inte runt hårdkodade städer.
- Appen ska förstå stadens rytm, inte bara visa topplistor.
- City packs ska vara ett valfritt förbättrings- och accelerationslager, inte ett krav för att appen ska fungera.
- Appen ska på sikt kunna skapa meningsfulla, platsmedvetna upplevelser även utan dedikerat city pack, oavsett om användaren är i Simrishamn, Bologna, Athens, Barcelona eller Rio.
- När Parranda saknar tillräcklig stadstäckning ska den vara ärlig: hellre låg-confidence/simple route eller noop än låtsad lokal säkerhet.
- Parrandas kärn-UI ska vara foto-oberoende: platsrepresentation ska fungera genom text, typografi, ikoner, kart-/ruttstruktur och lokal copy.

Se `docs/CITY_ENGINE_PRINCIPLES.md`, `docs/ARCHITECTURE.md` och `docs/PRODUCT_STRATEGY.md` för principerna bakom city packs och city-packless Parranda.

## Stack

- Frontend: `index.html`, `landing.html`, `script.js`, `landing.js`, `planner-trust.js`, `styles.css`
- Backend: `Node.js` + `Express`
- City data: `server/cities/<city>/`
- Engine: `server/route-engine.js`, `server/blitz-engine.js`, `server/pulse-engine/`
- Karta: `Leaflet`
- Tester: `node --test`
- CI: GitHub Actions i `.github/workflows/ci.yml`

## Kom igång lokalt

```bash
nvm use
npm ci
npm start
```

Appen kör då på:

```text
http://localhost:8000
```

För att utvärdera den fulla any-place-kedjan med platsresolver, OSM/Wikidata,
agnostisk komposition, eventinsamling och de granskade lokala källmanifesten:

```bash
npm run dev:full
```

`dev:full` använder en skrivbar lokal source-cache och aktiverar endast den
lokala utvärderingsprofilen. Vanliga `npm start` och produktionsdefault ändras
inte.

Hälsocheck:

```text
http://localhost:8000/api/health
```

## Vanliga lokala länkar

```text
http://localhost:8000/
http://localhost:8000/rome
http://localhost:8000/barcelona
http://localhost:8000/athens
http://localhost:8000/barcelona?planner=open
http://localhost:8000/barcelona/plan
```

English är default. Lägg till `?lang=sv` för svensk UI-copy:

```text
http://localhost:8000/barcelona?lang=sv
```

## Förhandsgranska på mobilen

Starta appen på datorn:

```bash
npm start
```

Servern binder mot `0.0.0.0` och skriver ut både lokal adress och LAN-adresser, ungefär:

```text
Parranda listening on http://localhost:8000
Open on a phone on the same Wi-Fi:
  http://192.168.1.23:8000
```

Öppna LAN-adressen på mobilen. Datorn och mobilen måste vara på samma Wi-Fi.

Om mobilen inte når adressen:

- kontrollera att Macens brandvägg tillåter inkommande anslutningar till Node/Terminal
- kontrollera att mobilen inte ligger på mobilnät eller gäst-Wi-Fi
- testa `HOST=0.0.0.0 PORT=8000 npm start`

## Testa innan du delar

```bash
npm test
```

CI kör samma grundsvit på GitHub för pull requests och pushes till `main`.

## Dela med andra utvecklare

Det enklaste alpha-flödet är:

1. Pusha arbetet till GitHub på en reviewbar branch.
2. Öppna en PR med tydlig scope, testresultat och eventuell preview-QA.
3. Låt GitHub Actions köra `npm test`.
4. Dela både repo-länk och staging-/preview-länk när PR:n är granskad.

Det ger både kodgranskning och riktig produktfeedback.

## Staging med Render

Repot innehåller en `render.yaml`, så du kan köra som Blueprint på Render.

Snabb väg:

1. Pusha repot till GitHub.
2. Gå till Render och skapa en ny Blueprint från repot.
3. Render läser `render.yaml` och sätter upp webbtjänsten.
4. Startkommando blir `npm start`.
5. Health check körs mot `/api/health`.

Render-dokumentation:

- Blueprint-spec: https://render.com/docs/blueprint-spec
- Health checks: https://render.com/docs/health-checks

## Vad alpha-testare ska titta på

- Förstår testaren direkt att Parranda bygger dagsflöden och nästa drag, inte bara listar platser?
- Känns huvudrutten självklar, personlig och gångbar?
- Visar appen rätt nivå av confidence för staden: curated, preview, simple route eller provisional?
- Känns Pulse som ett användbart lager ovanpå planeringen, inte en lös eventlista?
- Känns Blitz som ett faktiskt nästa drag just nu?
- Är place drawer, route copy och credibility-signaler trovärdiga?
- Skulle testaren använda appen på plats i Rome, Barcelona eller en preview-stad som Athens?

Mer strukturerad feedbackmall finns i `ALPHA_FEEDBACK.md`.

## När vi är redo för nästa fas

Naturliga större steg:

- Source/signal implementation audit: karta vad som faktiskt finns mellan provider, Pulse, Planner och Blitz
- Fler signaltyper: official live baseline, environmental/day-flow signals, market/local rhythm och computed daily signals
- AMB beach/coast-signal för Barcelona som första riktiga environmental day-flow source
- Blitz UX surface och eventuell extraktion till `blitz-panel.js`
- Live walking mode / companion experience
- Bättre catalog-first routing för thin/auto cities
- Lokal minnesfunktion innan konton
- iOS-wrapper via Capacitor när webbkärnan sitter
