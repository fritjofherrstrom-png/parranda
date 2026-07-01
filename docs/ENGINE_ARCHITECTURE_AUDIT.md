# Parranda Engine — Architecture Audit & Improvement Roadmap

**Status:** Living audit · **Date:** 2026-07-01
**Method:** Per-subsystem audit (multi-agent, one auditor reading the real code per subsystem) + hand audit of the subsystems the run didn't reach + empirical verification of the top finding on live cached city data.
**Context:** Follows the 12-city generic-engine verification (Tbilisi/Lyon/Valencia/Porto/Kraków/Tallinn/Bergen/Ljubljana/Thessaloniki/Lviv/Kyoto/Montevideo — 5 scripts, 4 continents, no citypacks): **all 12 reached the agnostic path with live OSM, 0 failed; blind judging = 8 smart / 1 acceptable / 3 thin.** Script is not the discriminator; **supply density is.**

---

## 0. Headline finding (VERIFIED) — density-adaptive clustering is dead in production

`composeDistrictDay(candidates, { … })` (no `linkKm`) → `summarizePlaceStructure(candidates, { linkKm })` whose signature is `{ linkKm = DEFAULT_LINK_KM }`. An **absent** property still triggers the destructuring default, so `linkKm` becomes `0.35`, which then satisfies `Number.isFinite(linkKm)` in `clusterCandidatesIntoAreas` and **bypasses `adaptiveRadiusKm` for the entire production path.** The "density-adaptive clustering" shipped in #315 has been running fixed-0.35 the whole time.

**BUT — activating it naively regresses.** Measured on real cached OSM (25 candidates each):

| City | fixed 0.35 (prod today) | pure adaptive | naive blob-split |
|---|---|---|---|
| Lyon (dense) | **4 districts** (6,5,4,3) | 2 (5,4) + 16 scattered ❌ | 4 (6,5,4,3) ✅ |
| Tbilisi | 4 (8,6,5,3) | 4 (6,6,4,3) | 4 (unchanged) |
| Tallinn (thin) | **1 blob (17)** ❌ | 2 (13,3) ✅ | 1 (17) ❌ still |
| Porto | 2 (10,3) ✅ | — | **2 (5,4) + 16 scattered ❌ regressed** |

**Conclusion:** fixed-0.35 over-blobs thin cities; pure adaptive over-scatters dense cities; a size+diameter blob-split split Porto's *good* wide district while missing Tallinn's *compact* blob. Distinguishing a good-wide district from a bad-compact blob is not captured by size/diameter alone. **This is a real clustering-v2 problem needing dedicated tuning + multi-city verification — NOT a one-liner.** Do not ship a naive "fix"; it regresses the cities that already score smart.

---

## 1. Prioritized roadmap (impact × feasibility)

| # | Improvement | Subsystem | Dimension | Impact / Effort |
|---|---|---|---|---|
| 1 | **Clustering-v2** — density adaptation that splits blobs without over-scattering dense centres (see §0; needs empirical tuning) | district | correctness/experience | high / **med-high** |
| 2 | **Daypart coherence** — a nightlife district can read "midday" (argmax swamped by restaurant/museum/market); two selected districts can share a daypart (no arc). Surface `daypart_weights`; resolve collisions in the composer | district | correctness/experience | high / med |
| 3 | **Adaptive radius *expansion* when supply-thin** — the loader makes ONE 1.5 km Overpass call and never reacts to thinness; `MAX_RADIUS_KM=5` is unused. Re-query wider when records/categories are below a threshold. THE lever for Tallinn/Lviv/Montevideo | supply | experience | high / med |
| 4 | **Broaden OSM tag coverage** — `historic=monument/memorial`, `tourism=attraction`, `historic=ruins`, `tourism=artwork` map to existing scenic/culture vocab; thickens sparse historic cities at zero new-vocab cost | supply | scalability | med / low |
| 5 | **Persistent disk (#319, open)** — cache is on ephemeral `/tmp`; every instance/redeploy re-pays the cold load | deploy | efficiency | high / low(infra) |
| 6 | ~~Cache genuinely-sparse (`loaded:0`) results~~ **— CORRECTED (Hermes): the OSM loader DOES cache `loaded:0`** (`shouldStore` only excludes `error*`; verified empirically: 2 lookups = 1 fetch). The residual, minor nuance is that **Wikidata's** store is non-empty-only (`length>0`), so an empty Wikidata result re-warms each visit — but that is intentional background-warm design, not a bug. Item withdrawn. | caching | efficiency | ~~med / low~~ n/a |
| 7 | **Engine-compose path reports `walking_validation: {valid:true, blockers:[]}` from route-existence, not an explicit budget gate** (`agnostic-route-output.js:917`, in `composeAgnosticRouteViaEngine` @837). The legacy path runs `validateAgnosticWalkingOrder` with real totalKm/maxLegKm budgets; the engine path relies on the engine returning `null` for `<2` viable stops and marks only `checks.walking_source`. The in-code comment (914–916) is honest about this, but the identical `walking_validation` **shape** could still read to a consumer as a full budget check the engine path didn't run. Gated off today. | route | honesty | high / med |
| 8 | **Per-locale Wikidata labels** — `PARRANDA_WIKIDATA_LABEL_LANGS` is one deploy-wide string (`el,en`); consensus silently fails in non-English cities. Resolve label language from the anchor's country/region per request | supply/deploy | correctness | med / med |
| 9 | **Distance into event ranking** — events are dwithin-gated but distance never feeds salience; a 200 m and a 2.9 km concert rank identically | events | experience | med / low |
| 10 | **Set-cover ignores daypart complementarity + proximity** when picking the 2nd/3rd district | district | experience | med / med |
| 11 | **O(n²)×3 clustering passes** — fine at ~25 candidates, unbounded if the loader breadth grows; add a grid/cap before broadening supply | district | scalability | med / med |
| 12 | **Structural supply ceiling** — a single-family OSM record (family=`map`, tier=`inferred` → existence `low`) can't clear the diversity-2 corroboration bar, so unknown-city supply is capped until consensus lands or the admission rule is revisited | entity-res | scalability | high / high |

**Cross-cutting themes:** ① supply density (dominant lever) ② daypart coherence ③ honest provenance/validation ④ request-path efficiency & single-instance scale ⑤ experience surfaces (no district **map**; no main-planner any-city doorway).

---

## 2. Per-subsystem notes

**Candidate supply — adequate.** Genuinely agnostic + fail-closed; category-balanced selection is correct (server + client). Gaps: fixed 1.5 km aperture (no thin-city expansion), `fetchBreadth` decoupled from the real per-category budget (latent tuning bug), first-visit can't reach consensus (Wikidata warms out-of-band → one visit behind), conservative tag table omits high-yield culture/landmark types, `findOsmMapping` first-match-wins over an unordered table.

**Entity-resolution & consensus — strong.** Unicode fix is real; earned (not faked) consensus. Gaps/risks: the diversity-2 bar means most single-family any-city places stay hidden (the supply ceiling); silent under-merge when two real twins narrowly miss 75 m / 0.6 name-sim (both then hidden); umlaut expansion (München vs Muenchen) doesn't match; hard-Wikidata-id merge skips the category-bucket sanity check within 500 m.

**District intelligence — adequate.** See §0 (dead adaptive) + daypart coherence (#2). Also: `maxAreas` default (2) disagrees with the only callers (3); centroid averaged in raw degrees; O(n²)×3.

**Route / dayflow engine — adequate.** Legacy in-module synthesizer is the DEFAULT and the only branch with a real walking-budget gate + proximity chaining; the `synthesizeVia:"engine"` path reports `walking_validation {valid:true, blockers:[]}` from route-existence rather than an explicit budget gate (agnostic-route-output.js:917; in-code comment is honest, but the shape parity is the concern — see #7). Two parallel daypart-ordering implementations with different proximity logic; fixed 1.22 detour + 12 min/km can reach the user surface.

**Live events & Pulse — adequate.** NOTE: the warm-cache/instant-pending reliability fix + `sort=end_time` live in PR #317 (open), not yet in main — on main the route awaits the feed inline (15 s). Registry only speaks the Linked-Events shape (can't add ICS / schema.org without a new adapter); distance not in ranking; cultural/admin classifier languages (en/el/sv) miss Finnish, the only live feed language.

**Hand-audited (workflow hit a session limit):**
- **Agnostic intake & doorway** — Nominatim resolver is gated/cached/fail-closed/conservative; provenance gating fixed the fallback-masquerade. Gaps: no **main-planner** doorway for arbitrary cities (only `/labs/anywhere`); resolver cache is per-process (not persistent); single geocoder endpoint, no failover.
- **Caching & performance** — `place_structure` re-calls `openDataLoader(anchor)` (a cache hit, but a second call path); no persistent disk (#319); O(n²) clustering on the hot path. (An earlier claim that `loaded:0` is not cached was WRONG — the OSM loader does cache empty results; corrected per Hermes, see #6.)
- **Frontend / experience** — renders place_structure panel + evening anchor + live-events + preference_coverage. Gaps: **no map of the districts** (the day is a list); no main-planner any-city entry; event times shown in the viewer's tz (venue-tz honesty); `script.js` frozen-ish per the migration contract.
- **Deploy / infra / scalability** — all flags on; cache on `/tmp` (#319); disk pins single-instance (blocks horizontal scale → needs a shared cache for scale); `el,en` temporary (#8); `PARRANDA_AGNOSTIC_ENGINE_COMPOSE` off; self-hosted Overpass would fix cold-load speed (public mirrors measured 60–77 s — see #318).
- **Tests / quality** — 1500+ deterministic tests, no live network, non-Latin entity-resolution covered. Gaps: **the dead-adaptive-clustering bug passed every test** (tests exercise `clusterCandidatesIntoAreas`/`summarizePlaceStructure` directly, never the `composeDistrictDay → summarize` chain) — add a guard that the production path actually uses adaptive; no multi-city integration test; the engine-compose walking-validation honesty gap is untested.

---

## 3. Completeness — what this audit did NOT cover
Weather/time context subsystem; the **Blitz** "next place from anywhere" engine (named in the product vision, unaudited); i18n completeness (sv/en bridge gaps); abuse/rate-limiting beyond the resolver's 1 req/s; production observability/logging; and the **recognized-citypack** composition path (only the agnostic path was audited). These are honestly out of scope of this pass and should each get a look.

---

## 4. Recommended sequencing
1. **Ship the infra + already-open PRs** — #319 (disk) + #317 (events reliability) + #318 (mirror failover): they unblock supply durability with zero new risk.
2. **Supply density (#3 + #4)** — the single measured lever from the 12-city verdict; makes thin cities richer generically.
3. **Daypart coherence (#2)** — self-contained; needs care (mixed districts are genuinely ambiguous) but no clustering entanglement.
4. **Clustering-v2 (#1)** — dedicated, empirically-tuned, multi-city-verified. Do NOT rush; §0 shows naive fixes regress.
5. **Honesty (#7)** and **structural ceiling (#12)** as they gate a public engine-compose flip.
