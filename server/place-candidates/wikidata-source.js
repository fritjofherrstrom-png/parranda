"use strict";

/**
 * Wikidata open-knowledge place source — the second open source FAMILY.
 *
 * OSM (the open-data loader) is one source family (`map`). The evidence reducer
 * only lifts a candidate's existence confidence when INDEPENDENT families agree;
 * a single-family external record stays weak and is gated out of default
 * surfaces. This source adds a genuinely independent `open_knowledge` family:
 * notable places near an anchor from Wikidata (CC0). When the same real-world
 * place is returned by BOTH OSM and Wikidata, entity-resolution merges them and
 * the candidate carries two families → real cross-source consensus.
 *
 * Hard-won scoping (verified against live api/query.wikidata.org for Athens):
 *   - Wikidata's strength is NOTABLE/encyclopedic places (museums, galleries,
 *     parks, gardens, castles, markets), NOT the everyday walkable fabric OSM
 *     covers. A naive `wikibase:around` returns people, events and abstract
 *     entities; even typed it is dominated by archaeological-excavation rows and
 *     the settlement itself. So we constrain to a CURATED set of place classes
 *     that (a) map cleanly to types the engine already understands and (b)
 *     overlap OSM (so consensus can fire), and we EXCLUDE the noise classes
 *     (archaeological sites / settlements / generic "tourist attraction").
 *   - Local-language label preferred (Athens OSM names are Greek; an English-only
 *     label would never match the 75 m + name entity-resolution).
 *   - Same record shape + trust posture as the OSM loader: source_family
 *     "open_knowledge", tier "inferred", city_pack_owned:false,
 *     human_verified:false, CC0 attribution. Bounded, fail-closed, no throw.
 *   - NO network in tests: `fetcher` is injectable.
 */

const DEFAULT_WIKIDATA_ENDPOINT = "https://query.wikidata.org/sparql";
const DEFAULT_USER_AGENT = "Parranda/1.0 (+https://github.com/fritjofherrstrom-png/parranda)";
const DEFAULT_RADIUS_KM = 1.5;
const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 60;
const MAX_RADIUS_KM = 5;
// WDQS can be slow on a COLD query for an area (~10-30s) and fast once warm
// (~300ms). This source runs OUT OF BAND (background cache warm, never in the
// request path — see open-data-loader composition), so a generous budget is
// fine: it lets the cold query finish and populate the cache instead of being
// aborted, after which every repeat visit is an instant cache hit.
const DEFAULT_TIMEOUT_MS = 30000;

// Curated P31/P279* root classes → Parranda type. Each TARGET type is one the
// OSM loader + intent vocabulary already understand, so a Wikidata candidate is
// treated identically downstream. Classes that produced noise in the live probe
// (archaeological site, settlement, generic tourist attraction, raw squares) are
// deliberately absent.
const WIKIDATA_CLASS_MAP = [
  { qid: "Q33506", type: "museum" }, // museum (+ art museum etc. via P279*)
  { qid: "Q1007870", type: "gallery" }, // art gallery
  { qid: "Q22698", type: "park" }, // park
  { qid: "Q167346", type: "garden" }, // botanical garden
  { qid: "Q23413", type: "castle" }, // castle
  { qid: "Q57821", type: "castle" }, // fortification
  { qid: "Q330284", type: "market" }, // marketplace
  { qid: "Q1773153", type: "viewpoint" }, // observation deck
];

const CLASS_TYPE_BY_QID = new Map(WIKIDATA_CLASS_MAP.map((c) => [c.qid, c.type]));

function clamp(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

function dedupeLanguages(languages) {
  const out = [];
  const seen = new Set();
  for (const lang of Array.isArray(languages) ? languages : []) {
    const code = String(lang || "").trim().toLowerCase().slice(0, 8);
    if (code && !seen.has(code)) {
      seen.add(code);
      out.push(code);
    }
  }
  if (!seen.has("en")) out.push("en"); // English is the universal fallback
  return out;
}

// Build a bounded, typed `wikibase:around` query. `labelLangs` is a priority
// list (local language first) so the chosen name matches the local OSM name.
function buildWikidataQuery({ lat, lng, radiusKm, limit, labelLangs }) {
  const values = WIKIDATA_CLASS_MAP.map((c) => `wd:${c.qid}`).join(" ");
  const labelPriority = `${labelLangs.join(",")}`;
  // `?classRoot` is bound to the matched curated root so we can map type → engine
  // type deterministically (P279* may walk through many intermediate classes).
  return `SELECT ?item ?itemLabel ?lat ?lng ?classRoot ?website WHERE {
  SERVICE wikibase:around {
    ?item wdt:P625 ?aroundLoc .
    bd:serviceParam wikibase:center "Point(${lng} ${lat})"^^geo:wktLiteral .
    bd:serviceParam wikibase:radius "${radiusKm}" .
    bd:serviceParam wikibase:distance ?dist .
  }
  VALUES ?classRoot { ${values} }
  ?item wdt:P31/wdt:P279* ?classRoot .
  ?item wdt:P625 ?pt .
  OPTIONAL { ?item wdt:P856 ?website . }
  BIND(geof:latitude(?pt) AS ?lat)
  BIND(geof:longitude(?pt) AS ?lng)
  SERVICE wikibase:label { bd:serviceParam wikibase:language "${labelPriority}" . }
}
ORDER BY ?dist
LIMIT ${limit}`;
}

function isQid(value) {
  return typeof value === "string" && /^Q\d+$/.test(value);
}

function qidFromUri(uri) {
  const tail = String(uri || "").split("/").pop();
  return isQid(tail) ? tail : null;
}

// Map one SPARQL result binding → a Parranda external record (OSM-loader shape).
function mapWikidataBinding(binding) {
  if (!binding || typeof binding !== "object") return null;
  const qid = qidFromUri(binding.item && binding.item.value);
  if (!qid) return null;

  const name = binding.itemLabel && typeof binding.itemLabel.value === "string" ? binding.itemLabel.value.trim() : "";
  // The label service returns the QID itself as the label when no label exists
  // in any requested language — that is not a usable place name.
  if (!name || name === qid) return null;

  const lat = Number(binding.lat && binding.lat.value);
  const lng = Number(binding.lng && binding.lng.value);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  const classRoot = qidFromUri(binding.classRoot && binding.classRoot.value);
  const type = classRoot ? CLASS_TYPE_BY_QID.get(classRoot) : null;
  if (!type) return null; // unmapped class → drop (defensive; query already filters)
  const website = normalizePublicWebsite(binding.website && binding.website.value);

  return {
    id: `wikidata-${qid}`,
    name,
    type,
    lat,
    lng,
    tags: [],
    sources: [
      {
        provider: "wikidata",
        family: "open_knowledge",
        tier: "inferred",
        url: `https://www.wikidata.org/wiki/${qid}`,
        license: "CC0-1.0",
      },
    ],
    city_pack_owned: false,
    human_verified: false,
    // P856 is source-owned operational metadata. It never raises confidence;
    // the background local-event scout may use it as a bounded website seed.
    ...(website ? { website } : {}),
  };
}

function normalizePublicWebsite(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch (_error) {
    return null;
  }
}

function mapWikidataResponse(payload, limit) {
  const bindings = payload && payload.results && Array.isArray(payload.results.bindings) ? payload.results.bindings : [];
  const out = [];
  const seen = new Set();
  for (const binding of bindings) {
    const record = mapWikidataBinding(binding);
    if (!record || seen.has(record.id)) continue;
    seen.add(record.id);
    out.push(record);
    if (out.length >= limit) break;
  }
  return out;
}

function classifyFetchError(error) {
  if (error && error.name === "AbortError") return "timeout_or_abort";
  return "network_error";
}

/**
 * Create the Wikidata place source. Returns `async ({lat,lng}) → records[]`
 * (plain array; fail-closed to []), or null when no fetcher is available.
 */
function createWikidataSource({
  fetcher = typeof globalThis.fetch === "function" ? globalThis.fetch.bind(globalThis) : null,
  endpoint = DEFAULT_WIKIDATA_ENDPOINT,
  radiusKm = DEFAULT_RADIUS_KM,
  limit = DEFAULT_LIMIT,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  userAgent = DEFAULT_USER_AGENT,
  labelLanguages = ["en"],
} = {}) {
  if (typeof fetcher !== "function") {
    return null;
  }
  const boundedRadiusKm = clamp(radiusKm, 0.1, MAX_RADIUS_KM);
  const boundedLimit = Math.max(1, Math.min(Math.floor(limit), MAX_LIMIT));
  const boundedTimeoutMs = Math.max(50, Math.floor(timeoutMs));
  const labelLangs = dedupeLanguages(labelLanguages);

  return async function loadWikidataAround({ lat, lng } = {}) {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return [];

    const query = buildWikidataQuery({ lat, lng, radiusKm: boundedRadiusKm, limit: boundedLimit, labelLangs });
    const url = `${endpoint}?format=json&query=${encodeURIComponent(query)}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), boundedTimeoutMs);
    try {
      const response = await fetcher(url, {
        method: "GET",
        headers: { "User-Agent": userAgent, Accept: "application/sparql-results+json" },
        signal: controller.signal,
      });
      if (!response || response.ok !== true) return [];
      let payload;
      try {
        payload = await response.json();
      } catch (_error) {
        return [];
      }
      return mapWikidataResponse(payload, boundedLimit);
    } catch (_error) {
      void classifyFetchError(_error);
      return []; // fail closed: never throw, never hallucinate
    } finally {
      clearTimeout(timer);
    }
  };
}

module.exports = {
  createWikidataSource,
  buildWikidataQuery,
  mapWikidataResponse,
  mapWikidataBinding,
  WIKIDATA_CLASS_MAP,
  DEFAULT_WIKIDATA_ENDPOINT,
  DEFAULT_RADIUS_KM,
  DEFAULT_LIMIT,
  MAX_LIMIT,
  MAX_RADIUS_KM,
};
