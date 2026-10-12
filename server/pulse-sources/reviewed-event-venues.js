"use strict";

/**
 * Reviewed venue geometry for sources that publish an address but no point.
 *
 * Library calendars and similar sources name a fixed set of venues by street
 * address. Each address is resolved once, offline, through a trusted
 * geocoder (`scripts/resolve-event-source-venues.js`), and only kept when the
 * result matches the source's own house number and postcode. The stored point
 * keeps the geocoder's provenance, licence and attribution; it never claims to
 * be source-owned geometry.
 *
 * The registry is server-owned config, never request input. A missing or
 * malformed file is an empty registry.
 */

const fs = require("node:fs");
const path = require("node:path");

const REGISTRY_SCHEMA = "parranda.reviewed_event_venues.v1";
const DEFAULT_REGISTRY_PATH = path.resolve(__dirname, "../../config/reviewed-event-venues.json");
const MAX_REGISTRY_BYTES = 2 * 1024 * 1024;
const REGISTRY_SOURCE = "reviewed_venue_registry";

const cache = new Map();

function normalizeVenuePart(value) {
  if (value == null) return "";
  return String(value).normalize("NFC").trim().toLocaleLowerCase("en").replace(/[\s,.]+/g, " ").trim();
}

/** A venue's identity is its published address: country, postcode, street. */
function venueRegistryKey({ country, postal_code: postalCode, street } = {}) {
  const parts = [normalizeVenuePart(country), normalizeVenuePart(postalCode), normalizeVenuePart(street)];
  return parts.every(Boolean) ? parts.join("|") : null;
}

function validEntry(entry) {
  if (!entry || typeof entry !== "object") return null;
  const key = venueRegistryKey(entry);
  const lat = Number(entry.lat);
  const lng = Number(entry.lng);
  if (!key || !Number.isFinite(lat) || !Number.isFinite(lng) ||
      Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  if (typeof entry.geometry_source !== "string" || typeof entry.license !== "string" ||
      typeof entry.attribution !== "string") return null;
  return {
    key,
    lat,
    lng,
    geometry_source: entry.geometry_source,
    license: entry.license,
    attribution: entry.attribution,
    osm_ref: typeof entry.osm_ref === "string" ? entry.osm_ref : null,
    match: typeof entry.match === "string" ? entry.match : null,
    resolved_at: typeof entry.resolved_at === "string" ? entry.resolved_at : null,
  };
}

function buildVenueRegistry(document) {
  const rows = document && document.schema === REGISTRY_SCHEMA && Array.isArray(document.venues)
    ? document.venues : [];
  const registry = new Map();
  for (const row of rows) {
    const entry = validEntry(row);
    if (entry && !registry.has(entry.key)) registry.set(entry.key, entry);
  }
  return registry;
}

function loadReviewedVenueRegistry(filePath = DEFAULT_REGISTRY_PATH) {
  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch (_error) {
    return new Map();
  }
  if (!stat.isFile() || stat.size > MAX_REGISTRY_BYTES) return new Map();
  const cached = cache.get(filePath);
  if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) return cached.registry;
  let registry;
  try {
    registry = buildVenueRegistry(JSON.parse(fs.readFileSync(filePath, "utf8")));
  } catch (_error) {
    registry = new Map();
  }
  cache.set(filePath, { mtimeMs: stat.mtimeMs, size: stat.size, registry });
  return registry;
}

function lookupReviewedVenue(registry, address) {
  if (!(registry instanceof Map) || registry.size === 0) return null;
  const key = venueRegistryKey(address);
  return key ? registry.get(key) || null : null;
}

/** Geometry attribution carried with an event whose point came from the registry. */
function reviewedVenueResolution(entry) {
  return {
    status: "resolved",
    source: REGISTRY_SOURCE,
    provenance: entry.geometry_source,
    license: entry.license,
    attribution: entry.attribution,
    osm_ref: entry.osm_ref,
    match: entry.match,
    resolved_at: entry.resolved_at,
    query_basis: "source_address",
  };
}

/**
 * Keep only a registry resolution the mapped provider produced. Anything else
 * a provider might attach is dropped, so a row cannot claim resolved geometry.
 */
function trustedReviewedVenueResolution(value) {
  if (!value || typeof value !== "object" || value.source !== REGISTRY_SOURCE || value.status !== "resolved") return null;
  if (typeof value.license !== "string" || typeof value.attribution !== "string") return null;
  return {
    status: "resolved",
    source: REGISTRY_SOURCE,
    provenance: typeof value.provenance === "string" ? value.provenance : null,
    license: value.license,
    attribution: value.attribution,
    osm_ref: typeof value.osm_ref === "string" ? value.osm_ref : null,
    match: typeof value.match === "string" ? value.match : null,
    resolved_at: typeof value.resolved_at === "string" ? value.resolved_at : null,
    query_basis: "source_address",
  };
}

module.exports = {
  DEFAULT_REGISTRY_PATH,
  REGISTRY_SCHEMA,
  buildVenueRegistry,
  loadReviewedVenueRegistry,
  lookupReviewedVenue,
  reviewedVenueResolution,
  trustedReviewedVenueResolution,
  venueRegistryKey,
};
