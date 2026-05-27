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

### Lesson: template additions alone do not guarantee multi-day diversity

**Observation**

PR #170 attempted to fix 5-day second-hand repetition by adding a `born-eixample-vintage-drift` template. Investigation showed the new template never became a primary route. The engine's `areaScore` function dominates template selection: auto-anchor start/end points create a corridor (Raval/Gothic → Poblenou for the 5-day scenario), and templates whose stops fall inside that corridor score 13–16 points higher than templates outside it. The existing `-6` reuse penalty cannot overcome this gap.

`buildStopPool` further erodes template identity by replacing template stops with higher-scoring catalog items from the full pool. A template named "Born/Eixample drift" may end up with Raval/Gothic stops if those score better on area proximity.

**Generic rule**

Adding templates is not sufficient to fix multi-day diversity when scoring is corridor-dominated. Effective fixes must address one or more of:

- stronger multi-day reuse penalty (current `-6` is too weak against a `+13–16` area gap)
- corridor diversity (auto-anchor should vary across days, not stabilize)
- reduced `areaScore` dominance when reuse is active (e.g., decay area weight on reused templates)
- stop-pool fidelity (template stops should carry identity weight so dynamic realization does not erase geographic intent)

**Current anchor**

- PR #170 investigation (closed, not merged).
- `routeScore` at `server/route-engine.js:4666`.
- `areaScore` at `server/route-engine.js:2052`.
- `buildStopPool` at `server/route-engine.js:3037`.
- `tests/scenarios/barcelona/auto-second-hand-five-day-stress.json`.

**Applies to**

- All citypacks.
- Agnostic mode.

**Future hook**

- `routeScore` reuse-penalty scaling.
- Auto-anchor corridor diversity per day.
- `areaScore` decay when `reusedIds` is active.
- Stop-pool template-identity weight.

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

### Lesson: long trips need diversity pressure without breaking topology

**Observation**

After the topology/envelope improvements, Barcelona's late-day behavior improved in one important way: the engine stopped repeating the exact same compact Gràcia loop at the end of a 5-day vintage trip. But that exposed the next generic balancing problem: diversity pressure can push the engine toward new anchors and stop families, and that pressure has to stay inside a coherent route envelope instead of simply maximizing novelty at any cost.

**Generic rule**

Multi-day diversity should work on at least three layers at once:

```txt
anchor rotation
stop rotation
topology preservation
```

Good long-trip behavior is not "same perfect local loop every day", but it is also not "any new corridor is good enough". Diversity pressure should help later days escape exact route repetition while still respecting the route's local radius, corridor fit, continuity, and intent identity.

**Current anchor**

- PR #194: long-trip diversity + topology balance.
- `tests/scenarios/barcelona/auto-second-hand-five-day-stress.json`.
- `tests/barcelona-route-quality-after-depth.test.js`.

**Applies to**

- All multi-day planning.
- All citypacks.
- Agnostic mode.

**Future hook**

- A named multi-day diversity layer inside route scoring.
- Distinct metrics for anchor, stop, and area reuse.
- Guardrails that cap novelty pressure when it would break the active topology envelope.

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

## 7. Intent vs presentation identity

### Lesson: explicit intent must dominate presentation labels; support tags must not become route identity

**Observation**

The planner default-checked `nightlife`, which sent `nattliv`, `kväll`, `cocktail`, `party` to the engine as if the user explicitly chose them. Routes for a user who selected only food/drink + culture + hidden gems would still present themselves with nightlife/party/late-night framing because `nattliv` was in the preferences array. The engine also had no stop-level penalty for nightlife-dominant stops when nightlife was not explicit.

A route may include a wine bar or cocktail stop as a supporting food/drink layer. But the route title, summary, and why-text must not claim nightlife/party/late-night as the route's core identity unless the user explicitly opted into nightlife/evening/party.

**Generic rule**

```txt
support tags ≠ route identity
explicit user intent → route identity
support tags → allowed stops, not framing
```

Separate three layers:
- **Explicit intent**: what the user checked. This drives presentation labels, route framing, and route identity.
- **Support tags**: tags that are acceptable as supporting stops but should not be promoted to route identity. Wine, beer, cocktail are food/drink support — they should not promote a route to "nightlife" without explicit nightlife intent.
- **Scoring tags**: internal tags used for stop-level scoring. These may include nightlife tags on items, but must be penalized when nightlife is not explicit.

**Current anchor**

- PR #178: nightlife intent guard.
- `isNightlifeExplicit()` in `server/route-engine.js`.
- `tests/nightlife-intent-guard.test.js`.

**Applies to**

- All citypacks.
- Agnostic mode.
- Any future intent category that has overlap with default-checked categories.

**Future hook**

- Extend the pattern to other potentially leaked identities (e.g., if "history" overlaps with "culture" defaults).
- Intent-to-presentation label mapping layer.
- Stop-level identity vs support tagging in catalog.

---

## 8. Discovery quality and the anti-SEO layer

### Lesson: local relevance should beat online loudness, but strong SEO is not a penalty by itself

**Observation**

A core Parranda promise is not merely to find "good places". It is to help users get past the Google/Tripadvisor/SEO layer: the places that dominate search results, top-10 lists, sponsored visibility, or generic tourist coverage are not automatically the best stops for a real day flow.

This does **not** mean Parranda should prefer obscure or SEO-weak places by default. Strong SEO, high visibility, fame, or top-list presence can reflect genuine quality, strong reputation, good operations, or a place that simply fits the moment well. The problem is not popularity. The problem is treating popularity, SEO presence, or online loudness as a substitute for route fit, local fit, timing fit, and source-backed relevance.

Barcelona beta catalog work made this visible. Source-backed local anchors such as second-hand/vintage shops, bodegas, vermut bars, beer stops, and neighborhood connectors can improve the route even when they are not the most obvious SEO winners. The value is not fake obscurity; the value is credible local fit. A well-known place should absolutely be included when it is the best fit for the route and signal.

**Generic rule**

Parranda should rank for **fit**, not for who shouts loudest online:

```txt
route fit + neighborhood fit + intent fit + rhythm fit + provenance > SEO dominance alone
```

SEO strength should be treated as a neutral or supporting signal, not as either automatic proof of quality or automatic proof of genericness. Under-surfaced status can be useful as a tie-breaker when a place is credible and route-fitting, but it should never become a requirement.

Do not invent "hidden gem" status. Do not call a place hidden unless there is a real reason. Prefer under-surfaced but credible places when they are source-backed and fit the user's route, area, timing, and intent better than a generic top-list stop. Prefer famous or SEO-dominant places when they genuinely fit the route, area, timing, and intent better than the alternatives.

The engine should eventually distinguish:

- local signal
- route fit
- neighborhood fit
- intent fit
- rhythm fit
- provenance/source confidence
- tourist gravity
- SEO/top-list overexposure
- paid/sponsored visibility if known

A famous or SEO-dominant place can still win when it truly fits. But popularity should not be allowed to override weak route fit or local mismatch, and obscurity should not be allowed to override strong route fit either.

**Current anchor**

- PR #184: Barcelona beta catalog/source depth added real source-backed anchors beyond generic top-list coverage.
- Barcelona route-quality audit after PR #184: better second-hand/vintage and evening flows came from more local catalog depth, while route tuning still needs to protect coherence and intent fit.
- User product principle recorded 2026-05-26: Parranda should help users find places that do not necessarily rank highest on Google or win SEO visibility, without treating strong SEO as a negative signal when the place fits well.

**Applies to**

- All citypacks.
- Agnostic mode.
- Search, Planner, Blitz, Pulse, and future candidate providers.

**Future hook**

- PlaceCandidate ranking features such as `local_signal`, `tourist_gravity`, `seo_overexposure`, and `under_surfaced_score`.
- RouteCandidate scoring that rewards source-backed local fit over generic popularity, while allowing famous/high-visibility places to win when fit is strong.
- Copy guardrails: avoid fake "hidden gem" language; use honest language like "locally relevant", "source-backed", "route-fitting", or "less generic".
- Candidate source mix: blend official/operator, local guide, map/search-derived, and curator sources without letting SEO-heavy listicles dominate or excluding well-known places that genuinely fit.

---

## 9. Route topology and internal envelopes

### Lesson: walking length is a user-facing input, not the whole route shape

**Observation**

Barcelona beta had enough catalog density to reveal a generic route-shape problem: some routes matched intent tags but still felt wrong because they clustered the first few stops tightly and then made one late cross-city jump. The opposite pattern is also true: dense clustering can be excellent when the intended route is a one-neighborhood day.

The fix is not "penalize clustering". The engine needs to distinguish route topology:

```txt
single_area_loop -> compact local radius
area_to_area_arc -> corridor progress between anchors
auto_flow -> choose loop vs arc from intent density and constraints
home_base_soft_loop -> bias toward the user's base unless a broad arc is clearly justified
broad_exploration -> explicit wider movement, not every no_limit route
```

**Generic rule**

Keep walking length as the user's simple control, but derive an internal route envelope from:

- topology
- start/end/home-base anchors
- leg pacing
- walking target
- distance mode
- weather/day profile
- intent density
- connector availability

For loops, a local radius around the anchor is the right mental model. For arcs, a corridor envelope between anchors is the right mental model. `no_limit` should relax the total walking budget; it should not automatically remove route-topology constraints unless the route is explicitly broad exploration.

**Current anchor**

- Route topology/envelope PR: Barcelona regression scenarios for Gràcia loops, Sant Antoni loops, Gothic/Born loops, Gràcia -> Poblenou arcs, Born -> Gràcia arcs, rainy low-walking auto-flow, home-base Gràcia, and no-limit Gràcia.
- `tests/barcelona-route-quality-after-depth.test.js`.
- `loopRadiusKm()`, `localAutoEnvelopeBias()`, route bridge insertion, and arc late-hop scoring in `server/route-engine.js`.

**Applies to**

- All citypacks.
- Agnostic mode.
- Future Planner and Blitz route generation.

**Future hook**

- Promote the implicit envelope into a named internal `route_envelope` object with:
  - `topology`
  - `anchor`
  - `target_walking_km`
  - `max_radius_km`
  - `corridor_width_km`
  - `late_hop_tolerance`
  - `connector_policy`
- Expose envelope diagnostics in shadow/debug tools before making it public.
- Add a future planner option for "return near where I'm staying"; current home-base input can bias a local soft loop, but it does not explicitly mean "circle back home".
- Balance topology with multi-day diversity: long trips should reduce bad late jumps without collapsing too many later days into the same compact neighborhood loop once corridor and intent density are both available.

### Lesson: budget/premium pressure is not testable without price metadata

**Observation**

Barcelona route audits can send `budget` or `premium` preferences, but the current Barcelona runtime catalog does not yet carry enough `priceLevel` metadata to prove those preferences are shaping route identity honestly.

**Generic rule**

Do not fake budget/premium intelligence from vibe tags alone. If a city lacks price metadata, classify budget/premium behavior as a metadata issue and keep route output honest.

**Current anchor**

- Barcelona topology audit: budget/premium scenarios produced the same route because price metadata was missing.

**Applies to**

- All citypacks.
- Agnostic mode.

**Future hook**

- City-pack readiness diagnostics for price coverage.
- `PlaceCandidate` price/trust metadata.
- Budget/premium route scoring only when source-backed price metadata exists.

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

7. `feat(discovery): add anti-SEO discovery ranking signals`
   - Add conservative ranking metadata for local signal, tourist gravity, SEO overexposure, and under-surfaced source-backed places.
   - Start as diagnostics/score explanation, not as a hard ranking override.
   - Treat strong SEO as neutral/supporting context, not an automatic penalty.
