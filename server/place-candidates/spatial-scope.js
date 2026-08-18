"use strict";

const LOCAL_SCOPE_DIAGONAL_KM = 15;
const MAX_BOUNDED_SCOPE_DIAGONAL_KM = 80;
const MAX_SECONDARY_ANCHORS = 2;
const MIN_SECONDARY_ANCHOR_DISTANCE_KM = 4;
const LOCAL_ANCHOR_HALF_SIDE_KM = 5;

const PLACE_KIND_MAP = Object.freeze({
  city: "settlement",
  town: "settlement",
  village: "settlement",
  hamlet: "settlement",
  suburb: "district",
  neighbourhood: "district",
  quarter: "district",
  borough: "district",
  municipality: "municipality",
  county: "region",
  state: "region",
  region: "region",
  administrative: "region",
});

function normalizeNominatimSpatialScope(result) {
  if (!result || typeof result !== "object") return null;
  const bounds = normalizeNominatimBounds(result.boundingbox);
  if (!bounds) return null;
  const dimensions = boundsDimensions(bounds);
  if (!dimensions) return null;
  const rawKind = safeToken(result.addresstype || result.type);
  const kind = PLACE_KIND_MAP[rawKind] || "unknown";
  return {
    source: "nominatim_bounds",
    kind,
    bounds,
    width_km: round(dimensions.width_km),
    height_km: round(dimensions.height_km),
    diagonal_km: round(dimensions.diagonal_km),
    collection_mode:
      dimensions.diagonal_km <= LOCAL_SCOPE_DIAGONAL_KM
        ? "local_anchor"
        : dimensions.diagonal_km <= MAX_BOUNDED_SCOPE_DIAGONAL_KM
          ? "regional_bounded"
          : "broad_anchor_only",
  };
}

function normalizeNominatimBounds(value) {
  if (!Array.isArray(value) || value.length !== 4) return null;
  const [south, north, west, east] = value.map(Number);
  return normalizeBounds({ south, north, west, east });
}

function normalizeBounds(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const south = Number(value.south);
  const north = Number(value.north);
  const west = Number(value.west);
  const east = Number(value.east);
  if (![south, north, west, east].every(Number.isFinite)) return null;
  if (south < -90 || north > 90 || west < -180 || east > 180) return null;
  if (south >= north || west >= east) return null;
  return { south, north, west, east };
}

function sanitizeTrustedSpatialScope(value) {
  if (!value || typeof value !== "object") return null;
  const bounds = normalizeBounds(value.bounds);
  if (!bounds) return null;
  const dimensions = boundsDimensions(bounds);
  if (!dimensions) return null;
  const expectedMode =
    dimensions.diagonal_km <= LOCAL_SCOPE_DIAGONAL_KM
      ? "local_anchor"
      : dimensions.diagonal_km <= MAX_BOUNDED_SCOPE_DIAGONAL_KM
        ? "regional_bounded"
        : "broad_anchor_only";
  return {
    source: safeToken(value.source) || "resolver_bounds",
    kind: PLACE_KIND_MAP[safeToken(value.kind)] || safeKind(value.kind),
    bounds,
    width_km: round(dimensions.width_km),
    height_km: round(dimensions.height_km),
    diagonal_km: round(dimensions.diagonal_km),
    collection_mode: expectedMode,
  };
}

function deriveSecondaryAnchors(spatialScope, primaryAnchor) {
  const scope = sanitizeTrustedSpatialScope(spatialScope);
  if (scope?.collection_mode !== "regional_bounded") return [];
  if (!validPoint(primaryAnchor)) return [];
  const { bounds } = scope;
  const latMid = (bounds.south + bounds.north) / 2;
  const lngMid = (bounds.west + bounds.east) / 2;
  const vertical = scope.height_km >= scope.width_km;
  const points = vertical
    ? [
        { id: "scope_axis_low", lat: lerp(bounds.south, bounds.north, 0.25), lng: lngMid },
        { id: "scope_axis_high", lat: lerp(bounds.south, bounds.north, 0.75), lng: lngMid },
      ]
    : [
        { id: "scope_axis_low", lat: latMid, lng: lerp(bounds.west, bounds.east, 0.25) },
        { id: "scope_axis_high", lat: latMid, lng: lerp(bounds.west, bounds.east, 0.75) },
      ];

  const kept = [];
  for (const point of points) {
    if (haversineKm(primaryAnchor, point) < MIN_SECONDARY_ANCHOR_DISTANCE_KM) continue;
    if (kept.some((existing) => haversineKm(existing, point) < MIN_SECONDARY_ANCHOR_DISTANCE_KM)) continue;
    kept.push({ ...point, lat: round(point.lat, 6), lng: round(point.lng, 6) });
    if (kept.length >= MAX_SECONDARY_ANCHORS) break;
  }
  return kept;
}

function allowsRegionalClusterSelection(value) {
  return Boolean(resolveTrustedRegionalSpatialScope(value));
}

function resolveTrustedRegionalSpatialScope(value) {
  const scope = sanitizeTrustedSpatialScope(value);
  if (
    !scope ||
    scope.collection_mode !== "regional_bounded" ||
    (scope.kind !== "municipality" && scope.kind !== "region")
  ) return null;
  return scope;
}

function pointWithinTrustedSpatialScope(point, value) {
  const scope = sanitizeTrustedSpatialScope(value);
  if (!scope || !validPoint(point)) return false;
  const { bounds } = scope;
  return (
    point.lat >= bounds.south &&
    point.lat <= bounds.north &&
    point.lng >= bounds.west &&
    point.lng <= bounds.east
  );
}

function deriveLocalAnchorSpatialScope(value, anchor) {
  const scope = sanitizeTrustedSpatialScope(value);
  if (!scope || !validPoint(anchor) || !pointWithinTrustedSpatialScope(anchor, scope)) return null;
  if (scope.collection_mode !== "broad_anchor_only") return scope;

  const latDelta = LOCAL_ANCHOR_HALF_SIDE_KM / 111.32;
  const longitudeScale = Math.max(0.05, Math.abs(Math.cos((anchor.lat * Math.PI) / 180)));
  const lngDelta = LOCAL_ANCHOR_HALF_SIDE_KM / (111.32 * longitudeScale);
  return sanitizeTrustedSpatialScope({
    source: "resolver_anchor_aperture",
    kind: scope.kind,
    bounds: {
      south: Math.max(scope.bounds.south, anchor.lat - latDelta),
      north: Math.min(scope.bounds.north, anchor.lat + latDelta),
      west: Math.max(scope.bounds.west, anchor.lng - lngDelta),
      east: Math.min(scope.bounds.east, anchor.lng + lngDelta),
    },
  });
}

function spatialScopeCacheKey(value) {
  const scope = sanitizeTrustedSpatialScope(value);
  if (!scope) return "none";
  const b = scope.bounds;
  return [
    scope.collection_mode,
    scope.kind,
    b.south.toFixed(3),
    b.north.toFixed(3),
    b.west.toFixed(3),
    b.east.toFixed(3),
  ].join(":");
}

function boundsDimensions(bounds) {
  const normalized = normalizeBounds(bounds);
  if (!normalized) return null;
  const latMid = (normalized.south + normalized.north) / 2;
  const width_km = haversineKm(
    { lat: latMid, lng: normalized.west },
    { lat: latMid, lng: normalized.east },
  );
  const height_km = haversineKm(
    { lat: normalized.south, lng: (normalized.west + normalized.east) / 2 },
    { lat: normalized.north, lng: (normalized.west + normalized.east) / 2 },
  );
  return { width_km, height_km, diagonal_km: Math.hypot(width_km, height_km) };
}

function safeKind(value) {
  const token = safeToken(value);
  return ["settlement", "district", "municipality", "region", "unknown"].includes(token)
    ? token
    : "unknown";
}

function safeToken(value) {
  const token = typeof value === "string" ? value.trim().toLowerCase() : "";
  return /^[a-z_]{1,40}$/.test(token) ? token : null;
}

function validPoint(value) {
  return Boolean(value) && Number.isFinite(value.lat) && Number.isFinite(value.lng);
}

function lerp(a, b, ratio) {
  return a + (b - a) * ratio;
}

function haversineKm(a, b) {
  if (!validPoint(a) || !validPoint(b)) return Number.POSITIVE_INFINITY;
  const toRad = (degrees) => (degrees * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

module.exports = {
  LOCAL_SCOPE_DIAGONAL_KM,
  MAX_BOUNDED_SCOPE_DIAGONAL_KM,
  MAX_SECONDARY_ANCHORS,
  MIN_SECONDARY_ANCHOR_DISTANCE_KM,
  deriveLocalAnchorSpatialScope,
  normalizeNominatimSpatialScope,
  sanitizeTrustedSpatialScope,
  deriveSecondaryAnchors,
  allowsRegionalClusterSelection,
  resolveTrustedRegionalSpatialScope,
  pointWithinTrustedSpatialScope,
  spatialScopeCacheKey,
};
