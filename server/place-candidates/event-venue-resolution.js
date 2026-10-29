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
  const address = uniqueStrings([event.address])[0];
  // A card can retain a full display label while independently publishing its
  // address. Only that exact comma-delimited source field establishes a literal
  // venue prefix; arbitrary commas or partial street-number matches do not.
  const addressMarker = address ? `, ${address}` : null;
  const addressIndex = name && addressMarker ? name.indexOf(addressMarker) : -1;
  const afterAddress = addressIndex > 0 ? name.slice(addressIndex + addressMarker.length) : null;
  const sourceName = addressIndex > 0 && (afterAddress === "" || afterAddress.startsWith(",")) ? name.slice(0, addressIndex) : null;
  const shortName = name && /\s[–—-]\s/.test(name) ? name.split(/\s[–—-]\s/)[0].trim() : null;
  return uniqueStrings([
    sourceName && variant(sourceName),
    variant(address),
    variant(name),
    shortName && shortName.split(/\s+/).length >= 2 ? variant(shortName) : null,
    combined,
  ]);
}

// A bare kind of place ("teatro", "museum") names no particular venue.
const GENERIC_VENUE_NAMES = new Set([
  "teatro", "theatre", "theater", "teater", "teatr", "museum", "museo", "musee", "museu", "muzeum",
  "kino", "cinema", "biograf", "bibliothek", "biblioteca", "bibliotek", "library", "biblioteka",
  "kirche", "chiesa", "kyrka", "church", "eglise", "iglesia", "kosciol", "park", "parco", "parque",
  "piazza", "plaza", "square", "arena", "stadium", "stadion", "hall", "sala", "aula", "galleria",
  "gallery", "galerie", "castle", "castello", "schloss", "centrum", "center", "centre", "club",
  "auditorium", "markt", "market", "mercato", "mercado", "online",
]);

function isDistinctiveVenueName(value) {
  return typeof value === "string" && value.length >= 5 && !GENERIC_VENUE_NAMES.has(value);
}

// Venue names are compared whole after folding case, accents and punctuation.
function normalizeVenueName(value) {
  return typeof value === "string"
    ? value.normalize("NFKD").replace(/\p{M}/gu, "").toLocaleLowerCase("en")
      .replace(/[^\p{L}\p{N}]+/gu, " ").trim()
    : "";
}

function venueNameVariants(event) {
  const name = typeof event?.place_context === "string" ? event.place_context.trim() : "";
  if (!name) return [];
  const variants = [name];
  if (/\s[–—-]\s/.test(name)) variants.push(name.split(/\s[–—-]\s/)[0]);
  return [...new Set(variants.map(normalizeVenueName).filter(isDistinctiveVenueName))];
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
  const work = rows.map(event => ({
    event,
    queries: !event || typeof event !== "object" || hasCoordinates(event)
      ? [] : buildEventVenueQueries(event, { placeContext }),
    resolution: null,
    resolvedQuery: null,
  }));
  const rounds = Math.max(0, ...work.map(item => item.queries.length));

  // Give the next venue its first attempt before spending the whole shared
  // budget on alternate spellings of one difficult venue. Duplicate queries
  // still share an answer, including when the unique-call cap is exhausted.
  for (let round = 0; round < rounds; round += 1) {
    for (const item of work) {
      if (["resolved", "outside_scope"].includes(item.resolution?.status)) continue;
      const query = item.queries[round];
      if (!query || (attempts >= cap && !resolutions.has(query))) continue;
      if (!resolutions.has(query)) {
        attempts += 1;
        summary.attempted_count += 1;
        // Share the provider answer, not a name-verification verdict belonging
        // to another event at the same textual address.
        resolutions.set(query, Promise.resolve().then(() => resolver(query, { purpose: "event_venue" })));
      }
      item.resolution = await resolveVenueQuery(query, {
        resolver: () => resolutions.get(query),
        anchor,
        radiusKm,
        regionalScope,
        venueNames: venueNameVariants(item.event),
      });
      item.resolvedQuery = query;
    }
  }

  for (const item of work) {
    const { event, resolvedQuery } = item;
    let { resolution } = item;
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
          ...(resolution.candidate.name_verified ? { name_verified: true } : {}),
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

async function resolveVenueQuery(query, { resolver, anchor, radiusKm, regionalScope, venueNames = [] }) {
  try {
    const candidates = await resolver(query, { purpose: "event_venue" });
    const located = (Array.isArray(candidates) ? candidates : []).filter(hasCoordinates);
    const inArea = (candidate) => regionalScope
      ? pointWithinTrustedSpatialScope(candidate, regionalScope)
      : haversineKm(anchor, candidate) <= radiusKm;
    const confident = located.filter((candidate) => confidenceRank(candidate.confidence) >= confidenceRank("medium"));
    const trusted = confident.filter(inArea);
    if (trusted.length === 1) return { status: "resolved", candidate: trusted[0] };
    if (trusted.length > 1) return { status: "ambiguous", candidate: null };
    if (confident.length) return { status: "outside_scope", candidate: null };
    // A small venue is "low" only because the geocoder ranks it as little
    // known. When the one place found in the area carries the very name the
    // event source gives, that name is the evidence; nothing else is.
    const nameMatched = located.filter((candidate) =>
      confidenceRank(candidate.confidence) === confidenceRank("low") && placeNamedAs(candidate, venueNames));
    const named = nameMatched.filter(inArea);
    if (named.length === 1) return { status: "resolved", candidate: { ...named[0], name_verified: true } };
    if (named.length > 1) return { status: "ambiguous", candidate: null };
    if (nameMatched.length) return { status: "outside_scope", candidate: null };
    return { status: "not_found", candidate: null };
  } catch (_error) {
    return { status: "failed", candidate: null };
  }
}

// The resolved place's own name (first label segment) equals the source's
// venue name, or appears in it as whole words ("biograf panora" ⊇ "panora").
function placeNamedAs(candidate, venueNames) {
  const own = normalizeVenueName(String(candidate?.name || candidate?.label || "").split(",")[0]);
  if (!isDistinctiveVenueName(own)) return false;
  return (Array.isArray(venueNames) ? venueNames : []).some((venue) =>
    venue === own || ` ${venue} `.includes(` ${own} `));
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
