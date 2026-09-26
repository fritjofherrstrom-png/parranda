# App architecture and hierarchy — review and direction

**Status:** Review and proposal, written with the September 2026 tidy-up of the
modern landing and planner. It describes what exists, what the tidy-up changed,
and a speculative but concrete direction. It does not override the product
contracts in `docs/PARRANDA_ENGINE_GOALS.md` and
`docs/AGNOSTIC_ENGINE_NORTH_STAR.md`, or the surface rules in
`docs/FRONTEND_MIGRATION_CONTRACT.md`.

**Related:** `docs/ARCHITECTURE.md` (engine layers and ownership),
`docs/PRODUCT_SURFACE_GUARDRAILS.md` (the "Your day" grammar).

## 1. The app as it runs today

Three layers, of very different ages:

```text
┌──────────────────────────────────────────────────────────────────────────┐
│ Modern frontend — Astro static build + two React islands (committed dist)│
│   GET /          LandingHero       choose the day's anchor once          │
│   GET /anywhere  AnywherePlanner   the day, Live, Blitz, saved days      │
│   frontend/src/lib/*.mjs           pure view logic, unit-tested           │
│   anywhere-render-decision.js      shared honesty classifier (repo root) │
├──────────────────────────────────────────────────────────────────────────┤
│ Engine + API — Node/Express (server/)                                    │
│   POST /api/route-recommendations (+ /api/planner-status lifecycle)      │
│   POST /api/live-events   live_event_query_v1 (Live sheet scopes)        │
│   POST /api/blitz         anywhere_contextual_blitz_v1                   │
│   route-engine, planner/*, candidates/*, place-candidates/*, pulse-*     │
├──────────────────────────────────────────────────────────────────────────┤
│ Legacy frontend — index.html + script.js + styles.css (+ ux-pass1.js)    │
│   /:city, /:city?planner=open, /:city/plan  — direct links only          │
└──────────────────────────────────────────────────────────────────────────┘
```

Sizes, to make the weight visible (lines, September 2026):

| Area | File | Lines |
| --- | --- | ---: |
| Legacy client | `script.js` | 12,933 |
| Legacy styles | `styles.css` | 8,613 |
| Engine | `server/route-engine.js` | 7,307 |
| Catalog | `server/catalog.js` | 3,367 |
| HTTP composition root | `server/app.js` | 2,803 |
| Modern planner orchestrator | `frontend/src/components/AnywherePlanner.tsx` | 2,694 |
| Server i18n (mostly legacy shells) | `server/ui-i18n.js` | 1,768 |

The user journey that matters now runs entirely through the modern layer:

```text
Landing ──(typed place | curated city | position)──▶ /anywhere
   │                                                   │
   │ curated city → exact server city key              ├─ compose: /api/route-recommendations
   │ any other text → freeform place intake            ├─ Live sheet: /api/live-events
   │ position → coordinates via sessionStorage         └─ Blitz: /api/blitz
```

Since August 2026 the landing no longer routes anyone into the legacy `/:city`
shells. They survive for old links, which makes the legacy layer — roughly three
quarters of all frontend code (about 25,000 of 33,000 lines) — a maintenance
cost with almost no product traffic.

## 2. Information hierarchy on the day view

### The order a page should answer questions in

1. **Where and how?** — the anchor, the picks, the walking target (context).
2. **What is my day?** — title, honest counts, what the day did for each pick,
   whether it is source-backed, whether it is thin (the plan and its trust).
3. **How do I follow it?** — the map, the ordered stops, the walks between them,
   a route-woven live event (the plan's geometry).
4. **What else is near it?** — optional detour ideas (explicitly not the route).
5. **What is happening now?** — Live (weather, events) and Blitz (one next move).
6. **What did I keep?** — saved days (navigation, not content).

### What the tidy-up moved, and why

| Element | Before | After | Reason |
| --- | --- | --- | --- |
| Anchor + settings | Two stacked bars, "today" stated twice | One card: anchor row + settings row | One place answers "where and how" |
| Honesty lines | Up to four grey lines under the title, two bullet colours, duplicated facts ("external sources" + "source-backed places") | Trust line + day-shape caveats under the title; assembly caveats beside the map | What the day **contains** leads; how it was **assembled** qualifies the evidence it sits next to. Each fact is said once |
| "Local time is derived" | Engine wording | "Local time is inferred from the location" | Say what it means for the reader, not the mechanism |
| Pick coverage | Italic line at the foot of the route card | Chips under the meta line: covered / partly / not in this day | The user's intent is part of "what is my day" |
| Estimates disclaimer | Between title and actions | Map caption | It qualifies the map and the leg numbers |
| Route line | Solid straight segments across water and buildings | Dotted when it only joins the stops' own coordinates, with a caption | Honest geometry: it is an order, not a street path |
| Detour dots | Always on the map, unexplained | Only while the detour list is open | No mark without its explanation |
| Woven live event | Its walk shown only inside the card | Same walk connector as every other stop | One visual grammar for the route |
| Blitz | Small link inside the collapsed Adjust panel | Visible action in the "now" zone below Live, offered only where it can answer (not after an unresolved place or a capacity refusal); its copy says "near you" only for a position anchor | A product pillar should be discoverable, and it belongs with "now" — but never as the answer to a failure it shares |
| Saved days | Above the day, pushing it down | Last on the page | Navigation after content |
| Language switch | Landing only | App bar on both pages; reopens the day as it is on screen, adjustments included, and composes it once; a near-me day hands its position over in storage | Consistent frame; switching language re-opens the same day |
| Near-me day | Asked in the build's default language; titled "A day in your position"; every adjustment asked the browser for the position again | Asks in the page's language; "A day near you"; adjustments, a rebuild and a language switch reuse the position the user chose; the browser is asked only from the explicit "Use my location" tap on a page without one | A label is the page's words, not the request's; a prompt nobody asked for, or a refusal, must not cost the day |
| Split Maps handoff | Two identical "Open part N of M in Maps" buttons before the map | A numbered sequence named by where each stretch starts and ends; only the first is primary | Part 2 is the next step of the same walk, not an alternative to part 1 |
| Unresolved place | "Couldn't compose a day for X" and a Blitz button | "Couldn't pin down X" with how to fix it and a way back | Say which absence it is; offer the step that can work |
| Stop type chip | Raw engine token ("shop", "church") for any unmapped kind | Every kind the sources publish is labelled; an unknown kind shows no chip | A raw token is never product copy |
| Curated chip | "Rom" on the English landing, and "A day in Rom" | Label follows the request language | Server-owned display label per language |
| Curated section | "Extra curated" beside the chips | "Hand-picked in" on its own line above them | Say what a visitor gets, and keep the chips on one row at 320 px |
| Landing search | Two focus rings (square inside rounded); a placeholder cut off at 320 px | One ring on the field, also after a blocked position; "e.g. Lyon or Kyoto" | Visual noise; text that fits |
| Returning visitor | No way back to the last day from the landing | "Continue · A day in …" | The planner already restores it; the landing now offers it |

### Principles for future surfaces

1. **One fact, one place.** An honesty statement sits beside what it qualifies
   and is never repeated in a vaguer form elsewhere.
2. **Two tiers of caveat.** Day-shape limitations (thin day, few places,
   missing kinds of stop) belong in the header. Assembly limitations (estimated
   walking, external-only sources, inferred local time, partial context) belong
   in the route evidence. `day-limitations.mjs` owns the split.
3. **Visual weight follows authority.** Numbered solid markers for the route,
   numbered glow markers for a woven live event, muted dots for optional
   detours, unnumbered dots for candidates. Nothing unsequenced gets a number.
4. **Content, then context, then navigation.**
5. **Icons are decoration.** Every control has visible text or an accessible
   name; the inline SVG set in `components/shared/icons.tsx` replaces Unicode
   glyphs that render differently on every platform.
6. **Mobile first, 44 px targets, one focus contract.**
7. **Say only what is true in this state.** "Near you" only when the anchor is
   the reader's position; "your day stays as it is" only when a day is on
   screen; an action is offered only where it can answer.

## 3. Architecture observations and direction

### 3.1 Frontend

**The planner island is still a monolith.** `AnywherePlanner.tsx` owns about
fifty pieces of state, the compose lifecycle and its race guards, the
commitment ledger, Live queries, Blitz, persistence and most of the markup. The
tidy-up extracted the leaves that need no race-critical state:

```text
components/
  AnywherePlanner.tsx      orchestrator: requests, generations, ledger, render
  shared/AppBar.tsx        wordmark + language (both islands)
  shared/icons.tsx         inline SVG set
  planner/RouteMap.tsx     Leaflet; owns its instance; route vs candidate modes
  planner/LiveSheet.tsx    Live explorer; receives read-only data + 3 callbacks
  planner/LiveEventSource.tsx  "via feed · destination" line, shared
  planner/copy.ts          vocabulary maps and server-reason sentences
  planner/types.ts         response shapes the planner reads
```

`LiveSheet` shows the pattern worth repeating: the rule "the Live sheet can never
change the day" is now structural — the component is not handed anything that
could — and the contract test checks both the component and the props it gets.

Proposed next steps, in order:

1. **A day view-model.** Move the remaining derivations — header meta, pick
   coverage, caveat tiers, timeline items with their walks, the woven event —
   into a pure `lib/day-view.mjs`, unit-tested without a DOM, the way
   `pulse-view.mjs` already works for Live.
2. **Hooks by concern.** `usePlannerCompose` (execute, restore, follow-ups,
   retention), `useCommitmentLedger` (commit, release, applied snapshot),
   `useLiveExplorer` (scope queries and retries), `useBlitz`. The race tests in
   `planner-commitment-races.test.mjs` and friends are the safety net; they
   already test behaviour through the mounted component.
3. **Sections.** `DayHeader`, `StopTimeline`, `DetourIdeas`, `LiveCard`,
   `BlitzCard`, `SavedDays`, each rendering from the view-model.
4. **Small UI primitives.** The same long class strings recur for eyebrows,
   chips, segmented controls and notice cards; a handful of primitives in
   `components/ui/` would make the design system explicit.

**Source-text pins make refactors expensive.** Many contract tests assert that
exact source strings exist (`assert.match(source, /…/)`). They caught real
regressions, but this tidy-up had to re-point a dozen of them. Suggested rule:
keep source pins for *must-never-exist* invariants (no raw engine tokens, no
jargon, no mutators in the Live sheet), and express *must-happen* behaviour
through the mounted harness, which survives restructuring.

**Two i18n systems.** The modern islands use inline `t(sv, en)` pairs; the
server has `ui-i18n.js` for the legacy shells, and also returns some localized
strings (weather headline and pitch, city labels). That is workable for two
languages. Before a third, decide one owner per string: either the server
returns tokens and facts and the client owns copy, or the server owns copy for
everything it composes. Mixed ownership is where "Rom" on an English page came
from.

**Legacy retirement is the biggest simplification available.** Following the
surface-migration rule in `FRONTEND_MIGRATION_CONTRACT.md`:

1. Give the modern planner a curated-city Blitz adapter and recognized-city
   commitment handling (the two things it still hides in curated mode).
2. Redirect `/:city?planner=open` and `/:city/plan` to `/anywhere?city=…`,
   preserving `lang`.
3. Delete `script.js`'s dead `anywhereMode` branches, then the legacy shells and
   their assets, and the unused `landing-proof` page in the Astro build.
   `landing.html` goes too: the retired landing's template is still read into
   `landingShellTemplate` at startup, but nothing renders it (a test still pins
   its asset URLs).

### 3.2 Server

**`server/app.js` is the composition root and the route file at once.** It wires
the seams (place resolver, loaders, event supply, source catalog), renders the
legacy shells and serves every API route. The seams are the right design — they
are what keep the test suite offline. The direction is to keep `buildApp` as the
composition root and move handlers into `server/http/routes/*`
(route-recommendations, planner-status, live-events, blitz, inspect, pages).

**The "experiment" block is product contract now.** The honesty classifier, the
planner and the Live query all read fields inside
`agnostic_route_output_experiment` (promotion caps, intake, source anchor,
pinned-candidate refusals). The name says "experiment"; the dependency says
"public contract". A versioned, server-owned projection — say `day_view_v1`
with stops, walks, caveat tiers, coverage and provenance — would let diagnostics
evolve freely and give the client one stable thing to read, the same way
`live_event_query_v1` and `anywhere_contextual_blitz_v1` already do.

**City context is request-scoped.** The route engine keeps the active city in
`AsyncLocalStorage`, so interleaved requests for different cities cannot see
each other's configuration. Worth preserving through any engine split.

### 3.3 Product hierarchy (speculative)

- **Names.** The README and engine say *Pulse*; the product says *Live*. Keep
  *Live* user-facing and *Pulse* internal, and say so in the README.
- **Above the day.** Saved days are the seed of a trip object. Multi-day plans
  (the "Almanac" in the engine goals) would add a level: trip → days → stops.
  The saved-days list is where that should grow from, not a new surface.
- **Time on the timeline.** Dayparts are the honest granularity today. Clock
  times should appear only when the engine publishes scheduled, source-backed
  times; until then the timeline stays ordered, not scheduled.
- **The anchor stays chosen once.** With the app bar in place it is tempting to
  make the anchor card an inline place switcher. The design handoff chose "the
  anchor is chosen once, then everything is adjustment" and that keeps the
  planner free of a second form; keep it.

## 4. Suggested sequence

1. Hierarchy, honesty placement and leaf extraction (this tidy-up).
2. `lib/day-view.mjs` plus behaviour tests; retire the pins that only duplicate
   them.
3. Hooks split of `AnywherePlanner.tsx`, then sections.
4. `day_view_v1` server projection; the classifier reads it instead of
   experiment internals.
5. Curated Blitz adapter → legacy shell redirects → legacy deletion.
6. Route split of `server/app.js`.
