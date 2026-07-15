"use strict";

/**
 * Bounded adapter for public Wix event sitemaps and SSR event detail pages.
 *
 * The adapter never calls Wix's private CMS APIs. A reviewed manifest owns
 * source trust, terms, timezone, activation, and geographic scope. Collection
 * follows same-origin sitemap/detail URLs and copies factual event atoms only.
 */

const { GENERIC_PROVIDER_CITY } = require("./provider-registry");
const { buildProviderCollectionOutcome } = require("./provider-collection-outcome");
const {
  normalizeIanaTimezone,
  normalizeSourceEventDateTime,
} = require("./source-event-time");

const WIX_EVENT_SITEMAP_PROVIDER_ID = "generic-wix-event-sitemap";
const DEFAULT_USER_AGENT = "Parranda/1.0 (+https://github.com/fritjofherrstrom-png/parranda)";
const DEFAULT_TIMEOUT_MS = 12000;
const DEFAULT_MAX_SITEMAP_BYTES = 1024 * 1024;
// Wix SSR pages carry substantial platform bootstrap data even when Parranda
// extracts only a few factual atoms. This remains below the shared 2 MB ceiling.
const DEFAULT_MAX_DETAIL_BYTES = 750 * 1024;
const MAX_BYTES = 2 * 1024 * 1024;
const DEFAULT_SITEMAP_LIMIT = 1;
const MAX_SITEMAP_LIMIT = 2;
const DEFAULT_DETAIL_LIMIT = 6;
const MAX_DETAIL_LIMIT = 12;
const DEFAULT_DETAIL_CONCURRENCY = 2;
const EVENT_PATH_PATTERN = /(?:event|events|evenemang|kalender|calendar)/i;
const MONTHS = Object.freeze({
  januari: 1,
  january: 1,
  februari: 2,
  february: 2,
  mars: 3,
  march: 3,
  april: 4,
  maj: 5,
  may: 5,
  juni: 6,
  june: 6,
  juli: 7,
  july: 7,
  augusti: 8,
  august: 8,
  september: 9,
  oktober: 10,
  october: 10,
  november: 11,
  december: 12,
});

function createWixEventSitemapProvider(providerOptions = {}) {
  const reviewedTimezone = normalizeIanaTimezone(providerOptions.timezone);
  const descriptor = buildDescriptor({
    ...providerOptions,
    timezone: reviewedTimezone || undefined,
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
          const fetcher =
            providerOptions.fetcher ||
            (typeof globalThis.fetch === "function" ? globalThis.fetch.bind(globalThis) : null);
          if (!endpoint) return emptyCollection("unavailable", "source_endpoint_unavailable");
          if (typeof fetcher !== "function") {
            return emptyCollection("unavailable", "source_fetch_unavailable");
          }

          const sitemapUrl = resolveSitemapUrl(
            firstString(providerOptions.sitemapUrl, endpoint),
          );
          if (!sitemapUrl) return emptyCollection("unavailable", "source_endpoint_unavailable");

          const sitemapLimit = clampInteger(
            providerOptions.sitemapLimit,
            1,
            MAX_SITEMAP_LIMIT,
            DEFAULT_SITEMAP_LIMIT,
          );
          const detailLimit = clampInteger(
            providerOptions.detailLimit,
            1,
            MAX_DETAIL_LIMIT,
            DEFAULT_DETAIL_LIMIT,
          );
          const baseOrigin = new URL(sitemapUrl).origin;
          const rootXml = await fetchBoundedText(fetcher, sitemapUrl, {
            ...providerOptions,
            maxBytes: providerOptions.maxSitemapBytes || DEFAULT_MAX_SITEMAP_BYTES,
            accept: "application/xml, text/xml, text/plain",
          });
          const root = extractWixSitemapDocument(rootXml, {
            baseUrl: sitemapUrl,
            baseOrigin,
            eventPathPrefix: providerOptions.eventPathPrefix,
          });

          const detailRows = [...root.eventUrls];
          for (const childUrl of root.sitemapUrls.slice(0, sitemapLimit)) {
            const xml = await fetchBoundedText(fetcher, childUrl, {
              ...providerOptions,
              maxBytes: providerOptions.maxSitemapBytes || DEFAULT_MAX_SITEMAP_BYTES,
              accept: "application/xml, text/xml, text/plain",
            });
            const child = extractWixSitemapDocument(xml, {
              baseUrl: childUrl,
              baseOrigin,
              eventPathPrefix: providerOptions.eventPathPrefix,
            });
            detailRows.push(...child.eventUrls);
          }

          const detailUrls = dedupeUrls(detailRows).slice(0, detailLimit);
          if (!detailUrls.length) return emptyCollection("empty", "source_empty");

          const events = [];
          let failedDetails = 0;
          const concurrency = clampInteger(
            providerOptions.detailConcurrency,
            1,
            4,
            DEFAULT_DETAIL_CONCURRENCY,
          );
          await mapWithConcurrency(detailUrls, concurrency, async (row) => {
            try {
              const html = await fetchBoundedText(fetcher, row.url, {
                ...providerOptions,
                maxBytes: providerOptions.maxDetailBytes || DEFAULT_MAX_DETAIL_BYTES,
                accept: "text/html, text/plain",
              });
              const event = extractWixEventDetail(html, {
                sourceUrl: row.url,
                collectionDate: collectionContext.date || context.date,
                sitemapLastmod: row.lastmod,
                timezone: reviewedTimezone,
                sourceLanguage: providerOptions.sourceLanguage,
                eventLanguage: providerOptions.eventLanguage,
                routeRoleHint: providerOptions.routeRoleHint,
              });
              if (event) events.push(event);
            } catch (_error) {
              failedDetails += 1;
            }
          });

          if (!events.length && failedDetails > 0) {
            return emptyCollection("failed", "source_fetch_failed");
          }
          const rows = events.map(compact).filter(Boolean);
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
  const descriptor = {
    id: options.id || WIX_EVENT_SITEMAP_PROVIDER_ID,
    label: options.label || "Wix event sitemap",
    city: GENERIC_PROVIDER_CITY,
    role: options.role || "official_live_baseline",
    sourceType: options.sourceType || "official_website",
    status: options.status || "candidate",
    intendedUse: "pulse",
    supportedLanguages:
      Array.isArray(options.supportedLanguages) && options.supportedLanguages.length
        ? options.supportedLanguages
        : [options.sourceLanguage || "sv"],
    updateCadence: options.updateCadence || "daily",
    parsingRisk: options.parsingRisk || "medium",
    trust: {
      source_tier: "verified",
      confidence: "low",
      human_verified: false,
      freshness: "fresh",
      ...(options.trust && typeof options.trust === "object" ? options.trust : {}),
    },
    cachePolicy: { kind: "memory", ttlSeconds: 1800 },
    sourceOwnedFields: [
      "title",
      "starts_at",
      "ends_at",
      "source_url",
      "place_context",
      "area",
      "recurrence",
    ],
    parrandaOwnedFields: ["intents", "route_role_hint"],
  };
  if (options.sourceUrl || options.endpoint) {
    descriptor.sourceUrl = options.sourceUrl || options.endpoint;
  }
  if (options.timezone) descriptor.timezone = options.timezone;
  if (options.sourceFamily || options.source_family) {
    descriptor.sourceFamily = options.sourceFamily || options.source_family;
  }
  return descriptor;
}

function resolveSitemapUrl(value) {
  try {
    const url = new URL(String(value || "").trim());
    if (!["http:", "https:"].includes(url.protocol)) return null;
    if (!/\.xml$/i.test(url.pathname)) return new URL("/sitemap.xml", url).toString();
    return url.toString();
  } catch (_error) {
    return null;
  }
}

function extractWixSitemapDocument(xml, options = {}) {
  const source = String(xml || "");
  if (!/generatedBy=["']WIX["']/i.test(source)) {
    return { sitemapUrls: [], eventUrls: [] };
  }
  const baseOrigin = firstString(options.baseOrigin) || originOf(options.baseUrl);
  const eventPathPrefix = normalizePathPrefix(options.eventPathPrefix);
  const rows = [...source.matchAll(
    /<(?:sitemap|url)>[\s\S]*?<loc>([\s\S]*?)<\/loc>[\s\S]*?(?:<lastmod>([\s\S]*?)<\/lastmod>)?[\s\S]*?<\/(?:sitemap|url)>/gi,
  )].map((match) => ({
    url: normalizeSameOriginUrl(decodeXml(match[1]), baseOrigin),
    lastmod: normalizeDateKey(decodeXml(match[2])),
  })).filter((row) => row.url);

  if (/<sitemapindex\b/i.test(source)) {
    return {
      sitemapUrls: rows
        .filter((row) => EVENT_PATH_PATTERN.test(new URL(row.url).pathname))
        .map((row) => row.url),
      eventUrls: [],
    };
  }
  if (/<urlset\b/i.test(source)) {
    return {
      sitemapUrls: [],
      eventUrls: rows.filter((row) => isEventPath(new URL(row.url).pathname, eventPathPrefix)),
    };
  }
  return { sitemapUrls: [], eventUrls: [] };
}

function extractWixEventDetail(html, options = {}) {
  const source = String(html || "");
  if (!hasWixPageSignature(source)) return null;
  const sourceUrl = firstString(
    options.sourceUrl,
    metaContent(source, "property", "og:url"),
    canonicalHref(source),
  );
  const title = htmlToText(
    metaContent(source, "property", "og:title") ||
      firstMatch(source, /<title\b[^>]*>([\s\S]*?)<\/title>/i) ||
      firstMatch(source, /<h1\b[^>]*>([\s\S]*?)<\/h1>/i),
  );
  if (!title || !sourceUrl) return null;

  const blocks = extractRichTextBlocks(source);
  const dateLabel = valueAfterLabel(blocks, /^(?:när|when|datum|date)\s*:?$/i);
  const timeLabel = valueAfterLabel(
    blocks,
    /^(?:öppettider|opening hours|tid|time)\s*:?$/i,
  );
  const place = placeAfterLabel(blocks, /^(?:var|where|plats|venue)\s*:?$/i);
  const coordinates = extractCoordinates(source);
  const timing = parseWixEventTiming(dateLabel, timeLabel, options);
  const explicitlyPast = hasStructuredPastStatus(source);
  const staleByDate = Boolean(
    timing.date_key && options.collectionDate && timing.date_key < String(options.collectionDate).slice(0, 10),
  );
  const sourceLanguage = normalizeLanguage(
    options.sourceLanguage || htmlLanguage(source),
  );

  return compact({
    id: sourceUrl,
    title,
    starts_at: timing.starts_at,
    ends_at: timing.ends_at,
    listing_date: timing.date_key,
    time_window: timing.label ? { label: timing.label } : null,
    source_url: sourceUrl,
    place_context: place?.text,
    area: place?.area,
    lat: coordinates.lat,
    lng: coordinates.lng,
    freshness: explicitlyPast || staleByDate ? "stale" : null,
    source_language: sourceLanguage,
    event_language: normalizeLanguage(options.eventLanguage) || sourceLanguage,
    translation_status: translationStatus(sourceLanguage),
    route_role_hint: options.routeRoleHint || null,
  });
}

function parseWixEventTiming(dateValue, timeValue, options = {}) {
  const dateLabel = htmlToText(dateValue);
  const timeLabel = htmlToText(timeValue);
  const label = [dateLabel, timeLabel].filter(Boolean).join(" · ") || null;
  const dateParts = parseLocalizedDate(dateLabel, options.collectionDate || options.sitemapLastmod);
  if (!dateParts) return compact({ label }) || {};
  const dateKey = toDateKey(dateParts);
  const time = parseTimeRange(timeLabel);
  if (!time) return compact({ date_key: dateKey, label }) || {};
  const timezone = normalizeIanaTimezone(options.timezone);
  if (!timezone) return compact({ date_key: dateKey, label }) || {};

  const startsAt = normalizeSourceEventDateTime(
    localDateTime(dateParts, time.start),
    { timezone },
  );
  const endDate = time.end && minutesOfDay(time.end) < minutesOfDay(time.start)
    ? addDays(dateParts, 1)
    : dateParts;
  const endsAt = time.end
    ? normalizeSourceEventDateTime(localDateTime(endDate, time.end), { timezone })
    : null;
  return compact({ starts_at: startsAt, ends_at: endsAt, date_key: dateKey, label }) || {};
}

function parseLocalizedDate(value, referenceDate) {
  const text = String(value || "").toLocaleLowerCase("sv-SE");
  const match = text.match(/\b(\d{1,2})\s+([a-zåäö]+)(?:\s+(\d{4}))?\b/i);
  if (!match) return null;
  const month = MONTHS[match[2]];
  const reference = normalizeDateKey(referenceDate);
  let year = Number(match[3]) || Number(reference?.slice(0, 4));
  if (!month || !Number.isInteger(year)) return null;
  let parts = validDateParts(year, month, Number(match[1]));
  if (!parts) return null;
  if (!match[3] && reference) {
    const candidate = Date.parse(toDateKey(parts) + "T00:00:00Z");
    const wanted = Date.parse(reference + "T00:00:00Z");
    if (candidate < wanted - 180 * 24 * 60 * 60 * 1000) {
      parts = validDateParts(year + 1, month, Number(match[1]));
    }
  }
  return parts;
}

function extractRichTextBlocks(html) {
  const blocks = [];
  const pattern = /<div\b[^>]*data-testid=["']richTextElement["'][^>]*>([\s\S]*?)<\/div><!--\/\$-->/gi;
  for (const match of String(html || "").matchAll(pattern)) {
    const fragment = match[1];
    const text = htmlToMultilineText(fragment);
    if (!text) continue;
    blocks.push({
      kind: /<h[1-6]\b/i.test(fragment) ? "heading" : "text",
      text,
    });
  }
  return blocks;
}

function valueAfterLabel(blocks, pattern) {
  const index = blocks.findIndex((block) => block.kind === "heading" && pattern.test(block.text));
  if (index < 0) return null;
  for (let cursor = index + 1; cursor < blocks.length; cursor += 1) {
    if (blocks[cursor].kind === "heading") return null;
    if (blocks[cursor].text) return blocks[cursor].text;
  }
  return null;
}

function placeAfterLabel(blocks, pattern) {
  const start = blocks.findIndex((block) => block.kind === "heading" && pattern.test(block.text));
  if (start < 0) return null;
  const candidates = [];
  for (let cursor = start + 1; cursor < blocks.length; cursor += 1) {
    const block = blocks[cursor];
    if (
      block.kind === "heading" &&
      /^(?:öppettider|opening hours|tid|time)\s*:?$/i.test(block.text)
    ) break;
    if (block.kind === "text" && block.text) candidates.push(block.text);
  }
  if (!candidates.length) return null;
  const addressLike = candidates.find((text) =>
    /\b\d{3}\s+\d{2}\b|\b(?:street|road|avenue|square|gata|gatan|väg|vägen|torg)\b/i.test(text),
  );
  if (!addressLike) return null;
  const text = addressLike;
  const lines = text.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  return { text: lines.join(", "), area: lines[lines.length - 1] || null };
}

async function fetchBoundedText(fetcher, url, options = {}) {
  const timeoutMs = clampInteger(options.timeoutMs, 50, 60000, DEFAULT_TIMEOUT_MS);
  const maxBytes = clampInteger(options.maxBytes, 1024, MAX_BYTES, DEFAULT_MAX_DETAIL_BYTES);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetcher(url, {
      headers: {
        "User-Agent": options.userAgent || DEFAULT_USER_AGENT,
        Accept: options.accept || "text/html, text/plain",
      },
      signal: controller.signal,
    });
    if (!response || response.ok !== true) {
      throw new Error(`source_http_${response?.status || "not_ok"}`);
    }
    const text = typeof response.text === "function" ? await response.text() : "";
    if (Buffer.byteLength(String(text || ""), "utf8") > maxBytes) {
      throw new Error("source_body_too_large");
    }
    return String(text || "");
  } catch (error) {
    const message = String(error?.message || "");
    const reason = error?.name === "AbortError"
      ? "source_timeout"
      : /^source_http_(?:[1-5]\d{2}|not_ok)$/.test(message) || message === "source_body_too_large"
        ? message
        : "source_fetch_failed";
    throw new Error(reason);
  } finally {
    clearTimeout(timer);
  }
}

async function mapWithConcurrency(items, concurrency, worker) {
  let index = 0;
  const run = async () => {
    while (index < items.length) {
      const item = items[index];
      index += 1;
      await worker(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, run));
}

function isEventPath(pathname, prefix) {
  const path = String(pathname || "");
  return prefix ? path.startsWith(prefix) : EVENT_PATH_PATTERN.test(path);
}

function normalizePathPrefix(value) {
  const raw = firstString(value);
  if (!raw) return null;
  return "/" + raw.replace(/^\/+/, "");
}

function normalizeSameOriginUrl(value, baseOrigin) {
  try {
    const url = new URL(String(value || "").trim());
    if (!["http:", "https:"].includes(url.protocol) || url.origin !== baseOrigin) return null;
    url.hash = "";
    return url.toString();
  } catch (_error) {
    return null;
  }
}

function originOf(value) {
  try {
    return new URL(value).origin;
  } catch (_error) {
    return null;
  }
}

function dedupeUrls(rows) {
  const seen = new Set();
  return rows.filter((row) => {
    if (!row?.url || seen.has(row.url)) return false;
    seen.add(row.url);
    return true;
  });
}

function hasWixPageSignature(html) {
  return (
    /<meta\b[^>]*name=["']generator["'][^>]*content=["'][^"']*Wix/i.test(String(html || "")) ||
    /id=["']wix-warmup-data["']/i.test(String(html || ""))
  );
}

function hasStructuredPastStatus(html) {
  return (
    /data-event-status=["'](?:past|expired|ended)["']/i.test(String(html || "")) ||
    /<meta\b[^>]*name=["']event-status["'][^>]*content=["'](?:past|expired|ended)["']/i.test(
      String(html || ""),
    )
  );
}

function metaContent(html, attribute, value) {
  const escaped = String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return firstMatch(
    html,
    new RegExp(`<meta\\b[^>]*${attribute}=["']${escaped}["'][^>]*content=["']([^"']*)["']`, "i"),
  );
}

function canonicalHref(html) {
  return firstMatch(html, /<link\b[^>]*rel=["']canonical["'][^>]*href=["']([^"']+)["']/i);
}

function htmlLanguage(html) {
  return firstMatch(html, /<html\b[^>]*lang=["']([^"']+)["']/i);
}

function parseTimeRange(value) {
  const match = String(value || "").replace(/[–—]/g, "-").match(
    /\b(\d{1,2})[.:](\d{2})(?:\s*-\s*(\d{1,2})[.:](\d{2}))?/,
  );
  if (!match) return null;
  const start = validTimeParts(Number(match[1]), Number(match[2]));
  const end = match[3] ? validTimeParts(Number(match[3]), Number(match[4])) : null;
  return start && (!match[3] || end) ? { start, end } : null;
}

function extractCoordinates(value) {
  const source = decodeUrlText(decodeHtml(String(value || "")));
  let match = source.match(/google\.[^/]+\/maps\/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/i);
  if (match) return validCoordinates(Number(match[1]), Number(match[2]));
  match = source.match(/[?&]center=(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/i);
  if (match) return validCoordinates(Number(match[2]), Number(match[1]));
  return {};
}

function validCoordinates(lat, lng) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return {};
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return {};
  return { lat, lng };
}

function validDateParts(year, month, day) {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() + 1 !== month ||
    date.getUTCDate() !== day
  ) return null;
  return { year, month, day };
}

function validTimeParts(hour, minute) {
  return Number.isInteger(hour) && hour >= 0 && hour <= 23 &&
    Number.isInteger(minute) && minute >= 0 && minute <= 59
    ? { hour, minute }
    : null;
}

function toDateKey(parts) {
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function normalizeDateKey(value) {
  const match = String(value || "").match(/^(\d{4}-\d{2}-\d{2})/);
  if (!match) return null;
  return Number.isFinite(Date.parse(match[1] + "T00:00:00Z")) ? match[1] : null;
}

function localDateTime(date, time) {
  return `${toDateKey(date)} ${String(time.hour).padStart(2, "0")}:${String(time.minute).padStart(2, "0")}:00`;
}

function addDays(parts, days) {
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
}

function minutesOfDay(time) {
  return time.hour * 60 + time.minute;
}

function translationStatus(language) {
  const normalized = normalizeLanguage(language);
  if (!normalized) return "unknown";
  return normalized !== "en" ? "needed" : "not_required";
}

function normalizeLanguage(value) {
  const raw = String(value || "").trim().toLowerCase();
  const primary = raw.split("-")[0];
  return /^[a-z]{2,3}$/.test(primary) ? primary : null;
}

function emptyCollection(status, reason) {
  return {
    events: [],
    signals: [],
    time_sensitive_events: [],
    collection_status: buildProviderCollectionOutcome(status, { reason, eventRows: 0 }),
  };
}

function firstMatch(value, pattern) {
  const match = String(value || "").match(pattern);
  return match ? match[1] : null;
}

function htmlToText(value) {
  if (typeof value !== "string") return null;
  return decodeHtml(
    value
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<br\s*\/?>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  ).replace(/\s+/g, " ").trim() || null;
}

function htmlToMultilineText(value) {
  if (typeof value !== "string") return null;
  return decodeHtml(
    value
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .trim() || null;
}

function decodeXml(value) {
  return decodeHtml(String(value || "").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1"));
}

function decodeUrlText(value) {
  try {
    return decodeURIComponent(String(value || ""));
  } catch (_error) {
    return String(value || "");
  }
}

function decodeHtml(value) {
  return String(value || "")
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&auml;/g, "ä")
    .replace(/&aring;/g, "å")
    .replace(/&ouml;/g, "ö")
    .replace(/&Auml;/g, "Ä")
    .replace(/&Aring;/g, "Å")
    .replace(/&Ouml;/g, "Ö");
}

function firstString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function clampInteger(value, min, max, fallback) {
  const number = Number.isFinite(Number(value)) ? Math.floor(Number(value)) : fallback;
  return Math.max(min, Math.min(number, max));
}

function compact(value) {
  const out = {};
  for (const [key, entry] of Object.entries(value || {})) {
    if (entry == null || entry === "") continue;
    if (Array.isArray(entry) && entry.length === 0) continue;
    out[key] = entry;
  }
  return Object.keys(out).length ? out : null;
}

module.exports = {
  WIX_EVENT_SITEMAP_PROVIDER_ID,
  createWixEventSitemapProvider,
  extractWixSitemapDocument,
  extractWixEventDetail,
  parseWixEventTiming,
  resolveSitemapUrl,
};
