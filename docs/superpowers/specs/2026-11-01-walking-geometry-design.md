# Walking geometry V5

Owner: Codex. Target: independent `codex/walking-geometry-v5` PR against main
`8ed164403e7295a54a5a7cab451092add3ed1de2`. Runtime QA: Codex, controlled local
preview, with a bounded real-provider check. #674 remains independent and untouched.

The user selected the V5 screenshot's actual pedestrian route and authorized the
next implementation step. Preserve Linje and its compact map. Show an exact solid
pedestrian polyline only when supplied by a configured pedestrian router and
accepted for the final published stop chain. Otherwise show numbered pins without
connectors. Do not invent street shapes, reorder explicit commitments, or claim ETA.

Approaches considered: decorative bows were rejected by the user; pins alone are
an honest fallback; V5 is the selected target. Use existing MapLibre and OSRM seams,
not a new map library or city-specific routing. The first slice routes the final
selected chain; network-aware candidate optimization is a separate capability.

Implementation decisions by Codex: provider calls are server-owned and opt-in via
`PARRANDA_WALKING_PROVIDER=osrm` plus `PARRANDA_OSRM_URL`; the known FOSSGIS
`/routed-foot/` endpoint attests foot, custom endpoints additionally require an
operator-declared foot mode. No paid service, public rollout, merge or deploy is
included. Default provider remains heuristic until explicitly configured.
The modern frontend's existing experiment boundary is retained.

One request covers the ordered points. Bound timeout, bytes, geometry, cache and
provider concurrency/rate; coalesce identical requests and use heuristic fallback
on unavailable/busy/malformed responses. Preserve unknown geometry as unknown.
Keep existing walking-budget rejection for a real but unreasonable route.

Router result `mode: walking` passes through independent final-chain validation to
`geometry_source: osrm`, `geometry_mode: walking`; optional attribution becomes
`geometry_attribution: {label,url,fixMapUrl}`. Point count alone grants no authority.
Saved/shared projection must preserve these fields with its closed schema.

Acceptance: deterministic adapter/fallback/rate/cache tests; modern request tests
for final endpoints, edits and public injection; exact path rendering and pins-only
fallback; saved/shared projection; typecheck, frontend build/drift and relevant map
flows. Small real-provider check and mobile/desktop browser evidence are distinct
from fixtures. iOS/Safari and production-scale operation remain unverified.
