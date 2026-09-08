# Visit Sweden NAPI: implementation evidence and outstanding acceptance

Updated: 2026-09-08. Branch: `codex/visit-sweden-napi`, synchronized with
`6ad1eb7159b1577d7ce0c1bbf0d59f35fe3fd786` (main after #495 and #497).
This is a bounded API source, not a new crawler or the reviewed HTML source
worker. HTTP observations below were recorded on 2026-09-07 before that sync;
they have not been rerun against the updated branch.

## Actual local HTTP observations

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
- Production defaults stay disabled. `dev:full` enables the source. There
  has been no production or Pi deployment of this branch.
- Pi/browser acceptance: NOT OBSERVED. Desktop/mobile rendering, actual
  deployed build identity and restart behavior still need deployed testing.
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
peek. NAPI therefore cannot spend a second live request in the same composition,
while existing cached official evidence can still contribute. Cache-only
Overture rereads retain their existing behavior. The earlier reproduction
applied to #495 head `4d6c3c8bb762d15928f1966828ea82ae752d1f05`, not the merged
implementation; it is no longer an outstanding integration blocker.

Regression coverage in `tests/budget-aware-candidate-supply.test.js` and
`tests/visit-sweden-napi-source.test.js` verifies the single NAPI live attempt,
cache-only rescue and unchanged Overture rescue. Source acquisition and trust
gates remain separate: API/cache tests do not exercise the reviewed HTML
source's approval and worker lifecycle.
