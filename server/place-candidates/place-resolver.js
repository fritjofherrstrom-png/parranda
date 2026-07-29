/**
 * Production trusted place resolver (#263) — freeform place query → coordinate
 * anchor candidates, behind the existing #260 `placeResolver` seam. Nominatim
 * remains primary; an independently gated open-knowledge fallback can recover
 * exact named regions/areas that the street geocoder does not index.
 *
 * Posture (mirrors the repo's Open-Meteo / Overpass wiring):
 *   - DEFAULT-OFF. `resolveDefaultPlaceResolver(env)` returns null unless the
 *     deploy explicitly opts in via PARRANDA_PLACE_RESOLVER. So default behavior
 *     is unchanged; freeform place intake stays unavailable until configured.
 *   - This is LOW-VOLUME, user-triggered dogfood/MVP wiring. It is NOT
 *     commercial-production-cleared: OSM Nominatim's usage policy requires a
 *     valid identifying User-Agent, ~1 request/second, and client-side caching,
 *     and asks geocoding-PRIMARY services to self-host. This resolver shares the
 *     persistent-capable source cache and bounds its serial provider queue;
 *     cross-redeploy durability requires a mounted `PARRANDA_CACHE_DIR`.
 *     Higher-volume or commercial use still needs a paid or self-hosted
 *     provider. Data is © OpenStreetMap contributors under ODbL — a UI that
 *     displays it must show that attribution.
 *
 * Trust + safety:
 *   - Only this server-side resolver's output is trusted; the public payload
 *     supplies only the query string (enforced upstream in agnostic-place-intake).
 *   - Fail-closed: every empty/garbage/HTTP-error/timeout/parse-error path returns
 *     [] — never throws, never guesses, never fabricates a coordinate.
 *   - A strong or ambiguous primary result is authoritative. The fallback runs
 *     only after empty/low evidence and never invents regional bounds from a
 *     coordinate point.
 *   - Conservative confidence: we never label a result "high" (reserved for
 *     human-verified), prefer ambiguity / low-confidence over anchoring a vague
 *     match, and never use provider popularity to overstate certainty.
 *   - The resolver does not supply timezone (no coordinate→timezone lookup).
 *     Agnostic route context may derive a lower-trust timezone separately from
 *     trusted weather-provider auto metadata.
 *
 * Deterministic given its injected `fetcher` / `now` / `sleep` / cache seams
 * (tests inject these; nothing here touches the network unless a real fetcher
 * is configured).
 */

const { isValidCoordinate } = require("../planner/agnostic-place-intake");
const { normalizeNominatimSpatialScope } = require("./spatial-scope");
const { createWikidataPlaceResolver } = require("./wikidata-place-resolver");
const { createSourceCache } = require("./source-cache");
const { createHash } = require("node:crypto");

const NOMINATIM_ENDPOINT = "https://nominatim.openstreetmap.org/search";
const DEFAULT_USER_AGENT = "Parranda/1.0 (+https://github.com/fritjofherrstrom-png/parranda)";
const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 10;
const DEFAULT_CACHE_TTL_MS = 30 * 60 * 1000;
const DEFAULT_MIN_INTERVAL_MS = 1100; // honor Nominatim's ~1 req/sec, per instance
const DEFAULT_MAX_PENDING_REQUESTS = 8;
const MAX_PENDING_REQUESTS = 100;
const DEFAULT_PROVIDER_COOLDOWN_MS = 5000;
const MAX_PROVIDER_COOLDOWN_MS = 60 * 1000;
const MAX_QUERY_LEN = 200;

// Conservative confidence thresholds (tunable). Importance is OSM's popularity-ish
// score; we use it ONLY to reject clearly-junk single matches and to detect
// genuine near-ties — never to inflate confidence above "medium".
const JUNK_IMPORTANCE_FLOOR = 0.2;
const AMBIGUITY_MARGIN = 0.1;

function clampInt(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function clone(value) {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function normalizeQuery(raw) {
  if (typeof raw !== "string") return null;
  const collapsed = raw.trim().replace(/\s+/g, " ");
  if (!collapsed || collapsed.length > MAX_QUERY_LEN) return null;
  return collapsed;
}

function providerCooldownMs(response, nowMs, fallbackMs, maxMs) {
  if (![429, 503].includes(Number(response?.status))) return 0;
  const raw = response?.headers && typeof response.headers.get === "function"
    ? response.headers.get("retry-after")
    : null;
  let requestedMs = null;
  if (typeof raw === "string" && /^\d+(?:\.\d+)?$/.test(raw.trim())) {
    requestedMs = Number(raw.trim()) * 1000;
  } else if (typeof raw === "string" && raw.trim()) {
    const retryAt = Date.parse(raw);
    if (Number.isFinite(retryAt)) requestedMs = retryAt - nowMs;
  }
  const selected = Number.isFinite(requestedMs) && requestedMs > 0 ? requestedMs : fallbackMs;
  return Math.min(maxMs, Math.max(0, selected));
}

function normalizeNameForMatch(raw) {
  if (typeof raw !== "string") return null;
  const normalized = raw
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
  return normalized || null;
}

function compactAdminText(value) {
  if (typeof value !== "string") return null;
  const text = value.trim().replace(/\s+/g, " ");
  return text && text.length <= 160 ? text : null;
}

function normalizeAdminContext(address) {
  if (!address || typeof address !== "object") return null;
  const countryCode = compactAdminText(address.country_code)?.toLowerCase();
  const context = {
    locality: compactAdminText(address.city || address.town || address.village || address.hamlet),
    municipality: compactAdminText(address.municipality || address.city_district),
    county: compactAdminText(address.county),
    region: compactAdminText(address.state || address.region),
    country: compactAdminText(address.country),
    country_code: countryCode && /^[a-z]{2}$/.test(countryCode) ? countryCode : null,
  };
  return Object.values(context).some(Boolean) ? context : null;
}

function toRawCandidate(result) {
  if (!result || typeof result !== "object") return null;
  const lat = Number(result.lat);
  const lng = Number(result.lon);
  if (!isValidCoordinate(lat, lng)) return null;
  const importance =
    typeof result.importance === "number" && Number.isFinite(result.importance) ? result.importance : null;
  const label =
    typeof result.display_name === "string" && result.display_name.trim()
      ? result.display_name.trim()
      : typeof result.name === "string" && result.name.trim()
        ? result.name.trim()
        : null;
  const name = typeof result.name === "string" && result.name.trim() ? result.name.trim() : null;
  const osmRef = result.osm_type && result.osm_id ? `${result.osm_type}/${result.osm_id}` : null;
  return {
    lat,
    lng,
    importance,
    label,
    name,
    osm_ref: osmRef,
    admin_context: normalizeAdminContext(result.address),
    spatial_scope: normalizeNominatimSpatialScope(result),
  };
}

/**
 * Assign a conservative confidence to each raw candidate. Capped at "medium":
 * a single clear match anchors; genuine near-ties stay strong so the intake
 * gate reports `ambiguous_place`; vague/junk matches drop to "low".
 */
function classifyConfidences(rawCandidates, query = null) {
  if (!rawCandidates.length) return [];
  const sorted = [...rawCandidates].sort((a, b) => (b.importance ?? -1) - (a.importance ?? -1));

  if (sorted.length === 1) {
    const only = sorted[0];
    const conf = only.importance !== null && only.importance < JUNK_IMPORTANCE_FLOOR ? "low" : "medium";
    return [{ ...only, confidence: conf }];
  }

  const topImportance = sorted[0].importance;
  // No importance signal at all → trust Nominatim's ranking: anchor the top, rest low.
  if (topImportance === null) {
    return sorted.map((candidate, index) => ({ ...candidate, confidence: index === 0 ? "medium" : "low" }));
  }

  // Junk floor catches multi-result vague queries (e.g. two near-ties at
  // importance 0.05 / 0.04). Without this, the near-tie branch would promote
  // both to "medium" and the intake would fire `ambiguous_place` on junk.
  if (topImportance < JUNK_IMPORTANCE_FLOOR) {
    return sorted.map((candidate) => ({ ...candidate, confidence: "low" }));
  }

  // Nominatim commonly returns both a settlement and its surrounding
  // municipality as near-ties (for example `Simrishamn` and `Simrishamns
  // kommun`). That is one user intent, not two competing places. When exactly
  // one non-junk candidate's own name matches the complete query, prefer it and
  // keep the administrative/container result weak. Multiple exact-name matches
  // (for example distinct Springfields) remain ambiguous and fail closed in the
  // intake layer.
  const normalizedQuery = normalizeNameForMatch(query);
  const exactNameMatches = normalizedQuery
    ? sorted.filter((candidate) => normalizeNameForMatch(candidate.name) === normalizedQuery)
    : [];
  if (exactNameMatches.length === 1 && exactNameMatches[0].importance >= JUNK_IMPORTANCE_FLOOR) {
    const exactMatch = exactNameMatches[0];
    return sorted.map((candidate) => ({
      ...candidate,
      confidence: candidate === exactMatch ? "medium" : "low",
    }));
  }

  const inAnchorTier = (candidate) =>
    candidate.importance !== null && candidate.importance >= topImportance - AMBIGUITY_MARGIN;
  const anchorCount = sorted.filter(inAnchorTier).length;

  return sorted.map((candidate) => {
    if (!inAnchorTier(candidate)) return { ...candidate, confidence: "low" };
    // >= 2 near-ties → all strong (intake → ambiguous_place). A single clear
    // winner anchors as "medium" unless its importance is junk-floor low.
    if (anchorCount >= 2) return { ...candidate, confidence: "medium" };
    const conf = candidate.importance < JUNK_IMPORTANCE_FLOOR ? "low" : "medium";
    return { ...candidate, confidence: conf };
  });
}

function finalizeCandidate(candidate) {
  const out = {
    label: candidate.label,
    lat: candidate.lat,
    lng: candidate.lng,
    confidence: candidate.confidence,
    // Compact provenance/attribution/license — sufficient for downstream trust;
    // raw provider fields are dropped. A separately normalized spatial scope may
    // preserve validated bounds without exposing the Nominatim response shape.
    provenance: "nominatim_osm",
    attribution: "© OpenStreetMap contributors",
    license: "ODbL",
    source_tier: "inferred",
    osm_ref: candidate.osm_ref,
    // Deliberately NO timezone — the resolver does not do coordinate→timezone lookup.
  };
  if (candidate.admin_context) out.admin_context = candidate.admin_context;
  if (candidate.spatial_scope) out.spatial_scope = candidate.spatial_scope;
  return out;
}

/**
 * Build a Nominatim-backed place resolver. Returns `async (query) => candidates[]`.
 */
function createNominatimPlaceResolver({
  fetcher = typeof globalThis.fetch === "function" ? globalThis.fetch.bind(globalThis) : null,
  endpoint = NOMINATIM_ENDPOINT,
  userAgent = DEFAULT_USER_AGENT,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  limit = DEFAULT_LIMIT,
  cacheTtlMs = DEFAULT_CACHE_TTL_MS,
  cacheDir = null,
  sourceCache = null,
  minIntervalMs = DEFAULT_MIN_INTERVAL_MS,
  maxPendingRequests = DEFAULT_MAX_PENDING_REQUESTS,
  providerCooldownMs: fallbackProviderCooldownMs = DEFAULT_PROVIDER_COOLDOWN_MS,
  maxProviderCooldownMs = MAX_PROVIDER_COOLDOWN_MS,
  now = () => Date.now(),
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
} = {}) {
  const clampedLimit = clampInt(limit, 1, MAX_LIMIT, DEFAULT_LIMIT);
  const clampedMaxPending = clampInt(
    maxPendingRequests,
    1,
    MAX_PENDING_REQUESTS,
    DEFAULT_MAX_PENDING_REQUESTS,
  );
  // Pre-validate the configured endpoint ONCE. An invalid endpoint makes the
  // resolver fail closed (return []) without ever calling fetch — never throws.
  let endpointValid = true;
  try {
    // eslint-disable-next-line no-new
    new URL(endpoint);
  } catch (_error) {
    endpointValid = false;
  }
  const endpointIdentity = createHash("sha256")
    .update(`${endpoint}|limit:${clampedLimit}`)
    .digest("hex")
    .slice(0, 16);
  const cache = sourceCache || createSourceCache({
    namespace: "place-resolver-nominatim-v1",
    ttlMs: cacheTtlMs,
    dir: cacheDir,
    now,
  });
  // Per-instance provider state: a single global rate gate plus a bounded FIFO.
  // The cache coalesces identical misses before they reach this queue.
  let nextSlot = 0;
  let cooldownUntil = 0;
  let queueActive = false;
  const requestQueue = [];

  // fetchAndMap distinguishes provider SUCCESS from FAILURE so the caller only
  // caches successes. A successful 200 (including a legitimate empty array) is
  // cacheable; any http-non-ok / network / timeout / parse / malformed failure is
  // NOT cacheable (so a transient blip never poison-caches `[]` for the TTL).
  // The public contract still returns `candidates[]` and fails closed.
  async function fetchAndMapQueued(query) {
    if (typeof fetcher !== "function") return { ok: false, candidates: [] };

    // Global rate gate: distinct queries are serialized so a provider cooldown
    // learned from one response also protects queries that were already queued.
    const current = now();
    const start = Math.max(current, nextSlot, cooldownUntil);
    nextSlot = start + minIntervalMs;
    const wait = start - current;
    if (wait > 0) await sleep(wait);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      // URL construction is inside the try so a bad endpoint fails closed too.
      const url = new URL(endpoint);
      url.searchParams.set("q", query);
      url.searchParams.set("format", "jsonv2");
      // A compact allowlisted subset becomes trusted server-side place context
      // for source-family discovery. The raw address never leaves this module.
      url.searchParams.set("addressdetails", "1");
      url.searchParams.set("limit", String(clampedLimit));

      const response = await fetcher(url.toString(), {
        signal: controller.signal,
        headers: { "User-Agent": userAgent, Accept: "application/json" },
      });
      if (!response || !response.ok) {
        const cooldownMs = providerCooldownMs(
          response,
          now(),
          clampInt(fallbackProviderCooldownMs, 0, MAX_PROVIDER_COOLDOWN_MS, DEFAULT_PROVIDER_COOLDOWN_MS),
          clampInt(maxProviderCooldownMs, 0, MAX_PROVIDER_COOLDOWN_MS, MAX_PROVIDER_COOLDOWN_MS),
        );
        if (cooldownMs > 0) cooldownUntil = Math.max(cooldownUntil, now() + cooldownMs);
        return { ok: false, candidates: [] };
      }
      const data = await response.json();
      if (!Array.isArray(data)) return { ok: false, candidates: [] };
      const raw = data.map(toRawCandidate).filter(Boolean);
      return { ok: true, candidates: classifyConfidences(raw, query).map(finalizeCandidate) };
    } catch (_error) {
      return { ok: false, candidates: [] };
    } finally {
      clearTimeout(timer);
    }
  }

  async function drainQueue() {
    if (queueActive) return;
    queueActive = true;
    try {
      while (requestQueue.length) {
        const entry = requestQueue.shift();
        let result;
        try {
          result = await fetchAndMapQueued(entry.query);
        } catch (_error) {
          result = { ok: false, candidates: [] };
        }
        entry.resolve(result);
      }
    } finally {
      queueActive = false;
      // A producer may enqueue between the final length check and this finally.
      if (requestQueue.length) void drainQueue();
    }
  }

  function fetchAndMap(query) {
    const pendingCount = requestQueue.length + (queueActive ? 1 : 0);
    if (pendingCount >= clampedMaxPending) {
      return Promise.resolve({ ok: false, candidates: [] });
    }
    return new Promise((resolve) => {
      requestQueue.push({ query, resolve });
      void drainQueue();
    });
  }

  return async function resolvePlace(rawQuery) {
    const query = normalizeQuery(rawQuery);
    if (!query) return [];
    // An invalid configured endpoint fails closed without ever calling fetch.
    if (!endpointValid) return [];
    const queryIdentity = createHash("sha256").update(query.toLowerCase()).digest("hex");
    const key = `v1:${endpointIdentity}:${queryIdentity}`;
    const result = await cache.get(
      key,
      () => fetchAndMap(query),
      { shouldStore: (value) => value && value.ok === true },
    );
    return clone(Array.isArray(result?.candidates) ? result.candidates : []);
  };
}

/**
 * Env-gated default factory (mirrors resolveDefaultOpenDataLoader). Returns null
 * unless the deploy opts in via PARRANDA_PLACE_RESOLVER. The Wikidata fallback
 * has its own PARRANDA_WIKIDATA_PLACE_RESOLVER gate. `overrides` is a small test
 * seam (e.g. inject deterministic provider functions).
 */
function resolveDefaultPlaceResolver(env = process.env, overrides = {}) {
  const flag = String((env && env.PARRANDA_PLACE_RESOLVER) ?? "").trim().toLowerCase();
  if (!["enabled", "1", "true"].includes(flag)) return null;
  const userAgent =
    (env && typeof env.PARRANDA_PLACE_RESOLVER_USER_AGENT === "string" && env.PARRANDA_PLACE_RESOLVER_USER_AGENT.trim()) ||
    DEFAULT_USER_AGENT;
  const endpoint =
    (env && typeof env.PARRANDA_PLACE_RESOLVER_ENDPOINT === "string" && env.PARRANDA_PLACE_RESOLVER_ENDPOINT.trim()) ||
    NOMINATIM_ENDPOINT;
  const timeoutMs = clampInt(env && env.PARRANDA_PLACE_RESOLVER_TIMEOUT_MS, 50, 30000, DEFAULT_TIMEOUT_MS);
  const cacheTtlMs = clampInt(
    env && env.PARRANDA_PLACE_RESOLVER_CACHE_TTL_MS,
    0,
    7 * 24 * 60 * 60 * 1000,
    DEFAULT_CACHE_TTL_MS,
  );
  const maxPendingRequests = clampInt(
    env && env.PARRANDA_PLACE_RESOLVER_MAX_PENDING_REQUESTS,
    1,
    MAX_PENDING_REQUESTS,
    DEFAULT_MAX_PENDING_REQUESTS,
  );
  const {
    fallbackResolver: injectedFallbackResolver,
    wikidataFetcher,
    wikidataEndpoint,
    wikidataLanguages,
    ...nominatimOverrides
  } = overrides;
  const primaryResolver = createNominatimPlaceResolver({
    userAgent,
    endpoint,
    timeoutMs,
    cacheTtlMs,
    cacheDir: env && env.PARRANDA_CACHE_DIR,
    maxPendingRequests,
    ...nominatimOverrides,
  });
  const fallbackFlag = String((env && env.PARRANDA_WIKIDATA_PLACE_RESOLVER) ?? "").trim().toLowerCase();
  if (!["enabled", "1", "true"].includes(fallbackFlag)) return primaryResolver;
  const configuredLanguages = wikidataLanguages || String(
    (env && env.PARRANDA_PLACE_RESOLVER_LANGS) || "en,sv",
  ).split(",");
  const fallbackResolver = typeof injectedFallbackResolver === "function"
    ? injectedFallbackResolver
    : createWikidataPlaceResolver({
        fetcher: wikidataFetcher,
        endpoint: wikidataEndpoint,
        userAgent,
        timeoutMs: clampInt(
          env && env.PARRANDA_WIKIDATA_PLACE_RESOLVER_TIMEOUT_MS,
          50,
          30000,
          DEFAULT_TIMEOUT_MS,
        ),
        languages: configuredLanguages,
        cacheDir: env && env.PARRANDA_CACHE_DIR,
      });
  return composePlaceResolvers(primaryResolver, fallbackResolver);
}

function composePlaceResolvers(primaryResolver, fallbackResolver) {
  if (typeof primaryResolver !== "function") return typeof fallbackResolver === "function" ? fallbackResolver : null;
  if (typeof fallbackResolver !== "function") return primaryResolver;
  return async function resolveAcrossSources(query, context = {}) {
    let primary = [];
    try {
      const result = await primaryResolver(query, context);
      primary = normalizeResolverCandidates(result);
    } catch (_error) {
      primary = [];
    }
    // A strong primary set includes intentional ambiguity. Keep it intact so
    // the shared intake can fail closed instead of asking a fallback to choose.
    if (primary.some(hasAnchorConfidence)) return primary;

    let fallback = [];
    try {
      const result = await fallbackResolver(query, context);
      fallback = normalizeResolverCandidates(result);
    } catch (_error) {
      fallback = [];
    }
    if (fallback.some(hasAnchorConfidence)) return fallback;
    return primary.length ? primary : fallback;
  };
}

function normalizeResolverCandidates(value) {
  if (Array.isArray(value)) return value.filter((candidate) => candidate && typeof candidate === "object");
  return value && typeof value === "object" ? [value] : [];
}

function hasAnchorConfidence(candidate) {
  return ["high", "medium"].includes(String(candidate?.confidence || "").toLowerCase());
}

module.exports = {
  createNominatimPlaceResolver,
  composePlaceResolvers,
  resolveDefaultPlaceResolver,
  DEFAULT_USER_AGENT,
  DEFAULT_MAX_PENDING_REQUESTS,
};
