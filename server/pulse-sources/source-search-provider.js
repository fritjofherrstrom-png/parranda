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
// A metasearch proxies engines that rate-limit and CAPTCHA automated bursts.
// Pacing the bounded query budget costs seconds and protects the whole run.
const DEFAULT_QUERY_PACE_MS = 250;
const MAX_QUERY_PACE_MS = 5000;
// One in-run retry only. It recovers a single flaky request; a genuinely
// degraded provider is recovered by the scout target's own bounded retry,
// not by hammering the endpoint inside one run.
const DEFAULT_QUERY_ATTEMPTS = 2;
const MAX_QUERY_ATTEMPTS = 3;
// Retries are drawn from one budget for the whole run. An isolated flaky
// request recovers; a provider that is genuinely down cannot double the
// worst-case wall clock of every query in the budget.
const DEFAULT_RETRY_BUDGET = 3;
const MAX_RETRY_BUDGET = 10;
const DEFAULT_RETRY_BACKOFF_MS = 1000;
const MAX_RETRY_BACKOFF_MS = 15000;
const MAX_ENGINE_NAMES = 6;

// Provider trouble that a later attempt may genuinely resolve. Contract and
// configuration errors are NOT here: retrying those just burns budget.
const QUERY_STATUS_REASONS = Object.freeze({
  ok: "source_search_results_found",
  partial: "source_search_results_partial",
  empty: "source_search_query_empty",
  degraded: "source_search_engines_unavailable",
});

const SEARCH_STATUS_REASONS = Object.freeze({
  complete: "bounded_source_search_complete",
  partial: "source_search_partial",
  empty: "source_search_no_public_results",
  degraded: "source_search_degraded",
  failed: "source_search_failed",
});

const RETRYABLE_FAILURE_REASONS = new Set([
  "source_search_engines_unavailable",
  "source_search_timeout",
  "source_search_fetch_failed",
  "source_search_body_failed",
]);
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
  queryPaceMs = DEFAULT_QUERY_PACE_MS,
  queryAttempts = DEFAULT_QUERY_ATTEMPTS,
  retryBudget = DEFAULT_RETRY_BUDGET,
  retryBackoffMs = DEFAULT_RETRY_BACKOFF_MS,
  delay = defaultDelay,
} = {}) {
  const normalizedEndpoint = normalizeOperatorEndpoint(endpoint);
  if (!normalizedEndpoint || typeof fetcher !== "function") return null;

  const endpointOrigin = new URL(normalizedEndpoint).origin;
  const queryLimit = clampInteger(maxQueries, 1, MAX_QUERIES);
  const perQueryLimit = clampInteger(maxResultsPerQuery, 1, MAX_RESULTS_PER_QUERY);
  const seedLimit = clampInteger(maxSeeds, 1, MAX_SEEDS);
  const perOriginLimit = clampInteger(maxResultsPerOrigin, 1, 4);
  const paceMs = clampInteger(queryPaceMs, 0, MAX_QUERY_PACE_MS);
  const attemptLimit = clampInteger(queryAttempts, 1, MAX_QUERY_ATTEMPTS);
  const backoffMs = clampInteger(retryBackoffMs, 0, MAX_RETRY_BACKOFF_MS);
  const runRetryBudget = clampInteger(retryBudget, 0, MAX_RETRY_BUDGET);
  const wait = typeof delay === "function" ? delay : defaultDelay;

  return async function searchSourceSeeds({ queries = [], place = {} } = {}) {
    const generatedQueries = uniqueStrings(queries);
    const boundedQueries = generatedQueries.slice(0, queryLimit);
    if (!boundedQueries.length) return emptyOutcome("source_search_queries_missing");
    const skippedQueryCount = generatedQueries.length - boundedQueries.length;

    const language = firstString(place?.language_hints?.[0], "auto");
    const queryOutcomes = [];
    const found = [];
    const budget = { remaining: runRetryBudget };

    // Sequential by design: the worker is off-request and must stay polite to
    // a shared/self-hosted metasearch service.
    let queryIndex = 0;
    for (const query of boundedQueries) {
      // Pace the burst. Firing the whole budget back-to-back is what trips the
      // proxied engines into rate limiting, which then reads as "no results".
      if (queryIndex > 0 && paceMs > 0) await wait(paceMs);
      queryIndex += 1;

      const key = searchCacheKey(normalizedEndpoint, query, language, perQueryLimit);
      const producer = () => runQueryWithRetry({
        endpoint: normalizedEndpoint,
        endpointOrigin,
        query,
        language,
        fetcher,
        timeoutMs,
        maxBytes,
        userAgent,
        limit: perQueryLimit,
        attemptLimit,
        backoffMs,
        wait,
        budget,
      });
      let outcome;
      try {
        outcome = cache && typeof cache.get === "function"
          ? await cache.get(key, producer, {
              // Only trustworthy answers may be cached. A degraded or failed
              // query must stay re-askable, or one bad window would be frozen
              // in for the whole cache TTL.
              shouldStore: (value) => ["ok", "partial"].includes(value?.status),
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
    // A query "responded" only when it produced a trustworthy answer: results,
    // or a clean zero-result. Degraded and failed queries answered nothing we
    // can believe, which is a different thing from "there is nothing there".
    const responding = queryOutcomes.filter((item) =>
      ["ok", "empty", "partial"].includes(item.status)).length;
    const failed = queryOutcomes.filter((item) => item.status === "failed").length;
    const degraded = queryOutcomes.filter((item) => item.status === "degraded").length;
    const partial = queryOutcomes.filter((item) => item.status === "partial").length;
    const untrustworthy = failed + degraded;
    const retryable = queryOutcomes.some((item) => item.retryable === true);

    const status = seeds.length
      // Useful results exist. Engine trouble downgrades confidence, it never
      // discards what the search actually found.
      ? untrustworthy || partial ? "partial" : "complete"
      : responding
        ? untrustworthy ? "degraded" : "empty"
        : "failed";

    return {
      contract: "bounded_source_search_v1",
      status,
      reasons: [SEARCH_STATUS_REASONS[status] || "source_search_failed"],
      generated_query_count: generatedQueries.length,
      queried_count: boundedQueries.length,
      // The budget silently discarded these. Recorded so a low seed count is
      // never mistaken for "this place has nothing".
      skipped_query_count: skippedQueryCount,
      responding_query_count: responding,
      failed_query_count: failed,
      degraded_query_count: degraded,
      partial_query_count: partial,
      result_count: found.length,
      seed_count: seeds.length,
      // Whether a later attempt is worth making. A clean zero-result search is
      // an answer; a degraded one is not.
      retry_recommended: !seeds.length && retryable,
      seeds,
      query_outcomes: queryOutcomes,
      activation_performed: false,
    };
  };
}

// One bounded retry for provider trouble a later attempt may resolve. This is
// not a polling loop: the real recovery for a degraded provider is the scout
// target's own bounded retry, minutes later.
async function runQueryWithRetry({ attemptLimit, backoffMs, wait, budget, ...options }) {
  let outcome = null;
  let attempts = 0;
  for (let attempt = 1; attempt <= attemptLimit; attempt += 1) {
    attempts = attempt;
    outcome = await fetchSearxngQuery(options);
    if (!isRetryableOutcome(outcome) || attempt === attemptLimit) break;
    if (!budget || budget.remaining <= 0) break;
    budget.remaining -= 1;
    if (backoffMs > 0) await wait(backoffMs * attempt);
  }
  return { ...outcome, attempt_count: attempts };
}

function isRetryableOutcome(outcome) {
  if (!outcome || !["failed", "degraded"].includes(outcome.status)) return false;
  const reason = typeof outcome.reason === "string" ? outcome.reason : "";
  if (RETRYABLE_FAILURE_REASONS.has(reason)) return true;
  const match = /^source_search_http_(\d{3})$/.exec(reason);
  if (!match) return false;
  const code = Number(match[1]);
  // Rate limiting and server-side trouble may pass. Other 4xx are contract or
  // configuration errors and retrying them only burns the budget.
  return code === 429 || code >= 500;
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

  const engineFailureCount = unresponsiveEngineCount(payload.unresponsive_engines);
  const engineNames = unresponsiveEngineNames(payload.unresponsive_engines);
  const rawResultCount = payload.results.length;
  const results = payload.results
    .map((row) => normalizeSearchResult(row))
    .filter(Boolean)
    .slice(0, limit);

  // Four distinct truths, deliberately not collapsed:
  //   results + healthy engines        -> ok
  //   results + degraded engines       -> partial, and the results are KEPT
  //   no results + healthy engines     -> empty, a real answer
  //   no results + degraded engines    -> degraded, no trustworthy answer
  const degraded = engineFailureCount > 0;
  const status = results.length
    ? degraded ? "partial" : "ok"
    : degraded ? "degraded" : "empty";
  return {
    status,
    reason: QUERY_STATUS_REASONS[status],
    engine_failure_count: engineFailureCount,
    unresponsive_engines: engineNames,
    raw_result_count: rawResultCount,
    results,
  };
}

function unresponsiveEngineNames(value) {
  const names = [];
  for (const entry of Array.isArray(value) ? value : []) {
    const name = Array.isArray(entry) ? entry[0] : entry;
    const text = typeof name === "string" ? name.trim().toLowerCase() : "";
    if (!text || names.includes(text)) continue;
    names.push(text.slice(0, 32));
    if (names.length >= MAX_ENGINE_NAMES) break;
  }
  return names;
}

function unresponsiveEngineCount(value) {
  return Array.isArray(value) ? value.filter(Boolean).length : 0;
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

// Bounded per-query evidence. Enough for an operator to answer "did useful
// results exist despite degraded engines, and is a retry warranted?" without
// shell access, and without dumping raw provider payloads into the catalog.
function compactQueryOutcome(query, outcome) {
  const status = ["ok", "empty", "partial", "degraded", "failed"].includes(outcome?.status)
    ? outcome.status
    : "failed";
  const acceptedCount = Array.isArray(outcome?.results) ? outcome.results.length : 0;
  const rawCount = clampInteger(outcome?.raw_result_count, 0, 1000);
  return {
    query: boundedQueryText(query),
    query_key: createHash("sha256").update(query).digest("hex").slice(0, 12),
    status,
    reason: normalizeSearchFailure(outcome?.reason),
    // Raw vs accepted separates "the provider found nothing" from "the
    // provider found things we filtered out".
    raw_result_count: Math.max(rawCount, acceptedCount),
    result_count: acceptedCount,
    engine_failure_count: clampInteger(outcome?.engine_failure_count, 0, 32),
    unresponsive_engines: Array.isArray(outcome?.unresponsive_engines)
      ? outcome.unresponsive_engines.slice(0, MAX_ENGINE_NAMES)
      : [],
    results_despite_degraded_engines: status === "partial",
    attempt_count: clampInteger(outcome?.attempt_count, 1, MAX_QUERY_ATTEMPTS),
    retryable: isRetryableOutcome({ status, reason: outcome?.reason }),
  };
}

function boundedQueryText(value) {
  const text = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
  return text ? text.slice(0, 120) : null;
}

function defaultDelay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function emptyOutcome(reason) {
  return {
    contract: "bounded_source_search_v1",
    status: "empty",
    reasons: [reason],
    generated_query_count: 0,
    queried_count: 0,
    skipped_query_count: 0,
    responding_query_count: 0,
    failed_query_count: 0,
    degraded_query_count: 0,
    partial_query_count: 0,
    result_count: 0,
    seed_count: 0,
    retry_recommended: false,
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
    maxResultsPerOrigin: env?.PARRANDA_SOURCE_SEARCH_RESULTS_PER_ORIGIN,
    timeoutMs: env?.PARRANDA_SOURCE_SEARCH_TIMEOUT_MS,
    queryPaceMs: env?.PARRANDA_SOURCE_SEARCH_PACE_MS,
    queryAttempts: env?.PARRANDA_SOURCE_SEARCH_QUERY_ATTEMPTS,
    retryBudget: env?.PARRANDA_SOURCE_SEARCH_RETRY_BUDGET,
    retryBackoffMs: env?.PARRANDA_SOURCE_SEARCH_RETRY_BACKOFF_MS,
    delay: options.delay,
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

function searchCacheKey(endpoint, query, language, limit) {
  // Key on the request Parranda actually sends. The raw hint and the
  // normalized language differ ("cs-CZ" vs "cs-cz"), and a raised per-query
  // limit is a different request, not a cache hit.
  return createHash("sha256")
    .update(`${endpoint}|${normalizeSearchLanguage(language)}|${limit}|${query.trim().toLowerCase()}`)
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
