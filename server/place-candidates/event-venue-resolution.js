"use strict";

const { haversineKm } = require("../candidates/area-intelligence");
const { normalizeConfidence } = require("../pulse-sources/display-gates");
const {
  pointWithinTrustedSpatialScope,
  resolveTrustedRegionalSpatialScope,
} = require("./spatial-scope");

const DEFAULT_RESOLUTION_LIMIT = 4;
const MAX_RESOLUTION_LIMIT = 8;
const MAX_QUERY_LENGTH = 200;

function buildEventVenueQuery(event, { placeContext = null } = {}) {
  if (!event || typeof event !== "object") return null;
  const sourceParts = uniqueStrings([
    event.address,
    event.place_context,
    event.area,
    event.city,
  ]);
  if (sourceParts.length === 0) return null;
  const contextParts = event.city
    ? [placeContext?.region, placeContext?.country]
    : [
        placeContext?.locality,
        placeContext?.municipality,
        placeContext?.region,
        placeContext?.country,
      ];
  return appendBoundedQueryParts(sourceParts, contextParts);
}

async function resolveEventVenueGeometry(
  events,
  {
    resolver = null,
    anchor = null,
    radiusM = 3000,
    spatialScope = null,
    placeContext = null,
    limit = DEFAULT_RESOLUTION_LIMIT,
  } = {},
) {
  const rows = Array.isArray(events) ? events : [];
  const cap = clampInteger(limit, 0, MAX_RESOLUTION_LIMIT, DEFAULT_RESOLUTION_LIMIT);
  const summary = {
    limit: cap,
    attempted_count: 0,
    resolved_count: 0,
    ambiguous_count: 0,
    not_found_count: 0,
    failed_count: 0,
  };
  if (typeof resolver !== "function" || !hasCoordinates(anchor) || cap === 0) {
    return { events: rows.slice(), summary };
  }

  const radiusKm = Math.max(0.1, Number(radiusM || 0) / 1000);
  const candidateRegionalScope = resolveTrustedRegionalSpatialScope(spatialScope);
  const regionalScope = candidateRegionalScope && pointWithinTrustedSpatialScope(anchor, candidateRegionalScope)
    ? candidateRegionalScope
    : null;
  const resolutions = new Map();
  let attempts = 0;
  const output = [];

  for (const event of rows) {
    if (!event || typeof event !== "object" || hasCoordinates(event)) {
      output.push(event);
      continue;
    }
    const query = buildEventVenueQuery(event, { placeContext });
    if (!query || (attempts >= cap && !resolutions.has(query))) {
      output.push(event);
      continue;
    }

    if (!resolutions.has(query)) {
      attempts += 1;
      summary.attempted_count += 1;
      resolutions.set(query, resolveVenueQuery(query, {
        resolver,
        anchor,
        radiusKm,
        regionalScope,
      }));
    }
    const resolution = await resolutions.get(query);
    if (resolution.status === "resolved") {
      summary.resolved_count += 1;
      output.push({
        ...event,
        lat: resolution.candidate.lat,
        lng: resolution.candidate.lng,
        venue_resolution: {
          status: "resolved",
          source: "trusted_place_resolver",
          confidence: normalizeConfidence(resolution.candidate.confidence),
          provenance: resolution.candidate.provenance || null,
          attribution: resolution.candidate.attribution || null,
          license: resolution.candidate.license || null,
          query_basis: event.address ? "source_address" : "source_venue",
          geometry_scope: regionalScope ? "resolver_attested_region" : "anchor_radius",
        },
      });
      continue;
    }
    if (resolution.status === "ambiguous") summary.ambiguous_count += 1;
    else if (resolution.status === "failed") summary.failed_count += 1;
    else summary.not_found_count += 1;
    output.push({
      ...event,
      venue_resolution: {
        status: resolution.status,
        source: "trusted_place_resolver",
        query_basis: event.address ? "source_address" : "source_venue",
        geometry_scope: regionalScope ? "resolver_attested_region" : "anchor_radius",
      },
    });
  }

  return { events: output, summary };
}

async function resolveVenueQuery(query, { resolver, anchor, radiusKm, regionalScope }) {
  try {
    const candidates = await resolver(query);
    const trusted = (Array.isArray(candidates) ? candidates : [])
      .filter(hasCoordinates)
      .filter((candidate) => confidenceRank(candidate.confidence) >= confidenceRank("medium"))
      .filter((candidate) => regionalScope
        ? pointWithinTrustedSpatialScope(candidate, regionalScope)
        : haversineKm(anchor, candidate) <= radiusKm);
    if (trusted.length === 1) return { status: "resolved", candidate: trusted[0] };
    if (trusted.length > 1) return { status: "ambiguous", candidate: null };
    return { status: "not_found", candidate: null };
  } catch (_error) {
    return { status: "failed", candidate: null };
  }
}

function appendBoundedQueryParts(sourceParts, contextParts) {
  const parts = uniqueStrings(sourceParts);
  if (!parts.length) return null;
  if (parts.join(", ").length > MAX_QUERY_LENGTH) return null;
  for (const part of uniqueStrings(contextParts)) {
    const candidate = [...parts, part].join(", ");
    if (candidate.length > MAX_QUERY_LENGTH) break;
    parts.push(part);
  }
  return parts.join(", ");
}

function confidenceRank(value) {
  return { needs_review: 0, low: 1, medium: 2, strong: 3 }[normalizeConfidence(value)] || 0;
}

function uniqueStrings(values) {
  const seen = new Set();
  const output = [];
  for (const value of values) {
    if (typeof value !== "string") continue;
    const compact = value.trim().replace(/\s+/g, " ");
    const key = compact.toLocaleLowerCase("en");
    if (!compact || seen.has(key)) continue;
    seen.add(key);
    output.push(compact);
  }
  return output;
}

function hasCoordinates(value) {
  return Number.isFinite(value?.lat) && Number.isFinite(value?.lng);
}

function clampInteger(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(number)));
}

module.exports = {
  DEFAULT_RESOLUTION_LIMIT,
  buildEventVenueQuery,
  resolveEventVenueGeometry,
};
