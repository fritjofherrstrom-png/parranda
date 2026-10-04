# "Linje" redesign — QA plan

Scope: the frontend-only branch `design/linje-redesign` (redesign, Tailwind 4,
Astro 7, planner sections, landing without the city list, "Follow the day",
opening hours said once, spacing). No server, engine or source change. The
engine answers the branch shows are the same as main's for the same inputs.

## What the branch already has as evidence

- Frontend: `tsc`, 401/401 `node --test frontend/tests` (jsdom harness).
- Root `npm test` with real Chromium (CI=1): route-map legibility, controls and
  tap targets at 320/390/1280 px against the built surface.
- `scripts/qa-planner-surface.js` against a local `npm run dev:full` on the
  branch: landing (no city list, theme before paint, theme switch, no console
  or hydration errors at 390/1440), Barcelona and Rome curated days (390 night,
  1440 day with the map beside the day), and on a composed day: a stop opens in
  place, Follow the day marks the next station from a simulated position, an
  adjustment recomposes with its "Changed" line and undo, Save, and the
  language switch reopens the day in Swedish.
- Limit: the cloud sandbox cannot reach Overpass, so freeform places came back
  "unavailable" there. That is the sandbox, not the branch, and it means the
  freeform surface (keep/dismiss/add, Blitz, candidates, sparse supply) has
  only jsdom evidence on this branch. It is the main thing to verify on a real
  runtime.

## On a frozen QA image (Pi, Planner-QA — not public staging)

1. Freeze the PR head after GitHub CI is green. Build one image; deploy it to
   the Planner-QA endpoint only. Verify `/api/health` `build_sha` equals the
   head. Preserve the previous image/config/cache and restore afterwards.
2. Run the script against it, with the frozen SHA:

   ```bash
   node scripts/qa-planner-surface.js --base http://127.0.0.1:18508 \
     --expect-sha <head> --out qa-linje-<head>
   ```

   Default places: Barcelona and Rome (curated), Lyon, Kyoto, Malmö,
   Simrishamn, Lisbon, Athens (preview). Engine outcomes are recorded as
   observations; only surface checks are PASS/FAIL. A check that could not run
   is NOT OBSERVED, never a pass.
3. Compare the place table with the same script against current staging/main
   (the old surface FAILs the new-surface checks by design; compare states and
   stop counts only). A state that differs between the two for the same place
   and date needs an explanation before landing — the branch changes no engine
   code, so a difference points at the bridge in `lib/anywhere-decision.ts`
   (see the Vite 8 note in the PR) or at provider variance.

## On a real phone (iOS Safari and Android Chrome)

Record VERIFIED / FAILED / NOT OBSERVED per line, with a screenshot.

- Theme: no light flash before a night page paints (open at night, and with
  the switch set). The switch survives a reload.
- Follow the day: walk a few hundred metres of a real day. The next station
  advances, passed stations are checked off, "Stop following" ends the
  location prompt/indicator. Denying location shows the blocked line and
  nothing else changes.
- Freeform day (a place with source-backed supply): keep, dismiss, add a detour
  idea, "Start over without my choices", and Blitz.
- Live: open the sheet, change scope and period, close it, reopen it — it
  resumes the selected cell (#547's contract, carried into `LiveCard`).
- Desktop (≥1024 px): the map stays beside the day while scrolling a long day.
- Safe areas: nothing under the notch or home indicator on the landing and
  planner in both orientations.

## Known observations (not introduced by this branch)

- Tapping EN/SV before the island has hydrated follows the static link, which
  carries only `?lang=…`, so a slow first load can drop the place. Observed on
  `parranda.onrender.com` (main) on a cold load; the branch has the same static
  link. A small pre-hydration fix is possible but changes the AppBar's
  hydration contract, so it should be its own change.
- `route-map-fit.mjs` draws one fixture smaller when the map is expanded at
  full phone width; the branch keeps the previous mobile map width to avoid it.
