"use strict";

/**
 * Bounded adapter for Sitevision event-calendar listings.
 *
 * Sitevision is a CMS family, not a source trust claim. A reviewed manifest
 * owns source trust, terms, timezone, and activation. This adapter only reads
 * factual event atoms from the stable calendar markup and bounded detail pages.
 */

const { GENERIC_PROVIDER_CITY } = require("./provider-registry");
const { buildProviderCollectionOutcome } = require("./provider-collection-outcome");
const {
  normalizeIanaTimezone,
  normalizeSourceEventDateTime,
} = require("./source-event-time");

const SITEVISION_CALENDAR_PROVIDER_ID = "generic-sitevision-calendar";
const DEFAULT_USER_AGENT = "Parranda/1.0 (+https://github.com/fritjofherrstrom-png/parranda)";
const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_MAX_BYTES = 750 * 1024;
const MAX_BYTES = 2 * 1024 * 1024;
const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 80;
const DEFAULT_DETAIL_LIMIT = 6;
const MAX_DETAIL_LIMIT = 12;
const DEFAULT_DETAIL_CONCURRENCY = 2;

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

function buildDescriptor(options = {}) {
  const descriptor = {
    id: options.id || SITEVISION_CALENDAR_PROVIDER_ID,
    label: options.label || "Sitevision event calendar",
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
      "starts_on",
      "ends_on",
      "time_window",
      "source_url",
      "place_context",
      "lat",
      "lng",
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

function createSitevisionCalendarProvider(providerOptions = {}) {
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

          const limit = clampInteger(providerOptions.limit, 1, MAX_LIMIT, DEFAULT_LIMIT);
          const html = await fetchBoundedText(fetcher, endpoint, providerOptions);
          const parseOptions = {
            ...providerOptions,
            baseUrl: providerOptions.baseUrl || endpoint,
            date: collectionContext.date || context.date,
            timezone: reviewedTimezone,
          };
          const events = extractSitevisionCalendarEvents(html, parseOptions).slice(0, limit);

          if (providerOptions.fetchDetails !== false && events.length) {
            await enrichFromDetailPages(events, fetcher, parseOptions);
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

async function fetchBoundedText(fetcher, url, options = {}) {
  const timeoutMs = clampInteger(options.timeoutMs, 50, 60000, DEFAULT_TIMEOUT_MS);
  const maxBytes = clampInteger(options.maxBytes, 1024, MAX_BYTES, DEFAULT_MAX_BYTES);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetcher(url, {
      headers: {
        "User-Agent": options.userAgent || DEFAULT_USER_AGENT,
        Accept: "text/html, text/plain",
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

function extractSitevisionCalendarEvents(html, options = {}) {
  const source = String(html || "");
  if (!hasSitevisionCalendarSignature(source)) return [];
  const events = [];
  for (const article of extractArticles(source)) {
    const link = absolutizeUrl(
      firstMatch(article, /<a\b[^>]*class=["'][^"']*\beventArticleHeading\b[^"']*["'][^>]*href=["']([^"']+)["']/i) ||
        firstMatch(article, /<a\b[^>]*href=["']([^"']+)["'][^>]*class=["'][^"']*\beventArticleHeading\b/i) ||
        firstMatch(article, /<a\b[^>]*href=["']([^"']+)["']/i),
      options.baseUrl,
    );
    const title = htmlToText(
      firstMatch(article, /<h[1-4]\b[^>]*>([\s\S]*?)<\/h[1-4]>/i),
    );
    if (!title || !link) continue;

    const listingDate = firstMatch(
      article,
      /<time\b[^>]*datetime=["'](\d{4}-\d{2}-\d{2})["'][^>]*>/i,
    );
    const timingText =
      extractSitevisionTimingText(article) ||
      extractSoleilTimingText(article) ||
      htmlToText(article);
    const timing = parseSitevisionDateTime(timingText, {
      ...options,
      fallbackDate: listingDate,
    });
    if (isBeforeCollectionDate(timing.end_date_key || timing.date_key, options.date)) continue;
    const venue = htmlToText(
      firstMatch(article, /<div\b[^>]*class=["'][^"']*\bfooterText\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i),
    ) || extractDefinitionValue(article, ["lokal", "plats", "venue", "location"]);
    const category = extractDefinitionValue(article, ["kategori", "category"]);
    const communityEvent = /\bexternalOrganizerBadge\b/i.test(article);
    events.push(compact({
      id: link,
      title,
      starts_at: timing.starts_at,
      ends_at: timing.ends_at,
      starts_on: timing.starts_on,
      ends_on: timing.ends_on,
      listing_date: timing.date_key,
      listing_end_date: timing.end_date_key,
      time_window: timing.time_window,
      source_url: link,
      place_context: venue,
      tags: uniqueStrings([
        communityEvent ? "community_event" : null,
        category,
      ]),
      source_language: options.sourceLanguage || null,
      event_language: options.eventLanguage || options.sourceLanguage || null,
      translation_status: translationStatus(options.sourceLanguage),
      route_role_hint: options.routeRoleHint || null,
    }));
  }
  return events;
}

function extractSitevisionEventDetail(html, options = {}) {
  const source = String(html || "");
  const timingText = textAfterMarker(source, "Datumochtid");
  const recurrence = textAfterMarker(source, "Aterkommandetillfallen");
  const timing = parseSitevisionDateTime(timingText, {
    ...options,
    expectedDate: options.expectedDate,
  });
  const venue = htmlToText(
    firstMatch(source, /Evenemangsplats:\s*<\/strong>\s*<br\s*\/?>\s*([^<]+)/i),
  );
  const address = htmlToText(
    firstMatch(source, /(?:Adress|Besöksadress):\s*<\/strong>\s*<br\s*\/?>\s*([^<]+)/i),
  );
  const coordinates = extractCoordinates(source);
  return compact({
    starts_at: timing.starts_at,
    ends_at: timing.ends_at,
    starts_on: timing.starts_on,
    ends_on: timing.ends_on,
    time_window: timing.time_window,
    place_context: venue,
    address,
    lat: coordinates.lat,
    lng: coordinates.lng,
    recurrence: recurrence || null,
  }) || {};
}

async function enrichFromDetailPages(events, fetcher, options = {}) {
  const detailLimit = clampInteger(
    options.detailLimit,
    0,
    Math.min(MAX_DETAIL_LIMIT, events.length),
    Math.min(DEFAULT_DETAIL_LIMIT, events.length),
  );
  const concurrency = clampInteger(
    options.detailConcurrency,
    1,
    4,
    DEFAULT_DETAIL_CONCURRENCY,
  );
  await mapWithConcurrency(events.slice(0, detailLimit), concurrency, async (event) => {
    if (!event?.source_url) return;
    try {
      const html = await fetchBoundedText(fetcher, event.source_url, options);
      const detail = extractSitevisionEventDetail(html, {
        ...options,
        expectedDate: event.listing_date,
      });
      for (const key of [
        "starts_at",
        "ends_at",
        "starts_on",
        "ends_on",
        "time_window",
        "place_context",
        "address",
        "lat",
        "lng",
        "recurrence",
      ]) {
        if (detail[key] != null && detail[key] !== "") event[key] = detail[key];
      }
    } catch (_error) {
      // A detail page is enrichment only. The bounded listing result remains.
    }
  });
}

function parseSitevisionDateTime(value, options = {}) {
  const label = htmlToText(String(value || ""));
  if (!label) return {};
  const normalized = label.toLocaleLowerCase("sv-SE").replace(/[–—]/g, "-");
  const expectedDate = validDateKey(options.expectedDate);
  const fallbackDate = validDateKey(options.fallbackDate);
  const year = inferYear(expectedDate || fallbackDate || options.date);
  const range = expectedDate
    ? { start: datePartsFromKey(expectedDate), end: datePartsFromKey(expectedDate) }
    : parseDateRange(normalized, year) ||
      (fallbackDate
        ? { start: datePartsFromKey(fallbackDate), end: datePartsFromKey(fallbackDate) }
        : null);
  if (!range?.start) return { label };

  const time = parseTimeRange(normalized);
  const timezone = normalizeIanaTimezone(options.timezone);
  const startDateKey = dateKey(range.start);
  const endDateKey = dateKey(range.end || range.start);
  if (!time) {
    return {
      starts_on: startDateKey,
      ends_on: endDateKey,
      date_key: startDateKey,
      end_date_key: endDateKey !== startDateKey ? endDateKey : null,
      time_window: compact({
        kind: "all_day",
        starts_on: startDateKey,
        ends_on: endDateKey,
        label,
      }),
      label,
    };
  }

  const localStart = localClock(time.start);
  const localEnd = localClock(time.end);
  if (endDateKey !== startDateKey || !timezone) {
    return compact({
      starts_on: startDateKey,
      ends_on: endDateKey,
      date_key: startDateKey,
      end_date_key: endDateKey !== startDateKey ? endDateKey : null,
      time_window: compact({
        kind: "daily",
        starts_on: startDateKey,
        ends_on: endDateKey,
        local_start: localStart,
        local_end: localEnd,
        timezone,
        label,
      }),
      label,
    }) || {};
  }

  const startsAt = normalizeSourceEventDateTime(
    localDateTime(range.start, time.start),
    { timezone },
  );
  let endDate = range.start;
  if (time.end && minutesOfDay(time.end) < minutesOfDay(time.start)) {
    endDate = addDays(range.start, 1);
  }
  const endsAt = time.end
    ? normalizeSourceEventDateTime(localDateTime(endDate, time.end), { timezone })
    : null;
  return compact({
    starts_at: startsAt,
    ends_at: endsAt,
    starts_on: startDateKey,
    ends_on: endDateKey,
    date_key: startDateKey,
    time_window: compact({
      kind: "continuous",
      starts_at: startsAt,
      ends_at: endsAt,
      label,
    }),
    label,
  }) || {};
}

function parseDateRange(value, year) {
  if (!Number.isInteger(year)) return null;
  const text = String(value || "");
  let match = text.match(/\b(\d{1,2})\s+([a-zåäö]+)\s*-\s*(\d{1,2})\s+([a-zåäö]+)\b/i);
  if (match) {
    const startMonth = monthNumber(match[2]);
    const endMonth = monthNumber(match[4]);
    if (!startMonth || !endMonth) return null;
    return {
      start: validDateParts(year, startMonth, Number(match[1])),
      end: validDateParts(endMonth < startMonth ? year + 1 : year, endMonth, Number(match[3])),
    };
  }
  match = text.match(/\b(\d{1,2})\s*-\s*(\d{1,2})\s+([a-zåäö]+)\b/i);
  if (match) {
    const month = monthNumber(match[3]);
    if (!month) return null;
    return {
      start: validDateParts(year, month, Number(match[1])),
      end: validDateParts(year, month, Number(match[2])),
    };
  }
  match = text.match(/\b(\d{1,2})\s+([a-zåäö]+)\b/i);
  if (!match) return null;
  const month = monthNumber(match[2]);
  if (!month) return null;
  const date = validDateParts(year, month, Number(match[1]));
  return date ? { start: date, end: date } : null;
}

function parseTimeRange(value) {
  const match = String(value || "").match(
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
  if (match) return coordinates(Number(match[1]), Number(match[2]));
  match = source.match(/[?&]center=(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/i);
  if (match) return coordinates(Number(match[2]), Number(match[1]));
  return {};
}

function hasSitevisionCalendarSignature(html) {
  const source = String(html || "");
  const classicLayout = (
    /\bsv-ws-event-calendar\b/i.test(source) &&
    /\b(?:eventsListContainer|eventArticle|eventCalendar)\b/i.test(source)
  );
  const soleilLayout = (
    /\bsv-se-soleil-eventListingLocal\b/i.test(source) &&
    /\bdates-kempox\b/i.test(source) &&
    /<article\b/i.test(source)
  );
  return classicLayout || soleilLayout;
}

function extractArticles(html) {
  const source = String(html || "");
  const articles = [...source.matchAll(
    /<article\b[^>]*>[\s\S]*?<\/article>/gi,
  )].map((match) => match[0]);
  return articles.filter((article) =>
    /\beventArticle\b/i.test(article) ||
    (/\bdates-kempox\b/i.test(article) && /<h[1-4]\b/i.test(article))
  );
}

function extractDefinitionValue(html, acceptedLabels) {
  const labels = new Set(acceptedLabels.map((label) => normalizeDefinitionLabel(label)));
  for (const match of String(html || "").matchAll(
    /<dt\b[^>]*>([\s\S]*?)<\/dt>\s*<dd\b[^>]*>([\s\S]*?)<\/dd>/gi,
  )) {
    if (labels.has(normalizeDefinitionLabel(htmlToText(match[1])))) {
      return htmlToText(match[2]);
    }
  }
  return null;
}

function normalizeDefinitionLabel(value) {
  return String(value || "")
    .toLocaleLowerCase("sv-SE")
    .replace(/[:\s]+/g, " ")
    .trim();
}

function extractSitevisionTimingText(article) {
  const marker = /<[^>]*class=["'][^"']*\btimeIcon\b[^"']*["'][^>]*>[\s\S]*?<\/[^>]+>/i;
  const match = marker.exec(String(article || ""));
  if (!match) return null;
  return htmlToText(String(article).slice(match.index + match[0].length));
}

function extractSoleilTimingText(article) {
  if (!/\bdates-kempox\b/i.test(String(article || ""))) return null;
  const date = htmlToText(firstMatch(
    article,
    /<time\b[^>]*class=["'][^"']*\bdates-kempox\b[^"']*["'][^>]*>([\s\S]*?)<\/time>/i,
  ));
  const time = extractDefinitionValue(article, ["tid", "time"]);
  return [date, time].filter(Boolean).join(" · ") || null;
}

function textAfterMarker(html, markerId) {
  const marker = new RegExp(`id=["']${markerId}["']`, "i").exec(String(html || ""));
  if (!marker) return null;
  const tail = String(html).slice(marker.index, marker.index + 3000);
  return htmlToText(firstMatch(tail, /<p\b[^>]*>([\s\S]*?)<\/p>/i));
}

function translationStatus(language) {
  const normalized = String(language || "").trim().toLowerCase();
  if (!normalized) return "unknown";
  return normalized !== "en" ? "needed" : "not_required";
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

function validDateKey(value) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  return validDateParts(Number(match[1]), Number(match[2]), Number(match[3])) ? match[0] : null;
}

function datePartsFromKey(value) {
  return {
    year: Number(value.slice(0, 4)),
    month: Number(value.slice(5, 7)),
    day: Number(value.slice(8, 10)),
  };
}

function monthNumber(value) {
  return MONTHS[String(value || "").toLocaleLowerCase("sv-SE")] || null;
}

function inferYear(date) {
  const match = String(date || "").match(/^(\d{4})-/);
  return match ? Number(match[1]) : null;
}

function dateKey(parts) {
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function localDateTime(date, time) {
  return `${dateKey(date)} ${String(time.hour).padStart(2, "0")}:${String(time.minute).padStart(2, "0")}:00`;
}

function localClock(time) {
  return time
    ? `${String(time.hour).padStart(2, "0")}:${String(time.minute).padStart(2, "0")}`
    : null;
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

function coordinates(lat, lng) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return {};
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return {};
  return { lat, lng };
}

function isBeforeCollectionDate(date, collectionDate) {
  const wanted = String(collectionDate || "").match(/^(\d{4}-\d{2}-\d{2})/)?.[1];
  return Boolean(date && wanted && date < wanted);
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

function emptyCollection(status, reason) {
  return {
    events: [],
    signals: [],
    time_sensitive_events: [],
    collection_status: buildProviderCollectionOutcome(status, { reason, eventRows: 0 }),
  };
}

function absolutizeUrl(value, baseUrl) {
  const raw = firstString(value);
  if (!raw) return null;
  try {
    return new URL(decodeHtml(raw), baseUrl || undefined).toString();
  } catch (_error) {
    return null;
  }
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

function decodeHtml(value) {
  return String(value || "")
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function decodeUrlText(value) {
  try {
    return decodeURIComponent(String(value || ""));
  } catch (_error) {
    return String(value || "");
  }
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

function uniqueStrings(values) {
  return [...new Set(
    (Array.isArray(values) ? values : [])
      .filter((value) => typeof value === "string" && value.trim())
      .map((value) => value.trim()),
  )];
}

module.exports = {
  SITEVISION_CALENDAR_PROVIDER_ID,
  createSitevisionCalendarProvider,
  extractSitevisionCalendarEvents,
  extractSitevisionEventDetail,
  hasSitevisionCalendarSignature,
  parseSitevisionDateTime,
};
