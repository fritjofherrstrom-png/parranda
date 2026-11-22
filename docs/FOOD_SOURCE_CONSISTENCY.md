# Withhold contradictory food listings

2026-10-28. Owner: Codex. Branch: `codex/food-evidence-correctness-20261028`.
Base main/runtime inspected: `260280137d6e7caaf86edb855f4fecbdfd1b4e9d`.
Reviewable source fix; no merge/deploy, model activation or paid API calls.

## Observed failure and diagnosis

Hermes's real public Honolulu journey displayed `Elvis Presley Statue` as a
restaurant/food anchor and as full Food coverage. The exact candidate ID is
`overture-17df6255-580f-4267-9521-c597efcce03e`.

The retained Pi `overture-v6` sample already contains that ID/name with
`type: restaurant`, `tags: [mat]` and the website value
`http://www.elvis.com.au/presley/news/aloha_statue_hawaii.shtml`. The category
mistake therefore predates candidate identity merging, fit, role selection and
UI presentation. The shared fit scorer then follows the restaurant type into
`covers:food(type:restaurant)` as designed; changing that vocabulary would
break valid restaurant coverage.

The factual fixture preserves the normalized record and its original source
receipt, including the 2026-10-21.0 release, asset generation and hashes. It is
**not a raw Parquet row**. Bounded attempts to reread the exact raw source row
timed out; its precise upstream primary category and field history remain
unknown. The source asset's HEAD did match the retained ETag/length. Do not
assign this finding to a specific upstream taxonomy bug or earlier PR without
the missing raw evidence. Website content was not successfully fetched either;
the guard uses only the retained source-owned URL value, not a claim of operator
ownership or a newly verified page assertion.

## Bounded change

Withhold an otherwise admissible Overture restaurant/cafe/bar row only when:

1. Its name explicitly describes a named physical feature (a statue,
   sculpture, memorial or monument, within a small closed vocabulary).
2. The website pathname is article-shaped (`news`, `article`, `stories`,
   `wiki`) and repeats that feature designator.
3. The name has no explicit eatery/business designation. Bare ambiguous brands
   such as `The Monument` do not satisfy the named-feature test.

This is a conservative negative consistency check between two source fields.
It does not assert that the feature is verified, rewrite it as a monument, or
certify a replacement category. The genuine source category continues to own
positive classification. Name alone, URL alone, absent websites and unknown
opening hours do not trigger the guard. Source confidence, rights, coordinates,
operating status and ordinary admission gates are unchanged.

Apply the same guard at fresh row normalization and at output selection of
already retained samples, before intent ranking and corroboration. Cached,
HEAD-renewed, stale-fallback and reselected background output all pass through
that selection boundary. Original v6 sample/receipt bytes remain intact and
their hashes/freshness are not renewed by this check. No cache purge, broader
query, new website request or source-trust promotion is introduced.

The scope is intentionally narrow. It does not establish universal upstream
classification quality, detect every wrong statue listing, or make unknown
hours verified. An unusually named genuine business with both contradictory
fields and no recognized business designation may be conservatively withheld.
That false-negative tradeoff should remain visible when extending the rule.

## Evidence and review

- RED: the retained real record passes candidate mapping/fit as full Food;
  unmodified Overture selection publishes it. Fresh generic feature/article
  controls also incorrectly retain restaurant meaning.
- GREEN: source output withholds the contradictory row, without editing the
  retained input. Genuine restaurants and ambiguous/single-field controls keep
  their category and inferred source trust.
- Independent review traced fresh/cache/renewal/stale/reselection boundaries.
  One P2 found genuine Italian `Trattoria del Monumento` and
  `Osteria del Monumento` were missing from the clear-business exception.
  Both were reproduced RED and fixed GREEN with regression controls.
- The original complete **600-record** normalized sample was independently
  replayed through actual receipt validation, attested cache and production
  background selection. It retained 80 output records, filtered exactly the
  observed Elvis row, made **zero new acquisitions**, and left the sample and
  receipt unchanged. This is a mechanical replay, not a semantic audit of the
  other 599 rows or a new public browser acceptance.

The reduced factual fixture is
[`overture-category-conflict-20261028.json`](../tests/fixtures/overture-category-conflict-20261028.json).
The replay summary is
[`retained-cache-replay.json`](evidence/food-consistency-20261028/retained-cache-replay.json).
The full public-source sample and probe logs remain local evidence and are not
committed. No private navigation/snapshot authorities or container configuration
were copied. Disposable source-probe containers were read-only and isolated
from running web/worker processes and application mounts.

Checks: **111 PASS / 0 FAIL** across source/taxonomy/cache/renewal/preference/
identity tests. Exact-head Linux CI is required and recorded in the PR at
publication. No new UI or Keep/Undo/rhythm implementation is
included. The independent reviewer declined to certify raw upstream cause,
universal/multilingual completeness or a deployed journey; those observation
limits are accepted.

Landing condition: material review findings addressed, affected tests and
exact-head CI green, current main/head compared. Any deployment requires a
separate coordinated choice and a frozen-version public journey; source replay
does not establish that the live Honolulu result has changed.
