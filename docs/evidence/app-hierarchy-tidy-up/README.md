# Evidence: app hierarchy tidy-up

Local Chromium (Playwright 1.56) screenshots of the real built landing and
Planner (`frontend/dist` served by `server.js`), 2026-09-25.
**Replay fixtures only — not live, real-provider or Pi evidence.**

- “Before” = `ceee59e7b4dac36b7c8832a2dee0146179d02932` (bundles
  `AnywherePlanner.C8gJE29g.js`, `LandingHero.DrbyItES.js`).
- “After” = this change (bundles `AnywherePlanner.UuSLtA61.js`,
  `LandingHero.BA5OpxWN.js`).

Both sides were opened at `/anywhere?place=Malmö&planner=open` (and `/` for the
landing) with the same fixture, modelled on the Malmö day in the review
screenshots: three source-backed stops with stop-level preference coverage
(culture and food covered, views only partly), a walking-validated live event
woven in as stop 4, three detour ideas, one reviewed event feed and a weather
read. The published day carries the caps `capped_by_external_only_sources` and
`capped_by_derived_timezone`; its route line is the stops' own coordinates.

Only the Planner's own `/api/route-recommendations` and `/api/blitz` calls were
answered with fixture JSON, and `/api/live-events` was refused (the sheet's
default scope needs no request). OpenStreetMap tiles were replaced by a
generated placeholder tile and the Google Fonts files by a local copy, because
the capture environment cannot reach either; the map background is therefore
not real cartography.

| Images | Viewport | Language |
| --- | --- | --- |
| `mobile-day-*`, `mobile-day-open-*` (first stop and detours open), `mobile-candidates-only-*` | 390×844, DPR 2, full page, scaled to 390 px | English |
| `mobile-landing-*`, `mobile-adjust-*` (Adjust open) | 390×844, DPR 2, first screen | English |
| `desktop-day-*` | 1280×900, DPR 1, full page | English |

What to look for:

- **Landing** — the curated chip reads “Rome” on the English page (it read
  “Rom”); one focus ring on the search field instead of a square ring inside the
  rounded one; the shared app bar.
- **Day header** — one card for anchor and settings (“today” said once);
  covered / partly covered picks as chips under the title; the trust line under
  the title and nothing else; Save and Share labelled.
- **Route card** — the dotted line and its caption; “Local time is inferred from
  the location” beside the estimates instead of under the title; the woven event
  joined to the timeline by the same walk connector as other stops.
- **Now zone** — Live rows no longer spread apart around their links; Blitz is a
  visible action under Live instead of a link inside Adjust.
- **Candidates only** — the map before the lists; “None of these candidates
  cover: Views” instead of “No district covered”.
