# Agnostic Engine North Star

**Status:** Living alignment note  
**Created after:** #257 `feat(route): add inspect agnostic route candidate diagnostics`  
**Related:** `docs/PARRANDA_ENGINE_GOALS.md`

## North star

Agnostic means Parranda can produce an honest, useful route/dayflow for **any place context** without requiring a handbuilt citypack.

Citypacks are acceleration and refinement layers. They should make Parranda sharper, richer, and more local, but they must not be required for the engine to function.

The target path is:

```txt
user enters any place context
-> Parranda resolves or understands that context
-> trusted source-backed candidates are gathered and scored
-> intent, energy, weather, time, live/pulse signals, density, geometry, and confidence shape the result
-> the engine composes an honest route/dayflow
-> citypacks improve the result when present, but are not a dependency
```

This is the product direction. Do not reduce agnostic work to a named-city fixture, a single intent, or a diagnostic sidecar.

## What agnostic does not mean

Agnostic does **not** mean:

- one external candidate appears in a known city;
- a specific named city works because a PR or test hardcoded it;
- a narrow fixture intent becomes the product goal;
- the system returns anything at all, regardless of quality;
- diagnostics keep growing while no route/dayflow capability changes.

Named cities and narrow intents may be used as fixtures only when they prove generic engine behavior. They are not the goal.

## Current state after #257

The diagnostic chain now exists:

```txt
candidate spine
-> role coverage
-> dayflow honesty
-> candidate combination
-> route-output diagnostics
-> route A/B scoring
-> agnostic route-candidate diagnostics
```

#257 was initially produced by Claude and then cleanup was completed before merge. The merged state includes the cleanup: combined `inspect=route_output,agnostic_route_candidate`, stronger banned-vocabulary guards, and full tests passing. Future prompts should treat #257 as complete and merged, not as the earlier interrupted Claude state.

This work is useful foundation, but it is not the final agnostic engine. The next phase must move from observability toward capability.

## Update after #259

The roadmap numbering below predates the merge order. The actual sequence was:

- **#258** delivered this north-star, `CLAUDE.md`, and `CODEX.md` (alignment/memory).
- **#259** delivered the first **capability** step: the experimental any-place route-output on `/api/route-recommendations`. Behind the explicit `experimental_agnostic_route_output=1` flag (alias `experiment=agnostic_route_output`), a coordinate-only / non-citypack request now **returns** an experimental route built from trusted source-backed candidates — replacing `days[0].primary_route` when a baseline route exists, or synthesizing a clearly-experimental first day when the baseline is the empty fallback — and preserves the baseline plus honest blockers under a top-level `agnostic_route_output_experiment` block. Eligibility failure returns the baseline unchanged with explicit blockers. Default behavior is unchanged without the flag; `inspect=` never mutates; public payload is never trusted; order is `unvalidated` with no ETA/walking/opening-hours claims.

- **#260** delivered freeform **place intake**: behind the same flag, a `place` / `place_query` / `location_query` string is resolved to a trusted coordinate anchor through a **server-injectable `placeResolver`** seam and fed into the #259 path. The resolver returns ONLY one or more place-resolution candidates shaped `{ label, lat, lng, confidence, provenance }` — never route candidates — so place resolution alone never produces a route (external opt-in + the trusted server `openDataLoader` are still required). Explicit valid `lat`/`lng` always win (resolver never called). The public payload may supply only the query string; resolved coordinates/confidence/provenance come solely from the resolver. Low confidence, ambiguity, unresolved, resolver-missing/error, and invalid resolved coords all fail closed with explicit blockers surfaced under `agnostic_route_output_experiment.intake`. `city` is never the place query; recognized citypacks stay on the default path. No generic production geocoder is wired in this PR — the seam is injected (deterministic in tests, no live network).

- **#261** delivered **walking-budget validation** of the then-existing candidate stop order. Behind the same flag, after trusted-candidate eligibility passes, the supplied candidate order is routed through the shared `routeWalkingPath` walking-router contract and checked: every stop finite, exactly `stops.length - 1` legs, finite non-negative leg distances/minutes, valid path points, total under a one-day cap, and each leg under a per-leg cap. On success the experimental route replaces the old `unvalidated` caveat with `order_confidence: "walking_budget_validated"` and honest walking ESTIMATE fields (`estimated_km`, `estimated_walk_minutes`, `legs`, `map_path_points`, `routing_source`), with a `heuristic_walking_estimate` / `walking_router_fallback_used` caveat when applicable. On any router/leg/path/budget failure it fails closed: the baseline is unchanged and explicit blockers (`walking_route_unavailable`, `invalid_walking_leg_count`, `invalid_walking_path_points`, `walking_validation_failed`, `walking_budget_exceeded`, `walking_leg_budget_exceeded`, `invalid_walking_coordinates`) are surfaced under `agnostic_route_output_experiment` with a `walking_validation` checks block. This **validates** the supplied order — the validator itself does **not** optimize, reorder, TSP, or pick a "best/fastest/shortest" route — and it never claims a live ETA (estimates only). The walking router is injectable for deterministic tests; no live network is added.

- **#262** delivered **trusted time + weather context** for the experiment. Behind the same flag, when trusted candidate selection runs, a server-injected `weatherProvider` + `clock` resolve a TRUSTED context that (a) influences candidate composition through the existing fit-scorer inputs (weather + time band) and (b) is surfaced under `agnostic_route_output_experiment.context` (`time`, `weather.read`, `computed_signals`, `live`, and an `influence` block that explains exactly which weather/time fit reasons reached the selected candidates), plus an honest `days[0].dayflow_context` when the weather is dayflow-relevant. **Weather-first / timezone-gated:** weather works for any coordinates; time-of-day / golden-hour / city-rhythm run ONLY when a trusted IANA timezone is known. Resolver-attested timezone is the highest current tier; if absent, the trusted weather provider may derive a valid IANA timezone through Open-Meteo `timezone=auto`, surfaced as `timezone_source:"weather_provider_auto"` / `timezone_trust:"derived_from_weather_provider"`. Missing or invalid timezone stays `timezone_unavailable`. The **public payload weather/time/timezone is not trusted** — only server seams are. Live-event scraping is OUT (`live.available:false`); no live signal becomes a route stop. Context is fail-soft and never substitutes for candidate eligibility or walking validation; a hard blocker known before selection skips the weather call entirely. No ETA / opening-hours / "best/optimal/fastest/shortest" claims. Seams are injected (deterministic in tests, no live network).

- **#263** delivered a **production trusted place resolver** behind the #260 seam: `server/place-candidates/place-resolver.js` (`createNominatimPlaceResolver` + env-gated `resolveDefaultPlaceResolver`) wires OSM Nominatim, so a deploy that sets `PARRANDA_PLACE_RESOLVER` can turn a freeform place name into a trusted coordinate anchor for real. **Default-off** (unset env → `null` → behavior unchanged). Low-volume dogfood/MVP posture: deploy-configurable identifying User-Agent, global per-instance ≤1 req/s rate gate + in-flight dedupe + in-memory TTL cache + query normalization/clamping, fail-closed `[]` on any error. **Conservative confidence** (never "high"; a clear single match anchors, genuine near-ties → `ambiguous_place`, vague → `low`). Mapped candidates carry compact `provenance`/`attribution`/`license` (ODbL) — no raw provider payload. The resolver itself still supplies **no timezone** (no coordinate→timezone lookup); agnostic context may later derive a lower-trust timezone from trusted weather-provider auto metadata. Not commercial-cleared; higher volume needs persistent caching and/or a paid/self-hosted provider (see `docs/PULSE_SOURCE_PROVIDER_REGISTRY.md`).

- **#264** delivered the default-off `/dogfood` UI for the any-place experiment. When `PARRANDA_DOGFOOD_UI` is enabled it posts to `/api/route-recommendations` with `experimental_agnostic_route_output=1` and renders intake, blockers, route, context, walking validation, caveats, attribution/license, and sv/en wording through a shared XSS-safe render module. Unset env remains 404; default Planner UX is unchanged.

- **#265** introduces a narrow **route-ordering/rhythm capability** behind the same experiment flag: trusted candidate role order can seed a deterministic proximity sequence before walking validation. The sequence is server-derived from trusted candidate IDs + coordinates, never public payload; walking validation remains the final gate; if proximity ordering fails but original role order validates, the experiment falls back honestly to role order with `route_ordering.fallback_used` diagnostics. This is not TSP, not live routing, and not a "best/optimal/fastest/shortest" claim.

- **#266** unlocked **trusted weather-provider timezone acquisition** for freeform/coordinate any-place requests. The place resolver still does not do coordinate→timezone lookup; instead the trusted weather seam may use Open-Meteo `timezone=auto`, validate the returned IANA timezone, and label it `weather_provider_auto` / `derived_from_weather_provider`. Resolver-attested timezone remains stronger. Missing/invalid timezone remains fail-soft and never blocks a route.

- **#267** adds **conservative readiness/calibration** to the same experiment block. It does not make the route more true, change route output, or promote default Planner behavior. It explains whether an experimental one-day agnostic route is `usable`, `thin_usable`, `blocked`, `environment_not_wired`, or `not_applicable`, with `medium` / `low` / `unavailable` levels only. Calibration is derived from trusted loader status, candidate readiness, geometry, walking validation, route ordering, and context/time/weather facts; it has no numeric score, no "high confidence", and no "best/optimal/fastest/shortest" route claim.

- **#270** removes the real-loader trust-wall for the **explicit agnostic route-output experiment only**: source-backed, attribution-bearing, geocoded `external_open` candidates whose evidence is single-family `inferred` may be admitted at the candidate-pool / role-selection seam when no higher-trust candidate fills a role. The shared gates still reject those records for default Planner, Blitz, Pulse, nearby, and ordinary candidate-pool use. Experimentally admitted stops carry their true gate diagnostics (including uncorroborated-promotion reasons), keep low confidence and `external_open` origin, and the readiness calibration stays capped (`thin_usable`, never `usable`) via external-only source caps.

- **#272** adds **generic local-feel preference v1** inside the same experiment seam: the loader carries the OSM `brand`/`brand:wikidata` tag as a `chain` signal (the tag is the signal — never name matching), and composition orders options by coverage first, then non-chain primary-type > non-chain secondary > chain primary > chain secondary, then fit. Geometry optimization picks only within the best non-empty local-feel tier, so distance never trades away local feel. Chains are demoted, NEVER banned — in sparse places a chain still fills the role, honestly labeled (`chain_candidate`, `chain_fallback_no_local_option`, `secondary_type_for_role` in the route's gate diagnostics). Default Planner, Blitz, Pulse, and citypack flows are untouched: the preference activates only through the experiment-injected seam.

- **#273** broadens **role coverage** so a day is more than food + coffee: the loader emits notable parks, public gardens, waterfronts and castles (already scenic in the shared intent vocabulary) so the scenic role fills in flat cities that have no viewpoint, and fetches Overpass with per-category `out` budgets + category-balanced selection so scarce area-typed scenic places are not starved by dense food/bar nodes. Viewpoint stays the canonical scenic type (curated/citypack scoring unchanged); a park fills only as an honest adjacent/secondary scenic match. Loader-only — no shared vocabulary or default-scoring change.

- **#274** makes the day read **morning → evening**: route ordering becomes daypart-PRIMARY (coffee early, scenic daytime, the food anchor mid-day, an evening bar last) with proximity as the SECONDARY tie-break within a daypart slot and across slot transitions. Still not TSP / shortest-route — it trades a little walking (≈0.3 km in the probed cases) for a coherent day, and walking-budget validation remains the final gate with honest fallback to role order if the sequence fails. The role→slot map is generic and deterministic (no clock dependency, no city logic). Before #274 proximity could bury an evening bar mid-day (observed live in Bologna: scenic → bar → food → coffee); after, all probed cities produce coffee → scenic → food → evening.

- **#275** makes the daypart rhythm **honest and visible**: every stop carries an approximate daypart label (morning → midday → afternoon → evening; NOT a scheduled clock time), the route exposes its `daypart_arc` and the trusted `current_local_time_band`, and when the arc leads with a daypart that is already past the trusted local band it says so via the `daypart_arc_precedes_local_time` caveat ("a full-day arc, not anchored to now"). Only the timezone-resolved band (#262/#266) anchors the arc; tz unknown → positional arc, no fabricated time, no caveat. `late` (night) reads as the coming day. Flag-gated; default Planner / citypack untouched. This makes the day's rhythm legible AND closes the honesty gap where a midday/evening request used to silently lead with a morning stop.

- **#276** makes the daypart rhythm **active**: a today-dated request with a trusted timezone is *anchored to now* — already-past dayparts are dropped so the day starts at the current local band instead of always at the morning (`anchored_to_local_time` + `trimmed_dayparts` + a `day_anchored_to_current_time` caveat). A future-dated request is a plan and keeps the full arc untouched (this also fixes the #275 caveat so a future morning is no longer flagged as "already past"). Conservative: anchoring never thins the day below two stops — if it would, the full arc is kept and the #275 not-anchored caveat stands. Only the trusted, timezone-resolved band drives this; tz unknown → positional arc. Flag-gated; default Planner / citypack untouched. No fabricated clock times — daypart bands only.

- **#277** adds the first **composition-richness** role: a daytime `culture_stop` (museum / gallery). The `museums` intent and museum/gallery loader types already existed, so a requested "museums"/"culture" preference used to be silently dropped (no role to fill); now it fills an honest midday cultural stop (or surfaces as an unresolved role). The role lives in an experiment-only spec gated on the same seam as #270/#272 — it never appears in the shared planner-role enumeration, so citypack/default inspect sidecars are byte-identical.

- **#278** continues the same **composition-richness** fix for markets: a daytime `market_stop` (market / event market) consumes the already-existing `markets` intent and OSM `market` loader type. A requested "markets"/"marknad" preference no longer disappears just because no route role existed; it fills an honest midday market stop (or surfaces as unresolved). Like `culture_stop`, it is experiment-only and gated on the #270/#272 seam so shared role enumeration and default/citypack inspect output stay unchanged.

- The next single-day foundation is **time-sensitive source-event understanding**: a generic, source-backed contract for happenings whose value depends on time windows (markets, night markets, venue programming, civic/culture calendars, seasonal activity, and temporary street/riverfront/coast opportunities). This is not a named-city hack and not multi-day. The engine needs to know what is happening, when it is relevant, how trustworthy the source is, and whether it can later influence Pulse/dayflow/routes without inventing opening-hours, ETA, or "best route" claims.

- **#280** makes that source-event contract **provider-collectable**: trusted source providers can emit a separate `time_sensitive_events` list, the registry normalizes it through the generic #279 contract, and source inspect exposes capped rows for review. These events remain separate from legacy live events, Pulse cards, Blitz, citypacks, route candidates, and route stops. The capability unlocked is safe collection + inspectability; consumption by Pulse/dayflow/routes is still a later gated PR.

- **#281** adds a **thin-day readiness cap**: a produced route with two or fewer stops now reads `thin_usable` (cap `capped_by_thin_day`, reason `thin_day_few_stops`), never `usable`, even with strong sources and full context. Closes the #276 review note — a time-anchored evening day trims to food + bar and used to overstate as `usable`/`medium`. Generic and deterministic (stop-count only); flag-gated calibration, default Planner / citypack untouched.

- **#282** wires the **first concrete time-sensitive event source**: a generic, feed-agnostic **schema.org/Event provider** behind the #280 bridge. It normalizes any schema.org/Event JSON-LD feed (envelope-tolerant: bare / array / `@graph` / `items`) into the #279 contract — id, title, startDate/endDate, geo lat/lng, per-event url, multilingual name, cancelled→stale. Env-gated default-off (`PARRANDA_SCHEMA_ORG_EVENT_SOURCE`, mirrors the loader/resolver), fail-soft on every error path, carries a display `license_label`. Proven against fixtures + the registry; **not yet consumed** by Pulse/dayflow/routes (later gated step). The chosen live target is Visit Sweden (CC-BY 4.0, covers Skåne/Österlen) once API access is configured; the generic schema.org shape means any other Event feed plugs in by config. Decision-probe ruled out social platforms (ToS) and kept OSM/Wikidata as enrichment, not event sources.

- **#283** wires the **first REACHABLE, no-key time-sensitive feed**: a Linked Events provider (the open-source 6aika / City-of-Helsinki events API that many Nordic cities run). Reachable today with no credential, CC-BY 4.0, and it meets every source criterion — event/title, start/end, geocoded venue (coords inline via `include=location`, GeoJSON [lng,lat]), source/provenance (info_url + data_source/publisher), license/attribution, broad coverage, low noise — and is fail-soft when nothing's there. Sibling to the #282 schema.org provider (different feed shape, same #279 normalization target, same #280 bridge). **Validated LIVE against api.hel.fi**: real events flow through the full pipeline geocoded + source-backed + honestly-timed. Env-gated default-off (`PARRANDA_LINKED_EVENTS_SOURCE`). This is the "find a way without a Visit Sweden key" answer — feed choice is config, not a hard dependency.

- **Engine convergence (any-place → existing route engine):** the route engine's existing `agnostic_compose` branch (used for templateless cities) is now the *single* synthesizer for any-place routes — there is no separate experimental composer for synthesis. Two seams enable it: (1) `generateAgnosticRecommendations({ cityConfig, ... })` runs a fully-built coordinates-only cityConfig (empty curated catalog + `sourceCandidates`, no templates) through the *exact* registered-city loop via an opt-in `cityConfigOverride` — registered-city behavior is byte-identical (override defaults null); (2) `buildStopPool` now seeds its pool from the source-backed provisional candidates when the verified catalog is **completely empty**, gated to the agnostic-compose template + `getAllItems()===0`, so the engine can compose a walk from provisional-only places (it previously bailed with no pool). Thin Athens and every registered city are untouched (they have verified items). Ordering is the engine's geometry; daypart rhythm (#274–278) is preserved as a route **label**, not the sequencer — promoting daypart into compose ordering is a follow-up. Honest degradation is inherited: `<2` viable stops → null route, never invented geography. **Still dormant on the public path:** the candidate-supply mapping (trusted selected candidates → `sourceCandidates` with full provenance/trust fidelity) and the `thin_usable`/`low` promotion gate (allowed caps: external_only / derived_tz / partial_context / heuristic_walking; strong-anchor-only; cache/env-gated, no public flip) land in the immediate follow-up PR.

- **Next Pulse consumption step:** normalized `time_sensitive_events` can now become gated Pulse signals through the shared Pulse quality/ranking/masthead path. Only source-backed, non-stale, current/today/tonight events with at least medium confidence are eligible; stale/future/source-thin rows stay out. Salience is generic (timing relevance, source confidence/tier, place/coordinate evidence, route-role hint, recurrence/specificity) so unusually relevant happenings can rise above passive context without city-specific hacks. These signals remain Pulse context only: they do not become route stops, route candidates, dayflow composition inputs, or Planner mutations in this step.

Still missing before a true any-place Planner (now the next steps): stronger generic candidate supply where source-backed candidates are sparse, richer single-day composition quality after calibration, time-sensitive source events feeding dayflow/route composition, multi-day experimental output, persistent geocode caching / a paid-or-self-hosted geocoder for scale, and live ETA / real-time routing (explicitly out of scope).

## Anti-drift rule

Every PR in the agnostic/planner line must be one of:

1. **Capability PR** — the engine can do something concrete it could not do before.
2. **Blocker-removal PR** — removes a specific blocker to any-place route/dayflow output.
3. **Diagnostic PR** — allowed only when it directly enables the next capability PR.

A diagnostic PR that does not enable a concrete capability in the next one or two PRs is drift.

Ask before each PR:

```txt
After this PR, what can we do that we could not do before?
```

Weak answers:

```txt
We can see more metadata.
We have more inspect output.
The PR body is clearer.
```

Strong answers:

```txt
With an explicit flag, the API can return an experimental agnostic route output.
A non-citypack/unknown-place request now reports exact blockers instead of silently falling back.
Trusted source-backed candidates can become route-output candidates under strict eligibility.
The frontend can dogfood any-place mode.
```

## PR body requirement

Every agnostic/planner PR should include:

```md
## Parranda outcome

This PR moves the any-place engine forward by:
- ...

Concrete thing possible after this PR:
- ...

Still missing before true any-place Planner:
- ...

Next capability step:
- ...
```

If this section is vague, the PR is probably drifting.

## Review checklist

Review agnostic/planner PRs in this order:

1. Does this move Parranda toward working in any place context, not only a named fixture?
2. Does it create or unblock a concrete capability, not only add diagnostics?
3. Is default Planner behavior still safe and unchanged unless an explicit experiment flag is present?
4. Does experiment mode actually do something tangible enough to dogfood?
5. Does it avoid hardcoding named-city or narrow-intent behavior?
6. Does it preserve trust, provenance, confidence, and honest blockers?
7. Does it avoid fake ETA, walking-time, opening-hours, or route-quality claims?
8. Does it keep citypacks as accelerators rather than dependencies?

## Near-term roadmap

The current direction should be:

```txt
#258 — DONE: agnostic engine north-star + CLAUDE.md / CODEX.md (alignment/memory)
#259 — DONE: experimental any-place route-output capability + readiness blockers
#260 — DONE: freeform place intake (place query → trusted coordinate anchor → #259 path)
#261 — DONE: walking-budget validation of the existing candidate order (no optimization)
#262 — DONE: trusted time + weather context (resolver/weather-provider timezone gated; weather-first; no live scraping)
#263 — DONE: production trusted place resolver (Nominatim, env-gated default-off; not commercial-cleared)
#264 — frontend dogfood mode: enter any place -> get honest route/dayflow output
#265 — DONE: conservative proximity ordering before walking validation (fallback to role order)
#266 — DONE: trusted weather-provider timezone auto-resolution (lower-trust derived timezone)
#267 — DONE: conservative readiness/calibration for experimental agnostic one-day output
#270 — DONE: experiment-only admission of single-family inferred external candidates with capped calibration
#271 — DONE: loader error observability (error_failed_closed vs genuinely empty)
#272 — DONE: generic local-feel preference v1 (chain demotion + role-type preference, experiment-only)
#273 — DONE: scenic/role coverage breadth (loader emits parks/gardens/waterfront/castle; per-category fetch budget)
#274 — DONE: daypart rhythm ordering (morning→evening slots, proximity within-slot, walking validation final gate)
#275 — DONE: daypart honesty (per-stop daypart labels, daypart_arc, current_local_time_band, not-anchored caveat)
#276 — DONE: time-anchored selection (today→anchor day to now + drop past dayparts; future→full plan; conservative >=2 floor)
#277 — DONE: composition richness v1 (experiment-only culture_stop role; museums/gallery now fills a midday stop)
#278 — DONE: composition richness v1b (experiment-only market_stop role; markets now fills a midday stop)
#279 — DONE: generic time-sensitive source-event contract (source-backed happenings with timing relevance)
#280 — DONE: source-provider bridge for time-sensitive events (collect + inspect, not consumed)
#281 — DONE: thin-day readiness cap (<=2 stops → thin_usable, closes #276 note)
#282 — DONE: generic schema.org/Event source provider (env-gated, fixtures; Visit Sweden = live target when keyed)
#283 — IN PROGRESS: Linked Events provider (reachable no-key feed, env-wired, LIVE-validated against api.hel.fi, not consumed)
#convergence-1 — DONE: any-place routes through the engine's own agnostic_compose (generateAgnosticRecommendations + cityConfigOverride seam, byte-stable; buildStopPool seeds provisional-only when catalog empty). Dormant on public path; candidate-supply mapping + thin_usable/low promotion gate + app wiring = next PR.
```

The numbers may shift, but the sequence should not drift back into endless diagnostics.

## Required framing for #258

#258 must be a **Capability PR**, not another pure diagnostic PR.

It should prove, behind an explicit experiment flag, that a trusted candidate-route can become actual route output if strict eligibility passes.

It should also expose honest blockers when any-place route output is not yet possible.

It must not make any named city or narrow fixture the product goal.

## Claude /goal suggestion

When using Claude's `/goal`, use a short persistent condition like:

```txt
Keep working until the PR creates concrete progress toward Parranda's any-place agnostic engine.

Agnostic means: a user can eventually enter any place context, not a handbuilt citypack, and Parranda can produce an honest, useful route/dayflow using trusted source-backed candidates, local context, weather/time/live signals, geometry, confidence, and user intent.

For this PR, success means:
- default Planner behavior remains unchanged
- experiment mode makes a tangible capability possible, not only more diagnostics
- no named city or narrow fixture becomes the product goal
- citypacks remain accelerators, not dependencies
- public payload data is never trusted
- output is honest about blockers and confidence
- the PR body includes Parranda outcome, Concrete thing possible after this PR, Still missing, and Next capability step

Do not stop at polish or metadata if the PR does not move the any-place route/dayflow engine forward.
```

## Vocabulary note

Avoid using any specific city as shorthand for the goal. Use:

```txt
any-place
arbitrary-place
unknown-place
non-citypack context
coordinate-only context
```

Likewise, narrow fixtures such as coast/swimming should not become product strategy. They may be used as test fixtures only when they prove generic engine behavior.
