# Parranda frontend

The modern frontend: an Astro static build with two React islands. Express
serves the committed build and owns everything request-time (the `<html lang>`,
the injected city registry, every API).

| Route | Island | What it is |
| --- | --- | --- |
| `GET /` | `LandingHero` | Choose the day's anchor once: a place, a curated city, or your position |
| `GET /anywhere` | `AnywherePlanner` | The day, Live, Blitz and saved days |

Route ownership, rollback and the rules for migrating further surfaces live in
[`../docs/FRONTEND_MIGRATION_CONTRACT.md`](../docs/FRONTEND_MIGRATION_CONTRACT.md).
The page hierarchy and the direction for this code are in
[`../docs/APP_ARCHITECTURE_AND_HIERARCHY.md`](../docs/APP_ARCHITECTURE_AND_HIERARCHY.md).

## Stack

Astro 7 (Vite 8) builds static pages with two React 19 islands. Styling is
Tailwind 4, CSS-first: `@tailwindcss/vite` in `astro.config.mjs`, the theme in
`src/styles/tailwind.css` (`@theme inline`), the values in
`src/styles/tokens.css`. There is no `tailwind.config` and no PostCSS step.

## Layout

```text
src/
  layouts/Shell.astro    the document both pages share: fonts, tokens, theme choice
  pages/                 bare Astro pages (copy lives in the islands)
  components/
    LandingHero.tsx      the landing island
    AnywherePlanner.tsx  the planner island: requests, race guards, ledger, layout
    planner/             what the planner renders: AnchorCard, DayHeader, StopLine
                         (the route as a line), CandidateAreas, LiveCard, BlitzCard,
                         SavedDays, RouteMap, LiveSheet, copy, types, commitments
    shared/              app bar, icons, UI primitives (ui.tsx), useMediaQuery
  lib/                   pure view logic (.mjs + .d.mts), unit-tested without a DOM
  styles/                role tokens and the Tailwind entry
tests/                   node --test; mounted-component harnesses in tests/helpers
```

The planner's pieces own no request and no ledger: the orchestrator hands them
data and its own functions by name. Contract tests that read source read the
whole planner surface (`tests/helpers/planner-source.mjs`).

## Design: "Linje"

The day is a line through the city. Stops are stations on one route-coloured
line, walks are its segments, daypart headings cross it, and a woven live event
is a transfer in the Live colour. Type is signage: Archivo on its width axis for
titles, IBM Plex Mono for data (times, distances, counts, eyebrows).

Colours are roles, not hues (`tokens.css`): `ink`, `paper`, `terracotta` (the one
filled action, white text 5.2:1), `ember` (the line), `clay` (accent text),
`glow` (eyebrows, honesty notes) and `live`. Secondary text never goes below 68%
ink, so it holds 4.5:1 in both themes.

Two themes follow the day: `day` (light) from 06 to 18 local time, `night`
otherwise. The reader can switch in the app bar; the choice is kept in
`localStorage` (`parranda:theme`). `layouts/Shell.astro` writes
`<html data-theme>` before first paint, and nothing React renders depends on it,
so hydration never disagrees with the static build. Map tiles are the same OSM
tiles, toned per theme with a CSS filter; the route is the only colour on the
map.

On screens from 64rem the planner splits: the day on the left, the map sticky
beside it. It is one Leaflet map either way, mounted where it is shown.

The honesty classifier is shared with the server tests from the repository root
(`anywhere-render-decision.js`).

## Commands

From the repository root:

```bash
npm run check:frontend   # tsc --noEmit
npm run test:frontend    # node --test frontend/tests
npm run build:frontend   # astro build → frontend/dist
npm run dev:frontend     # astro dev, /api proxied to the running Express app
```

`frontend/dist` is committed as the build of record. After changing anything
under `src/`, rebuild and commit it; CI fails when the committed build drifts
from a fresh one (`scripts/check-frontend-dist-drift.js`).
