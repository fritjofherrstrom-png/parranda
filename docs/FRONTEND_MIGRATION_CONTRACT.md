# Frontend Migration Contract

This contract keeps the Astro/frontend migration from drifting into a product rewrite. It defines the production behavior that must remain stable while new frontend infrastructure is introduced.

## Current production contract

- The current Node/Express app remains the production source of truth until a later PR explicitly migrates a surface.
- English is the default public UI language.
- Swedish UI is explicit via `?lang=sv`.
- `?lang=en` remains valid, but it is not required for English UI.
- The canonical planner entry is `/:city?planner=open`.
- `/:city/plan` is preserved as a deep link to the same inline city-shell planner state.
- City shell, Planner, Pulse and Blitz behavior must not change during frontend foundation work.
- Existing bootstrap contracts such as `window.__PARRANDA_CITY__`, `window.__PARRANDA_BOOTSTRAP__`, `window.__PARRANDA_LANGUAGE__`, and `window.__PARRANDA_I18N__` remain owned by the current app until a dedicated migration PR proves parity.

## Astro foundation scope

Allowed in the foundation PR:

- Add an isolated frontend workspace such as `/frontend`.
- Add Astro dependencies, config and build scripts.
- Add a minimal static demo/proof page.
- Document the boundary between the current production app and the future frontend stack.
- Keep existing `npm test` green.

Not allowed in the foundation PR:

- No production route takeover.
- No routing rewrite.
- No i18n rewrite.
- No Planner, Pulse or Blitz rewrite.
- No full Tailwind migration.
- No Preact islands unless separately approved before the PR starts.
- No CSS-system rewrite.
- No planner-entry polish bundled into the foundation work.
- No changes to current app behavior.

## Approved additions (2026-07-02)

Owner-approved, per the "unless separately approved" clause:

- **React islands** (`@astrojs/react`) are approved as the component model for new
  frontend surfaces, together with the already-scaffolded Tailwind setup.
- **First surface: the any-city planner** (`/anywhere` in the new frontend) —
  search a freeform place → composed day → district panel → live events → map,
  built against the EXISTING Express API (`/api/route-recommendations` with the
  agnostic flags) and the SHARED honesty module (`anywhere-render-decision.js`).
- This remains a **parallel, non-production surface**: no production route
  takeover, no change to current app behavior. The Express app is still the
  production source of truth; takeover of any route still requires the Surface
  migration rule below.

## Promoted surfaces (2026-07-12)

Readiness was proven for the first two migrated surfaces (parity checklists in
#328/#344, live browser verification, the full suite), so per the anti-drift
rule that experiment flags are not a permanent excuse, their route ownership is
now the DEFAULT:

- **`/anywhere`** is owned by the new frontend by default. Opt out with
  `PARRANDA_NEW_ANYWHERE=disabled`.
- **`GET /` (landing)** is owned by the new frontend by default, still gated on
  the `/anywhere` surface being active (the landing routes freeform places
  there — it never points at a missing surface). Opt out with
  `PARRANDA_NEW_LANDING=disabled`.
- Both remain gated on the **built page existing** (`frontend/dist` is
  committed): a deployment without the build automatically serves the prior
  Express surface, byte-stable.
- **`/labs/anywhere`** redirects (302) to `/anywhere` with the same
  place/planner/lang inputs while the new surface is active; when opted
  out/unbuilt it still serves the old alpha shell. It is the rollback surface
  and is deleted only after the promoted default has soaked.
- Rollback for every case is one env var, no redeploy of code.

The old landing shell, the `/labs/anywhere` alpha shell, and their script.js
anywhere mode remain in the tree as the opt-out fallback. Removing them is a
LATER, separate cleanup PR once the promoted default has soaked — not part of
the promotion itself. The curated city shells (`/:city?planner=open`) are NOT
migrated and remain owned by the current Express app.

## Retired surfaces (2026-07-17)

The promoted default (#350) soaked through #351–#370 with no rollback. The old
surfaces are now DELETED, not just demoted:

- The old server-rendered landing (`renderLandingShell`) and its client
  (`landing.js`) are removed. **GET / is owned solely by the new frontend.**
- The `/labs/anywhere` alpha shell (`renderAnywhereShell`) is removed. The URL
  remains as an **unconditional 302 → `/anywhere`** with place/planner/lang
  preserved, so old links keep working.
- The opt-out env flags `PARRANDA_NEW_LANDING` / `PARRANDA_NEW_ANYWHERE` are
  gone with the fallback they selected. **Rollback is now `git revert`**, not an
  env var.
- The committed `frontend/dist` makes the build always present; a deployment
  that somehow lacks it gets a **loud 503** ("Frontend build missing"), never a
  silently wrong page.
- `script.js`'s `anywhereMode` branches are now dead code (no shell ever sets
  the bootstrap flag); removing them is a separate script.js cleanup. The
  curated city shells (`/:city?planner=open`) remain owned by the current
  Express app — that migration has not begun.

## Surface migration rule

Every later migrated surface must prove parity before takeover:

- URL contract stays stable, including `/:city?planner=open` and `/:city/plan` semantics.
- Language contract stays stable: English default, Swedish via `?lang=sv`.
- Bootstrap data contract is either preserved or replaced with documented compatibility.
- Existing behavior is covered by current tests or new equivalent tests.
- Production route ownership changes are explicit in the PR title/body.
- Rollback path is clear: the current Express surface can remain active if the migrated surface is not ready.

## Planner polish boundary

Planner polish ideas from older stale/conflicting work are intentionally outside Astro foundation scope. If still desired, reintroduce them later as focused product PRs, for example:

- “Doesn’t matter” walking option.
- Compact context strip.
- Lightweight home-base input.

These must not be smuggled into frontend foundation work.
