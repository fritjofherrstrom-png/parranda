# Dense-centre supply: sampling the walkable disc

Status: implemented on this branch; live-provider acceptance is **NOT OBSERVED**.
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
rows or failure — is merged as usual, so a failed primary is still rescued; only
one still outstanding at the bound lets the directory answer alone, reported as
`source_status.collection.primary_collection: "background_refresh"`. The bound is
a latency ceiling for the outage path, not a measured Overpass percentile.

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

## Known limits and follow-ups

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
3. Lagom → Lång and an identical repeat: the map family stays in the reservoir
   (`source_status.status` count, attribution), no second GeoParquet query.
4. Dense typed/coordinate cases (Göteborg, Stockholm, Karlstad) and a
   small-town control across 4/6/9 km: record published km, stops, corroborated
   stops and walking status against main on the same cache state.
5. Provider degradation stays INCONCLUSIVE; synthetic replay is not acceptance.
