# Dense-centre supply: sampling the walkable disc

Status: implemented on this branch. Independent Pi acceptance **FAILED** on
`52c23d7` (a bounded-wait race on Lagom → Lång, below); the follow-up keeps the
map family across that switch. Live-provider acceptance of the follow-up is
**NOT OBSERVED**.
Related: `BOUNDED_WALKING_FIT_SELECTION.md`, `BOUNDED_COLD_TO_READY_PLANNER.md`,
`OVERTURE_TAXONOMY_COMPATIBILITY.md`, `VISIT_SWEDEN_NAPI_ACCEPTANCE.md`.

## Product contract

An any-place day may use the walking budget the person asked for, and a single
requested intent may form an honest day, whenever trusted source-backed supply
exists for it. Sampling, cache reuse and depth decide only *which* source rows
reach the engine. No source, licence, confidence, taxonomy, availability,
reach or promotion gate changes. Single-source places stay single-source:
`provisional`, low confidence, `corroborated_by_external: false`, and capped in
readiness (`capped_by_external_only_sources`, `capped_by_thin_day`).

## Evidence and what it does not show

Earlier field notes kept recording short days beside exactly 80 directory
records: Göteborg typed food+culture 0.5 of 9 km, Göteborg coordinate
culture+green 2.3 of 4 km, Karlstad typed 0.4 of 6 km
(`VISIT_SWEDEN_NAPI_ACCEPTANCE.md`); Göteborg food/evening 0.5→0.9 of 9 km,
Strängnäs 0.2→1.5 and Göteborg-west 0.8→1.7 km "far below target"
(`BOUNDED_WALKING_FIT_SELECTION.md`). None became a failing test.

Independent Pi traces on the public head `0234d2b` (2026-09-27, Göteborg,
`second_hand`, 6 km, `Prefer: respond-async`) located two different losses:

1. **Warm background supply answered for a cold map source.** The lifecycle
   fast path peeked a MISS for the Overpass key, a HIT of 16 Wikidata rows
   (culture/green, three categories) and a MISS for Overture, and returned
   those 16 in 5 ms (`cached_supply`, `requested_intents_missing:
   [second_hand]`, `can_support_target: false`). No Overpass or Overture call
   started; the day was empty. The 600-row Overture cap played no part.
2. **A single requested intent could not form a day.** With a cold candidate
   cache, Overpass returned HTTP 504 and Overture delivered 600 → 80 rows that
   kept all 12 raw second-hand/antique places. Pool 80 → role surface 20 → one
   selected place → `days: []` (warm: 96 → 24 → 1 → `days: []`, also at 9 km).
   The 12 were neither pool-rejected nor dropped by 600 → 80.

The traces therefore do **not** show the directory's 600-row window losing
Göteborg second-hand supply. That window is a separate, dense-centre mechanism
shown here only in synthetic replay (below).

### Pi acceptance of `52c23d7`: the bounded wait raced a successful provider

Paired runs of the public image and `52c23d7` (fresh cloned catalogues, same
staging environment and worker, `Prefer: respond-async`) failed on a walking-
budget switch:

- Göteborg centre coordinates, `second_hand`, 2026-09-28 (clean pair): warm
  6 km published 4 stops / 5.8 km from `loaded:121` (`cached_supply`; pool
  113 → role surface 27 → engine 4). Changing only the budget to 9 km, the
  9 km Overpass request returned HTTP 200 **10.876 s** after it started, about
  0.9 s after the 10 s bound. The published day was already directory-only:
  `loaded:80`, `background_refresh`, 2 stops / 5.6 km.
- Same coordinates, no preferences: 6 km 4 stops / 4.1 km; 9 km
  `background_refresh`, `loaded:80`, `can_support_target: false`, 2 stops /
  2.4 km, below the 5.4 km floor.
- Göteborg typed, `second_hand`: a warm repeat's first Overpass pass answered
  HTTP 200 in 4.0 s, but only its wider expansion was outstanding at the bound
  (it later returned 504), and the answered first pass was not used.

Cause: at the bound the composition used only the eager directory and cached
NAPI rows. It dropped (a) the same anchor's fresh map answer for the other
walking budget — the one that had just published the four-stop day — and
(b) cached Wikidata corroboration, which is not an eager source. Directory-only
rows are single-family and experimental, so the day could hold at most two of
them. The provider was healthy; the map answer only missed the bound.

## Mechanisms and changes

### 1. The directory samples the walkable disc, not the nearest 600

`buildOvertureQuery` ordered by squared distance and kept 600 rows inside the
5 km box; `selectRecords` then kept the 80 best-fitting nearest. In a dense
centre those 600 lie within a few hundred metres, whatever the budget.

Now the same bounded query stratifies the window by fixed walking-reach rings
(0.5, 1, 1.5, 2.25, 3 km, then the window edge — thirds of the default 1.5 km
reach and the reach of a 9 km and a 12 km day; 3 km is also the exact-anchor
candidate reach) × Parranda route type. Each stratum offers its nearest
non-chain rows first (`row_number() OVER (PARTITION BY ring, type ...)`) and
the 600-row budget is shared by stratum rank. The closed taxonomy map, 0.95
confidence floor, closed-status, licence and hierarchy filters are unchanged.

The sample depends only on the anchor window, so it is cached once per anchor
(`overture-v5`, key = anchor + radius + confidence floor) and each request
selects its bounded 80 from it: one member per type first, then a weighted
round-robin over (ring, type) where rings inside the request's reach
(`budgetAwareRadiusKm`, shared with Overpass) weigh 1, the next ring 0.5 and
farther rings 0.25, and requested intents weigh 2 (strong) or 1.5 (adjacent).
Requests without a walking budget (nearby surfaces such as Blitz) stay
proximity-first. A changed Kort/Lagom/Lång budget or preference set now
re-selects from cache instead of starting another GeoParquet query; before, each
preference set was its own acquisition and a concurrent distinct query was
refused as busy. v2–v4 rows are never read. Tradeoff: a cache entry now holds up
to 600 normalized rows per anchor instead of 80 per anchor and preference set.

### 2. Overpass's own cut follows the same disc

Overpass already answers from the whole budget aperture (per-category `out`
budgets, by id), but the loader kept 25 records nearest-first per category plus
a two-record frontier. With a walking budget, each category is now interleaved
across the same rings before the unchanged category round-robin and capacity
frontier. Without a budget the order is unchanged. This matters for depth:
directory rows corroborate only places the map sample also kept, so a
nearest-first map cut left corroborated places beside the anchor only.

No new fusion rule was needed. The shared, conservative entity resolution
already merges a map row and a directory row of the same place (≤ 75 m plus
full distinctive-name agreement, or a shared Wikidata id) into one candidate
with two families, which is what lets role depth and unrequested support use
it. Replay showed that corroboration existed only where both samples
overlapped — beside the anchor — so the fix is in the samples, not in looser
matching.

### 3. A warm background source never answers for a map source nobody asked

The lifecycle's read-only fast path now requires (a) an Overpass cache answer
for this exact request — a cached empty answer counts; a missing entry does
not — and (b) cached evidence that answers the request: no requested intent
missing and a reservoir whose `can_support_target` is not `false`. Otherwise
acquisition runs, re-reading every cache and fetching only what has not
answered. This covers warm Wikidata (trace 1) and a warm directory alike.

On acquisition, a varied warm directory waits at most 10 s
(`DIRECTORY_PRIMARY_WAIT_MS`) for the live primary. A primary that settles —
rows or failure — is merged as usual, so a failed primary is still rescued. The
bound is a latency ceiling for the slow/outage path, not a measured Overpass
percentile, and it is unchanged.

### 3b. A walking-budget switch keeps the map evidence it already has

A primary still outstanding at the bound keeps running and caches its answer;
the composition answers now, with the best map evidence this process already
holds for the anchor, in this order:

1. **This request's own answered first pass** while only its one wider query
   (or regional scout) is outstanding — `first_pass_while_expanding`.
2. **A fresh stored answer for the same anchor bucket, preferences, anchor
   mode, scope and limit at another walking budget** — a Kort/Lagom/Lång switch
   changes the Overpass key, not the place or the trust of an answer already
   verified and stored. The nearest aperture wins, then the nearest budget;
   `neighbouring_budget_cache` with `primary_collection_target_km`.
3. Otherwise no map evidence: `background_refresh`, reason
   `no_answered_map_evidence`.

Every other source then adds what it holds for the anchor at zero network cost:
the eager directory selection for this budget, cached Wikidata corroboration
and cached NAPI rows. When the request's own Overpass answer **fails** (for
example HTTP 504) and a neighbouring-budget answer exists, that answer backs
the day the same way (reason `primary_failed`) and the failure stays visible as
`loader_error`. A genuine empty answer is an answer and is never replaced.

Bounds. A neighbouring answer is only ever an entry the loader itself stored:
fresh (inside the cache TTL; an expired or stale-if-error value never
qualifies), non-empty, non-error, never a selected regional cluster, and never a
different preference set, anchor mode, spatial scope or limit. The loader keeps
a pointer list of at most four budgets per such group, written only after a
successful fetch. The answered first pass lives in process memory only while
its load is in flight. `source_status.collection` carries
`primary_collection`, `primary_collection_reason` and
`primary_collection_target_km`, and readiness adds a matching
`primary_collection_*` reason (not a cap: every record keeps its own trust).

Latency, provider cost and 504. Latency is unchanged: at most the same 10 s
bound, then an immediate answer. Provider cost is unchanged: zero additional
Overpass, Overture, Wikidata or NAPI calls; the outstanding Overpass request
completes in the background and the next request is served from its own
cached answer (`cached_supply`). HTTP 504 for the new budget: with a fresh
neighbouring answer, that map evidence plus the other families
(`neighbouring_budget_cache`, `primary_failed`, `loader_error: http_non_200`);
without one, the directory rescue as before. An expansion that returns 504
after a successful first pass leaves the first pass as that key's stored
answer. The stale-if-error fallback for the request's own key is unchanged
and takes precedence.

### 4. One requested intent may form a two-place day

The engine reservoir admitted one experimentally admitted place per requested
role; role depth and unrequested support required shared-gate (corroborated)
candidates. A two-intent request could therefore publish two single-source
places, but a single-intent request with single-source supply had one place and
no day (trace 2). Now, when nothing else joined a one-place requested spine,
that same role may add its next planner-usable option — exactly one, through
the same trust-tier, availability, local-feel and operational primitive the
combination uses. The spine never exceeds the two experimental places a
two-intent day already has; unrequested experimental support is unchanged.

## Offline evidence (synthetic geography)

Harness: seeded worlds (dense: 800 restaurants σ 0.9 km, 350 cafés σ 0.8,
250 bars σ 0.6, 22 museums σ 1.4, 25 galleries σ 1.0, 35 parks 0.3–3.8 km,
6 gardens, 8 viewpoints, 5 marinas, 3 castles; small-town control 64 places),
the real production SQL against a local Parquet file, an evaluator of the
loader's Overpass query, and the real `/api/route-recommendations` handler.
Share of days reaching the 60 % walking floor, 5 seeds × 3 preference sets:

| Reservoir | Target | main | + directory sampling | + Overpass cut |
| --- | --- | --- | --- | --- |
| Dense, directory only | 4 / 6 / 9 km | 0 / 0 / 0 of 15 | 13 / 15 / 15 | 13 / 15 / 15 |
| Dense, map + directory | 4 / 6 / 9 km | 5 / 1 / 1 of 15 | 10 / 5 / 13 | 11 / 13 / 15 |
| Small town, map + directory | 4 / 6 / 9 km | 10 / 7 / 11 of 15 | 10 / 7 / 11 | 10 / 8 / 11 |

Dense medians for map + directory moved from 1.9 / 2.0 / 2.2 km to
2.8 / 4.1 / 6.8 km with 2.9 / 4.5 / 5.9 stops. The dense nearest-600 window
reached about 0.43 km. In that synthetic world the window also dropped second-
hand rows (2 of 12 kept); the Göteborg trace shows real Göteborg did not.

A `second_hand`-only day from directory supply with the map source failing:
main published no day at 4, 6 or 9 km; this branch publishes two second-hand
stops of 4.0 / 5.0 / 5.4 km, `promotable_limited`, `thin_usable`.

`tests/dense-centre-supply.test.js` encodes these cases on the dense world plus
twelve second-hand/antique places; eight of its ten tests fail on main. The
other two are controls: a short day stays near and a no-budget request stays
proximity-first, and a genuinely compact world reports
`shorter_than_requested_band` with `can_support_target: false`.

`tests/walking-budget-switch.test.js` replays the Pi race on the same world:
warm 6 km, then only the budget changes to 9 km while the 9 km Overpass answer
arrives just after the (scaled) bound. Nine of its eleven tests fail on
`52c23d7`; the two controls (map answer inside the bound; no map answer for any
budget) pass on both.

| Same anchor, date and cache state | `52c23d7` | this head |
| --- | --- | --- |
| No preferences, warm 6 km | 4 stops / 4.9 km, 121 records (`cached_supply`) | same |
| No preferences, 9 km, map answer late | 2 stops / 2.6 km, 80 records, directory only (`background_refresh`) | 6 stops / 6.0 km, 121 records, all map-corroborated (`neighbouring_budget_cache`) |
| No preferences, 9 km, map answer in time (control) | 6 stops / 6.0 km | same |
| `second_hand`, warm 6 km | 4 stops / 3.7 km, map-corroborated | same |
| `second_hand`, 9 km, map answer late | 2 stops / 5.4 km, directory only | 5 stops / 2.8 km, map-corroborated, `shorter_than_requested_band` |

At the loader, the switch on `52c23d7` lost 25 map and 16 Wikidata records
(and re-selected 12 directory rows); this head loses none outside the
directory's own re-selection.

## Known limits and follow-ups

- **Composition can make a Lång day more compact than a Lagom day.** The
  healthy-map control above separates this from the wait: in the synthetic
  world a `second_hand` 9 km day with its own, in-time map answer is 4 stops /
  2.6 km against the 6 km day's 4 stops / 3.7 km, on `52c23d7` and this head
  alike (the no-preference and food+culture controls reach the band); the
  selection code involved is unchanged from `main`. The
  engine reservoir takes each unrequested role's leading option — here all
  within about 1 km of the anchor — while the capacity frontier is only built
  when the public role surface is compressed, and that surface spanned 4.2 km.
  Offered a far same-role candidate, the engine still chose the nearer one.
  Two bounded prototypes (frontier judged on the engine reservoir; one shorter-
  preset engine trial) each fixed one case and changed another, so they are not
  in this change: stop depth versus walk length on a long budget needs its own
  explicit contract and acceptance. Until then such a day is reported as
  `shorter_than_requested_band`, and that tradeoff is still not visible in the
  Planner UI.
- A neighbouring-budget answer was collected for its own aperture (for 6 km,
  a 1.5 km disc against 2.25 km for 9 km). It keeps the map family and its
  corroboration across the switch, but a live 9 km answer can reach farther;
  the next request after it lands uses it.

- **Source quality is not solved.** Pi QA found Uppsala Auktionskammare
  (`osm-node-11690508038`) published as a second-hand shop at an OSM address the
  operator no longer uses — its own site names another address, a valuation and
  drop-off office, and online-only auctions — and Göteborg's Moneta Mynt & Guld
  carrying the directory website of another Antikhallarna tenant. Websites feed
  operational-viability signals and event-source scouting, not stop cards.
  Single-source rows stay labelled; stale visit forms and conflated websites
  need separate, generic source-quality work.
- A warm Overpass answer that fully answers the request still takes the fast
  path without refreshing a cold directory; the directory then warms on the
  next acquisition-path request.
- Heuristic walking geometry still proves no barriers or street network.
- The ring edges and weights are reviewed constants, not tuned to real cities.

## Acceptance brief (exact pushed head; NOT OBSERVED until run)

1. Isolated preview from the exact image, public-like cache copy (Wikidata warm,
   Overpass/Overture cold for the key): Göteborg typed `second_hand`, 6 km,
   `Prefer: respond-async`. The first composition must start Overpass and the
   Overture acquisition (no 5 ms `cached_supply` return) and publish a day with
   relevant second-hand stops, or report exactly why not.
2. Cold candidate cache with a real Overpass failure: expect a directory-only
   two-stop second-hand day, labelled single-source.
3. Lagom → Lång and an identical repeat, same anchor/date/preferences/cache
   state, including a 9 km Overpass answer just after 10 s: the map family stays
   in the reservoir (`source_status.status` count, stop attribution),
   `primary_collection` names how (`neighbouring_budget_cache` or
   `first_pass_while_expanding`), no second GeoParquet query, and the next
   request uses the 9 km answer itself. Record published stops and km against
   the 6 km day; a shorter single-intent walk is the separate composition limit
   above and must be reported as `shorter_than_requested_band`.
4. A 9 km Overpass 504 after a warm 6 km: the 6 km map answer backs the day
   with `loader_error: http_non_200`; with no map answer for any budget, the
   directory rescue as before.
5. Dense typed/coordinate cases (Göteborg, Stockholm, Karlstad, Berlin) and a
   small-town control across 4/6/9 km: record published km, stops, corroborated
   stops and walking status against main on the same cache state.
6. Provider degradation stays INCONCLUSIVE; synthetic replay is not acceptance.
