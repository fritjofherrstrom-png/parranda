# Evidence: Live source-failure states

Local Chromium (Playwright 1.56) runs of the real app on 2026-09-24,
Europe/Stockholm: before-images 00:58–01:05, after-images and the review pair at
01:31–01:32. **Not Pi and not real-provider acceptance**: the sandbox's egress
allowlist blocked the public Pi link and every provider host. The SHA of each
set comes from `/api/health` build_sha:

- “Before” = `1be68a5528b2b1fb7dc363612df07388b830dc12` (main).
- “After” = `be19354af622f44cbb2efb50a4e84ff08b78499a` (the change including the
  review fix). The after panels are byte-identical to the earlier captures at
  `10588568a430d91f53127120342737dc1ec46878`; only the sheet status line differs.
- “Review before” = `1a89f9b502dae09f84a6ac9be234cd1e10836cd2` (PR head before
  the review fix).

Journey on every side: Swedish landing → typed place → Mat & dryck + Kultur +
Utsikt → Imorgon (fre 25 sep) → Live panel → “Utforska live”. Panel images are
taken at the same elapsed time after the day inputs were set; sheet images
after the sheet's own query and retries had finished. Web env flags come from
`compose.production.yml` (no Caddy/public guard); place lookup was a local
Nominatim-shaped replay on all sides.

| Images | Event sources | Evidence type |
| --- | --- | --- |
| `stockholm-failed-mobile-*` (390×844) | real reviewed manifest; Visit Stockholm answered HTTP 403 through the real adapter because the sandbox denies the host | genuine failure path, not an observed provider outage |
| `malmo-partial-desktop-*` (1280×900) | Malmö municipal row replaced by an empty replay page (localized-API shape); real festival row failed (sandbox-denied) | replay + real failure: synthetic partial-empty case |
| `malmo-rejected-rows-desktop-sheet-review-*` (1280×900) | Malmö municipal row replaced by a replay page returning two rows ~20 km away, which the geometry gate rejects; festival row failed | replay + real failure: the #506 review case (rows returned, 0 accepted, one failed source) |
| `stockholm-empty-desktop-*` (1280×900) | Visit Stockholm row pointed at an empty replay page | replay fixture: healthy empty |

Observed request timeline for the failure cases: before, 5 Planner composes and
4 Live queries all answered `pending` (no final answer). After, 2 composes and
at most 2 Live queries, with the failure reported at ~19 s.
