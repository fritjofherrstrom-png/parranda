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

## Layout

```text
src/
  pages/                 bare Astro shells (copy lives in the islands)
  components/
    LandingHero.tsx      the landing island
    AnywherePlanner.tsx  the planner island: requests, race guards, ledger, render
    planner/             pieces the planner renders (map, Live sheet, copy, types)
    shared/              app bar and the inline SVG icon set, used by both islands
  lib/                   pure view logic (.mjs + .d.mts), unit-tested without a DOM
  styles/                tokens and the Tailwind entry
tests/                   node --test; mounted-component harnesses in tests/helpers
```

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
