# Visit Sweden NAPI: product evidence and revision-specific acceptance

Updated: 2026-09-09. Branch: `codex/visit-sweden-napi`, synchronized with
`6ad1eb7159b1577d7ce0c1bbf0d59f35fe3fd786` (main after #495 and #497).
This is a bounded API source, not a new crawler or the reviewed HTML source
worker. Historical observations apply only to the versions recorded below.
The v2 refinement has deterministic verification; its new pushed revision
requires Sol's final staging/browser QA before operational opt-in.

## What the deployed follow-up actually proved

Experiment `20260908T223943Z-pr496-followup` deployed
`bbab31178418ef6bfcd286e1230807d8a599ed62` to Pi staging. Web and worker used
the same immutable image:
`sha256:08b9ad000318b82043e2bd8c7ae694f3a3f6f433612e980906c6e137f5a1b994`.
Browser access was `http://127.0.0.1:18080` through SSH. Health reported the
exact SHA; restart and resource limits were exercised. Staging was restored
to `446b802e84b76462522d937dd143d6efd87d91a2`, including configuration and
database. No production deployment or permanent source activation occurred.

Raw evidence and screenshots:
`/Users/fritjof/Documents/parranda-qa-evidence/20260908T223943Z-pr496-followup/`;
Pi archive: `/home/hermes/parranda-scout/experiments/20260908T223943Z-pr496-followup/`.
Primary files: `analysis/acceptance-report.md`, `analysis/cohort-comparison.json`,
`phases/controlled-*`, and `browser/controlled-on-warm-ui*`.

Four controlled phases used identical inputs and initially identical non-NAPI
cache: off, on/cold, on/warm, off with warmed NAPI cache retained. Date was
2026-09-10 and language sv. All five valid cold actions made one NAPI request;
warm and final-off phases made zero. All provider responses were HTTP 200 in
207–505 ms. URLs contained coordinates, `public:true`, a 5 km bbox and 100-row
limit, without user place text or redirects. Exact compressed response bytes
and internal peek counts were NOT OBSERVED. The configured 5 second / 2 MiB
rejection branches were not triggered by this healthy provider run.

| Context | Total / identity-resolved candidates off → warm | Published change | Warm walk / target |
| --- | --- | --- | --- |
| Mariefred typed, food+culture, mobile | unresolved | INVALID: low-confidence anchor, before NAPI | — / 4 km |
| Mariefred 59.2594,17.2410, food+views, desktop | 24/24 → 25/24 | Strandbad replaced by Gripsholms Slott | 3.2 / 6 km |
| Karlstad typed, food+culture, desktop | 80/80 → 85/85 | unchanged | 0.4 / 6 km |
| Karlstad 59.3890,13.5030, second hand+fika, mobile | 80/80 → 85/85 | unchanged | 4.9 / 4 km |
| Göteborg typed, food+culture, mobile | 80/80 → 180/179 | two stops changed, including Bhoga | 0.5 / 9 km |
| Göteborg 57.6980,11.9580, culture+green, desktop | 80/80 → 180/175 | Burgersson added between retained stops | 2.3 / 4 km |

The off/cold routes matched, and final-off recovered the baseline. This supports
a causal effect of consuming NAPI in the three changed routes. It does not
isolate whether evidence strength, entity fusion or the changed pool caused
each ranking decision. Attribution alone is not that proof. The controlled
comparisons used browser-origin requests to the real public API; separate UI
passes prove rendering and interactions, not all four phases through UI clicks.

Gripsholms Slott, Bhoga and Burgersson kept Overture identities and gained
official attribution with `corroborated_by_external:true`. These are examples
of inferred name/coordinate fusion, not hard-ID identity proof. No NAPI-only
identity became a stop; displayed NAPI-only rows remained
`commitment_eligible:false`.

Product quality remains mixed. More official records increase discovery and
independent evidence, but do not establish worthwhile local character or better
day planning. The castle was only a partial views match; the extra restaurant
was not requested by culture/green. All five valid warm walks fell outside the
requested fit band (one exceeded it); the public constraint negotiation reported
those tradeoffs. Walking validation therefore must not be called target
satisfaction. Generic cafés/bars were previously flattened into restaurants,
so the unchanged fika case cannot prove the source lacked relevant offerings.

Desktop/mobile maps, routes and expanded stop cards rendered; Keep succeeded.
Add, forced provider degradation, exact network bytes and peek counts remain
INCONCLUSIVE / NOT OBSERVED. Typed Mariefred and the initial UI geolocation
invocation were INVALID ACCEPTANCE for NAPI. Separately reproduced issues are
initial coordinate `lang=en` (P2), an automatic second typed composition after
about 0.4 seconds (P2), and favicon 404 (P3). They are not evidence of a second
NAPI fetch within one composition. The later coordinate UI adjustment occurred
after the six-hour cache TTL and is not warm-cache causal evidence.

## Refinement contract and final QA for Sol

`visit-sweden-napi-solr-v2` preserves explicit Café/Bar/Bakery/Restaurant
subtypes, rejects contradictory categories, duplicate entry identities,
ambiguous selected-language names and JSON-LD term remapping. Old cache keys
cannot bypass this new normalization. Acquisition timestamps survive cache
reads into the evidence ledger; a recent fetch is not proof of current opening
hours, operational status or recent publisher editing.

Shared identity matching preserves distinctive name words and branch numbers,
keeps conflicting Wikidata IDs separate and accepts only exact Wikidata URLs.
Historic sites have a category bucket, preventing an adjacent same-name
restaurant from borrowing their evidence. This deliberately trades some alias
recall for fewer false corroborations. It is not full entity resolution;
same-name colocated entities, translated aliases and order-dependent multi-way
matching remain risks.

A regional move may read NAPI cache for the selected anchor but cannot spend a
second live request or reuse the original anchor's records there. On the fast
directory path, a cold NAPI acquisition can finish after the response and only
contribute later; on the ordinary awaited path it can contribute immediately.
`primaryRescue:false` is not a universal ban on same-composition contribution.
The source also caps concurrent live requests at two per instance, coalesces
same-key requests and leaves overload retryable. This protects a Pi instance;
multi-replica rate coordination is still a separate operational concern.

For the new exact pushed SHA, Sol should:

1. Verify matching immutable web/worker images and health, preserve/restore
   staging and retain default-off. Repeat valid typed and coordinate cases
   across compact, regional and larger unsupported places, including explicit
   fika/evening preferences. Resolve the anchor before counting a case.
2. Compare off/cold/warm/off-warm with frozen remaining configuration and cache.
   Trace each composition and user action at the actual network boundary,
   including a genuine regional-anchor move if available. At most one live NAPI
   query per composition; selected-anchor cache misses must stay empty.
3. Inspect exact names, category facts, coordinate distances, merged IDs and
   evidence families. Confirm nearby branches/annexes remain separate, v1 cache
   cannot supply v2 rows, and cache reads retain acquisition time.
4. Record candidate contribution, corroboration and final selection separately.
   Report requested/covered/partial intent and walking fit for every final route.
   Do not require the previous castle/restaurants to win; stricter matching may
   correctly remove them. Check Add/Keep and desktop/mobile cards when available.
5. Classify unavailable provider/category/expiry scenarios as NOT OBSERVED;
   synthetic fixtures prove code contracts, not provider or browser acceptance.

Visit Sweden's [food schema guide](https://docs.visitsweden.com/en/edit/drinksandfood/)
distinguishes business name from headline and specific food/drink types.
Its [NAPI reuse information](https://corporate.visitsweden.com/nationellt-api/)
supports factual data reuse in apps; the documentation footer is not the data
license. No broader media rights or reviewed-HTML source approval is claimed.

## Historical local HTTP observations — 2026-09-07

The real Node server served
`http://127.0.0.1:18765/api/route-recommendations?lang=sv` with the open-data
loader, NAPI source and agnostic composer enabled. Providers were real, not
injected. Cache directory: `/tmp/parranda-napi-sept7-qa`. Overture and the
separate Wikidata loader were not enabled; OSM records can carry Wikidata
references themselves. These counts are observations, not stable fixtures.

All requests were POSTs with a coordinate anchor, `dates:["2026-09-08"]`,
`walking_km_target:4`, `include_external_candidates:1`,
`experimental_agnostic_route_output:1` and `agnostic_engine_compose:1`.

| Anchor | Preferences | HTTP / loaded supply | Published route observation |
| --- | --- | --- | --- |
| Malmö, 55.6053 / 13.0002 | food, museums | 200; 25 OSM + 9 NAPI | Cafe 2000, Form Design Center, Rådhuskällaren; no NAPI route attribution observed |
| Östersund, 63.1792 / 14.6357 | food, museums | 200; 25 OSM + 3 NAPI | Jamtli and Tripti; limited/thin output, no NAPI route attribution observed |
| Stockholm, 59.3286 / 18.0773 | museums | 200; 25 OSM + 24 NAPI | Moderna museet and Frippe; Moderna museet carries OSM, Wikidata and NAPI attribution |

Concrete public response evidence for Stockholm:

```json
{
  "path": "days[0].primary_route.main_stops[0]",
  "id": "osm-node-29898032",
  "label": "Moderna museet",
  "attribution_urls": [
    "https://www.openstreetmap.org/node/29898032",
    "https://www.wikidata.org/wiki/Q1274511",
    "https://data.visitsweden.com/store/201/metadata/83"
  ]
}
```

The NAPI URL appears under `provenance.attribution`, family `official`.
This proves source evidence reaches a published HTTP route through the real
loader/identity/gate/composer path. It does NOT prove that adding NAPI changed
which stop was selected: this stop already had OSM/Wikidata evidence.
Unmerged NAPI-only district ideas in the same response had
`commitment_eligible:false`, including Nationalmuseum and Kungliga Dramaten.

Remaining source-quality gaps observed: provider labels can be marketing
headlines, exact identities may remain unmerged, broad `TouristAttraction`
and generic shops are deliberately rejected, and one official family alone
cannot self-promote into routes. No title-based category or alias shortcut is
introduced. The provider bbox is an envelope, not exact national borders.

## Verification and scope limits

- Refinement verification on 2026-09-09: targeted NAPI/identity/budget/cache
  tests passed 81/81. `npm test` discovered 2,787 tests: 2,786 passed, zero
  failed and one PostgreSQL test skipped locally. Frontend tests passed
  239/239; TypeScript, frontend build, dist-drift verification and self-hosted
  validation passed. Generated Astro UID-only drift was removed. These are
  deterministic/local checks, not runtime acceptance of the refined revision.
- Deterministic tests cover transport/schema failures, category and graph
  boundaries, source corroboration gates, request concurrency, healthy empty
  caching, failure retries, revision/settings-separated cache identity,
  cross-instance disk reads and the warm Overture fast path.
- After synchronization with main on 2026-09-08, the combined focused source
  suite passed 168/168. `npm test` discovered 2,777 tests: 2,776 passed, zero
  failed and one explicitly skipped PostgreSQL integration test, which CI runs
  separately against its disposable database. Separate frontend tests passed
  239/239; TypeScript, frontend build, dist drift and self-hosted validation
  passed. These local results do not stand in for CI on the pushed revision.
- Production defaults stay disabled. `dev:full` enables the source. Pi/browser
  acceptance for bbab311 was completed as described above. No production
  deployment occurred; the v2 refinement still needs final QA on its own SHA.
- Reviewed HTML-source persisted worker acceptance: INVALID ACCEPTANCE /
  LIFECYCLE NOT EXERCISED by these NAPI tests. Cache-instance tests are not
  discovery, qualification, operator approval or worker/reservoir refresh.
- The large unsupported + smaller/regional worker acceptance and a negative
  `review_needed` control remain outstanding for the reviewed source path.
- A provider outage in later QA must be classified INCONCLUSIVE / NOT
  OBSERVED, not reported as proof that the integration is correct or broken.

## Integration with merged #495 and #497

#495 merged as `493a480a7baefcefbf622bad5504d0687f110271`; #497 merged as
`6ad1eb7159b1577d7ce0c1bbf0d59f35fe3fd786`. Both are included in this branch.
The only merge conflict was the roadmap document; both the NAPI API/cache
track and the separately reviewed HTML-source worker track are retained.

The previously observed double-fetch defect is resolved by #495's reviewed
head `f456ecb32805de5beac82e04b052b442cd154427`. When primary acquisition fails,
a source declaring `primaryRescue: false` is offered only its `readCached()`
peek. That primary-failure rescue cannot spend a second live request,
while existing cached official evidence can still contribute. The v2 refinement
additionally closes the separate regional-anchor-change path. Cache-only
Overture rereads retain their existing behavior. The earlier reproduction
applied to #495 head `4d6c3c8bb762d15928f1966828ea82ae752d1f05`, not the merged
implementation; it is no longer an outstanding integration blocker.

Regression coverage in `tests/budget-aware-candidate-supply.test.js` and
`tests/visit-sweden-napi-source.test.js` verifies the single NAPI live attempt,
cache-only rescue and unchanged Overture rescue. Source acquisition and trust
gates remain separate: API/cache tests do not exercise the reviewed HTML
source's approval and worker lifecycle.
