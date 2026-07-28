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

const LOCALIZED_EVENTS_API_PROVIDER_ID = "generic-localized-events-api";
const DEFAULT_USER_AGENT = "Parranda/1.0 (+https://github.com/fritjofherrstrom-png/parranda)";
const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_LIMIT = 80;
const MAX_LIMIT = 200;
const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;
const MAX_BYTES = 5 * 1024 * 1024;

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
  const localStart = normalizeClock(record.start_time);
  const localEnd = normalizeClock(record.end_time);
  const coordinates = normalizeCoordinates(record.location);
  if (!id || !title || !startsOn) return null;

  const time = normalizeEventTime({
    startsOn,
    endsOn,
    localStart,
    localEnd,
    timezone,
  });
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
  if (localStart && localEnd) {
    return {
      time_window: {
        kind: "daily",
        starts_on: startsOn,
        ends_on: endsOn,
        local_start: localStart,
        local_end: localEnd,
        timezone,
      },
    };
  }
  return {
    time_window: { kind: "all_day", starts_on: startsOn, ends_on: endsOn },
  };
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
  const match = String(value || "").trim().match(/^(\d{2}):(\d{2})(?::\d{2})?$/);
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
