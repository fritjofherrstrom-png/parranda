"use strict";

const { createHash } = require("node:crypto");
const { createSourceCache } = require("./source-cache");
const {
  resolveReviewedPlaceSourceProfileFeeds,
} = require("./reviewed-place-source-profile");

const ENABLE_ENV_KEY = "PARRANDA_REVIEWED_PLACE_SOURCES";
const DEFAULT_TIMEOUT_MS = 8_000;
const DEFAULT_MAX_BYTES = 1024 * 1024;
const DEFAULT_RADIUS_KM = 5;
const DEFAULT_USER_AGENT = "Parranda/1.0 (+https://github.com/fritjofherrstrom-png/parranda)";
const MAX_JSON_LD_NODES = 500;
const MAX_RUNTIME_RECORDS = 100;

// Deliberately closed: generic Organization/LocalBusiness/Product records are
// not place ideas. Every accepted schema type has an existing Parranda type.
const PLACE_TYPE_MAP = Object.freeze({
  museum: "museum",
  artgallery: "gallery",
  park: "park",
  garden: "garden",
  botanicalgarden: "garden",
  restaurant: "restaurant",
  foodestablishment: "restaurant",
  cafeorcoffeeshop: "cafe",
  barorpub: "bar",
  beach: "beach",
  touristattraction: "landmark",
  landmarksorhistoricalbuildings: "landmark",
});

function createReviewedPlaceSource({
  sourceCatalog = null,
  env = process.env,
  fetcher = typeof globalThis.fetch === "function" ? globalThis.fetch.bind(globalThis) : null,
  cache = createSourceCache({
    namespace: "reviewed-place-sources-v1",
    dir: env?.PARRANDA_CACHE_DIR || null,
    ttlMs: positiveInteger(env?.PARRANDA_SOURCE_CACHE_TTL_MS) || undefined,
  }),
  now = () => new Date(),
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxBytes = DEFAULT_MAX_BYTES,
} = {}) {
  if (typeof fetcher !== "function") return null;

  return {
    async load(anchor = {}) {
      if (!validAnchor(anchor)) return [];
      const at = normalizeDate(now());
      if (!at) return [];
      const direct = resolveReviewedPlaceSourceProfileFeeds(env, { now: at });
      const catalogFeeds = typeof sourceCatalog?.listApprovedPlaceFeedsForAnchor === "function"
        ? await Promise.resolve(sourceCatalog.listApprovedPlaceFeedsForAnchor({ anchor, now: at })).catch(() => [])
        : [];
      const feeds = dedupeFeeds([...direct, ...(Array.isArray(catalogFeeds) ? catalogFeeds : [])]);
      const records = [];
      for (const feed of feeds) {
        if (records.length >= MAX_RUNTIME_RECORDS) break;
        const key = cacheKey(feed);
        const cached = cache.peek(key);
        if (cached && Array.isArray(cached.records)) {
          const perFeed = filterRecordsForAnchor(cached.records, anchor, feed.bbox)
            .slice(0, boundedInteger(feed.max_items, 1, 100));
          records.push(...perFeed.slice(0, MAX_RUNTIME_RECORDS - records.length));
          continue;
        }
        cache.warm(
          key,
          () => collectReviewedPlaceFeedOutcome(feed, { fetcher, timeoutMs, maxBytes }),
          { shouldStore: (value) => value?.status === "ok" || value?.status === "empty" },
        );
      }
      return records;
    },
  };
}

function resolveDefaultReviewedPlaceSource(env = process.env, options = {}) {
  if (!enabled(env?.[ENABLE_ENV_KEY])) return null;
  const direct = String(env?.PARRANDA_REVIEWED_PLACE_SOURCE_PROFILES || "").trim();
  if (!direct && !options.sourceCatalog) return null;
  return createReviewedPlaceSource({ env, ...options });
}

async function collectReviewedPlaceFeed(feed, options = {}) {
  const outcome = await collectReviewedPlaceFeedOutcome(feed, options);
  return outcome.records;
}

async function collectReviewedPlaceFeedOutcome(feed, {
  fetcher = typeof globalThis.fetch === "function" ? globalThis.fetch.bind(globalThis) : null,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxBytes = DEFAULT_MAX_BYTES,
} = {}) {
  if (!validFeed(feed) || typeof fetcher !== "function") return failed();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), boundedInteger(timeoutMs, 50, 30_000));
  try {
    const response = await fetcher(feed.endpoint, {
      headers: {
        "User-Agent": DEFAULT_USER_AGENT,
        Accept: feed.adapter === "schema_org_place_json"
          ? "application/ld+json, application/json"
          : "text/html, application/xhtml+xml",
      },
      // The reviewed endpoint is exact. Do not let it turn one approved fetch
      // into a request to an unreviewed host through an HTTP redirect.
      redirect: "error",
      signal: controller.signal,
    });
    if (!response || response.ok !== true) return failed();
    if (!sameOriginResponse(feed.endpoint, response)) return failed();
    const raw = await readBoundedText(response, boundedInteger(maxBytes, 1024, 4 * 1024 * 1024));
    if (!raw) return failed();

    let nodes;
    if (feed.adapter === "schema_org_place_json") {
      try {
        nodes = extractSchemaOrgPlaces(JSON.parse(raw));
      } catch (_error) {
        return failed();
      }
    } else {
      const parsed = parseSchemaOrgPlacesFromHtml(raw);
      if (!parsed.validScriptCount && parsed.invalidScriptCount) return failed();
      nodes = parsed.places;
    }
    const records = nodes
      .map((place) => mapSchemaOrgPlaceToRecord(place, feed))
      .filter(Boolean)
      .filter((record) => pointInBounds(record, feed.bbox))
      .slice(0, boundedInteger(feed.max_items, 1, 100));
    return { status: records.length ? "ok" : "empty", records };
  } catch (_error) {
    return failed();
  } finally {
    clearTimeout(timer);
  }
}

function extractSchemaOrgPlaces(payload) {
  const queue = [payload];
  const places = [];
  let visited = 0;
  while (queue.length && visited < MAX_JSON_LD_NODES) {
    const value = queue.shift();
    visited += 1;
    if (Array.isArray(value)) {
      queue.push(...value.slice(0, MAX_JSON_LD_NODES - visited));
      continue;
    }
    if (!value || typeof value !== "object") continue;
    if (placeType(value)) places.push(value);
    for (const key of ["@graph", "items", "itemListElement"]) {
      if (Array.isArray(value[key])) {
        queue.push(...value[key].slice(0, Math.max(0, MAX_JSON_LD_NODES - visited - queue.length)));
      }
    }
    if (value.item && typeof value.item === "object") queue.push(value.item);
  }
  return places.slice(0, MAX_JSON_LD_NODES);
}

function parseSchemaOrgPlacesFromHtml(html) {
  const places = [];
  let validScriptCount = 0;
  let invalidScriptCount = 0;
  const scriptPattern = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
  let match;
  while ((match = scriptPattern.exec(String(html || ""))) !== null) {
    if (!isJsonLdScript(match[1])) continue;
    const body = String(match[2] || "")
      .replace(/^\s*<!--/, "")
      .replace(/-->\s*$/, "")
      .trim();
    if (!body) continue;
    try {
      places.push(...extractSchemaOrgPlaces(JSON.parse(body)));
      validScriptCount += 1;
    } catch (_error) {
      invalidScriptCount += 1;
    }
  }
  return { places, validScriptCount, invalidScriptCount };
}

function mapSchemaOrgPlaceToRecord(place, feed) {
  const type = placeType(place);
  const name = localizedString(place?.name);
  const coords = extractCoordinates(place);
  if (!type || !name || !coords) return null;
  const stableIdentity = boundedString(firstString(place.url, place["@id"], place.identifier), 2048);
  if (!stableIdentity) return null;
  const website = safeHttpUrl(firstString(place.url, place["@id"]));
  const openingHours = firstString(place.openingHours);
  const digest = createHash("sha256")
    .update(`${feed.id}|${stableIdentity}`)
    .digest("hex")
    .slice(0, 20);
  return compact({
    id: `reviewed-place:${feed.id}:${digest}`,
    name: boundedString(name, 160),
    type,
    lat: coords.lat,
    lng: coords.lng,
    website,
    opening_hours: boundedString(openingHours, 512),
    freshness: "fresh",
    operator_reviewed_source: true,
    source_policy: "reviewed_profile_bounded_refresh",
    sources: [{
      provider: feed.id,
      label: feed.label,
      family: feed.evidence_family,
      tier: feed.source_tier,
      url: website || feed.endpoint,
      license: feed.license || undefined,
      freshness: "fresh",
    }],
  });
}

function filterRecordsForAnchor(records, anchor, bbox) {
  return records.filter((record) =>
    pointInBounds(record, bbox) &&
    haversineKm(anchor.lat, anchor.lng, record.lat, record.lng) <= DEFAULT_RADIUS_KM,
  );
}

function pointInBounds(point, bbox) {
  if (!Array.isArray(bbox) || bbox.length !== 4 || !validAnchor(point)) return false;
  const [west, south, east, north] = bbox;
  return point.lng >= west && point.lng <= east && point.lat >= south && point.lat <= north;
}

function placeType(place) {
  const values = Array.isArray(place?.["@type"])
    ? place["@type"]
    : [place?.["@type"] || place?.type];
  for (const value of values) {
    const key = String(value || "").split(/[\/#:]/).pop().replace(/[^a-z]/gi, "").toLowerCase();
    if (PLACE_TYPE_MAP[key]) return PLACE_TYPE_MAP[key];
  }
  return null;
}

function extractCoordinates(place) {
  const geo = place?.geo || place?.location?.geo;
  const lat = finiteCoordinate(geo?.latitude ?? geo?.lat, -90, 90);
  const lng = finiteCoordinate(geo?.longitude ?? geo?.lng ?? geo?.lon, -180, 180);
  return lat == null || lng == null ? null : { lat, lng };
}

function isJsonLdScript(attributes) {
  const match = String(attributes || "").match(/\btype\s*=\s*(?:(["'])(.*?)\1|([^\s>]+))/i);
  const value = String(match?.[2] || match?.[3] || "").trim().toLowerCase();
  return value.split(";")[0].trim() === "application/ld+json";
}

function sameOriginResponse(endpoint, response) {
  if (!response.url) return response.redirected !== true;
  try {
    return new URL(endpoint).origin === new URL(response.url).origin;
  } catch (_error) {
    return false;
  }
}

async function readBoundedText(response, maxBytes) {
  if (response?.body && typeof response.body.getReader === "function") {
    const reader = response.body.getReader();
    const chunks = [];
    let bytes = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = value instanceof Uint8Array ? value : new Uint8Array(value || []);
        bytes += chunk.byteLength;
        if (bytes > maxBytes) {
          await Promise.resolve(reader.cancel()).catch(() => {});
          return null;
        }
        chunks.push(chunk);
      }
    } catch (_error) {
      return null;
    }
    const joined = new Uint8Array(bytes);
    let offset = 0;
    for (const chunk of chunks) {
      joined.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return new TextDecoder("utf-8", { fatal: true }).decode(joined).trim() || null;
  }
  if (typeof response?.text !== "function") return null;
  const text = await response.text();
  return Buffer.byteLength(text, "utf8") <= maxBytes ? text : null;
}

function validFeed(feed) {
  const bbox = Array.isArray(feed?.bbox) ? feed.bbox : [];
  const validBounds = bbox.length === 4 &&
    bbox.every(Number.isFinite) &&
    bbox[0] >= -180 && bbox[2] <= 180 && bbox[1] >= -90 && bbox[3] <= 90 &&
    bbox[0] <= bbox[2] && bbox[1] <= bbox[3];
  return Boolean(
    feed &&
    typeof feed === "object" &&
    ["schema_org_place_html", "schema_org_place_json"].includes(feed.adapter) &&
    safeHttpsUrl(feed.endpoint) &&
    validBounds &&
    ["official", "editorial"].includes(feed.evidence_family),
  );
}

function dedupeFeeds(feeds) {
  const seen = new Set();
  return (Array.isArray(feeds) ? feeds : []).filter((feed) => {
    if (!validFeed(feed)) return false;
    const key = `${feed.id}|${feed.endpoint}`.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function cacheKey(feed) {
  return createHash("sha256")
    .update(JSON.stringify({
      id: feed.id,
      endpoint: feed.endpoint,
      adapter: feed.adapter,
      bbox: feed.bbox,
      evidence_family: feed.evidence_family,
      source_tier: feed.source_tier,
      max_items: feed.max_items,
      profile_reviewed_at: feed.profile_reviewed_at || "reviewed",
    }))
    .digest("hex");
}

function validAnchor(value) {
  return finiteCoordinate(value?.lat, -90, 90) != null && finiteCoordinate(value?.lng, -180, 180) != null;
}

function finiteCoordinate(value, min, max) {
  const number = Number(value);
  return Number.isFinite(number) && number >= min && number <= max ? number : null;
}

function boundedInteger(value, min, max) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, Math.floor(number))) : min;
}

function positiveInteger(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : null;
}

function boundedString(value, max) {
  const text = typeof value === "string" ? value.trim() : "";
  return text && text.length <= max ? text : null;
}

function localizedString(value, depth = 0) {
  if (depth > 4) return null;
  if (typeof value === "string") return value.trim() || null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const text = localizedString(item, depth + 1);
      if (text) return text;
    }
  } else if (value && typeof value === "object") {
    if (typeof value["@value"] === "string") return value["@value"].trim() || null;
    for (const item of Object.values(value)) {
      const text = localizedString(item, depth + 1);
      if (text) return text;
    }
  }
  return null;
}

function firstString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function safeHttpUrl(value) {
  try {
    const url = new URL(firstString(value));
    return ["http:", "https:"].includes(url.protocol) ? url.toString() : null;
  } catch (_error) {
    return null;
  }
}

function safeHttpsUrl(value) {
  const url = safeHttpUrl(value);
  return url && new URL(url).protocol === "https:" ? url : null;
}

function normalizeDate(value) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function haversineKm(lat1, lng1, lat2, lng2) {
  const toRad = (degrees) => (degrees * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function failed() {
  return { status: "failed", records: [] };
}

function enabled(value) {
  return ["enabled", "1", "true", "on", "yes"].includes(String(value || "").trim().toLowerCase());
}

function compact(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item != null));
}

module.exports = {
  ENABLE_ENV_KEY,
  PLACE_TYPE_MAP,
  collectReviewedPlaceFeed,
  createReviewedPlaceSource,
  extractSchemaOrgPlaces,
  mapSchemaOrgPlaceToRecord,
  parseSchemaOrgPlacesFromHtml,
  resolveDefaultReviewedPlaceSource,
};
