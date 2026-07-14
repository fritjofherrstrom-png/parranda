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
 *     single-family record stays low and is gated out by the existing shared
 *     gates by default. The explicit agnostic route-output experiment may admit
 *     those attribution-bearing geocoded records through its own seam, but only
 *     with visible gate diagnostics and capped calibration; default Planner,
 *     Blitz, Pulse, and nearby surfaces stay on the safer shared gates.
 *   - No app-owned copy of external text: only attribution-bearing source refs.
 *
 * What this is NOT: Google/Tripadvisor/Facebook/social/review scraping; a
 * persisted clone of any restricted source; an entity-resolution/dedupe
 * service. Those are deliberate next-step boundaries.
 */

const { createSourceCache } = require("./source-cache");
const { createWikidataSource } = require("./wikidata-source");

const DEFAULT_OVERPASS_ENDPOINT = "https://overpass-api.de/api/interpreter";
// Mirror failover is a MECHANISM, not a free fix. The loader can try several
// Overpass endpoints in order, failing over on a transport/parse error (never on
// a genuine empty 200). But the DEFAULT is primary-only on purpose: measured live,
// the public fallback mirrors (kumi.systems, private.coffee) take 60-77 s for a
// trivial query — far beyond any route timeout, so defaulting to them would only
// add latency on the sad path for zero rescue. The real cold-loader robustness
// lever is the persistent disk cache (one slow load per place, then cached) + a
// faster/self-hosted Overpass. A deploy that runs such mirrors lists them via
// PARRANDA_OVERPASS_ENDPOINTS to get HA failover.
const DEFAULT_OVERPASS_FALLBACKS = [];
// Overpass (like Nominatim, see place-resolver.js) rejects requests without an
// identifying User-Agent with HTTP 406 — without this header every live call
// fails closed and the loader silently returns [].
const DEFAULT_USER_AGENT = "Parranda/1.0 (+https://github.com/fritjofherrstrom-png/parranda)";
// A single-day walking loop ranges well beyond 1 km from the anchor; 1.5 km
// reach catches the scenic/cultural/second-hand places that cluster outside a
// tight centre without pulling in a different district. Generic — every city.
const DEFAULT_RADIUS_KM = 1.5;
const DEFAULT_LIMIT = 25;
// How many raw elements to ask Overpass for before balancing down to the final
// limit. Wider than the limit so scarce categories survive a dense centre;
// still small and bounded (one query).
const OVERPASS_FETCH_CAP = 150;
// Live Overpass responses for this query routinely take 4–6s (the query itself
// declares a 25s server budget); a 5s client abort silently turned dense areas
// into fake "no data". Still a hard bound via AbortController.
const DEFAULT_TIMEOUT_MS = 12000;
const MAX_RADIUS_KM = 5.0;
const MAX_LIMIT = 100;
// Thin-city aperture expansion. A tight centre in a sparse city legitimately
// holds few mapped places within the default radius, so the day starves while
// MAX_RADIUS_KM is left unused. If the first pass is thin — few records OR few
// distinct categories — reach WIDER once before declaring scarcity. Response-
// driven, bounded (one extra query), and generic for every city (no place logic).
const EXPANSION_RADIUS_KM = 3.0;
const THIN_RECORD_COUNT = 12; // < ~half the default limit → thin
const THIN_CATEGORY_COUNT = 3; // fewer distinct place types than a real day needs

// Small, intent-mapped OSM tag → Parranda type table. Kept conservative so
// every entry maps cleanly into the canonical intent vocabulary. Add lines
// here when adding a new intent — do not branch in the mapping function.
const OSM_TAG_MAP = [
  // scenic — viewpoints are rare in flat city centres, so the scenic role used
  // to go unfilled everywhere (#273). A scenic anchor in any place is also a
  // notable park, public garden, waterfront, or castle. These types are ALREADY
  // recognized as scenic by the shared intent vocabulary (weak_types), so this
  // is purely the loader catching up — zero change to citypack/default scoring.
  // (squares / monuments / attractions need new vocab types → deferred so this
  // PR stays loader-only and changes no shared behaviour.)
  { key: "tourism", value: "viewpoint", type: "viewpoint", tags: ["utsikt"] },
  { key: "leisure", value: "park", type: "park", tags: ["park", "green"] },
  { key: "leisure", value: "nature_reserve", type: "park", tags: ["park", "green"] },
  { key: "leisure", value: "garden", type: "garden", tags: ["garden", "green"] },
  { key: "leisure", value: "marina", type: "promenade", tags: ["waterfront", "coast"] },
  { key: "man_made", value: "pier", type: "promenade", tags: ["waterfront", "coast"] },
  { key: "historic", value: "castle", type: "castle", tags: ["historic", "landmark"] },
  // swimming / coast
  { key: "natural", value: "beach", type: "beach", tags: ["coast"] },
  { key: "leisure", value: "beach_resort", type: "beach", tags: ["coast"] },
  { key: "leisure", value: "swimming_area", type: "beach", tags: ["coast", "bathing"] },
  // second hand / vintage (NOT generic retail)
  { key: "shop", value: "second_hand", type: "vintage-shop", tags: ["second_hand"] },
  { key: "shop", value: "antiques", type: "vintage-shop", tags: ["vintage", "antique"] },
  { key: "shop", value: "charity", type: "vintage-shop", tags: ["second_hand", "charity"] },
  { key: "shop", value: "vintage", type: "vintage-shop", tags: ["vintage", "second_hand"] },
  // food (restaurant / taverna-style / street food)
  { key: "amenity", value: "restaurant", type: "restaurant", tags: ["mat"] },
  { key: "amenity", value: "fast_food", type: "street-food", tags: ["mat"] },
  // coffee / fika — a café, a dedicated coffee shop, a bakery, and a gelateria
  // are all fika stops. All map to the EXISTING `cafe` type (recognized as fika
  // by the shared vocab), so this is purely broader OSM coverage of a role that
  // already exists — no new vocab, every city benefits identically.
  { key: "amenity", value: "cafe", type: "cafe", tags: ["fika"] },
  { key: "shop", value: "coffee", type: "cafe", tags: ["fika"] },
  { key: "shop", value: "bakery", type: "cafe", tags: ["fika"] },
  { key: "shop", value: "pastry", type: "cafe", tags: ["fika"] },
  { key: "amenity", value: "ice_cream", type: "cafe", tags: ["fika"] },
  // bars / evening (pub & biergarten read as bars, not food)
  { key: "amenity", value: "bar", type: "bar", tags: ["nattliv"] },
  { key: "amenity", value: "pub", type: "bar", tags: ["nattliv"] },
  { key: "amenity", value: "biergarten", type: "bar", tags: ["nattliv", "öl"] },
  // markets
  { key: "amenity", value: "marketplace", type: "market", tags: ["market"] },
  // culture
  { key: "tourism", value: "museum", type: "museum", tags: ["kultur", "museum"] },
  { key: "tourism", value: "gallery", type: "gallery", tags: ["kultur"] },
  { key: "amenity", value: "arts_centre", type: "gallery", tags: ["kultur"] },
];

// Distinct place TYPES in a record set — a proxy for how varied a day can be.
function distinctCategoryCount(records) {
  const cats = new Set();
  for (const r of Array.isArray(records) ? records : []) {
    if (r && r.type) cats.add(r.type);
  }
  return cats.size;
}

// A first pass is "thin" when it holds too few records OR too few distinct types
// to compose a varied day. An error result is NOT thin (expanding the radius
// won't fix a down mirror), and a genuinely rich pass is never expanded.
function isThinSupply(records) {
  if (!Array.isArray(records)) return true;
  if (typeof records.loader_status === "string" && records.loader_status.startsWith("error")) return false;
  return records.length < THIN_RECORD_COUNT || distinctCategoryCount(records) < THIN_CATEGORY_COUNT;
}

// A varied day is worth more than a bigger pile of the same type: category
// VARIETY dominates, record count is the tiebreak. So a wider pass with fewer
// records but more distinct types (8 across 3 categories) beats a thin one with
// more records of one type (15 cafés), while a wider pass that adds neither is
// discarded. This is what "richer" means for the expansion.
function supplyScore(records) {
  return distinctCategoryCount(records) * 1000 + (Array.isArray(records) ? records.length : 0);
}

function createOpenDataLoader({
  fetcher = typeof globalThis.fetch === "function" ? globalThis.fetch.bind(globalThis) : null,
  endpoint = null,
  endpoints = null,
  radiusKm = DEFAULT_RADIUS_KM,
  limit = DEFAULT_LIMIT,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  userAgent = DEFAULT_USER_AGENT,
  cache = null,
} = {}) {
  if (typeof fetcher !== "function") {
    return null; // honest fail closed: no fetcher → no loader
  }
  const boundedRadiusKm = clamp(radiusKm, 0.1, MAX_RADIUS_KM);
  const boundedLimit = Math.max(1, Math.min(Math.floor(limit), MAX_LIMIT));
  const boundedTimeoutMs = Math.max(50, Math.floor(timeoutMs));
  // Resolve the endpoint set. An explicit single `endpoint` (e.g. an injected
  // test) stays single-shot; otherwise the default primary + fallback mirror(s)
  // give cold-load failover. `endpoints` (array) overrides both.
  const resolvedEndpoints =
    Array.isArray(endpoints) && endpoints.length
      ? endpoints.filter(Boolean)
      : endpoint
        ? [endpoint]
        : [DEFAULT_OVERPASS_ENDPOINT, ...DEFAULT_OVERPASS_FALLBACKS];

  // One attempt against one mirror. Returns { ok, payload } on a usable response,
  // or { ok:false, status, error } so the caller can fail over to the next mirror.
  async function attemptOverpass(targetEndpoint, query) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), boundedTimeoutMs);
    try {
      const response = await fetcher(targetEndpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": userAgent,
          Accept: "application/json",
        },
        body: `data=${encodeURIComponent(query)}`,
        signal: controller.signal,
      });
      if (!response || response.ok !== true) {
        return { ok: false, status: "error_failed_closed", error: "http_non_200" };
      }
      try {
        return { ok: true, payload: await response.json() };
      } catch (_error) {
        return { ok: false, status: "error_failed_closed", error: "parse_error" };
      }
    } catch (error) {
      return { ok: false, status: "error_failed_closed", error: classifyFetchError(error) };
    } finally {
      clearTimeout(timer);
    }
  }

  // One geocoded query at a given radius, with mirror failover. Fetch wider than
  // the final limit so scarce-but-important categories (scenic in a food-dense
  // centre) survive, then balance down to `boundedLimit` client-side.
  async function fetchAtRadius(lat, lng, radiusM) {
    const fetchBreadth = Math.min(boundedLimit * 6, OVERPASS_FETCH_CAP);
    const query = buildOverpassQuery({ lat, lng, radiusM, limit: fetchBreadth });
    // Try each mirror in order; fail over ONLY on a transport/parse error — a
    // genuine 200 (even with zero elements) is a real answer, not a failure.
    let last = { status: "error_failed_closed", error: "no_endpoint" };
    for (const targetEndpoint of resolvedEndpoints) {
      const attempt = await attemptOverpass(targetEndpoint, query);
      if (attempt.ok) {
        const records = mapOverpassResponse(attempt.payload, boundedLimit);
        return withLoaderStatus(records, records.length > 0 ? `loaded:${records.length}` : "loaded:0", null);
      }
      last = attempt;
    }
    return withLoaderStatus([], last.status, last.error);
  }

  const loadOpenDataAround = async function loadOpenDataAround({ lat, lng } = {}) {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return withLoaderStatus([], "loaded:0", null);

    const first = await fetchAtRadius(lat, lng, Math.round(boundedRadiusKm * 1000));

    // Thin-city aperture expansion (see EXPANSION_RADIUS_KM): reach wider once
    // when the first pass is genuinely sparse, and keep the wider result only if
    // it is actually richer. Never expands on a rich city, an error, or when
    // already at MAX_RADIUS_KM.
    if (isThinSupply(first) && boundedRadiusKm < MAX_RADIUS_KM) {
      const widerKm = Math.min(EXPANSION_RADIUS_KM, MAX_RADIUS_KM);
      const wider = await fetchAtRadius(lat, lng, Math.round(widerKm * 1000));
      if (supplyScore(wider) > supplyScore(first)) return wider;
    }
    return first;
  };

  if (!cache || typeof cache.get !== "function") {
    return loadOpenDataAround;
  }

  // Cached loader: repeat/concurrent lookups for the same anchor must not re-hit
  // Overpass (the "no public flip without persistent caching" guardrail). The key
  // buckets the anchor to ~110 m and carries the radius/limit that shaped the
  // query; the cache coalesces concurrent identical lookups and (when file-backed)
  // survives across requests. Only non-error results are stored, so a transient
  // outage is never frozen in.
  return async function cachedLoadOpenDataAround({ lat, lng } = {}) {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return loadOpenDataAround({ lat, lng });
    }
    const key = `${lat.toFixed(3)},${lng.toFixed(3)}:r${boundedRadiusKm}:l${boundedLimit}`;
    const entry = await cache.get(
      key,
      async () => {
        const result = await loadOpenDataAround({ lat, lng });
        return { records: Array.from(result), status: result.loader_status, error: result.loader_error };
      },
      { shouldStore: (value) => value && typeof value.status === "string" && !value.status.startsWith("error") },
    );
    return withLoaderStatus(entry.records, entry.status, entry.error);
  };
}

function buildOverpassQuery({ lat, lng, radiusM, limit }) {
  // Per-category `out` budgets. Overpass outputs nodes before ways, so a single
  // combined `out center N` lets food/bar/cafe NODES exhaust N before park/
  // castle WAYS are ever emitted — scarce area-typed scenic places vanished
  // server-side (#273). Grouping by category with its own `out` guarantees each
  // category contributes regardless of node/way ordering. Still one request.
  const groups = new Map();
  for (const { key, value, type } of OSM_TAG_MAP) {
    const category = TYPE_CATEGORY[type] || "other";
    if (!groups.has(category)) groups.set(category, []);
    groups.get(category).push({ key, value });
  }
  const perCategory = Math.max(6, Math.ceil(limit / groups.size));
  const blocks = [];
  let i = 0;
  for (const [category, entries] of groups) {
    const setName = `c${i}`;
    const filters = entries
      .flatMap(({ key, value }) => [
        `node["${key}"="${value}"](around:${radiusM},${lat},${lng});`,
        `way["${key}"="${value}"](around:${radiusM},${lat},${lng});`,
      ])
      .join("");
    blocks.push(`(${filters})->.${setName};.${setName} out center ${perCategory};`);
    i += 1;
  }
  return `[out:json][timeout:25];${blocks.join("")}`;
}

// Parranda type → coarse intent category, for category-balanced selection.
const TYPE_CATEGORY = {
  viewpoint: "scenic", park: "scenic", garden: "scenic", promenade: "scenic", castle: "scenic",
  restaurant: "food", "street-food": "food",
  cafe: "coffee",
  bar: "bars",
  market: "market",
  museum: "culture", gallery: "culture",
  beach: "swimming",
  "vintage-shop": "vintage",
};

function mapOverpassResponse(payload, limit) {
  if (!payload || !Array.isArray(payload.elements)) return [];
  // Map + dedupe everything Overpass returned (already bounded by the fetch
  // cap), preserving response order.
  const mapped = [];
  const seenIds = new Set();
  for (const element of payload.elements) {
    const record = mapOsmElement(element);
    if (!record) continue;
    if (seenIds.has(record.id)) continue; // exact-id dedupe inside the loader
    seenIds.add(record.id);
    mapped.push(record);
  }
  if (mapped.length <= limit) return mapped;

  // Category-balanced round-robin: a food-dense centre must not crowd out the
  // single scenic anchor. Buckets keep response order; we take one per category
  // per round until the limit is reached. Deterministic given the input order.
  const buckets = new Map();
  for (const record of mapped) {
    const category = TYPE_CATEGORY[record.type] || "other";
    if (!buckets.has(category)) buckets.set(category, []);
    buckets.get(category).push(record);
  }
  const order = [...buckets.keys()]; // first-seen category order — deterministic
  const balanced = [];
  let round = 0;
  while (balanced.length < limit) {
    let tookOne = false;
    for (const category of order) {
      const bucket = buckets.get(category);
      if (round < bucket.length) {
        balanced.push(bucket[round]);
        tookOne = true;
        if (balanced.length >= limit) break;
      }
    }
    if (!tookOne) break; // all buckets exhausted
    round += 1;
  }
  return balanced;
}

function withLoaderStatus(records, status, error) {
  const output = Array.isArray(records) ? records : [];
  Object.defineProperty(output, "loader_status", {
    value: status,
    enumerable: false,
    configurable: true,
  });
  Object.defineProperty(output, "loader_error", {
    value: error,
    enumerable: false,
    configurable: true,
  });
  return output;
}

function classifyFetchError(error) {
  const name = typeof error?.name === "string" ? error.name.toLowerCase() : "";
  const message = typeof error?.message === "string" ? error.message.toLowerCase() : "";
  if (name.includes("abort") || message.includes("abort") || message.includes("timeout")) {
    return "timeout_or_abort";
  }
  return "fetch_error";
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

  // Chain signal (#272): the OSM `brand` / `brand:wikidata` TAG is the signal —
  // never name-string matching. Chains stay valid candidates (sparse fallback);
  // downstream composition may prefer non-chain options, never ban them.
  const brandName = typeof tags.brand === "string" && tags.brand.trim() ? tags.brand.trim() : null;
  const brandWikidata = typeof tags["brand:wikidata"] === "string" && tags["brand:wikidata"].trim();
  const website = firstHttpUrl(tags.website, tags["contact:website"]);

  return {
    id: `osm-${elementType}-${osmId}`,
    name,
    type: mapping.type,
    lat: coords.lat,
    lng: coords.lng,
    tags: mapping.tags.slice(),
    sources,
    chain: Boolean(brandName || brandWikidata),
    brand: brandName,
    // Source-owned operational metadata only. It does not affect place trust or
    // ranking; the out-of-band local-event source scout may use it as a bounded
    // website seed.
    ...(website ? { website } : {}),
  };
}

function firstHttpUrl(...values) {
  for (const value of values) {
    if (typeof value !== "string" || !value.trim()) continue;
    try {
      const url = new URL(value.trim());
      if (url.protocol === "http:" || url.protocol === "https:") return url.toString();
    } catch (_error) {
      // Invalid source-owned website atoms are ignored, never repaired.
    }
  }
  return null;
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
  // Wrap the live Overpass loader in a persistent-capable cache so a deploy can
  // turn it on without re-hitting Overpass on every request. File-backed when
  // PARRANDA_CACHE_DIR is set (point it at a mounted disk to survive redeploys);
  // in-memory + de-duping otherwise.
  const ttlMs = Number(env?.PARRANDA_SOURCE_CACHE_TTL_MS);
  const cache = createSourceCache({
    namespace: "overpass",
    dir: env?.PARRANDA_CACHE_DIR || null,
    ttlMs: Number.isFinite(ttlMs) && ttlMs > 0 ? ttlMs : undefined,
  });
  // Deploy-overridable Overpass mirror set (comma-separated) for cold-load
  // failover; defaults to the built-in primary + fallback mirror.
  const endpointsRaw = String(env?.PARRANDA_OVERPASS_ENDPOINTS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const osmLoader = createOpenDataLoader({
    cache,
    ...(endpointsRaw.length ? { endpoints: endpointsRaw } : {}),
  });

  // Optional SECOND open source family: Wikidata notable places. When enabled,
  // both sources are queried (each independently cached) and concatenated; the
  // downstream entity-resolution merges OSM↔Wikidata duplicates so a place both
  // sources know carries two families (`map` + `open_knowledge`) → real
  // cross-source consensus past the single-family ceiling the reducer enforces.
  const wikiFlag = String(env?.PARRANDA_WIKIDATA_SOURCE || "").toLowerCase();
  if (wikiFlag !== "enabled" && wikiFlag !== "1" && wikiFlag !== "true") {
    return osmLoader;
  }
  // Label-language priority (local first) so Wikidata names match local OSM
  // names for entity-resolution. Configurable per deploy; multi-city per-request
  // locale resolution is a follow-up.
  const labelLanguages = String(env?.PARRANDA_WIKIDATA_LABEL_LANGS || "en")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const wikiRaw = createWikidataSource({ labelLanguages });
  if (typeof wikiRaw !== "function") return osmLoader;
  const wikiCache = createSourceCache({
    namespace: "wikidata",
    dir: env?.PARRANDA_CACHE_DIR || null,
    ttlMs: Number.isFinite(ttlMs) && ttlMs > 0 ? ttlMs : undefined,
  });
  const storeNonEmpty = { shouldStore: (value) => Array.isArray(value) && value.length > 0 };
  const wikiSource = ({ lat, lng } = {}) => {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return [];
    const key = `${lat.toFixed(3)},${lng.toFixed(3)}`;
    const cached = wikiCache.peek(key);
    if (cached) return cached;
    // WDQS cold queries are slow (~10-20s) and must NOT block the route. On a
    // cache miss, warm Wikidata out-of-band and serve OSM-only this time; the
    // next request for this anchor includes the Wikidata family from cache.
    // (Field testing revisits the same city, so cross-source consensus appears
    // on the repeat visit — without ever making a route request wait on WDQS.)
    // Only non-empty results are cached, so a transient SPARQL failure is not
    // frozen for the TTL.
    wikiCache.warm(key, () => wikiRaw({ lat, lng }), storeNonEmpty);
    return [];
  };
  return composeOpenDataLoaders(osmLoader, wikiSource);
}

// Compose the OSM loader (returns a `withLoaderStatus` array) with the Wikidata
// source (returns a plain array). Both run concurrently and fail soft on their
// own; the combined result is a `withLoaderStatus` array carrying every record.
function composeOpenDataLoaders(osmLoader, wikiSource) {
  return async function loadComposedOpenData({ lat, lng } = {}) {
    const [osm, wiki] = await Promise.all([
      Promise.resolve(osmLoader({ lat, lng })).catch(() => withLoaderStatus([], "error_failed_closed", "osm_threw")),
      Promise.resolve(wikiSource({ lat, lng })).catch(() => []),
    ]);
    const osmRecords = Array.isArray(osm) ? osm : [];
    const wikiRecords = Array.isArray(wiki) ? wiki : [];
    const records = [...osmRecords, ...wikiRecords];
    const status = records.length > 0 ? `loaded:${records.length}` : (osm.loader_status || "loaded:0");
    return withLoaderStatus(records, status, osm.loader_error || null);
  };
}

function clamp(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

module.exports = {
  DEFAULT_OVERPASS_ENDPOINT,
  DEFAULT_USER_AGENT,
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
