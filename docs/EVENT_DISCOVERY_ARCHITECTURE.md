# Responsive live-events runtime — QA + UX companion to source discovery

**Status:** Proposed (investigation, no code). **Date:** 2026-07-20.
**Scope:** this is the *runtime + UX* companion to
[`LIVE_EVENT_SOURCE_DISCOVERY.md`](./LIVE_EVENT_SOURCE_DISCOVERY.md), which is the
authority on the discovery *method* (source families, evaluation, extraction
tiers, trust scoring, the offline scout harness). It does **not** re-specify any
of that. It adds two things that doc leaves open: fresh QA of what a user sees
today, and the front-of-house model for loading events responsively in the
background.

## Why this exists

The owner asked for the engine to "scout and source events in real time and
present them regardless of location", loaded responsively in the background. The
discovery *method* for that is already designed and partly built (see the
companion doc + `server/pulse-sources/source-discovery.js`,
`local-live-source-graph.js`, `local-event-source-scout.js`). This doc measures
the current user-visible gap and proposes the runtime/UX layer on top.

## 1. What a user sees today (QA, 2026-07-20)

Multi-city probe of `POST /api/live-events` (`around_place` / `tonight`), dogfood
server (Helsinki fixture + Simrishamn Sitevision configured):

| Place | Coverage | Sources selected | Events | Latency |
|---|---|---|---|---|
| Helsinki | covered | 1 | 6 / 6 | 62 ms |
| Simrishamn | covered (pending) | 1 | warming | 78 ms |
| Malmö | **uncovered** | **0** | 0 | 37 ms |
| Lyon | **uncovered** | **0** | 0 | 10 ms |
| Barcelona | **uncovered** | **0** | 0 | 6 ms |
| Kraków | **uncovered** | **0** | 0 | 8 ms |
| Kyoto | **uncovered** | **0** | 0 | 9 ms |
| Tbilisi | **uncovered** | **0** | 0 | 13 ms |
| Reykjavík | **uncovered** | **0** | 0 | 69 ms |

**7 of 9 places select zero sources and settle `uncovered` in 6–13 ms.** The low
latency is the point: nothing is attempted at request time.

## 2. Why (and how it lines up with the discovery doc)

- Live source selection is **static bbox containment** over the approved
  registry (`resolveEventFeedsForAnchor` → `feedCoversAnchor`). No registered
  bbox and no global key ⇒ `selected_source_count: 0` ⇒ instant `uncovered`.
- The discovery scout **is built, but offline by design.** Per the companion
  doc: *"User requests never perform this discovery crawl… an operator may
  promote the proposed row into `PARRANDA_EVENT_FEEDS`."* Its **"Runtime
  Strategy"** section already envisions a bounded a-la-minute path — but marks it
  *future* and *opt-in/gated until source families are proven*. That runtime
  wiring is the missing piece, and it is exactly what the owner's request is
  asking to prioritise.
- The trusted resolver currently **drops the admin hierarchy**
  (`place-resolver.js`, `addressdetails=0`), so the runtime path can't yet target
  discovery by country/municipality. (The discovery doc's step 1 assumes
  city/country/bounds are carried in — so this is a shared prerequisite.)

## 3. The gap this doc owns: responsive front-of-house

The companion doc stops at acquisition ("Pulse, dayflow, and route composition
remain downstream consumers"). What it does not specify — and what the owner's
"load in the background until suggestions surface" is about — is the runtime
*state machine and streaming UX*:

- **`uncovered` is terminal today.** The warm-cache + frontend poll
  (`LIVE_REFRESH_DELAYS_MS`) already stream for *registered-but-pending* sources
  (Simrishamn, 78 ms), but an unregistered place is declared empty in 10 ms and
  never revisited. A runtime scout needs a state that says "still looking",
  distinct from "known source, warming" and "finished, nothing real".
- **Proposed states:** `scouting` (a runtime discovery pass is in flight, no
  approved source resolved yet) → `pending` (source resolved, warming) →
  `covered` / `uncovered` (settled). `uncovered` becomes the *settled* answer
  after the scout completes, never the instant one.
- **Streaming:** the day/route never waits on events (already true). The events
  layer returns fast with `scouting`, runs the bounded discovery+collect in the
  background (reusing the source cache), and the Pulse card + Live sheet fill
  progressively as sources respond. The frontend poll loop already exists —
  extend it to keep polling through `scouting`, not only `pending`.
- **Honesty unchanged:** partial coverage never reads complete; a scout that
  finds nothing real settles to honest `uncovered`; discovered runtime sources
  still pass every acquisition gate in the companion doc and the 5 gates in
  `KEYLESS_GLOBAL_EVENTS_INVESTIGATION.md`.

## 4. The decision this surfaces (for owner + Codex)

The scout is deliberately offline-and-operator-reviewed. The owner's request is
for real-time, any-place scouting. These meet at Codex's own **"future runtime
path"**. The open decision is **whether to build that path now, and how gated**:

- **Option A — wire the runtime path (gated).** Add a bounded, opt-in runtime
  discovery pass in front of collection, using the built scout/evaluator against
  *pre-vetted source families* (not arbitrary URLs), with the responsive
  streaming UX above. Highest fidelity to the owner's ask; touches the
  Codex-owned supply core; must keep the operator-review guarantees for anything
  that isn't a pre-vetted family.
- **Option B — responsive UX first, offline discovery still.** Ship §3 (the
  `scouting` state + streaming) on the *existing* sources and let discovery keep
  feeding `PARRANDA_EVENT_FEEDS` via the operator harness. Lower risk, makes
  registered places feel alive, but coverage still grows by operator promotion,
  not per-request.
- **Prerequisite either way (Phase 0):** the resolver keeps structured admin
  identity (`country_code`/`state`/`city`) as *trusted server-side data* (never
  the public payload), so any runtime discovery can be targeted.

## 5. Coordination

The discovery method + scout code are **Codex's** (`LIVE_EVENT_SOURCE_DISCOVERY.md`,
`source-discovery.js`, `local-live-source-graph.js`, `local-event-source-scout.js`,
#352–#363). This doc is deliberately scoped to the QA + the runtime/UX layer so it
does not duplicate or override that design — it points at it. Any build against
the supply core is a joint decision with Codex; the responsive-UX/poll-loop part
is frontend-adjacent to work already landed. No code changes here — this is the
shared reference the owner asked to decide direction and ownership from.
