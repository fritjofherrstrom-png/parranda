# Parranda Experience Inspection — what works, what's hidden, the path to the vision

**Status:** Living product inspection · **Date:** 2026-07-01
**Method:** Feature-level inspection (multi-agent, one inspector reading the real code per user-facing function) + synthesis. Companion to the engine-internals review in `ENGINE_ARCHITECTURE_AUDIT.md`.
**Vision (owner's words):** arrive in any place → see what's on tonight/this week → get a perfect route for your mood + time (real-time aware) → Blitz suggests the next place from wherever you are — from a big supply of candidates + events, engine knowing what to premiere. **Any city, no manual per-city work.**

---

## Headline: the engine is smart, the PRODUCT hides it

A user who types Barcelona or Rome gets an honest, rendered "Your day across the city" district plan with walking legs, an evening event anchor, and trust-aware copy — and (verified) **the freeform planner box already routes any typed place to a live agnostic compose** with the open-data loader enabled in prod. But it does **not yet feel like the vision**, because the smartest outputs are **invisible or contradicted**: every agnostic city has an empty Map tab, the district plan hides the actual stop names, live events reach only Helsinki, and all landing copy says "we're live in Barcelona and Rome." **The single biggest thing between here and the vision is closing the say/do gap** — making the already-built agnostic capability discoverable, spatial, and concrete, instead of a text summary gated behind two-city copy.

Every feature scored **partial** — not because the engine is broken, but because its output is hidden, contradicted, or broken at the last render inch.

## Health map

| Feature | Status | Verdict |
|---|---|---|
| **Blitz** (next place from anywhere) | partial | Engine + tested agnostic coord path exist, but **NO UI ever sends coords/candidate_mode** → the wildcard is dead-wired; landing GPS dead-ends; honest "no result" renders as a crash. |
| **Live events** (what's on tonight/this week) | partial | Honest, well-architected, rendered — but **Helsinki-only in prod** (`PARRANDA_EVENT_FEEDS` unset), times render in the **viewer's** timezone (bug), cold "pending" never self-resolves. |
| **Planner / Your Day** | partial | Genuinely agnostic + honest, but concrete **stop NAMES discarded at render**, two districts collapse to the same "Midday" badge, floats above a disconnected flat route. |
| **Any-city doorway** (/labs/anywhere) | partial | **Fully wired from the main planner box (verified)** but invisible + actively contradicted by "we're live in Barcelona and Rome" copy; Blitz button rejects the same input the planner accepts. |
| **Weather / time / daypart** | partial | Rich context computed + "Today's read" headline shown, but the weather lean is **narrated, not applied** (stops unchanged on rain); per-stop daypart is inspect-only. |
| **Frontend / UX / mobile** | partial | Engine output faithfully surfaced as DOM, but the **Map tab returns [] for EVERY non-Rome city** (verified) → the spatial intelligence is invisible exactly where it matters. |
| **Citypacks + trust/honesty** | partial | Credibility layer is end-to-end + disciplined, but provenance (curated vs live-derived) is **never shown as a label**, and the flagship agnostic route wears an apologetic "Simple route" hedge. |
| **i18n + onboarding** | partial | Static i18n complete (854 keys, parity), but **zero onboarding**, landing "Live Pulse" is fake static teaser copy, EN users silently lose all local-truth notes. |

## Biggest broken / missing (what a user notices first)

1. **Empty Map for every agnostic city** — `getFrontendPlaces()` returns `[]` unless Rome (script.js:2506); the whole any-city thesis is a blank Map tab. district_day areas don't carry centroids to the frontend, so a map can't currently be drawn.
2. **The any-city doorway is invisible AND contradicted** — the planner box already routes freeform text to a live agnostic compose, yet all landing copy says "We're live in Barcelona and Rome. Try one of those." (ui-i18n.js:614/1471) with no visible link to the doorway.
3. **Live events Helsinki-only in prod** — render.yaml enables `PARRANDA_AGNOSTIC_EVENTS` but never sets `PARRANDA_EVENT_FEEDS`, so Rome/Barcelona/Porto/Valencia all return "no feed reaches this place."
4. **Event times in the wrong timezone** — `formatLiveEventWhen` renders with no `timeZone` option (script.js:11319), so a Helsinki 20:00 gig shows in the viewer's wall-clock — a wrong time on the one feature whose whole value is "tonight."
5. **The district plan hides its best output** — stop names per district are computed but the UI shows only a count ("3 stops").
6. **Blitz "next place from anywhere" never runs for users** — the tested coord path exists but no frontend sends coords; landing GPS dead-ends.
7. **Honest "no result" renders as a crash** ("Något gick fel") — the product feels broken precisely where it's being honest.
8. **Cold live-events "pending" never self-resolves** — the UI says "reload in a moment" and never polls the warmed cache.
9. **No onboarding at all** — a new user sees "Next stop?" + a search box with zero explanation; the landing "Live Pulse" is fake static presented as live.

## Top experience improvements (ranked by leverage)

| # | Improvement | Feature | Impact/Effort |
|---|---|---|---|
| 1 | **Rewrite two-city landing copy + a visible any-city entry** — the core promise is already wired; a copy edit unlocks the whole product | doorway/i18n | high / **low** |
| 2 | **Draw districts on the Map tab** — numbered walking arc, colored by daypart (engine must emit centroids + stop coords) | frontend/planner | high / high |
| 3 | **Show the actual stop NAMES in each district card** — abstract "3 stops" → concrete itinerary | planner | high / **low** |
| 4 | **Render event times in the EVENT's timezone, not the viewer's** | live events | high / **low** |
| 5 | **Broad open-events feed rows so coverage isn't Helsinki-only** (`PARRANDA_EVENT_FEEDS` metro bboxes) | live events | high / high |
| 6 | **Wire the agnostic coordinate Blitz** into the landing GPS dead-end + honest "no result" | Blitz | high / med |
| 7 | **Make the Blitz button agree with the planner on freeform input** | Blitz/doorway | med / **low** |
| 8 | **Auto-resolve the "pending" live-events state** (poll the warmed cache, no manual reload) | events/frontend | high / med |
| 9 | **Fix daypart coherence** — de-dup so no two districts share "Midday" | planner | high / med |
| 10 | **Surface provenance + replace the internal word "citypack" in user copy** ("Built live from the map for X") | trust | high / **low** |
| 11 | **Per-stop daypart chips from the real `stop.daypart`** | weather/time | high / **low** |
| 12 | **Make the weather lean actually reshape the day** (feed it into candidate scoring so the honest copy stays true) | weather/time | high / high |

## Path to the vision (in order)

1. **Cheap experience sprint (mostly copy/wiring, NO engine work):** rewrite the two-city copy + add a visible any-city entry; unify the Blitz button with the planner; forward stop names into district cards; per-stop daypart chips; surface provenance in one line; fix the event timezone render; auto-poll the "pending" events; turn the honest "no result" into the engine's real reason instead of a crash. → makes the built engine **discoverable, concrete, trustworthy**.
2. **Spatial sprint (frontend + a small engine emit):** the engine emits district centroids + stop coords; feed the Map tab from `district_day` so every agnostic city shows a numbered walking arc — the biggest "feels smart" lever.
3. **Engine work:** make the weather lean actually reshape candidate selection; fix daypart de-duplication so the day moves through time.
4. **Infra / supply:** add broad open-events feed rows so "what's on tonight" covers real cities; promote live events to walking-validated route stops. Onboarding + a real Pulse feed follow.

## Completeness — not covered here
Accessibility (a11y/contrast/keyboard), performance/bundle size, analytics/observability of real usage, saved-routes/favorites/almanac surfaces, error/empty states beyond the two named crashes, and the PWA/offline experience. Each deserves its own pass.
