"use strict";

const { createHash } = require("node:crypto");
const { normalizeName } = require("../candidates/entity-resolution");
const { normalizeSourceWebsite } = require("../lib/source-website");
const { PLACE_TYPE_MAP, parseJsonLdPayloadsFromHtml } = require("./schema-org-place-source");
const { normalizeSchemaOrgOpeningHours } = require("./schema-org-opening-hours");

const TYPES = new Set([...Object.keys(PLACE_TYPE_MAP), "localbusiness", "store"]);

function selectedPlaceHoursKey(record) {
  return createHash("sha256").update(JSON.stringify([
    record.id, record.website, record.name, record.type, record.lat, record.lng,
  ])).digest("hex");
}

function identityUrl(value) {
  const normalized = normalizeSourceWebsite(value);
  if (!normalized) return null;
  const url = new URL(normalized);
  if (url.port || url.search) return null;
  // The shared safe transport upgrades source-owned HTTP websites to HTTPS.
  // Normalize the identity the same way; this never permits an HTTP request.
  url.protocol = "https:";
  url.hash = "";
  return url;
}

function sameSite(left, right) {
  return left && right && left.hostname.replace(/^www\./, "") === right.hostname.replace(/^www\./, "") &&
    left.pathname === right.pathname;
}

function selectedPlaceHoursSourceMatches(record, url) {
  return Boolean(sameSite(identityUrl(record?.website), identityUrl(url)));
}

function schemaContext(value) {
  if (typeof value === "string") return /^https?:\/\/schema\.org\/?$/.test(value);
  return value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === 1 &&
    typeof value["@vocab"] === "string" && /^https?:\/\/schema\.org\/?$/.test(value["@vocab"]);
}

/** Existing selected identity only: no place discovery, review or corroboration. */
function parseSelectedPlaceHours(html, record, sourceUrl) {
  const source = identityUrl(sourceUrl);
  const original = identityUrl(record?.website);
  if (!sameSite(source, original) || !validPoint(record?.lat, record?.lng)) return null;
  const parsed = parseJsonLdPayloadsFromHtml(html);
  if (parsed.invalidScriptCount || !parsed.validScriptCount) return null;
  const queue = [...parsed.payloads];
  const entities = [];
  let visited = 0;
  while (queue.length && visited++ < 500) {
    const value = queue.shift();
    if (Array.isArray(value)) { queue.push(...value.slice(0, 500)); continue; }
    if (!value || typeof value !== "object") continue;
    if (Object.prototype.hasOwnProperty.call(value, "@context") && !schemaContext(value["@context"])) return null;
    const types = (Array.isArray(value["@type"]) ? value["@type"] : [value["@type"]])
      .map(type => typeof type === "string" ? type.replace(/^https?:\/\/schema\.org\//, "").toLowerCase() : "");
    if (types.some(type => TYPES.has(type))) {
      if (!types.every(type => TYPES.has(type))) return null;
      entities.push(value);
    }
    queue.push(...Object.values(value).filter(item => item && typeof item === "object"));
    if (queue.length > 500) return null;
  }
  if (queue.length || entities.length !== 1) return null;
  const place = entities[0];
  if (typeof place.name !== "string" || !normalizeName(record.name) || normalizeName(place.name) !== normalizeName(record.name)) return null;
  const identities = [place.url, place["@id"]].filter(value => value !== undefined);
  if (!identities.length || identities.some(value => !sameSite(identityUrl(value), source))) return null;
  const geo = place.geo;
  if (!geo || typeof geo !== "object" || Array.isArray(geo)) return null;
  const lat = coordinate(geo.latitude), lng = coordinate(geo.longitude);
  if (!validPoint(lat, lng) || distanceM(record.lat, record.lng, lat, lng) > 25) return null;
  const openingHours = normalizeSchemaOrgOpeningHours(place);
  return openingHours ? { opening_hours: openingHours, url: source.toString() } : null;
}

function coordinate(value) {
  if (typeof value !== "number" && (typeof value !== "string" || !/^-?\d+(?:\.\d+)?$/.test(value))) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function validPoint(lat, lng) {
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
}

function distanceM(lat, lng, otherLat, otherLng) {
  const radians = value => value * Math.PI / 180;
  const a = Math.sin(radians(otherLat - lat) / 2) ** 2 + Math.cos(radians(lat)) * Math.cos(radians(otherLat)) * Math.sin(radians(otherLng - lng) / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

module.exports = { parseSelectedPlaceHours, selectedPlaceHoursKey, selectedPlaceHoursSourceMatches };
