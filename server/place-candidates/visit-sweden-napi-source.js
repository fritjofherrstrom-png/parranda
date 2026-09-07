"use strict";

/**
 * Visit Sweden National API (NAPI) place source.
 *
 * NAPI is a structured, public, official Swedish data source backed by
 * EntryStore. This adapter uses the documented Solr search endpoint and its
 * predicate-range fields to fetch one small coordinate window. It never sends
 * the user's place text and never scans the nationwide catalog.
 *
 * Trust boundary:
 *   - exact endpoint, method and response URL;
 *   - Sweden-only coverage bounds and a five-kilometre maximum radius;
 *   - one request, 100 rows and two MiB at most;
 *   - exact metadata/entry identity and exact JSON-LD graph joins;
 *   - closed schema.org category mapping, with no label inference;
 *   - descriptions, images, scores and raw provider metadata are discarded;
 *   - failures return no candidates and are distinguishable from healthy
 *     empty results through collectOutcome(), so callers do not cache outages.
 */

const { createHash } = require("node:crypto");

const VISIT_SWEDEN_NAPI_SEARCH_ENDPOINT = "https://data.visitsweden.com/store/search";
const VISIT_SWEDEN_NAPI_ATTRIBUTION_URL = "https://docs.visitsweden.com/en/api/";
const VISIT_SWEDEN_NAPI_CONTRACT_REVISION = "visit-sweden-napi-solr-v1";
const DEFAULT_RADIUS_KM = 5;
const MAX_RADIUS_KM = 5;
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 100;
const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;
const DEFAULT_USER_AGENT = "Parranda/1.0 (+https://github.com/fritjofherrstrom-png/parranda)";
// Provider coverage, not a city special-case. Anchors outside this conservative
// Sweden envelope never contact NAPI.
const SWEDEN_COVERAGE_BBOX = Object.freeze([10, 54, 25, 70]);
const LATITUDE_PREDICATE = "http://schema.org/latitude";
const LONGITUDE_PREDICATE = "http://schema.org/longitude";
const LATITUDE_FIELD = `metadata.predicate.literal_s.${predicateHash(LATITUDE_PREDICATE)}`;
const LONGITUDE_FIELD = `metadata.predicate.literal_s.${predicateHash(LONGITUDE_PREDICATE)}`;

const PLACE_ADDITIONAL_TYPE_MAP = new Map([
  ["Museum", { type: "museum", tags: ["kultur", "museum"] }],
  ["ArtGallery", { type: "gallery", tags: ["kultur"] }],
  ["Park", { type: "park", tags: ["park", "green"] }],
  ["Garden", { type: "garden", tags: ["garden", "green"] }],
  ["BotanicalGarden", { type: "garden", tags: ["garden", "green"] }],
  ["Beach", { type: "beach", tags: ["coast", "bathing"] }],
  // The broad TouristAttraction class is not precise route evidence. A named
  // historic structure is precise and maps to Parranda's existing scenic
  // vocabulary without inventing whether it is a castle or monument.
  ["LandmarksOrHistoricalBuildings", { type: "historic-site", tags: ["historic", "landmark"] }],
]);

function predicateHash(uri) {
  return createHash("md5").update(uri).digest("hex").slice(0, 8);
}

function createVisitSwedenNapiSource({
  fetcher = typeof globalThis.fetch === "function" ? globalThis.fetch.bind(globalThis) : null,
  radiusKm = DEFAULT_RADIUS_KM,
  limit = DEFAULT_LIMIT,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxBytes = DEFAULT_MAX_BYTES,
  userAgent = DEFAULT_USER_AGENT,
} = {}) {
  const radius = clamp(radiusKm, 0.1, MAX_RADIUS_KM, DEFAULT_RADIUS_KM);
  const rowLimit = integer(limit, 1, MAX_LIMIT, DEFAULT_LIMIT);
  const deadline = integer(timeoutMs, 50, DEFAULT_TIMEOUT_MS, DEFAULT_TIMEOUT_MS);
  const byteLimit = integer(maxBytes, 1024, DEFAULT_MAX_BYTES, DEFAULT_MAX_BYTES);

  async function collectOutcome(anchor = {}) {
    const request = buildVisitSwedenSearchRequest({ ...anchor, radiusKm: radius, limit: rowLimit });
    if (!request || typeof fetcher !== "function") return failed();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), deadline);
    try {
      const response = await fetcher(request.url, {
        method: "GET",
        headers: {
          Accept: "application/json",
          "User-Agent": userAgent,
        },
        redirect: "error",
        signal: controller.signal,
      });
      if (!validResponse(response, request.url, byteLimit)) return failed();
      const raw = await readBoundedText(response, byteLimit);
      if (!raw) return failed();
      let payload;
      try {
        payload = JSON.parse(raw);
      } catch (_error) {
        return failed();
      }
      const parsed = parseSearchPayload(payload, request);
      if (!parsed) return failed();
      return {
        status: parsed.length ? "ok" : "empty",
        records: parsed.slice(0, rowLimit),
        contract_revision: VISIT_SWEDEN_NAPI_CONTRACT_REVISION,
      };
    } catch (_error) {
      return failed();
    } finally {
      clearTimeout(timer);
    }
  }

  const source = async (anchor = {}) => (await collectOutcome(anchor)).records;
  source.collectOutcome = collectOutcome;
  source.contractRevision = VISIT_SWEDEN_NAPI_CONTRACT_REVISION;
  source.cacheIdentity = `${VISIT_SWEDEN_NAPI_CONTRACT_REVISION}:${radius}:${rowLimit}`;
  source.radiusKm = radius;
  return source;
}

function createCachedVisitSwedenNapiSource({ source, cache } = {}) {
  if (typeof source?.collectOutcome !== "function" || typeof cache?.get !== "function") return null;
  const keyFor = ({ lat, lng }) => `${source.cacheIdentity}:${lat.toFixed(3)},${lng.toFixed(3)}`;
  const filter = (outcome, { lat, lng }) => outcome?.contract_revision === source.contractRevision && Array.isArray(outcome?.records)
    ? outcome.records.filter((record) => Number.isFinite(record?.lat) && Number.isFinite(record?.lng) &&
      haversineKm(lat, lng, record.lat, record.lng) <= source.radiusKm)
    : [];
  return {
    eager: true,
    primaryRescue: false,
    readCached(anchor = {}) {
      if (!buildVisitSwedenSearchRequest(anchor)) return [];
      return filter(cache.peek?.(keyFor(anchor)), anchor);
    },
    async load(anchor = {}) {
      const { lat, lng } = anchor;
      if (!Number.isFinite(lat) || !Number.isFinite(lng) || !buildVisitSwedenSearchRequest(anchor)) return [];
      // Roughly 110 m latitude buckets match the existing loader cache posture
      // without turning every GPS wobble into a provider request. Re-filter the
      // cached rows against the exact current anchor before returning them.
      const key = keyFor(anchor);
      const outcome = await cache.get(
        key,
        () => source.collectOutcome({ lat, lng }),
        { shouldStore: (value) => value?.status === "ok" || value?.status === "empty" },
      ).catch(() => null);
      return filter(outcome, anchor);
    },
  };
}

function buildVisitSwedenSearchRequest({ lat, lng, radiusKm = DEFAULT_RADIUS_KM, limit = DEFAULT_LIMIT } = {}) {
  const anchorLat = finiteNumber(lat);
  const anchorLng = finiteNumber(lng);
  if (anchorLat == null || anchorLng == null || !pointInBbox(anchorLat, anchorLng, SWEDEN_COVERAGE_BBOX)) {
    return null;
  }
  const radius = clamp(radiusKm, 0.1, MAX_RADIUS_KM, DEFAULT_RADIUS_KM);
  const rowLimit = integer(limit, 1, MAX_LIMIT, DEFAULT_LIMIT);
  const latDelta = radius / 110.574;
  const lngDelta = radius / (111.32 * Math.max(0.01, Math.abs(Math.cos((anchorLat * Math.PI) / 180))));
  const [west, south, east, north] = SWEDEN_COVERAGE_BBOX;
  const bbox = {
    south: Math.max(south, anchorLat - latDelta),
    north: Math.min(north, anchorLat + latDelta),
    west: Math.max(west, anchorLng - lngDelta),
    east: Math.min(east, anchorLng + lngDelta),
  };
  const query = [
    "public:true",
    "(rdfType:http\\://schema.org/Place OR rdfType:http\\://schema.org/FoodEstablishment)",
    `${LATITUDE_FIELD}:[${decimal(bbox.south)} TO ${decimal(bbox.north)}]`,
    `${LONGITUDE_FIELD}:[${decimal(bbox.west)} TO ${decimal(bbox.east)}]`,
  ].join(" AND ");
  const url = new URL(VISIT_SWEDEN_NAPI_SEARCH_ENDPOINT);
  url.searchParams.set("type", "solr");
  url.searchParams.set("query", query);
  url.searchParams.set("limit", String(rowLimit));
  url.searchParams.set("offset", "0");
  url.searchParams.set("rdfFormat", "application/ld+json");
  return {
    url: url.toString(),
    anchor: { lat: anchorLat, lng: anchorLng },
    radiusKm: radius,
    limit: rowLimit,
    bbox,
    query,
  };
}

function parseSearchPayload(payload, request) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  if (!Number.isInteger(payload.results) || payload.results < 0) return null;
  if (!Number.isInteger(payload.offset) || payload.offset !== 0) return null;
  if (!Number.isInteger(payload.limit) || payload.limit < 1 || payload.limit > request.limit) return null;
  const children = payload.resource?.children;
  if (!Array.isArray(children) || children.length > request.limit || children.length > MAX_LIMIT) return null;
  const records = [];
  for (const child of children) {
    const record = mapVisitSwedenEntry(child, request);
    if (record) records.push(record);
  }
  return records.sort((left, right) =>
    haversineKm(request.anchor.lat, request.anchor.lng, left.lat, left.lng) -
      haversineKm(request.anchor.lat, request.anchor.lng, right.lat, right.lng) ||
    left.id.localeCompare(right.id),
  );
}

function mapVisitSwedenEntry(entry, request) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
  const contextId = exactDigits(entry.contextId);
  const entryId = exactDigits(entry.entryId);
  if (!contextId || !entryId) return null;
  const metadata = entry.metadata;
  const metadataUrl = `https://data.visitsweden.com/store/${contextId}/metadata/${entryId}`;
  if (!metadata || metadata["@id"] !== metadataUrl) return null;
  if (metadata["@context"]?.schema !== "http://schema.org/") return null;
  const graph = metadata["@graph"];
  if (!Array.isArray(graph) || graph.length < 2 || graph.length > 40) return null;
  const ids = graph.map((node) => node?.["@id"]);
  if (ids.some((id) => typeof id !== "string" || !id) || new Set(ids).size !== ids.length) return null;
  if (graph.some((node) => Object.hasOwn(node, "@context"))) return null;

  const roots = graph.filter((node) => {
    const types = exactTypeValues(node?.["@type"]);
    return types.includes("Place") || types.includes("FoodEstablishment");
  });
  if (roots.length !== 1) return null;
  const root = roots[0];
  const rootTypes = exactTypeValues(root["@type"]);
  const isPlace = rootTypes.includes("Place");
  const isFood = rootTypes.includes("FoodEstablishment");
  // EntryStore emits stable urn:uuid identifiers, but historical NAPI rows do
  // not consistently carry RFC-4122 version/variant bits. Require the exact
  // UUID shape without rewriting or pretending those bits are canonical.
  if (isPlace === isFood || !/^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(root["@id"] || ""))) {
    return null;
  }

  const name = localizedName(root["schema:name"]);
  if (!name) return null;
  const geoId = exactId(root["schema:geo"]);
  if (!geoId || !geoId.startsWith("_:")) return null;
  const geoNodes = graph.filter((node) =>
    node?.["@id"] === geoId && exactTypeValues(node?.["@type"]).includes("GeoCoordinates"),
  );
  if (geoNodes.length !== 1) return null;
  const lat = exactCoordinate(geoNodes[0]["schema:latitude"], -90, 90);
  const lng = exactCoordinate(geoNodes[0]["schema:longitude"], -180, 180);
  if (lat == null || lng == null) return null;
  if (!pointInRequest(lat, lng, request)) return null;

  const mapping = isFood
    ? { type: "restaurant", tags: ["mat"] }
    : exactPlaceMapping(root["schema:additionalType"]);
  if (!mapping) return null;
  const website = safeHttpId(root["schema:url"]);
  return {
    id: `visit-sweden-napi-${contextId}-${entryId}`,
    name,
    type: mapping.type,
    lat,
    lng,
    tags: [...mapping.tags],
    sources: [{
      provider: "visit-sweden-napi",
      label: "Visit Sweden National API",
      family: "official",
      tier: "official",
      url: metadataUrl,
      freshness: "fresh",
    }],
    source_policy: "open_data_attribution_required",
    chain: false,
    operational_status: "unknown",
    operational_reasons: [],
    ...(website ? { website } : {}),
  };
}

function exactPlaceMapping(value) {
  const values = Array.isArray(value) ? value : [value];
  const mappings = [];
  for (const item of values) {
    const id = exactId(item);
    const type = exactSchemaTerm(id);
    const mapping = PLACE_ADDITIONAL_TYPE_MAP.get(type);
    if (mapping) mappings.push(mapping);
  }
  const distinct = [...new Map(mappings.map((mapping) => [mapping.type, mapping])).values()];
  return distinct.length === 1 ? distinct[0] : null;
}

function exactSchemaTerm(value) {
  if (typeof value !== "string") return null;
  if (value.startsWith("schema:")) return value.slice("schema:".length);
  if (value.startsWith("http://schema.org/")) return value.slice("http://schema.org/".length);
  return null;
}

function exactTypeValues(value) {
  return (Array.isArray(value) ? value : [value])
    .map(exactSchemaTerm)
    .filter(Boolean);
}

function localizedName(value) {
  const values = Array.isArray(value) ? value : [value];
  const atoms = values
    .filter((item) => item && typeof item === "object" && typeof item["@value"] === "string")
    .map((item) => ({ value: item["@value"].trim(), language: String(item["@language"] || "").toLowerCase() }))
    .filter((item) => item.value && item.value.length <= 160 && !/[\u0000-\u001f\u007f]/.test(item.value));
  for (const language of ["sv", "en", ""]) {
    const match = atoms.find((item) => item.language === language);
    if (match) return match.value;
  }
  return null;
}

function exactId(value) {
  return value && typeof value === "object" && !Array.isArray(value) && typeof value["@id"] === "string"
    ? value["@id"]
    : null;
}

function safeHttpId(value) {
  const id = exactId(value);
  if (!id) return null;
  try {
    const url = new URL(id);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password ? url.toString() : null;
  } catch (_error) {
    return null;
  }
}

function validResponse(response, expectedUrl, maxBytes) {
  if (!response?.ok || response.status !== 200 || response.redirected === true) return false;
  if (response.url) {
    try {
      if (new URL(response.url).toString() !== new URL(expectedUrl).toString()) return false;
    } catch (_error) {
      return false;
    }
  }
  const contentType = typeof response.headers?.get === "function"
    ? String(response.headers.get("content-type") || "").split(";")[0].trim().toLowerCase()
    : "";
  if (contentType !== "application/json" && contentType !== "application/ld+json") return false;
  const length = typeof response.headers?.get === "function"
    ? Number(response.headers.get("content-length"))
    : NaN;
  return !Number.isFinite(length) || (length >= 0 && length <= maxBytes);
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
      const joined = new Uint8Array(bytes);
      let offset = 0;
      for (const chunk of chunks) {
        joined.set(chunk, offset);
        offset += chunk.byteLength;
      }
      return new TextDecoder("utf-8", { fatal: true }).decode(joined).trim() || null;
    } catch (_error) {
      return null;
    }
  }
  if (typeof response?.text !== "function") return null;
  const text = await response.text();
  return Buffer.byteLength(text, "utf8") <= maxBytes ? text : null;
}

function pointInRequest(lat, lng, request) {
  return lat >= request.bbox.south && lat <= request.bbox.north &&
    lng >= request.bbox.west && lng <= request.bbox.east &&
    haversineKm(request.anchor.lat, request.anchor.lng, lat, lng) <= request.radiusKm;
}

function pointInBbox(lat, lng, bbox) {
  const [west, south, east, north] = bbox;
  return lat >= south && lat <= north && lng >= west && lng <= east;
}

function haversineKm(lat1, lng1, lat2, lng2) {
  const toRad = (degrees) => (degrees * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function exactCoordinate(value, min, max) {
  if ((typeof value !== "string" && typeof value !== "number") || Array.isArray(value)) return null;
  const raw = String(value);
  if (!/^-?\d{1,3}(?:\.\d+)?$/.test(raw)) return null;
  const number = Number(raw);
  return Number.isFinite(number) && number >= min && number <= max ? number : null;
}

function finiteNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function exactDigits(value) {
  const token = String(value ?? "");
  return /^\d{1,12}$/.test(token) ? token : null;
}

function decimal(value) {
  return Number(value).toFixed(7);
}

function clamp(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
}

function integer(value, min, max, fallback) {
  const number = Math.floor(Number(value));
  return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
}

function failed() {
  return { status: "failed", records: [], contract_revision: VISIT_SWEDEN_NAPI_CONTRACT_REVISION };
}

module.exports = {
  DEFAULT_LIMIT,
  DEFAULT_MAX_BYTES,
  DEFAULT_RADIUS_KM,
  DEFAULT_TIMEOUT_MS,
  LATITUDE_FIELD,
  LONGITUDE_FIELD,
  MAX_LIMIT,
  MAX_RADIUS_KM,
  PLACE_ADDITIONAL_TYPE_MAP,
  SWEDEN_COVERAGE_BBOX,
  VISIT_SWEDEN_NAPI_ATTRIBUTION_URL,
  VISIT_SWEDEN_NAPI_CONTRACT_REVISION,
  VISIT_SWEDEN_NAPI_SEARCH_ENDPOINT,
  buildVisitSwedenSearchRequest,
  createCachedVisitSwedenNapiSource,
  createVisitSwedenNapiSource,
  mapVisitSwedenEntry,
  parseSearchPayload,
};
