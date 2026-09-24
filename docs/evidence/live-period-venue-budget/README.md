# Evidence: Live venue budget follows the requested period

Local Chromium (Playwright 1.56) runs of the real app on 2026-09-24 around
18:50 Europe/Stockholm. **Replay fixtures, not live evidence**: the sandbox's
egress policy refuses every provider host and the Pi tunnel.

- “Before” = `7c6884f92c6f35477b6839e6c862ca5b8b4eba3b` (main).
- “After” = `e8611be68b4783132bc21bbd9ad965889d87cc29` (this change).

Both SHAs were read from `/api/health`. Each side ran the real `buildApp` and
the committed `frontend/dist` with these seams:

| Seam | Replay |
| --- | --- |
| Place | fictional “Exempelhamn” (55.5565, 14.3505), resolver-shaped fixture |
| Place supply | ten invented OSM+Wikidata-shaped records through the injected loader |
| Events | one fixture calendar in the reviewed localized-API shape at `calendar.fixture.invalid`: four mapless rows this evening (19:30–21:00), two tomorrow (11:00 and 19:00) |
| Venue resolver | fixture: each of the six venue names resolves to one point inside the radius |
| Weather | replayed Open-Meteo shape (rain) |
| Everything else | refused |

Journey: `/anywhere?place=Exempelhamn&prefs=food,culture,views&day=1&lang=sv&planner=open`
(and without `day=1` for today), then the Live panel's button to open the sheet.
Mobile is 390×844 at DPR 2, desktop 1280×900. Full-page images are downscaled
by half.

Today's panel and full page were byte-identical PNGs before and after;
`mobile-today-panel-unchanged.jpg` is that capture.
