# Bounded same-role walking-fit selection

## Product contract

Trusted supply can be present yet lost before the engine sees a useful choice.
For a short any-place engine day, compare a few same-role substitutions through
the existing engine. Choose a more useful walk only without losing admission,
specific preference coverage or contextual quality. This is not a second composer,
a larger acquisition radius, extra provisional stop depth, or a claim that every
walking target is feasible. NAPI stays default-off and is not needed for this fix.

The existing provisional admission remains provisional. A single official-family
record still cannot self-promote. No source thresholds, licensing, approvals,
identity resolution, public Add eligibility or default experiment flags change.

## Demonstrated loss and causality

On base `aeef95258160ab4a76bc79e1ae8c6b7ec58d9e54`:

1. Identity resolution preserves distinct source-backed places.
2. Intent, trust, availability and anchor-reach gates remove unsafe alternatives.
3. Role surfaces retain a small ranked prefix. Comparable but more distant
   alternatives can be lost here.
4. Combination chooses within its admission/coverage/context tiers, favoring
   compactness. It does not evaluate the resulting full walking day.
5. The engine reservoir permits a selected provisional role winner but not more
   provisional depth for that role. It can therefore contain only two or three
   candidates despite many individually usable alternatives.
6. The existing capacity frontier excludes provisional depth. Without additional
   IDs, capacity repair cannot try anything. Ordering the tiny reservoir cannot
   recover a place that never reached it.

The deterministic RED case in `tests/walking-fit-selection.test.js` supplies
17 distinct directory-backed food/culture records, including a relevant reachable
restaurant outside the tight cluster. The base returns 0.6 km / two stops for a
6 km request. GREEN returns 6.1 km / two stops by replacing the restaurant, not
adding filler. Exact food/culture coverage remains; confidence stays honest.
The same generic mechanism works after translating the fixture geographically.

Archived normalized Overture inputs from Sol's prior exact-head experiment were
also reconstructed offline, with NAPI off, no network, null weather and a fixed
future-date input. They are **not** the original same-day GPS browser request:
the 89/83/17 screenshot does not preserve its entire response or intermediate
decisions. It cannot prove an omitted feasible route by itself.

| Offline reconstruction | Raw / identities | Role surface → engine | Before → after | Interpretation |
| --- | --- | --- | --- | --- |
| Göteborg, food/culture/views, 6 km | 80 / 80 | 14 → 3 | 1.4 → 2.4 km, three stops | Partial scenic remains partial; still short |
| Göteborg, food/evening, 9 km | 80 / 80 | 15 → 2 | 0.5 → 0.9 km, two stops | Same exact intents; still short |
| Mariefred, food/views, 6 km | 24 / 24 | 12 → 2 | 4.5 → 4.5 km, two stops | Already in band; unchanged |

These demonstrate the selection loss independently of NAPI, not that the chosen
places are hidden gems, that directory categories are always correct, or that
provider coverage now satisfies the targets. Archived records are evidence,
not a license to acquire or activate a source.

## Search and runtime budgets

- Retain at most **two private alternatives per requested role** (currently
  nine roles, at most 18 records), after existing eligibility and reach checks.
  Public role suggestions and commitment supply do not receive this list.
- Proposal ordering is deterministic: absolute difference between twice the
  anchor radius and target, then stable identity. Radius is only a cheap search
  heuristic, never evidence of walkability or final acceptance.
- Try at most **three** alternative reservoirs sequentially. Each replaces
  **one** selected identity, keeps the other IDs and reservoir size, and rechecks
  comparability against the actual original winner.
- Only original reservoirs of **two through six** records qualify. This bounds
  the multiplied engine ordering work; larger reservoirs keep existing behavior.
  Trials use the existing engine, stop-order bounds and walking estimator, not
  another optimizer. There is no new hard wall-clock deadline or Pi latency SLA.
- **Zero additional acquisition, weather, event or routing-provider requests**:
  normalized sources/context are reused; this engine's any-place config uses
  no-op services and heuristic walking. Do not call it street-network validation.
- At most three extra engine calls per composition, on top of existing base,
  time-anchor fallback and capacity repair. Stop at the first acceptable in-band
  trial, not a global optimum. Requests carrying pins skip the search entirely,
  including pin-settling iterations; event days also skip it.
- In-band routes, `no_limit`, unrequested roles and non-engine composition keep
  their existing selection lifecycle. Same-day trials retain time anchoring;
  inability to retain it cannot be exchanged for distance.

## Acceptance invariants

Each replacement must remain individually planner-usable, available, at least
as strong in status/confidence, in the same experimental-admission class, and
no worse in local-feel or operational tier. Curated choices cannot become external.
Exact preferences remain exact; partial preferences cannot become missing.
Weather, time and experience-lens reason sets must match. These constraints
deliberately reject real tradeoffs rather than silently deciding them by distance.

Final engine output must have finite distance, remain under the shared 118%
ceiling, improve the short route by at least 0.3 km and get closer to the target.
It must actually publish the proposed replacement and retain every other stop
from the pre-search day; re-ordering cannot silently sacrifice a second place.
It may not reduce stop count, lose any individual requested intent tier or add
a quality-warning token. Existing 60–118% band and honest short-route reporting
remain. Exclusions are applied before alternatives are retained; pins are not
re-searched. Existing promotion and refusal-snapshot ownership remain in force.

Tests cover negative trust/official-only/closed/out-of-reach/wrong-intent tails,
context-tier comparisons, corroboration, determinism, provider-call counts,
public route publication and exclusion, and non-leakage of the private list.
Existing suites cover geometry, commitments, promotion and time/date behavior.
Synthetic long-detour comparator tests prove refusal logic, not real islands,
barriers or live walking-router recovery.

Exact-head field QA also exposed a source-category safety boundary: Overture's
canonical `playground` category for an indoor play venue carried `park` only as
an alternate facet. The old adapter allowed that secondary facet to relabel the
record as exact `green`, and the new distance search made the latent error visible
as a selected stop. Overture route mapping now accepts only its canonical primary
category; unsupported primary meanings fail closed instead of borrowing a route
role from alternates. The persistent cache namespace moves from v2 to v3 because
normalized cached rows do not retain enough raw taxonomy to be reclassified.
This is category-contract hardening, not a place/name/city exception.

## Evidence and remaining work

Local implementation evidence is under
`/Users/fritjof/Documents/parranda-qa-evidence/walking-fit-selection-20260909/`:
`before.json`, `after.json`, `replay.cjs` and gate logs. Archived source inputs
come from `20260909T104603Z-pr496-final-qa/caches/fee5/` on the QA archive.

Authorized Pi/browser QA is preserved under
`/Users/fritjof/Documents/parranda-qa-evidence/20260909T162433Z-pr498-walking-fit-final-qa/`.
Both web and worker ran the same immutable image and health reported the tested
SHA. The first executable head improved Strängnäs 0.2→1.5 km and Göteborg-west
0.8→1.7 km while leaving an already-in-band Växjö coordinate case at 2.6 km.
Desktop and mobile Planner views rendered the route, map, expanded source facts
and Keep/Add controls without console errors. Provider cold-start failures remain
**INCONCLUSIVE / NOT OBSERVED**, not product failures; direct/offline traces remain
**INVALID ACCEPTANCE** for live-provider claims.

The same run found the alternate-category defect above. After fail-closed
hardening, a live cold-to-warm Overture v3 cycle omitted the unsupported indoor
playground and retained the canonical `garden` record. On identical normalized
safe input, main produced 1.7 km with Galleri Avanti + Kolding Lejepark; bounded
selection produced 4.8 km with Galleri Avanti + Geografisk Have. A separate
browser-origin typed Kolding run rendered a conservative 2.8 km culture/green
day on desktop and mobile. This verifies a useful selection effect without
claiming that every target is met or every source category is complete.

Remaining limits: single swaps cannot solve multi-role tradeoffs; a radial
proposal can miss a better geometry; heuristic routing cannot prove barriers;
source categories, independent corroboration and trustworthy place quality still
matter. A larger pool is not trusted capacity. Pins/events/large reservoirs need
separately bounded work if runtime evidence identifies them as the next loss.
Swedish coordinate language and optional-idea wording/pagination remain separate
product tasks. Do not expand this search merely to make the page look fuller.
