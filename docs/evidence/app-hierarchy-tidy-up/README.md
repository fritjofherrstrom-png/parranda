# Evidence: app hierarchy tidy-up

Local Chromium (Playwright 1.56) screenshots of the real built landing and
Planner (`frontend/dist` served by `server.js`), 2026-09-25.
**Replay fixtures only — not live, real-provider or Pi evidence.**

- “Before” = `ceee59e7b4dac36b7c8832a2dee0146179d02932` (bundles
  `AnywherePlanner.C8gJE29g.js`, `LandingHero.DrbyItES.js`).
- “After” = this change (bundles `AnywherePlanner.DYtvY6Ns.js`,
  `LandingHero.2FOKyCvV.js`), re-captured after the review follow-up (see
  “Review follow-up” below). The acceptance follow-up after it
  (`AnywherePlanner.DFHG29Vd.js`) changes what happens on arrival and when a
  near-me day recomposes, not these views, so they were not re-captured.

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

## Review follow-up

An independent review of this PR in a real browser against the PR-head server
(providers blocked by the capture environment, so no real-provider outcome was
observed) found problems in what the first version of this change shipped or
claimed. The follow-up fixes them; the “after” images above were re-captured:

- **Landing** — “Hand-picked in” on its own line above the city chips (it said
  “Extra curated” beside them, and wrapped “Rome” alone at 320 px); a
  placeholder that fits a 320 px field (“e.g. Lyon or Kyoto”).
- **Day header** — Blitz names the place it reads (“One next move in Malmö”);
  “near you” is kept for a position anchor.

Not visible in these fixtures, and covered by tests instead: the language
switch carrying adjustments made after load and handing a near-me position to
the next page; a Swedish near-me day asking in Swedish (“En dag nära dig”); the
split Maps handoff as a named sequence; type chips for every published kind;
Blitz withheld after an unresolved place or a capacity refusal.

## Acceptance follow-up

The acceptance run on the review follow-up reproduced two faults in a real
browser, both behaviour rather than pixels:

- Opening a share or language link composed the day twice — once for the
  link's settings, then again when adopting them tripped the adjustment
  re-run. Now one arrival makes one compose; a real change in Adjust still
  recomposes.
- A language switch on a near-me day asked the browser for the position again,
  in the background (every adjustment took the same path). With the standing
  permission gone, the refusal replaced the day with the form for a typed
  place and “couldn't compose a day for  yet”, with no place in it. Now the
  position the user chose is reused; the browser is asked only from the
  explicit “Use my location” tap, and a restored near-me day stays a near-me
  day instead of “A day in ” with no place.

Evidence is `frontend/tests/planner-arrival-once.test.mjs` and a real-browser
count of compose and geolocation calls per navigation (simulated position;
providers blocked, so no real-provider or Live outcome was observed).
