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

## Produktprinciper

- Parranda ska byggas runt en generaliserbar city intelligence engine, inte runt hårdkodade städer.
- City packs ska vara ett valfritt förbättrings- och accelerationslager, inte ett krav för att appen ska fungera.
- Appen ska på sikt kunna skapa meningsfulla, platsmedvetna upplevelser även utan dedikerat city pack, oavsett om användaren är i Simrishamn, Bologna eller Rio de Janeiro.
- Parrandas kärn-UI ska vara foto-oberoende: platsrepresentation ska fungera genom text, typografi, ikoner, kart-/ruttstruktur och lokal copy. Foton kan senare användas som redaktionell förstärkning, men ska inte vara ett krav för att upplevelsen ska fungera.

Se `docs/CITY_ENGINE_PRINCIPLES.md` för den permanenta principen bakom city packs och city-packless Parranda.

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
