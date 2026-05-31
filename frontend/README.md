# Parranda frontend foundation

This workspace is an isolated Astro proof for future frontend migration work. It does **not** take over any production route and does not replace the current Express app.

Review this workspace against [`../docs/FRONTEND_MIGRATION_CONTRACT.md`](../docs/FRONTEND_MIGRATION_CONTRACT.md).

## Commands

From the repository root:

```bash
npm run check:frontend
npm run build:frontend
npm run dev:frontend
```

Or from this workspace:

```bash
npm --prefix frontend run check
npm --prefix frontend run build
npm --prefix frontend run dev
```

## Current scope

Included:

- Astro static build setup.
- TypeScript strict config.
- Tailwind config/design-token stub.
- Minimal static proof page.
- Static Astro landing proof at `/landing-proof/` with Tailwind compiled through PostCSS.
- Frontend-only contract test for the landing proof route links and no-island boundary.

Explicitly not included:

- No production route takeover.
- No changes to `/`, `/:city`, `/:city?planner=open`, or `/:city/plan`.
- No routing rewrite.
- No i18n rewrite.
- No Planner, Pulse or Blitz rewrite.
- No full Tailwind migration.
- No Preact islands.
- No planner polish.
