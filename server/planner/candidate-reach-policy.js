"use strict";

const { sanitizeTrustedSpatialScope } = require("../place-candidates/spatial-scope");
const { REACHABLE_ORIGIN_KM } = require("./candidate-combination");

const { normalizeUserIntents } = require("../candidates/intent-vocabulary");

const REACH_POLICY_NAMES = new Set(["exact_anchor", "local_place_anchor", "focused_day", "wide_rhythm_day"]);

// A city/district lookup describes a local walking day. A focused rhythm day
// may widen that local aperture; regional reach still requires resolver-attested
// municipality/region scope.
function resolveAgnosticCandidateReachPolicy({ anchorMode, spatialScope, dayRhythm, preferences = [], availabilityWindow = null } = {}) {
  // A focused rhythm day can use the provider's wider local aperture, not an
  // inferred 6/8/9 km route target. This is a bounded proposal radius; source
  // availability and the final walking contract still decide what is usable.
  // With trusted same-day context, do not expand when even a conservative
  // out-and-back plus two short visits would consume the remaining window.
  const remainingMinutes = availabilityWindow
    ? availabilityWindow.endMinute - availabilityWindow.startMinute : null;
  const hasTimeForWiderDay = remainingMinutes === null || remainingMinutes >= 240;
  if (["full", "free"].includes(dayRhythm) && hasTimeForWiderDay &&
      ["coordinates", "place"].includes(anchorMode)) {
    const scope = sanitizeTrustedSpatialScope(spatialScope);
    // A genuinely regional scope keeps its existing independent cluster policy.
    if (anchorMode !== 'place' || !scope || !['municipality','region'].includes(scope.kind)) {
      return { policy: 'wide_rhythm_day', max_origin_distance_km: 5, scope_kind: scope?.kind || null };
    }
  }
  if (["calm", "balanced", "full", "free"].includes(dayRhythm) &&
      normalizeUserIntents(preferences).intents.length === 1 && hasTimeForWiderDay &&
      ["coordinates", "place"].includes(anchorMode)) {
    return { policy: "focused_day", max_origin_distance_km: 5, scope_kind: null };
  }
  if (anchorMode === "coordinates") {
    return {
      policy: "exact_anchor",
      max_origin_distance_km: REACHABLE_ORIGIN_KM,
      scope_kind: null,
    };
  }
  if (anchorMode !== "place") return null;

  const scope = sanitizeTrustedSpatialScope(spatialScope);
  if (scope && (scope.kind === "municipality" || scope.kind === "region")) return null;
  return {
    policy: "local_place_anchor",
    max_origin_distance_km: REACHABLE_ORIGIN_KM,
    scope_kind: scope?.kind === "settlement" || scope?.kind === "district" ? scope.kind : null,
  };
}

function sanitizeCandidateReachPolicy(value) {
  if (!value || typeof value !== "object") return null;
  const policy = String(value.policy || "");
  const maxDistanceKm = Number(value.max_origin_distance_km);
  if (!REACH_POLICY_NAMES.has(policy)) return null;
  if (!Number.isFinite(maxDistanceKm) || maxDistanceKm <= 0 || maxDistanceKm > 25) return null;
  const scopeKind = ["settlement", "district"].includes(value.scope_kind)
    ? value.scope_kind
    : null;
  return {
    policy,
    max_origin_distance_km: maxDistanceKm,
    scope_kind: scopeKind,
  };
}

function distanceKm(a, b) {
  if (!validPoint(a) || !validPoint(b)) return Number.POSITIVE_INFINITY;
  const toRadians = (degrees) => (degrees * Math.PI) / 180;
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function validPoint(value) {
  return Boolean(value) && Number.isFinite(value.lat) && Number.isFinite(value.lng);
}

module.exports = {
  distanceKm,
  resolveAgnosticCandidateReachPolicy,
  sanitizeCandidateReachPolicy,
};
