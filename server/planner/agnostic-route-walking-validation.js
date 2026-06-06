/**
 * Agnostic route walking-budget validation (#261).
 *
 * Validates the EXISTING experimental candidate stop order (from #259/#260)
 * against walking distance, leg count, and budget constraints using the shared
 * walking-router contract. This is a VALIDATION step, not an optimizer:
 *
 *   - it routes the stops in the SUPPLIED candidate order — it never reorders,
 *     optimizes, nearest-neighbours, or picks a "best"/"fastest"/"shortest" path;
 *   - it produces honest walking-distance/minute ESTIMATES (heuristic or OSRM),
 *     never a live arrival time;
 *   - it fails closed: if the router can't run, returns invalid leg/path data, or
 *     the order blows the walking budget, it returns explicit blockers and no
 *     validated result — the caller then leaves the baseline route unchanged.
 *
 * Pure except for the awaited (injectable) walking router. Deterministic given
 * its inputs; the default router runs in heuristic mode (no network).
 */

const { routeWalkingPath } = require("../walking-router");

// Conservative, easy-to-defend budgets. A very active full day on foot is well
// under this total; a single uninterrupted leg longer than the per-leg cap is
// not an honest "walk between stops". Overridable for tests via `budget`.
const DEFAULT_TOTAL_WALK_BUDGET_KM = 25;
const DEFAULT_MAX_LEG_BUDGET_KM = 6;

function isFiniteCoordinate(lat, lng) {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
}

function failed(blockers, checks) {
  return { valid: false, blockers, checks, result: null };
}

/**
 * @param {object} params
 * @param {Array<{lat:number,lng:number,label?:string}>} params.stops  ordered candidate stops
 * @param {Function} [params.walkingRouter]  injected router (defaults to routeWalkingPath)
 * @param {object} [params.walkingConfig]    passed through to the router
 * @param {{totalKm?:number,maxLegKm?:number}} [params.budget]
 * @returns {Promise<{valid:boolean, blockers:string[], checks:object, result:object|null}>}
 */
async function validateAgnosticWalkingOrder({ stops, walkingRouter, walkingConfig = {}, budget = {} } = {}) {
  const totalBudgetKm = Number.isFinite(budget.totalKm) ? budget.totalKm : DEFAULT_TOTAL_WALK_BUDGET_KM;
  const maxLegBudgetKm = Number.isFinite(budget.maxLegKm) ? budget.maxLegKm : DEFAULT_MAX_LEG_BUDGET_KM;
  const router = typeof walkingRouter === "function" ? walkingRouter : routeWalkingPath;

  const orderedStops = Array.isArray(stops) ? stops : [];
  const checks = {
    stop_count: orderedStops.length,
    total_budget_km: totalBudgetKm,
    max_leg_budget_km: maxLegBudgetKm,
  };

  // 1. Need at least an ordered pair, each with finite in-range coordinates.
  if (orderedStops.length < 2) {
    return failed(["invalid_walking_coordinates"], checks);
  }
  const points = orderedStops.map((stop) => ({
    lat: Number(stop.lat),
    lng: Number(stop.lng),
    label: stop.label || null,
  }));
  if (!points.every((point) => isFiniteCoordinate(point.lat, point.lng))) {
    return failed(["invalid_walking_coordinates"], checks);
  }

  // 2. Route the points in the SUPPLIED order. No optimization / reordering.
  let result;
  try {
    result = await router(points, { walkingConfig });
  } catch (_error) {
    return failed(["walking_route_unavailable"], checks);
  }
  if (!result || !Array.isArray(result.legs)) {
    return failed(["walking_route_unavailable"], checks);
  }

  // 3. Exactly stops.length - 1 legs.
  if (result.legs.length !== points.length - 1) {
    return failed(["invalid_walking_leg_count"], { ...checks, leg_count: result.legs.length });
  }

  // 4. Every leg must have finite distance + walking minutes.
  const legDistances = result.legs.map((leg) => Number(leg && leg.distance_km));
  const legMinutes = result.legs.map((leg) => Number(leg && leg.estimated_walk_minutes));
  if (!legDistances.every(Number.isFinite) || !legMinutes.every(Number.isFinite)) {
    return failed(["walking_validation_failed"], { ...checks, leg_count: result.legs.length });
  }

  const totalKm = Number.isFinite(result.estimatedKm)
    ? result.estimatedKm
    : Number(legDistances.reduce((sum, value) => sum + value, 0).toFixed(1));
  const maxLegKm = Math.max(...legDistances);
  const totalMinutes = legMinutes.reduce((sum, value) => sum + value, 0);

  const fullChecks = {
    ...checks,
    leg_count: result.legs.length,
    total_walk_km: totalKm,
    max_leg_km: Number(maxLegKm.toFixed(1)),
    total_estimated_walk_minutes: totalMinutes,
    walking_source: result.source || null,
    fallback_used: Boolean(result.fallbackUsed),
  };

  // 5. Budget gates (total + per-leg).
  if (!Number.isFinite(totalKm) || totalKm > totalBudgetKm) {
    return { valid: false, blockers: ["walking_budget_exceeded"], checks: fullChecks, result: null };
  }
  if (maxLegKm > maxLegBudgetKm) {
    return { valid: false, blockers: ["walking_leg_budget_exceeded"], checks: fullChecks, result: null };
  }

  return {
    valid: true,
    blockers: [],
    checks: fullChecks,
    result: {
      source: result.source || null,
      estimatedKm: totalKm,
      legs: result.legs,
      pathPoints: Array.isArray(result.pathPoints)
        ? result.pathPoints
        : points.map((point) => ({ lat: point.lat, lng: point.lng })),
      fallbackUsed: Boolean(result.fallbackUsed),
    },
  };
}

module.exports = {
  validateAgnosticWalkingOrder,
  DEFAULT_TOTAL_WALK_BUDGET_KM,
  DEFAULT_MAX_LEG_BUDGET_KM,
};
