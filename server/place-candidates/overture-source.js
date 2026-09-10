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
const OVERTURE_PLACE_LICENSES = Object.freeze([
  "Apache-2.0",
  "CC0-1.0",
  "CDLA-Permissive-2.0",
]);

const EXACT_TYPE_MAP = new Map([
  ["cafe", { type: "cafe", tags: ["fika"] }],
  ["coffee_shop", { type: "cafe", tags: ["fika", "coffee"] }],
  ["bakery", { type: "cafe", tags: ["fika"] }],
  ["tea_room", { type: "cafe", tags: ["fika"] }],
  ["ice_cream_shop", { type: "cafe", tags: ["fika"] }],
  ["dessert_shop", { type: "cafe", tags: ["fika"] }],
  ["bar", { type: "bar", tags: ["nattliv"] }],
  ["pub", { type: "bar", tags: ["nattliv"] }],
  ["dance_club", { type: "bar", tags: ["nattliv"] }],
  ["beer_garden", { type: "bar", tags: ["nattliv", "öl"] }],
  ["brewery", { type: "bar", tags: ["nattliv", "öl"] }],
  ["winery", { type: "bar", tags: ["vin"] }],
  ["distillery", { type: "bar", tags: ["lokalt"] }],
  ["museum", { type: "museum", tags: ["kultur", "museum"] }],
  ["art_museum", { type: "museum", tags: ["kultur", "museum"] }],
  ["modern_art_museum", { type: "museum", tags: ["kultur", "museum"] }],
  ["history_museum", { type: "museum", tags: ["kultur", "museum"] }],
  ["art_gallery", { type: "gallery", tags: ["kultur"] }],
  ["park", { type: "park", tags: ["park", "green"] }],
  ["national_park", { type: "park", tags: ["park", "green", "nature"] }],
  ["state_park", { type: "park", tags: ["park", "green", "nature"] }],
  ["nature_reserve", { type: "park", tags: ["park", "green", "nature"] }],
  ["garden", { type: "garden", tags: ["garden", "green"] }],
  ["botanical_garden", { type: "garden", tags: ["garden", "green"] }],
  ["community_garden", { type: "garden", tags: ["garden", "green"] }],
  ["scenic_viewpoint", { type: "viewpoint", tags: ["utsikt"] }],
  ["lookout", { type: "viewpoint", tags: ["utsikt"] }],
  ["marina", { type: "promenade", tags: ["waterfront", "coast"] }],
  ["pier", { type: "promenade", tags: ["waterfront", "coast"] }],
  ["castle", { type: "castle", tags: ["historic", "landmark"] }],
  ["fort", { type: "historic-site", tags: ["historic", "landmark"] }],
  ["historic_site", { type: "historic-site", tags: ["historic", "landmark"] }],
  ["monument", { type: "monument", tags: ["historic", "landmark"] }],
  ["lighthouse", { type: "lighthouse", tags: ["historic", "coast"] }],
  ["beach", { type: "beach", tags: ["coast", "bathing"] }],
  ["farmers_market", { type: "market", tags: ["market", "lokalt"] }],
  ["flea_market", { type: "market", tags: ["market", "loppis"] }],
  ["market", { type: "market", tags: ["market"] }],
  ["farm", { type: "market", tags: ["lokalt"] }],
  ["antique_store", { type: "vintage-shop", tags: ["vintage", "antique"] }],
  ["second_hand_store", { type: "vintage-shop", tags: ["second_hand"] }],
  ["second_hand_clothing_store", { type: "vintage-shop", tags: ["second_hand"] }],
]);

// Reviewed PRIMARY labels from Overture's 2026-03-04 taxonomy table, pinned in
// docs/OVERTURE_TAXONOMY_COMPATIBILITY.md. These explicit sets replace suffix
// inference: salad_bar is food, milk_bar is not nightlife, and an unknown future
// *_museum / *_market cannot acquire a role. No runtime ancestor roll-up occurs.
// Cuisine names are provider category identifiers, never place/city branches.
const PRIMARY_CATEGORY_GROUPS = [
  ["restaurant", ["mat"], `
    restaurant african_restaurant east_african_restaurant eritrean_restaurant
    ethiopian_restaurant somalian_restaurant north_african_restaurant algerian_restaurant
    egyptian_restaurant moroccan_restaurant southern_african_restaurant south_african_restaurant
    west_african_restaurant ghanaian_restaurant nigerian_restaurant senegalese_restaurant
    asian_restaurant central_asian_restaurant afghani_restaurant kazakhstani_restaurant
    uzbek_restaurant east_asian_restaurant chinese_restaurant baozi_restaurant
    beijing_restaurant cantonese_restaurant dim_sum_restaurant dongbei_restaurant
    fujian_restaurant hunan_restaurant indo_chinese_restaurant jiangsu_restaurant
    shandong_restaurant shanghainese_restaurant sichuan_restaurant xinjiang_restaurant
    japanese_restaurant sushi_restaurant korean_restaurant mongolian_restaurant
    taiwanese_restaurant ramen_restaurant south_asian_restaurant bangladeshi_restaurant
    himalayan_restaurant nepalese_restaurant indian_restaurant bengali_restaurant
    chettinad_restaurant gujarati_restaurant hyderabadi_restaurant north_indian_restaurant
    punjabi_restaurant rajasthani_restaurant south_indian_restaurant pakistani_restaurant
    sri_lankan_restaurant tibetan_restaurant southeast_asian_restaurant burmese_restaurant
    cambodian_restaurant filipino_restaurant indonesian_restaurant sundanese_restaurant
    laotian_restaurant malaysian_restaurant nasi_restaurant singaporean_restaurant
    thai_restaurant vietnamese_restaurant wok_restaurant bar_and_grill_restaurant
    breakfast_and_brunch_restaurant pancake_house waffle_restaurant buffet_restaurant
    cafeteria comfort_food_restaurant diy_foods_restaurant dumpling_restaurant
    european_restaurant central_european_restaurant austrian_restaurant czech_restaurant
    german_restaurant fischbrotchen_restaurant hungarian_restaurant polish_restaurant
    schnitzel_restaurant slovakian_restaurant swiss_restaurant eastern_european_restaurant
    belarusian_restaurant bulgarian_restaurant lithuanian_restaurant romanian_restaurant
    russian_restaurant tatar_restaurant serbo_croatian_restaurant ukrainian_restaurant
    iberian_restaurant portuguese_restaurant spanish_restaurant basque_restaurant
    catalan_restaurant mediterranean_restaurant greek_restaurant italian_restaurant
    piadina_restaurant pizza_restaurant maltese_restaurant scandinavian_restaurant
    danish_restaurant finnish_restaurant icelandic_restaurant norwegian_restaurant
    swedish_restaurant western_european_restaurant belgian_restaurant british_restaurant
    dutch_restaurant french_restaurant brasserie irish_restaurant scottish_restaurant
    welsh_restaurant haute_cuisine_restaurant international_fusion_restaurant
    asian_fusion_restaurant latin_fusion_restaurant pan_asian_restaurant
    latin_american_restaurant caribbean_restaurant cuban_restaurant dominican_restaurant
    haitian_restaurant jamaican_restaurant puerto_rican_restaurant trinidadian_restaurant
    central_american_restaurant belizean_restaurant costa_rican_restaurant
    guatemalan_restaurant honduran_restaurant nicaraguan_restaurant panamanian_restaurant
    salvadoran_restaurant empanada_restaurant mexican_restaurant south_american_restaurant
    argentine_restaurant bolivian_restaurant brazilian_restaurant chilean_restaurant
    colombian_restaurant ecuadorian_restaurant paraguayan_restaurant peruvian_restaurant
    surinamese_restaurant uruguayan_restaurant venezuelan_restaurant taco_restaurant
    texmex_restaurant meat_restaurant barbecue_restaurant burger_restaurant
    cheesesteak_restaurant chicken_restaurant chicken_wings_restaurant curry_sausage_restaurant
    hot_dog_restaurant meatball_restaurant rotisserie_chicken_restaurant steakhouse
    venison_restaurant wild_game_meats_restaurant middle_eastern_restaurant arabian_restaurant
    armenian_restaurant azerbaijani_restaurant falafel_restaurant georgian_restaurant
    israeli_restaurant kofta_restaurant kurdish_restaurant lebanese_restaurant
    palestinian_restaurant persian_restaurant syrian_restaurant turkish_restaurant
    doner_kebab_restaurant turkmen_restaurant yemenite_restaurant north_american_restaurant
    american_restaurant cajun_and_creole_restaurant southern_american_restaurant
    canadian_restaurant poutinerie_restaurant pacific_rim_restaurant australian_restaurant
    melanesian_restaurant fijian_restaurant micronesian_restaurant guamanian_restaurant
    new_zealand_restaurant polynesian_restaurant hawaiian_restaurant poke_restaurant
    pop_up_restaurant salad_bar seafood_restaurant fish_and_chips_restaurant fish_restaurant
    soul_food soup_restaurant special_diet_restaurant acai_bowls gluten_free_restaurant
    halal_restaurant health_food_restaurant jewish_restaurant kosher_restaurant
    live_and_raw_food_restaurant molecular_gastronomy_restaurant vegan_restaurant
    vegetarian_restaurant supper_club theme_restaurant wrap_restaurant
    fast_food_restaurant fondue_restaurant tapas_bar
  `],
  ["museum", ["kultur", "museum"], `
    museum art_museum asian_art_museum cartooning_museum contemporary_art_museum
    costume_museum decorative_arts_museum design_museum modern_art_museum
    photography_museum textile_museum aviation_museum childrens_museum history_museum
    civilization_museum community_museum military_museum national_museum science_museum
    computer_museum sports_museum state_museum
  `],
  ["bar", ["nattliv"], `
    bar bar_tabac beach_bar beer_bar champagne_bar cigar_bar cocktail_bar dive_bar
    drive_thru_bar gay_bar hookah_bar hotel_bar piano_bar pub irish_pub sake_bar
    speakeasy sports_bar tiki_bar vermouth_bar whiskey_bar wine_bar
  `],
  ["market", ["market"], `
    seafood_market health_market holiday_market night_market public_market flower_market
  `],
];
for (const [type, tags, labels] of PRIMARY_CATEGORY_GROUPS) {
  for (const label of labels.trim().split(/\s+/)) {
    if (!EXACT_TYPE_MAP.has(label)) EXACT_TYPE_MAP.set(label, { type, tags });
  }
}

const CATEGORY_TOKEN = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/;
const MAX_CATEGORY_LENGTH = 100;
const MAX_HIERARCHY_DEPTH = 16;
// Same closed map at acquisition and normalization: alternate-only or unsupported
// rows cannot crowd safe primary matches out of the 600-row acquisition budget.
const OVERTURE_ROUTE_PRIMARY_CATEGORIES = Object.freeze([...EXACT_TYPE_MAP.keys()]);
const TRAVEL_PRIMARY_SQL = OVERTURE_ROUTE_PRIMARY_CATEGORIES.map((label) => `'${label}'`).join(", ");

function clamp(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
}

function validCoordinate(lat, lng) {
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
}

function validCategory(value) {
  return typeof value === "string" && value.length <= MAX_CATEGORY_LENGTH && CATEGORY_TOKEN.test(value);
}

function categoryMapping(primary) {
  return validCategory(primary) ? EXACT_TYPE_MAP.get(primary) || null : null;
}

function validPrimaryHierarchy(primary, hierarchy) {
  return validCategory(primary) && Array.isArray(hierarchy)
    && hierarchy.length >= 1 && hierarchy.length <= MAX_HIERARCHY_DEPTH
    && hierarchy.every(validCategory) && new Set(hierarchy).size === hierarchy.length
    && hierarchy[hierarchy.length - 1] === primary;
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

function normalizeOvertureLicenses(values) {
  const allowed = new Set(OVERTURE_PLACE_LICENSES);
  const licenses = [...new Set((Array.isArray(values) ? values : [])
    .map((value) => String(value || "").trim())
    .filter((value) => allowed.has(value)))];
  return OVERTURE_PLACE_LICENSES.filter((license) => licenses.includes(license));
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
  // Both aliases are projected from the SAME new taxonomy struct. No fallback
  // to legacy categories, a basic icon category, ancestors or alternate facets.
  if (!validPrimaryHierarchy(row.category, row.category_hierarchy)) return null;
  const mapping = categoryMapping(row.category);
  if (!mapping) return null;
  // Places is a multi-license dataset and each row's `sources` atoms own the
  // applicable license. Keep only the closed official set selected in SQL;
  // missing or newly unknown terms fail closed instead of being mislabeled.
  const licenses = normalizeOvertureLicenses(row.licenses);
  if (!licenses.length) return null;
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
      license: licenses.join(" + "),
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
  taxonomy.primary AS category,
  taxonomy.hierarchy AS category_hierarchy,
  confidence,
  operating_status,
  websites,
  brand.names.primary AS brand,
  list_distinct(list_transform(sources, source -> source.license)) AS licenses,
  bbox.xmin AS lng,
  bbox.ymin AS lat
FROM read_parquet('${path}', hive_partitioning=1)
WHERE bbox.ymin BETWEEN ${latMin.toFixed(7)} AND ${latMax.toFixed(7)}
  AND ${longitudeClause(lng, lngDelta)}
  AND confidence >= ${confidence.toFixed(3)}
  AND (operating_status IS NULL OR lower(operating_status) NOT LIKE '%closed%')
  AND taxonomy.primary IN (${TRAVEL_PRIMARY_SQL})
  AND len(taxonomy.hierarchy) BETWEEN 1 AND ${MAX_HIERARCHY_DEPTH}
  AND taxonomy.primary = list_extract(taxonomy.hierarchy, -1)
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
  OVERTURE_PLACE_LICENSES,
  OVERTURE_ROUTE_PRIMARY_CATEGORIES,
  categoryMapping,
  normalizeOvertureLicenses,
  mapOvertureRow,
  buildOvertureQuery,
  resolveLatestOvertureRelease,
  createDuckDbQueryRows,
  createOvertureSource,
  selectRecords,
};
