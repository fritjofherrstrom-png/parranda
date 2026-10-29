# QA evidence for PR #643 after merging main 0976c1af

This folder holds evidence only. It is not for merge.

- **Evidence level:** fixture. These are not provider data, staging or a device.
- **Source state:** merge commit `da1ccb5d`, which merges main `0976c1af` (#661, #665, #668) into PR #643.
  - `LiveCard` and `LiveSheet` come from the source files.
  - The built Tailwind CSS comes from that commit's `frontend/dist`.
- **Data:** the `live-time-groups.test.mjs` rows, Helsinki, Wed 7 Oct 2026. The clock is pinned to 14:05 local time (11:05 UTC).
- **Browser:** headless Chromium (Playwright `playwright-core` from `frontend/node_modules`), 390 px wide, 2×. The full sheet was captured at a viewport 1900 px tall.
- **Errors:** 0 page errors.

Sheet headings in document order, read in the same run:

```
en: H2 Live in Testville · H3 Later today · H4 Evening concert · H3 During the day · H4 Light festival · H3 Started earlier · H4 Lunch theatre · H3 Source date ranges · H4 Harbour exhibition
sv: H2 Live i Testville · H3 Senare i dag · H4 Evening concert · H3 Under dagen · H4 Light festival · H3 Började tidigare · H4 Lunch theatre · H3 Källans datumintervall · H4 Harbour exhibition
```

The card's titles are h4 under h3 group headings. `live-time-groups.test.mjs` checks this.
