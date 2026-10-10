# Machine-verified Live supply

Owner: Codex. Target: `codex/machine-verified-live-supply`, based on GitHub main
`cf2430102414c7cd85b61b1a3930f5d5d9ff1a62`. Work began from main
`23160134cd73af166d67057a14c72c4bf8585946` and was rebased after #555
landed with #556 included. The later main #558 was merged into this branch on
2026-10-06 without conflicts. Both GitHub landings occurred outside this
workstream; their visual/runtime acceptance is not inferred here.

During the calendar patch, GitHub main advanced to
`6aa077752ec64ecf387fdc3e93f1cd0fa6a78dd7` with #560's sole public entry.
That authoritative main commit is merged into this same PR branch; the only
conflict was generated Anywhere HTML, resolved by rebuilding `frontend/dist`.
#560's source PR head is `99f4627441552f300a3d5e370d454f9d518c09e5`;
its source delta is included through GitHub main, not a separate unlanded stack.
The entry and HTTP/Live seams were rechecked with offline fixtures. This local
integration is not a GitHub merge, deployment or runtime acceptance.

## Activation contract

Per-source human approval is not the normal prerequisite for event display.
The existing scout, exact descriptor binding, two-day qualification, cache,
normalization, date/geography gates and Live/Pulse display remain the pipeline.
Fresh machine-qualified bindings participate automatically; explicit
`PARRANDA_QUALIFIED_SOURCE_RUNTIME=disabled` is an operator opt-out. They retain
low confidence and expire after eight days without a healthy observation. They
are Pulse-only and do not become route/day inputs or human-approved catalog rows.

The catalog and ordinary scout worker must actually be operating. An unwired
catalog/search environment is not evidence that a place has no events. Code
defaults do not themselves migrate a database, obtain credentials or deploy.
The separate place-reservoir human-approval contract is unchanged.

## Request-time discovery lane

A place with no approved or machine-qualified local event source looks for one
during its own Live collection, which already runs out of band while the day is
built; the day never waits for it and Live may arrive later. The lane uses the
same bounded source search as the discovery worker (at most two
locality-scoped queries, at most six seeds), the ordinary source scout and the
same manifest binding as qualification. Only structured event interfaces the
scout recognises become feeds; prose and the model reader are not used here.
Robots exclusions and restricted or permission-required terms remain blockers.

A feed found this way is a single observation: `status: probationary`,
`runtime_trust: request_time_single_observation`, Pulse-only, low confidence,
never a route/day input or an approved catalog row, with its actual source URL
kept. Local floating times use a source-declared zone, otherwise the zone
derived offline from the trusted anchor coordinates. The ordinary time,
geography, venue-resolution and display gates decide every event; nothing is
invented. One discovery per ~1 km cell is reused for six hours, an empty one is
not repeated for an hour, and the existing scout demand still asks the worker
to qualify the source over two UTC days. `PARRANDA_REQUEST_TIME_EVENT_DISCOVERY=disabled`
is an operator opt-out; without a configured source search the lane is off.

## Main reader for local documents

`quoted_public_document` reads municipal news, association pages, notices,
local-language public prose, PDF text and OCR-readable posters/scans. A model
performs event extraction as the main reader; deterministic calendar adapters
remain appropriate for explicit calendar interfaces.

The server-only reader uses Responses structured outputs without tools, sends
source text as untrusted data, caps the document at 48,000 characters and output
at 24 events / 5,000 tokens, and caches successful extraction by model, URL,
language and document hash. Scout cycles read at most two documents by default
(hard ceiling four). `OPENAI_API_KEY` is private server configuration. Missing
credentials, refusal, incomplete output and API failure are unavailable/failed,
never a fabricated empty success. `PARRANDA_EVENT_READER=disabled` opts out.

The default is `gpt-6-luna`, the cheapest current flagship tier in the
[official pricing table](https://developers.openai.com/api/docs/pricing), checked
2026-10-05 ($0.10 input / $0.50 output per million standard text tokens). The
[model contract](https://developers.openai.com/api/docs/models/gpt-6-luna) supports
structured outputs. An operator may explicitly override the model; no automatic
upgrade to an expensive model is performed.

For each retained event, title/place values must occur in their quotes; date and
time must match quoted source text; all quotes must occur inside one contiguous
source excerpt. There is no inferred year, venue, coordinate or end time. Retain
the exact fetched page URL, short original-language quotes and document hash.
PDFs are limited to 2 MB / eight pages; independent OCR supplies text before the
model reads events. Uncertain OCR fails. OCR language data use the existing
persistent cache or an operator-supplied server-owned language path. This is
evidence of document reading, not an ownership or trust upgrade.

`public_factual_evidence` permits these verified event atoms without inventing
an open licence. It applies only to the quote-verifying reader. It is not a
permission bypass for arbitrary adapters; explicit restricted / permission-
required terms and robots exclusions remain blockers. Structured public event
atoms can also publish automatically with unknown rights after the actual robots
allowance, exact binding and repeated event probes are verified. Such feeds keep
rights unknown, clear speculative provider licence defaults and require actual
venue geometry rather than source-scope fallback. This removes the universal
manual licence-proof prerequisite; it does not grant rights to prose or media. Display keeps the
actual URL and destination classification, with no URL recovery.

## Generic national and recurring layers

These layers are approved product architecture, not region hacks. Select and
filter by resolver-attested geography / administrative identifiers and source
contracts; never by named-city rules or user-supplied provider URLs.

| Layer | Actual source contract and required honesty |
| --- | --- |
| DATAtourisme | France-wide tourism/event data under [Licence Ouverte](https://www.datatourisme.fr/ressources-juridiques/), with source credit. The [API](https://api.datatourisme.fr/v1/docs?lang=en) requires a key and supports geographic filtering, an event endpoint and bounded pagination. Event periods are explicit `takesPlaceAt` facts; contact homepages are not necessarily event pages. National availability does not prove an event in every commune. |
| festivos.io | [Municipal calendars](https://festivos.io/api) use five-digit INE identifiers, with free JSON/ICS and [CC BY 4.0 credit](https://festivos.io/legal/licencia). The source lists 8,132 municipalities but explicitly says published local coverage is variable. A local holiday is a calendar fact; it does not establish the programme, time or venue of a public celebration. |
| OpenHolidays | [Public and school holiday API](https://www.openholidaysapi.org/en/) for its supported countries/subdivisions, not all EU places or local festivals. [Data licence](https://github.com/openpotato/openholidaysapi.data) is ODbL; the service code's licence is separate. Apply subdivision/group scope honestly. |
| OSM weekly markets | [Mapped marketplaces and schedules](https://wiki.openstreetmap.org/wiki/Tag:amenity=marketplace) can supply source-backed recurring occurrences. Require explicit supported weekday/time facts and real venue geometry; no invented schedule or assumption that a mapped permanent hall is a weekly market. Preserve OSM attribution and recurrence uncertainty. |

DATAtourisme is now integrated into the ordinary background-warmed Live source
plan when the server resolver attests `country_code: fr`. The layer does not need
per-commune approval or a Source Catalog entry. Its private
`PARRANDA_DATATOURISME_KEY` is sent only as `X-API-Key` to the fixed HTTPS API.
Missing credentials are an unavailable source, not healthy empty coverage.
National source selection does not suppress demand for genuinely local sources.

The adapter requests source-owned identity, date periods, geometry, publisher
and update fields, filtering overlapping date periods and sorting by end date
under the documented API filter/sort contract. One acquisition reads at most two pages of 80 POIs, 24 periods
per POI, 160 resulting event atoms, two MB total and 30 seconds. Pagination URLs from the response are never
followed. A truncated/partly invalid collection retains valid facts with explicit
failure health; it never claims to have read the whole calendar. Successful
coordinate/date-window-bounded snapshots share the existing source cache across Live period
views. Date/scope/ranking gates remain the shared ones.

Venue clocks are derived offline at actual source geometry with pinned
`geo-tz@8.1.9` and its full timezone boundary dataset, rather than assigning a
single timezone to France. Ambiguous/ocean lookup results and ambiguous DST
clock times fail. The [library contract](https://github.com/evansiroky/node-geo-tz)
describes the underlying OSM-derived boundary data and its accuracy limits.
The package adds approximately 74 MB of unpacked server dependencies, including
its three distributed datasets; it is not included in the browser build.

Each displayed row keeps its exact resource URI and publisher/update credit
under Licence Ouverte. This resource URL is not represented as an event page.
Single-date clocked sessions use real instants; date-only facts stay all-day.
Ranges/complex recurrence stay period context without invented session days.
The initial national layer remains Pulse-only and does not become a route stop.
The source API's availability and breadth are not verified runtime coverage:
no DATAtourisme event request has been made in this workstream.

## Public-holiday calendar facts

festivos.io and OpenHolidays now complement the same background Live source
plan, selected by resolver-attested country/admin context. Spain uses festivos.io;
other countries use the OpenHolidays supported-country metadata, with unsupported
countries reported unavailable. The two providers do not duplicate Spanish
national holidays. Selection means a source can be attempted, not that its
calendar has responded or that local programmes are covered.

The festivos reference index must join one exact municipality name (or an
explicit source alias) plus the trusted province/region to one INE5. Name-only,
ambiguous or conflicting administrative matches are unavailable. Each municipal
calendar must match that reference identity and requested year. National,
regional and local date facts retain their original Spanish names, official
reference and supplied attribution, with CC BY 4.0 credit. Missing official
URLs remain missing; existing bulletin/PDF/JSON/home links stay exact and are
not advertised as event pages. Published years and variable local data are not
generalized into complete municipal coverage.

OpenHolidays verifies supported countries and its own subdivision reference
codes; codes are not assumed to be ISO identifiers. An explicitly nationwide
public holiday needs national scope and no contradictory subdivision/group
restriction. Other holidays require exact, unique source-name/admin joins,
with a matched regional ancestor for local-name joins. A proved subdivision
also proves its source-listed ancestors. Other-area facts are excluded; an
unresolved relevant scope or subgroup restriction produces partial/failure
health rather than an empty success. Source names/languages and ODbL credit
remain intact. School holidays are outside this adapter.

The existing private source cache stores validated reference metadata for 24
hours; successful date/admin-bound source snapshots are shared for 20 minutes
between Live periods. One collection uses fixed HTTPS endpoints with manual
redirect rejection, at most three requests (two static years at year boundaries
for festivos), four MB total, 160 result rows and a 30-second deadline. Municipal
calendars are capped at 64 entries per year; country/subdivision metadata also
have structural/count/depth caps. Failed metadata/snapshots are not persisted
as healthy empty calendars.
Subdivision references are indexed once per collection and capped at 5,000 per
holiday (groups at 200, flags at four); record processing yields to the deadline.
The existing local discovery-health field survives calendar pending, cached and
failed answers, so broad-source collection never erases an independent pending,
observing or unavailable local-scout outcome.

Calendar facts are date/admin context: normalization removes venue coordinates,
they spend no venue lookup budget, cannot fuse with venue programmes or differently
scoped holidays, and are always route-ineligible. They receive neutral, lower
cultural ranking. The shared EN/SV card/sheet labels the administrative scope
and unverified programme; half days have no invented clock, and recommended /
provisional flags remain visible. Escaped, deduplicated credits survive even
without a source URL. Mapless calendar facts are limited to ordinary
around-place display, including initial Live context; they do not enter
near-me, in-place, route corridors or a distance-based settlement fallback.
This does not suppress local-source scouting or change the source budget.

All provider and UI verification here uses network-disabled fixtures. No
calendar endpoint was fetched; these tests do not establish provider availability,
link reachability, legal closure rules or deployed/full-path acceptance.

## Delivery state and remaining landing condition

OSM marketplace schedules now reuse the deployment's existing cached map loader
in that same background Live acquisition. No additional Overpass client, place
supplier or discovery layer is created. The map layer does not satisfy the local
calendar/source-mix requirement and cannot suppress local source scouting.
It is the existing loader's bounded place sample/aperture (normally 1.5 km,
with its ordinary expansion ceiling of 5 km), not exhaustive coverage of a
larger Live area. The shared priority/publisher-diversity budget remains in
charge; this optional layer uses priority 200 after ordinary calendars' default
100. Three independent ordinary calendars can fill the budget before OSM.

Only named, active `amenity=marketplace` objects with their exact OSM identity,
real coordinates and explicit supported weekday/clock rules can contribute.
Tagged indoor/market halls, all-week or bare daily hours, seasonal/holiday
exceptions, overlapping selectors and overnight/24:00 syntax are not projected.
Supported sessions are projected into a bounded ten-day calendar envelope,
then checked by the ordinary venue-timezone, selected-date and geography gates.
These rows remain low-trust Pulse context: the shared card/sheet source component
labels them in EN/SV as recurring schedules with an unconfirmed occurrence,
preserves the exact OSM object link and contributor/ODbL credit, and cannot
automatically turn them into route stops. Projection does not prove that a
particular market will actually happen or has not been cancelled.

Acquisition inspects at most 500 place rows and retains at most 160 schedule
rows, with a 30-second reader deadline. Duplicate objects are deduplicated;
missing loaders, failed/stale map answers, timeout and truncation do not claim a
healthy empty calendar. Successful snapshots share the existing source cache
between Live period controls. No actual OSM/provider acquisition has been run
in this workstream; all new tests use offline fixture data.

Implemented in this worktree: default automatic machine-qualified event supply,
the quoted document reader/provider and scout/qualification/Live integration,
bounded PDF/OCR input, DATAtourisme country-layer acquisition and Live integration,
OSM recurring-market schedules, public-holiday calendar facts from festivos.io /
OpenHolidays, and shared uncertainty presentation,
server credential wiring, and corrected current policy
documents. Network-disabled tests cover original-language evidence, invented
atom rejection, failures/cache, PDF input and association-news → qualification
→ visible Live with credits/evidence and no route promotion.

Remaining work for the full goal: finish adversarial /
operational review of document inputs, obtain exact-head CI, and record actual
deployment wiring / runtime observation limits. The goal is **not complete**.
No model/provider live fetch, migration, merge or deployment has been performed
as part of these tests. Synthetic fixture tests are not runtime acceptance.

Landing: reviewed complete delta, green exact-head CI, and explicitly scoped
acceptance evidence. Codex owns the remaining implementation and integration;
runtime operation/credentials and any additional runtime QA require a concrete
separate handoff. #550 calendar acceptance and the separately owned #556/#555 UI evidence remain
separate. GitHub reports those PRs merged; this workstream performed no merge
or deployment.
