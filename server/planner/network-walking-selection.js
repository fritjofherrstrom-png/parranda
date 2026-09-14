"use strict";

const { comparableRoleReplacement } = require("./walking-fit-selection");
const {
  resolveAgnosticWalkingTargetBand,
} = require("./agnostic-walking-target");
const { buildLegMetrics } = require("../route-engine");
const { MAX_EVENT_LEG_KM } = require("../candidates/event-route-stop-weave");

// Route quality is established upstream. Network cost may exchange one equally
// eligible role, never lose another stop or buy distance with weaker evidence.
function sameQualityReplacement(base, next, plannerRoles) {
  const before = base?.main_stops || [];
  const after = next?.main_stops || [];
  if (before.length !== after.length || before.length < 2) return false;
  const removed = before.filter((a) => !after.some((b) => b.id === a.id));
  const added = after.filter((a) => !before.some((b) => b.id === a.id));
  if (removed.length !== 1 || added.length !== 1) return false;
  const rich = (plannerRoles?.roles || [])
    .flatMap((role) =>
      (role.candidates || []).map((c) => ({ ...c, role: role.role })),
    )
    .concat(plannerRoles?.walking_fit_candidates || []);
  return rich.some(
    (a) =>
      a.candidate_id === removed[0].id &&
      rich.some(
        (b) =>
          b.candidate_id === added[0].id &&
          a.role === b.role &&
          comparableRoleReplacement(a, b),
      ),
  );
}

function applyNetworkGeometry(route, result, lang) {
  if (result?.status !== "ok" || result.source !== "valhalla_pedestrian")
    return null;
  const points = route.map_route_points || [];
  if (
    result.legs?.length !== points.length - 1 ||
    result.pathPoints?.length < 2
  )
    return null;
  const legs = result.legs.map((leg, i) => ({
    from_label: points[i].label || null,
    to_label: points[i + 1].label || null,
    distance_km: leg.distance_km,
    estimated_walk_minutes: leg.estimated_walk_minutes,
  }));
  if (
    !legs.every(
      (l) =>
        Number.isFinite(l.distance_km) &&
        l.distance_km >= 0 &&
        l.distance_km <= 6 &&
        Number.isFinite(l.estimated_walk_minutes) &&
        l.estimated_walk_minutes >= 0,
    )
  )
    return null;
  const km = legs.reduce((sum, l) => sum + l.distance_km, 0);
  if (
    km > 25 ||
    !Number.isFinite(result.estimatedKm) ||
    Math.abs(km - result.estimatedKm) > 0.02
  )
    return null;
  if (route.live_event_stop && legs.at(-1).distance_km > MAX_EVENT_LEG_KM)
    return null;
  const minutes = legs.map((l) => l.estimated_walk_minutes);
  const metrics = buildLegMetrics(legs, "balanced", {
    shape: route.route_shape,
    lang,
  });
  // Old distance-derived scores cannot describe this path. Recompute the
  // displayed metrics and discard heuristic scores/prose, not source truth.
  return {
    ...route,
    routing_source: "valhalla_pedestrian",
    estimated_km: Number(km.toFixed(1)),
    legs,
    map_path_points: result.pathPoints,
    longest_leg_km: Math.max(...legs.map((l) => l.distance_km)),
    longest_leg_minutes: Math.max(...minutes),
    average_leg_minutes: Number(
      (minutes.reduce((a, b) => a + b, 0) / minutes.length).toFixed(1),
    ),
    long_leg_count: metrics.longLegCount,
    route_continuity_score: metrics.routeContinuityScore,
    dead_walk_penalty: metrics.deadWalkPenalty,
    leg_fit_note: metrics.note,
    route_quality_warnings: metrics.warnings,
    geo_quality_score: null,
    pool_fit_penalty: null,
    ...(route.live_event_stop
      ? {
          live_event_stop: {
            ...route.live_event_stop,
            leg_km: Number(legs.at(-1).distance_km.toFixed(1)),
            leg_minutes: Math.round(legs.at(-1).estimated_walk_minutes),
          },
        }
      : {}),
    geo_fit_note:
      lang === "sv"
        ? "Gångvägar beräknade med Valhalla · © OpenStreetMap-bidragsgivare. Uppskattning, inte realtidsnavigation."
        : "Walking paths calculated with Valhalla · © OpenStreetMap contributors. Estimate, not live navigation.",
    walking_geometry: {
      kind: "pedestrian_network",
      attribution: "© OpenStreetMap contributors",
      attribution_url: "https://www.openstreetmap.org/copyright",
      max_snap_distance_m: Math.ceil(
        Math.max(...(result.snapDistances || [0])),
      ),
    },
    caveats: [
      ...(route.caveats || []).filter(
        (c) =>
          ![
            "heuristic_walking_estimate",
            "walking_router_fallback_used",
          ].includes(c),
      ),
      "network_graph_not_live_access",
    ],
  };
}

// One bounded final choice over the engine's own days, not a second composer.
// Every compared distance comes from the same pedestrian provider/session.
async function selectNetworkWalkingDay({
  day,
  alternatives,
  session,
  signal,
  walkingKmTarget,
  distanceMode,
  lang,
}) {
  const band =
    distanceMode === "no_limit"
      ? null
      : resolveAgnosticWalkingTargetBand(walkingKmTarget);
  const fits = (route) =>
    route &&
    (!band ||
      (route.estimated_km >= band.floorKm &&
        route.estimated_km <= band.ceilingKm));
  const cost = (route) =>
    !band ? 0 : Math.abs(route.estimated_km - band.targetKm);
  let best = null;
  let attempts = 0;
  const seen = new Set();
  async function consider(candidate) {
    signal?.throwIfAborted();
    const route = candidate?.primary_route;
    if (!route) return;
    const key = JSON.stringify(
      route.map_route_points?.map((p) => [p.lat, p.lng]),
    );
    if (seen.has(key) || attempts >= 4) return;
    seen.add(key);
    attempts++;
    const result = await session.route(route.map_route_points);
    signal?.throwIfAborted();
    const measured = applyNetworkGeometry(route, result, lang);
    if (
      measured &&
      (!best ||
        (fits(measured) && !fits(best.primary_route)) ||
        cost(measured) + 0.3 <= cost(best.primary_route))
    )
      best = { ...candidate, primary_route: measured };
  }
  await consider(day);
  if (!fits(best?.primary_route)) {
    for await (const candidate of alternatives()) {
      await consider(candidate);
      if (attempts >= 4 || fits(best?.primary_route)) break;
    }
  }
  return best;
}

module.exports = {
  sameQualityReplacement,
  applyNetworkGeometry,
  selectNetworkWalkingDay,
};
