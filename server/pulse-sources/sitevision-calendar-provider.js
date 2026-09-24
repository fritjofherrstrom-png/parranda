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
const { MAX_OCCURRENCE_DATES } = require("./time-sensitive-event");

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
// A weekday rule is expanded only inside an explicit source range of at most
// this many days; open-ended or longer rules keep honest period semantics.
const MAX_RECURRENCE_RANGE_DAYS = 120;
// Year inference for dates listed without a year never reaches further than
// half a year from the source's own reference date.
const MAX_INFERRED_YEAR_DISTANCE_DAYS = 183;
const RECURRENCE_SECTION_MAX_CHARS = 8000;
const RECURRENCE_TEXT_MAX_CHARS = 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const TIMING_FIELDS = ["starts_at", "ends_at", "starts_on", "ends_on", "time_window"];

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

// Closed weekday vocabulary (JavaScript day numbers, Sunday = 0). Swedish
// singular/plural/definite forms and short forms occur in municipal date lists;
// English full names keep existing fixtures readable. Anything else is unknown.
const WEEKDAYS = Object.freeze({
  söndag: 0, söndagar: 0, söndagen: 0, sön: 0, sunday: 0, sundays: 0,
  måndag: 1, måndagar: 1, måndagen: 1, mån: 1, monday: 1, mondays: 1,
  tisdag: 2, tisdagar: 2, tisdagen: 2, tis: 2, tuesday: 2, tuesdays: 2,
  onsdag: 3, onsdagar: 3, onsdagen: 3, ons: 3, wednesday: 3, wednesdays: 3,
  torsdag: 4, torsdagar: 4, torsdagen: 4, tors: 4, tor: 4, thursday: 4, thursdays: 4,
  fredag: 5, fredagar: 5, fredagen: 5, fre: 5, friday: 5, fridays: 5,
  lördag: 6, lördagar: 6, lördagen: 6, lör: 6, saturday: 6, saturdays: 6,
});
const DAILY_WORDS = new Set(["dagligen", "daily", "everyday"]);
const EVERY_WORDS = new Set(["varje", "every", "alla", "each"]);
const JOIN_WORDS = new Set(["och", "samt", "and"]);
// Words that never change which days are meant ("kl 18.00", "på torsdagar").
const FILLER_WORDS = new Set(["kl", "klockan", "at", "på", "on", "den"]);

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
      "address",
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
    // A listing row has no recurrence section: a range with a clock stays a
    // period until its detail page states which days carry a session.
    const timing = parseSitevisionDateTime(timingText, {
      ...options,
      fallbackDate: listingDate,
      recurrence: null,
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
  const recurrenceSection = sectionTextAfterMarker(source, "Aterkommandetillfallen");
  const recurrence = recurrenceSection?.text || null;
  const timing = parseSitevisionDateTime(timingText, {
    ...options,
    expectedDate: options.expectedDate,
    recurrence,
    // A recurrence section without readable text, or one cut by the byte bound
    // (it may hide later dates), cannot be read as a complete occurrence list.
    recurrencePresent: Boolean(recurrenceSection),
    recurrenceComplete: recurrenceSection?.complete === true,
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
    // Source text for inspection only; the parsed timing above is the fact.
    recurrence: recurrence ? recurrence.slice(0, RECURRENCE_TEXT_MAX_CHARS) : null,
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
      // Detail timing is stronger evidence than the listing row. Replace the
      // timing atoms together so a listing instant cannot survive beside a
      // detail period or occurrence list and contradict it downstream.
      if (detail.time_window) {
        for (const key of TIMING_FIELDS) {
          if (detail[key] != null && detail[key] !== "") event[key] = detail[key];
          else delete event[key];
        }
      }
      for (const key of ["place_context", "address", "lat", "lng", "recurrence"]) {
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
  // The listing date is only a fallback for detail pages that omit their own
  // date. An explicit detail range is stronger source evidence and must not be
  // collapsed into the one listing occurrence we happened to follow.
  const explicitRange = parseDateRange(normalized, year);
  const range = explicitRange ||
    (expectedDate
      ? { start: datePartsFromKey(expectedDate), end: datePartsFromKey(expectedDate) }
      : fallbackDate
        ? { start: datePartsFromKey(fallbackDate), end: datePartsFromKey(fallbackDate) }
        : null);
  if (!range?.start) return { label };

  const timezone = normalizeIanaTimezone(options.timezone);
  const pattern = resolveSchedulePattern(options.recurrence, {
    range,
    explicitRange: Boolean(explicitRange),
    time: parseTimeRange(normalized),
    statesDaily: statesDailyOccurrence(label),
    present: options.recurrencePresent === true,
    complete: options.recurrenceComplete !== false,
  });
  const time = pattern.time;
  const startDateKey = dateKey(range.start);
  const endDateKey = dateKey(range.end || range.start);
  const multiDay = endDateKey !== startDateKey;
  const localStart = localClock(time?.start);
  const localEnd = localClock(time?.end);

  if (pattern.mode === "listed") {
    const first = pattern.dates[0];
    const last = pattern.dates[pattern.dates.length - 1];
    return compact({
      starts_on: first,
      ends_on: last,
      date_key: first,
      end_date_key: last !== first ? last : null,
      time_window: compact({
        kind: "occurrences",
        dates: pattern.dates,
        starts_on: first,
        ends_on: last,
        local_start: localStart,
        local_end: localEnd,
        timezone,
        label,
      }),
      label,
    }) || {};
  }

  // A multi-day range is not a daily schedule unless the source says so. With
  // a session clock, or with a recurrence the source did not make readable,
  // the range keeps period semantics: shown as a range, never as a given day.
  if (multiDay && pattern.mode !== "daily" && (time || pattern.mode === "unresolved")) {
    return compact({
      starts_on: startDateKey,
      ends_on: endDateKey,
      date_key: startDateKey,
      end_date_key: endDateKey,
      time_window: compact({
        kind: "period",
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

  if (multiDay) {
    return compact({
      starts_on: startDateKey,
      ends_on: endDateKey,
      date_key: startDateKey,
      end_date_key: endDateKey,
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

  // One stated date with a local clock but no reviewed timezone is still one
  // listed occurrence; it can never become a daily schedule.
  if (!timezone) {
    return compact({
      starts_on: startDateKey,
      ends_on: startDateKey,
      date_key: startDateKey,
      time_window: compact({
        kind: "occurrences",
        dates: [startDateKey],
        starts_on: startDateKey,
        ends_on: startDateKey,
        local_start: localStart,
        local_end: localEnd,
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

// Decide which days a stated range actually carries a session. `daily` needs a
// source statement; listed dates and weekday rules become explicit bounded
// occurrences; anything unreadable, contradictory, open-ended or truncated is
// `unresolved` and keeps period semantics. `none` means no recurrence evidence.
function resolveSchedulePattern(recurrenceText, { range, explicitRange, time, statesDaily, present, complete }) {
  const multiDay = dateKey(range.start) !== dateKey(range.end || range.start);
  const text = firstString(recurrenceText);
  // A recurrence section that exists but cannot be read still says the entry
  // recurs; it must not fall back to every-day date facts.
  if (!text && present) return { mode: "unresolved", time };
  if (!text) return { mode: statesDaily && multiDay ? "daily" : "none", time };
  const statement = complete ? parseScheduleStatement(text) : null;
  const everyDay = Boolean(statement?.daily || statement?.weekdays?.size === 7);
  // A stated "daily" line contradicted by a narrower recurrence is not daily.
  if (!statement || (statesDaily && !everyDay)) return { mode: "unresolved", time };
  const clock = mergeClocks(time, statement.clocks);
  if (clock === undefined) return { mode: "unresolved", time };

  if (everyDay) return { mode: multiDay ? "daily" : "none", time: clock };
  if (statement.weekdays) {
    // Without a stated end a weekday rule cannot be expanded. The explicitly
    // stated single date remains; later sessions are not claimed.
    if (!multiDay) return { mode: "none", time };
    const dates = expandWeekdays(range, statement.weekdays);
    return dates ? { mode: "listed", dates, time: clock } : { mode: "unresolved", time };
  }
  const dates = resolveListedDates(statement.dates, { range, multiDay, explicitRange });
  return dates ? { mode: "listed", dates, time: clock } : { mode: "unresolved", time };
}

function statesDailyOccurrence(label) {
  const tokens = tokenizeSchedule(label);
  if (!tokens) return false;
  let daily = false;
  for (const token of tokens) {
    if (token.type === "daily") daily = true;
    else if (!["date", "day", "clock", "dash", "join", "filler"].includes(token.type)) return false;
  }
  return daily;
}

// Closed grammar over the recurrence text: either one daily statement, one set
// of weekdays (with ranges such as "mån–fre"), or one list of dates (optionally
// prefixed by their weekday, or sharing a month: "2, 9 och 16 juli"). Clocks may
// accompany any of them. Every other word fails the whole statement.
function parseScheduleStatement(value) {
  const tokens = tokenizeSchedule(value);
  if (!tokens || tokens.length === 0) return null;
  const clocks = [];
  const dates = [];
  const weekdays = new Set();
  let pendingDays = [];
  let daily = false;
  let every = false;
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    const next = tokens[index + 1];
    if (token.type === "clock") clocks.push(token);
    else if (token.type === "daily") daily = true;
    else if (token.type === "every") every = true;
    else if (token.type === "join" || token.type === "filler") continue;
    else if (token.type === "day") pendingDays.push(token);
    else if (token.type === "date") {
      for (const day of pendingDays) {
        dates.push({ day: day.day, month: token.month, year: token.year, weekday: day.weekday });
      }
      pendingDays = [];
      dates.push(token);
    } else if (token.type === "weekday") {
      if (next?.type === "date" || next?.type === "day") {
        next.weekday = token.weekday; // a stated weekday must match its date
      } else if ((next?.type === "dash" || next?.type === "range") && tokens[index + 2]?.type === "weekday") {
        addWeekdayRange(weekdays, token.weekday, tokens[index + 2].weekday);
        index += 2;
      } else {
        weekdays.add(token.weekday);
      }
    } else {
      return null; // unknown words, stray dashes and range words outside weekday ranges
    }
  }
  if (pendingDays.length) return null;
  if ([daily, weekdays.size > 0, dates.length > 0].filter(Boolean).length !== 1) return null;
  if (every && weekdays.size === 0) return null;
  return {
    daily,
    weekdays: weekdays.size ? weekdays : null,
    dates: dates.length ? dates : null,
    clocks,
  };
}

function tokenizeSchedule(value) {
  const text = String(value || "")
    .toLocaleLowerCase("sv-SE")
    .replace(/[\u2012-\u2015\u2212]/g, "-")
    .replace(/\u00a0/g, " ")
    .trim();
  if (!text || text.length > 2000) return null;
  const tokens = [];
  let index = 0;
  while (index < text.length) {
    const match = matchScheduleToken(text, index);
    if (!match) return null;
    index += match.length;
    if (match.token) tokens.push(match.token);
    if (tokens.length > 400) return null;
  }
  return tokens;
}

function matchScheduleToken(text, index) {
  const at = (pattern) => {
    pattern.lastIndex = index;
    return pattern.exec(text);
  };
  let match = at(/\s+/y);
  if (match) return { length: match[0].length, token: null };
  match = at(/[,;:·|.]/y);
  if (match) return { length: 1, token: { type: "join" } };
  match = at(/(\d{4})-(\d{2})-(\d{2})(?!\d)/y);
  if (match) {
    return {
      length: match[0].length,
      token: { type: "date", year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) },
    };
  }
  match = at(/(?:(?:kl\.?|klockan)\s*)?(\d{1,2})[.:](\d{2})(?:\s*-\s*(\d{1,2})[.:](\d{2}))?(?!\d)/y);
  if (match) {
    const start = validTimeParts(Number(match[1]), Number(match[2]));
    const end = match[3] ? validTimeParts(Number(match[3]), Number(match[4])) : null;
    if (!start || (match[3] && !end)) return { length: match[0].length, token: { type: "unknown" } };
    return { length: match[0].length, token: { type: "clock", start, end } };
  }
  match = at(/(\d{1,2})\s+([a-zåäö]+)\.?(?:\s+(\d{4}))?(?![\da-zåäö])/y);
  if (match && Object.hasOwn(MONTHS, match[2])) {
    return {
      length: match[0].length,
      token: {
        type: "date",
        day: Number(match[1]),
        month: MONTHS[match[2]],
        year: match[3] ? Number(match[3]) : null,
      },
    };
  }
  match = at(/(\d{1,2})(?![\d.:])/y);
  if (match) return { length: match[0].length, token: { type: "day", day: Number(match[1]) } };
  match = at(/-/y);
  if (match) return { length: 1, token: { type: "dash" } };
  match = at(/(?:varje\s+dag|alla\s+dagar|every\s+day)(?![a-zåäö])/y);
  if (match) return { length: match[0].length, token: { type: "daily" } };
  match = at(/[a-zåäöé]+\.?/y);
  if (match) return { length: match[0].length, token: classifyScheduleWord(match[0].replace(/\.$/, "")) };
  return null;
}

function classifyScheduleWord(word) {
  if (Object.hasOwn(WEEKDAYS, word)) return { type: "weekday", weekday: WEEKDAYS[word] };
  if (DAILY_WORDS.has(word)) return { type: "daily" };
  if (EVERY_WORDS.has(word)) return { type: "every" };
  if (JOIN_WORDS.has(word)) return { type: "join" };
  if (FILLER_WORDS.has(word)) return { type: "filler" };
  if (word === "till" || word === "to") return { type: "range" };
  return { type: "unknown" };
}

function addWeekdayRange(weekdays, from, to) {
  for (let day = from, steps = 0; steps < 7; day = (day + 1) % 7, steps += 1) {
    weekdays.add(day);
    if (day === to) return;
  }
}

// One shared session clock: the stated time line and every listed clock must
// agree (a start-only clock agrees with a full range that has the same start).
function mergeClocks(time, clocks) {
  let merged = time || null;
  for (const clock of clocks) {
    if (!merged) {
      merged = clock;
      continue;
    }
    if (minutesOfDay(merged.start) !== minutesOfDay(clock.start)) return undefined;
    if (merged.end && clock.end && minutesOfDay(merged.end) !== minutesOfDay(clock.end)) return undefined;
    if (!merged.end && clock.end) merged = clock;
  }
  return merged;
}

function expandWeekdays(range, weekdays) {
  const start = utcDay(range.start);
  const end = utcDay(range.end || range.start);
  if (end < start || (end - start) / DAY_MS > MAX_RECURRENCE_RANGE_DAYS) return null;
  const dates = [];
  for (let day = start; day <= end; day += DAY_MS) {
    if (!weekdays.has(new Date(day).getUTCDay())) continue;
    dates.push(new Date(day).toISOString().slice(0, 10));
    if (dates.length > MAX_OCCURRENCE_DATES) return null;
  }
  return dates.length ? dates : null;
}

// Listed dates must all be real, match any stated weekday, and fall inside an
// explicit multi-day range. A single explicitly stated date is itself one of the
// occurrences; a listing fallback date is not evidence of a session.
function resolveListedDates(items, { range, multiDay, explicitRange }) {
  const first = dateKey(range.start);
  const last = dateKey(range.end || range.start);
  const dates = new Set(!multiDay && explicitRange ? [first] : []);
  for (const item of items) {
    const parts = item.year
      ? validDateParts(item.year, item.month, item.day)
      : nearestYearDate(item, range.start);
    if (!parts) return null;
    if (item.weekday != null && new Date(utcDay(parts)).getUTCDay() !== item.weekday) return null;
    const key = dateKey(parts);
    if (multiDay && (key < first || key > last)) return null;
    dates.add(key);
  }
  if (dates.size === 0 || dates.size > MAX_OCCURRENCE_DATES) return null;
  return [...dates].sort();
}

function nearestYearDate(item, reference) {
  let best = null;
  for (const year of [reference.year - 1, reference.year, reference.year + 1]) {
    const parts = validDateParts(year, item.month, item.day);
    if (!parts) continue;
    const distance = Math.abs(utcDay(parts) - utcDay(reference)) / DAY_MS;
    if (!best || distance < best.distance) best = { parts, distance };
  }
  return best && best.distance <= MAX_INFERRED_YEAR_DISTANCE_DAYS ? best.parts : null;
}

function utcDay(parts) {
  return Date.UTC(parts.year, parts.month - 1, parts.day);
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

// A detail section runs from its heading anchor to the next heading, heading
// anchor, bold field label ("Evenemangsplats:") or landmark. Sitevision portlet
// wrapper ids ("svid…") are layout, not section boundaries, and bold text that
// is not a label (such as a highlighted date) stays inside the section. The
// section is complete only when that boundary (or the end of the page) lies
// inside the byte bound.
const SECTION_BOUNDARY =
  /<h[1-6]\b|<[a-z][^>]*\sid=["'](?!svid)[^"']*["']|<strong\b[^>]*>[^<]{1,60}:\s*<\/strong>|<\/(?:section|article|main|body)\b|<(?:script|style|form|footer|nav)\b/i;
const HEADING_LIKE_TAGS = new Set(["h1", "h2", "h3", "h4", "h5", "h6", "span", "strong", "b", "a", "p", "dt", "label"]);

// Returns null only when the page has no such section. A section that exists
// but has no readable text is still recurrence evidence (`text: null`).
function sectionTextAfterMarker(html, markerId) {
  const source = String(html || "");
  const marker = new RegExp(`\\sid=["']${markerId}["']`, "i").exec(source);
  if (!marker) return null;
  const openEnd = source.indexOf(">", marker.index);
  if (openEnd < 0) return null;
  const bounded = source.slice(openEnd + 1, openEnd + 1 + RECURRENCE_SECTION_MAX_CHARS);
  const reachedPageEnd = openEnd + 1 + RECURRENCE_SECTION_MAX_CHARS >= source.length;
  // The anchor element's own heading text is not part of its section: skip a
  // heading-like anchor element whole, or a wrapper's leading heading.
  const markerTag = /<([a-z][a-z0-9]*)\b[^<]*$/i.exec(source.slice(0, marker.index))?.[1]?.toLowerCase();
  let tail = bounded;
  if (HEADING_LIKE_TAGS.has(markerTag)) {
    const close = new RegExp(`</${markerTag}\\s*>`, "i").exec(tail);
    if (close) tail = tail.slice(close.index + close[0].length);
  }
  tail = tail.replace(/^\s*<h[1-6]\b[^>]*>[\s\S]*?<\/h[1-6]\s*>/i, "");
  const end = tail.search(SECTION_BOUNDARY);
  const lines = decodeHtml(
    (end >= 0 ? tail.slice(0, end) : tail)
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(?:p|li|div|dd|dt|tr)\s*>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  return { text: lines.length ? lines.join("; ") : null, complete: end >= 0 || reachedPageEnd };
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
