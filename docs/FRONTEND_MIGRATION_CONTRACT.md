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
- The `/labs/anywhere` alpha shell (`renderAnywhereShell`) is removed. Legacy
  planner links redirect directly to `/anywhere`, preserving their query inputs.
  Without planner intent, both `/labs/anywhere` and `/anywhere` (including their
  trailing-slash variants) redirect directly to `/?lang=en|sv`. **Root's Next stop
  landing is the only place-entry surface**; the planner has no fallback form.
  Intent is nonempty valid place text, valid lat/lng, the consented `anchor=near`
  sessionStorage handoff, or explicit `restore=last` for a local saved snapshot.
  Language/preferences or `planner=open` alone do not imply intent. Snapshot
  resume/language links carry `restore=last`; an absent snapshot offers home.
- The opt-out env flags `PARRANDA_NEW_LANDING` / `PARRANDA_NEW_ANYWHERE` are
  gone with the fallback they selected. **Rollback is now `git revert`**, not an
  env var.
- The committed `frontend/dist` makes the build always present; a deployment
  that somehow lacks it gets a **loud 503** ("Frontend build missing"), never a
  silently wrong page.
- `script.js`'s `anywhereMode` branches are now dead code (no shell ever sets
  the bootstrap flag); removing them is a separate script.js cleanup.

## Modern curated planner entry (2026-08-26)

The landing no longer sends its own curated-city links (then labelled “Extra
curated”, now “Hand-picked in”), or an exact registered-city search, into the
legacy `/:city` shell. Rome and Barcelona now
open the promoted `/anywhere` React planner with both a display label and the
exact server-owned `city` key. The planner sends that key to the existing
`/api/route-recommendations` recognized-city path, so the modern surface renders
the rich citypack route rather than demoting it to ordinary freeform/agnostic
intake.

The browser accepts a curated response only when the server returns the same
`city`, the same `requested_city`, `city_fallback_used: false`, a server-owned
`city_label`, and a non-empty primary route. Mismatch, fallback, missing label,
or empty output fails closed. Save, restore, recompose, and share preserve the
bounded city key. Direct legacy `/:city` URLs remain available for compatibility,
but the frontpage no longer advertises or routes into them. Until the modern
surface has a citypack-aware Blitz adapter and recognized-city commitment
handling, it hides those actions in curated mode rather than silently invoking
the freeform contracts.

## Shared place Planner entry (2026-10-07)

This supersedes the modern curated entry section above for public/beta/preview
citypacks. Exact registered names/aliases now send only the canonical place
label to `/anywhere`; all modern UI requests use freeform/coordinate intake,
modern rhythm, the existing engine-compose flags and the shared honesty gate.
Old `/:city`, `/:city/plan` and `/anywhere?city=…` links redirect to that same
Planner, preserving language, day/rhythm/preferences and an explicit coordinate
or session GPS handoff. A registered key supplies a server-owned label only;
unknown paths remain 404 and internal test-city shells stay internal previews.

The catalog files are retained. After trusted place resolution, their individual
nearby real places enter the existing five-kilometre curated-supply boundary,
with original identities, provenance, weekday closures and normal shared gates.
A citypack never selects a template or an alternate UI in the modern flow.
Unmodified legacy recognized-city API clients retain their compatibility path.

MapLibre, candidate Add/Keep/Remove, Live exploration and Blitz now have the same
UI/UX and contracts for every modern place. Source coverage remains independent:
the shared UI cannot promise events or a day when the server cannot verify them.
Old saved snapshots remain stored/displayable; recompose and newly shared links
use place intake. No storage, catalog or deploy settings are removed. The existing active city
Live sources migrate to geographic rows in the reviewed feed manifest: BCN
CKAN, Turismo Roma listing and Athens city/venue calendars. Reuse terms remain
explicitly unknown; collection contains only factual atoms and attribution.
BCN/Rome single dates are listed occurrences, ranges stay periods and both
feeds remain Pulse-only. Geometry, selected-date and duration gates remain
shared. Venue clocks use an IANA timezone, including Athens winter time. Rollback is a source revert plus rebuild of committed `frontend/dist`.

Verification: `tests/unified-city-entry.test.js` exercises redirects and real
composition for registered catalogs and a source-backed control;
`tests/unified-city-planner-browser.test.js` drives the built UI in Chromium for
Rome, Barcelona, Athens and Stockholm (map, Keep/Remove/Add, selected-day Live).
`tests/unified-city-live-sources.test.js` proves geographic source selection,
selected-day supply through the real Live API, date-only semantics, IANA winter
and summer conversion, final geometry/duration rejection and acquisition bounds.
Legacy contrast audits use explicit internal renderer fixtures.
The browser uses controlled API responses and refuses external hosts. This is
UI contract evidence, not live-provider, phone or deployed-runtime acceptance.

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
