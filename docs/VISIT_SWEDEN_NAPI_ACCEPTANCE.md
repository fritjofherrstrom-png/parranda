# Visit Sweden NAPI: implementation evidence and outstanding acceptance

Date: 2026-09-07. Branch: `codex/visit-sweden-napi`, based on
`141f96946415997dfb42d22f5a5ed908848f254b` (#494). This is a bounded API
source, not a new crawler or the reviewed HTML source worker.

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
- Full local server/frontend test run passed; TypeScript, frontend build,
  dist drift and self-hosted configuration validation passed.
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

## Coordination with radius PR #495

Claude owns the walking-budget aperture/expansion change. This branch owns
the bounded NAPI source. Both touch `open-data-loader.js`.
When integrating, distinguish a cache-only source reread after failed OSM
from a second network fetch. #495's eager-empty retry was written for cache
wrappers; retrying NAPI's `load` after a failed NAPI request would perform
another HTTP request. Preserve the single-attempt bound per anchor per
composed request; a `readCached` peek is safe, a blind `load` retry is not.

Do not describe a conflict-free textual merge as verified runtime integration.
Before promotion, test the combined branch with OSM and NAPI both failing,
assert one NAPI fetch per anchor, and retain the cache-only Overture rescue.
