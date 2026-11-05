# Local research model pilot — offline preparation

2026-10-27. Owner: Codex. Prepared from GitHub main `c6d85fcd`; no paid
model/search/OCR calls or runtime activation. `PARRANDA_EVENT_READER=disabled`
remains the operational requirement. Provider, model and spending limit are
open decisions. The suggested 50–100 pages and $10–20 are **not approved**.

## Product result to test

Do the local research for the user and serve one relevant, understandable
proposal in their language, with the judgment of an informed local person.
Source discovery, factual understanding and useful presentation need separate
scores: an accurate extraction is not yet an event the user can attend.

| Stage | Bounded model contribution | Evidence / comparison |
| --- | --- | --- |
| Hitta | Suggest at most two local-language queries and promising organizer types, from trusted locality/time/interests. | Existing operator-owned SearXNG retrieves actual URLs. Compare verified independent local publishers per query, accepted sources and missed organizers against current queries, with identical search snapshots. Model-supplied URLs/ownership never establish source trust. |
| Förstå | Read difficult notices and distinguish festival context from actual programme occurrences. | Replay the same frozen document through deterministic adapters and a stored candidate response; verify exact original-language quotes, date, time and venue. Measure correct facts, misses and unsupported proposals. |
| Servera | Translate/summarize verified facts and explain their relevance to the user's place, time and interests. | Blind A/B review of the same accepted facts in the user's language: factual fidelity, coverage of constraints, useful choice, clarity, local specificity, absence of invented claims. Original quotes remain original-language evidence. |

This PR implements the **Förstå offline evaluator** and its initial calibration
corpus. It does not implement live model discovery, translated UI or any
provider adapter. The separate generic discovery fix removes the observed
regional-calendar stopping/cap bug; a model is not required for that fix.

## Runnable baseline

```sh
node --require ./tests/helpers/no-live-network.js scripts/eval-local-research.js
node --require ./tests/helpers/no-live-network.js --test tests/local-research-model-pilot.test.js
# Optional, after an explicitly authorized run elsewhere has produced a file:
node --require ./tests/helpers/no-live-network.js scripts/eval-local-research.js \
  tests/fixtures/local-research-pilot.json /absolute/path/recorded-responses.json
```

The CLI has no API client/key lookup and only serves corpus URLs through an
injected fixture fetcher. It runs today's actual scout, `feedsFromScout` and
ordinary source providers with `eventReader: null`. It evaluates reading before
venue lookup, qualification, Live date/geography gates and ranking. The
discovery integration tests cover that downstream boundary separately.

Committed result: [offline-baseline.json](evidence/local-research-20261027/offline-baseline.json).
Corpus: [local-research-pilot.json](../tests/fixtures/local-research-pilot.json).
One reduced real programme, seven authored controls, eight documents, four
languages (SV/EN/FR/ES); this is calibration, **not** eight independently
sampled real sources or a blind holdout.

| Reading result | Current deterministic engine | Candidate model |
| --- | ---: | --- |
| Correct distinct facts (title/date/time/place) | 5 | Not run |
| Incorrect distinct findings | 0 | Not run |
| Missed expected facts | 3 | Not run |
| Precision / recall in this small corpus | 100% / 62.5% | Not measured |
| Correct facts marked useful in the control's local/time context | 3 | Not measured |
| Additional API calls / spend | 0 / $0 | None authorized |

The four programme occurrences are parsed; ordinary SV/FR/ES notices are the
three misses. The schema calendar is a positive control. Cancellation, missing
year and instruction injection are negative controls. “Useful” is a transparent
manual corpus label, not a claim of verified venue geometry, travel feasibility,
preference fit or better user experience. These numbers do not estimate recall
for the public web. The schema-only page also exposes a comparison limitation:
the existing quoted reader's visible text excludes JSON-LD scripts, while the
deterministic provider reads them. Compare their union and incremental yield;
do not replace a functioning structured reader based on model-only recall.

The recorded-response format is deliberately provider-neutral:

```json
{
  "kind": "recorded_provider_response",
  "runs": [{
    "case_id": "sv-notice",
    "document_sha256": "from evaluator case output",
    "reader_document_sha256": "from evaluator case output",
    "provider": "chosen provider",
    "model": "exact requested model/version",
    "prompt_version": "quoted-reader-v1",
    "status": "ok",
    "billed_usd": 0.001,
    "events": [{
      "title": { "value": "Lokal konsert", "quote": "Lokal konsert" },
      "date": { "value": "2026-10-30", "quote": "30 oktober 2026" },
      "time": { "value": "19:30", "quote": "19.30" },
      "place": { "value": "Föreningshuset", "quote": "Föreningshuset" },
      "excerpt": "Lokal konsert 30 oktober 2026 kl. 19.30 i Föreningshuset."
    }]
  }]
}
```

The JSON above illustrates the contract; it is **handwritten, not a model
result**. Use `kind: handwritten_contract_example` when saving such examples.
Production-shaped model events pass the existing `verifyQuotedEvent`; invalid
quotes never become scored accepted facts. Semantic false positives can still
pass quotation checks and are counted against the independently labelled gold.
The last attempt per document supplies the candidate; every recorded attempt,
including failed/rejected attempts, contributes spend. Include all retries in
order. Mixed model/prompt runs must be split into separate evaluation files for
comparison. Only the evaluated subset is compared with its paired baseline;
missing outputs cannot silently become correct negatives. Duplicate facts do
not inflate yield. Hash mismatches and unknown cases fail the run.

`recorded_cost_usd` is recorded historical spend, not spend by this CLI. Prefer
invoice/provider-derived `billed_usd`; simple uncached text runs may instead
record `usage.input_tokens`, `usage.output_tokens` and
`rates_usd_per_million: {input, output}`. Include thinking/output tokens, failed
attempt charges, tool fees, cache writes/storage, OCR and retrieval in billed
cost when applicable. Missing cost is **unknown**, not zero. Cost per verified
source divides by documents with at least one quote-verified, gold-correct
fact; cost per useful event divides by distinct gold-correct facts labelled
useful. Zero denominators return `null`, not free success. This is source
reading verification, not the runtime two-day qualification of a source.

## What the existing quoted reader does and does not prove

`quoted-event-reader.js` verifies a contiguous excerpt (maximum 900 characters),
original title/place quotes, stated year and date/time consistency; model
coordinates, licences and source ownership are ignored. Its current schema has
no festival parent/programme relationship and returns at most 24 events. A
175-row programme cannot be treated as solved by this reader. Year/date/area
headings distant from a row, ambiguous numeric dates, PDFs, OCR uncertainty and
missing venue geometry remain meaningful failure cases. Its real API quality,
latency and cost have not been measured here.

The existing runtime reader cache includes model, URL, language and document
text hash, with a 24-hour TTL. It is not a permanent learning store and its key
does not include a prompt/schema version. The offline result includes both raw
document and reader-text hashes plus a reading key including prompt version.
Changed documents must be reverified; replaying the same saved result causes
zero new calls. No runtime cache migration or paid fallback is part of this PR.

## Persistent investment, rather than repeated reading

Keep raw documents in rights-appropriate private storage, and commit only
minimal factual/structural fixtures plus hashes when retention permits.

| Durable record | Key and retained evidence | Reuse / improvement |
| --- | --- | --- |
| Source bank | canonical URL, publisher identity, locality/language, discovery query, robots/terms observation and timestamp, last successful check | Revisit known independent organizers before rediscovering; ownership and policy are rechecked by ordinary acquisition. |
| Document version | raw SHA-256, normalized text SHA-256, text/OCR extraction version, URL, fetch time, ETag/Last-Modified, bounded private blob | Conditional retrieval; unchanged content can reuse the verified reading rather than purchase another interpretation. A 304 is not a new independent event verification. |
| Verified reading | URL + text hash + extraction/prompt/schema version + exact model/params + source language; accepted atoms, exact short quotes, rejects, tokens and billed cost | Shared between users; reader changes invalidate the relevant key. Retain failures as regression cases. Successful reading never certifies future event freshness. |
| Translation | accepted-fact hash + target language + prompt/model/version; translated presentation and fidelity review | Reuse per language; preserve original quotations and fact IDs, never translate evidence in place. |
| Regression / proposed rule | immutable document/case hash, gold annotations, date and annotator, baseline/candidate outputs, failure mechanism and affected publishers | Repeated patterns suggest a general parser rule. Prove it RED/GREEN on real examples and unrelated negatives, independent review and a normal PR before runtime use. No model writes/merges code automatically. |

An API call does not automatically train the model. The investment is the
source/evidence/case collection, reusable accepted readings and translations,
and deliberately reviewed improvements to our own engine. A proposed rule
should name the grammar it recognizes, not the example town or publisher.

## Dated price check and bounded cost scenarios

Official pages opened 2026-10-27; USD per million tokens, Standard uncached
short-context text. Availability in these accounts has **not** been tested.

| Candidate | Input | Output | Official source |
| --- | ---: | ---: | --- |
| `gpt-6-luna` | $0.10 | $0.50 | [OpenAI model documentation](https://developers.openai.com/api/docs/models/gpt-6-luna) |
| `gemini-3.5-flash-lite` | $0.30 | $2.50 | [Google pricing](https://ai.google.dev/gemini-api/docs/pricing#gemini-3.5-flash-lite) |

The sidechat's Luna name and base token prices are now corroborated by the
official page. A flat “$2 per 1,000 calls” is not a tariff. With an **assumed**
8,000 input / 2,000 output tokens per page, one uncached reading costs $0.0018
for Luna or $0.0074 for Gemini: 100 pages cost $0.18 or $0.74 per pass. Three
passes with each provider over 100 pages total $2.76 under those assumptions.
These are token arithmetic, not measured costs, spending authorization or a
provider choice. Longer output, failures and extra stages change the totals.

[OpenAI tool pricing](https://developers.openai.com/api/docs/pricing#built-in-tools)
lists web search at $10 / 1,000 calls **plus** search-content tokens at model
rates. The pilot should start with the existing SearXNG path and no built-in
paid search. No cache/batch discounts or free-tier allowances are assumed.
Retest rates and actual access before any budget proposal is executed.

## Proposed paid experiment — needs an explicit budget decision later

1. Expand to 50–100 independently sampled real pages across small settlements,
   neighbourhoods and larger places: official calendars, association notices,
   venue programmes, festivals, PDFs/OCR, cancellations, archives and no-event
   pages. At least four languages and several independent publishers per
   document grammar. Label capture date, rights, locality and inclusion/exclusion
   reasons. Keep train/calibration and holdout publishers separate.
2. Freeze corpus/gold before candidate outputs. Reserve at least 20 publishers'
   documents for blind holdout; do not tune on them. Gold labels include
   programme parent, actual occurrences, date/year, time precision, venue,
   cancellation and useful-for-request status with explicit missing facts.
3. Compare current deterministic engine, quote-verified candidate, and their
   deduplicated union on identical documents. Record extra correct usable
   findings and regressions per source type, not only a pooled headline.
   Evaluate truncation and long programme pages explicitly.
4. Pilot the Hitta and Servera comparisons separately, with frozen retrieval
   responses and fact-equivalent anonymous presentation pairs. A reviewer
   grades whether the user can decide what to do, knows why it fits, and sees
   source/time/location uncertainty. Extraction precision cannot stand in for
   this human usefulness score.
5. Proposed gate: no unsupported accepted date/time/venue facts in holdout;
   demonstrable incremental usable yield without losing deterministic hits;
   improved blind usefulness/fidelity; complete attempt/latency/cost records.
   Report sample size and failures even if aggregate precision is high. Choose
   the maximum acceptable cost per extra useful event with the budget owner.

Before paid work: present the exact corpus, provider/model, maximum attempts,
token/output limits, retrieval/OCR fees, hard total spend cap and stop behavior
for explicit confirmation. No authorized cap exists today. Any future runtime
experiment needs its own current-main/head/CI check, disabled-by-default switch,
source gates and public runtime acceptance. Preparing this material does not
authorize that deployment.
