"use strict";

/**
 * Bounded adapter for factual event atoms published inside an official public
 * program article. It intentionally understands a document grammar, not a
 * publisher: a labelled program section, explicit local dates/times, and a
 * shared venue context. Editorial prose, images, and inferred geometry never
 * enter the provider output.
 */

const { GENERIC_PROVIDER_CITY } = require("./provider-registry");
const { buildProviderCollectionOutcome } = require("./provider-collection-outcome");
const { normalizeIanaTimezone } = require("./source-event-time");
const {
  boundProgramEvents,
  extractOfficialProgramArticle,
} = require("./official-program-article-normalizer");
const {
  MIN_TIMED_ROWS_FOR_SIGNATURE,
  hasOfficialProgramArticleSignature,
} = require("./official-program-article-rows");
const {
  normalizeDateKey,
} = require("./official-program-article-time");

const OFFICIAL_PROGRAM_ARTICLE_PROVIDER_ID = "generic-official-program-article";
const DEFAULT_USER_AGENT = "Parranda/1.0 (+https://github.com/fritjofherrstrom-png/parranda)";
const DEFAULT_TIMEOUT_MS = 12000;
const DEFAULT_MAX_BYTES = 1024 * 1024;
const MAX_BYTES = 2 * 1024 * 1024;
const DEFAULT_LIMIT = 160;
const MAX_LIMIT = 300;
const DEFAULT_ALL_DAY_LIMIT = 30;
const MAX_ALL_DAY_LIMIT = 80;
const DEFAULT_HORIZON_DAYS = 14;
const MAX_HORIZON_DAYS = 45;
const DEFAULT_MAX_REDIRECTS = 3;
const MAX_REDIRECTS = 5;

function createOfficialProgramArticleProvider(providerOptions = {}) {
  const timezone = normalizeIanaTimezone(providerOptions.timezone);
  const sourceLanguage = normalizeLanguage(providerOptions.sourceLanguage);
  const descriptor = buildDescriptor({
    ...providerOptions,
    timezone: timezone || undefined,
    sourceLanguage: sourceLanguage || undefined,
  });

  return {
    descriptor,
    create(cityConfig, context = {}) {
      const boundDescriptor = { ...descriptor, city: cityConfig?.key || descriptor.city };
      return {
        descriptor: boundDescriptor,
        async collect(collectionContext = {}) {
          const endpoint = firstString(
            providerOptions.endpoint,
            context.endpoint,
            collectionContext.endpoint,
          );
          const fetcher = providerOptions.fetcher ||
            (typeof globalThis.fetch === "function" ? globalThis.fetch.bind(globalThis) : null);
          if (!endpoint) return emptyCollection("unavailable", "source_endpoint_unavailable");
          if (typeof fetcher !== "function") return emptyCollection("unavailable", "source_fetch_unavailable");
          if (!timezone) return emptyCollection("unavailable", "source_timezone_unavailable");
          if (!sourceLanguage) return emptyCollection("unavailable", "source_language_unavailable");

          const response = await fetchBoundedHtml(fetcher, endpoint, providerOptions);
          if (!response.ok) return emptyCollection("failed", response.reason);

          const collectionDate = normalizeDateKey(collectionContext.date || context.date);
          const parsed = extractOfficialProgramArticle(response.text, {
            sourceUrl: response.url,
            sourceLanguage,
            timezone,
            referenceDate: collectionDate,
          });
          if (!parsed.recognized || parsed.timed_event_count < MIN_TIMED_ROWS_FOR_SIGNATURE) {
            return emptyCollection("failed", "source_payload_invalid");
          }

          const rows = boundProgramEvents(parsed.events, {
            collectionDate,
            horizonDays: clampInteger(
              providerOptions.horizonDays,
              1,
              MAX_HORIZON_DAYS,
              DEFAULT_HORIZON_DAYS,
            ),
            timezone,
            timedLimit: clampInteger(providerOptions.limit, 1, MAX_LIMIT, DEFAULT_LIMIT),
            allDayLimit: clampInteger(
              providerOptions.allDayLimit,
              0,
              MAX_ALL_DAY_LIMIT,
              DEFAULT_ALL_DAY_LIMIT,
            ),
          });

          return {
            events: [],
            signals: [],
            time_sensitive_events: rows,
            collection_status: buildProviderCollectionOutcome(rows.length ? "ok" : "empty", {
              reason: rows.length ? null : "source_empty",
              eventRows: rows.length,
            }),
          };
        },
      };
    },
  };
}

function buildDescriptor(options = {}) {
  const sourceLanguage = normalizeLanguage(options.sourceLanguage);
  const descriptor = {
    id: options.id || OFFICIAL_PROGRAM_ARTICLE_PROVIDER_ID,
    label: options.label || "Official public event program",
    city: GENERIC_PROVIDER_CITY,
    role: options.role || "official_live_baseline",
    sourceType: options.sourceType || "official_website",
    status: options.status || "candidate",
    intendedUse: "pulse",
    supportedLanguages: sourceLanguage ? [sourceLanguage] : [],
    updateCadence: options.updateCadence || "hourly",
    parsingRisk: options.parsingRisk || "medium",
    trust: {
      source_tier: options.sourceTier || "verified",
      confidence: options.confidence || "low",
      human_verified: false,
      freshness: "fresh",
      ...(options.trust && typeof options.trust === "object" ? options.trust : {}),
    },
    cachePolicy: { kind: "memory", ttlSeconds: 1200 },
    sourceOwnedFields: [
      "title",
      "starts_at",
      "ends_at",
      "starts_on",
      "ends_on",
      "time_window",
      "source_url",
      "place_context",
      "area",
      "tags",
      "local_significance",
    ],
    parrandaOwnedFields: ["intents", "route_role_hint"],
  };
  if (options.sourceUrl || options.endpoint) descriptor.sourceUrl = options.sourceUrl || options.endpoint;
  if (options.timezone) descriptor.timezone = options.timezone;
  if (options.sourceFamily || options.source_family) {
    descriptor.sourceFamily = options.sourceFamily || options.source_family;
  }
  return descriptor;
}

async function fetchBoundedHtml(fetcher, endpoint, options = {}) {
  const timeoutMs = clampInteger(options.timeoutMs, 50, 60000, DEFAULT_TIMEOUT_MS);
  const maxBytes = clampInteger(options.maxBytes, 1024, MAX_BYTES, DEFAULT_MAX_BYTES);
  const maxRedirects = clampInteger(options.maxRedirects, 0, MAX_REDIRECTS, DEFAULT_MAX_REDIRECTS);
  const initialUrl = normalizeHttpUrl(endpoint);
  if (!initialUrl) return { ok: false, reason: "source_endpoint_unavailable" };
  const expectedOrigin = new URL(initialUrl).origin;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let url = initialUrl;
  let phase = "fetch";
  try {
    for (let redirects = 0; redirects <= maxRedirects; redirects += 1) {
      phase = "fetch";
      const response = await fetcher(url, {
        headers: {
          "User-Agent": options.userAgent || DEFAULT_USER_AGENT,
          Accept: "text/html, application/xhtml+xml",
        },
        redirect: "manual",
        signal: controller.signal,
      });
      if (isRedirect(response?.status)) {
        if (redirects >= maxRedirects) return { ok: false, reason: "source_redirect_limit" };
        const redirected = normalizeHttpUrl(response?.headers?.get?.("location"), url);
        if (!redirected) return { ok: false, reason: "source_redirect_invalid" };
        if (new URL(redirected).origin !== expectedOrigin) {
          return { ok: false, reason: "source_redirect_cross_origin" };
        }
        url = redirected;
        continue;
      }
      if (!response || response.ok !== true) {
        return { ok: false, reason: `source_http_${safeHttpStatus(response?.status)}` };
      }
      const responseUrl = normalizeHttpUrl(response.url || url);
      if (!responseUrl || new URL(responseUrl).origin !== expectedOrigin) {
        return { ok: false, reason: "source_redirect_cross_origin" };
      }
      const declaredLength = Number(response.headers?.get?.("content-length"));
      if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
        return { ok: false, reason: "source_payload_invalid" };
      }
      phase = "payload";
      const text = await readBoundedText(response, maxBytes);
      if (text == null) return { ok: false, reason: "source_payload_invalid" };
      return { ok: true, url: responseUrl, text };
    }
    return { ok: false, reason: "source_redirect_limit" };
  } catch (error) {
    return {
      ok: false,
      reason: error?.name === "AbortError"
        ? "source_timeout"
        : phase === "payload"
          ? "source_payload_invalid"
          : "source_fetch_failed",
    };
  } finally {
    clearTimeout(timer);
  }
}

async function readBoundedText(response, maxBytes) {
  if (response.body && typeof response.body.getReader === "function") {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let bytes = 0;
    let text = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value?.byteLength || 0;
      if (bytes > maxBytes) {
        await reader.cancel().catch(() => {});
        return null;
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return text;
  }
  const text = typeof response.text === "function" ? await response.text() : "";
  return Buffer.byteLength(String(text || ""), "utf8") <= maxBytes ? String(text || "") : null;
}

function emptyCollection(status, reason) {
  return {
    events: [],
    signals: [],
    time_sensitive_events: [],
    collection_status: buildProviderCollectionOutcome(status, { reason, eventRows: 0 }),
  };
}

function normalizeLanguage(value) {
  const language = String(value || "").trim().toLowerCase().split(/[-_]/)[0];
  return /^[a-z]{2,3}$/.test(language) ? language : null;
}

function normalizeHttpUrl(value, base) {
  try {
    const url = base ? new URL(String(value || ""), base) : new URL(String(value || ""));
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    url.hash = "";
    return url.toString();
  } catch (_error) {
    return null;
  }
}

function isRedirect(status) {
  return Number.isInteger(Number(status)) && Number(status) >= 300 && Number(status) <= 399;
}

function safeHttpStatus(value) {
  const status = Number(value);
  return Number.isInteger(status) && status >= 100 && status <= 599 ? status : "not_ok";
}

function firstString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function clampInteger(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(number)));
}

module.exports = {
  OFFICIAL_PROGRAM_ARTICLE_PROVIDER_ID,
  createOfficialProgramArticleProvider,
  extractOfficialProgramArticle,
  hasOfficialProgramArticleSignature,
};
