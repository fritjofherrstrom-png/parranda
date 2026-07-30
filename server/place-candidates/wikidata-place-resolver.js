"use strict";

/**
 * Conservative open-knowledge fallback for freeform geographic anchors.
 *
 * Wikidata is useful for colloquial regions and named areas that a street-
 * geocoder may not index. It is deliberately a FALLBACK, not a replacement for
 * Nominatim: only an exact label/alias match with a valid Earth coordinate may
 * become medium-confidence. Distant exact namesakes remain ambiguous unless
 * open-knowledge evidence clearly identifies one geographic cluster; fuzzy
 * hits stay low. A point never invents regional bounds.
 */

const { createSourceCache } = require("./source-cache");

const DEFAULT_ENDPOINT = "https://www.wikidata.org/w/api.php";
const DEFAULT_USER_AGENT = "Parranda/1.0 (+https://github.com/fritjofherrstrom-png/parranda)";
const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 8;
const MAX_LANGUAGES = 3;
const MAX_QUERY_LEN = 200;
const EARTH_GLOBE = "http://www.wikidata.org/entity/Q2";
const SAME_PLACE_CLUSTER_KM = 5;
const DOMINANT_POPULATION_RATIO = 12;
const MIN_DOMINANT_POPULATION = 50000;

function createWikidataPlaceResolver({
  fetcher = typeof globalThis.fetch === "function" ? globalThis.fetch.bind(globalThis) : null,
  endpoint = DEFAULT_ENDPOINT,
  userAgent = DEFAULT_USER_AGENT,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  limit = DEFAULT_LIMIT,
  languages = ["en", "sv"],
  cacheDir = null,
  cacheTtlMs,
} = {}) {
  if (typeof fetcher !== "function") return null;
  if (!validHttpUrl(endpoint)) return null;
  const boundedLimit = clampInt(limit, 1, MAX_LIMIT, DEFAULT_LIMIT);
  const boundedTimeoutMs = clampInt(timeoutMs, 50, 30000, DEFAULT_TIMEOUT_MS);
  const configuredLanguages = normalizeLanguages(languages);
  const cache = createSourceCache({
    namespace: "wikidata-place-resolver-v2",
    dir: cacheDir,
    ...(Number.isFinite(cacheTtlMs) ? { ttlMs: cacheTtlMs } : {}),
  });

  return async function resolveWikidataPlace(rawQuery, context = {}) {
    const query = normalizeQuery(rawQuery);
    if (!query) return [];
    const searchLanguages = normalizeLanguages([context.language, ...configuredLanguages]);
    const key = `${normalizeName(query)}:${searchLanguages.join(".")}`;
    const result = await cache.get(
      key,
      () => fetchCandidates({
        query,
        searchLanguages,
        fetcher,
        endpoint,
        userAgent,
        timeoutMs: boundedTimeoutMs,
        limit: boundedLimit,
      }),
      { shouldStore: (value) => value?.ok === true },
    );
    return clone(Array.isArray(result?.candidates) ? result.candidates : []);
  };
}

async function fetchCandidates({ query, searchLanguages, fetcher, endpoint, userAgent, timeoutMs, limit }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let successfulResolutionRound = false;
  const byId = new Map();
  try {
    for (const language of searchLanguages) {
      const hits = await searchEntities({ query, language, fetcher, endpoint, userAgent, signal: controller.signal, limit });
      if (!hits.ok) continue;
      if (!hits.rows.length) {
        successfulResolutionRound = true;
        continue;
      }
      const details = await getEntities({
        ids: hits.rows.map((row) => row.id),
        languages: searchLanguages,
        fetcher,
        endpoint,
        userAgent,
        signal: controller.signal,
      });
      if (!details.ok) continue;
      successfulResolutionRound = true;
      for (const hit of hits.rows) {
        const candidate = mapEntity(details.entities[hit.id], hit, query, searchLanguages);
        if (!candidate) continue;
        const existing = byId.get(candidate.wikidata_ref);
        if (!existing || (!existing.exact_match && candidate.exact_match)) byId.set(candidate.wikidata_ref, candidate);
      }
      if ([...byId.values()].some((candidate) => candidate.exact_match)) break;
    }
  } catch (_error) {
    return { ok: false, candidates: [] };
  } finally {
    clearTimeout(timer);
  }

  return {
    ok: successfulResolutionRound,
    candidates: classifyMappedCandidates([...byId.values()]),
  };
}

async function searchEntities({ query, language, fetcher, endpoint, userAgent, signal, limit }) {
  const url = apiUrl(endpoint, {
    action: "wbsearchentities",
    search: query,
    language,
    uselang: language,
    type: "item",
    limit: String(limit),
    format: "json",
  });
  const payload = await fetchJson(fetcher, url, userAgent, signal);
  if (!payload.ok || !Array.isArray(payload.data?.search)) return { ok: false, rows: [] };
  const rows = payload.data.search
    .map((row, index) => normalizeSearchHit(row, language, index))
    .filter(Boolean)
    .slice(0, limit);
  return { ok: true, rows };
}

async function getEntities({ ids, languages, fetcher, endpoint, userAgent, signal }) {
  const uniqueIds = [...new Set(ids.filter(isQid))].slice(0, MAX_LIMIT);
  if (!uniqueIds.length) return { ok: true, entities: {} };
  const url = apiUrl(endpoint, {
    action: "wbgetentities",
    ids: uniqueIds.join("|"),
    props: "labels|claims",
    languages: languages.join("|"),
    languagefallback: "1",
    format: "json",
  });
  const payload = await fetchJson(fetcher, url, userAgent, signal);
  if (!payload.ok || !payload.data?.entities || typeof payload.data.entities !== "object") {
    return { ok: false, entities: {} };
  }
  return { ok: true, entities: payload.data.entities };
}

async function fetchJson(fetcher, url, userAgent, signal) {
  try {
    const response = await fetcher(url, {
      method: "GET",
      headers: { "User-Agent": userAgent, Accept: "application/json" },
      signal,
    });
    if (!response || response.ok !== true) return { ok: false, data: null };
    return { ok: true, data: await response.json() };
  } catch (_error) {
    return { ok: false, data: null };
  }
}

function normalizeSearchHit(row, language, searchRank) {
  if (!row || !isQid(row.id)) return null;
  const label = compactText(row.label);
  const matchText = compactText(row.match?.text);
  if (!label && !matchText) return null;
  return {
    id: row.id,
    label,
    matchText,
    language: safeLanguage(row.match?.language) || language,
    searchRank,
  };
}

function mapEntity(entity, hit, query, languages) {
  if (!entity || entity.missing === "" || entity.missing === true) return null;
  const coordinate = firstEarthCoordinate(entity.claims?.P625);
  if (!coordinate) return null;
  const label = firstLabel(entity.labels, languages) || hit.label;
  if (!label) return null;
  const normalizedQuery = normalizeName(query);
  const exactMatch = [hit.matchText, hit.label, label].some((value) => normalizeName(value) === normalizedQuery);
  return {
    label,
    lat: coordinate.lat,
    lng: coordinate.lng,
    exact_match: exactMatch,
    search_rank: hit.searchRank,
    population: latestPopulation(entity.claims?.P1082),
    provenance: "wikidata_open_knowledge",
    attribution: "Wikidata contributors",
    license: "CC0-1.0",
    source_tier: "inferred",
    wikidata_ref: entity.id,
  };
}

function classifyMappedCandidates(mapped) {
  const ranked = [...mapped].sort((a, b) => a.search_rank - b.search_rank);
  const exactGroups = groupExactCandidates(ranked.filter((candidate) => candidate.exact_match));
  const preferredGroup = preferredExactGroup(exactGroups);
  const ambiguous = exactGroups.length > 1 && !preferredGroup;
  const exactRepresentatives = exactGroups.map((group) => ({
    candidate: group[0],
    confidence: ambiguous || preferredGroup === group || exactGroups.length === 1 ? "medium" : "low",
  }));
  const fuzzy = ranked
    .filter((candidate) => !candidate.exact_match)
    .map((candidate) => ({ candidate, confidence: "low" }));

  return [...exactRepresentatives, ...fuzzy]
    .sort((a, b) => a.candidate.search_rank - b.candidate.search_rank)
    .map(({ candidate, confidence }) => {
      const {
        exact_match: _exactMatch,
        search_rank: _searchRank,
        population: _population,
        ...publicCandidate
      } = candidate;
      return { ...publicCandidate, confidence };
    });
}

function groupExactCandidates(candidates) {
  const groups = [];
  for (const candidate of candidates) {
    const label = normalizeName(candidate.label);
    const group = groups.find((members) => {
      const representative = members[0];
      return (
        label &&
        normalizeName(representative.label) === label &&
        distanceKm(representative, candidate) <= SAME_PLACE_CLUSTER_KM
      );
    });
    if (group) group.push(candidate);
    else groups.push([candidate]);
  }
  return groups;
}

function preferredExactGroup(groups) {
  if (groups.length <= 1) return groups[0] || null;

  // Population is used only for an extreme place-resolution distinction. It
  // never ranks route candidates, and the selected anchor stays medium-trust.
  const populations = groups.map((group) => Math.max(...group.map((candidate) => candidate.population || 0)));
  if (populations.every((population) => population > 0)) {
    const ordered = populations
      .map((population, index) => ({ population, index }))
      .sort((a, b) => b.population - a.population || a.index - b.index);
    const [largest, runnerUp] = ordered;
    if (
      largest.population >= MIN_DOMINANT_POPULATION &&
      largest.population / runnerUp.population >= DOMINANT_POPULATION_RATIO
    ) {
      return groups[largest.index];
    }
  }

  // A city and its urban/administrative representation can share one exact
  // label and nearby points. Exactly one such independently represented cluster
  // can disambiguate that physical anchor from distant namesakes.
  const corroborated = groups.filter((group) => group.length > 1);
  if (corroborated.length === 1) return corroborated[0];
  return null;
}

function latestPopulation(claims) {
  const candidates = [];
  for (const claim of Array.isArray(claims) ? claims : []) {
    if (claim?.rank === "deprecated") continue;
    const amount = Number(claim?.mainsnak?.datavalue?.value?.amount);
    if (!Number.isFinite(amount) || amount <= 0) continue;
    const pointInTime = claim?.qualifiers?.P585?.[0]?.datavalue?.value?.time;
    const yearMatch = typeof pointInTime === "string" ? pointInTime.match(/^[+-](\d{4,})/) : null;
    candidates.push({
      amount,
      year: yearMatch ? Number(yearMatch[1]) : -Infinity,
      preferred: claim.rank === "preferred" ? 1 : 0,
    });
  }
  candidates.sort((a, b) => b.year - a.year || b.preferred - a.preferred || b.amount - a.amount);
  return candidates[0]?.amount || null;
}

function distanceKm(a, b) {
  const toRadians = (value) => (value * Math.PI) / 180;
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);
  const deltaLat = lat2 - lat1;
  const deltaLng = toRadians(b.lng - a.lng);
  const h =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function firstEarthCoordinate(claims) {
  for (const claim of Array.isArray(claims) ? claims : []) {
    if (claim?.rank === "deprecated") continue;
    const value = claim?.mainsnak?.datavalue?.value;
    if (!value || (value.globe && value.globe !== EARTH_GLOBE)) continue;
    const lat = Number(value.latitude);
    const lng = Number(value.longitude);
    if (validCoordinate(lat, lng)) return { lat, lng };
  }
  return null;
}

function firstLabel(labels, languages) {
  if (!labels || typeof labels !== "object") return null;
  for (const language of languages) {
    const label = compactText(labels[language]?.value);
    if (label) return label;
  }
  for (const value of Object.values(labels)) {
    const label = compactText(value?.value);
    if (label) return label;
  }
  return null;
}

function normalizeLanguages(values) {
  const out = [];
  const seen = new Set();
  for (const value of Array.isArray(values) ? values : String(values || "").split(",")) {
    const language = safeLanguage(value);
    if (!language || seen.has(language)) continue;
    seen.add(language);
    out.push(language);
    if (out.length >= MAX_LANGUAGES) break;
  }
  if (!seen.has("en") && out.length < MAX_LANGUAGES) out.push("en");
  return out.length ? out : ["en"];
}

function normalizeQuery(value) {
  if (typeof value !== "string") return null;
  const query = value.trim().replace(/\s+/g, " ");
  return query && query.length <= MAX_QUERY_LEN ? query : null;
}

function normalizeName(value) {
  if (typeof value !== "string") return "";
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function compactText(value) {
  if (typeof value !== "string") return null;
  const text = value.trim().replace(/\s+/g, " ");
  return text && text.length <= 200 ? text : null;
}

function safeLanguage(value) {
  const language = typeof value === "string" ? value.trim().toLowerCase() : "";
  return /^[a-z]{2,3}(?:-[a-z0-9]{2,8})?$/.test(language) ? language : null;
}

function apiUrl(endpoint, params) {
  const url = new URL(endpoint);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url.toString();
}

function validHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch (_error) {
    return false;
  }
}

function validCoordinate(lat, lng) {
  return Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

function isQid(value) {
  return typeof value === "string" && /^Q\d+$/.test(value);
}

function clampInt(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, Math.round(number))) : fallback;
}

function clone(value) {
  return typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value));
}

module.exports = {
  createWikidataPlaceResolver,
  normalizeLanguages,
  normalizeName,
  firstEarthCoordinate,
  DEFAULT_ENDPOINT,
  DEFAULT_USER_AGENT,
};
