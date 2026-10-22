"use strict";

/**
 * Event venues near a place, as website seeds for Live source discovery.
 *
 * Live does not need a list of event calendars per city. The places that hold
 * events (stages, concert halls, clubs, cinemas, arts and cultural centres,
 * libraries, museums) publish their own programmes, and Wikidata (CC0) names
 * them with an official website (P856) and coordinates. One bounded
 * `wikibase:around` query per ~1 km cell finds them for any place.
 *
 * A seed is only a place to look. The ordinary scout, robots policy, manifest
 * binding and event gates still decide everything; no confidence, route trust
 * or event fact comes from this lookup.
 */

const { createHash } = require("node:crypto");
const { createSourceCache } = require("../place-candidates/source-cache");

const DEFAULT_ENDPOINT = "https://query.wikidata.org/sparql";
const DEFAULT_USER_AGENT = "Parranda/1.0 (+https://github.com/fritjofherrstrom-png/parranda)";
const DEFAULT_RADIUS_KM = 3;
const MAX_RADIUS_KM = 8;
const QUERY_LIMIT = 120;
const MAX_SEEDS = 40;
// Venues and their websites change slowly; a cell is looked up once a week.
const TTL_MS = 7 * 24 * 60 * 60 * 1000;
// A cold WDQS area query can take 10–30 s. It runs inside the out-of-band Live
// collection, never in front of the day.
const DEFAULT_TIMEOUT_MS = 30_000;

// Instance of the class or of a direct subclass, ranked by how often such a
// venue's own site carries its programme (Berlin probe, 2026-10-18). The broad
// "venue" class also holds corporate and conference sites, so it ranks last.
const VENUE_CLASSES = Object.freeze([
  { qid: "Q1060829", kind: "concert_hall", rank: 0 },
  { qid: "Q153562", kind: "opera_house", rank: 0 },
  { qid: "Q24354", kind: "theatre", rank: 0 },
  { qid: "Q57660343", kind: "performing_arts_building", rank: 0 },
  { qid: "Q8719053", kind: "music_venue", rank: 0 },
  { qid: "Q622425", kind: "nightclub", rank: 0 },
  { qid: "Q131183", kind: "cabaret", rank: 0 },
  { qid: "Q2190251", kind: "arts_centre", rank: 0 },
  { qid: "Q1329623", kind: "cultural_centre", rank: 1 },
  { qid: "Q41253", kind: "cinema", rank: 1 },
  { qid: "Q641226", kind: "arena", rank: 1 },
  { qid: "Q7075", kind: "library", rank: 2 },
  { qid: "Q33506", kind: "museum", rank: 2 },
  { qid: "Q1007870", kind: "art_gallery", rank: 2 },
  { qid: "Q17350442", kind: "venue", rank: 2 },
]);
const CLASS_BY_QID = new Map(VENUE_CLASSES.map((entry) => [entry.qid, entry]));

function clamp(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
}

function validPoint(value) {
  return Number.isFinite(value?.lat) && Number.isFinite(value?.lng) &&
    Math.abs(value.lat) <= 90 && Math.abs(value.lng) <= 180;
}

function coordinateNumber(value) {
  if (typeof value !== "number" && (typeof value !== "string" || !value.trim())) return NaN;
  return Number(value);
}

// One row per venue: its best class rank, one website, its coordinate and
// distance, nearest first within each rank, so the limit keeps the venues most
// likely to publish a programme rather than the nearest rows of any kind.
function buildVenueQuery({ lat, lng, radiusKm, limit = QUERY_LIMIT }) {
  const classes = VENUE_CLASSES.map((entry) => `(wd:${entry.qid} ${entry.rank})`).join(" ");
  return `SELECT ?item (SAMPLE(?name) AS ?itemLabel) (MIN(?rank) AS ?bestRank)
  (GROUP_CONCAT(DISTINCT STR(?class); separator=" ") AS ?classes)
  (SAMPLE(?site) AS ?website) (SAMPLE(?pointLat) AS ?lat) (SAMPLE(?pointLng) AS ?lng) (MIN(?distance) AS ?dist) WHERE {
  VALUES (?class ?rank) { ${classes} }
  SERVICE wikibase:around {
    ?item wdt:P625 ?location .
    bd:serviceParam wikibase:center "Point(${lng} ${lat})"^^geo:wktLiteral .
    bd:serviceParam wikibase:radius "${radiusKm}" .
    bd:serviceParam wikibase:distance ?distance .
  }
  ?item wdt:P31/wdt:P279? ?class ; wdt:P856 ?site .
  FILTER NOT EXISTS { ?item wdt:P576 ?dissolved . }
  FILTER NOT EXISTS { ?item wdt:P3999 ?closed . }
  BIND(geof:latitude(?location) AS ?pointLat)
  BIND(geof:longitude(?location) AS ?pointLng)
  OPTIONAL { ?item rdfs:label ?name . FILTER(LANG(?name) IN ("mul", "en")) }
} GROUP BY ?item ORDER BY ?bestRank ?dist LIMIT ${limit}`;
}

function publicWebsite(value) {
  if (typeof value !== "string" || value.length > 500) return null;
  try {
    const url = new URL(value.trim());
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return null;
    const host = url.hostname.toLowerCase();
    if (!host.includes(".") || host === "localhost" || host.endsWith(".localhost") || /^[\d.]+$/.test(host)) return null;
    url.hash = "";
    return url.href;
  } catch (_error) {
    return null;
  }
}

const siteHost = (url) => new URL(url).hostname.toLowerCase().replace(/^www\./, "");

// One seed per item and per website (a library network or a venue group shares
// one site), nearest first within each rank. Rows without a usable website,
// coordinate or known class are dropped, never repaired.
function venueSeedsFromBindings(bindings, { maxSeeds = MAX_SEEDS } = {}) {
  const items = new Map();
  for (const row of Array.isArray(bindings) ? bindings : []) {
    const qid = String(row?.item?.value || "").split("/").pop();
    const classes = String(row?.classes?.value || row?.class?.value || "").split(/\s+/)
      .map((value) => CLASS_BY_QID.get(value.split("/").pop())).filter(Boolean)
      .sort((a, b) => a.rank - b.rank);
    const venueClass = classes[0];
    const url = publicWebsite(row?.website?.value);
    const lat = coordinateNumber(row?.lat?.value);
    const lng = coordinateNumber(row?.lng?.value);
    const distanceKm = Number(row?.dist?.value);
    if (!/^Q\d+$/.test(qid) || !venueClass || !url || !validPoint({ lat, lng })) continue;
    const label = typeof row?.itemLabel?.value === "string" && row.itemLabel.value.trim() && row.itemLabel.value !== qid
      ? row.itemLabel.value.trim().slice(0, 160) : null;
    const current = items.get(qid);
    if (current && current.rank <= venueClass.rank) continue;
    items.set(qid, {
      url, label, lat, lng, qid, kind: venueClass.kind, rank: venueClass.rank,
      distanceKm: Number.isFinite(distanceKm) ? distanceKm : Infinity,
    });
  }
  const seeds = [];
  const hosts = new Set();
  for (const item of [...items.values()].sort((a, b) =>
    a.rank - b.rank || a.distanceKm - b.distanceKm || a.qid.localeCompare(b.qid))) {
    const host = siteHost(item.url);
    if (hosts.has(host)) continue;
    hosts.add(host);
    seeds.push({
      url: item.url,
      label: item.label,
      lat: item.lat,
      lng: item.lng,
      family: "venue",
      venue_kind: item.kind,
      wikidata_ref: item.qid,
      trust_tier: "inferred",
      discovery_method: "wikidata_venue_website",
    });
    if (seeds.length >= maxSeeds) break;
  }
  return seeds;
}

function createEventVenueSeeds({
  endpoint = DEFAULT_ENDPOINT,
  fetcher = typeof globalThis.fetch === "function" ? globalThis.fetch.bind(globalThis) : null,
  cache = createSourceCache({ namespace: "event-venue-seeds-v2", ttlMs: TTL_MS }),
  timeoutMs = DEFAULT_TIMEOUT_MS,
  userAgent = DEFAULT_USER_AGENT,
} = {}) {
  if (typeof fetcher !== "function") return null;
  const budgetMs = clamp(timeoutMs, 100, 60_000, DEFAULT_TIMEOUT_MS);

  // Resolves to { status: "ok" | "failed", reason, seeds }; never throws.
  return async function eventVenueSeeds({ anchor, radiusKm = DEFAULT_RADIUS_KM } = {}) {
    if (!validPoint(anchor)) return { status: "failed", reason: "invalid_anchor", seeds: [] };
    const radius = clamp(radiusKm, 0.5, MAX_RADIUS_KM, DEFAULT_RADIUS_KM);
    const center = { lat: Math.round(anchor.lat * 100) / 100, lng: Math.round(anchor.lng * 100) / 100 };
    // Include the validation version even with an operator-supplied cache.
    const key = createHash("sha256").update(JSON.stringify([2, endpoint, center, radius])).digest("hex").slice(0, 32);
    try {
      return await cache.get(key, () => lookup(center, radius), { shouldStore: (value) => value?.status === "ok" });
    } catch (_error) {
      return { status: "failed", reason: "venue_lookup_failed", seeds: [] };
    }
  };

  async function lookup(center, radiusKm) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), budgetMs);
    try {
      const url = `${endpoint}?format=json&query=${encodeURIComponent(buildVenueQuery({ ...center, radiusKm }))}`;
      const response = await fetcher(url, {
        headers: { "User-Agent": userAgent, Accept: "application/sparql-results+json" },
        signal: controller.signal,
      });
      if (!response?.ok) return { status: "failed", reason: `venue_lookup_http_${Number(response?.status) || 0}`, seeds: [] };
      const body = await response.json();
      if (!Array.isArray(body?.results?.bindings)) return { status: "failed", reason: "venue_lookup_invalid", seeds: [] };
      return { status: "ok", reason: null, seeds: venueSeedsFromBindings(body.results.bindings) };
    } catch (error) {
      return { status: "failed", reason: error?.name === "AbortError" ? "venue_lookup_timeout" : "venue_lookup_failed", seeds: [] };
    } finally {
      clearTimeout(timer);
    }
  }
}

function venueSeedsEnabled(env = process.env) {
  const setting = String(env?.PARRANDA_EVENT_VENUE_SEEDS || "").trim().toLowerCase();
  if (["disabled", "0", "false", "off", "no"].includes(setting)) return false;
  if (["enabled", "1", "true", "on", "yes"].includes(setting)) return true;
  // Default: on wherever request-time discovery is configured (the source search).
  return ["enabled", "1", "true", "on", "yes"].includes(String(env?.PARRANDA_SOURCE_SEARCH || "").trim().toLowerCase());
}

function resolveDefaultEventVenueSeeds(env = process.env, options = {}) {
  if (!venueSeedsEnabled(env)) return null;
  return createEventVenueSeeds({
    endpoint: env?.PARRANDA_EVENT_VENUE_SEEDS_ENDPOINT || DEFAULT_ENDPOINT,
    ...(options.fetcher ? { fetcher: options.fetcher } : {}),
    ...(options.cache ? { cache: options.cache } : {}),
  });
}

module.exports = {
  VENUE_CLASSES,
  buildVenueQuery,
  createEventVenueSeeds,
  resolveDefaultEventVenueSeeds,
  venueSeedsFromBindings,
};
