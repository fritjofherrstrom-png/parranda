# Bounded pedestrian-network route selection

Status: draft #501, operator opt-in; live-provider/Pi acceptance **BLOCKED**.
No operator-approved endpoint or local pedestrian graph is confirmed (2026-10-02).
Default Planner and source activation are unchanged. No deployment or public
routing service activation is part of this PR.

## User outcome and demonstrated loss point

The any-place engine previously proposed and finalized every stop chain with
straight-line distances multiplied by 1.22. The legacy OSRM seam was not used
by this engine branch. A same-role choice could therefore look like a good walk
while a river, rail corridor or missing crossing made it a large detour.

The opt-in final gate measures the actual public chain and may select a different,
equally trusted same-role option. Modern `calm`, `balanced`, `full` and `free`
rhythms have **no kilometre goal**. Selection preserves the engine's rhythm,
stop count, preferences, source quality and availability; it compares measured
walking effort only among comparable proposals. It never adds stops to fill
kilometres or sacrifices a requested experience for a shorter walk.

Deterministic regressions cover all four rhythms with identical sources, anchor,
date and intent: a synthetic 12 km pedestrian detour makes a comparable
one-stop substitution win at 4.5 km, with every other selected identity retained.
This is synthetic causal evidence, not real graph, city or Pi acceptance.

## Ownership and selection

1. Existing identity/trust/intent gates, engine ordering, capacity/frontier repair,
   time anchoring and commitment settlement establish the day. No additional
   place acquisition occurs.
2. Measure the finalized public chain first. Typed search centres are excluded
   by public projection; explicit coordinate starts/ends remain unchanged.
3. Reuse comparable engine proposals, then at most three same-role reservoir
   variants. A variant exchanges exactly one selected identity and preserves
   every other stop, count and quality tier. Retimed source-available experiences
   use their actual emitted daypart; anchored days cannot regain past dayparts.
4. Measure at most four distinct chains sequentially. For modern rhythms,
   prefer a measured reduction of at least 0.3 km; there is no fit band or
   distance padding. Cheap coordinate proximity orders bounded proposals only;
   it does not establish pedestrian cost. This is not a global optimum.
5. Distance, leg minutes, shape and event-leg metadata describe the selected
   network result. Recompute geometry metrics; never render raw provider JSON,
   instructions or arbitrary attribution.

Independent safety limits remain 25 km total and 6 km per leg. Pinned and woven
event days are measured without reopening identity selection. Modern pins do
not introduce a kilometre ceiling or a pinless reference query. Woven event
hops retain their 2.5 km cap; a rejected chain is withheld. Network-driven pin
shedding or event removal is not implemented.

Only the legacy API without a modern rhythm retains the existing soft distance
contract: the shared 60–118% band, first in-band result, otherwise a 0.3 km
improvement in target error. Legacy `no_limit` skips target comparison. An
honoured legacy pin must fit that ceiling or not exceed a separately measured
already-over-budget pinless baseline, using the same four-call session budget.
This compatibility path does not restore kilometre goals to the modern UI.

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
Retaining a previous day also retains its drawn-map readiness; an unsuccessful
revision must not leave a permanent map-loading message over the unchanged map.

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
rounding must not change network selection, legacy target classification or safety checks.

## Operational limits and next proof

This PR does not install a world graph on the Pi or provision a paid router.
Before enabling, establish endpoint permission, pedestrian graph/build coverage
and source/provider attribution obligations. Open-source server code does not
grant blanket commercial permission to a hosted endpoint. The UI uses a fixed
OSM attribution link and an estimate/access disclaimer.

Unit/HTTP/jsdom results are not provider, barrier or browser acceptance. Runtime acceptance stays BLOCKED until endpoint, owner/permission, allowed
test load and graph coverage/version are confirmed. The conditional, bounded
handoff is in `NETWORK_WALKING_SOL_QA.md`; it authorizes no deployment or test. Remaining generic work includes
pedestrian-cost-aware ordering beyond these proposals, pin/event recovery,
entrance/access resolution and independent source quality. Neither a longer
route nor a named winning stop is acceptance.
