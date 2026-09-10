# Overture taxonomy compatibility

Status: implemented; exact-head Pi/browser acceptance is still required.
This follows #498 without changing its walking-fit search or trust gates.

## Product contract

An Overture schema transition must not silently remove global place supply, nor
turn a broad category into a false exact user preference. Acquisition now reads
`taxonomy.primary` and `taxonomy.hierarchy` from the same struct. It never reads
legacy `categories`. The latest observed STAC release, `2026-08-19.0`, already
contains the new columns, so there is no legacy probe, retry query or dual-shape
fallback. A release without the new fields fails closed.

The official [Places guide](https://docs.overturemaps.org/guides/places/) checked
2026-09-09 schedules legacy-category removal in September 2026. A read-only
DuckDB schema inspection independently confirmed the new fields in August.
The [taxonomy schema](https://docs.overturemaps.org/schema/reference/places/types/taxonomy/)
defines primary as the most specific category, equal to the final hierarchy
element; alternates are additional functions, not a hierarchy.

SQL and mapping share one explicit set of supported primary labels. Hierarchy
must be a nonempty unique list of at most 16 snake-case tokens, each <=100
characters, ending at primary. These are structural consistency checks, not a
claim to validate every edge in the provider's complete taxonomy graph. Primary
must independently occur in the reviewed route map. Unknown or malformed primary
labels are not repaired, lowercased, guessed from names or rolled up to an ancestor.

`basic_category` and `taxonomy.alternates` are not projected or consumed at all.
An unsupported playground stays out even under a park ancestor. A bookstore with
a coffee-shop alternate remains deliberately omitted; a coffee-shop primary
retains only coffee/fika intent. Neither facets nor Overture's contributing
publishers create independent evidence families. This retains #498's recall
tradeoff, not a claim that alternate functions are false.

## Bounded semantic migration

The old open-ended `_restaurant`, `_museum`, `_bar` and `_market` rules are
replaced with explicit primary identifiers. The restaurant/museum/bar sets are
reviewed from the provider's taxonomy table, plus exact existing categories and
explicit market and casual-food labels. Cuisine labels identify generic provider
types; they are not rules about the request's city, country or venue name.

Reference: [Overture taxonomy table, pinned docs commit](https://github.com/OvertureMaps/docs/blob/e0cdbaa4b208b4d781cdac1fab01e16fc4ecba2a/docs/guides/places/csv/2026-03-04-categories-hierarchies.csv).
No taxonomy is downloaded at runtime. This finite vocabulary requires deliberate
review when provider categories change; it does not auto-admit future subtypes.

The semantic audit reproduced `salad_bar` becoming nightlife under the old suffix
rule. It now contributes food; `tapas_bar` is also a reviewed food primary.
Milk/kombucha/smoothie/hair/oxygen bars are not nightlife and currently stay out.
Reviewed cocktail/wine/sports bars retain their bar role. Genuine restaurant
subtypes and museums remain supported without accepting arbitrary suffixes.
Food primaries newly named without `_restaurant` (such as steakhouse or brasserie)
can now survive the same explicit map. No rating, quality, popularity or opening
hours claim is inferred from that classification.

### Semantic continuity audit after initial migration

Every exact label supported by the pre-migration adapter was compared with the
pinned current primary table. The initial closed map missed three direct current
continuations and two safe explicit descendants:

| Current primary | Reviewed Parranda meaning | Decision |
| --- | --- | --- |
| `scenic_viewpoint` | viewpoint / exact views | accepts the current scenic-viewpoint concept |
| `dance_club` | bar / exact nightlife | accepts a dance venue, replacing dead `nightclub` vocabulary |
| `second_hand_clothing_store` | vintage-shop / exact second hand | accepts a direct current second-hand retail primary |
| `community_garden` | garden / exact green | explicitly accepted because its own primary means a garden |
| `state_park` | park / exact green + nature | explicitly accepted because its own primary means a state park |

This is not descendant inference. `playground`, `dog_park`, `water_park`,
`amusement_park` and unknown park/garden siblings remain rejected even when
their hierarchy contains park or garden. The production SQL and JavaScript
mapper are generated from and tested against the same exported closed set.

The following unreachable legacy labels were removed from the current-taxonomy
map: `viewpoint`, `nightclub`, `arts_centre`, `arts_center`, `observation_deck`,
`promenade`, `fortress`, `swimming_area`, `farm_shop`, `vintage_store`,
`thrift_store` and `charity_shop`. The pinned table defines none as a current
primary. Where the concept remains safe, a current explicit primary now owns it:
`scenic_viewpoint`, `dance_club`, `second_hand_store`,
`second_hand_clothing_store`, `antique_store`, `flea_market`, `lookout`, `fort`,
`beach`, `farm`, `market`, `marina` or `pier`. These are not aliases: no removed
label is rewritten at runtime, and gaps such as an arts centre or promenade are
allowed to remain gaps until an explicit current primary is reviewed.

## Cache and runtime ownership

Normalized cache namespace is **overture-v4**. v2/v3 rows lack hierarchy facts
and may contain categories admitted by old suffix semantics. A fresh process
must refetch rather than read, rewrite or reclassify those old normalized rows.
Old files remain intact. Deploy every consuming process from the same exact
image; a new namespace cannot fix an old process that is still running.

There is no migration of source approvals, no source activation, no new provider,
and no change to NAPI. Overture still warms outside the response-critical path;
the request reads only its fresh source cache and can initiate a background warm.
Same-key in-process warming coalesces. Cross-process/different-key concurrency
limits are not added by this compatibility change. A transient error returns
empty and is not persisted by the existing nonempty-only store policy. In
particular, v3 is never a stale-if-error fallback.

Budgets remain: radius default/max 5 km; SQL <=600 rows; normalized output
default 80/max100; default existence-confidence threshold .95; STAC timeout
5 seconds. The existing operator threshold override is unchanged. Hierarchy
projection is bounded to <=16 elements before mapping and validated again in JS.
One STAC resolution and one data query per source warm; no schema fallback query.
TTL remains the shared source-cache default (six hours) or existing operator
override. No new per-composition provider requests are added by selection.

The five-second STAC timeout is **not** a total DuckDB/S3 deadline. Existing
acquisition does not have a hard aggregate byte/time bound or global work queue;
the geographic/row/output caps do not imply one. That resource-hardening work is
separate and should be driven by exact-image cold/warm measurements, not described
as already solved. This PR neither widens the source aperture nor installs a
second query to mask failures.

## Evidence and gates

RED before production changes: taxonomy-only Parquet returned no supply through
the old SQL; malformed/missing hierarchy was ignored; salad_bar mapped to bar.
GREEN runs the actual production SQL (only the S3 relation replaced with a
generated local Parquet path) with both new-only and dual-schema artifacts.
Conflicting legacy categories cannot override the new struct. The removed-column
binder failure is separately asserted; errors cannot hide behind fail-soft [].
Tests also cover unsupported alternate-only candidates, no raw taxonomy leakage,
one source family, missing/unknown/malformed evidence, inactive/low-confidence/
unlicensed/distant records, output and query budgets, and persisted v2/v3 isolation
from v4 through the actual loader factory.

All generated Parquet and injected-provider tests are deterministic contract
evidence, **INVALID ACCEPTANCE** for live browser/Pi/provider contribution claims.
Schema inspection and any direct live mapper diagnostic are not route acceptance.
The #498 Kolding 1.7→4.8 evidence belongs to the prior executable normalization,
not to this new taxonomy head. Do not transfer it as exact-head evidence.

## Sol exact-head QA brief

Keep this PR unmerged until review. When separately authorized to stage:

1. Verify exact pushed SHA/green CI; snapshot image/config/cache and preserve
   existing evidence. Build immutable SHA-tagged image for web and worker, verify
   health, and restore the original staging state afterwards. No production deploy.
2. On isolated v4 cache, exercise a real cold→warm public Planner lifecycle in
   Kolding and another unsupported geography with different preferences. Keep
   anchor/date/language/budget fixed between comparisons. No NAPI opt-in or manual
   reviewed-source approval is needed. Do not copy v3 normalized rows into v4.
3. Kolding regression anchor: 55.4894999, 9.47905; culture+green; 6 km soft target.
   Record current date explicitly, or use the historical 2026-09-10 request only
   as an explicitly fixed-date comparison. Retain primary garden supply and reject
   the unsupported playground. Do not require exactly 4.8 km or the old winners:
   changed provider facts can legitimately change the candidate set.
4. Capture exact candidate identities, primary route roles, provenance, eligibility,
   accepted/rejected counts and final stops. Prove new taxonomy acquisition is
   consumed, not just that a route rendered from another provider/cache.
5. Desktop/mobile: route/map/cards, selected intent honesty, source disclosure and
   Keep/Add boundary. An alternate-only idea must not gain Add or an exact role.
   No demand to make NAPI or any provider win a route.
6. Verify restart and v4 reuse without re-fetch; old v3 alone must not supply a
   route. Trace network counts when observable, record resource peaks and cold
   latency. Provider degradation is INCONCLUSIVE, no_anchor INVALID for supply
   acceptance. Heuristic geometry never proves street-network/barrier feasibility.

The unrelated `city_label: "Rom"` and Swedish coordinate `lang=en` bugs remain
separate. Do not redesign walking-fit, add city rules or inflate suggestion counts.
