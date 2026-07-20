"use strict";

/**
 * Reviewed RSS/Atom event-detail provider.
 *
 * Feeds are discovery indexes only. Their titles, descriptions, `pubDate`, and
 * Atom `updated` values are publication metadata, not event facts. This
 * provider follows bounded same-origin item links and accepts only
 * schema.org/Event JSON-LD from the linked detail pages.
 */

const { GENERIC_PROVIDER_CITY } = require("./provider-registry");
const { buildProviderCollectionOutcome } = require("./provider-collection-outcome");
const {
  extractSchemaOrgEventsFromHtml,
  mapSchemaOrgEventToRaw,
} = require("./schema-org-event-provider");

const RSS_ATOM_EVENT_PROVIDER_ID = "generic-rss-atom-event-details";
const DEFAULT_USER_AGENT = "Parranda/1.0 (+https://github.com/fritjofherrstrom-png/parranda)";
const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_DETAIL_LIMIT = 12;
const MAX_DETAIL_LIMIT = 30;
const DEFAULT_DETAIL_BUDGET = 18;
const MAX_DETAIL_BUDGET = 40;
const DEFAULT_MAX_BYTES = 512 * 1024;
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_REDIRECTS = 3;

function createRssAtomEventProvider(providerOptions = {}) {
  const sourceUrl = firstString(providerOptions.sourceUrl, providerOptions.endpoint);
  const descriptor = {
    id: RSS_ATOM_EVENT_PROVIDER_ID,
    label: firstString(providerOptions.label) || "RSS/Atom event details",
    city: GENERIC_PROVIDER_CITY,
    role: "secondary_culture_source",
    sourceType: "venue_feed",
    ...(sourceUrl ? { sourceUrl } : {}),
    status: "active",
    intendedUse: "pulse",
    supportedLanguages: normalizeLanguages(
      providerOptions.supportedLanguages,
      providerOptions.sourceLanguage,
    ),
    updateCadence: "hourly",
    parsingRisk: "medium",
    trust: {
      source_tier: normalizeDescriptorTier(providerOptions.sourceTier),
      confidence: normalizeConfidence(providerOptions.confidence),
      human_verified: true,
      freshness: "fresh",
    },
    cachePolicy: { kind: "memory", ttlSeconds: 1800 },
    sourceOwnedFields: [
      "title",
      "starts_at",
      "ends_at",
      "lat",
      "lng",
      "source_url",
      "place_context",
    ],
    parrandaOwnedFields: ["intents", "route_role_hint"],
    license_label: firstString(providerOptions.license),
  };

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
          if (typeof fetcher !== "function") {
            return emptyCollection("unavailable", "source_fetch_unavailable");
          }

          const reviewedEndpoint = safeHttpsUrl(endpoint);
          if (!reviewedEndpoint) return emptyCollection("unavailable", "source_endpoint_unavailable");
          const requiredOrigin = new URL(reviewedEndpoint).origin;
          const timeoutMs = clampInteger(providerOptions.timeoutMs, 50, 60_000, DEFAULT_TIMEOUT_MS);
          const detailLimit = clampInteger(
            providerOptions.detailLimit,
            1,
            MAX_DETAIL_LIMIT,
            DEFAULT_DETAIL_LIMIT,
          );
          const detailBudget = clampInteger(
            providerOptions.detailBudget,
            detailLimit,
            MAX_DETAIL_BUDGET,
            Math.max(detailLimit, DEFAULT_DETAIL_BUDGET),
          );
          const maxBytes = clampInteger(
            providerOptions.maxBytes,
            1024,
            MAX_BYTES,
            DEFAULT_MAX_BYTES,
          );
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), timeoutMs);

          try {
            const feed = await fetchReviewedText({
              url: reviewedEndpoint,
              requiredOrigin,
              fetcher,
              signal: controller.signal,
              userAgent: providerOptions.userAgent || DEFAULT_USER_AGENT,
              accept: "application/atom+xml, application/rss+xml, application/xml, text/xml",
              maxBytes,
            });
            if (feed.status !== "ok") return emptyCollection(feed.status, feed.reason);

            const parsed = extractRssAtomEntryLinks(feed.body, {
              baseUrl: feed.url,
              limit: detailBudget,
            });
            if (!parsed.recognized) {
              return emptyCollection("failed", "source_payload_invalid");
            }
            if (parsed.links.length === 0) {
              return parsed.itemCount === 0
                ? emptyCollection("empty", "source_empty")
                : emptyCollection("failed", "source_payload_invalid");
            }

            const rawEvents = [];
            const referenceNow = parseDate(
              collectionContext.now || collectionContext.date || context.now,
            );
            let detailAttempts = 0;
            let fetchFailures = 0;
            let parseFailures = 0;
            let staleRows = 0;
            let firstFetchFailureReason = null;
            for (const detailUrl of parsed.links.slice(0, detailBudget)) {
              if (rawEvents.length >= detailLimit) break;
              detailAttempts += 1;
              const detail = await fetchReviewedText({
                url: detailUrl,
                requiredOrigin,
                fetcher,
                signal: controller.signal,
                userAgent: providerOptions.userAgent || DEFAULT_USER_AGENT,
                accept: "text/html, application/xhtml+xml",
                maxBytes,
              });
              if (detail.status !== "ok") {
                fetchFailures += 1;
                firstFetchFailureReason ||= detail.reason;
                continue;
              }

              const schemaEvents = extractSchemaOrgEventsFromHtml(detail.body);
              const mapped = schemaEvents
                .map((event) => mapSchemaOrgEventToRaw(event))
                .filter(hasExplicitEventTiming)
                .map((event) => withReviewedLanguage(event, providerOptions, detail.url));
              if (mapped.length === 0) {
                parseFailures += 1;
                continue;
              }
              const current = mapped.filter((event) => {
                const stale = isExplicitlyExpired(event, referenceNow);
                if (stale) staleRows += 1;
                return !stale;
              });
              rawEvents.push(...current.slice(0, detailLimit - rawEvents.length));
            }

            if (rawEvents.length === 0) {
              if (staleRows > 0 && parseFailures === 0 && fetchFailures === 0) {
                return emptyCollection("empty", "source_empty");
              }
              return emptyCollection(
                "failed",
                parseFailures > 0
                  ? "source_payload_invalid"
                  : firstFetchFailureReason || "source_fetch_failed",
              );
            }
            return {
              events: [],
              signals: [],
              time_sensitive_events: rawEvents,
              collection_status: buildProviderCollectionOutcome("ok", {
                eventRows: rawEvents.length,
              }),
              collection_diagnostics: {
                feed_item_count: parsed.itemCount,
                detail_attempt_count: detailAttempts,
                detail_fetch_failure_count: fetchFailures,
                detail_parse_failure_count: parseFailures,
                stale_event_count: staleRows,
              },
            };
          } catch (error) {
            return emptyCollection(
              error?.name === "AbortError" ? "failed" : "failed",
              error?.name === "AbortError" ? "source_timeout" : "source_fetch_failed",
            );
          } finally {
            clearTimeout(timer);
          }
        },
      };
    },
  };
}

function extractRssAtomEntryLinks(xml, { baseUrl, limit = DEFAULT_DETAIL_BUDGET } = {}) {
  const source = typeof xml === "string" ? xml : "";
  const rssItems = source.match(/<item\b[\s\S]*?<\/item\s*>/gi) || [];
  const atomEntries = source.match(/<entry\b[\s\S]*?<\/entry\s*>/gi) || [];
  const recognized = /<(?:rss|feed|rdf:RDF)\b/i.test(source);
  const base = safeHttpsUrl(baseUrl);
  const origin = base ? new URL(base).origin : null;
  const links = [];

  for (const item of rssItems) {
    const match = item.match(/<link\b[^>]*>([\s\S]*?)<\/link\s*>/i);
    addSameOriginLink(links, decodeXmlText(match?.[1]), base, origin);
    if (links.length >= limit) break;
  }
  for (const entry of atomEntries) {
    if (links.length >= limit) break;
    const linkPattern = /<link\b([^>]*)\/?\s*>/gi;
    let match;
    while ((match = linkPattern.exec(entry)) !== null) {
      const attributes = match[1] || "";
      const rel = attributeValue(attributes, "rel").toLowerCase();
      const href = attributeValue(attributes, "href");
      if (rel && rel !== "alternate") continue;
      if (addSameOriginLink(links, href, base, origin)) break;
    }
  }

  return {
    recognized,
    itemCount: rssItems.length + atomEntries.length,
    links: [...new Set(links)].slice(0, limit),
  };
}

async function fetchReviewedText({
  url,
  requiredOrigin,
  fetcher,
  signal,
  userAgent,
  accept,
  maxBytes,
}) {
  let current = safeSameOriginUrl(url, requiredOrigin);
  if (!current) return { status: "failed", reason: "source_redirect_cross_origin" };

  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    const response = await fetcher(current, {
      redirect: "manual",
      headers: { "User-Agent": userAgent, Accept: accept },
      signal,
    });
    const responseUrl = safeSameOriginUrl(response?.url || current, requiredOrigin);
    if (!responseUrl) return { status: "failed", reason: "source_redirect_cross_origin" };

    const status = Number(response?.status);
    if (status >= 300 && status < 400) {
      if (redirects >= MAX_REDIRECTS) {
        return { status: "failed", reason: "source_redirect_limit" };
      }
      const location = response?.headers?.get?.("location");
      const next = safeSameOriginUrl(location, requiredOrigin, responseUrl);
      if (!next) return { status: "failed", reason: "source_redirect_cross_origin" };
      current = next;
      continue;
    }
    if (!response || response.ok !== true) {
      return { status: "failed", reason: `source_http_${response?.status || "not_ok"}` };
    }
    const body = await readBoundedResponseText(response, maxBytes, signal);
    if (body == null) return { status: "failed", reason: "source_payload_invalid" };
    return { status: "ok", reason: null, url: responseUrl, body };
  }
  return { status: "failed", reason: "source_redirect_limit" };
}

async function readBoundedResponseText(response, maxBytes, signal) {
  if (response?.body && typeof response.body.getReader === "function") {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let bytes = 0;
    let output = "";
    while (true) {
      if (signal?.aborted) throw abortError();
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value?.byteLength || 0;
      if (bytes > maxBytes) {
        await reader.cancel();
        return null;
      }
      output += decoder.decode(value, { stream: true });
    }
    return output + decoder.decode();
  }
  const text = typeof response?.text === "function" ? await response.text() : "";
  if (signal?.aborted) throw abortError();
  return Buffer.byteLength(String(text || ""), "utf8") <= maxBytes ? String(text || "") : null;
}

function withReviewedLanguage(event, options, detailUrl) {
  const sourceLanguage = normalizeLanguage(options.sourceLanguage);
  const eventLanguage = normalizeLanguage(event.event_language || sourceLanguage);
  return compact({
    ...event,
    // The reviewed page is the source Parranda actually fetched and can
    // attribute. JSON-LD may contain a ticket or organizer URL instead.
    source_url: detailUrl,
    source_language: sourceLanguage,
    event_language: eventLanguage,
    translation_status:
      event.translation_status ||
      (eventLanguage ? (eventLanguage !== "en" ? "needed" : "not_required") : "unknown"),
    translation_confidence: event.translation_confidence || (eventLanguage ? "none" : "unknown"),
  });
}

function hasExplicitEventTiming(event) {
  return Boolean(event?.title && (event.starts_at || event.starts_on || event.time_window));
}

function isExplicitlyExpired(event, now) {
  if (event?.freshness === "stale") return true;
  if (!now || !hasExplicitOffsetInstant(event?.ends_at)) return false;
  const endsAt = new Date(event.ends_at);
  return Number.isFinite(endsAt.getTime()) && endsAt < now;
}

function hasExplicitOffsetInstant(value) {
  return typeof value === "string" && /T[0-9:.]+(?:Z|[+-]\d{2}:?\d{2})$/i.test(value.trim());
}

function parseDate(value) {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value : null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function addSameOriginLink(output, value, baseUrl, requiredOrigin) {
  const url = safeSameOriginUrl(value, requiredOrigin, baseUrl);
  if (!url) return false;
  output.push(url);
  return true;
}

function safeSameOriginUrl(value, requiredOrigin, baseUrl = null) {
  try {
    const url = baseUrl ? new URL(String(value || ""), baseUrl) : new URL(String(value || ""));
    if (url.protocol !== "https:" || url.origin !== requiredOrigin) return null;
    url.hash = "";
    return url.toString();
  } catch (_error) {
    return null;
  }
}

function safeHttpsUrl(value) {
  try {
    const url = new URL(String(value || ""));
    if (url.protocol !== "https:") return null;
    url.hash = "";
    return url.toString();
  } catch (_error) {
    return null;
  }
}

function attributeValue(attributes, name) {
  const match = String(attributes || "").match(
    new RegExp(`\\b${name}\\s*=\\s*(?:(["'])(.*?)\\1|([^\\s>]+))`, "i"),
  );
  return decodeXmlText(match?.[2] || match?.[3]);
}

function decodeXmlText(value) {
  return String(value || "")
    .replace(/^\s*<!\[CDATA\[/, "")
    .replace(/\]\]>\s*$/, "")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .trim();
}

function emptyCollection(status, reason) {
  return {
    events: [],
    signals: [],
    time_sensitive_events: [],
    collection_status: buildProviderCollectionOutcome(status, { reason, eventRows: 0 }),
  };
}

function normalizeLanguages(values, fallback) {
  const output = Array.isArray(values) ? values.map(normalizeLanguage).filter(Boolean) : [];
  const normalizedFallback = normalizeLanguage(fallback);
  if (normalizedFallback) output.push(normalizedFallback);
  const normalized = [...new Set(output)];
  return normalized.length ? normalized : ["und"];
}

function normalizeDescriptorTier(value) {
  const tier = firstString(value).toLowerCase();
  if (["official", "verified", "curated", "editorial", "inferred", "fallback"].includes(tier)) {
    return tier;
  }
  return tier ? "verified" : "inferred";
}

function normalizeLanguage(value) {
  const language = firstString(value).toLowerCase();
  return /^[a-z]{2,3}(?:-[a-z0-9]+)?$/.test(language) ? language : "";
}

function normalizeConfidence(value) {
  const confidence = firstString(value).toLowerCase();
  if (["strong", "high", "medium"].includes(confidence)) return "medium";
  return "low";
}

function clampInteger(value, min, max, fallback) {
  const number = Number(value);
  return Math.max(min, Math.min(max, Number.isFinite(number) ? Math.floor(number) : fallback));
}

function abortError() {
  const error = new Error("aborted");
  error.name = "AbortError";
  return error;
}

function firstString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function compact(value) {
  return Object.fromEntries(
    Object.entries(value || {}).filter(([, item]) => item != null && item !== ""),
  );
}

module.exports = {
  RSS_ATOM_EVENT_PROVIDER_ID,
  createRssAtomEventProvider,
  extractRssAtomEntryLinks,
};
