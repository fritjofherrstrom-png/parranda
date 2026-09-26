# Evidence: Pulse contrast and wrapping on the city shell

Local Chromium (Playwright 1.56) captures of `/barcelona?lang=sv` on the legacy
city shell, 2026-09-26 around 19:15 UTC, at 390×844. The sandbox refused map
tiles and Google Fonts, so both sides render with fallback fonts.

- “Before” = `styles.css` at `ceee59e7b4dac36b7c8832a2dee0146179d02932` (main).
- “After” = `styles.css` at `06a6f1a4e9286cb026979eed2e2bd0decf8dce74` (this change).

Both sides ran the same local `node server.js` (default profile) with the same
`index.html` and `script.js`, which this change does not touch; only the
stylesheet differed.

| Images | Shows | Data |
| --- | --- | --- |
| `mobile-teaser-*`, `mobile-edition-*` | The pre-plan teaser, then the edition after pressing “Pulse” (the issue's setup) | The server's fallback Pulse: providers unreachable, no weather. Page clock pinned to 20:38 Europe/Madrid |
| `mobile-chips-*` | One chip per signal type in `server/pulse-engine/types.js`, plus an unknown type that gets the base fallback | Fixture from `tests/pulse-contrast.test.js` at 12:00 (“Just nu” and “Ikväll”). The chips are cloned onto one card on the edition background; their colours come from the same rules as on their own cards |
| `mobile-empty-*` | The Pulse empty state (“Ikväll”, no signals) | The same fixture without signals |

**Replay fixtures, not live evidence** for the chips and the empty state.
Teaser, chips and empty state are DPR 2; the tall edition is DPR 1.
