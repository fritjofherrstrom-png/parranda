"use strict";

/**
 * Bounded adapter for public event records whose platform shape is described
 * by a wire profile (`event-wire-profiles.js`).
 *
 * One reviewed manifest row names the endpoint, geography, timezone and wire
 * profile. The provider reads the published records (a JSON API or the state a
 * page embeds for its own client), maps them through the profile, keeps the
 * occurrences inside the collection window and returns shared time-sensitive
 * event atoms. It never follows provider-supplied URLs, never infers a clock
 * the source did not state, and keeps a map pin only when it is venue-level.
 */

const { GENERIC_PROVIDER_CITY } = require("./provider-registry");
const { buildProviderCollectionOutcome } = require("./provider-collection-outcome");
const {
  datePartsInTimezone,
  normalizeIanaTimezone,
  normalizeSourceEventDate,
  normalizeSourceEventDateTime,
} = require("./source-event-time");
const { extractNextData, extractNuxtData, findStateObjects } = require("./embedded-page-state");
const { resolveWireProfile } = require("./event-wire-profiles");
const {
  loadReviewedVenueRegistry,
  lookupReviewedVenue,
  reviewedVenueResolution,
} = require("./reviewed-event-venues");

const MAPPED_EVENT_PROVIDER_ID = "generic-mapped-event-source";
const DEFAULT_USER_AGENT = "Parranda/1.0 (+https://github.com/fritjofherrstrom-png/parranda)";
const DEFAULT_TIMEOUT_MS = 12000;
const DEFAULT_MAX_BYTES = 8 * 1024 * 1024;
const MAX_BYTES = 12 * 1024 * 1024;
const DEFAULT_LIMIT = 120;
const MAX_LIMIT = 400;
const DEFAULT_HORIZON_DAYS = 8;
const MAX_HORIZON_DAYS = 31;
const MAX_RECORDS = 5000;
const MAX_OCCURRENCES_PER_RECORD = 400;
const MAX_TITLE_LENGTH = 200;
const DAY_MS = 24 * 60 * 60 * 1000;

function buildDescriptor(options = {}) {
  const descriptor = {
    id: options.id || MAPPED_EVENT_PROVIDER_ID,
    label: options.label || "Mapped public event source",
    city: GENERIC_PROVIDER_CITY,
    role: "official_live_baseline",
    sourceType: "official_api",
    status: options.status || "candidate",
    intendedUse: "pulse",
    supportedLanguages: options.sourceLanguage ? [options.sourceLanguage] : [],
    updateCadence: "hourly",
    parsingRisk: "low",
    trust: { source_tier: "verified", confidence: "low", human_verified: false, freshness: "fresh" },
    cachePolicy: { kind: "memory", ttlSeconds: 1200 },
    sourceOwnedFields: [
      "title", "starts_at", "ends_at", "starts_on", "ends_on", "time_window",
      "source_url", "place_context", "address", "area", "lat", "lng", "tags",
    ],
    parrandaOwnedFields: ["intents", "route_role_hint"],
  };
  if (options.sourceUrl || options.endpoint) descriptor.sourceUrl = options.sourceUrl || options.endpoint;
  if (options.timezone) descriptor.timezone = options.timezone;
  return descriptor;
}

function createMappedEventSourceProvider(providerOptions = {}) {
  const timezone = normalizeIanaTimezone(providerOptions.timezone);
  const profile = resolveWireProfile(providerOptions.wireProfile);
  const descriptor = buildDescriptor({ ...providerOptions, timezone: timezone || undefined });

  return {
    descriptor,
    create(cityConfig, context = {}) {
      const boundDescriptor = { ...descriptor, city: cityConfig?.key || descriptor.city };
      return {
        descriptor: boundDescriptor,
        async collect(collectionContext = {}) {
          const endpoint = firstString(providerOptions.endpoint, context.endpoint);
          const fetcher = providerOptions.fetcher ||
            (typeof globalThis.fetch === "function" ? globalThis.fetch.bind(globalThis) : null);
          if (!profile) return emptyCollection("unavailable", "source_unavailable");
          if (!endpoint) return emptyCollection("unavailable", "source_endpoint_unavailable");
          if (typeof fetcher !== "function") return emptyCollection("unavailable", "source_fetch_unavailable");
          if (!timezone) return emptyCollection("unavailable", "source_timezone_unavailable");

          const window = collectionWindow(collectionContext.date, timezone, providerOptions);
          if (!window) return emptyCollection("unavailable", "collection_context_unavailable");

          const fetched = await fetchBoundedText(fetcher, endpoint, {
            timeoutMs: clampInteger(providerOptions.timeoutMs, 50, 60000, DEFAULT_TIMEOUT_MS),
            maxBytes: clampInteger(providerOptions.maxBytes, 1024, MAX_BYTES, DEFAULT_MAX_BYTES),
            accept: profile.payload === "json" ? "application/json" : "text/html",
            userAgent: providerOptions.userAgent,
          });
          if (!fetched.ok) return emptyCollection("failed", fetched.reason);

          const state = parseState(profile.payload, fetched.text);
          const records = state == null ? null : selectRecords(state, profile.records);
          if (!records) return emptyCollection("failed", "source_payload_invalid");

          const registry = providerOptions.venueRegistry instanceof Map
            ? providerOptions.venueRegistry
            : loadReviewedVenueRegistry(providerOptions.venueRegistryPath);
          const mapping = {
            profile,
            timezone,
            endpoint,
            registry,
            window,
            sourceLanguage: normalizeLanguage(providerOptions.sourceLanguage),
            retrievedAt: new Date().toISOString(),
          };
          const rows = [];
          let mappedRecords = 0;
          for (const record of records.slice(0, MAX_RECORDS)) {
            const atoms = mapRecord(record, mapping);
            if (!atoms) continue;
            mappedRecords += 1;
            for (const atom of atoms) if (inWindow(atom, window)) rows.push(atom);
          }
          if (records.length > 0 && mappedRecords === 0) return emptyCollection("failed", "source_payload_invalid");

          rows.sort((left, right) => sortKey(left).localeCompare(sortKey(right)) || left.id.localeCompare(right.id));
          const seen = new Set();
          const unique = rows.filter((row) => !seen.has(row.id) && seen.add(row.id));
          const limit = clampInteger(providerOptions.limit, 1, MAX_LIMIT, DEFAULT_LIMIT);
          const kept = unique.slice(0, limit);
          const truncated = unique.length > kept.length || records.length > MAX_RECORDS;
          return {
            events: [],
            signals: [],
            time_sensitive_events: kept,
            collection_status: buildProviderCollectionOutcome(kept.length ? "ok" : "empty", {
              reason: truncated ? "source_collection_truncated" : kept.length ? null : "source_empty",
              eventRows: kept.length,
            }),
          };
        },
      };
    },
  };
}

/**
 * Read every published record of a mapped source and its venue address, for
 * offline venue review. Same bounds and parsing as collection; no window.
 */
async function readMappedSourceVenues({ endpoint, wireProfile, fetcher, timeoutMs, maxBytes, userAgent } = {}) {
  const profile = resolveWireProfile(wireProfile);
  if (!profile || !endpoint || typeof fetcher !== "function") return { ok: false, reason: "source_unavailable", venues: [] };
  const fetched = await fetchBoundedText(fetcher, endpoint, {
    timeoutMs: clampInteger(timeoutMs, 50, 60000, DEFAULT_TIMEOUT_MS),
    maxBytes: clampInteger(maxBytes, 1024, MAX_BYTES, DEFAULT_MAX_BYTES),
    accept: profile.payload === "json" ? "application/json" : "text/html",
    userAgent,
  });
  if (!fetched.ok) return { ok: false, reason: fetched.reason, venues: [] };
  const state = parseState(profile.payload, fetched.text);
  const records = state == null ? null : selectRecords(state, profile.records);
  if (!records) return { ok: false, reason: "source_payload_invalid", venues: [] };
  const fields = profile.fields;
  const venues = records.slice(0, MAX_RECORDS).map((record) => {
    const street = cleanText(readPath(record, fields.street)) || joinStreet(
      cleanText(readPath(record, fields.street_name)),
      cleanText(readPath(record, fields.street_number)),
    );
    const postalCode = scalarString(readPath(record, fields.postal_code));
    const country = scalarString(readPath(record, fields.country));
    return {
      venue: cleanText(readPath(record, fields.venue)),
      street,
      postal_code: postalCode,
      locality: cleanText(readPath(record, fields.locality)),
      country,
      has_venue_pin: Boolean(venueGeometry(record, { profile, street, postalCode, country, registry: null })),
    };
  });
  return { ok: true, reason: null, venues };
}

function parseState(kind, text) {
  if (kind === "json") {
    try {
      return JSON.parse(text);
    } catch (_error) {
      return null;
    }
  }
  if (kind === "nuxt_data") return extractNuxtData(text);
  if (kind === "next_data") return extractNextData(text);
  return null;
}

function selectRecords(state, selector = {}) {
  if (selector.match) {
    const required = selector.require;
    const found = findStateObjects(state, (node) =>
      Object.entries(selector.match).every(([key, value]) => node[key] === value) &&
      (!required || readPath(node, required) != null));
    // The same post can be embedded twice (list and teaser); keep the first.
    const seen = new Set();
    return found.filter((node) => {
      const id = node.id == null ? null : String(node.id);
      if (!id || seen.has(id)) return false;
      seen.add(id);
      return true;
    });
  }
  const list = selector.path ? readPath(state, selector.path) : state;
  return Array.isArray(list) ? list : null;
}

function mapRecord(record, context) {
  if (!record || typeof record !== "object" || Array.isArray(record)) return null;
  const { profile, timezone } = context;
  const fields = profile.fields;
  const recordId = scalarString(readPath(record, fields.id));
  const title = cleanTitle(readPath(record, fields.title));
  if (!recordId || !title) return null;

  const status = scalarString(readPath(record, fields.status));
  if (status && (profile.skip_statuses || []).includes(status.toLowerCase())) return [];
  const locationType = scalarString(readPath(record, fields.location_type));
  if (locationType && (profile.online_location_types || []).includes(locationType.toLowerCase())) return [];

  const sourceUrl = httpUrl(readPath(record, fields.url));
  const venue = cleanText(readPath(record, fields.venue));
  const street = cleanText(readPath(record, fields.street)) || joinStreet(
    cleanText(readPath(record, fields.street_name)),
    cleanText(readPath(record, fields.street_number)),
  );
  const postalCode = scalarString(readPath(record, fields.postal_code));
  const locality = cleanText(readPath(record, fields.locality));
  const country = scalarString(readPath(record, fields.country));
  const geometry = venueGeometry(record, { profile, street, postalCode, country, registry: context.registry });
  const base = compact({
    title,
    name: title,
    source_url: sourceUrl,
    place_context: venue,
    address: [street, [postalCode, locality].filter(Boolean).join(" ")].filter(Boolean).join(", ") || null,
    area: locality,
    city: locality,
    country,
    lat: geometry?.lat,
    lng: geometry?.lng,
    venue_resolution: geometry?.resolution,
    last_checked: scalarString(readPath(record, fields.updated_at)),
    source_language: context.sourceLanguage,
    event_language: context.sourceLanguage,
    translation_status: "not_required",
    tags: tagList(record, fields.tags),
    provenance: compact({ source_url: sourceUrl, retrieved_at: context.retrievedAt }),
  });

  const slots = profile.occurrences
    ? occurrenceSlots(record, profile.occurrences)
    : [{ start: readPath(record, fields.start), end: readPath(record, fields.end), allDay: readPath(record, fields.all_day) === true }];
  if (!slots) return null;
  const atoms = [];
  let outsideWindow = 0;
  for (const slot of slots) {
    if (context.window && !slotMayOverlap(slot, context.window)) {
      outsideWindow += 1;
      continue;
    }
    const time = slotTime(slot, timezone);
    if (!time) continue;
    atoms.push({
      ...base,
      id: profile.occurrences ? `${recordId}@${time.key}` : recordId,
      ...time.fields,
    });
  }
  // A readable record whose dates all fall outside the window is not invalid.
  return atoms.length || outsideWindow ? atoms : null;
}

function occurrenceSlots(record, spec) {
  const list = readPath(record, spec.path);
  if (!Array.isArray(list)) return null;
  return list.slice(0, MAX_OCCURRENCES_PER_RECORD)
    .map((entry) => ({ start: readPath(entry, spec.start), end: readPath(entry, spec.end), allDay: false }));
}

// Cheap pre-filter on the written dates (one day of slack for UTC offsets),
// so long occurrence lists are not converted outside the collection window.
function slotMayOverlap(slot, window) {
  const start = scalarString(slot.start);
  const startDay = start && /^\d{4}-\d{2}-\d{2}/.test(start) ? start.slice(0, 10) : null;
  if (!startDay) return true;
  const end = scalarString(slot.end);
  const endDay = end && /^\d{4}-\d{2}-\d{2}/.test(end) ? end.slice(0, 10) : startDay;
  return startDay <= shiftDate(window.endDate, 1) && (endDay >= startDay ? endDay : startDay) >= shiftDate(window.startDate, -1);
}

function shiftDate(date, days) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

// One stated slot becomes one time atom. A clock is used only when the source
// states it; a date without a clock stays an all-day statement.
function slotTime(slot, timezone) {
  const rawStart = scalarString(slot.start);
  const rawEnd = scalarString(slot.end);
  if (!rawStart) return null;
  const startDate = normalizeSourceEventDate(rawStart);
  if (startDate || slot.allDay) {
    const startsOn = startDate || localDate(normalizeSourceEventDateTime(rawStart, { timezone }), timezone);
    const endsOn = normalizeSourceEventDate(rawEnd) ||
      localDate(normalizeSourceEventDateTime(rawEnd, { timezone }), timezone) || startsOn;
    if (!startsOn || endsOn < startsOn) return null;
    return {
      key: startsOn,
      fields: { starts_on: startsOn, ends_on: endsOn, time_window: { kind: "all_day", starts_on: startsOn, ends_on: endsOn } },
    };
  }
  const startsAt = normalizeSourceEventDateTime(rawStart, { timezone });
  if (!startsAt) return null;
  let endsAt = rawEnd ? normalizeSourceEventDateTime(rawEnd, { timezone }) : null;
  // An end before the start is not a stated end; never guess an overnight date.
  if (endsAt && Date.parse(endsAt) <= Date.parse(startsAt)) endsAt = null;
  const startsOn = localDate(startsAt, timezone);
  const endsOn = endsAt ? localDate(endsAt, timezone) : startsOn;
  return {
    key: startsAt,
    fields: compact({
      starts_at: startsAt,
      ends_at: endsAt,
      starts_on: startsOn,
      ends_on: endsOn,
      time_window: compact({ kind: "continuous", starts_at: startsAt, ends_at: endsAt }),
    }),
  };
}

// The publisher's pin counts only when it carries venue-level address detail;
// otherwise a reviewed registry point for the stated address may be used.
function venueGeometry(record, { profile, street, postalCode, country, registry }) {
  const fields = profile.fields;
  const lat = Number(readPath(record, fields.lat));
  const lng = Number(readPath(record, fields.lng));
  const hasPin = fields.lat && fields.lng && readPath(record, fields.lat) != null && readPath(record, fields.lng) != null &&
    Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0);
  if (hasPin) {
    const required = profile.geometry_requires_any || [];
    const precise = required.length === 0 || required.some((key) => cleanText(readPath(record, fields[key])));
    if (precise) return { lat, lng, resolution: null };
  }
  const entry = lookupReviewedVenue(registry, { country, postal_code: postalCode, street });
  return entry ? { lat: entry.lat, lng: entry.lng, resolution: reviewedVenueResolution(entry) } : null;
}

function collectionWindow(date, timezone, options = {}) {
  const horizonDays = clampInteger(options.horizonDays, 1, MAX_HORIZON_DAYS, DEFAULT_HORIZON_DAYS);
  // A plain date names the local day; an instant is read in the source zone.
  const startDate = (typeof date === "string" && normalizeSourceEventDate(date)) ||
    localDate(date || new Date().toISOString(), timezone);
  if (!startDate) return null;
  const endDate = new Date(Date.parse(`${startDate}T00:00:00Z`) + horizonDays * DAY_MS).toISOString().slice(0, 10);
  return { startDate, endDate };
}

function inWindow(atom, window) {
  const startsOn = atom.starts_on;
  const endsOn = atom.ends_on || startsOn;
  return Boolean(startsOn) && endsOn >= window.startDate && startsOn <= window.endDate;
}

function sortKey(atom) {
  return atom.starts_at || `${atom.starts_on}T00:00:00.000Z`;
}

function localDate(instant, timezone) {
  if (!instant) return null;
  const parts = datePartsInTimezone(instant, timezone);
  if (!parts || !Number.isFinite(parts.year)) return null;
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

async function fetchBoundedText(fetcher, url, { timeoutMs, maxBytes, accept, userAgent }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetcher(url, {
      headers: { "User-Agent": userAgent || DEFAULT_USER_AGENT, Accept: accept },
      redirect: "manual",
      signal: controller.signal,
    });
    if (!response || response.ok !== true) return { ok: false, reason: `source_http_${response?.status || "not_ok"}` };
    if (response.url && !sameOrigin(url, response.url)) return { ok: false, reason: "source_redirect_cross_origin" };
    const text = typeof response.text === "function" ? await response.text() : JSON.stringify(await response.json());
    if (Buffer.byteLength(String(text || ""), "utf8") > maxBytes) return { ok: false, reason: "source_payload_invalid" };
    return { ok: true, text: String(text || "") };
  } catch (error) {
    return { ok: false, reason: error?.name === "AbortError" ? "source_timeout" : "source_fetch_failed" };
  } finally {
    clearTimeout(timer);
  }
}

function readPath(value, path) {
  if (path == null || path === "") return value;
  if (typeof path !== "string") return undefined;
  let current = value;
  for (const segment of path.split(".")) {
    if (current == null || typeof current !== "object") return undefined;
    current = Array.isArray(current) && /^\d+$/.test(segment) ? current[Number(segment)] : current[segment];
  }
  return current;
}

function tagList(record, paths) {
  const tags = [];
  for (const path of Array.isArray(paths) ? paths : paths ? [paths] : []) {
    const value = readPath(record, path);
    for (const item of Array.isArray(value) ? value : [value]) {
      const text = cleanText(item);
      if (text) tags.push(text);
    }
  }
  return [...new Set(tags)].slice(0, 12);
}

function joinStreet(name, number) {
  return name ? [name, number].filter(Boolean).join(" ") : null;
}

function cleanTitle(value) {
  const text = cleanText(value);
  return text ? text.slice(0, MAX_TITLE_LENGTH) : null;
}

function cleanText(value) {
  if (typeof value !== "string") return null;
  const text = decodeHtml(value.replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
  return text || null;
}

function decodeHtml(value) {
  return String(value || "")
    .replace(/&#(\d+);/g, (_match, code) => decodeCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) => decodeCodePoint(parseInt(code, 16)))
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#039;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function decodeCodePoint(value) {
  try {
    return Number.isInteger(value) && value >= 0 && value <= 0x10ffff ? String.fromCodePoint(value) : "";
  } catch (_error) {
    return "";
  }
}

function scalarString(value) {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function httpUrl(value) {
  const raw = scalarString(value);
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch (_error) {
    return null;
  }
}

function sameOrigin(left, right) {
  try {
    return new URL(left).origin === new URL(right).origin;
  } catch (_error) {
    return false;
  }
}

function normalizeLanguage(value) {
  const language = typeof value === "string" ? value.trim().toLowerCase() : "";
  return /^[a-z]{2}(?:-[a-z]{2})?$/.test(language) ? language : null;
}

function clampInteger(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(number)));
}

function firstString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function compact(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) =>
    item != null && item !== "" && !(Array.isArray(item) && item.length === 0)));
}

function emptyCollection(status, reason) {
  return {
    events: [],
    signals: [],
    time_sensitive_events: [],
    collection_status: buildProviderCollectionOutcome(status, { reason, eventRows: 0 }),
  };
}

module.exports = {
  MAPPED_EVENT_PROVIDER_ID,
  createMappedEventSourceProvider,
  mapRecord,
  readMappedSourceVenues,
  selectRecords,
};
