# Machine-verified Live supply

Owner: Codex. Target: `codex/machine-verified-live-supply`, based on GitHub main
`3b8653b23258b839b21824c6c59dcf8ba0471c9f`. Work began from main
`23160134cd73af166d67057a14c72c4bf8585946` and was rebased after #555
landed with #556 included. That landing occurred outside this workstream; its
visual/runtime acceptance is not inferred here.

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

## Delivery state and remaining landing condition

Implemented in this worktree: default automatic machine-qualified event supply,
the quoted document reader/provider and scout/qualification/Live integration,
bounded PDF/OCR input, server credential wiring, and corrected current policy
documents. Network-disabled tests cover original-language evidence, invented
atom rejection, failures/cache, PDF input and association-news → qualification
→ visible Live with credits/evidence and no route promotion.

Remaining work for the full goal: implement and verify national/recurring
provider integration through the ordinary supply chain, finish adversarial /
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
