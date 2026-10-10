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
  if (!event || typeof event !== "object" || ["municipality", "virtual"].includes(event.source_location_scope)) return null;
  const sourceParts = uniqueStrings([
    event.address,
    event.place_context,
    event.area,
    event.city,
  ]);
  if (sourceParts.length === 0) return null;
  const country = uniqueStrings([event.country])[0];
  if (country) sourceParts.splice(1, 0, country);
  // A published country must not be replaced by an unrelated anchor's region
  // or country. Keep it in the bounded query even after event normalization.
  const contextParts = country ? [] : event.city
    ? [placeContext?.region, placeContext?.country]
    : [
        placeContext?.locality,
        placeContext?.municipality,
        placeContext?.region,
        placeContext?.country,
      ];
  return appendBoundedQueryParts(sourceParts, contextParts);
}

// Geocoders answer a street address or a venue name, rarely both glued
// together ("via X 5, Trieste, Risiera di San Sabba – Monumento Nazionale").
// Try the source's own address first, then its venue name (and the name
// before a descriptive dash suffix), each with the source's town, then the
// combined query. Every variant is source-owned text; nothing is invented.
function buildEventVenueQueries(event, { placeContext = null } = {}) {
  const combined = buildEventVenueQuery(event, { placeContext });
  if (!combined) return [];
  const country = uniqueStrings([event.country])[0];
  // Only an explicit source city counts as the town; `area` often carries the
  // venue or a neighbourhood. Without one, the place context supplies it.
  const town = uniqueStrings([event.city])[0] || null;
  // The same context the combined query uses; without any, a bare street or
  // venue name could match anywhere, so only the combined query is tried.
  const contextParts = country ? [country] : town
    ? [placeContext?.region, placeContext?.country]
    : [placeContext?.locality, placeContext?.municipality, placeContext?.region, placeContext?.country];
  const hasContext = Boolean(town) || uniqueStrings(contextParts).length > 0;
  const variant = (head) => {
    if (!head || !hasContext) return null;
    const townPart = town && !head.toLocaleLowerCase("en").includes(town.toLocaleLowerCase("en")) ? [town] : [];
    return appendBoundedQueryParts([head, ...townPart], contextParts);
  };
  const name = uniqueStrings([event.place_context])[0];
  const shortName = name && /\s[–—-]\s/.test(name) ? name.split(/\s[–—-]\s/)[0].trim() : null;
  return uniqueStrings([
    variant(uniqueStrings([event.address])[0]),
    variant(name),
    shortName && shortName.split(/\s+/).length >= 2 ? variant(shortName) : null,
    combined,
  ]);
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
    const queries = buildEventVenueQueries(event, { placeContext });
    let resolution = null;
    let resolvedQuery = null;
    for (const query of queries) {
      if (attempts >= cap && !resolutions.has(query)) break;
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
      resolution = await resolutions.get(query);
      resolvedQuery = query;
      // Found but outside the trusted area: another spelling of the same venue
      // cannot change that, so stop spending lookups. Several matches may still
      // narrow to one with the more specific variants that follow.
      if (["resolved", "outside_scope"].includes(resolution.status)) break;
    }
    if (!resolution) {
      output.push(event);
      continue;
    }
    const queryBasis = event.address && resolvedQuery?.startsWith(event.address.trim()) ? "source_address" : "source_venue";
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
          query_basis: queryBasis,
          geometry_scope: regionalScope ? "resolver_attested_region" : "anchor_radius",
        },
      });
      continue;
    }
    if (resolution.status === "outside_scope") resolution = { ...resolution, status: "not_found" };
    if (resolution.status === "ambiguous") summary.ambiguous_count += 1;
    else if (resolution.status === "failed") summary.failed_count += 1;
    else summary.not_found_count += 1;
    output.push({
      ...event,
      venue_resolution: {
        status: resolution.status,
        source: "trusted_place_resolver",
        query_basis: queryBasis,
        geometry_scope: regionalScope ? "resolver_attested_region" : "anchor_radius",
      },
    });
  }

  return { events: output, summary };
}

async function resolveVenueQuery(query, { resolver, anchor, radiusKm, regionalScope }) {
  try {
    const candidates = await resolver(query, { purpose: "event_venue" });
    const confident = (Array.isArray(candidates) ? candidates : [])
      .filter(hasCoordinates)
      .filter((candidate) => confidenceRank(candidate.confidence) >= confidenceRank("medium"));
    const trusted = confident
      .filter((candidate) => regionalScope
        ? pointWithinTrustedSpatialScope(candidate, regionalScope)
        : haversineKm(anchor, candidate) <= radiusKm);
    if (trusted.length === 1) return { status: "resolved", candidate: trusted[0] };
    if (trusted.length > 1) return { status: "ambiguous", candidate: null };
    if (confident.length) return { status: "outside_scope", candidate: null };
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
  buildEventVenueQueries,
  buildEventVenueQuery,
  resolveEventVenueGeometry,
};
