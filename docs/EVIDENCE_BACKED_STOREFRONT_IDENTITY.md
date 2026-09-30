# Evidence-backed storefront identity: bounded first slice

## Scope

Built on PR #536 head `98fb0718107f4823160d73474d718c72a369280e`.
This change preserves current, source-owned OSM alternate/official names through
candidate mapping and uses them for conservative storefront identity matching.
It does not change experimental admission limits, trust gates, rhythm budgets,
search reach, provider approval, route ranking, or public payload injection rules.

An alias merge requires all of:

- a source-owned current alias exactly matching the other normalized name;
- compatible known categories;
- coordinates within the existing tight identity radius;
- matching safe website identities;
- independently supplied matching street and house number;
- no conflicting explicit entities, ambiguous alias match or conflicting schedules.

A chain website or nearby coordinates alone never establish identity. Historical
`old_name` is not used. Aliases are bounded metadata, not new existence evidence.
Merged records retain their actual evidence ledger; existing gates still decide
whether corroboration is sufficient. Missing hours are reconciled; explicit
inactivity and a source-wide `off`/`closed` schedule remain routing vetoes.

## Executed verification

- Tests were written and observed failing before each new behavior was implemented.
- HTTP/API regression using explicitly labeled deterministic source fixtures:
  the exact PR #536 base produces **two** focused second-hand stops; the changed
  implementation produces **four**, with the same fixture, interests and Full
  rhythm. The explicit geographic anchor is preserved. This is fixture proof,
  not proof of four live Malmö stores.
- Final affected-path regression batch: **161 passed, 0 failed, 0 cancelled,
  0 skipped**. The corresponding pre-existing tests on the exact base also pass
  (**149 passed, 0 failed**). Includes source loading, external evidence, entity identity,
  field reconciliation, operational viability, hours, planner reservoir and the
  new full HTTP route-depth test.
- Reverse alias ambiguity and closure reconciliation have dedicated regression
  tests, including candidate permutations.
- Local full `npm test` was started but interrupted; it is **not** a full-suite
  pass. Full CI and exact composed-runtime product acceptance remain separate.
- Dependency audit on the unchanged lockfile reports a pre-existing moderate
  transitive `qs` advisory. No opportunistic dependency changes were made here.

## Real cached supply: important limitation

A replay of 115 previously captured Malmö source records through the real API
still selects **Grahns antik and A Piece Lux** in Calm, Balanced, Full and Free,
both before and after this change. The old records do not carry the additional
identity facts needed by the new matching path. This sampled replay differs from
the earlier live staging pool (Pop Boutique and Grahns antik); do not conflate
those source snapshots or claim the public two-stop symptom is solved.

This is a working, tested identity-depth foundation, not complete live-Malmö
acceptance. Fresh source-owned identity facts or approved source corroboration
are still needed where actual aliases are missing. Never fabricate aliases,
loosen gates or force Busfrö/Björkå name variants together to make that test green.

Shuffle remains a future product TODO in `PRODUCT_TODO.md`; no shuffle UI or
endpoint is implemented. No merge to main or public deployment is part of this
slice.
