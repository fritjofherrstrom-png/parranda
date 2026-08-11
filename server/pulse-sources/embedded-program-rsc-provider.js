"use strict";

/**
 * Bounded adapter for factual event programs embedded in server-rendered
 * Next/React Flight data. Source ownership, trust, language, timezone, and
 * activation remain reviewed manifest data; this parser only reads explicit
 * stage and booking atoms already present in the public HTML response.
 */

const { GENERIC_PROVIDER_CITY } = require("./provider-registry");
const { buildProviderCollectionOutcome } = require("./provider-collection-outcome");
const {
  datePartsInTimezone,
  normalizeIanaTimezone,
  normalizeSourceEventDateTime,
} = require("./source-event-time");

const EMBEDDED_PROGRAM_RSC_PROVIDER_ID = "generic-embedded-program-rsc";
const DEFAULT_USER_AGENT = "Parranda/1.0 (+https://github.com/fritjofherrstrom-png/parranda)";
const DEFAULT_TIMEOUT_MS = 12000;
const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;
const MAX_BYTES = 5 * 1024 * 1024;
// Large public festivals can publish hundreds of same-day program atoms. The
// source cap must contain the whole active day often enough for downstream
// salience to see evening headliners, rather than ranking only the first rows.
// Public output remains separately capped by the shared Live surface.
const DEFAULT_LIMIT = 250;
const MAX_LIMIT = 500;
const DEFAULT_HORIZON_DAYS = 7;
const MAX_HORIZON_DAYS = 31;
const DEFAULT_MAX_REDIRECTS = 3;
const MAX_REDIRECTS = 5;

function createEmbeddedProgramRscProvider(providerOptions = {}) {
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
          if (typeof fetcher !== "function") {
            return emptyCollection("unavailable", "source_fetch_unavailable");
          }
          if (!timezone) return emptyCollection("unavailable", "source_timezone_unavailable");
          if (!sourceLanguage) {
            return emptyCollection("unavailable", "source_language_unavailable");
          }

          const response = await fetchBoundedHtml(fetcher, endpoint, providerOptions);
          if (!response.ok) return emptyCollection("failed", response.reason);

          const parsed = extractEmbeddedProgramRsc(response.text, {
            sourceUrl: response.url,
            sourceLanguage,
            timezone,
            detailPathPrefix: providerOptions.detailPathPrefix,
          });
          if (!parsed.recognized) {
            return emptyCollection("failed", "source_payload_invalid");
          }

          const limit = clampInteger(providerOptions.limit, 1, MAX_LIMIT, DEFAULT_LIMIT);
          const horizonDays = clampInteger(
            providerOptions.horizonDays,
            1,
            MAX_HORIZON_DAYS,
            DEFAULT_HORIZON_DAYS,
          );
          const collectionDate = normalizeDateKey(collectionContext.date || context.date);
          const rows = boundProgramEvents(parsed.events, {
            collectionDate,
            horizonDays,
            timezone,
            limit,
          });

          if (parsed.booking_count > 0 && parsed.parseable_occurrence_count === 0) {
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

function buildDescriptor(options = {}) {
  const sourceLanguage = normalizeLanguage(options.sourceLanguage);
  const descriptor = {
    id: options.id || EMBEDDED_PROGRAM_RSC_PROVIDER_ID,
    label: options.label || "Embedded public event program",
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

function hasEmbeddedProgramRscSignature(html) {
  const source = String(html || "");
  if (!source.includes("self.__next_f.push")) return false;
  const decoded = decodeNextFlightPayload(source, { maxDecodedBytes: DEFAULT_MAX_BYTES });
  return decoded.includes('"stages":[') && decoded.includes('"bookings":[');
}

function extractEmbeddedProgramRsc(html, options = {}) {
  const sourceUrl = normalizeHttpUrl(options.sourceUrl);
  const timezone = normalizeIanaTimezone(options.timezone);
  const sourceLanguage = normalizeLanguage(options.sourceLanguage);
  if (!sourceUrl || !timezone || !sourceLanguage) return emptyParsedProgram(false);

  const decoded = decodeNextFlightPayload(html, { maxDecodedBytes: MAX_BYTES });
  if (!decoded.includes('"stages":[') || !decoded.includes('"bookings":[')) {
    return emptyParsedProgram(false);
  }

  const stages = extractLargestJsonArray(decoded, "stages");
  const bookings = extractLargestJsonArray(decoded, "bookings");
  if (!stages || !bookings) return emptyParsedProgram(true);

  const stageIndex = new Map();
  for (const stage of stages) {
    const id = stableId(stage?.id);
    const coordinates = normalizeCoordinates(stage?.gpsCoordinates);
    if (!id) continue;
    stageIndex.set(id, compact({
      id,
      title: firstString(stage?.title),
      address: firstString(stage?.address),
      lat: coordinates.lat,
      lng: coordinates.lng,
    }));
  }

  const detailPathPrefix = normalizePathPrefix(options.detailPathPrefix) || "/program/";
  const events = [];
  let occurrenceCount = 0;
  for (const booking of bookings) {
    const bookingId = stableId(booking?.id);
    const title = firstString(booking?.title, booking?.name);
    if (!bookingId || !title) continue;
    const tags = normalizeTags(booking?.tags);
    for (const occurrence of Array.isArray(booking?.dates) ? booking.dates : []) {
      occurrenceCount += 1;
      const startsAt = normalizeSourceEventDateTime(occurrence?.startDate, { timezone });
      const endsAt = normalizeSourceEventDateTime(occurrence?.endDate, { timezone });
      if (!startsAt || !endsAt || Date.parse(endsAt) <= Date.parse(startsAt)) continue;

      const sceneId = stableId(occurrence?.scene?.id);
      const stage = sceneId ? stageIndex.get(sceneId) : null;
      const sourceDetailUrl = new URL(
        `${detailPathPrefix}${encodeURIComponent(bookingId)}`,
        sourceUrl,
      ).toString();
      events.push(compact({
        id: `${bookingId}:${startsAt}`,
        title,
        name: title,
        starts_at: startsAt,
        ends_at: endsAt,
        time_window: { kind: "continuous", starts_at: startsAt, ends_at: endsAt },
        source_url: sourceDetailUrl,
        place_context: firstString(stage?.title, occurrence?.scene?.title),
        address: firstString(stage?.address),
        area: firstString(stage?.title),
        lat: stage?.lat,
        lng: stage?.lng,
        source_language: sourceLanguage,
        event_language: sourceLanguage,
        translation_status: "not_required",
        tags,
        provenance: {
          source_url: sourceDetailUrl,
          source_page: sourceUrl,
          source_record_id: bookingId,
        },
      }));
    }
  }

  return {
    recognized: true,
    booking_count: bookings.length,
    occurrence_count: occurrenceCount,
    parseable_occurrence_count: events.length,
    stage_count: stageIndex.size,
    events,
  };
}

function decodeNextFlightPayload(html, { maxDecodedBytes = DEFAULT_MAX_BYTES } = {}) {
  const source = String(html || "");
  const chunks = [];
  const scriptPattern = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  let decodedBytes = 0;
  while ((match = scriptPattern.exec(source))) {
    const script = match[1];
    let offset = 0;
    while ((offset = script.indexOf("self.__next_f.push", offset)) !== -1) {
      const arrayStart = script.indexOf("[", offset);
      if (arrayStart === -1) break;
      const json = balancedJsonValue(script, arrayStart, "[", "]");
      if (!json) break;
      offset = arrayStart + json.length;
      try {
        const payload = JSON.parse(json);
        const chunk = typeof payload?.[1] === "string" ? payload[1] : null;
        if (!chunk) continue;
        decodedBytes += Buffer.byteLength(chunk, "utf8");
        if (decodedBytes > maxDecodedBytes) return "";
        chunks.push(chunk);
      } catch (_error) {
        // One malformed Flight chunk must not expose or poison unrelated data.
      }
    }
  }
  return chunks.join("");
}

function extractLargestJsonArray(source, key) {
  const needle = JSON.stringify(String(key)) + ":";
  const arrays = [];
  let offset = 0;
  while ((offset = source.indexOf(needle, offset)) !== -1) {
    const start = source.indexOf("[", offset + needle.length);
    if (start === -1) break;
    const json = balancedJsonValue(source, start, "[", "]");
    offset = start + 1;
    if (!json) continue;
    try {
      const parsed = JSON.parse(json);
      if (Array.isArray(parsed)) arrays.push(parsed);
    } catch (_error) {
      // Keep scanning for another complete server-rendered value.
    }
  }
  return arrays.sort((left, right) => right.length - left.length)[0] || null;
}

function balancedJsonValue(source, start, open, close) {
  if (source[start] !== open) return null;
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let index = start; index < source.length; index += 1) {
    const character = source[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') quoted = false;
      continue;
    }
    if (character === '"') quoted = true;
    else if (character === open) depth += 1;
    else if (character === close) {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  return null;
}

function boundProgramEvents(events, { collectionDate, horizonDays, timezone, limit } = {}) {
  const lastDate = collectionDate ? addDateDays(collectionDate, horizonDays) : null;
  return (Array.isArray(events) ? events : [])
    .filter((event) => {
      if (!collectionDate || !lastDate) return true;
      const startDate = localDateKey(event.starts_at, timezone);
      const endDate = localDateKey(event.ends_at, timezone);
      return Boolean(startDate && endDate && endDate >= collectionDate && startDate <= lastDate);
    })
    .sort((left, right) =>
      Date.parse(left.starts_at) - Date.parse(right.starts_at) ||
      String(left.id).localeCompare(String(right.id)),
    )
    .slice(0, limit);
}

async function fetchBoundedHtml(fetcher, endpoint, options = {}) {
  const timeoutMs = clampInteger(options.timeoutMs, 50, 60000, DEFAULT_TIMEOUT_MS);
  const maxBytes = clampInteger(options.maxBytes, 1024, MAX_BYTES, DEFAULT_MAX_BYTES);
  const maxRedirects = clampInteger(
    options.maxRedirects,
    0,
    MAX_REDIRECTS,
    DEFAULT_MAX_REDIRECTS,
  );
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
        if (redirects >= maxRedirects) {
          return { ok: false, reason: "source_redirect_limit" };
        }
        const location = response?.headers?.get?.("location");
        const redirected = normalizeHttpUrl(location, url);
        if (!redirected) return { ok: false, reason: "source_redirect_invalid" };
        if (new URL(redirected).origin !== expectedOrigin) {
          return { ok: false, reason: "source_redirect_cross_origin" };
        }
        url = redirected;
        continue;
      }
      if (!response || response.ok !== true) {
        return { ok: false, reason: `source_http_${response?.status || "not_ok"}` };
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
      const text = await response.text();
      if (Buffer.byteLength(String(text || ""), "utf8") > maxBytes) {
        return { ok: false, reason: "source_payload_invalid" };
      }
      return { ok: true, url: responseUrl, text: String(text || "") };
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

function normalizeCoordinates(value) {
  const lat = Number(value?.lat ?? value?.latitude);
  const lng = Number(value?.lng ?? value?.lon ?? value?.longitude);
  return {
    lat: Number.isFinite(lat) && Math.abs(lat) <= 90 ? lat : null,
    lng: Number.isFinite(lng) && Math.abs(lng) <= 180 ? lng : null,
  };
}

function normalizeTags(values) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map((value) => firstString(value?.name, value?.title, value))
    .filter(Boolean))];
}

function normalizeLanguage(value) {
  const language = String(value || "").trim().toLowerCase().split(/[-_]/)[0];
  return /^[a-z]{2,3}$/.test(language) ? language : null;
}

function normalizePathPrefix(value) {
  const path = firstString(value);
  if (!path) return null;
  const normalized = `/${path.replace(/^\/+|\/+$/g, "")}/`;
  return normalized === "//" ? null : normalized;
}

function normalizeHttpUrl(value, base) {
  try {
    const url = base ? new URL(String(value || ""), base) : new URL(String(value || ""));
    return ["http:", "https:"].includes(url.protocol) ? url.toString() : null;
  } catch (_error) {
    return null;
  }
}

function localDateKey(value, timezone) {
  const parts = datePartsInTimezone(value, timezone);
  return parts
    ? `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`
    : null;
}

function normalizeDateKey(value) {
  const key = String(value || "").slice(0, 10);
  const date = new Date(`${key}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === key ? key : null;
}

function addDateDays(value, days) {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + Number(days || 0));
  return date.toISOString().slice(0, 10);
}

function stableId(value) {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return firstString(value);
}

function isRedirect(status) {
  return [301, 302, 303, 307, 308].includes(Number(status));
}

function emptyParsedProgram(recognized) {
  return {
    recognized,
    booking_count: 0,
    occurrence_count: 0,
    parseable_occurrence_count: 0,
    stage_count: 0,
    events: [],
  };
}

function emptyCollection(status, reason) {
  return {
    events: [],
    signals: [],
    time_sensitive_events: [],
    collection_status: buildProviderCollectionOutcome(status, { reason, eventRows: 0 }),
  };
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
  return Object.fromEntries(Object.entries(value || {}).filter(([, entry]) =>
    entry !== null && entry !== undefined && entry !== "",
  ));
}

module.exports = {
  EMBEDDED_PROGRAM_RSC_PROVIDER_ID,
  createEmbeddedProgramRscProvider,
  decodeNextFlightPayload,
  extractEmbeddedProgramRsc,
  fetchBoundedHtml,
  hasEmbeddedProgramRscSignature,
};
