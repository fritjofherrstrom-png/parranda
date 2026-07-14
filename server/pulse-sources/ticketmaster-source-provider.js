"use strict";

const { buildProviderCollectionOutcome } = require("./provider-collection-outcome");

/**
 * GLOBAL live-event source — Ticketmaster Discovery API.
 *
 * This is the first member of the GLOBAL provider family: one integration that
 * answers "what's on near these coordinates" for ANY anchor on the planet where
 * the source has inventory (concerts, sports, theatre, festivals across ~25+
 * countries). No per-city rows, no bbox registry, no geo hacks — the query is
 * purely coordinate + radius + time window, so it is exactly as agnostic as the
 * engine's anchor. Municipal open feeds (Linked Events) remain a complementary
 * family for hyper-local happenings where they exist; this family provides the
 * baseline "the engine fetches live events regardless of city".
 *
 * HONESTY:
 *  - Key-gated (PARRANDA_TICKETMASTER_KEY) and fail-closed: no key → the family
 *    is absent; errors/timeouts → [] (never fabricated events).
 *  - Every event carries its REAL source url (the event page), source label,
 *    venue coordinates, and the EVENT-LEVEL timezone the API provides (venue-tz
 *    honesty per event, better than a feed-level region tz).
 *  - Attribution: events link to the source per the API's intended display use.
 *
 * Emits the same raw-event shape as the other pulse sources
 * ({id,title,starts_at,ends_at,source_url,place_context,lat,lng,provenance,...})
 * so the SAME normalize → ephemeral-filter → bucket → salience pipeline runs —
 * one honesty rule for every family.
 */

const DEFAULT_ENDPOINT = "https://app.ticketmaster.com/discovery/v2/events.json";
const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_PAGE_SIZE = 40;
const DEFAULT_RADIUS_KM = 3;

function toFinite(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

// Discovery API rejects fractional-second ISO strings — it wants
// YYYY-MM-DDTHH:mm:ssZ exactly.
function tmDateTime(value) {
  const d = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(d.getTime())) return null;
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

function buildDiscoveryUrl({ endpoint = DEFAULT_ENDPOINT, key, anchor, radiusKm, startDateTime, endDateTime, pageSize }) {
  const url = new URL(endpoint);
  url.searchParams.set("apikey", key);
  url.searchParams.set("latlong", `${anchor.lat},${anchor.lng}`);
  url.searchParams.set("radius", String(Math.max(1, Math.round(radiusKm || DEFAULT_RADIUS_KM))));
  url.searchParams.set("unit", "km");
  url.searchParams.set("sort", "date,asc");
  url.searchParams.set("size", String(pageSize || DEFAULT_PAGE_SIZE));
  if (startDateTime) url.searchParams.set("startDateTime", startDateTime);
  if (endDateTime) url.searchParams.set("endDateTime", endDateTime);
  return url.toString();
}

// One Discovery event → the shared raw-event shape. Coordinate-less events are
// dropped (nothing is ever placed on the map without a real position).
function mapDiscoveryEvent(event) {
  if (!event || typeof event !== "object") return null;
  const title = typeof event.name === "string" ? event.name.trim() : "";
  if (!title) return null;
  const venue = event._embedded && Array.isArray(event._embedded.venues) ? event._embedded.venues[0] : null;
  const lat = toFinite(venue && venue.location && venue.location.latitude);
  const lng = toFinite(venue && venue.location && venue.location.longitude);
  if (lat == null || lng == null) return null;
  const starts =
    (event.dates && event.dates.start && (event.dates.start.dateTime || event.dates.start.localDate)) || null;
  const status = event.dates && event.dates.status && event.dates.status.code;
  const classification =
    Array.isArray(event.classifications) && event.classifications[0] && event.classifications[0].segment
      ? event.classifications[0].segment.name
      : null;
  return {
    id: typeof event.id === "string" ? `tm-${event.id}` : null,
    title,
    starts_at: typeof starts === "string" ? starts : null,
    ends_at: null, // Discovery rarely carries end times; a ticketed event is inherently time-bounded
    source_url: typeof event.url === "string" ? event.url : null,
    place_context: venue && typeof venue.name === "string" ? venue.name : null,
    lat,
    lng,
    tags: classification ? [String(classification).toLowerCase()] : [],
    // Event-level timezone from the API — the truest venue-local clock available.
    timezone: event.dates && typeof event.dates.timezone === "string" ? event.dates.timezone : null,
    provenance: {
      source_url: typeof event.url === "string" ? event.url : null,
      source_label: "Ticketmaster",
      attribution: "Ticketmaster Discovery API",
      license: null, // commercial listing — attribution + outbound link, no open license claimed
    },
    freshness: typeof status === "string" && /cancel|postpon/i.test(status) ? "stale" : null,
  };
}

/**
 * Create the provider. Mirrors the house provider contract:
 *   createTicketmasterProvider(opts).create({ key }).collect({ date }) →
 *   { time_sensitive_events: rawEvent[] }
 * `anchor` + window come from opts (the supply orchestrator owns them).
 */
function createTicketmasterProvider({
  endpoint = DEFAULT_ENDPOINT,
  key = null,
  anchor = null,
  radiusKm = DEFAULT_RADIUS_KM,
  windowDays = 7,
  now = null,
  fetcher = typeof globalThis.fetch === "function" ? globalThis.fetch.bind(globalThis) : null,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  pageSize = DEFAULT_PAGE_SIZE,
} = {}) {
  return {
    create() {
      return {
        async collect() {
          if (!key) {
            return emptyCollection("unavailable", "source_credentials_unavailable");
          }
          if (!anchor || !Number.isFinite(anchor.lat) || !Number.isFinite(anchor.lng)) {
            return emptyCollection("unavailable", "trusted_anchor_unavailable");
          }
          if (typeof fetcher !== "function") {
            return emptyCollection("unavailable", "source_fetch_unavailable");
          }
          const nowDate = now ? new Date(now) : new Date();
          const url = buildDiscoveryUrl({
            endpoint,
            key,
            anchor,
            radiusKm,
            pageSize,
            startDateTime: tmDateTime(nowDate),
            endDateTime: tmDateTime(new Date(nowDate.getTime() + windowDays * 24 * 60 * 60 * 1000)),
          });
          const controller = typeof AbortController === "function" ? new AbortController() : null;
          const timer = controller ? setTimeout(() => controller.abort(), Math.max(1000, timeoutMs)) : null;
          try {
            const response = await fetcher(url, controller ? { signal: controller.signal } : {});
            if (!response || !response.ok) {
              return emptyCollection("failed", `source_http_${response?.status || "not_ok"}`);
            }
            let body;
            try {
              body = await response.json();
            } catch (_error) {
              return emptyCollection("failed", "source_payload_invalid");
            }
            const events = body && body._embedded && Array.isArray(body._embedded.events) ? body._embedded.events : [];
            const mapped = events.map(mapDiscoveryEvent).filter(Boolean);
            return {
              time_sensitive_events: mapped,
              collection_status: buildProviderCollectionOutcome(mapped.length ? "ok" : "empty", {
                reason: mapped.length ? null : "source_empty",
                eventRows: mapped.length,
              }),
            };
          } catch (error) {
            return emptyCollection("failed", error?.name === "AbortError" ? "source_timeout" : "source_fetch_failed");
          } finally {
            if (timer) clearTimeout(timer);
          }
        },
      };
    },
  };
}

function emptyCollection(status, reason) {
  return {
    time_sensitive_events: [],
    collection_status: buildProviderCollectionOutcome(status, { reason, eventRows: 0 }),
  };
}

module.exports = { createTicketmasterProvider, buildDiscoveryUrl, mapDiscoveryEvent };
