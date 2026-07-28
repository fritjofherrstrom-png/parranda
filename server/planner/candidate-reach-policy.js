"use strict";

const { sanitizeTrustedSpatialScope } = require("../place-candidates/spatial-scope");
const { REACHABLE_ORIGIN_KM } = require("./candidate-combination");

const REACH_POLICY_NAMES = new Set(["exact_anchor", "local_place_anchor"]);

// A city/district lookup describes a local walking day. Broader reach is earned
// only by resolver-attested municipality/region scope; missing scope never
// silently grants regional freedom.
function resolveAgnosticCandidateReachPolicy({ anchorMode, spatialScope } = {}) {
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
