# Barcelona Beta Readiness

**Audit date:** 2026-05-25
**Last updated:** 2026-05-25 (post #169, #170 investigation)
**Branch:** `docs/barcelona-beta-final` (from main after #169)
**Verdict: Ready for friend beta. One known caveat on 5-day second-hand trips.**

---

## Quick summary

Barcelona has a solid catalog (101 items, 7 route templates), passes all tests, and works well for 1–3 day trips. B2 (missing `tapas`/`vermut`/`café` intent tags) was fixed by PR #169. B1 (5-day second-hand template repetition) remains a known caveat — investigation in PR #170 showed this is an engine-level scoring issue (`areaScore` corridor dominance), not fixable by template additions alone. Documented in `ENGINE_LEARNINGS.md`. B1 is not a blocker for 1–3 day friend beta.

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

### B1 — Template repetition on 5-day second-hand routes (known caveat, not a beta blocker)

**Status: open, engine-level. Not fixable by template/catalog changes.**

Only 2 of 7 route templates have `second_hand` or `vintage` in their `preferenceTags`. The 5-day stress test repeats `encants-to-coast-drift` and `sant-antoni-food-bar-flow` on days 4 and 5.

PR #170 attempted to fix this by adding a `born-eixample-vintage-drift` template. Investigation showed the template never becomes primary because `areaScore` (±13–16 points from auto-anchor corridor matching) dominates `preferenceScore` (+3 per tag) and the reuse penalty (−6). The auto-anchor corridor stabilizes around Raval/Gothic → Poblenou, locking the engine to the same two templates. Dynamic stop realization (`buildStopPool`) further erases template geographic identity.

**Conclusion:** This is an engine-level issue. Future fix should address `routeScore` reuse-penalty scaling, corridor diversity, or `areaScore` decay. See `docs/ENGINE_LEARNINGS.md` §3.

**Impact on beta:** 1–3 day trips are not affected. Only 5-day pure second-hand/vintage trips show repetition. Acceptable for friend beta.

### ~~B2 — Missing intent tags: `tapas`, `vermut`, `café`~~ (fixed)

**Status: fixed by PR #169.** Added `vermut`, `tapas`, and `café` tags to 12 catalog items. Intent queries now return hits.

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

## 8. Recommended next PRs (post-beta)

### PR 1 — `fix(route-engine): improve multi-day diversity scoring`
**Scope**: Engine-level. Increase reuse penalty, add corridor diversity, or decay `areaScore` when reuse is active.
**Why**: Fixes B1 (5-day repetition). This is the real fix — template additions alone do not work.
**When**: After friend beta feedback confirms it matters for real users.

### PR 2 — `feat(barcelona): second-hand clothing anchors wave 2` *(optional)*
Next batch of ~10 catalog entries from the shortlist in #140.
**When**: After beta feedback. Not urgent.

### PR 3 — `feat(barcelona): additional route templates` *(optional)*
Rainy-day/museum, beach/coast morning, café/breakfast loops.
**When**: After beta feedback identifies which gaps matter most.

---

## 9. What NOT to do before beta

- **No route engine scoring changes** — B1 is real but not a beta blocker; collect feedback first
- **No new citypack architecture** — registry, readiness, and provider patterns are stable
- **No full catalog expansion** — 101 items is sufficient
- **No design system rewrite** — UI is functional post-#167
- **No Athens work** — Athens is not in scope for this beta
- **No Planner/Blitz structural changes** — planner works for 1–3 day trips
- **No new snapshot mass-additions** — 4 snapshots cover the key paths
- **No template additions to fix B1** — PR #170 proved this does not work (areaScore dominates)

---

## 10. Can Fritjof beta-test Barcelona now?

**Yes. Ready for friend beta.**

Works well:
- 1–3 day trips: no repetition, correct stops, correct CTA behavior
- Thematic routes: culture, evening, vintage, coast, mat & dryck, second hand
- Intent queries: tapas, vermut, café, second hand, vintage, kilo, market (all return hits after #169)
- Walking directions open correctly via Google Maps
- Route guide drawer opens correctly
- Mobile layout functional

Known caveats (3):
1. **5-day second-hand/vintage trips repeat templates on days 4–5.** Engine-level issue, not a crash. Most friend-beta trips will be 1–3 days.
2. **Sants area is thin** (3 items). Routes touching Sants may feel sparse. Not a blocker.
3. **No rainy-day/museum-only template.** Engine falls back to culture-tagged templates, which works but is not purpose-built.

**Do not do route-engine work before this beta.** Collect real feedback first.
