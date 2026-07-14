/**
 * Generic HTML venue calendar provider.
 *
 * This adapter is for reachable venue calendar pages that publish dated event
 * listings in HTML but do not expose a stable JSON/iCal feed. It emits only
 * `time_sensitive_events`; route mutation and place creation remain downstream
 * gated decisions.
 */

const { GENERIC_PROVIDER_CITY } = require("./provider-registry");
const { buildProviderCollectionOutcome } = require("./provider-collection-outcome");

const HTML_VENUE_CALENDAR_PROVIDER_ID = "generic-html-venue-calendar";
const DEFAULT_USER_AGENT = "Parranda/1.0 (+https://github.com/fritjofherrstrom-png/parranda)";
const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_LIMIT = 24;
const MAX_LIMIT = 80;
const DEFAULT_DETAIL_LIMIT = 8;

function buildDescriptor({
  id,
  label,
  sourceUrl,
  license,
  status = "candidate",
  sourceType = "venue_feed",
  role = "venue_programming",
  supportedLanguages,
  updateCadence,
  parsingRisk,
  trust,
} = {}) {
  const descriptor = {
    id: id || HTML_VENUE_CALENDAR_PROVIDER_ID,
    label: label || "HTML venue calendar",
    city: GENERIC_PROVIDER_CITY,
    role,
    sourceType,
    status,
    intendedUse: "pulse",
    supportedLanguages: Array.isArray(supportedLanguages) && supportedLanguages.length
      ? supportedLanguages
      : ["en"],
    updateCadence: updateCadence || "daily",
    parsingRisk: parsingRisk || "medium",
    trust: {
      source_tier: "verified",
      confidence: "medium",
      human_verified: false,
      freshness: "fresh",
      ...(trust && typeof trust === "object" ? trust : {}),
    },
    cachePolicy: { kind: "memory", ttlSeconds: 1800 },
    sourceOwnedFields: ["title", "starts_at", "source_url", "place_context"],
    parrandaOwnedFields: ["intents", "route_role_hint"],
  };
  if (sourceUrl) descriptor.sourceUrl = sourceUrl;
  if (license) descriptor.license_label = license;
  return descriptor;
}

function createHtmlVenueCalendarProvider(providerOptions = {}) {
  const descriptor = buildDescriptor({
    ...providerOptions,
    sourceUrl: providerOptions.sourceUrl || providerOptions.endpoint || undefined,
  });
  return {
    descriptor,
    create(cityConfig, context = {}) {
      const boundDescriptor = { ...descriptor, city: cityConfig?.key || descriptor.city };
      return {
        descriptor: boundDescriptor,
        async collect(collectionContext = {}) {
          const endpoint = providerOptions.endpoint || context.endpoint || collectionContext.endpoint || null;
          const fetcher =
            providerOptions.fetcher ||
            (typeof globalThis.fetch === "function" ? globalThis.fetch.bind(globalThis) : null);
          if (!endpoint) return emptyCollection("unavailable", "source_endpoint_unavailable");
          if (typeof fetcher !== "function") return emptyCollection("unavailable", "source_fetch_unavailable");

          const limit = Math.max(1, Math.min(Math.floor(providerOptions.limit || DEFAULT_LIMIT), MAX_LIMIT));
          const html = await fetchText(fetcher, endpoint, providerOptions);
          const events = extractHtmlVenueCalendarEvents(html, {
            ...providerOptions,
            baseUrl: providerOptions.baseUrl || endpoint,
            date: collectionContext.date || context.date,
          }).slice(0, limit);

          if (providerOptions.fetchDetails !== false) {
            await enrichEventsFromDetailPages(events, fetcher, providerOptions);
          }

          const normalizedEvents = events.map((event) => compact(event)).filter(Boolean);
          return {
            events: [],
            signals: [],
            time_sensitive_events: normalizedEvents,
            collection_status: buildProviderCollectionOutcome(normalizedEvents.length ? "ok" : "empty", {
              reason: normalizedEvents.length ? null : "source_empty",
              eventRows: normalizedEvents.length,
            }),
          };
        },
      };
    },
  };
}

async function fetchText(fetcher, url, options = {}) {
  const userAgent = options.userAgent || DEFAULT_USER_AGENT;
  const timeoutMs = Math.max(50, Math.floor(options.timeoutMs || DEFAULT_TIMEOUT_MS));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetcher(url, {
      headers: { "User-Agent": userAgent, Accept: "text/html, text/plain" },
      signal: controller.signal,
    });
    if (!response || response.ok !== true) {
      throw new Error(`source_http_${response?.status || "not_ok"}`);
    }
    return typeof response.text === "function" ? response.text() : "";
  } catch (error) {
    const message = String(error?.message || "");
    const reason = error?.name === "AbortError"
      ? "source_timeout"
      : /^source_http_(?:[1-5]\d{2}|not_ok)$/.test(message)
        ? message
        : "source_fetch_failed";
    throw new Error(reason);
  } finally {
    clearTimeout(timer);
  }
}

function emptyCollection(status, reason) {
  return {
    events: [],
    signals: [],
    time_sensitive_events: [],
    collection_status: buildProviderCollectionOutcome(status, { reason, eventRows: 0 }),
  };
}

async function enrichEventsFromDetailPages(events, fetcher, options = {}) {
  const detailLimit = Math.max(0, Math.min(Math.floor(options.detailLimit || DEFAULT_DETAIL_LIMIT), events.length));
  await Promise.all(events.slice(0, detailLimit).map(async (event) => {
    if (!event?.source_url) return;
    try {
      const html = await fetchText(fetcher, event.source_url, options);
      const detail = extractHtmlVenueEventDetail(html, { ...options, expectedDate: event.listing_date });
      if (detail.starts_at) event.starts_at = detail.starts_at;
      if (detail.ends_at) event.ends_at = detail.ends_at;
      if (detail.place_context && !event.place_context) event.place_context = detail.place_context;
    } catch (_error) {
      // Listing-level event data remains useful; source status should not fail
      // just because a detail page was temporarily unavailable.
    }
  }));
}

function extractHtmlVenueCalendarEvents(html, options = {}) {
  const sourceHtml = String(html || "");
  if (!sourceHtml.trim()) return [];
  const baseUrl = options.baseUrl || options.sourceUrl || null;
  const sections = extractDateSections(sourceHtml);
  const events = [];
  for (const section of sections) {
    const sectionDate = parseDateHeader(section.header, options);
    const sectionDateKey = dateKeyFromIso(sectionDate);
    if (isBeforeCollectionDate(sectionDateKey, options.date)) continue;
    for (const itemHtml of extractListItems(section.html)) {
      const event = extractEventCard(itemHtml, { ...options, baseUrl, sectionDate, sectionDateKey });
      if (event) events.push(event);
    }
  }
  return events;
}

function extractDateSections(html) {
  const sections = [];
  const sectionPattern = /<div[^>]*class=["'][^"']*\bdate-container\b[^"']*["'][^>]*>([\s\S]*?)(?=<div[^>]*class=["'][^"']*\bdate-container\b|<\/main>|<footer|$)/gi;
  for (const match of html.matchAll(sectionPattern)) {
    const sectionHtml = match[1];
    const header = htmlToText(firstMatch(sectionHtml, /<h2[^>]*>([\s\S]*?)<\/h2>/i));
    if (header || sectionHtml.includes("tease--event-calendar")) {
      sections.push({ header, html: sectionHtml });
    }
  }
  return sections;
}

function extractListItems(sectionHtml) {
  const items = [];
  for (const match of String(sectionHtml || "").matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)) {
    if (match[1].includes("tease--event-calendar")) items.push(match[1]);
  }
  return items;
}

function extractEventCard(itemHtml, options = {}) {
  const link = absolutizeUrl(
    firstMatch(itemHtml, /<a\b[^>]*href=["']([^"']+)["'][^>]*>\s*<h2\b/i) ||
      firstMatch(itemHtml, /<a\b[^>]*href=["']([^"']+)["'][^>]*title=["'][^"']*\blink["'][^>]*>/i) ||
      firstMatch(itemHtml, /<a\b[^>]*href=["']([^"']+)["'][^>]*>/i),
    options.baseUrl,
  );
  const title = htmlToText(
    firstMatch(itemHtml, /<a\b[^>]*href=["'][^"']+["'][^>]*>\s*<h2[^>]*>([\s\S]*?)<\/h2>\s*<\/a>/i) ||
      firstMatch(itemHtml, /title=["']([^"']+?)\s+link["']/i),
  );
  if (!title || !link) return null;
  const dateAttr = firstMatch(itemHtml, /data-date=["']([^"']+)["']/i);
  const dateFromAttribute = parseDateAttribute(dateAttr, options);
  const listingDate = dateKeyFromIso(dateFromAttribute || options.sectionDate);
  const category = htmlToText(firstMatch(itemHtml, /<div[^>]*class=["'][^"']*\bcategory-title\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i));
  const organiser = htmlToText(firstMatch(itemHtml, /ORGANISER[\s\S]*?<h2[^>]*class=["'][^"']*\bh3\b[^"']*["'][^>]*>([\s\S]*?)<\/h2>/i));
  return compact({
    id: link,
    title,
    starts_at: options.useListingDateAsStart ? (dateFromAttribute || options.sectionDate || null) : null,
    listing_date: listingDate || options.sectionDateKey || null,
    source_url: link,
    place_context: organiser,
    tags: category ? [category] : [],
    source_language: options.sourceLanguage || null,
    event_language: options.eventLanguage || options.sourceLanguage || null,
    route_role_hint: options.routeRoleHint || null,
  });
}

function extractHtmlVenueEventDetail(html, options = {}) {
  const detailHtml = String(html || "");
  const candidates = extractDisplayDateTimes(detailHtml)
    .map((value) => parseDisplayDateTime(htmlToText(value), options))
    .filter(Boolean);
  const dateTime = selectDateTimeForExpectedDate(candidates, options.expectedDate);
  return compact({
    starts_at: dateTime,
  }) || {};
}

function extractDisplayDateTimes(html) {
  const out = [];
  for (const match of String(html || "").matchAll(/\b\d{1,2}\.\d{1,2}\.\d{4}\s*,\s*\d{1,2}:\d{2}\b/g)) {
    out.push(match[0]);
  }
  return [...new Set(out)];
}

function selectDateTimeForExpectedDate(values, expectedDate) {
  if (!values.length) return null;
  const expected = firstString(expectedDate);
  if (expected) {
    const matched = values.find((value) => dateKeyFromIso(value) === expected);
    if (matched) return matched;
    return null;
  }
  return values[0];
}

function parseDateHeader(value, options = {}) {
  const cleaned = String(value || "").trim();
  const match = cleaned.match(/\b(\d{1,2})\.(\d{1,2})(?:\.(\d{4}))?\b/);
  if (!match) return null;
  const year = Number(match[3]) || inferYear(options.date);
  return isoLocalDateTime({
    year,
    month: Number(match[2]),
    day: Number(match[1]),
    timezoneOffset: options.timezoneOffset,
  });
}

function parseDateAttribute(value, options = {}) {
  const match = String(value || "").match(/\b(\d{1,2})\s+(\d{1,2})\s+(\d{4})\b/);
  if (!match) return null;
  return isoLocalDateTime({
    year: Number(match[3]),
    month: Number(match[2]),
    day: Number(match[1]),
    timezoneOffset: options.timezoneOffset,
  });
}

function parseDisplayDateTime(value, options = {}) {
  const match = String(value || "").match(/\b(\d{1,2})\.(\d{1,2})\.(\d{4})\s*,\s*(\d{1,2}):(\d{2})\b/);
  if (!match) return null;
  return isoLocalDateTime({
    year: Number(match[3]),
    month: Number(match[2]),
    day: Number(match[1]),
    hour: Number(match[4]),
    minute: Number(match[5]),
    timezoneOffset: options.timezoneOffset || "+03:00",
  });
}

function dateKeyFromIso(value) {
  const match = String(value || "").match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : null;
}

function isBeforeCollectionDate(dateKey, collectionDate) {
  const wanted = String(collectionDate || "").match(/^(\d{4}-\d{2}-\d{2})/)?.[1] || null;
  return Boolean(dateKey && wanted && dateKey < wanted);
}

function isoLocalDateTime({ year, month, day, hour = 0, minute = 0, timezoneOffset = "+00:00" }) {
  if (![year, month, day, hour, minute].every((value) => Number.isInteger(value))) return null;
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return null;
  }
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00${timezoneOffset}`;
}

function inferYear(date) {
  const match = String(date || "").match(/^(\d{4})-/);
  return match ? Number(match[1]) : new Date().getUTCFullYear();
}

function absolutizeUrl(value, baseUrl) {
  const raw = firstString(value);
  if (!raw) return null;
  try {
    return new URL(raw, baseUrl || undefined).toString();
  } catch (_error) {
    return raw;
  }
}

function firstMatch(value, pattern) {
  const match = String(value || "").match(pattern);
  return match ? match[1] : null;
}

function htmlToText(value) {
  if (typeof value !== "string") return null;
  return decodeHtml(value.replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim() || null;
}

function decodeHtml(value) {
  return String(value || "")
    .replace(/&#(\d+);/g, (_match, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function firstString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function compact(object) {
  const out = {};
  for (const [key, value] of Object.entries(object || {})) {
    if (value === null || value === undefined || value === "") continue;
    if (Array.isArray(value) && value.length === 0) continue;
    out[key] = value;
  }
  return Object.keys(out).length ? out : null;
}

module.exports = {
  HTML_VENUE_CALENDAR_PROVIDER_ID,
  DEFAULT_USER_AGENT,
  createHtmlVenueCalendarProvider,
  extractHtmlVenueCalendarEvents,
  extractHtmlVenueEventDetail,
};
