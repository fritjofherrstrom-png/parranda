# Evidence: Live source links

Local Chromium (Playwright 1.56) screenshots of the real built Planner
(`frontend/dist` served by `server.js`), 2026-09-23 23:36–23:38 UTC.
**Replay fixtures only — not live, real-provider or Pi evidence.**

- “Before” = `1be68a5528b2b1fb7dc363612df07388b830dc12` (bundle `AnywherePlanner.BKX4DUSr.js`).
- “After” = `e69febacaedc192c924ab354da67aca32eb9802b` (bundle
  `AnywherePlanner.BVQBTQBY.js`; the code head of this change — later commits
  only add documentation and these images).

Both sides were opened at `/anywhere?place=Testville` with the same fixture.
Only the Planner's own `/api/route-recommendations` and `/api/blitz` calls were
answered with fixture JSON; every non-local request (map tiles, fonts) was
aborted. The fixture is one feed, “Visit Example” (CC-BY 4.0), listing:

- “Jazz vid kajen”, linking a site root, `https://museum.example.com/`;
- “Sen konsert”, linking a deep page, `https://venue.example/events/late-concert`;
- “Galleriafton” in the sheet's “Visa fler” list, linking a locale root,
  `https://gallery.example/sv/`;
- a walking-validated route stop “Kajfestival”, linking `https://kajfestival.example/`;
- a Blitz Live move “Konsert i hamnen”, linking `https://harbour.example/sv/`.

Views carry the link classification the server produces for those URLs. The
“before” bundle ignores it and shows the feed label; the “after” bundle renders it.

| Images | Viewport | Language |
| --- | --- | --- |
| `mobile-panel-*`, `mobile-sheet-*` (“Visa fler” expanded), `mobile-woven-stop-*`, `mobile-blitz-*` | 390×844, DPR 2 | Swedish |
| `desktop-panel-*` | 1280×900, DPR 2 | English |
