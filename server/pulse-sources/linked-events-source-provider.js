/**
 * Linked Events source provider (first REACHABLE, no-key time-sensitive feed).
 *
 * The 6aika / City-of-Helsinki "Linked Events" platform (api.hel.fi/linkedevents
 * and the many Nordic cities that run the same open-source API) is an open,
 * key-free, CC-BY 4.0 municipal events API. It meets every source criterion:
 * event/title, start/end, geocoded venue (with include=location the position is
 * embedded inline), source/provenance (data_source/publisher + info_url),
 * license/attribution (CC-BY 4.0), broad coverage, low noise (curated civic
 * programming), and it is reachable RIGHT NOW without a credential.
 *
 * This is a sibling to the generic schema.org/Event provider (#282): a different
 * feed shape, the SAME #279 normalization target via the #280 registry bridge.
 * Linked Events is not literal schema.org/Event (its own JSON shape), so it gets
 * its own thin adapter — the registry-of-many-providers model.
 *
 * Same guardrails as the loader/resolver/schema.org provider:
 *   - emits `time_sensitive_events` only — never legacy live events, Pulse cards,
 *     route candidates, or route stops; collect+inspect until a later gated PR;
 *   - env-gated default-off (PARRANDA_LINKED_EVENTS_SOURCE); no endpoint → none;
 *   - fail-soft on every error path → [] (never throws, never breaks Pulse);
 *   - never fabricates: missing source/coords/timing pass through so the #279
 *     normalizer downgrades / marks stale honestly.
 */

const { GENERIC_PROVIDER_CITY } = require("./provider-registry");

const LINKED_EVENTS_PROVIDER_ID = "generic-linked-events";
const DEFAULT_USER_AGENT = "Parranda/1.0 (+https://github.com/fritjofherrstrom-png/parranda)";
const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;
// Parranda's UI languages first, then Finnish/Swedish municipal defaults.
const LANGUAGE_PREFERENCE = ["en", "sv", "fi"];

function buildDescriptor({ label, sourceUrl, license } = {}) {
  return {
    id: LINKED_EVENTS_PROVIDER_ID,
    label: label || "Linked Events",
    city: GENERIC_PROVIDER_CITY,
    role: "official_live_baseline",
    sourceType: "official_api",
    sourceUrl: sourceUrl || null,
    status: "active",
    intendedUse: "pulse",
    supportedLanguages: ["en", "sv", "fi"],
    updateCadence: "hourly",
    parsingRisk: "low",
    trust: {
      source_tier: "official",
      confidence: "medium",
      human_verified: false,
      freshness: "fresh",
    },
    cachePolicy: { kind: "memory", ttlSeconds: 1800 },
    sourceOwnedFields: ["title", "starts_at", "ends_at", "lat", "lng", "source_url", "place_context"],
    parrandaOwnedFields: ["intents", "route_role_hint"],
    license_label: license || "CC-BY 4.0",
  };
}

function createLinkedEventsProvider(providerOptions = {}) {
  const descriptor = buildDescriptor({
    ...providerOptions,
    // The configured base endpoint is a valid source URL for the descriptor.
    sourceUrl: providerOptions.sourceUrl || providerOptions.endpoint || null,
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
          if (!endpoint || typeof fetcher !== "function") {
            return { events: [], signals: [], time_sensitive_events: [] };
          }

          const limit = Math.max(1, Math.min(Math.floor(providerOptions.limit || DEFAULT_LIMIT), MAX_LIMIT));
          const url = buildEventsUrl(endpoint, { limit, date: collectionContext.date || context.date });
          const userAgent = providerOptions.userAgent || DEFAULT_USER_AGENT;
          const timeoutMs = Math.max(50, Math.floor(providerOptions.timeoutMs || DEFAULT_TIMEOUT_MS));
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), timeoutMs);

          let payload;
          try {
            const response = await fetcher(url, {
              headers: { "User-Agent": userAgent, Accept: "application/json" },
              signal: controller.signal,
            });
            if (!response || response.ok !== true) {
              return { events: [], signals: [], time_sensitive_events: [] };
            }
            payload = await response.json();
          } catch (_error) {
            return { events: [], signals: [], time_sensitive_events: [] };
          } finally {
            clearTimeout(timer);
          }

          const events = extractLinkedEvents(payload)
            .slice(0, limit)
            .map(mapLinkedEventToRaw)
            .filter(Boolean);
          return { events: [], signals: [], time_sensitive_events: events };
        },
      };
    },
  };
}

// Ensure include=location (coords inline) + a result cap + a today-onward window
// are present, without clobbering caller-supplied query params.
function buildEventsUrl(endpoint, { limit, date } = {}) {
  let url;
  try {
    url = new URL(endpoint);
  } catch (_error) {
    return endpoint; // let the fetch fail soft if the endpoint is malformed
  }
  if (!url.searchParams.has("include")) url.searchParams.set("include", "location");
  if (!url.searchParams.has("page_size")) url.searchParams.set("page_size", String(limit));
  if (!url.searchParams.has("start")) url.searchParams.set("start", date || "today");
  url.searchParams.set("format", "json");
  return url.toString();
}

// Linked Events wraps results as { meta, data: [...] }; also tolerate a bare
// array or a single event object.
function extractLinkedEvents(payload) {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload.filter(isObject);
  if (Array.isArray(payload.data)) return payload.data.filter(isObject);
  if (isObject(payload) && (payload.id || payload.name)) return [payload];
  return [];
}

// Map a Linked Events record → the raw shape the #280 bridge normalizes.
// Pure — exported for tests.
function mapLinkedEventToRaw(event) {
  if (!isObject(event)) return null;
  const coords = extractCoordinates(event.location);
  const sourceUrl = preferredLocalized(event.info_url) || firstString(event["@id"]);
  return compact({
    id: firstString(event.id, event["@id"]),
    title: preferredLocalized(event.name),
    starts_at: firstString(event.start_time, event.startTime),
    ends_at: firstString(event.end_time, event.endTime),
    source_url: sourceUrl,
    place_context: event.location ? preferredLocalized(event.location.name) : null,
    lat: coords.lat,
    lng: coords.lng,
    tags: keywordList(event.keywords),
    provenance: linkedEventProvenance(event, { sourceUrl }),
    // Linked Events event_status: EventCancelled / EventPostponed → not live.
    freshness: isCancelledOrPostponed(event.event_status) ? "stale" : null,
  });
}

function linkedEventProvenance(event, { sourceUrl } = {}) {
  const dataSource = firstString(event.data_source, event.publisher);
  const publisher = firstString(event.publisher);
  const attribution = [dataSource, publisher].filter(Boolean).join(" / ") || null;
  return compact({
    source_url: sourceUrl || null,
    source_label: dataSource || publisher,
    attribution,
    license: firstString(event.license_label, event.license) || "CC-BY 4.0",
  });
}

function extractCoordinates(location) {
  if (!isObject(location)) return { lat: null, lng: null };
  const position = location.position;
  if (isObject(position) && Array.isArray(position.coordinates) && position.coordinates.length >= 2) {
    // GeoJSON Point: [longitude, latitude].
    const lng = toFinite(position.coordinates[0]);
    const lat = toFinite(position.coordinates[1]);
    if (lat != null && lng != null) return { lat, lng };
  }
  return { lat: null, lng: null };
}

function isCancelledOrPostponed(status) {
  return typeof status === "string" && /cancel|postpon/i.test(status);
}

// Linked Events localized fields are { fi, sv, en } maps (sometimes only fi).
function preferredLocalized(value) {
  if (typeof value === "string") return value.trim() || null;
  if (!isObject(value)) return null;
  for (const lang of LANGUAGE_PREFERENCE) {
    if (typeof value[lang] === "string" && value[lang].trim()) return value[lang].trim();
  }
  for (const key of Object.keys(value)) {
    if (typeof value[key] === "string" && value[key].trim()) return value[key].trim();
  }
  return null;
}

function keywordList(keywords) {
  if (!Array.isArray(keywords)) return [];
  return keywords
    .map((keyword) => preferredLocalized(keyword && keyword.name))
    .filter(Boolean);
}

function isObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function firstString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function toFinite(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function compact(object) {
  const out = {};
  for (const key of Object.keys(object)) {
    const value = object[key];
    if (value === null || value === undefined) continue;
    if (Array.isArray(value) && value.length === 0) continue;
    out[key] = value;
  }
  return out;
}

/**
 * Read PARRANDA_LINKED_EVENTS_SOURCE at call time. Null when unconfigured, so a
 * default deploy has no provider — production opts in explicitly (mirrors the
 * open-data loader and the schema.org event provider).
 */
function resolveDefaultLinkedEventsProvider(env = process.env) {
  const endpoint = String(env?.PARRANDA_LINKED_EVENTS_SOURCE || "").trim();
  if (!endpoint) return null;
  return createLinkedEventsProvider({
    endpoint,
    label: firstString(env?.PARRANDA_LINKED_EVENTS_LABEL) || undefined,
    sourceUrl: firstString(env?.PARRANDA_LINKED_EVENTS_SOURCE_URL) || undefined,
    license: firstString(env?.PARRANDA_LINKED_EVENTS_LICENSE) || undefined,
  });
}

module.exports = {
  LINKED_EVENTS_PROVIDER_ID,
  DEFAULT_USER_AGENT,
  createLinkedEventsProvider,
  resolveDefaultLinkedEventsProvider,
  // exported for tests / introspection
  extractLinkedEvents,
  mapLinkedEventToRaw,
  buildEventsUrl,
};
