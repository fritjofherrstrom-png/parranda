# Barcelona Beta Readiness

**Audit date:** 2026-05-25
**Branch:** `audit/barcelona-beta-readiness` (from main after #167)
**Verdict: Almost ready. Can be beta-tested now with one known caveat.**

---

## Quick summary

Barcelona has a solid catalog (101 items, 7 route templates), passes all 534 tests, and works well for 1–3 day trips. Two data gaps need fixing before an honest public beta: missing `tapas`/`vermut`/`café` intent tags and route template repetition on 5-day+ second-hand routes. Neither is a runtime crash. Both are fixable in two focused PRs: one catalog tag PR, one route-template PR.

---

## 1. City data state

```
Total items:     101
Real places:      95
Structural anchors: 6
Route templates:   7
Tests:         534/534 pass
Missing coords:    0
Missing searchTerms: 0
Duplicate IDs:     0
```

**Area distribution (real places):**

| Area | Items |
|------|-------|
| gracia | 16 |
| eixample | 12 |
| born-sant-pere-santa-caterina | 13 |
| poblenou | 11 |
| raval | 10 |
| gothic | 9 |
| montjuic | 7 |
| sant-antoni | 8 |
| poble-sec | 6 |
| barceloneta | 6 |
| sants | 3 |

**Sants is thin** (3 items). Not a blocker but next catalog wave should prioritise it.

---

## 2. Top beta blockers

### B1 — Template repetition on 5-day second-hand routes (medium)

Only 2 of 7 route templates have `second_hand` or `vintage` in their `preferenceTags`:
- `raval-vintage-shopping-loop`
- `encants-to-coast-drift`

A third template (`sant-antoni-food-bar-flow`) has `mat`/`nattliv` and gets picked up via fallback scoring when no second-hand template fits the day.

The 5-day second-hand stress test (`auto-second-hand-five-day-stress.json`) produces:

| Day | Template |
|-----|----------|
| 1 | sant-Antoni-food-bar-flow |
| 2 | encants-to-coast-drift |
| 3 | raval-vintage-shopping-loop |
| 4 | **encants-to-coast-drift** ← repeated |
| 5 | **sant-Antoni-food-bar-flow** ← repeated |

Days 2/4 and Days 1/5 use the same template. On a real 5-day trip this produces nearly identical stops twice.

**Fix**: Add 1 more second_hand-tagged template (e.g., a Born/Eixample vintage loop anchored at `cotton-vintage`, `loisaida`, `revolution-vintage`). One template addition breaks the repetition.

### B2 — Missing intent tags: `tapas`, `vermut`, `café` (medium)

These tags appear 0 times in the catalog. Places that are tapas bars, vermut spots, or cafés are only discoverable if the user queries their proper name or searches "second hand" / "vintage" — the intent-based path is broken for:

| Intent | Tagged items | Name/searchTerms mentions |
|--------|-------------|--------------------------|
| `tapas` | 0 | 4 items mention it |
| `vermut` | 0 | 4 items mention it |
| `café` / `coffee` | 0 | 2 items mention it |

38 items have the `mat` tag but `mat` is too broad for intent matching.

**Fix**: Add `tapas`, `vermut`, and `café` tags to the ~10 items that warrant them. This is a catalog-only change, no runtime code.

---

## 3. Route template coverage

| Template | preferenceTags (summary) | 5-day second-hand risk |
|----------|--------------------------|------------------------|
| gracia-local-evening-loop | kultur, mat, vin, nattliv, low-key | not picked for second-hand |
| sant-Antoni-food-bar-flow | mat, vin, nattliv, cocktail, market | over-used as fallback |
| born-santa-caterina-culture-wine-loop | kultur, vin, market | not picked for second-hand |
| gothic-raval-cultural-connector | kultur, shopping, hidden gems | not picked for second-hand |
| poble-sec-montjuic-evening-arc | mat, vin, utsikt, nattliv, party | not picked for second-hand |
| encants-to-coast-drift | coast, market, second_hand, shopping | ✓ used, repeats day 2/4 |
| raval-vintage-shopping-loop | vintage, second_hand, shopping | ✓ used, OK |

7 templates is a reasonable v1 set for 1–3 day trips. The gap is only felt on 5-day second-hand routes.

**Missing template slots worth noting (not beta blockers):**
- No rainy-day/museum-only template
- No beach/coast morning template
- No pure café/breakfast loop

---

## 4. Scenario snapshots

4 Barcelona scenarios in `tests/scenarios/barcelona/`, all pass:

| Snapshot | Status | Notes |
|----------|--------|-------|
| `auto-second-hand-multi-day` | ✅ | 3-day, no repetition |
| `auto-second-hand-five-day-stress` | ✅ | 5-day, repetition documented |
| `manual-raval-vintage-loop` | ✅ | passes |
| `manual-gracia-sant-Antoni-arc` | ✅ | passes |

Current snapshot set is sufficient for beta. No new snapshots needed unless a new template is added (in which case: add one snapshot for it).

---

## 5. Candidate pack

```
Pack:           barcelona-second-hand-v0
Status:         intake_only
Candidates:     18 (8 area_preset, 5 event_venue, 4 generated_place, 1 real_place)
Confidence:     all needs_review
Hard errors:    0
Warnings:       0
```

Pack is valid and honest. No candidates are runtime-promoted. This is correct — the pack is an editorial intake doc, not a live provider feed. No action needed before beta.

---

## 6. UX sanity (post-#167)

- **Primary CTA**: Walking route opens Google Maps directions (correct, `<a>` tag with `routeLink` href)
- **Secondary CTA**: "Se guide" / "Route guide" opens in-app route guide drawer (correct)
- **Pulse teaser pill**: `border-radius: 18px` (card, not blob) when in day-handoff context
- **Mobile sticky actions**: Background hue removed

No beta-blocking UX issues identified. The CTA hierarchy introduced in #167 is functionally correct.

---

## 7. Source honesty spot-check

The 101-item catalog has items at varying confidence levels. The `provenanceById` block in `catalog.js` contains per-item sourcing. Spot-check of the recent second-hand additions shows:
- All coordinates sourced from Nominatim/OSM, cited in `source_note`
- `needs_human_verification: true` on medium-confidence indie operators (Lullaby, Loisaida, Revolution, Neko)
- Humana entries correctly use `official_site` with conservative `why_included` wording
- No overconfident entries found

Data honesty is acceptable for beta. The `intake_only` pack status accurately reflects what has not yet been verified.

---

## 8. Recommended PR sequence (max 3)

### PR 1 — `fix(barcelona): add tapas/vermut/café intent tags`
**Scope**: Catalog-only. Add `tapas`, `vermut`, `café` to the ~10 items that warrant them.
**Why first**: Fixes silent intent failure. Zero runtime risk. Tests stay green.
**Files**: `server/cities/barcelona/catalog.js` only.

### PR 2 — `feat(barcelona): add second-hand template for Born/Eixample arc`
**Scope**: Add 1 route template that covers the Eixample/Born second-hand cluster. Anchor stops: `cotton-vintage`, `loisaida`, one supporting stop (e.g., `museu-picasso` or `holala-plaza`). Add a matching scenario snapshot.
**Why second**: Breaks 5-day repetition. Required before Barcelona is honest as a multi-day second-hand destination.
**Files**: `server/cities/barcelona/catalog.js`, new snapshot, test count update.

### PR 3 — `feat(barcelona): second-hand clothing anchors wave 2` *(optional, can wait)*
Next batch of ~10 catalog entries from the shortlist in #140: Le Swing, Los Féliz, Arepa Queer, Vilde, Manifesto, Holala Tallers, Kilostore, etc. Can wait until after beta feedback.

---

## 9. What NOT to do before beta

- **No route engine refactor** — engine works, all smoke tests pass
- **No new citypack architecture** — registry, readiness, and provider patterns are stable
- **No full catalog expansion** — 101 items is sufficient; more items don't fix B1 or B2
- **No design system rewrite** — UI is functional post-#167
- **No Athens work** — Athens is not in scope for this beta
- **No Planner/Blitz structural changes** — planner works for 1–3 day trips
- **No new snapshot mass-additions** — 4 snapshots cover the key paths

---

## 10. Can Fritjof beta-test Barcelona now?

**Yes, with one known caveat.**

Works well:
- 1-day and 2–3-day trips: no repetition, correct stops, correct CTA behavior
- Any thematic route (culture, evening, vintage, coast): route engine picks appropriate templates
- Walking directions open correctly
- Route guide drawer opens correctly
- Intent queries via tag filtering (shopping, lokalt, low-key, kultur, etc.)

Known issue:
- 5-day second-hand/vintage trips repeat encants-to-coast-drift and sant-Antoni-food-bar-flow on days 4 and 5. Not a crash, just stale content. Fix is in PR 2 above.

**Start testing now. File PR 1 this week. File PR 2 before sharing with others.**
