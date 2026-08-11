"use strict";

/**
 * Bounded discovery-only web search for the background source scout.
 *
 * Search results are untrusted website seeds. They still have to pass the
 * existing robots, terms, parser, review and multi-day qualification gates.
 * This module never returns events, feeds, candidates or activation state.
 */

const { createHash } = require("node:crypto");

const {
  isScoutablePublicUrl,
  normalizeHttpUrl,
  readBoundedText,
} = require("./local-event-source-scout");

const DEFAULT_MAX_QUERIES = 6;
const MAX_QUERIES = 10;
const DEFAULT_MAX_RESULTS_PER_QUERY = 5;
const MAX_RESULTS_PER_QUERY = 8;
const DEFAULT_MAX_SEEDS = 18;
const MAX_SEEDS = 30;
const DEFAULT_MAX_RESULTS_PER_ORIGIN = 2;
const DEFAULT_TIMEOUT_MS = 7000;
const DEFAULT_MAX_BYTES = 512 * 1024;
const DEFAULT_USER_AGENT =
  "Parranda-Source-Search/1.0 (+https://github.com/fritjofherrstrom-png/parranda)";

function createSearxngSourceSearch({
  endpoint,
  fetcher = typeof globalThis.fetch === "function" ? globalThis.fetch.bind(globalThis) : null,
  cache = null,
  maxQueries = DEFAULT_MAX_QUERIES,
  maxResultsPerQuery = DEFAULT_MAX_RESULTS_PER_QUERY,
  maxSeeds = DEFAULT_MAX_SEEDS,
  maxResultsPerOrigin = DEFAULT_MAX_RESULTS_PER_ORIGIN,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxBytes = DEFAULT_MAX_BYTES,
  userAgent = DEFAULT_USER_AGENT,
} = {}) {
  const normalizedEndpoint = normalizeOperatorEndpoint(endpoint);
  if (!normalizedEndpoint || typeof fetcher !== "function") return null;

  const endpointOrigin = new URL(normalizedEndpoint).origin;
  const queryLimit = clampInteger(maxQueries, 1, MAX_QUERIES);
  const perQueryLimit = clampInteger(maxResultsPerQuery, 1, MAX_RESULTS_PER_QUERY);
  const seedLimit = clampInteger(maxSeeds, 1, MAX_SEEDS);
  const perOriginLimit = clampInteger(maxResultsPerOrigin, 1, 4);

  return async function searchSourceSeeds({ queries = [], place = {} } = {}) {
    const boundedQueries = uniqueStrings(queries).slice(0, queryLimit);
    if (!boundedQueries.length) return emptyOutcome("source_search_queries_missing");

    const language = firstString(place?.language_hints?.[0], "auto");
    const queryOutcomes = [];
    const found = [];

    // Sequential by design: the worker is off-request and must stay polite to
    // a shared/self-hosted metasearch service.
    for (const query of boundedQueries) {
      const key = searchCacheKey(normalizedEndpoint, query, language);
      const producer = () => fetchSearxngQuery({
        endpoint: normalizedEndpoint,
        endpointOrigin,
        query,
        language,
        fetcher,
        timeoutMs,
        maxBytes,
        userAgent,
        limit: perQueryLimit,
      });
      let outcome;
      try {
        outcome = cache && typeof cache.get === "function"
          ? await cache.get(key, producer, {
              shouldStore: (value) => ["ok", "empty"].includes(value?.status),
            })
          : await producer();
      } catch (_error) {
        outcome = { status: "failed", reason: "source_search_failed", results: [] };
      }
      queryOutcomes.push(compactQueryOutcome(query, outcome));
      for (const result of Array.isArray(outcome?.results) ? outcome.results : []) {
        found.push({ ...result, discovered_from: query });
      }
    }

    const seeds = boundSearchSeeds(found, {
      endpointOrigin,
      place,
      limit: seedLimit,
      perOriginLimit,
    });
    const responding = queryOutcomes.filter((item) => ["ok", "empty"].includes(item.status)).length;
    const failed = queryOutcomes.length - responding;
    const status = seeds.length
      ? failed ? "partial" : "complete"
      : responding
        ? failed ? "partial" : "empty"
        : "failed";

    return {
      contract: "bounded_source_search_v1",
      status,
      reasons: status === "failed"
        ? ["source_search_failed"]
        : seeds.length
          ? ["bounded_source_search_complete"]
          : ["source_search_no_public_results"],
      queried_count: boundedQueries.length,
      responding_query_count: responding,
      failed_query_count: failed,
      result_count: found.length,
      seed_count: seeds.length,
      seeds,
      query_outcomes: queryOutcomes,
      activation_performed: false,
    };
  };
}

async function fetchSearxngQuery({
  endpoint,
  endpointOrigin,
  query,
  language,
  fetcher,
  timeoutMs,
  maxBytes,
  userAgent,
  limit,
}) {
  const url = new URL(endpoint);
  url.searchParams.set("q", query);
  url.searchParams.set("format", "json");
  url.searchParams.set("categories", "general");
  url.searchParams.set("language", normalizeSearchLanguage(language));

  const page = await fetchSearchPage({
    url: url.toString(),
    requiredOrigin: endpointOrigin,
    fetcher,
    timeoutMs,
    maxBytes,
    userAgent,
    accept: "application/json",
  });
  if (page.status !== "ok") {
    return { status: "failed", reason: normalizeSearchFailure(page.reason), results: [] };
  }

  let payload;
  try {
    payload = JSON.parse(page.body);
  } catch (_error) {
    return { status: "failed", reason: "source_search_payload_invalid", results: [] };
  }
  if (!Array.isArray(payload?.results)) {
    return { status: "failed", reason: "source_search_payload_invalid", results: [] };
  }

  const results = payload.results
    .map((row) => normalizeSearchResult(row))
    .filter(Boolean)
    .slice(0, limit);
  return {
    status: results.length ? "ok" : "empty",
    reason: results.length ? "source_search_results_found" : "source_search_query_empty",
    results,
  };
}

function boundSearchSeeds(results, { endpointOrigin, place, limit, perOriginLimit }) {
  const out = [];
  const seenUrls = new Set();
  const originCounts = new Map();
  for (const result of Array.isArray(results) ? results : []) {
    const url = normalizeHttpUrl(result?.url);
    if (!url || !isScoutablePublicUrl(url)) continue;
    const parsed = new URL(url);
    if (parsed.origin === endpointOrigin || seenUrls.has(url)) continue;
    const originCount = originCounts.get(parsed.origin) || 0;
    if (originCount >= perOriginLimit) continue;
    seenUrls.add(url);
    originCounts.set(parsed.origin, originCount + 1);
    out.push({
      url,
      label: safeResultLabel(result?.title) || parsed.hostname.replace(/^www\./, ""),
      place: firstString(place?.label, place?.name),
      family: "unknown_source_family",
      trust_tier: "unknown",
      source_language: null,
      discovery_method: "bounded_source_search",
      discovered_from: firstString(result?.discovered_from),
    });
    if (out.length >= limit) break;
  }
  return out;
}

async function fetchSearchPage({
  url,
  requiredOrigin,
  fetcher,
  timeoutMs,
  maxBytes,
  userAgent,
}) {
  const boundedTimeout = clampInteger(timeoutMs, 50, 30000);
  const boundedBytes = clampInteger(maxBytes, 1024, 2 * 1024 * 1024);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), boundedTimeout);
  let phase = "fetch";
  try {
    let currentUrl = url;
    let response;
    for (let redirectCount = 0; redirectCount <= 3; redirectCount += 1) {
      response = await fetcher(currentUrl, {
        headers: {
          "User-Agent": userAgent,
          Accept: "application/json",
        },
        redirect: "manual",
        signal: controller.signal,
      });
      if (!isRedirectResponse(response)) break;
      if (redirectCount === 3) {
        return { status: "failed", reason: "source_search_redirect_limit" };
      }
      const nextUrl = resolveRedirect(response, currentUrl);
      if (!nextUrl || new URL(nextUrl).origin !== requiredOrigin) {
        return { status: "failed", reason: "source_search_cross_origin_redirect" };
      }
      currentUrl = nextUrl;
    }
    const responseUrl = normalizeOperatorEndpoint(response?.url);
    if (responseUrl && new URL(responseUrl).origin !== requiredOrigin) {
      return { status: "failed", reason: "source_search_cross_origin_redirect" };
    }
    if (!response || response.ok !== true) {
      return {
        status: "failed",
        reason: `source_search_http_${safeHttpStatus(response?.status)}`,
      };
    }
    const declaredLength = Number(response.headers?.get?.("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > boundedBytes) {
      return { status: "failed", reason: "source_search_payload_too_large" };
    }
    phase = "body";
    const body = await raceWithAbort(
      readBoundedText(response, boundedBytes),
      controller.signal,
    );
    if (body == null) {
      return { status: "failed", reason: "source_search_payload_too_large" };
    }
    return { status: "ok", body };
  } catch (error) {
    if (error?.name === "AbortError") {
      return { status: "failed", reason: "source_search_timeout" };
    }
    return {
      status: "failed",
      reason: phase === "body"
        ? "source_search_body_failed"
        : "source_search_fetch_failed",
    };
  } finally {
    clearTimeout(timer);
  }
}

function raceWithAbort(promise, signal) {
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    const abort = () => reject(abortError());
    signal.addEventListener("abort", abort, { once: true });
    Promise.resolve(promise).then(
      (value) => {
        signal.removeEventListener("abort", abort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", abort);
        reject(error);
      },
    );
  });
}

function abortError() {
  const error = new Error("aborted");
  error.name = "AbortError";
  return error;
}

function normalizeOperatorEndpoint(value) {
  const normalized = normalizeHttpUrl(value);
  if (!normalized) return null;
  const parsed = new URL(normalized);
  if (parsed.username || parsed.password) return null;
  return normalized;
}

function resolveRedirect(response, currentUrl) {
  const location = response?.headers?.get?.("location");
  if (typeof location !== "string" || !location.trim()) return null;
  try {
    return normalizeOperatorEndpoint(new URL(location, currentUrl).toString());
  } catch (_error) {
    return null;
  }
}

function isRedirectResponse(response) {
  const status = Number(response?.status);
  return Number.isInteger(status) && status >= 300 && status <= 399;
}

function safeHttpStatus(value) {
  const status = Number(value);
  return Number.isInteger(status) && status >= 100 && status <= 599
    ? String(status)
    : "not_ok";
}

function normalizeSearchResult(row) {
  if (!row || typeof row !== "object") return null;
  const url = normalizeHttpUrl(row.url);
  if (!url || !isScoutablePublicUrl(url)) return null;
  return { url, title: safeResultLabel(row.title) };
}

function safeResultLabel(value) {
  if (typeof value !== "string") return null;
  const normalized = value
    .replace(/<[^>]*>/g, " ")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return normalized ? normalized.slice(0, 120) : null;
}

function compactQueryOutcome(query, outcome) {
  const status = ["ok", "empty", "failed"].includes(outcome?.status)
    ? outcome.status
    : "failed";
  return {
    query_key: createHash("sha256").update(query).digest("hex").slice(0, 12),
    status,
    reason: normalizeSearchFailure(outcome?.reason),
    result_count: Array.isArray(outcome?.results) ? outcome.results.length : 0,
  };
}

function emptyOutcome(reason) {
  return {
    contract: "bounded_source_search_v1",
    status: "empty",
    reasons: [reason],
    queried_count: 0,
    responding_query_count: 0,
    failed_query_count: 0,
    result_count: 0,
    seed_count: 0,
    seeds: [],
    query_outcomes: [],
    activation_performed: false,
  };
}

function resolveDefaultSourceSearch(env = process.env, options = {}) {
  if (!enabled(env?.PARRANDA_SOURCE_SEARCH)) return null;
  return createSearxngSourceSearch({
    endpoint: env?.PARRANDA_SOURCE_SEARCH_ENDPOINT,
    fetcher: options.fetcher,
    cache: options.cache,
    maxQueries: env?.PARRANDA_SOURCE_SEARCH_MAX_QUERIES,
    maxResultsPerQuery: env?.PARRANDA_SOURCE_SEARCH_RESULTS_PER_QUERY,
    maxSeeds: env?.PARRANDA_SOURCE_SEARCH_MAX_SEEDS,
    timeoutMs: env?.PARRANDA_SOURCE_SEARCH_TIMEOUT_MS,
    userAgent: env?.PARRANDA_SOURCE_SEARCH_USER_AGENT || DEFAULT_USER_AGENT,
  });
}

function normalizeSearchLanguage(value) {
  const raw = typeof value === "string" ? value.trim().toLowerCase() : "";
  return /^[a-z]{2}(?:-[a-z]{2})?$/.test(raw) ? raw : "auto";
}

function normalizeSearchFailure(value) {
  const token = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (/^(?:source_(?:http_[0-9]{3}|timeout|fetch_failed|body_failed|payload_too_large)|source_search_[a-z0-9_]+)$/.test(token)) {
    return token;
  }
  return "source_search_failed";
}

function searchCacheKey(endpoint, query, language) {
  return createHash("sha256")
    .update(`${endpoint}|${language}|${query.trim().toLowerCase()}`)
    .digest("hex");
}

function enabled(value) {
  return ["1", "true", "yes", "on", "enabled"].includes(String(value || "").trim().toLowerCase());
}

function uniqueStrings(values) {
  const out = [];
  const seen = new Set();
  for (const value of Array.isArray(values) ? values : []) {
    const text = firstString(value);
    if (!text) continue;
    const key = text.toLocaleLowerCase("en-US");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }
  return out;
}

function firstString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function clampInteger(value, min, max) {
  return Math.max(min, Math.min(max, Math.floor(Number(value) || min)));
}

module.exports = {
  DEFAULT_MAX_QUERIES,
  DEFAULT_MAX_RESULTS_PER_QUERY,
  DEFAULT_MAX_SEEDS,
  createSearxngSourceSearch,
  resolveDefaultSourceSearch,
};
