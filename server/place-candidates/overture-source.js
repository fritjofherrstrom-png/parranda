"use strict";

/**
 * Overture Places source — bounded global place supply for cold locations.
 *
 * OSM/Overpass remains useful, but a single public Overpass instance is not a
 * dependable worldwide candidate backend. Overture publishes a monthly global
 * GeoParquet place catalog with stable ids, coordinates, categories, websites,
 * source provenance and an existence-confidence signal. This adapter reads a
 * small bounding box directly from the public release with DuckDB, maps only
 * travel-relevant categories into Parranda's existing vocabulary, and emits one
 * honest `open_directory` evidence family. The providers aggregated inside an
 * Overture record are deliberately NOT counted as independent Parranda sources.
 *
 * Runtime posture:
 *   - env-gated by the loader factory;
 *   - cache-warmed outside the route request path;
 *   - hard radius, confidence, row and output caps;
 *   - no review scores, free-text descriptions or raw provider payloads;
 *   - fail closed on STAC, DuckDB, S3, schema or mapping errors;
 *   - injectable release/query seams keep tests deterministic and offline.
 */

const nodeFs = require("node:fs");
const nodePath = require("node:path");
const { normalizeUserIntents, matchCandidateToIntent } = require("../candidates/intent-vocabulary");

const OVERTURE_STAC_ROOT = "https://stac.overturemaps.org/";
const OVERTURE_ATTRIBUTION_URL = "https://overturemaps.org/";
const OVERTURE_S3_ROOT = "s3://overturemaps-us-west-2/release";
const DEFAULT_RADIUS_KM = 5;
const MAX_RADIUS_KM = 5;
const DEFAULT_LIMIT = 80;
const MAX_LIMIT = 100;
const QUERY_ROW_LIMIT = 600;
// Overture documents this as an existence-quality signal, not a review score.
// Field QA at 0.90 admitted a geographically wrong attraction record (0.926)
// into Ljubljana. A 0.95 floor keeps the broad directory useful while failing
// closed on that measured tail; it still never becomes ranking/popularity.
const DEFAULT_MIN_CONFIDENCE = 0.95;
const DEFAULT_STAC_TIMEOUT_MS = 5000;
const RELEASE_PATTERN = /^\d{4}-\d{2}-\d{2}\.\d+$/;

// Broad enough for SQL pushdown, while the exact mapper below remains the
// authority. Keeping this in the query avoids downloading hundreds of nearby
// pharmacies, offices and generic shops only to discard them in JavaScript.
const TRAVEL_CATEGORY_SQL_PATTERN = [
  "restaurant", "cafe", "coffee", "bakery", "tea_room", "ice_cream", "dessert",
  "bar", "pub", "nightclub", "beer_garden", "brewery", "winery", "distillery",
  "museum", "gallery", "arts_centre", "arts_center",
  "park", "garden", "nature_reserve", "national_park", "viewpoint", "lookout",
  "observation", "promenade", "marina", "pier", "castle", "fort", "historic_site",
  "monument", "lighthouse", "beach", "swimming", "market", "farm", "antique",
  "vintage", "thrift", "second_hand", "charity_shop",
].join("|");

const EXACT_TYPE_MAP = new Map([
  ["cafe", { type: "cafe", tags: ["fika"] }],
  ["coffee_shop", { type: "cafe", tags: ["fika", "coffee"] }],
  ["bakery", { type: "cafe", tags: ["fika"] }],
  ["tea_room", { type: "cafe", tags: ["fika"] }],
  ["ice_cream_shop", { type: "cafe", tags: ["fika"] }],
  ["dessert_shop", { type: "cafe", tags: ["fika"] }],
  ["bar", { type: "bar", tags: ["nattliv"] }],
  ["pub", { type: "bar", tags: ["nattliv"] }],
  ["nightclub", { type: "bar", tags: ["nattliv"] }],
  ["beer_garden", { type: "bar", tags: ["nattliv", "öl"] }],
  ["brewery", { type: "bar", tags: ["nattliv", "öl"] }],
  ["winery", { type: "bar", tags: ["vin"] }],
  ["distillery", { type: "bar", tags: ["lokalt"] }],
  ["museum", { type: "museum", tags: ["kultur", "museum"] }],
  ["art_museum", { type: "museum", tags: ["kultur", "museum"] }],
  ["modern_art_museum", { type: "museum", tags: ["kultur", "museum"] }],
  ["history_museum", { type: "museum", tags: ["kultur", "museum"] }],
  ["art_gallery", { type: "gallery", tags: ["kultur"] }],
  ["arts_centre", { type: "gallery", tags: ["kultur"] }],
  ["arts_center", { type: "gallery", tags: ["kultur"] }],
  ["park", { type: "park", tags: ["park", "green"] }],
  ["national_park", { type: "park", tags: ["park", "green", "nature"] }],
  ["nature_reserve", { type: "park", tags: ["park", "green", "nature"] }],
  ["garden", { type: "garden", tags: ["garden", "green"] }],
  ["botanical_garden", { type: "garden", tags: ["garden", "green"] }],
  ["viewpoint", { type: "viewpoint", tags: ["utsikt"] }],
  ["lookout", { type: "viewpoint", tags: ["utsikt"] }],
  ["observation_deck", { type: "viewpoint", tags: ["utsikt"] }],
  ["promenade", { type: "promenade", tags: ["waterfront"] }],
  ["marina", { type: "promenade", tags: ["waterfront", "coast"] }],
  ["pier", { type: "promenade", tags: ["waterfront", "coast"] }],
  ["castle", { type: "castle", tags: ["historic", "landmark"] }],
  ["fort", { type: "historic-site", tags: ["historic", "landmark"] }],
  ["fortress", { type: "historic-site", tags: ["historic", "landmark"] }],
  ["historic_site", { type: "historic-site", tags: ["historic", "landmark"] }],
  ["monument", { type: "monument", tags: ["historic", "landmark"] }],
  ["lighthouse", { type: "lighthouse", tags: ["historic", "coast"] }],
  ["beach", { type: "beach", tags: ["coast", "bathing"] }],
  ["swimming_area", { type: "beach", tags: ["bathing"] }],
  ["farmers_market", { type: "market", tags: ["market", "lokalt"] }],
  ["flea_market", { type: "market", tags: ["market", "loppis"] }],
  ["market", { type: "market", tags: ["market"] }],
  ["farm", { type: "market", tags: ["lokalt"] }],
  ["farm_shop", { type: "market", tags: ["market", "lokalt"] }],
  ["antique_store", { type: "vintage-shop", tags: ["vintage", "antique"] }],
  ["vintage_store", { type: "vintage-shop", tags: ["vintage", "second_hand"] }],
  ["thrift_store", { type: "vintage-shop", tags: ["second_hand"] }],
  ["second_hand_store", { type: "vintage-shop", tags: ["second_hand"] }],
  ["charity_shop", { type: "vintage-shop", tags: ["second_hand", "charity"] }],
]);

function clamp(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
}

function validCoordinate(lat, lng) {
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
}

function normalizeCategory(value) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function categoryMapping(primary, alternates = []) {
  const mapOne = (category) => {
    const exact = EXACT_TYPE_MAP.get(category);
    if (exact) return exact;
    // Restaurant taxonomies are intentionally open-ended (regional cuisines,
    // seafood, pancakes, farm-to-table…). The suffix is still category
    // evidence, not name inference.
    if (category.endsWith("_restaurant") || category === "restaurant") {
      return { type: "restaurant", tags: ["mat"] };
    }
    if (category.endsWith("_bar")) return { type: "bar", tags: ["nattliv"] };
    if (category.endsWith("_museum")) return { type: "museum", tags: ["kultur", "museum"] };
    if (category.endsWith("_market")) return { type: "market", tags: ["market"] };
    return null;
  };
  // Overture declares `primary` as the canonical category. It must win before
  // an alternate (for example restaurant + bakery) so Parranda does not turn a
  // pizzeria into a café merely because one secondary facet matched exactly.
  const primaryMapping = mapOne(normalizeCategory(primary));
  if (primaryMapping) return primaryMapping;
  for (const alternate of Array.isArray(alternates) ? alternates : []) {
    const alternateMapping = mapOne(normalizeCategory(alternate));
    if (alternateMapping) return alternateMapping;
  }
  return null;
}

function firstHttpUrl(values) {
  for (const value of Array.isArray(values) ? values : []) {
    try {
      const url = new URL(String(value || "").trim());
      if (url.protocol === "http:" || url.protocol === "https:") return url.toString();
    } catch (_error) {
      // Malformed source atoms are ignored, never repaired.
    }
  }
  return null;
}

function normalizeOperationalStatus(value) {
  const status = String(value || "").trim().toLowerCase();
  if (status.includes("closed")) {
    return { status: "inactive", reasons: ["overture_operating_status_closed"] };
  }
  if (status === "open" || status === "active") {
    return { status: "source_indicated_active", reasons: ["overture_operating_status_active"] };
  }
  return { status: "unknown", reasons: [] };
}

function mapOvertureRow(row, { minConfidence = DEFAULT_MIN_CONFIDENCE } = {}) {
  if (!row || typeof row !== "object") return null;
  const id = String(row.id || "").trim();
  const name = String(row.name || "").trim();
  if (row.lat === null || row.lat === undefined || row.lng === null || row.lng === undefined) return null;
  const lat = Number(row.lat);
  const lng = Number(row.lng);
  const confidence = Number(row.confidence);
  if (!/^[0-9a-f-]{20,64}$/i.test(id) || !name || !validCoordinate(lat, lng)) return null;
  if (!Number.isFinite(confidence) || confidence < minConfidence) return null;
  const operational = normalizeOperationalStatus(row.operating_status);
  if (operational.status === "inactive") return null;
  const mapping = categoryMapping(row.category, row.alternate);
  if (!mapping) return null;
  const brand = String(row.brand || "").trim() || null;
  const website = firstHttpUrl(row.websites);
  return {
    id: `overture-${id}`,
    name,
    type: mapping.type,
    lat,
    lng,
    tags: [...mapping.tags],
    sources: [{
      provider: "overture",
      family: "open_directory",
      tier: "inferred",
      url: OVERTURE_ATTRIBUTION_URL,
      license: "CDLA-Permissive-2.0",
    }],
    chain: Boolean(brand),
    brand,
    operational_status: operational.status,
    operational_reasons: operational.reasons,
    ...(website ? { website } : {}),
  };
}

function longitudeClause(lng, delta) {
  const min = lng - delta;
  const max = lng + delta;
  if (min < -180) return `(bbox.xmin >= ${(min + 360).toFixed(7)} OR bbox.xmin <= ${max.toFixed(7)})`;
  if (max > 180) return `(bbox.xmin >= ${min.toFixed(7)} OR bbox.xmin <= ${(max - 360).toFixed(7)})`;
  return `bbox.xmin BETWEEN ${min.toFixed(7)} AND ${max.toFixed(7)}`;
}

function buildOvertureQuery({ release, lat, lng, radiusKm = DEFAULT_RADIUS_KM, rowLimit = QUERY_ROW_LIMIT, minConfidence = DEFAULT_MIN_CONFIDENCE } = {}) {
  if (!RELEASE_PATTERN.test(String(release || "")) || !validCoordinate(lat, lng)) return null;
  const radius = clamp(radiusKm, 0.1, MAX_RADIUS_KM, DEFAULT_RADIUS_KM);
  const limit = Math.max(1, Math.min(Math.floor(Number(rowLimit) || QUERY_ROW_LIMIT), QUERY_ROW_LIMIT));
  const confidence = clamp(minConfidence, 0.5, 1, DEFAULT_MIN_CONFIDENCE);
  const latDelta = radius / 110.574;
  const lngDelta = radius / (111.32 * Math.max(0.01, Math.abs(Math.cos((lat * Math.PI) / 180))));
  const latMin = Math.max(-90, lat - latDelta);
  const latMax = Math.min(90, lat + latDelta);
  const path = `${OVERTURE_S3_ROOT}/${release}/theme=places/type=place/*`;
  return `SELECT id,
  names.primary AS name,
  categories.primary AS category,
  categories.alternate AS alternate,
  confidence,
  operating_status,
  websites,
  brand.names.primary AS brand,
  bbox.xmin AS lng,
  bbox.ymin AS lat
FROM read_parquet('${path}', hive_partitioning=1)
WHERE bbox.ymin BETWEEN ${latMin.toFixed(7)} AND ${latMax.toFixed(7)}
  AND ${longitudeClause(lng, lngDelta)}
  AND confidence >= ${confidence.toFixed(3)}
  AND (operating_status IS NULL OR lower(operating_status) NOT LIKE '%closed%')
  AND regexp_matches(lower(coalesce(categories.primary, '') || ' ' || coalesce(array_to_string(categories.alternate, ' '), '')), '${TRAVEL_CATEGORY_SQL_PATTERN}')
ORDER BY pow(bbox.ymin - ${lat.toFixed(7)}, 2) + pow((bbox.xmin - ${lng.toFixed(7)}) * ${Math.cos((lat * Math.PI) / 180).toFixed(7)}, 2)
LIMIT ${limit}`;
}

async function resolveLatestOvertureRelease({
  fetcher = typeof globalThis.fetch === "function" ? globalThis.fetch.bind(globalThis) : null,
  endpoint = OVERTURE_STAC_ROOT,
  timeoutMs = DEFAULT_STAC_TIMEOUT_MS,
} = {}) {
  if (typeof fetcher !== "function") return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(100, Math.floor(Number(timeoutMs) || DEFAULT_STAC_TIMEOUT_MS)));
  try {
    const response = await fetcher(endpoint, {
      headers: { Accept: "application/json", "User-Agent": "Parranda/1.0 (+https://github.com/fritjofherrstrom-png/parranda)" },
      signal: controller.signal,
    });
    if (!response || response.ok !== true) return null;
    const payload = await response.json();
    const direct = String(payload?.latest || "").trim();
    if (RELEASE_PATTERN.test(direct)) return direct;
    const latestLink = Array.isArray(payload?.links)
      ? payload.links.find((link) => link?.rel === "child" && link?.latest === true)
      : null;
    const match = String(latestLink?.href || "").match(/\/(\d{4}-\d{2}-\d{2}\.\d+)\/catalog\.json$/);
    return match && RELEASE_PATTERN.test(match[1]) ? match[1] : null;
  } catch (_error) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function createDuckDbQueryRows({ cacheDir = null } = {}) {
  let connectionPromise = null;
  async function connection() {
    if (!connectionPromise) {
      connectionPromise = (async () => {
        const { DuckDBInstance } = require("@duckdb/node-api");
        const instance = await DuckDBInstance.create(":memory:");
        const conn = await instance.connect();
        if (cacheDir) {
          const extensionDir = nodePath.join(cacheDir, "duckdb-extensions");
          try {
            nodeFs.mkdirSync(extensionDir, { recursive: true });
            await conn.run(`SET extension_directory='${extensionDir.replace(/'/g, "''")}'`);
          } catch (_error) {
            // A read-only deploy may still use DuckDB's default extension cache.
          }
        }
        await conn.run("INSTALL httpfs; LOAD httpfs; SET s3_region='us-west-2'");
        return conn;
      })().catch((error) => {
        connectionPromise = null;
        throw error;
      });
    }
    return connectionPromise;
  }
  return async function queryRows(sql) {
    if (typeof sql !== "string" || !sql) return [];
    const conn = await connection();
    const reader = await conn.runAndReadAll(sql);
    return reader.getRowObjectsJson();
  };
}

function distanceKm(a, b) {
  const toRadians = (value) => (value * Math.PI) / 180;
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);
  const deltaLat = lat2 - lat1;
  const deltaLng = toRadians(b.lng - a.lng);
  const h = Math.sin(deltaLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function selectRecords(records, { anchor, requestedIntents = [], limit = DEFAULT_LIMIT } = {}) {
  const intents = normalizeUserIntents(requestedIntents).intents;
  const ranked = [...records].sort((left, right) => {
    const leftFit = intents.reduce((sum, intent) => sum + matchCandidateToIntent(left, intent).strength, 0);
    const rightFit = intents.reduce((sum, intent) => sum + matchCandidateToIntent(right, intent).strength, 0);
    return rightFit - leftFit || distanceKm(anchor, left) - distanceKm(anchor, right) || String(left.id).localeCompare(String(right.id));
  });
  // Seed one member of each engine type before filling by fit/proximity. Dense
  // restaurant supply must not crowd every park, museum or local market out.
  const selected = [];
  const seenTypes = new Set();
  for (const record of ranked) {
    if (seenTypes.has(record.type)) continue;
    seenTypes.add(record.type);
    selected.push(record);
    if (selected.length >= limit) return selected;
  }
  for (const record of ranked) {
    if (selected.includes(record)) continue;
    selected.push(record);
    if (selected.length >= limit) break;
  }
  return selected;
}

function createOvertureSource({
  queryRows = null,
  releaseResolver = resolveLatestOvertureRelease,
  cacheDir = null,
  radiusKm = DEFAULT_RADIUS_KM,
  limit = DEFAULT_LIMIT,
  minConfidence = DEFAULT_MIN_CONFIDENCE,
} = {}) {
  const executeQuery = typeof queryRows === "function" ? queryRows : createDuckDbQueryRows({ cacheDir });
  const boundedRadius = clamp(radiusKm, 0.1, MAX_RADIUS_KM, DEFAULT_RADIUS_KM);
  const boundedLimit = Math.max(1, Math.min(Math.floor(Number(limit) || DEFAULT_LIMIT), MAX_LIMIT));
  const boundedConfidence = clamp(minConfidence, 0.5, 1, DEFAULT_MIN_CONFIDENCE);
  return async function loadOvertureAround({ lat, lng, requestedIntents = [] } = {}) {
    if (!validCoordinate(lat, lng)) return [];
    try {
      const release = await releaseResolver();
      const query = buildOvertureQuery({
        release,
        lat,
        lng,
        radiusKm: boundedRadius,
        minConfidence: boundedConfidence,
      });
      if (!query) return [];
      const rows = await executeQuery(query);
      const records = [];
      const seen = new Set();
      for (const row of Array.isArray(rows) ? rows : []) {
        const record = mapOvertureRow(row, { minConfidence: boundedConfidence });
        if (!record || seen.has(record.id) || distanceKm({ lat, lng }, record) > boundedRadius + 0.05) continue;
        seen.add(record.id);
        records.push(record);
      }
      return selectRecords(records, { anchor: { lat, lng }, requestedIntents, limit: boundedLimit });
    } catch (_error) {
      return [];
    }
  };
}

module.exports = {
  OVERTURE_STAC_ROOT,
  OVERTURE_ATTRIBUTION_URL,
  DEFAULT_RADIUS_KM,
  DEFAULT_LIMIT,
  DEFAULT_MIN_CONFIDENCE,
  QUERY_ROW_LIMIT,
  categoryMapping,
  mapOvertureRow,
  buildOvertureQuery,
  resolveLatestOvertureRelease,
  createDuckDbQueryRows,
  createOvertureSource,
  selectRecords,
};
