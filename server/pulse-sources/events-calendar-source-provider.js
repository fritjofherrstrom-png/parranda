/**
 * Generic The Events Calendar / iCal source provider.
 *
 * This is a reusable source-family adapter, not a city integration. It emits
 * raw `time_sensitive_events` from either WordPress The Events Calendar REST
 * payloads or iCal/ICS VEVENT feeds. The registry bridge owns source defaults,
 * final normalization, confidence gates, and fail-soft behavior.
 */

const { GENERIC_PROVIDER_CITY } = require("./provider-registry");
const { buildProviderCollectionOutcome } = require("./provider-collection-outcome");
const {
  normalizeIanaTimezone,
  normalizeSourceEventDate,
  normalizeSourceEventDateTime,
  normalizeUtcEventDateTime,
} = require("./source-event-time");

const EVENTS_CALENDAR_PROVIDER_ID = "generic-events-calendar-ical";
const DEFAULT_USER_AGENT = "Parranda/1.0 (+https://github.com/fritjofherrstrom-png/parranda)";
const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

function buildDescriptor({
  id,
  label,
  sourceUrl,
  license,
  status = "candidate",
  sourceType = "official_website",
  supportedLanguages,
  updateCadence,
  parsingRisk,
  trust,
  timezone,
} = {}) {
  const descriptor = {
    id: id || EVENTS_CALENDAR_PROVIDER_ID,
    label: label || "The Events Calendar / iCal",
    city: GENERIC_PROVIDER_CITY,
    role: "official_live_baseline",
    sourceType,
    status,
    intendedUse: "pulse",
    supportedLanguages: Array.isArray(supportedLanguages) && supportedLanguages.length
      ? supportedLanguages
      : ["en"],
    updateCadence: updateCadence || "hourly",
    parsingRisk: parsingRisk || "medium",
    trust: {
      source_tier: "official",
      confidence: "medium",
      human_verified: false,
      freshness: "fresh",
      ...(trust && typeof trust === "object" ? trust : {}),
    },
    cachePolicy: { kind: "memory", ttlSeconds: 1800 },
    sourceOwnedFields: [
      "title",
      "starts_at",
      "ends_at",
      "starts_on",
      "ends_on",
      "time_window",
      "lat",
      "lng",
      "source_url",
      "place_context",
    ],
    parrandaOwnedFields: ["intents", "route_role_hint"],
  };
  if (sourceUrl) descriptor.sourceUrl = sourceUrl;
  if (license) descriptor.license_label = license;
  if (timezone) descriptor.timezone = timezone;
  return descriptor;
}

function createEventsCalendarProvider(providerOptions = {}) {
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
          const userAgent = providerOptions.userAgent || DEFAULT_USER_AGENT;
          const timeoutMs = Math.max(50, Math.floor(providerOptions.timeoutMs || DEFAULT_TIMEOUT_MS));
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), timeoutMs);

          let body;
          let contentType = "";
          try {
            const response = await fetcher(endpoint, {
              headers: { "User-Agent": userAgent, Accept: "application/json, text/calendar, text/plain" },
              signal: controller.signal,
            });
            if (!response || response.ok !== true) {
              throw new Error(`source_http_${response?.status || "not_ok"}`);
            }
            contentType = response.headers?.get?.("content-type") || "";
            body = await readResponseBody(response);
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

          const format = normalizeFormat(providerOptions.format || collectionContext.format || context.format);
          if (isInvalidJsonPayload(body, { format, contentType })) {
            return emptyCollection("failed", "source_payload_invalid");
          }
          const events = extractEventsCalendarSourceEvents(body, { format, contentType })
            .slice(0, limit)
            .map((event) =>
              mapEventsCalendarEventToRaw(event, {
                timezone: normalizeIanaTimezone(providerOptions.timezone),
              }),
            )
            .filter(Boolean);
          return {
            events: [],
            signals: [],
            time_sensitive_events: events,
            collection_status: buildProviderCollectionOutcome(events.length ? "ok" : "empty", {
              reason: events.length ? null : "source_empty",
              eventRows: events.length,
            }),
          };
        },
      };
    },
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

function isInvalidJsonPayload(payload, { format, contentType } = {}) {
  if (typeof payload !== "string" || !payload.trim()) return false;
  if (format === "ical" || looksLikeIcal(payload, contentType)) return false;
  return safeJsonParse(payload) == null;
}

async function readResponseBody(response) {
  if (typeof response.text === "function") return response.text();
  if (typeof response.json === "function") return response.json();
  return null;
}

function extractEventsCalendarSourceEvents(payload, options = {}) {
  if (!payload) return [];
  const format = normalizeFormat(options.format);
  if (format === "ical" || looksLikeIcal(payload, options.contentType)) {
    return extractIcalEvents(String(payload || ""));
  }
  const json = typeof payload === "string" ? safeJsonParse(payload) : payload;
  return extractTheEventsCalendarEvents(json);
}

function extractTheEventsCalendarEvents(payload) {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload.filter(isObject);
  if (Array.isArray(payload.events)) return payload.events.filter(isObject);
  if (Array.isArray(payload.data)) return payload.data.filter(isObject);
  if (isObject(payload) && (payload.id || payload.title || payload.start_date)) return [payload];
  return [];
}

function mapEventsCalendarEventToRaw(event, options = {}) {
  if (!isObject(event)) return null;
  return event.__source_format === "ical"
    ? mapIcalEventToRaw(event)
    : mapTheEventsCalendarEventToRaw(event, options);
}

function mapTheEventsCalendarEventToRaw(event, options = {}) {
  const venue = extractTecVenue(event);
  const coords = extractTecCoordinates(event, venue);
  const sourceUrl = firstString(event.url, event.website, event.link, event.rest_url, event.permalink);
  const timezone = normalizeIanaTimezone(options.timezone);
  const utcStart = firstString(
    event.start_date_utc,
    event.startDateUtc,
    event.start_utc,
    event.starts_at_utc,
  );
  const localStart = firstString(event.starts_at, event.start_at, event.start_date, event.startDate, event.start);
  const utcEnd = firstString(
    event.end_date_utc,
    event.endDateUtc,
    event.end_utc,
    event.ends_at_utc,
  );
  const localEnd = firstString(event.ends_at, event.end_at, event.end_date, event.endDate, event.end);
  const startsOn = normalizeSourceEventDate(utcStart) || normalizeSourceEventDate(localStart);
  const endsOn = normalizeSourceEventDate(utcEnd) || normalizeSourceEventDate(localEnd);
  return compact({
    id: firstString(event.id, event.global_id, event.url, event.website, event.slug),
    title: htmlToText(localizedString(event.title || event.name)),
    starts_at:
      normalizeUtcEventDateTime(utcStart) ||
      normalizeSourceEventDateTime(localStart, { timezone }),
    ends_at:
      normalizeUtcEventDateTime(utcEnd) ||
      normalizeSourceEventDateTime(localEnd, { timezone }),
    starts_on: startsOn,
    ends_on: endsOn,
    time_window: startsOn
      ? { kind: "all_day", starts_on: startsOn, ends_on: endsOn || startsOn }
      : null,
    source_url: sourceUrl,
    place_context: firstString(venue.name, venue.address),
    area: firstString(venue.city, venue.neighborhood),
    lat: coords.lat,
    lng: coords.lng,
    tags: tecTags(event),
    recurrence: recurrenceString(event),
    freshness: isCancelled(event.status || event.event_status) ? "stale" : null,
    source_language: normalizeLanguage(event.source_language || event.language || event.lang),
    event_language: normalizeLanguage(event.event_language || event.source_language || event.language || event.lang),
    translation_status: normalizeTranslationStatus(event.translation_status || event.translation?.status),
    translation_confidence: normalizeTranslationConfidence(event.translation_confidence || event.translation?.confidence),
    translated_atoms: stringList(event.translated_atoms || event.translation?.atoms),
    provenance: compact({
      source_url: sourceUrl,
      source_label: firstString(event.source_label, event.organizer?.organizer, event.organizer?.name),
      attribution: firstString(event.organizer?.organizer, event.organizer?.name),
      license: firstString(event.license_label, event.license),
    }),
  });
}

function extractTecVenue(event) {
  const venue = isObject(event.venue) ? event.venue : {};
  return {
    name: firstString(venue.venue, venue.name, event.venue_name, event.location?.name),
    address: firstString(venue.address, event.venue_address, event.location?.address),
    city: firstString(venue.city, event.venue_city, event.location?.city),
    neighborhood: firstString(venue.neighborhood, event.neighborhood, event.area),
    lat: venue.geo_lat ?? venue.lat ?? venue.latitude ?? event.lat ?? event.latitude,
    lng: venue.geo_lng ?? venue.lng ?? venue.lon ?? venue.longitude ?? event.lng ?? event.lon ?? event.longitude,
  };
}

function extractTecCoordinates(event, venue) {
  const geo = isObject(event.geo) ? event.geo : {};
  const lat = toFinite(venue.lat ?? geo.latitude ?? geo.lat);
  const lng = toFinite(venue.lng ?? geo.longitude ?? geo.lng ?? geo.lon);
  return { lat, lng };
}

function tecTags(event) {
  const terms = [
    ...stringList(event.tags),
    ...stringList(event.keywords),
    ...namedList(event.categories),
    ...namedList(event.event_categories),
  ];
  return [...new Set(terms)];
}

function recurrenceString(event) {
  if (typeof event.recurrence === "string") return event.recurrence;
  if (Array.isArray(event.recurrence_rules)) return event.recurrence_rules.join("\n");
  if (typeof event.recurrence_rules === "string") return event.recurrence_rules;
  return null;
}

function extractIcalEvents(text) {
  const lines = unfoldIcalLines(text);
  const events = [];
  let current = null;
  for (const line of lines) {
    const parsed = parseIcalLine(line);
    if (!parsed) continue;
    if (parsed.name === "BEGIN" && parsed.value.toUpperCase() === "VEVENT") {
      current = { __source_format: "ical", properties: [] };
      continue;
    }
    if (parsed.name === "END" && parsed.value.toUpperCase() === "VEVENT") {
      if (current) events.push(current);
      current = null;
      continue;
    }
    if (current) current.properties.push(parsed);
  }
  return events;
}

function mapIcalEventToRaw(event) {
  const property = (name) => firstProperty(event, name);
  const summary = property("SUMMARY");
  const url = property("URL") || property("SOURCE") || property("X-ORIGINAL-URL");
  const geo = property("GEO");
  const coords = parseIcalGeo(geo?.value);
  const categories = property("CATEGORIES");
  const status = property("STATUS");
  const language = firstString(summary?.params?.LANGUAGE, property("LANGUAGE")?.value);
  const startsOn = parseIcalDateOnly(property("DTSTART"));
  const declaredEndOn = parseIcalDateOnly(property("DTEND"));
  const endsOn = startsOn && declaredEndOn
    ? inclusiveIcalEndDate(startsOn, declaredEndOn)
    : startsOn;
  return compact({
    id: firstString(property("UID")?.value, url?.value),
    title: decodeIcalText(summary?.value),
    starts_at: parseIcalDate(property("DTSTART")),
    ends_at: parseIcalDate(property("DTEND")),
    starts_on: startsOn,
    ends_on: endsOn,
    time_window: startsOn
      ? { kind: "all_day", starts_on: startsOn, ends_on: endsOn }
      : null,
    source_url: firstString(url?.value),
    place_context: decodeIcalText(property("LOCATION")?.value),
    lat: coords.lat,
    lng: coords.lng,
    tags: stringList(decodeIcalText(categories?.value)),
    recurrence: firstString(property("RRULE")?.value),
    freshness: isCancelled(status?.value) ? "stale" : null,
    last_checked: parseIcalDate(property("DTSTAMP") || property("LAST-MODIFIED")),
    source_language: normalizeLanguage(language),
    event_language: normalizeLanguage(language),
    translation_status: language && language !== "en" ? "needed" : null,
    translation_confidence: language && language !== "en" ? "none" : null,
    provenance: compact({
      source_url: firstString(url?.value),
    }),
  });
}

function unfoldIcalLines(text) {
  const rawLines = String(text || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const out = [];
  for (const line of rawLines) {
    if (/^[ \t]/.test(line) && out.length) {
      out[out.length - 1] += line.slice(1);
    } else {
      out.push(line);
    }
  }
  return out;
}

function parseIcalLine(line) {
  if (!line || !line.includes(":")) return null;
  const splitAt = line.indexOf(":");
  const left = line.slice(0, splitAt);
  const value = line.slice(splitAt + 1);
  const [rawName, ...rawParams] = left.split(";");
  const params = {};
  for (const param of rawParams) {
    const [key, ...rest] = param.split("=");
    if (!key || rest.length === 0) continue;
    params[key.toUpperCase()] = rest.join("=");
  }
  return { name: rawName.toUpperCase(), params, value };
}

function firstProperty(event, name) {
  const wanted = String(name || "").toUpperCase();
  return (event?.properties || []).find((property) => property.name === wanted) || null;
}

function parseIcalDate(property) {
  const value = firstString(property?.value);
  if (!value) return null;
  if (/^\d{8}$/.test(value)) {
    return null;
  }
  if (property?.params?.TZID) {
    return null;
  }
  const match = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/);
  if (match) {
    const [, year, month, day, hour, minute, second, zulu] = match;
    if (!zulu) return null;
    const date = new Date(Date.UTC(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute),
      Number(second),
    ));
    if (!Number.isFinite(date.getTime())) return null;
    return date.toISOString();
  }
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}

function parseIcalDateOnly(property) {
  const value = firstString(property?.value);
  if (!/^\d{8}$/.test(value)) return null;
  return normalizeSourceEventDate(
    `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`,
  );
}

function inclusiveIcalEndDate(startsOn, declaredEndOn) {
  const start = Date.parse(`${startsOn}T00:00:00.000Z`);
  const end = Date.parse(`${declaredEndOn}T00:00:00.000Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return startsOn;
  return new Date(end - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function parseIcalGeo(value) {
  const [lat, lng] = String(value || "").split(/[;,]/).map(toFinite);
  return { lat, lng };
}

function decodeIcalText(value) {
  if (typeof value !== "string") return null;
  return value
    .replace(/\\n/gi, "\n")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\")
    .trim() || null;
}

function looksLikeIcal(payload, contentType = "") {
  return /text\/calendar|calendar/i.test(contentType || "") || /BEGIN:VCALENDAR|BEGIN:VEVENT/.test(String(payload || ""));
}

function normalizeFormat(value) {
  const raw = (firstString(value) || "").toLowerCase();
  if (["ical", "ics"].includes(raw)) return "ical";
  if (["json", "the_events_calendar", "tec"].includes(raw)) return "json";
  return "auto";
}

function safeJsonParse(value) {
  try {
    return JSON.parse(value);
  } catch (_error) {
    return null;
  }
}

function localizedString(value) {
  if (typeof value === "string") return value.trim() || null;
  if (isObject(value)) {
    if (typeof value.rendered === "string") return value.rendered.trim() || null;
    if (typeof value["@value"] === "string") return value["@value"].trim() || null;
    for (const key of Object.keys(value)) {
      const result = localizedString(value[key]);
      if (result) return result;
    }
  }
  return null;
}

function htmlToText(value) {
  if (typeof value !== "string") return null;
  return decodeHtml(value.replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim() || null;
}

function decodeHtml(value) {
  return String(value || "")
    .replace(/&#(\d+);/g, (_match, code) => decodeCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) =>
      decodeCodePoint(parseInt(code, 16)),
    )
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function decodeCodePoint(value) {
  try {
    return Number.isInteger(value) && value >= 0 && value <= 0x10ffff
      ? String.fromCodePoint(value)
      : "";
  } catch (_error) {
    return "";
  }
}

function namedList(value) {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => localizedString(entry?.name || entry?.title || entry)).filter(Boolean);
}

function stringList(value) {
  if (Array.isArray(value)) return value.map((entry) => firstString(entry)).filter(Boolean);
  if (typeof value === "string" && value.trim()) return value.split(",").map((entry) => entry.trim()).filter(Boolean);
  return [];
}

function normalizeLanguage(value) {
  const raw = (firstString(value) || "").toLowerCase();
  return /^[a-z]{2,3}(-[a-z0-9]+)?$/.test(raw) ? raw : null;
}

function normalizeTranslationStatus(value) {
  const raw = (firstString(value) || "").toLowerCase();
  return ["not_required", "needed", "provided", "unavailable", "unknown"].includes(raw) ? raw : null;
}

function normalizeTranslationConfidence(value) {
  const raw = (firstString(value) || "").toLowerCase();
  return ["high", "medium", "low", "none", "unknown"].includes(raw) ? raw : null;
}

function isCancelled(status) {
  return typeof status === "string" && /cancel|postpon/i.test(status);
}

function isObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function firstString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return null;
}

function toFinite(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function compact(object) {
  const out = {};
  for (const key of Object.keys(object || {})) {
    const value = object[key];
    if (value === null || value === undefined || value === "") continue;
    if (Array.isArray(value) && value.length === 0) continue;
    if (isObject(value) && Object.keys(value).length === 0) continue;
    out[key] = value;
  }
  return Object.keys(out).length ? out : null;
}

function resolveDefaultEventsCalendarProvider(env = process.env) {
  const endpoint = String(env?.PARRANDA_EVENTS_CALENDAR_SOURCE || "").trim();
  if (!endpoint) return null;
  return createEventsCalendarProvider({
    endpoint,
    format: firstString(env?.PARRANDA_EVENTS_CALENDAR_FORMAT) || undefined,
    label: firstString(env?.PARRANDA_EVENTS_CALENDAR_LABEL) || undefined,
    sourceUrl: firstString(env?.PARRANDA_EVENTS_CALENDAR_SOURCE_URL) || undefined,
    license: firstString(env?.PARRANDA_EVENTS_CALENDAR_LICENSE) || undefined,
    timezone: firstString(env?.PARRANDA_EVENTS_CALENDAR_TIMEZONE) || undefined,
    status: firstString(env?.PARRANDA_EVENTS_CALENDAR_STATUS) || "candidate",
  });
}

module.exports = {
  EVENTS_CALENDAR_PROVIDER_ID,
  DEFAULT_USER_AGENT,
  createEventsCalendarProvider,
  resolveDefaultEventsCalendarProvider,
  extractEventsCalendarSourceEvents,
  extractTheEventsCalendarEvents,
  extractIcalEvents,
  mapEventsCalendarEventToRaw,
  mapTheEventsCalendarEventToRaw,
  mapIcalEventToRaw,
};
