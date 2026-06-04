/**
 * Real open-data loader seam for Agnostic Blitz (#237).
 *
 * Returns an async loader `({lat,lng}) → records[]` that fetches credible open
 * records (OSM via Overpass; corroborated with Wikidata when tagged) and maps
 * them into the same record shape the #234 external-open-provider already
 * understands. The loader plugs into the existing trusted helper channel
 * (helpers.external_provider.dataset) — no new pipeline, no public injection.
 *
 * Hard product stances baked in:
 *   - NO network in tests: `fetcher` is injectable; default falls back to the
 *     runtime's global fetch. Tests inject a deterministic one.
 *   - Bounded by construction: small radius, hard result limit, AbortController
 *     timeout. No unbounded scraping.
 *   - Fail closed on every error path (network, non-200, parse, timeout,
 *     malformed payload) — return `[]`, never throw, never hallucinate.
 *   - Source honesty: each record carries OSM as a `map` source; when the OSM
 *     element ALSO carries a `wikidata` tag, a SECOND source (`open_knowledge`)
 *     is emitted so the reducer sees real provenance diversity. Without it, a
 *     single-family record stays low and is gated out by the existing gates —
 *     OSM alone never becomes a user-facing move. This is the safer default.
 *   - No app-owned copy of external text: only attribution-bearing source refs.
 *
 * What this is NOT: Google/Tripadvisor/Facebook/social/review scraping; a
 * persisted clone of any restricted source; an entity-resolution/dedupe
 * service. Those are deliberate next-step boundaries.
 */

const DEFAULT_OVERPASS_ENDPOINT = "https://overpass-api.de/api/interpreter";
const DEFAULT_RADIUS_KM = 1.0;
const DEFAULT_LIMIT = 25;
const DEFAULT_TIMEOUT_MS = 5000;
const MAX_RADIUS_KM = 5.0;
const MAX_LIMIT = 100;

// Small, intent-mapped OSM tag → Parranda type table. Kept conservative so
// every entry maps cleanly into the canonical intent vocabulary. Add lines
// here when adding a new intent — do not branch in the mapping function.
const OSM_TAG_MAP = [
  // scenic
  { key: "tourism", value: "viewpoint", type: "viewpoint", tags: ["utsikt"] },
  // swimming / coast
  { key: "natural", value: "beach", type: "beach", tags: ["coast"] },
  { key: "leisure", value: "beach_resort", type: "beach", tags: ["coast"] },
  { key: "leisure", value: "swimming_area", type: "beach", tags: ["coast", "bathing"] },
  // second hand / vintage (NOT generic retail)
  { key: "shop", value: "second_hand", type: "vintage-shop", tags: ["second_hand"] },
  { key: "shop", value: "antiques", type: "vintage-shop", tags: ["vintage", "antique"] },
  { key: "shop", value: "charity", type: "vintage-shop", tags: ["second_hand", "charity"] },
  // food (restaurant / taverna-style / street food)
  { key: "amenity", value: "restaurant", type: "restaurant", tags: ["mat"] },
  { key: "amenity", value: "fast_food", type: "street-food", tags: ["mat"] },
  // coffee / fika
  { key: "amenity", value: "cafe", type: "cafe", tags: ["fika"] },
  // bars / evening (pub & biergarten read as bars, not food)
  { key: "amenity", value: "bar", type: "bar", tags: ["nattliv"] },
  { key: "amenity", value: "pub", type: "bar", tags: ["nattliv"] },
  { key: "amenity", value: "biergarten", type: "bar", tags: ["nattliv", "öl"] },
  // markets
  { key: "amenity", value: "marketplace", type: "market", tags: ["market"] },
  // culture
  { key: "tourism", value: "museum", type: "museum", tags: ["kultur", "museum"] },
  { key: "tourism", value: "gallery", type: "gallery", tags: ["kultur"] },
];

function createOpenDataLoader({
  fetcher = typeof globalThis.fetch === "function" ? globalThis.fetch.bind(globalThis) : null,
  endpoint = DEFAULT_OVERPASS_ENDPOINT,
  radiusKm = DEFAULT_RADIUS_KM,
  limit = DEFAULT_LIMIT,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  if (typeof fetcher !== "function") {
    return null; // honest fail closed: no fetcher → no loader
  }
  const boundedRadiusKm = clamp(radiusKm, 0.1, MAX_RADIUS_KM);
  const boundedLimit = Math.max(1, Math.min(Math.floor(limit), MAX_LIMIT));
  const boundedTimeoutMs = Math.max(50, Math.floor(timeoutMs));

  return async function loadOpenDataAround({ lat, lng } = {}) {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return [];

    const radiusM = Math.round(boundedRadiusKm * 1000);
    const query = buildOverpassQuery({ lat, lng, radiusM, limit: boundedLimit });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), boundedTimeoutMs);

    let payload;
    try {
      const response = await fetcher(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `data=${encodeURIComponent(query)}`,
        signal: controller.signal,
      });
      if (!response || response.ok !== true) return [];
      payload = await response.json();
    } catch (_error) {
      return []; // fail closed on any fetch/parse error or timeout
    } finally {
      clearTimeout(timer);
    }

    return mapOverpassResponse(payload, boundedLimit);
  };
}

function buildOverpassQuery({ lat, lng, radiusM, limit }) {
  const filters = OSM_TAG_MAP.flatMap(({ key, value }) => [
    `node["${key}"="${value}"](around:${radiusM},${lat},${lng});`,
    `way["${key}"="${value}"](around:${radiusM},${lat},${lng});`,
  ]).join("");
  return `[out:json][timeout:25];(${filters});out center ${limit};`;
}

function mapOverpassResponse(payload, limit) {
  if (!payload || !Array.isArray(payload.elements)) return [];
  const records = [];
  const seenIds = new Set();
  for (const element of payload.elements) {
    if (records.length >= limit) break;
    const record = mapOsmElement(element);
    if (!record) continue;
    if (seenIds.has(record.id)) continue; // exact-id dedupe inside the loader
    seenIds.add(record.id);
    records.push(record);
  }
  return records;
}

function mapOsmElement(element) {
  if (!element || typeof element !== "object") return null;
  const tags = element.tags && typeof element.tags === "object" ? element.tags : null;
  if (!tags) return null;

  const name = typeof tags.name === "string" ? tags.name.trim() : "";
  if (!name) return null; // no name → not a place

  const coords = resolveElementCoords(element);
  if (!coords) return null; // no coords → cannot become a place target

  const mapping = findOsmMapping(tags);
  if (!mapping) return null; // not an intent-mapped category

  const elementType = String(element.type || "node").toLowerCase();
  const osmId = element.id;
  if (osmId === undefined || osmId === null) return null;

  const sources = [
    {
      provider: "osm",
      family: "map",
      tier: "inferred",
      url: `https://www.openstreetmap.org/${elementType}/${osmId}`,
    },
  ];

  // Wikidata corroboration: when the OSM element itself links to a Wikidata
  // entity, emit a SECOND source claim from the `open_knowledge` family (linked
  // open knowledge graph) — that's how a single OSM element can carry real
  // provenance diversity. `open_knowledge` is deliberately NOT `community`: it
  // must add diversity without inheriting community/local-lens calibration.
  // Without this second source the candidate stays single-family and is gated
  // out by the existing gates — OSM alone never becomes a user-facing move.
  const wikidataId = typeof tags.wikidata === "string" ? tags.wikidata.trim() : "";
  if (/^Q\d+$/.test(wikidataId)) {
    sources.push({
      provider: "wikidata",
      family: "open_knowledge",
      tier: "inferred",
      url: `https://www.wikidata.org/wiki/${wikidataId}`,
    });
  }

  return {
    id: `osm-${elementType}-${osmId}`,
    name,
    type: mapping.type,
    lat: coords.lat,
    lng: coords.lng,
    tags: mapping.tags.slice(),
    sources,
  };
}

function resolveElementCoords(element) {
  if (Number.isFinite(element.lat) && Number.isFinite(element.lon)) {
    return { lat: element.lat, lng: element.lon };
  }
  const center = element.center && typeof element.center === "object" ? element.center : null;
  if (center && Number.isFinite(center.lat) && Number.isFinite(center.lon)) {
    return { lat: center.lat, lng: center.lon };
  }
  return null;
}

function findOsmMapping(tags) {
  for (const mapping of OSM_TAG_MAP) {
    if (tags[mapping.key] === mapping.value) return mapping;
  }
  return null;
}

/**
 * Read PARRANDA_OPEN_DATA_LOADER from the env at call time (not module load)
 * so tests can flip it deterministically and so a fresh `buildApp()` reflects
 * current config. Returns null when not "enabled", so the default `buildApp()`
 * with no override has no loader — production opts in explicitly.
 */
function resolveDefaultOpenDataLoader(env = process.env) {
  const flag = String(env?.PARRANDA_OPEN_DATA_LOADER || "").toLowerCase();
  if (flag !== "enabled" && flag !== "1" && flag !== "true") return null;
  return createOpenDataLoader();
}

function clamp(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

module.exports = {
  DEFAULT_OVERPASS_ENDPOINT,
  DEFAULT_RADIUS_KM,
  DEFAULT_LIMIT,
  DEFAULT_TIMEOUT_MS,
  MAX_RADIUS_KM,
  MAX_LIMIT,
  OSM_TAG_MAP,
  createOpenDataLoader,
  resolveDefaultOpenDataLoader,
  // exported for tests / introspection
  buildOverpassQuery,
  mapOverpassResponse,
  mapOsmElement,
};