# Parranda — Product Strategy

Working product-principles document. Anchor for product decisions and AI
handoffs. Implementation tables and sprint references are historical snapshots;
they must not override `docs/ARCHITECTURE.md` or the current roadmap in
`docs/PARRANDA_ENGINE_GOALS.md`.

---

## North star

**Trust emotion.** The user must believe Parranda has *better taste than the alternatives* (TikTok, Google Maps, TripAdvisor, friends).

Everything in the product is judged against this single bar.

## Acceptance test for any product decision

> *Does this make the user more likely to say: "holy shit, this actually gets cities"?*

If not, it is not worth shipping — **with one exception**. Work that *protects* this direction is still worth shipping even if it does not produce the feeling directly: maintenance, reliability, tests, i18n, security, debt reduction, and refactors that unblock future product work. The acceptance test applies to user-facing product decisions; supporting work is judged by whether it keeps the user-facing path clear.

## USP framing

Parranda is **not** a POI app, **not** an itinerary generator, **not** a city guide.

Parranda is **timing intelligence + movement intelligence**.

- Google Maps knows *where* things are.
- Parranda knows *when* they are best and *in what order* they feel best.

Concretely, Parranda answers questions Google Maps cannot:
- When does this neighborhood actually come alive?
- Which stop carries the day, and what carries the day after?
- It is raining. What changes about the plan?
- I am here right now. What is the next move?

---

## Three-tier city model

The same engine powers three tiers of city support. The tier a city sits in determines what it is *honest* about.

| Tier | Examples | What it delivers | What it tells the user |
|---|---|---|---|
| **Curated** | Rome; Barcelona moving toward curated; future top cities | Handcrafted route seeds, editorial Pulse, local-truth rules, photo curation | "A local with good taste built this." |
| **Assisted** | Cities with auto-built catalogs that have been partially reviewed | Auto-catalog + human/LLM-reviewed overlays | "Strong baseline with local improvements." |
| **Auto** | Cities served purely from open data + LLM-inferred metadata | Generic catalog-first routing, no fake local flavor | "Baseline route from open data. No false confidence." |

**Critical rule:** auto-tier never fakes local truth. Better to return an honest `noop` ("Pulse is not curated yet for this city") than a hallucinated recommendation.

---

## Feature pillars

| Pillar | Purpose | Current state | Owns |
|---|---|---|---|
| **Signature — Blitz** | "Next move, right now" — the in-the-moment differentiator no other travel app has | Engine works (server/blitz-engine.js). UX surface is thin. Localization missing. | Stand-alone module `blitz-panel.js` (to extract) |
| **Companion — Live walking mode** | Keep user in Parranda *after* they leave home. Replace the "plan → switch to Google Maps" funnel drop. | Not built. | New module + Pulse integration |
| **Credibility — Provenance, photos, memory** | Direct answer to *"why should I trust this?"* | Route credibility surface shipped (#206). Per-stop trust foundation in place (#205). Photos + localStorage memory still pending. | Catalog fields + render layer + localStorage |
| **Foundation — Catalog-first engine** | Multi-city scaling without per-city hacks | Preview routing works for Barcelona. Generic catalog-only builder pending (Issue #52). | server/route-engine.js + new diagnostics + canonical intents |

---

## Engine architecture

The engine is **city-agnostic**. Cities differ in *data*, not *behavior*.

```
City  = data     (catalog, areas, local-truth rules, weather/pulse providers)
Engine = behavior (routing, scoring, intent mapping, area flow, blitz logic)
```

Nuance: there *is* such a thing as city-specific behavior — markets close on Mondays in some cities and not others, beach rhythm matters in coastal cities, etc. The rule is not "no city-specific behavior anywhere." The rule is that city-specific behavior is expressed as **data, config, or pluggable providers** (e.g. `local-truth.js` rules, `routing.tuning` weights, `services.fetchLiveEventsForDates` provider) — **never** as `if (city === "rome")` branches inside shared engine code.

The engine **never** consumes raw provider data directly. The pipeline is:

```
Raw sources (Overpass, Google Places, Eventbrite, city open data, …)
    ↓
Normalized place/event records
    ↓
Quality scoring + dedupe
    ↓
Canonical intents + route roles
    ↓
Runtime catalog (CityConfig-compatible)
    ↓
Planner / Blitz / Pulse / Live
```

Trust metadata travels with every record (canonical field names from `server/place-candidates/contract.js`):

```
trust: {
  source_tier,    // "official" | "verified" | "computed" | "curated" | "editorial" | "inferred" | "fallback"
  confidence,     // "high" | "medium" | "low" | "needs_review"
  human_verified, // boolean
  freshness,      // "live" | "fresh" | "stale" | "unknown"
}
```

Every route stop carries canonical `trust` metadata (shipped in #205). The engine resolves trust automatically: verified catalog stops default to `{ source_tier: "curated", confidence: "high", human_verified: true, freshness: "fresh" }`; provisional source candidates carry `{ source_tier: "inferred", confidence: "needs_review", human_verified: false, freshness: "unknown" }`.

Routes carry a derived `trust_summary` + `credibility_tier` (high / medium / low) computed from the stop trust mix (#206). This is a **separate layer** from `route.confidence` (the thin-city composition signal).

At auto-tier the metadata determines how strongly the recommendation is presented (`high + human_verified` reads differently than `low + inferred`). At curated-tier the user expects "a local built this"; auto-tier without trust metadata cannot make that claim.

---

## What we are NOT building (yet)

These are not "never." They are "not before the product feels magical."

| Not yet | Reason |
|---|---|
| Native iOS/Android apps | PWA is enough at this stage. Native is a year-2 conversation. |
| Photo-recognition discovery | Gimmick risk, high cost, low ROI compared to provenance/live/memory. |
| Voice / audio guides | Edge-case-heavy, low usage at our scale. |
| Stack rewrite (Astro/Solid/React) | Strangler-fig modularization first. No stack decision until ≥60% of script.js is in extracted modules. |
| User accounts | localStorage memory first. Accounts only if multi-device sync becomes a real ask. |
| Social / public route sharing | After the magic exists. Sharing mediocrity does not help. |
| In-app booking flow | Deep-link to TheFork / OpenTable instead. Building a booking pipeline is a different company. |

---

## Process rules

1. **Small atomic PRs.** Mixed-concern PRs are rejected. One PR per coherent change.
2. **Audit before merge, not after.** A real audit asks "does this work in the live product?", not "do the tests pass?" — green tests are a necessary but insufficient signal.
3. **Diagnostics before behavior expansion.** When in doubt, read state before changing state. Build `assessCityRouteReadiness` before you let the engine try harder.
4. **No city-specific hacks in shared engine code.** Per-city specificity lives in `server/cities/<city>/`. Period.
5. **Honest preview > hallucinated confidence.** A `noop` with explanation beats a hallucinated recommendation. The user must always know whether they are inside curated territory.
6. **Don't ship features for hypothetical needs.** Three similar lines beats a premature abstraction.
7. **Files have owners during a sprint.** If both Claude and Codex are touching the same file, one of them stops. Coordinate before commit, not after merge.

---

## Sprint order (live list — updated as we ship)

| # | PR / area | State |
|---|---|---|
| 1 | Shell i18n + Rome DOM cleanup | ✅ merged — PR #65 |
| 2 | GitHub Actions CI | ✅ merged — PR #204 |
| 3 | Thin-city provisional-source honesty | ✅ merged — PR #203 |
| 4 | Canonical stop trust foundation | ✅ merged — PR #205 |
| 5 | Route credibility surface (trust summary + UI) | ✅ merged — PR #206 |
| 6 | Blitz engine i18n (`fix/blitz-engine-i18n`) | Next |
| 7 | Blitz UX surface — extract `blitz-panel.js`, signature presentation | Planned — spec pending |
| 8 | Live walking mode (companion experience) | Planned — spec pending |
| 9 | Route readiness diagnostics (Issue #52 step 1) | Spec in Issue #52 |
| 10 | Canonical intent mapping | Spec in Issue #52 |
| 11 | Generic catalog-first route builder | Blocked by #9 + #10 |
| 12 | Per-city editorial overrides (manifesto / map placeholders) | Backlog |
| 13 | Auto-city infrastructure (Overpass + dedupe + LLM vibe layer) | Long-term — trust model now in place |

The sprint order is *not* a contract. Blitz i18n (#6) may compress with Blitz UX (#7) if the i18n pass exposes the right extraction seam. Live mode (#8) may move earlier if a clear bridge emerges.

---

## Roles

| Agent | Strongest at | Avoid having it do |
|---|---|---|
| **Claude** | Architecture, audit, product/UX reasoning, code implementation when context is already loaded | Acting as merge gate on its own PR — needs a second voice |
| **Codex** | Mechanical refactors, TDD implementation, i18n tokenization, selector renames, "make this test pass" | Open-ended product judgment, scope decisions |
| **GPT** | PR pre-merge audit, scope policing, vision-drift detection, synthesis across long sessions | Adding gates to small atomic PRs where it slows velocity without lifting quality |

**Gating is situational, not always-on:**

| PR type | Gates |
|---|---|
| Pure mechanical (rename, lint, token wiring) | Author audit only |
| i18n / shell / non-behavioral | Author + one second-opinion audit |
| Behavior change in engine (scoring, routing, blitz logic) | Spec → impl → GPT audit → Claude audit-the-audit → merge |
| New architecture (auto-city, trust model, canonical intents) | Full chain: spec audit → impl → audit → audit-the-audit |

---

## When this doc changes

- **Product direction shifts** → update sections above. Note the shift in commit message.
- **Implementation details / sprint mechanics** → use PRs and issues, not this doc.
- **Architectural principles** → only after multi-PR pattern proves the change is real, never speculatively.

The doc is *prescriptive*, not descriptive. If reality drifts from the doc, decide whether reality is wrong or the doc is wrong — and update one of them within the same week.
