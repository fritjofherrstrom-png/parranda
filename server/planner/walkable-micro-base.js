"use strict";

/**
 * Select a walkable composition base for typed places whose resolver point is
 * only a geographic discovery anchor. Explicit coordinates remain exact.
 *
 * Two trusted paths may move the composition base:
 *  - a resolver-bounded regional scout selected one richer cluster; or
 *  - the bounded trusted candidate result contains one compact, preference-
 *    relevant cluster while the resolver point itself has too little relevant
 *    walking supply.
 *
 * The latter path is deliberately capped to the loader's local 5 km aperture
 * plus a small geometry/rounding tolerance.
 * It never turns an arbitrary remote dataset into a route and never invents a
 * neighbourhood name.
 */

const { composeDistrictDay, tokensToAxes } = require("../candidates/district-composition");
const { haversineKm } = require("../candidates/area-intelligence");
const {
  pointWithinTrustedSpatialScope,
  resolveTrustedRegionalSpatialScope,
  sanitizeTrustedSpatialScope,
} = require("../place-candidates/spatial-scope");
const { REACHABLE_ORIGIN_KM } = require("./candidate-combination");

const MIN_MICRO_BASE_CANDIDATES = 3;
const MAX_DERIVED_MICRO_BASE_SHIFT_KM = 5.1;

function resolveWalkableMicroBase({
  origin,
  records = [],
  requestedIntents = [],
  anchorMode = "unknown",
  spatialScope = null,
  loaderMetadata = null,
} = {}) {
  if (!validPoint(origin) || anchorMode !== "place") return unchanged(origin);

  const trustedRecords = (Array.isArray(records) ? records : []).filter(isCompositionRecord);
  if (trustedRecords.length < MIN_MICRO_BASE_CANDIDATES) return unchanged(origin);

  const scope = sanitizeTrustedSpatialScope(spatialScope);
  const regionalScope = resolveTrustedRegionalSpatialScope(scope);
  const scopedAnchor = regionalScope
    ? selectedRegionalAnchor(loaderMetadata?.regional_scout, regionalScope)
    : null;
  if (scopedAnchor) {
    const clusterRecords = trustedRecords.filter(
      (record) => haversineKm(scopedAnchor, record) <= REACHABLE_ORIGIN_KM,
    );
    if (clusterRecords.length >= MIN_MICRO_BASE_CANDIDATES) {
      return applied({
        origin,
        anchor: scopedAnchor,
        mode: "resolver_scoped_cluster",
        reason: "richer_resolver_bounded_cluster",
        records: clusterRecords,
        requestedIntents,
      });
    }
  }

  const requestedAxes = [...tokensToAxes(requestedIntents)];
  const relevant = (record) => {
    if (!requestedAxes.length) return true;
    const axes = tokensToAxes([record.type, ...(Array.isArray(record.tags) ? record.tags : [])]);
    return [...axes].some((axis) => requestedAxes.includes(axis));
  };
  const localRelevantCount = trustedRecords.filter(
    (record) => relevant(record) && haversineKm(origin, record) <= REACHABLE_ORIGIN_KM,
  ).length;
  if (localRelevantCount >= MIN_MICRO_BASE_CANDIDATES) return unchanged(origin);

  const districtDay = composeDistrictDay(trustedRecords, {
    intents: requestedIntents,
    maxAreas: 1,
    minAreaSize: MIN_MICRO_BASE_CANDIDATES,
  });
  const area = districtDay.areas?.[0];
  if (!area || !validPoint(area.center) || area.size < MIN_MICRO_BASE_CANDIDATES) {
    return unchanged(origin);
  }

  const shiftKm = haversineKm(origin, area.center);
  if (
    shiftKm <= REACHABLE_ORIGIN_KM ||
    shiftKm > MAX_DERIVED_MICRO_BASE_SHIFT_KM ||
    (scope && !pointWithinTrustedSpatialScope(area.center, scope))
  ) {
    return unchanged(origin);
  }

  const minimumCoverage = requestedAxes.length > 1 ? 2 : requestedAxes.length;
  const coveredAxes = [...new Set(Array.isArray(area.covers) ? area.covers : [])];
  if (minimumCoverage > 0 && coveredAxes.length < minimumCoverage) return unchanged(origin);

  return applied({
    origin,
    anchor: area.center,
    mode: "trusted_candidate_cluster",
    reason: "insufficient_relevant_supply_at_resolved_anchor",
    records: trustedRecords.filter((record) => haversineKm(area.center, record) <= 0.9),
    requestedIntents,
    coveredIntents: coveredAxes,
    localRelevantCount,
  });
}

function selectedRegionalAnchor(value, scope) {
  if (!value || typeof value !== "object") return null;
  if (value.reason !== "richer_regional_cluster") return null;
  const point = value.selected_anchor_coords;
  if (!validPoint(point) || !pointWithinTrustedSpatialScope(point, scope)) return null;
  return { lat: point.lat, lng: point.lng };
}

function applied({
  origin,
  anchor,
  mode,
  reason,
  records,
  requestedIntents,
  coveredIntents = null,
  localRelevantCount = null,
}) {
  const inferredCoverage = coveredIntents || coveredAxesFor(records, requestedIntents);
  return {
    anchor: { lat: anchor.lat, lng: anchor.lng },
    summary: {
      applied: true,
      mode,
      reason,
      shift_km: round(haversineKm(origin, anchor)),
      cluster_candidate_count: records.length,
      covered_intents: inferredCoverage,
      local_relevant_candidate_count: Number.isFinite(localRelevantCount) ? localRelevantCount : null,
    },
  };
}

function unchanged(origin) {
  return {
    anchor: validPoint(origin) ? { lat: origin.lat, lng: origin.lng } : null,
    summary: null,
  };
}

function coveredAxesFor(records, requestedIntents) {
  const requested = new Set(tokensToAxes(requestedIntents));
  const covered = new Set();
  for (const record of records) {
    for (const axis of tokensToAxes([record.type, ...(Array.isArray(record.tags) ? record.tags : [])])) {
      if (requested.has(axis)) covered.add(axis);
    }
  }
  return [...covered].sort();
}

function isCompositionRecord(value) {
  const kind = String(value?.candidate_kind || value?.candidateKind || "").toLowerCase();
  const hasSource = (Array.isArray(value?.sources) ? value.sources : []).some(
    (source) => source && typeof source === "object" && (
      hasText(source.provider) ||
      hasText(source.provider_id) ||
      hasText(source.url) ||
      hasText(source.label)
    ),
  );
  return (
    validPoint(value) &&
    stableId(value) &&
    hasText(value.name || value.label || value.title) &&
    hasText(value.type || value.category) &&
    hasSource &&
    value?.is_structural !== true &&
    value?.structuralRouteAnchor !== true &&
    !["area_preset", "structural_anchor", "map_result"].includes(kind) &&
    String(value?.operational_status || "").toLowerCase() !== "inactive"
  );
}

function stableId(value) {
  return (typeof value?.id === "string" && value.id.trim().length > 0) || typeof value?.id === "number";
}

function hasText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function validPoint(value) {
  return Boolean(value) && Number.isFinite(value.lat) && Number.isFinite(value.lng);
}

function round(value) {
  return Number(value.toFixed(2));
}

module.exports = {
  MAX_DERIVED_MICRO_BASE_SHIFT_KM,
  MIN_MICRO_BASE_CANDIDATES,
  resolveWalkableMicroBase,
};
