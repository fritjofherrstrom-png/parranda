# Engine Learnings

This file captures reusable product and engine lessons from Barcelona catalog expansion, route snapshots, and the city-pack tooling work.

The purpose is not to document one-off city quirks. The purpose is to turn observed behavior into engine rules, test anchors, and agnostic design hooks that can apply to Barcelona, Rome, Athens, and future citypackless mode.

## How to use this file

When a report, audit, snapshot, or PR reveals a behavior worth keeping, record it as:

- **Observation** — what happened in the product or tests.
- **Generic rule** — the reusable rule the engine should learn.
- **Current anchor** — PR, test, snapshot, or file that proves the behavior.
- **Applies to** — city-specific, all citypacks, or agnostic mode.
- **Future hook** — where the rule should eventually live.

Avoid turning this into a backlog dump. If a lesson does not imply a product rule, test anchor, or engine hook, it probably does not belong here.

---

## 1. Search and local vocabulary

### Lesson: user language is not the same as catalog tags

**Observation**

After the first Barcelona second-hand runtime batch, the catalog had many `second_hand` entries but user-style searches like `second hand` and `kilo` did not resolve. The fix added spaced English aliases to every `second_hand` entry and a bare `kilo` alias for Flamingos Vintage Kilo.

**Generic rule**

Search and intent matching must bridge:

```txt
canonical intent -> local terms -> user aliases -> local brands/formats -> false friends
```

A tag such as `second_hand` is an internal vocabulary token. It is not enough by itself. Users type natural phrases, local-language variants, category slang, and brand-like formats.

**Current anchor**

- PR #147: Barcelona search terms for `second hand` and `kilo`.
- `tests/barcelona-search.test.js`.

**Applies to**

- All citypacks.
- Agnostic mode.

**Future hook**

- `server/intents/canonical-intents.js`
- `server/intents/local-vocabulary.js`
- `server/intents/expand-intent.js`
- Search/index layer that returns multiple ranked matches, not only exact-key `findItemByName` hits.

### Lesson: exact alias hits are a bridge, not the final search engine

**Observation**

`findItemByName` resolves exact normalized strings. Shared aliases such as `second hand` can only resolve to one last-inserted item because of map overwrite semantics.

**Generic rule**

Alias additions are acceptable as immediate UX fixes, but real search should become multi-result, tokenized, ranked, and intent-aware.

**Current anchor**

- PR #147 notes this limitation explicitly.

**Applies to**

- All citypacks.
- Agnostic mode.

**Future hook**

- Search provider / candidate retrieval layer.
- LocalIntentVocabulary expansion.
- PlaceCandidate ranking.

---

## 2. Unknown data semantics

### Lesson: missing schedule data means unknown, not open and not crash

**Observation**

Barcelona catalog entries intentionally omitted `closedWeekdays` when hours were not verified. A later route-engine path crashed because it assumed `closedWeekdays` always existed.

**Generic rule**

Missing operational data should be treated as **unknown**:

```txt
missing schedule != open every day
missing schedule != closed
missing schedule != crash
```

The engine may still use the place, but should keep confidence honest and surface uncertainty where relevant.

**Current anchor**

- PR #142: defensive `closedWeekdays` handling.
- Barcelona #141 catalog entries that omit `closedWeekdays` when hours are not strongly sourced.

**Applies to**

- All citypacks.
- Agnostic mode, especially map/search-derived candidates.

**Future hook**

- Opening-warning surfacing.
- PlaceCandidate confidence model.
- Readiness diagnostics for schedule coverage.

### Lesson: incomplete data can still be useful if trust is explicit

**Observation**

Barcelona entries with medium confidence and `needs_human_verification: true` are still useful for routing when address/category/provenance are stable. The system should not require perfect curation before a place can contribute.

**Generic rule**

Use trust tiers instead of binary inclusion/exclusion:

```txt
curated/high-confidence
operator/address verified
map/search-derived
needs human verification
unknown schedule
```

**Current anchor**

- PR #141: Barcelona second-hand anchors.
- PR #143: broad Barcelona catalog expansion.
- PR #144: city-pack readiness diagnostics.

**Applies to**

- All citypacks.
- Agnostic mode.

**Future hook**

- PlaceCandidate source mix.
- RouteCandidate trust explanation.
- UI labels for inferred vs curated recommendations.

---

## 3. Route diversity

### Lesson: more catalog density does not automatically produce better routes

**Observation**

Barcelona expanded from a thin preview catalog to 100 total items, but route behavior still needed inspection. Scenario snapshots show that 3-day vintage diversity is good, while 5-day trips still reuse templates.

**Update (PR #152):** The Raval-density gap was closed tactically at the citypack/template layer by adding a `raval-vintage-shopping-loop` template and a `raval-gothic-route-anchor`. The 5-day vintage stress snapshot now picks up the new template on day 3 and routes through the Raval/Gothic anchor on days 2 and 5. The broader multi-day template-reuse lesson below still applies.

**Generic rule**

Planner quality depends on more than catalog size. Multi-day trips need explicit diversity logic:

- template cooldown
- stop cooldown
- repeated area penalty
- area novelty bonus
- intent coverage across days
- maximum reuse guardrails

**Current anchor**

- PR #143: broad Barcelona catalog expansion.
- PR #149: Barcelona scenario snapshots.
- `tests/scenarios/barcelona/auto-second-hand-five-day-stress.json`.

**Applies to**

- All citypacks.
- Agnostic mode.

**Future hook**

- RouteCandidate scoring.
- Multi-day itinerary composer.
- Scenario snapshot metrics.

### Lesson: template rotation and stop rotation are different problems

**Observation**

A route can rotate templates while still reusing too many stops, or produce unique stops while repeating the same template family. Both should be measured.

**Generic rule**

Route diversity metrics should separate:

```txt
distinct_template_count
unique_stop_count
unique_area_count
repeated_stop_count
repeated_template_gap
repeated_macro_area_count
```

**Current anchor**

- PR #149 findings: 5-day Barcelona vintage has 3/5 distinct templates and 10 unique stops.

**Applies to**

- All multi-day planning.

**Future hook**

- `tests/helpers/route-quality-metrics.js` or equivalent.
- Scenario snapshot assertions beyond raw JSON snapshots.

---

## 4. Intent density and area-loop behavior

### Lesson: dense intent clusters should be able to form routes even without a perfect template

**Observation**

Barcelona has strong Raval second-hand/vintage density. Before PR #152, the Planner did not naturally produce a Raval-bound vintage loop for the relevant scenario — it chose other arcs instead because no template owned Raval as a vintage area and no structural anchor existed there. PR #152 closed the gap tactically at the citypack layer by adding `raval-vintage-shopping-loop` and `raval-gothic-route-anchor`. The generic engine-level lesson below still stands for citypackless mode and other unmodelled intent clusters.

**Generic rule**

If an area has high candidate density for the requested intent, the engine should consider a compact area loop even when no curated route template owns that area.

```txt
intent + candidate density + walkability -> compact area loop candidate
```

This matters especially for citypackless mode, where curated templates may not exist.

**Current anchor**

- PR #149: `manual-raval-vintage-loop` snapshot (initial gap).
- PR #152: tactical citypack-layer fix (template + anchor).
- Barcelona Raval second-hand entries from PR #141.

**Applies to**

- All citypacks.
- Agnostic mode.

**Future hook**

- Generic route composer.
- Area-loop fallback candidate.
- Template scoring bias based on intent-density.

### Lesson: route names can express user intent, but snapshots must capture Planner reality

**Observation**

The `manual-raval-vintage-loop` scenario name reflects the user/product intent, and the initial locked output (PR #149) showed the Planner did not deliver that Raval loop — it chose Eixample/Sant Antoni arcs instead. PR #152 closed that gap; the regenerated snapshot now matches the scenario's name. The mismatch was useful precisely because it was testable: the snapshot diff in #152 is the proof.

**Generic rule**

Scenario names may encode the product expectation. Snapshot contents should encode current reality. The gap between them is a testable engine target.

**Current anchor**

- PR #149 scenario naming and snapshot output.

**Applies to**

- Scenario snapshots across all cities.

**Future hook**

- Scenario-based engine acceptance tests.

---

## 5. Scenario snapshots as engine memory

### Lesson: snapshots should show behavior changes, not merely prevent changes

**Observation**

Barcelona snapshots were added before route-diversity work so future engine changes surface as explicit diffs rather than silent Planner shifts.

**Generic rule**

Scenario snapshots are engine memory. They should make behavior visible before changing scoring or composition logic.

Good snapshots should include:

- single-day intent fit
- multi-day diversity stress
- area/anchor-specific behavior
- cross-category day shape
- known product gaps

**Current anchor**

- PR #149: per-city snapshot framework and Barcelona scenarios.
- Existing Rome snapshots.

**Applies to**

- All citypacks.
- Any future agnostic-mode acceptance suite.

**Future hook**

- Route-quality metrics layered on top of snapshots.
- Per-city scenario packs.
- Agnostic generic scenario pack.

---

## 6. Citypack readiness vs agnostic readiness

### Lesson: a city can be safely registered before it is useful

**Observation**

Athens preview skeleton has 0 catalog items and 0 route templates, but is still safe as a registered preview city: city page baseline and Pulse baseline work, while Blitz and Planner honestly report no readiness.

**Generic rule**

Readiness is not binary. A city can progress through:

```txt
registered skeleton
preview_ready
partial
ready
```

without pretending to have content it does not have.

**Current anchor**

- PR #144: `inspect-city-pack`.
- PR #145: `create-city-pack`.
- PR #146: city-pack install workflow docs.
- PR #148: Athens preview skeleton.

**Applies to**

- All future citypacks.
- Agnostic mode readiness.

**Future hook**

- `inspect-city-pack --strict`.
- `inspect-agnostic-city` or citypackless readiness diagnostics.
- City install pipeline.

### Lesson: citypacks are an enhancement layer, not the product boundary

**Observation**

Barcelona became stronger through curated catalog density, while Athens proves the skeleton workflow. But Parranda should still move toward useful behavior without a fully curated citypack.

**Generic rule**

Citypacks should accelerate local quality. They should not be the only way Parranda can function.

Agnostic mode needs:

- city resolver
- local vocabulary fallback
- generic candidate providers
- trust-aware output
- generic route composer
- weather/golden-hour baseline
- readiness status

**Current anchor**

- `docs/CITYPACK_INSTALLATION.md`.
- Athens preview skeleton.
- Barcelona catalog and scenario learnings.

**Applies to**

- Product architecture.
- Future citypackless mode.

**Future hook**

- Generic City Resolver.
- LocalIntentVocabulary fallback.
- MapSearchProvider / NearbyGenericProvider.
- Provider-first Planner/Blitz.

---

## Candidate next PRs from these learnings

These are not commitments; they are suggested next moves when a related workstream is active.

1. `fix(route-engine): improve Barcelona long-trip diversity`
   - Raval-vintage coverage was closed tactically by PR #152 (citypack-layer template + anchor).
   - Multi-day template/stop reuse remains; use PR #149/#152 snapshots as before/after anchors.
   - Prefer generic scoring/composer rules over per-city hacks.

2. `test(route-quality): add route diversity metrics helper`
   - Compute template, stop, and area diversity metrics for scenario results.

3. `feat(intents): add local intent vocabulary expansion`
   - Start with Barcelona `second_hand_clothing`, then Rome/Athens equivalents.

4. `feat(route-engine): add intent-density area-loop candidates`
   - Enable compact loops when candidate density supports the requested intent.

5. `feat(city-readiness): add strict mode`
   - Let preview/legacy warnings remain non-blocking by default, but block invalid area tokens and missing essentials in install mode.

6. `feat(agnostic): define citypackless readiness model`
   - Mirror citypack readiness for inferred cities without curated packs.
