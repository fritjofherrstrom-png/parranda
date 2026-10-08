# Parranda

Parranda är en mobilanpassad webbapp för platsmedveten dagsplanering och lokal upptäckt. **Planner** komponerar dagar, **Live/Pulse** visar källbelagda lokala händelser och dagsläge, och **Blitz** föreslår ett nästa drag just nu.

Produktens riktning är att välja relevanta upplevelser utifrån användarens plats, intressen, rytm och tillgängliga tid — inte bara lista de närmaste eller mest populära platserna. Öppettider, väder, geografi och källornas säkerhet ska påverka verkliga val. Okända fakta och ofullständig täckning ska framgå.

Parranda är platsagnostisk i sin produktinriktning: städer, stadsdelar och mindre orter ska kunna använda samma motor. Handbyggda stadspaket är ett förbättringslager, inte målet eller ett krav på varje framtida plats. Rom, Barcelona och Aten är referenser och testmiljöer, inte produktens geografiska avgränsning.

**Status: alpha.** Kallt källunderlag, kvalificerad platsigenkänning, öppettidstäckning och verklig mobilacceptans har fortfarande begränsningar. En grön CI eller en lyckad teststad är inte bevis på komplett lokal täckning. Olika stagingbyggen kan innehålla ännu omergade PR:er; kontrollera deras `/api/health` och exakta SHA separat från `main`.

## Produktkrav

[MVP-PRD för Parranda](docs/PRD-Parranda-MVP.md) samlar produktutfall, kärnresa, scope, fel-/osäkerhetstillstånd och observerbara acceptanskriterier. Dokumentet är ett kravutkast; planerade kontroller är inte utförd QA. Överenskomna beslut och öppna frågor är markerade separat.

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

Framtida produktarbete finns i [Product TODO](docs/PRODUCT_TODO.md), inklusive ett uppskjutet shuffle-val för alternativa dagsstopp.

## Stack

- Modern frontend: Astro, React, TypeScript och Tailwind CSS i `frontend/`; byggd distribution i `frontend/dist/`
- Backend: `Node.js` + `Express`
- Platsdata och stadspaket: `server/cities/<city>/`, med källbelagda any-place-kandidater som komplement
- Engine: `server/route-engine.js`, `server/blitz-engine.js`, `server/pulse-engine/`
- Modern Planner-karta: MapLibre GL; äldre stadsskal använder även Leaflet
- Äldre frontendytor finns kvar under migreringen: `index.html`, `landing.html`, `script.js`, `planner-trust.js`, `styles.css`
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

I en ny arbetskopia behövs båda låsta beroendemängderna; root-sviten inkluderar även frontendens komponentharness.

```bash
npm ci
npm --prefix frontend ci
npm test
```

Varje testfil har en generös tidsgräns på 600 sekunder. En fastnad fil ger icke-noll exitkod och `not ok`, aldrig automatisk skip eller PASS. Detta är inte en total tidsgräns för hela sviten. Små lokala Parquet-fixturer använder en DuckDB-tråd och 128 MB hanterad minnesbudget (inte ett hårt RSS-tak); accepterade SQL-frågor dräneras före asynkron stängning.

Sviten körs offline: `npm test` laddar `tests/helpers/no-live-network.js`, som
stoppar varje anrop till en extern värd och fäller testfilen som gjorde det.
Tester använder fixtures eller injicerade fetchers i stället för livekällor. Tester
som verkligen behöver en riktig tjänst (i dag DuckDB-barnprocessen, som laddar
ner tillägget `httpfs`) hoppas över om du inte kör
`PARRANDA_TEST_LIVE_NETWORK=enabled npm test`.

`tests/pulse-contrast.test.js` mäter Pulse-kontrasten i stadsskalet i en riktig
Chromium. Utan webbläsare hoppas den över lokalt; installera Google Chrome, kör
`npx playwright-core install chromium` eller peka ut en med
`PARRANDA_TEST_CHROMIUM=/sökväg/till/chrome`. I CI, där GitHub-runnern har
Chrome, fäller den i stället för att hoppa över.

CI kör samma grundsvit på GitHub för pull requests och pushes till `main`.

`tests/route-map-controls.test.js` kontrollerar i en riktig Chromium att ingen
ruttmarkör hamnar under kartans egna kontroller (zoom, attribution,
förstoringsknappen), och `tests/route-map-tap-targets.test.js` att ett tryck
eller en hovring på en markörs synliga nummer öppnar just det stoppet. Nummer
som ritas under en annan markör kan inte tryckas alls; de följs, som blockerande,
i #531, och testet fäller om de dyker upp någon annanstans. Utan webbläsare
hoppas de över lokalt; installera Google Chrome, kör
`npx playwright-core install chromium` eller peka ut en med
`PARRANDA_TEST_CHROMIUM=/sökväg/till/chrome`. I CI, där GitHub-runnern har
Chrome, fäller de i stället för att hoppa över.

## Dela med andra utvecklare

Det enklaste alpha-flödet är:

1. Pusha arbetet till GitHub på en reviewbar branch.
2. Öppna en PR med tydlig scope, testresultat och eventuell preview-QA.
3. Låt GitHub Actions köra `npm test`.
4. Dela både repo-länk och staging-/preview-länk när PR:n är granskad.

Det ger både kodgranskning och riktig produktfeedback.

## Dela appen — din maskin är servern

Parranda behöver ingen databas och inga hemligheter, så hostingen får vara lika
enkel som appen: **din egen maskin kör servern, och en tunnel ger den en publik
HTTPS-adress.** Inget hostingbolag håller appen, och cachen ligger på en riktig
disk — en plats som slagits upp en gång förblir snabb för alla som frågar sedan.

```bash
npm run share
```

Det läget binder till loopback (tunneln blir enda vägen in), slår på live-
källorna, lägger cachen i `~/.parranda/source-cache` och håller Macen vaken så
länge den kör. Sedan ger `tailscale funnel 8000` en stabil publik länk att
skicka till vänner — gratis, utan kort, inloggning med GitHub.

Full genomgång, inklusive alltid-på via launchd och hur skydden ställs in:
[`docs/SELF_HOSTING.md`](docs/SELF_HOSTING.md).

För en alltid-på Linux-server utan Render finns även en immutable
Docker/Compose-profil med Caddy, persistent source-cache, exakt build-SHA,
health-verifierad deploy och automatisk rollback:
[`docs/SELF_HOSTED_PRODUCTION.md`](docs/SELF_HOSTED_PRODUCTION.md).

Delningsläget skyddar också den öppna data appen lever på: 20 uppströms-
förfrågningar per besökare och minut, åtta samtidiga, `robots.txt` som håller
crawlers borta och debug-projektionen stängd. Avslag är ärliga 429-svar, aldrig
ett tyst tomt resultat.

`render.yaml` finns kvar i repot för den som hellre kör som Blueprint någon
annanstans, men självhosting är den rekommenderade vägen.

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
