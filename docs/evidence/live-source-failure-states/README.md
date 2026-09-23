# Evidence: Live source-failure states

Local Chromium (Playwright 1.56) runs of the real app, 2026-09-24 00:58–01:05
Europe/Stockholm. **Not Pi and not real-provider acceptance**: the sandbox's
egress allowlist blocked the public Pi link and every provider host.
“Before” = `1be68a5528b2b1fb7dc363612df07388b830dc12` (`/api/health` build_sha).
“After” = `10588568a430d91f53127120342737dc1ec46878` (code commit of this change;
later commits in the PR only add documentation and these images).

Journey on both sides: Swedish landing → typed place → Mat & dryck + Kultur +
Utsikt → Imorgon (fre 25 sep) → Live panel → “Utforska live”. Panel images are
taken at the same elapsed time after the day inputs were set; sheet images
after the sheet's own query and retries had finished. Web env flags come from
`compose.production.yml` (no Caddy/public guard); place lookup was a local
Nominatim-shaped replay on both sides.

| Images | Event sources | Evidence type |
| --- | --- | --- |
| `stockholm-failed-mobile-*` (390×844) | real reviewed manifest; Visit Stockholm answered HTTP 403 through the real adapter because the sandbox denies the host | genuine failure path, not an observed provider outage |
| `malmo-partial-desktop-*` (1280×900) | Malmö municipal row replaced by an empty replay page (localized-API shape); real festival row failed (sandbox-denied) | replay + real failure: synthetic partial-empty case |
| `stockholm-empty-desktop-*` (1280×900) | Visit Stockholm row pointed at an empty replay page | replay fixture: healthy empty |

Observed request timeline: before, 5 Planner composes and 4 Live queries all
answered `pending` (no final answer). After, 2 composes and 2 Live queries, with
the failure reported at ~19.5 s.
