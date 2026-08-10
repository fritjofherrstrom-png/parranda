/**
 * Product-fit band for the approximate 4/6/9 km walking choices.
 *
 * This is deliberately separate from walking safety validation. A route may be
 * safe and coherent while still being shorter or modestly longer than the
 * requested day profile; callers should report that tradeoff, not reject or
 * relabel the route.
 */

const TARGET_FLOOR_RATIO = 0.6;
const TARGET_CEILING_RATIO = 1.18;

function describeAgnosticWalkingTarget({ estimatedKm = null, targetKm = null } = {}) {
  const band = resolveAgnosticWalkingTargetBand(targetKm);
  const target = band?.targetKm ?? null;
  const estimated = finiteNonNegative(estimatedKm);
  if (target === null) {
    return {
      status: "not_requested",
      target_km: null,
      estimated_km: round(estimated),
      target_floor_km: null,
      target_ceiling_km: null,
    };
  }

  const floor = band.floorKm;
  const ceiling = band.ceilingKm;
  const status = estimated === null
    ? "unavailable"
    : estimated < floor
      ? "shorter_than_requested_band"
      : estimated > ceiling
        ? "longer_than_requested_band"
        : "within_requested_band";

  return {
    status,
    target_km: round(target),
    estimated_km: round(estimated),
    target_floor_km: round(floor),
    target_ceiling_km: round(ceiling),
  };
}

function resolveAgnosticWalkingTargetBand(targetKm) {
  const target = finitePositive(targetKm);
  if (target === null) return null;
  return {
    targetKm: target,
    floorKm: target * TARGET_FLOOR_RATIO,
    ceilingKm: target * TARGET_CEILING_RATIO,
  };
}

function finitePositive(value) {
  return Number.isFinite(value) && value > 0 ? Number(value) : null;
}

function finiteNonNegative(value) {
  return Number.isFinite(value) && value >= 0 ? Number(value) : null;
}

function round(value) {
  return Number.isFinite(value) ? Number(value.toFixed(1)) : null;
}

module.exports = {
  describeAgnosticWalkingTarget,
  resolveAgnosticWalkingTargetBand,
  TARGET_FLOOR_RATIO,
  TARGET_CEILING_RATIO,
};
