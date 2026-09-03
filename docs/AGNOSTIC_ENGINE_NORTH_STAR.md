# Agnostic Engine North Star

**Status:** Current north star plus historical delivery record

**Updated after:** #492 trusted place-source lifecycle
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

## Historical delivery record

The milestone narrative below records how the architecture evolved from #257.
It is retained for rationale and regression context, **not** as the current
roadmap or as instructions to rebuild completed work. Current priorities live
in `docs/PARRANDA_ENGINE_GOALS.md`.

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

- **#260** delivered freeform **place intake**: behind the same flag, a `place` / `place_query` / `location_query` string is resolved to a trusted coordinate anchor through a **server-injectable `placeResolver`** seam and fed into the #259 path. The resolver returns ONLY one or more place-resolution candidates shaped `{ label, lat, lng, confidence, provenance }` — never route candidates — so place resolution alone never produces a route (external opt-in + the trusted server `openDataLoader` are still required). Explicit valid `lat`/`lng` always win: place search is never called and the coordinate anchor never moves. A separately trusted reverse-context method may enrich that exact anchor with allowlisted locality/region/bounds for source discovery, but failure is fail-soft and public place/context fields never become trusted identity. The public payload may supply only the query string; resolved coordinates/confidence/provenance come solely from the resolver. Low confidence, ambiguity, unresolved, resolver-missing/error, and invalid resolved coords all fail closed with explicit blockers surfaced under `agnostic_route_output_experiment.intake`. `city` is never the place query; recognized citypacks stay on the default path. No generic production geocoder is wired in this PR — the seam is injected (deterministic in tests, no live network).
- **Current local time applies only to the current local date:** a trusted timezone still anchors calendar dates and selected-day source hours for future plans, but today's clock band, golden-hour/city-rhythm signals, and time-fit reasons may shape candidates only when the requested date equals the trusted local date. A future or past selected date without an explicit trusted requested-time window remains `selected_date_unanchored`; it keeps the full day arc and never inherits the moment in which the user happened to plan it.

- **#261** delivered **walking-budget validation** of the then-existing candidate stop order. Behind the same flag, after trusted-candidate eligibility passes, the supplied candidate order is routed through the shared `routeWalkingPath` walking-router contract and checked: every stop finite, exactly `stops.length - 1` legs, finite non-negative leg distances/minutes, valid path points, total under a one-day cap, and each leg under a per-leg cap. On success the experimental route replaces the old `unvalidated` caveat with `order_confidence: "walking_budget_validated"` and honest walking ESTIMATE fields (`estimated_km`, `estimated_walk_minutes`, `legs`, `map_path_points`, `routing_source`), with a `heuristic_walking_estimate` / `walking_router_fallback_used` caveat when applicable. On any router/leg/path/budget failure it fails closed: the baseline is unchanged and explicit blockers (`walking_route_unavailable`, `invalid_walking_leg_count`, `invalid_walking_path_points`, `walking_validation_failed`, `walking_budget_exceeded`, `walking_leg_budget_exceeded`, `invalid_walking_coordinates`) are surfaced under `agnostic_route_output_experiment` with a `walking_validation` checks block. This **validates** the supplied order — the validator itself does **not** optimize, reorder, TSP, or pick a "best/fastest/shortest" route — and it never claims a live ETA (estimates only). The walking router is injectable for deterministic tests; no live network is added.

- **#262** delivered **trusted time + weather context** for the experiment. Behind the same flag, when trusted candidate selection runs, a server-injected `weatherProvider` + `clock` resolve a TRUSTED context that (a) influences candidate composition through the existing fit-scorer inputs (weather + time band) and (b) is surfaced under `agnostic_route_output_experiment.context` (`time`, `weather.read`, `computed_signals`, `live`, and an `influence` block that explains exactly which weather/time fit reasons reached the selected candidates), plus an honest `days[0].dayflow_context` when the weather is dayflow-relevant. **Weather-first / timezone-gated:** weather works for any coordinates; time-of-day / golden-hour / city-rhythm run ONLY when a trusted IANA timezone is known. Resolver-attested timezone is the highest current tier; if absent, the trusted weather provider may derive a valid IANA timezone through Open-Meteo `timezone=auto`, surfaced as `timezone_source:"weather_provider_auto"` / `timezone_trust:"derived_from_weather_provider"`. Missing or invalid timezone stays `timezone_unavailable`. The **public payload weather/time/timezone is not trusted** — only server seams are. Live-event scraping is OUT (`live.available:false`); no live signal becomes a route stop. Context is fail-soft and never substitutes for candidate eligibility or walking validation; a hard blocker known before selection skips the weather call entirely. No ETA / opening-hours / "best/optimal/fastest/shortest" claims. Seams are injected (deterministic in tests, no live network).

- **#263** delivered a **production trusted place resolver** behind the #260 seam: `server/place-candidates/place-resolver.js` (`createNominatimPlaceResolver` + env-gated `resolveDefaultPlaceResolver`) wires OSM Nominatim, so a deploy that sets `PARRANDA_PLACE_RESOLVER` can turn a freeform place name into a trusted coordinate anchor for real. **Default-off** (unset env → `null` → behavior unchanged). Low-volume dogfood/MVP posture: deploy-configurable identifying User-Agent, global per-instance ≤1 req/s rate gate, bounded FIFO, in-flight dedupe, persistent-capable TTL cache via `PARRANDA_CACHE_DIR`, query normalization/clamping, and fail-closed `[]` on any error. Successful empty/results may be cached; transient failures and queue overflow are never poison-cached. **Conservative confidence** (never "high"; a clear single match anchors, genuine near-ties → `ambiguous_place`, vague → `low`). Identical full administrative labels may collapse city/boundary representative points inside a five-kilometre cluster; same short names with differing labels retain a strict rounding tolerance, and distant namesakes never collapse. Mapped candidates carry compact `provenance`/`attribution`/`license` (ODbL) — no raw provider payload. The resolver itself still supplies **no timezone** (no coordinate→timezone lookup); agnostic context may later derive a lower-trust timezone from trusted weather-provider auto metadata. Cross-redeploy durability requires a mounted cache directory; higher volume still needs a paid/self-hosted provider (see `docs/PULSE_SOURCE_PROVIDER_REGISTRY.md`).

- **Multi-source place resolution keeps the same trust seam:** Nominatim remains the primary resolver. When separately enabled through `PARRANDA_WIKIDATA_PLACE_RESOLVER`, an exact coordinate-bearing Wikidata label/alias may recover a named area or colloquial region the street geocoder does not index. The fallback never overrides any medium/high primary result (including deliberate ambiguity), never promotes fuzzy matches above low confidence, and never turns one coordinate into invented regional bounds. When Nominatim is unavailable, exact distant namesakes remain ambiguous unless Wikidata itself supplies conservative geographic disambiguation: exactly one same-label cluster has multiple nearby entities, or one population-bearing place is at least twelve times larger than every other population-bearing exact namesake. This affects anchor resolution only, remains capped at medium confidence, and never gives population route-ranking power. The normalized UI language is label-search context only, never resolver evidence. Transient source failures are not cached; successful fallback rows retain CC0 attribution. This improves generic place reach without city aliases or city-specific routing logic.
- **A typed place anchor is a discovery fact, not always a walking start:** explicit user coordinates remain exact and can never move. For a resolved place, composition may instead use one walkable micro-base when either the resolver supplied trusted regional bounds and the bounded scout selected a richer in-bounds cluster, or trusted source-backed place rows form one compact preference-relevant cluster within a strict local aperture while the resolver point has insufficient relevant walking supply. Structural, source-less, inactive, distant, incoherent, or weakly relevant rows cannot move the day. The original resolver anchor remains visible as collection truth; the route exposes only a compact `walkable_micro_base` explanation and caveat, never the internal selected coordinates. This selects one honest walking area and never merges distant clusters or invents a neighbourhood/city claim.

- **A coherent route may return with explicit tradeoffs:** after the experiment has finished candidate selection, ordering, and walking validation, a pure post-hoc `constraint_negotiation` block compares only the selected route against the normalized requested preferences and the shared 60-118% walking-target fit band. It reports covered, partial, and missing preferences plus whether the route is shorter than, within, or longer than the requested band. This verdict never feeds back into ranking, eligibility, route mutation, or source collection; it explains why a trusted route can be useful without pretending every selected chip or approximate distance was satisfied.

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

- **Trusted opening-hours eligibility** keeps source-backed places that are provably unavailable out of the agnostic one-day candidate reservoir. Bounded OSM `opening_hours` facts remain source-owned and may affect selection only when the request has a trusted local timezone and clock. The v1 evaluator supports a conservative subset of weekly clock ranges, overnight windows, explicit closed days, and `24/7`; unsupported or precedence-sensitive syntax fails open as `unknown`. It checks whether a place overlaps the remaining local day (or the full requested future day), not an exact scheduled stop slot. A selected route stop may expose only the normalized local windows for that selected day (`selected_day_hours`), capped and stripped of raw syntax; it never claims “open now”, and unsupported/unknown schedules stay silent.

- **#282** wires the **first concrete time-sensitive event source**: a generic, feed-agnostic **schema.org/Event provider** behind the #280 bridge. It normalizes any schema.org/Event JSON-LD feed (envelope-tolerant: bare / array / `@graph` / `items`) into the #279 contract — id, title, startDate/endDate, geo lat/lng, per-event url, multilingual name, cancelled→stale. Env-gated default-off (`PARRANDA_SCHEMA_ORG_EVENT_SOURCE`, mirrors the loader/resolver), fail-soft on every error path, carries a display `license_label`. Proven against fixtures + the registry; **not yet consumed** by Pulse/dayflow/routes (later gated step). The chosen live target is Visit Sweden (CC-BY 4.0, covers Skåne/Österlen) once API access is configured; the generic schema.org shape means any other Event feed plugs in by config. Decision-probe ruled out social platforms (ToS) and kept OSM/Wikidata as enrichment, not event sources.

- **#283** wires the **first REACHABLE, no-key time-sensitive feed**: a Linked Events provider (the open-source 6aika / City-of-Helsinki events API that many Nordic cities run). Reachable today with no credential, CC-BY 4.0, and it meets every source criterion — event/title, start/end, geocoded venue (coords inline via `include=location`, GeoJSON [lng,lat]), source/provenance (info_url + data_source/publisher), license/attribution, broad coverage, low noise — and is fail-soft when nothing's there. Sibling to the #282 schema.org provider (different feed shape, same #279 normalization target, same #280 bridge). **Validated LIVE against api.hel.fi**: real events flow through the full pipeline geocoded + source-backed + honestly-timed. Env-gated default-off (`PARRANDA_LINKED_EVENTS_SOURCE`). This is the "find a way without a Visit Sweden key" answer — feed choice is config, not a hard dependency.

- **Engine convergence (any-place → existing route engine):** the route engine's existing `agnostic_compose` branch (used for templateless cities) is now the *single* synthesizer for any-place routes — there is no separate experimental composer for synthesis. Two seams enable it: (1) `generateAgnosticRecommendations({ cityConfig, ... })` runs a fully-built coordinates-only cityConfig (empty curated catalog + `sourceCandidates`, no templates) through the *exact* registered-city loop via an opt-in `cityConfigOverride` — registered-city behavior is byte-identical (override defaults null); (2) `buildStopPool` now seeds its pool from the source-backed provisional candidates when the verified catalog is **completely empty**, gated to the agnostic-compose template + `getAllItems()===0`, so the engine can compose a walk from provisional-only places (it previously bailed with no pool). Thin Athens and every registered city are untouched (they have verified items). Ordering is the engine's geometry; daypart rhythm (#274–278) is preserved as a route **label**, not the sequencer — promoting daypart into compose ordering is a follow-up. Honest degradation is inherited: `<2` viable stops → null route, never invented geography.

- **Engine convergence wiring (gated):** `composeAgnosticRouteOutput` gained a `synthesizeVia: "engine"` path that maps the admitted candidates (`mapAdmittedSelectionToSourceCandidates` — joins the lossy combination `selected[]` back to the rich planner-role candidates to recover type/provenance/attribution, reconstructs honest low trust) into the engine's `sourceCandidates` and synthesizes via `generateAgnosticRecommendations`; legacy in-module synthesizer stays the default (existing tests/behaviour unchanged) and is staged for removal. The promotion gate (`evaluateAgnosticPromotion`) returns the synthesized route as the actual day route ONLY when calibration is `thin_usable`/`usable` + low/medium + every `capped_by_*` ∈ {external_only, derived_tz, partial_context, heuristic_walking} + the anchor resolved strongly (the intake already fails closed on weak resolves); otherwise baseline + diagnostic. Wired in `/api/route-recommendations` behind `PARRANDA_AGNOSTIC_ENGINE_COMPOSE` (or `agnostic_engine_compose=1`), default OFF. Also fixed: `isExternalStop` now recognizes `provisional:true` engine stops, so an all-source-backed route trips `capped_by_external_only_sources` → stays honestly `thin_usable`, never `usable`. Persistent-capable geocode/Overpass caching is now present; cross-redeploy durability still depends on a mounted `PARRANDA_CACHE_DIR`. **Still pending:** retiring the legacy synthesizer and production-scale geocoding/provider capacity.

- **Live supply turned ON in the deploy + persistent-capable cache:** the live OSM/Overpass loader (`open-data-loader.js`) and the Nominatim place resolver existed and worked, but `render.yaml` set **no env vars**, so in production both were `null` — the deployed app ran on curated catalog + city-owned source packs only, and every loader/source-backed PR was dark in prod. `server/place-candidates/source-cache.js` provides TTL + in-flight de-dupe + optional file backing via `PARRANDA_CACHE_DIR`; both Overpass and Nominatim now use it, and the resolver additionally bounds its serial provider queue. Repeat/concurrent lookups for one key never re-hit the provider, and only successful provider outcomes are stored. This satisfies the cache half of "no public flip without persistent caching" for low-volume field use; **cross-redeploy** persistence still needs a mounted Render disk pointed at `PARRANDA_CACHE_DIR`.

- **Unicode entity-resolution (the generic capability) + Wikidata corroboration source.** Core, city-agnostic fix: `entity-resolution.js` `normalizeName` was ASCII-only (`[^a-z0-9]`), so a Greek / Cyrillic / any non-Latin name normalized to "" → zero tokens → **non-Latin names could never merge across OSM / Wikidata / curated sources**. Cross-source consensus was structurally impossible for every non-Latin city; Athens was just the proving fixture where we hit it. Now Unicode-aware (`\p{L}\p{N}`); ASCII/Latin behavior byte-identical (NFD + diacritic folding unchanged). Proven with Greek **and** Cyrillic merge tests, and a Latin no-regression test. Alongside it, `server/place-candidates/wikidata-source.js` is a GENERIC `open_knowledge` corroboration source (typed `wikibase:around`, curated P31/P279* place classes; noise classes — archaeological-site / settlement / tourist-attraction — excluded after live probing), composed with the Overpass loader and **background-warmed** (WDQS cold queries run ~10-30 s, so they NEVER block the route — on a miss the request gets OSM only and Wikidata warms out-of-band, appearing on the repeat visit). A place OSM and Wikidata each know merges into one candidate carrying `map` + `open_knowledge` → consensus past the single-family ceiling, in any city. **Scope honesty:** (1) Wikidata is NOTABLE-culture *corroboration* (museums/galleries/markets), not broad everyday supply density — it enables consensus for matching places, it does not solve thin supply. (2) `PARRANDA_WIKIDATA_LABEL_LANGS=el,en` in render.yaml is a TEMPORARY field-deploy setting (code default `en`), NOT the agnostic model. **Follow-up before truly agnostic:** resolve Wikidata label language per request / place / city locale so consensus fires in every city without a per-deploy hint; and broaden the OSM loader (the main everyday-supply lever).

- **Global trusted source supply + small-place nearby fallback (2026-08).** `server/place-candidates/overture-source.js` adds Overture Places as a second broad global place source behind `PARRANDA_OVERTURE_SOURCE`. It resolves the current monthly release from Overture's STAC catalog and uses DuckDB to read only a hard-capped five-kilometre GeoParquet bounding box from the public S3 release. A 0.95 existence-confidence floor, closed-place rejection and a closed travel-category mapper remove irrelevant infrastructure; no ratings, descriptions or raw source rows enter Parranda. Each accepted row retains only its allowlisted per-source Overture license (Apache-2.0, CC0-1.0 and/or CDLA-Permissive-2.0); a missing or new unknown license fails closed. Overture is one `open_directory` provenance family even when its record aggregates several providers, so it cannot manufacture trust diversity. Cold reads warm the persistent source cache outside the request path; a varied cached directory reservoir may answer immediately while Overpass refreshes in the background. Live QA produced 37 relevant records across ten route categories around Kivik and 60-record bounded reservoirs in Bologna, Porto, Ljubljana, Matsumoto and Oaxaca; all five preference mixes composed through the ordinary agnostic engine. The measured bad Ljubljana row at Overture confidence 0.926 was the reason for raising the floor from 0.90 to 0.95, not a city rule.

  Small places no longer fail because Nominatim's popularity-like `importance` is low: one exact provider name with an OSM identity, trusted admin context and bounded settlement/district/region structure may anchor at `medium`; two exact distant names remain ambiguous. Live `around_place` now forwards only the original place query, re-resolves it server-side and, for a resolver-attested compact settlement only, collects up to 25 km when the local three-kilometre bucket is empty. Nearby events carry an exact distance and `live_proximity:nearby`; `near_me`, route corridors, broad bounds and client-supplied scope fields never expand.

  **Still honest/missing:** Overture alone is inferred low-trust supply, not proof that a place is “the best”; OSM/Wikidata/curated corroboration and preference/route fit remain the promotion currency. The event scout still discovers and qualifies event sources in the background only; it does not feed stable place candidates, and unreviewed source profiles do not become trusted route inputs. A location with no approved/probationary event source still reports uncovered. Cross-provider aliases remain a separate entity-resolution problem.

- **Reviewed local place-source bridge (2026-08).** A Source Catalog profile can
  now bind an exact, fresh, geo-bounded official/editorial place-list endpoint
  to the closed `schema_org_place_html`, `schema_org_place_json`,
  `schema_org_place_list_detail_html` or `map_linked_place_html` adapter. The
  adapters extract only allowlisted place
  types, stable source identities and exact coordinates from JSON-LD or from a
  same-card heading/category/detail/map tuple, cap bytes/items/radius, block
  off-origin redirects and acquire outside the request path into persistent
  worker-owned storage.
  `map-linked-place-html-v2` treats only balanced semantic items or explicitly
  card-marked elements as a card and requires a single unambiguous identity,
  category and coordinate pair inside it. Wrapping sections and sibling card
  fragments cannot be joined. The approved adapter-contract revision is checked
  at profile read, worker claim and reservoir read, so v1 approvals, targets and
  rows fail closed until rediscovery and explicit re-review.
  `schema-org-place-list-detail-html-v1` is the only fan-out shape: a
  pointer-only schema.org `ItemList` may name at most 12 exact same-origin
  HTTPS detail URLs. One shared timeout and byte budget covers the list and
  sequential details. A detail contributes only when exactly one allowlisted
  Place node carries its own name, type, exact coordinates and an identity
  equal to the fetched URL. The background worker owns traversal; Planner never
  crawls on a request.
  The rows join the existing external candidate reservoir; there is no parallel
  crawler or city branch. An official operator-reviewed source can pass route
  gates while remaining explicitly `human_verified:false`; editorial-only
  evidence still cannot self-promote. The scout discovers and qualifies both
  supported page shapes, but every candidate remains review-only until an
  operator approves the exact binding. The catalog lifecycle is now complete:
  a server-shell operator approves an immutable discovery revision through a
  bounded decision, the audit and refresh target persist atomically, the
  background worker populates a persistent freshness-bounded reservoir, and
  request composition reads only rows whose approval and profile revision are
  still current. Material drift demotes the profile and fails closed; no public
  payload or discovery worker can self-approve. **Still missing:** operating
  approved sources across larger and smaller real geographies, exact coordinate
  recovery from other bounded site formats, and conservative alias resolution
  beyond geo+name/hard ids.

- **Next Pulse consumption step:** normalized `time_sensitive_events` can now become gated Pulse signals through the shared Pulse quality/ranking/masthead path. Only source-backed, non-stale, current/today/tonight events with at least medium confidence are eligible; stale/future/source-thin rows stay out. Salience is generic (timing relevance, source confidence/tier, place/coordinate evidence, route-role hint, recurrence/specificity) so unusually relevant happenings can rise above passive context without city-specific hacks. These signals remain Pulse context only: they do not become route stops, route candidates, dayflow composition inputs, or Planner mutations in this step.

- **Pulse display eligibility is broader than route eligibility:** a reviewed, bounded daily calendar window may be useful local context even when it is too long-lived to shape the route. Such rows can be marked `pulse_display_eligible:true` and `route_eligible:false`; the evening weave must honor the latter. Coordinate-less source events remain rejected unless the trusted server resolver finds exactly one medium-or-better venue match inside the applicable trusted geometry: the local anchor radius by default, or exact resolver-attested municipality/region bounds for bounded regional requests. Settlement, coordinate, detached, and broad-anchor scopes cannot widen this gate. Venue lookups are capped, cached by the shared resolver, source-address/venue-derived, fail-closed, and never public-payload-controlled. Regional Pulse eligibility does not loosen the existing walking-validated route-stop distance gate.

Still missing before a true any-place Planner (now the next steps): stronger generic candidate supply where source-backed candidates are sparse, richer single-day composition quality after calibration, time-sensitive source events feeding dayflow/route composition, multi-day experimental output, a paid-or-self-hosted geocoder for production scale, and live ETA / real-time routing (explicitly out of scope).

## Why the agnostic feel isn't in the product yet — synthesis vs supply vs source-fit

Audited 2026-06-19 from real Athens dogfooding (the felt experience was unchanged despite the convergence work). "Agnostic feel" has **three independent halves**; shipping one does not move the product on its own:

1. **Synthesis** — compose an honest day from whatever candidates exist (route-engine `agnostic_compose` + daypart ordering #293 + readiness gate/observability #290/#292/#295). **Built and proven.** The #295 probe shows the engine path is promotion-`eligible` under adequate supply and `blocked` only by supply-driven caps. Deliberately gated/unpromoted per the guardrail.
2. **Supply** — enough trusted source-backed candidates that even a thin city composes a *rich* day. **The broad global reservoir, reviewed-local-source bridge, operator approval, persistent worker lifecycle and proactive structured place-source discovery/qualification lane have landed; coverage and source quality remain the gating lever.** Inline Schema.org, bounded Schema.org list→detail and strict map-linked cards are supported. Next work is operating reviewed sources across real geographies and conservative entity resolution. No amount of extra synthesis substitutes for that work.
3. **Live-source fit** — pulse feeds that are culturally relevant, not administrative. Athens's wired City-of-Athens events calendar returns HTTP 200 but mostly municipal council meetings (`Συνεδρίαση …`) → "same pulse". This is source selection + salience (pulse lane), not a wiring failure.

Evidence from Athens (registered, thin): **26 verified catalog items, 4 provisional candidates, 0 templates.** Two consequences make the synthesis work invisible there: (a) Athens is a **registered** city, so the entire any-place stack (convergence / promotion gate / observability) is gated behind `noRecognizedCity` and **never runs for it**; (b) #293 daypart ordering is **inert for Athens** because its 26 catalog items carry no `route_roles` (only the 4 provisional candidates do). So the synthesis we shipped does not touch Athens's felt experience.

**Implication (anti-drift):** the synthesis engine is **ready and starved**. The bottleneck to "Parranda feels agnostic" is **supply** and **source-fit**, not more synthesis. Do not keep building synthesis expecting the product to change — it will not until supply lands. Ownership split: **supply → Codex (gating)**, **source-fit → pulse lane**, **synthesis → ready, awaiting supply + a deliberate promotion**.

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

## Historical milestone index

The index below preserves merge-order context. Status labels such as
`IN PROGRESS` describe the point in time when this record was written and must
not override the current roadmap in `docs/PARRANDA_ENGINE_GOALS.md`.

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
#convergence-1 — DONE (#290): any-place routes through the engine's own agnostic_compose (generateAgnosticRecommendations + cityConfigOverride seam, byte-stable; buildStopPool seeds provisional-only when catalog empty). Dormant.
#convergence-2 — DONE: candidate-supply mapper + thin_usable/low promotion gate + app wiring behind PARRANDA_AGNOSTIC_ENGINE_COMPOSE. Persistent-capable Overpass/Nominatim cache and daypart composition are in place; legacy synthesizer remains staged for removal.
#registered-reservoir — DONE: registered-but-thin citypacks can opt into the same source-backed candidate reservoir as supplemental fill behind explicit experiment/external flags. Curated citypack candidates remain the higher-trust spine; source-backed fill stays provisional, low-trust, attributed, and never citypack-owned.
#live-program-articles — GENERIC CAPABILITY, DEPLOYMENT GATED: arbitrary-place source discovery can recognize strict factual programme sections on official/public articles, propose the reusable adapter for bounded qualification, and reuse the existing geo catalog, venue resolution, temporal truth, fusion, personalized Live ranking, and reviewed runtime bridge. A fixture-backed cold loop proves discovery through Live for unrelated places, but proactive production discovery still requires the source-catalog worker plus an explicitly configured operator-owned search endpoint. Search results remain low-trust; unknown ownership/terms stay review-required, mapless source-scoped evidence stays Pulse-only, and no named-place rule or default route behavior is added.
#place-source-scout — GENERIC CAPABILITY, DEPLOYMENT GATED: the same resolver-attested worker now searches bounded local-language/English place-guide queries, follows same-origin guide links, recognizes multi-item exact-coordinate schema.org place lists and strict map-linked cards, and stores separate rolling qualification counts. Two healthy UTC days can mark the exact source `qualified_for_review`, never approved or runtime-active. Exact revision-bound operator approval now creates an audited worker target and a persistent fresh reservoir consumed by the ordinary composer; unapproved, expired or drifted profiles remain inactive.
```

The numbers may shift, but the sequence should not drift back into endless diagnostics.

## Historical prompt reference for #258

The following framing is kept only to explain the promotion discipline used by
that completed milestone. It is not a current task request.

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
