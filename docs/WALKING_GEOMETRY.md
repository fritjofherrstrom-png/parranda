# Pedestrian walking geometry (V5)

Modern Planner can route its final published stop chain through a server-owned
pedestrian OSRM endpoint. The existing engine still selects candidates with its
bounded heuristic comparisons; this slice does not optimize selection on the
street graph. The final network route must pass the existing order, snap, path,
distance and safety-budget gate. A measured unreasonable walk is refused rather
than replaced by an apparently shorter invented route.

## Configuration

Default remains `PARRANDA_WALKING_PROVIDER=heuristic` (no new network requests).
For a controlled low-volume single-process trial:

```sh
PARRANDA_WALKING_PROVIDER=osrm
PARRANDA_OSRM_URL=https://routing.openstreetmap.de/routed-foot/
```

The known FOSSGIS foot endpoint supplies its documented transport mode and public
attribution. For a custom/self-hosted endpoint, also set
`PARRANDA_OSRM_TRANSPORT_MODE=foot` only after confirming the graph was built with
a pedestrian profile. A profile word in the URL alone does not establish mode.
The car demo hostname is explicitly refused. Endpoint prefixes are retained.
These options belong to the operator, never to the request body or query.
Explicit `buildApp` injections (including null) override process defaults.

The deployment manifest forwards these variables but does not enable the feature.
No production/staging setting is changed by this feature branch.

## Bounds and provider operation

- One route request covers all ordered points, maximum 32; no per-leg fan-out.
- 4.5-second combined fetch/body deadline; 1 MiB response and 8,192 path points.
- Valid GeoJSON LineString, exact leg count, finite metrics, consistent totals and
  waypoint snaps within 100 m are mandatory. Final validation independently checks
  path visits/order, geometry/metric consistency and the walking budgets.
- Cache: at most 256 ordered coordinate chains, 24-hour TTL, labels reapplied to
  each caller; identical in-flight requests coalesce. Failures are not cached.
- At most one provider request per second per Node process. Distinct concurrent
  or cooldown requests immediately retain the heuristic fallback; there is no queue.
- Multiple `buildApp` instances using the same endpoint in one process share the
  default runtime. Multiple processes/replicas do **not** share the limiter/cache.

FOSSGIS documents worldwide foot routing, attribution plus a fix-map link,
an identifiable user agent, maximum one request/second and no heavy use. It logs
route requests, including coordinates. This public service is suitable for the
bounded proof, not an accepted capacity plan for an unrestricted public rollout.
Coordinate use/privacy and multi-process traffic must be reviewed by the operator.
For scale, use an operator-owned shared limiting/cache proxy with suitable upstream
capacity or an operated pedestrian router. Do not activate a paid service implicitly.

Sources: [FOSSGIS](https://routing.openstreetmap.de/about.html),
[OSRM API](https://project-osrm.org/docs/v5.24.0/api/).

## Output and fallback

Only a successful pedestrian result accepted for the final chain emits
`geometry_source: osrm` plus `geometry_mode: walking`. Its exact path is drawn
solid. The FOSSGIS attribution/fix-map links appear below the map and survive the
closed exact-day projection without relaxing general source-URL privacy rules.
Times remain estimates, never live ETA or an accessibility/access guarantee.

Unavailable, malformed, timed-out or capacity-limited routing retains explicit
heuristic estimates and shows numbered pins without connectors. Unattested old
saved paths also show pins; density alone never authorizes a real-path claim.
An invalid accepted-chain result or exceeded safety budget still blocks publication
through the existing gate. Empty manually edited days do not request a route.

## Verification and remaining work

Deterministic tests cover response contracts, prefix preservation, mode authority,
deadline/byte limits, cache/rate/coalescing, final edited-chain routing, publication
metadata and exact MapLibre line-to-fallback behavior. No live network in CI tests.
A separate bounded real-provider check on five public Lyon POIs returned 394 path
points and approximately 4.3 km, accepted by the final validator. This is one
runtime/router check, not global walkability evidence or deployed acceptance.
Controlled UI preview uses that recorded response, not another provider request.

Before deployment: review the frozen PR/CI, accept capacity/privacy configuration,
then explicitly enable the provider and verify the deployed SHA with a small
ordinary-day check. Broader barrier-aware candidate selection, accessibility
preferences, live ETA and real-device Safari acceptance remain separate work.
