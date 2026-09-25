"use strict";

/**
 * Bounded adapter for reviewed public event APIs with localized title maps,
 * date/time fields, venue geometry, and paginated `results` rows.
 *
 * Source ownership, trust, license, timezone, and geographic coverage remain
 * manifest data. The adapter only translates the reviewed wire contract into
 * Parranda's shared time-sensitive event atoms.
 */

const { GENERIC_PROVIDER_CITY } = require("./provider-registry");
const { buildProviderCollectionOutcome } = require("./provider-collection-outcome");
const {
  normalizeIanaTimezone,
  normalizeSourceEventDate,
  normalizeSourceEventDateTime,
} = require("./source-event-time");
const { MAX_OCCURRENCE_DATES } = require("./time-sensitive-event");

const LOCALIZED_EVENTS_API_PROVIDER_ID = "generic-localized-events-api";
const DEFAULT_USER_AGENT = "Parranda/1.0 (+https://github.com/fritjofherrstrom-png/parranda)";
const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_LIMIT = 80;
const MAX_LIMIT = 200;
const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;
const MAX_BYTES = 5 * 1024 * 1024;
// Processing bound for one record's listed sessions; a longer list is not read.
const MAX_LISTED_SCHEDULE_ENTRIES = 400;

function buildDescriptor(options = {}) {
  const descriptor = {
    id: options.id || LOCALIZED_EVENTS_API_PROVIDER_ID,
    label: options.label || "Localized public events API",
    city: GENERIC_PROVIDER_CITY,
    role: options.role || "official_live_baseline",
    sourceType: options.sourceType || "official_api",
    status: options.status || "candidate",
    intendedUse: "pulse",
    supportedLanguages: normalizeLanguages(options.supportedLanguages, options.sourceLanguage),
    updateCadence: options.updateCadence || "hourly",
    parsingRisk: options.parsingRisk || "low",
    trust: {
      source_tier: "verified",
      confidence: "low",
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
      "address",
      "area",
      "lat",
      "lng",
      "tags",
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

function createLocalizedEventsApiProvider(providerOptions = {}) {
  const timezone = normalizeIanaTimezone(providerOptions.timezone);
  const descriptor = buildDescriptor({
    ...providerOptions,
    timezone: timezone || undefined,
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
          if (!timezone) return emptyCollection("unavailable", "source_timezone_unavailable");

          const limit = clampInteger(providerOptions.limit, 1, MAX_LIMIT, DEFAULT_LIMIT);
          const sourceLanguage = normalizeLanguage(providerOptions.sourceLanguage) || "en";
          let url;
          try {
            url = buildEventsUrl(endpoint, limit);
          } catch (_error) {
            return emptyCollection("unavailable", "source_endpoint_unavailable");
          }
          const payloadResult = await fetchBoundedJson(fetcher, url, providerOptions);
          if (!payloadResult.ok) return emptyCollection("failed", payloadResult.reason);

          const records = Array.isArray(payloadResult.payload?.results)
            ? payloadResult.payload.results
            : null;
          if (!records) return emptyCollection("failed", "source_payload_invalid");

          const rows = records
            .slice(0, limit)
            .map((record) => mapLocalizedEventApiRecord(record, {
              timezone,
              sourceLanguage,
            }))
            .filter(Boolean);
          if (records.length > 0 && rows.length === 0) {
            return emptyCollection("failed", "source_payload_invalid");
          }

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

function buildEventsUrl(endpoint, limit) {
  const url = new URL(endpoint);
  url.searchParams.set("page", "1");
  url.searchParams.set("size", String(limit));
  return url.toString();
}

async function fetchBoundedJson(fetcher, url, options = {}) {
  const timeoutMs = clampInteger(options.timeoutMs, 50, 60000, DEFAULT_TIMEOUT_MS);
  const maxBytes = clampInteger(options.maxBytes, 1024, MAX_BYTES, DEFAULT_MAX_BYTES);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let phase = "fetch";
  try {
    const response = await fetcher(url, {
      headers: {
        "User-Agent": options.userAgent || DEFAULT_USER_AGENT,
        Accept: "application/json",
      },
      redirect: "manual",
      signal: controller.signal,
    });
    if (!response || response.ok !== true) {
      return { ok: false, reason: `source_http_${response?.status || "not_ok"}` };
    }
    if (response.url && !sameOrigin(url, response.url)) {
      return { ok: false, reason: "source_redirect_cross_origin" };
    }

    phase = "payload";
    const text = typeof response.text === "function"
      ? await response.text()
      : JSON.stringify(await response.json());
    if (Buffer.byteLength(String(text || ""), "utf8") > maxBytes) {
      return { ok: false, reason: "source_payload_invalid" };
    }
    return { ok: true, payload: JSON.parse(String(text || "")) };
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

function mapLocalizedEventApiRecord(record, { timezone, sourceLanguage } = {}) {
  if (!record || typeof record !== "object" || Array.isArray(record)) return null;
  const id = firstString(record.id);
  const title = localizedString(record.title, sourceLanguage);
  const startsOn = normalizeSourceEventDate(record.start_date);
  const endsOn = normalizeSourceEventDate(record.end_date) || startsOn;
  let localStart = normalizeClock(record.start_time);
  let localEnd = normalizeClock(record.end_time);
  const coordinates = normalizeCoordinates(record.location);
  if (!id || !title || !startsOn) return null;

  // The reviewed wire shape also carries clocks inside schedule.dates. Only
  // one unambiguous same-day occurrence is translated here: never borrow a
  // clock from another date, bridge multiple sessions, or guess an overnight
  // end date. Recurring/range schedules retain their existing date semantics.
  if (startsOn === endsOn && record.schedule?.range == null &&
      Array.isArray(record.schedule?.dates) && record.schedule.dates.length) {
    if (record.schedule.dates.length !== 1) return null;
    const occurrence = record.schedule.dates[0];
    if (normalizeSourceEventDate(occurrence?.date) !== startsOn) return null;
    const scheduledStart = normalizeClock(occurrence.start_time);
    const scheduledEnd = normalizeClock(occurrence.end_time);
    if ((record.start_time != null && !localStart) ||
        (record.end_time != null && !localEnd) ||
        (occurrence.start_time != null && !scheduledStart) ||
        (occurrence.end_time != null && !scheduledEnd)) return null;
    if ((localStart && scheduledStart && localStart !== scheduledStart) ||
        (localEnd && scheduledEnd && localEnd !== scheduledEnd)) return null;
    localStart = scheduledStart || localStart;
    localEnd = scheduledEnd || localEnd;
    if (localStart && localEnd && localEnd <= localStart) return null;
  }

  const time = startsOn === endsOn
    ? normalizeEventTime({ startsOn, endsOn, localStart, localEnd, timezone })
    : rangeEventTime(record.schedule, {
      startsOn,
      endsOn,
      localStart,
      localEnd,
      malformedClock: (record.start_time != null && !localStart) || (record.end_time != null && !localEnd),
      timezone,
    });
  if (startsOn === endsOn && localStart && localEnd &&
      time.time_window.kind !== "continuous") return null;
  return compact({
    id,
    title,
    name: title,
    source_url: firstString(record.external_website_url, record.source_url),
    place_context: firstString(record.venue_name),
    address: firstString(record.address),
    area: firstString(record.address, record.city),
    lat: coordinates.lat,
    lng: coordinates.lng,
    starts_at: time.starts_at,
    ends_at: time.ends_at,
    starts_on: startsOn,
    ends_on: endsOn,
    time_window: time.time_window,
    freshness: firstString(record.event_status) === "cancelled" ? "stale" : null,
    last_checked: firstString(record.modified_at, record.created_at),
    source_language: sourceLanguage,
    event_language: hasLocalizedValue(record.title, sourceLanguage) ? sourceLanguage : null,
    translation_status: "not_required",
    tags: categoryTags(record.categories),
    provenance: compact({
      source_url: firstString(record.external_website_url, record.source_url),
      retrieved_at: firstString(record.modified_at, record.created_at),
    }),
  });
}

function normalizeEventTime({ startsOn, endsOn, localStart, localEnd, timezone }) {
  if (localStart && localEnd && startsOn === endsOn) {
    const startsAt = normalizeSourceEventDateTime(`${startsOn}T${localStart}`, { timezone });
    const endsAt = normalizeSourceEventDateTime(`${endsOn}T${localEnd}`, { timezone });
    if (startsAt && endsAt) {
      return {
        starts_at: startsAt,
        ends_at: endsAt,
        time_window: { kind: "continuous", starts_at: startsAt, ends_at: endsAt },
      };
    }
  }
  return {
    time_window: { kind: "all_day", starts_on: startsOn, ends_on: endsOn },
  };
}

// A multi-day record states its span, not that every day of it carries a
// session. Sessions listed in schedule.dates inside the span are the stated
// days (every day listed is a daily statement). Unusable listings, and a
// clocked span without listings, keep period semantics. The schedule.range
// object is not interpreted: a date-only span without listings stays all-day.
function rangeEventTime(schedule, { startsOn, endsOn, localStart, localEnd, malformedClock, timezone }) {
  const listed = listedScheduleSessions(schedule, { startsOn, endsOn, localStart, localEnd, malformedClock });
  const start = listed?.localStart || localStart;
  const end = listed?.localEnd || localEnd;
  if (listed?.dates) {
    const everyDay = listed.dates.length === calendarDaysBetween(startsOn, endsOn) + 1;
    if (everyDay && !start && !end) {
      return { time_window: { kind: "all_day", starts_on: startsOn, ends_on: endsOn } };
    }
    if (everyDay && start && end) {
      return {
        time_window: compact({ kind: "daily", starts_on: startsOn, ends_on: endsOn, local_start: start, local_end: end, timezone }),
      };
    }
    if (listed.dates.length <= MAX_OCCURRENCE_DATES) {
      return {
        time_window: compact({
          kind: "occurrences",
          dates: listed.dates,
          starts_on: listed.dates[0],
          ends_on: listed.dates[listed.dates.length - 1],
          local_start: start,
          local_end: end,
          timezone,
        }),
      };
    }
  }
  if (listed || localStart || localEnd) {
    return {
      time_window: compact({
        kind: "period",
        starts_on: startsOn,
        ends_on: endsOn,
        local_start: start,
        local_end: end,
        timezone,
      }),
    };
  }
  return {
    time_window: { kind: "all_day", starts_on: startsOn, ends_on: endsOn },
  };
}

// Returns null when no sessions are listed, { dates, localStart, localEnd } for
// a usable listing, and { unusable: true } when listed sessions exist but fall
// outside the span, disagree on their clock, carry malformed or overnight
// clocks, or exceed the processing bound. A malformed record clock makes the
// listing unusable too: a valid listed clock must not hide it. A usable listing
// longer than the occurrence bound still counts when it names every day of the
// span.
function listedScheduleSessions(schedule, { startsOn, endsOn, localStart, localEnd, malformedClock }) {
  const entries = schedule?.dates;
  if (!Array.isArray(entries) || entries.length === 0) return null;
  const unusable = { unusable: true };
  if (malformedClock || entries.length > MAX_LISTED_SCHEDULE_ENTRIES) return unusable;
  const dates = new Set();
  let start = localStart;
  let end = localEnd;
  let starts = 0;
  let ends = 0;
  for (const entry of entries) {
    const date = normalizeSourceEventDate(entry?.date);
    if (!date || date < startsOn || date > endsOn) return unusable;
    const entryStart = normalizeClock(entry.start_time);
    const entryEnd = normalizeClock(entry.end_time);
    if ((entry.start_time != null && !entryStart) || (entry.end_time != null && !entryEnd)) return unusable;
    if ((entryStart && start && entryStart !== start) || (entryEnd && end && entryEnd !== end)) return unusable;
    start = start || entryStart;
    end = end || entryEnd;
    if (entryStart) starts += 1;
    if (entryEnd) ends += 1;
    dates.add(date);
  }
  // A start or end only some sessions state is not their shared clock unless
  // the record states it: never lend one session's clock to another.
  if ((starts > 0 && starts < entries.length && !localStart) ||
      (ends > 0 && ends < entries.length && !localEnd)) return unusable;
  if (start && end && end <= start) return unusable;
  return { dates: [...dates].sort(), localStart: start, localEnd: end };
}

function calendarDaysBetween(first, last) {
  return Math.round((Date.parse(`${last}T00:00:00Z`) - Date.parse(`${first}T00:00:00Z`)) / (24 * 60 * 60 * 1000));
}

function categoryTags(categories) {
  const tags = [];
  for (const category of Array.isArray(categories) ? categories : []) {
    if (!category || typeof category !== "object") continue;
    tags.push(firstString(category.slug), firstString(category.title));
    for (const subcategory of Array.isArray(category.subcategories) ? category.subcategories : []) {
      if (!subcategory || typeof subcategory !== "object") continue;
      tags.push(firstString(subcategory.slug), firstString(subcategory.title));
    }
  }
  return [...new Set(tags.filter(Boolean))];
}

function localizedString(value, language) {
  if (typeof value === "string") return value.trim() || null;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const preferred = normalizeLanguage(language);
  return firstString(
    preferred ? value[preferred] : null,
    value.sv,
    value.en,
    ...Object.values(value),
  );
}

function hasLocalizedValue(value, language) {
  return Boolean(value && typeof value === "object" && firstString(value[language]));
}

function normalizeCoordinates(location) {
  const lat = Number(location?.latitude ?? location?.lat);
  const lng = Number(location?.longitude ?? location?.lng ?? location?.lon);
  return {
    lat: Number.isFinite(lat) ? lat : null,
    lng: Number.isFinite(lng) ? lng : null,
  };
}

function normalizeClock(value) {
  const match = String(value || "").trim().match(/^(\d{2}):(\d{2})(?::([0-5]\d))?$/);
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) return null;
  return `${match[1]}:${match[2]}`;
}

function normalizeLanguages(values, fallback) {
  const normalized = (Array.isArray(values) ? values : [fallback || "en"])
    .map(normalizeLanguage)
    .filter(Boolean);
  return normalized.length ? [...new Set(normalized)] : ["en"];
}

function normalizeLanguage(value) {
  const language = String(value || "").trim().toLowerCase().split(/[-_]/)[0];
  return /^[a-z]{2,3}$/.test(language) ? language : null;
}

function sameOrigin(left, right) {
  try {
    return new URL(left).origin === new URL(right).origin;
  } catch (_error) {
    return false;
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

function clampInteger(value, min, max, fallback) {
  const number = Number.isFinite(Number(value)) ? Math.floor(Number(value)) : fallback;
  return Math.max(min, Math.min(number, max));
}

function firstString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function compact(value) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== null && entry !== undefined));
}

module.exports = {
  DEFAULT_LIMIT,
  LOCALIZED_EVENTS_API_PROVIDER_ID,
  MAX_LIMIT,
  buildEventsUrl,
  createLocalizedEventsApiProvider,
  mapLocalizedEventApiRecord,
};
