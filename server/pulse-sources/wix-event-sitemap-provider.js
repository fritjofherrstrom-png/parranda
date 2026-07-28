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
const DEFAULT_DETAIL_BUDGET = 12;
const MAX_DETAIL_BUDGET = 24;
const DEFAULT_DETAIL_CONCURRENCY = 2;
const DEFAULT_MAX_REDIRECTS = 3;
const MAX_REDIRECTS = 5;
const SUPPORTED_SOURCE_LANGUAGES = new Set(["sv", "en"]);
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
  const reviewedEventPathPrefix = normalizePathPrefix(providerOptions.eventPathPrefix);
  const declaredSourceLanguage = normalizeLanguage(providerOptions.sourceLanguage);
  const sourceLanguage = normalizeSupportedSourceLanguage(providerOptions.sourceLanguage);
  const descriptor = buildDescriptor({
    ...providerOptions,
    timezone: reviewedTimezone || undefined,
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
          if (!reviewedTimezone) {
            return emptyCollection("unavailable", "source_timezone_unavailable");
          }
          if (!reviewedEventPathPrefix) {
            return emptyCollection("unavailable", "source_event_path_unavailable");
          }
          if (!sourceLanguage) {
            return emptyCollection(
              "unavailable",
              declaredSourceLanguage
                ? "source_language_unsupported"
                : "source_language_unavailable",
            );
          }
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
          const detailBudget = clampInteger(
            providerOptions.detailBudget,
            detailLimit,
            MAX_DETAIL_BUDGET,
            Math.max(DEFAULT_DETAIL_BUDGET, detailLimit),
          );
          const baseOrigin = new URL(sitemapUrl).origin;
          const rootResponse = await fetchBoundedText(fetcher, sitemapUrl, {
            ...providerOptions,
            expectedOrigin: baseOrigin,
            maxBytes: providerOptions.maxSitemapBytes || DEFAULT_MAX_SITEMAP_BYTES,
            accept: "application/xml, text/xml, text/plain",
          });
          const root = extractWixSitemapDocument(rootResponse.text, {
            baseUrl: rootResponse.url,
            baseOrigin,
            eventPathPrefix: reviewedEventPathPrefix,
          });

          const detailRows = [...root.eventUrls];
          for (const childUrl of root.sitemapUrls.slice(0, sitemapLimit)) {
            const childResponse = await fetchBoundedText(fetcher, childUrl, {
              ...providerOptions,
              expectedOrigin: baseOrigin,
              maxBytes: providerOptions.maxSitemapBytes || DEFAULT_MAX_SITEMAP_BYTES,
              accept: "application/xml, text/xml, text/plain",
            });
            const child = extractWixSitemapDocument(childResponse.text, {
              baseUrl: childResponse.url,
              baseOrigin,
              eventPathPrefix: reviewedEventPathPrefix,
            });
            detailRows.push(...child.eventUrls);
          }

          const detailUrls = rankDetailRows(dedupeUrls(detailRows)).slice(0, detailBudget);
          if (!detailUrls.length) return emptyCollection("empty", "source_empty");

          const concurrency = clampInteger(
            providerOptions.detailConcurrency,
            1,
            4,
            DEFAULT_DETAIL_CONCURRENCY,
          );
          const detailOutcome = await collectWixDetailEvents({
            rows: detailUrls,
            detailLimit,
            concurrency,
            fetcher,
            baseOrigin,
            collectionDate: collectionContext.date || context.date,
            reviewedTimezone,
            sourceLanguage,
            providerOptions,
          });

          if (!detailOutcome.events.length) {
            if (detailOutcome.parse_failures > 0) {
              return emptyCollection("failed", "source_payload_invalid");
            }
            if (detailOutcome.fetch_failures > 0) {
              return emptyCollection(
                "failed",
                detailOutcome.first_failure_reason || "source_fetch_failed",
              );
            }
          }
          const rows = detailOutcome.events.map(compact).filter(Boolean);
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
  const sourceLanguage = normalizeSupportedSourceLanguage(options.sourceLanguage);
  const descriptor = {
    id: options.id || WIX_EVENT_SITEMAP_PROVIDER_ID,
    label: options.label || "Wix event sitemap",
    city: GENERIC_PROVIDER_CITY,
    role: options.role || "official_live_baseline",
    sourceType: options.sourceType || "official_website",
    status: options.status || "candidate",
    intendedUse: "pulse",
    supportedLanguages: sourceLanguage ? [sourceLanguage] : [...SUPPORTED_SOURCE_LANGUAGES],
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
      "address",
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
  const timing = parseWixEventTiming(dateLabel, timeLabel, options);
  const explicitlyPast = hasStructuredPastStatus(source);
  const staleByDate = Boolean(
    (timing.end_date_key || timing.date_key) &&
      options.collectionDate &&
      (timing.end_date_key || timing.date_key) < String(options.collectionDate).slice(0, 10),
  );
  const sourceLanguage = normalizeLanguage(
    options.sourceLanguage || htmlLanguage(source),
  );

  return compact({
    id: sourceUrl,
    title,
    starts_at: timing.starts_at,
    ends_at: timing.ends_at,
    starts_on: timing.starts_on,
    ends_on: timing.ends_on,
    listing_date: timing.date_key,
    listing_end_date: timing.end_date_key,
    time_window: timing.time_window,
    source_url: sourceUrl,
    place_context: place?.text,
    address: place?.text,
    area: place?.area,
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
  const dateRange = parseLocalizedDateRange(
    dateLabel,
    options.collectionDate || options.sitemapLastmod,
  );
  if (!dateRange || dateRange.unresolved) return compact({ label }) || {};
  const dateKey = toDateKey(dateRange.start);
  const endDateKey = toDateKey(dateRange.end);
  const time = parseTimeRange(timeLabel);
  if (!time) {
    return compact({
      starts_on: dateKey,
      ends_on: endDateKey,
      date_key: dateKey,
      end_date_key: endDateKey !== dateKey ? endDateKey : null,
      time_window: {
        kind: "all_day",
        starts_on: dateKey,
        ends_on: endDateKey,
        label,
      },
      label,
    }) || {};
  }
  const timezone = normalizeIanaTimezone(options.timezone);
  const localStart = localClock(time.start);
  const localEnd = localClock(time.end);
  const isMultiDay = endDateKey !== dateKey;
  if (isMultiDay) {
    return compact({
      starts_on: dateKey,
      ends_on: endDateKey,
      date_key: dateKey,
      end_date_key: endDateKey,
      time_window: {
        kind: "daily",
        starts_on: dateKey,
        ends_on: endDateKey,
        local_start: localStart,
        local_end: localEnd,
        timezone,
        label,
      },
      label,
    }) || {};
  }
  if (!timezone) {
    return compact({
      starts_on: dateKey,
      ends_on: endDateKey,
      date_key: dateKey,
      time_window: {
        kind: "daily",
        starts_on: dateKey,
        ends_on: endDateKey,
        local_start: localStart,
        local_end: localEnd,
        label,
      },
      label,
    }) || {};
  }

  const startsAt = normalizeSourceEventDateTime(
    localDateTime(dateRange.start, time.start),
    { timezone },
  );
  const endDate = time.end && minutesOfDay(time.end) < minutesOfDay(time.start)
    ? addDays(dateRange.end, 1)
    : dateRange.end;
  const endsAt = time.end
    ? normalizeSourceEventDateTime(localDateTime(endDate, time.end), { timezone })
    : null;
  return compact({
    starts_at: startsAt,
    ends_at: endsAt,
    starts_on: dateKey,
    ends_on: endDateKey,
    date_key: dateKey,
    time_window: {
      kind: "continuous",
      starts_at: startsAt,
      ends_at: endsAt,
      label,
    },
    label,
  }) || {};
}

function parseLocalizedDateRange(value, referenceDate) {
  const text = String(value || "").toLocaleLowerCase("sv-SE");
  if (!text.trim()) return null;
  const reference = normalizeDateKey(referenceDate);
  const sharedMonth = parseSharedMonthRange(text, reference);
  if (sharedMonth) return sharedMonth;

  const matches = extractLocalizedDateTokens(text);
  const rangeDetected = hasDateRangeMarker(text) || matches.length >= 2;
  if (!matches.length) return rangeDetected ? { unresolved: true } : null;
  if (rangeDetected && matches.length < 2) return { unresolved: true };

  const start = resolveDateToken(matches[0], reference);
  if (!start) return rangeDetected ? { unresolved: true } : null;
  if (!rangeDetected) return { start, end: start };

  let end = resolveDateToken(matches[1], reference, start.year);
  if (!end) return { unresolved: true };
  if (toDateKey(end) < toDateKey(start) && !matches[1].year) {
    end = validDateParts(start.year + 1, end.month, end.day);
  }
  if (!end || toDateKey(end) < toDateKey(start)) return { unresolved: true };
  return { start, end };
}

function parseSharedMonthRange(text, reference) {
  let match = text.match(
    /\b(\d{1,2})\s*[-–—]\s*(\d{1,2})\s+([a-zåäö]+)(?:\s+(\d{4}))?\b/i,
  );
  let firstDay;
  let secondDay;
  let monthName;
  let explicitYear;
  if (match) {
    [, firstDay, secondDay, monthName, explicitYear] = match;
  } else {
    match = text.match(
      /\b([a-zåäö]+)\s+(\d{1,2})\s*[-–—]\s*(\d{1,2})(?:,?\s+(\d{4}))?\b/i,
    );
    if (!match) return null;
    [, monthName, firstDay, secondDay, explicitYear] = match;
  }
  const token = { day: Number(firstDay), month: MONTHS[monthName], year: Number(explicitYear) || null };
  const start = resolveDateToken(token, reference);
  if (!start) return { unresolved: true };
  let end = validDateParts(
    Number(explicitYear) || start.year,
    token.month,
    Number(secondDay),
  );
  if (end && toDateKey(end) < toDateKey(start) && !explicitYear) {
    end = validDateParts(start.year + 1, token.month, Number(secondDay));
  }
  return end ? { start, end } : { unresolved: true };
}

function extractLocalizedDateTokens(text) {
  const tokens = [];
  const dayFirst = /\b(\d{1,2})\s+([a-zåäö]+)(?:\s+(\d{4}))?\b/gi;
  for (const match of text.matchAll(dayFirst)) {
    if (!MONTHS[match[2]]) continue;
    tokens.push({
      index: match.index,
      day: Number(match[1]),
      month: MONTHS[match[2]],
      year: Number(match[3]) || null,
    });
  }
  const monthFirst = /\b([a-zåäö]+)\s+(\d{1,2})(?:,?\s+(\d{4}))?\b/gi;
  for (const match of text.matchAll(monthFirst)) {
    if (!MONTHS[match[1]]) continue;
    tokens.push({
      index: match.index,
      day: Number(match[2]),
      month: MONTHS[match[1]],
      year: Number(match[3]) || null,
    });
  }
  return tokens.sort((left, right) => left.index - right.index);
}

function resolveDateToken(token, referenceDate, fallbackYear = null) {
  if (!token?.month || !token?.day) return null;
  const reference = normalizeDateKey(referenceDate);
  const explicitYear = Number(token.year) || null;
  const year = explicitYear || Number(fallbackYear) || Number(reference?.slice(0, 4));
  if (!Number.isInteger(year)) return null;
  let parts = validDateParts(year, token.month, token.day);
  if (!parts) return null;
  if (!explicitYear && !fallbackYear && reference) {
    const candidate = Date.parse(toDateKey(parts) + "T00:00:00Z");
    const wanted = Date.parse(reference + "T00:00:00Z");
    if (candidate < wanted - 180 * 24 * 60 * 60 * 1000) {
      parts = validDateParts(year + 1, token.month, token.day);
    }
  }
  return parts;
}

function hasDateRangeMarker(text) {
  return (
    /\b(?:till|to|through)\b/i.test(text) ||
    /\d\s*[-–—]\s*\d/.test(text) ||
    /\s[-–—]\s/.test(text)
  );
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

async function collectWixDetailEvents({
  rows,
  detailLimit,
  concurrency,
  fetcher,
  baseOrigin,
  collectionDate,
  reviewedTimezone,
  sourceLanguage,
  providerOptions,
}) {
  const events = [];
  let timedEventCount = 0;
  let allDayEventCount = 0;
  let fetchFailures = 0;
  let parseFailures = 0;
  let staleRows = 0;
  let firstFailureReason = null;

  for (let offset = 0; offset < rows.length && timedEventCount < detailLimit; offset += concurrency) {
    const batch = rows.slice(offset, offset + concurrency);
    const outcomes = await Promise.all(batch.map(async (row) => {
      try {
        const response = await fetchBoundedText(fetcher, row.url, {
          ...providerOptions,
          expectedOrigin: baseOrigin,
          maxBytes: providerOptions.maxDetailBytes || DEFAULT_MAX_DETAIL_BYTES,
          accept: "text/html, text/plain",
        });
        const event = extractWixEventDetail(response.text, {
          sourceUrl: response.url,
          collectionDate,
          sitemapLastmod: row.lastmod,
          timezone: reviewedTimezone,
          sourceLanguage,
          eventLanguage: providerOptions.eventLanguage,
          routeRoleHint: providerOptions.routeRoleHint,
        });
        const timingKind = wixTimingKind(event);
        if (!event || !timingKind) {
          return { status: "parse_failed" };
        }
        if (event.freshness === "stale") return { status: "stale" };
        return { status: "accepted", event, timingKind };
      } catch (error) {
        return {
          status: "fetch_failed",
          reason: classifyFetchFailure(error),
        };
      }
    }));

    for (const outcome of outcomes) {
      if (outcome.status === "accepted") {
        // All-day rows are valid source facts, but they do not consume the
        // bounded timed-event quota. This lets a later routeable event survive
        // without misreporting the all-day row as malformed.
        if (outcome.timingKind === "all_day" && allDayEventCount < detailLimit) {
          events.push(outcome.event);
          allDayEventCount += 1;
        } else if (timedEventCount < detailLimit) {
          events.push(outcome.event);
          timedEventCount += 1;
        }
      } else if (outcome.status === "parse_failed") {
        parseFailures += 1;
      } else if (outcome.status === "stale") {
        staleRows += 1;
      } else if (outcome.status === "fetch_failed") {
        fetchFailures += 1;
        firstFailureReason ||= outcome.reason;
      }
    }
  }

  return {
    events,
    fetch_failures: fetchFailures,
    parse_failures: parseFailures,
    stale_rows: staleRows,
    first_failure_reason: firstFailureReason,
  };
}

async function fetchBoundedText(fetcher, url, options = {}) {
  const timeoutMs = clampInteger(options.timeoutMs, 50, 60000, DEFAULT_TIMEOUT_MS);
  const maxBytes = clampInteger(options.maxBytes, 1024, MAX_BYTES, DEFAULT_MAX_DETAIL_BYTES);
  const maxRedirects = clampInteger(options.maxRedirects, 0, MAX_REDIRECTS, DEFAULT_MAX_REDIRECTS);
  const expectedOrigin = firstString(options.expectedOrigin) || originOf(url);
  if (!expectedOrigin || originOf(url) !== expectedOrigin) {
    throw new Error("source_redirect_cross_origin");
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let currentUrl = new URL(url).toString();
    for (let redirects = 0; redirects <= maxRedirects; redirects += 1) {
      const response = await fetcher(currentUrl, {
        headers: {
          "User-Agent": options.userAgent || DEFAULT_USER_AGENT,
          Accept: options.accept || "text/html, text/plain",
        },
        redirect: "manual",
        signal: controller.signal,
      });
      const responseUrl = firstString(response?.url) || currentUrl;
      if (originOf(responseUrl) !== expectedOrigin) {
        throw new Error("source_redirect_cross_origin");
      }
      if (isRedirectStatus(response?.status)) {
        if (redirects >= maxRedirects) throw new Error("source_redirect_limit");
        const location = responseHeader(response, "location");
        if (!location) throw new Error("source_redirect_invalid");
        const nextUrl = resolveRedirectUrl(location, responseUrl);
        if (!nextUrl) throw new Error("source_redirect_invalid");
        if (originOf(nextUrl) !== expectedOrigin) {
          throw new Error("source_redirect_cross_origin");
        }
        currentUrl = nextUrl;
        continue;
      }
      if (!response || response.ok !== true) {
        throw new Error(`source_http_${response?.status || "not_ok"}`);
      }
      const text = typeof response.text === "function" ? await response.text() : "";
      if (Buffer.byteLength(String(text || ""), "utf8") > maxBytes) {
        throw new Error("source_body_too_large");
      }
      return { text: String(text || ""), url: responseUrl };
    }
    throw new Error("source_redirect_limit");
  } catch (error) {
    throw new Error(classifyFetchFailure(error));
  } finally {
    clearTimeout(timer);
  }
}

function classifyFetchFailure(error) {
  const message = String(error?.message || "");
  if (error?.name === "AbortError") return "source_timeout";
  if (
    /^source_http_(?:[1-5]\d{2}|not_ok)$/.test(message) ||
    [
      "source_body_too_large",
      "source_redirect_cross_origin",
      "source_redirect_invalid",
      "source_redirect_limit",
      "source_timeout",
    ].includes(message)
  ) return message;
  return "source_fetch_failed";
}

function responseHeader(response, name) {
  if (!response?.headers) return null;
  if (typeof response.headers.get === "function") {
    return firstString(response.headers.get(name));
  }
  const key = Object.keys(response.headers).find(
    (entry) => entry.toLowerCase() === String(name).toLowerCase(),
  );
  return key ? firstString(response.headers[key]) : null;
}

function resolveRedirectUrl(location, currentUrl) {
  try {
    const url = new URL(location, currentUrl);
    if (!["http:", "https:"].includes(url.protocol)) return null;
    url.hash = "";
    return url.toString();
  } catch (_error) {
    return null;
  }
}

function isRedirectStatus(value) {
  return [301, 302, 303, 307, 308].includes(Number(value));
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

function rankDetailRows(rows) {
  return rows
    .map((row, index) => ({ ...row, order: index }))
    .sort((left, right) => {
      if (left.lastmod && right.lastmod && left.lastmod !== right.lastmod) {
        return right.lastmod.localeCompare(left.lastmod);
      }
      if (left.lastmod && !right.lastmod) return -1;
      if (!left.lastmod && right.lastmod) return 1;
      return left.order - right.order;
    })
    .map(({ order: _order, ...row }) => row);
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

function localClock(time) {
  if (!time) return null;
  return `${String(time.hour).padStart(2, "0")}:${String(time.minute).padStart(2, "0")}`;
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

function wixTimingKind(event) {
  if (event?.starts_at) return "timed";
  const window = event?.time_window;
  if (
    window?.kind === "daily" &&
    event.starts_on &&
    window.local_start &&
    window.local_end &&
    normalizeIanaTimezone(window.timezone)
  ) return "timed";
  if (
    window?.kind === "all_day" &&
    event.starts_on &&
    event.ends_on
  ) return "all_day";
  return null;
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

function normalizeSupportedSourceLanguage(value) {
  const language = normalizeLanguage(value);
  return SUPPORTED_SOURCE_LANGUAGES.has(language) ? language : null;
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
