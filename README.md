# Parranda

Parranda ar en promenadvänlig Rom-guide med PWA-front, karta och en personlig ruttmotor som väger in start/slut, gångdistans, preferenser, datum, live-events och stadsdelskänsla.

Det här repot är alpha-versionen för att snabbt kunna visa produkten, få skarp feedback och iterera på route engine, curation och upplevelse.

## Nuvarande alpha

- Personlig route builder med startpunkt, slutpunkt, datum, gångmål och preferenser
- Optimizer-lägen och stilval som `mer kväll`, `mer kultur`, `low-key` och `party`
- Rom-breddad kuratering med bland annat Prati, Borgo, Garbatella, Ostiense, Esquilino, Monti och San Giovanni
- Intern place-details-API för stopp, plus externa länkar till sök och karta
- PWA-stöd med manifest och service worker
- Live-lager för väder och eventmatchning

## Stack

- Frontend: `index.html`, `script.js`, `styles.css`
- Backend: `Node.js` + `Express`
- Karta: `Leaflet`
- Tester: `node --test`

## Kom igång lokalt

```bash
nvm use
npm install
npm start
```

Appen kör då på:

```text
http://localhost:8000
```

Hälsocheck:

```text
http://localhost:8000/api/health
```

## Testa innan du delar

```bash
npm test
```

## Dela med andra utvecklare

Det enklaste alpha-flödet är:

1. Lägg upp repot på GitHub.
2. Koppla repot till en staging-host.
3. Dela både repo-länk och staging-länk.

Det ger både kodgranskning och riktig produktfeedback.

## GitHub-flöde

Om du redan har skapat ett tomt repo på GitHub:

```bash
git remote add origin <DIN_GITHUB_URL>
git add .
git commit -m "chore: prepare Parranda alpha"
git push -u origin main
```

Om du vill hålla det privat i början rekommenderas ett privat repo.

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

## Vad jag vill att alpha-testare ska titta på

- Känns huvudrutten självklar och personlig?
- Blir det för mycket Trastevere i fel scenarier?
- Är place drawer och route copy trovärdiga?
- Känns kartan som stöd eller brus?
- Skulle du faktiskt använda appen inför en Rom-resa?

Mer strukturerad feedbackmall finns i `ALPHA_FEEDBACK.md`.

## När vi är redo för nästa fas

Naturliga nästa större steg:

- Save + remix på riktigt
- Bättre intern place drawer och platskort
- Mer live-events med bättre geokoppling
- Konto eller lätt sparfunktion för flera dagar
- iOS-wrapper via Capacitor när webbkärnan sitter
