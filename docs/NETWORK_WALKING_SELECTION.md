# Bounded pedestrian-network route selection

Status: implemented, operator opt-in; real-provider/Pi/browser acceptance pending.
Default Planner and source activation are unchanged. No deployment or public
routing service activation is part of this PR.

## User outcome and demonstrated loss point

The any-place engine previously proposed and finalized every stop chain with
straight-line distances multiplied by 1.22. The legacy OSRM seam was not used
by this engine branch. A same-role choice could therefore look like a good walk
while a river, rail corridor or missing crossing made it a large detour.

The new final gate measures the actual public chain and may select a different,
equally trusted same-role option. The regression holds sources, anchor, date,
preferences and budget constant: the old engine selects a distant restaurant
for an estimated 6 km; a pedestrian cost of 12 km for that chain leads to the
comparable nearby restaurant and a 4.5 km chain instead. This is **synthetic
causal evidence**, not proof about a real city or provider graph.

This is not distance padding: admission, exact/partial intent, local-feel,
availability, confidence and contextual tiers cannot be weakened. An already
in-band network result stops the search immediately. A shorter, honestly
labeled day remains useful when no better comparable choice exists.

## Ownership and selection

1. Existing identity/trust/intent gates, role selection, engine ordering,
   capacity/frontier repair, time anchoring and commitment settlement produce
   bounded proposals as before. No additional place acquisition occurs.
2. Measure the finalized public chain first. Typed-place search centres are
   excluded by the existing public projection; explicit coordinate starts/ends
   remain the exact requested coordinates.
3. If it is out of band or has no usable pedestrian path, reuse comparable
   engine proposals, then at most three existing same-role reservoir variants.
   Each alternative exchanges exactly one identity and preserves every other
   selected place and quality tier. Anchored-to-now days cannot regain past
   dayparts from discarded proposals.
4. At most four distinct chains are measured sequentially. Prefer the first
   in-band chain; otherwise require a target-error improvement of at least
   0.3 km. This is not a routing matrix, TSP or global optimum.
5. Distance, leg minutes, map shape, constraint negotiation and event-leg
   metadata all describe the selected network result. Old geometry scores are
   removed or recomputed using the engine's existing leg metrics. Raw provider
   JSON, instructions and arbitrary attribution never render.

Soft targets retain the shared 60–118% fit band, not an exact promised distance.
Independent hard limits are 25 km total and 6 km per leg. An out-of-band but
bounded day remains an explicit tradeoff. Pins do not get silently exchanged:
their measured chain must fit the target ceiling or be no longer than an
already-over-budget, independently network-measured pinless baseline. This
reuses the existing commitment rule instead of blaming a pin for a pre-existing
detour. Unknown/unhonoured pins cannot impose a new cap; `no_limit` skips target
comparison. The pinless reference consumes the same four-call session budget.
If comparison cannot establish affordability, the new day is withheld.
Network-driven pin shedding is not implemented.
Woven event days are measured but do not reopen selection; their existing
2.5 km event-hop cap still applies. Failing it withholds the day instead of
publishing the earlier estimate. Optional-event removal/recomposition remains
a separate refinement, not a claimed capability here.

## Provider contract and safety

`PARRANDA_NETWORK_WALKING=enabled` opts in only the any-place engine route-output
path. `PARRANDA_VALHALLA_ROUTE_URL` must be an explicit operator-owned/authorized
Valhalla `/route` endpoint. HTTPS is required except loopback HTTP for local
operator/test setups. No embedded credentials, query, fragment, redirects or
final endpoint drift. No public demo is assumed. Invalid enabled configuration
fails closed, not back to heuristic success. Public JSON cannot choose a
provider, costs or geometry.

Valhalla receives explicit `costing: pedestrian`, ordered coordinates and fixed
options, no names, preferences or tokens. Native JSON uses polyline6 per leg.
The adapter checks units, leg count, finite coordinates/distances/times, summed
totals, bounded snaps, connected shapes and polyline-length/cost agreement
(tolerance max 50 m / 10% for simplification). Invalid geometry never becomes
straight-line fallback. `use_ferry:0` is a preference, not a hard exclusion:
both trip and leg `has_ferry:false` are required.

Requests use `directions_type:maneuvers`, require non-empty pedestrian-only
maneuvers and reject any ferry maneuver before discarding that raw data.
This avoids the older `directions_type:none` false-ferry-summary issue fixed in
[Valhalla 3.8.2](https://github.com/valhalla/valhalla/releases/tag/3.8.2).

Map matching must remain within 100 m of each input; adjacent leg endpoints
over 5 m apart are rejected. Input markers are never relocated. The remaining
entrance/snap gap is not proved walkable and is disclosed in the UI. Mapped
paths do not establish current access, opening hours, barrier completeness,
wheelchair suitability or live ETA.

Provider semantics, not runtime evidence:
[Valhalla route API](https://valhalla.github.io/valhalla/api/route/api-reference/),
[OSRM profile contract](https://project-osrm.org/docs/v5.22.0/api/).
An OSRM URL containing `foot` alone does not prove a pedestrian graph: its mode
comes from the prepared profile. The old OSRM adapter is not changed or enabled.

## Exact runtime budgets

| Boundary | Hard ceiling |
| --- | --- |
| Input coordinate points per request | 10 |
| Distinct measured chains / live requests per composition | 4 / 4 |
| Concurrent live jobs per provider/web process | 2, no waiting queue |
| HTTP request including streamed body | 5 seconds |
| Session from first routing request | 12 seconds inside the existing 60-second Planner lifecycle |
| Response bytes | 512 KiB/request, at most 2 MiB across four requests |
| Decoded shape points per chain | 4,096 |
| Successful geometry cache | 64 entries AND 4 MiB, 15-minute TTL |

Cache is process-local, exact-coordinate/order keyed and isolated by provider
instance. It contains normalized geometry, not names/raw JSON. No disk writes,
restart persistence, stale reads or failure caching. Warm identical chains
make no routing acquisition. Dates/preferences/language may reuse an identical
chain because this contract is static geometry, not date-aware access routing.

Identical in-flight chains share one producer. Cancelling one owner preserves
others; cancellation of the last aborts fetch and body reading. Abandoned late
results cannot write cache or release a newer same-key producer. The actual
Planner lifecycle signal is forwarded; no new token diagnostics are introduced.

If all measured proposals fail, no new day is published and the experiment
reports `network_walking_unavailable`. Existing UI retention keeps an earlier
day. A measured success can still be returned if a later comparison fails.
Provider failure is not proof of poor places or source supply.

### Failure-aware selection and recovery

A transient failure while measuring the initial chain is not evidence that a
different stop is preferable. Transport/server failures, routing capacity and
invalid operator configuration are distinguished from a rejected route or
geometry. If the initial measurement fails for those operational reasons, the
new day is withheld without trying a different identity. This is not permission
to publish an unmeasured heuristic baseline as a network result. A previously
published day may remain visible while the UI explains that the requested
revision could not be verified. A successful measured candidate still survives
a later failed comparison; cancellation of the actual owning lifecycle still
aborts work rather than becoming an alternative-selection signal.

The public failure retains `network_walking_unavailable`, with only bounded,
non-sensitive cause tokens where known: `network_walking_provider_unavailable`,
`network_walking_busy`, or `network_walking_invalid_configuration`. Generic
failure means the walk could not be verified; it must not always be described
as an offline provider, since invalid geometry and safety limits also reject a
route. Temporary provider/capacity failures offer an explicit single-flight
retry through the normal Planner lifecycle, not an automatic retry storm.

The two-live-job limit is unchanged and applies to distinct cold routing jobs,
not to the third user: cache hits and shared active chains do not consume an
additional slot. No queue is introduced. Startup/configuration diagnostics must
be sanitized; no endpoint credentials or provider response text are public.
`/api/health` exposes `network_walking_config` (`disabled`, `ready`, or
`misconfigured`) and `network_walking_config_scope: "configuration_only"`.
Here `ready` means URL configuration passed validation, **not** that the graph
is reachable, covers the selected place, or proves current pedestrian access.
Liveness does not probe the external provider. The self-hosted validator rejects
an enabled but missing/invalid endpoint using the same runtime URL policy.

Raw network measurements retain their precision for costing and validation.
Minute labels are formatted for people, consistently across cards and details.
Rounded leg labels need not sum exactly to the rounded approximate total; UI
rounding must not change walking-target classification or safety checks.

### Deliberately unchanged product policies

The soft target remains symmetric: a comparable longer day can improve an
under-target proposal, but an already in-band result does not chase distance.
No asymmetric target policy is introduced by the QA fixes. Already woven events
keep their existing measured caps; retrying a previously rejected event weave
on an alternative is not part of this change. Neither policy is silently
expanded to satisfy a fixture or a named destination.

## Operational limits and next proof

This PR does not install a world graph on the Pi or provision a paid router.
Before enabling, establish endpoint permission, pedestrian graph/build coverage
and source/provider attribution obligations. Open-source server code does not
grant blanket commercial permission to a hosted endpoint. The UI uses a fixed
OSM attribution link and an estimate/access disclaimer.

Unit/HTTP/jsdom results are not provider, barrier or browser acceptance. Follow
`NETWORK_WALKING_SOL_QA.md` after head freeze. Remaining generic work includes
pedestrian-cost-aware ordering beyond these proposals, pin/event recovery,
entrance/access resolution and independent source quality. Neither a longer
route nor a named winning stop is acceptance.
