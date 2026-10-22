"use strict";

const { buildProviderCollectionOutcome } = require("./provider-collection-outcome");
const { normalizeIanaTimezone, normalizeSourceEventDate, normalizeSourceEventDateTime } = require("./source-event-time");

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
const MAX_PAGES = 3;
const MAX_EVENT_ROWS = 120;
const DEFAULT_RADIUS_KM = 3;

function toFinite(value) {
  // Provider geometry must be stated, not created by Number(null/blank/bool).
  if ((typeof value !== "number" && typeof value !== "string") ||
      (typeof value === "string" && !value.trim())) return null;
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

function discoveryStart(start, timezone) {
  if (!start || start.dateTBA === true || start.dateTBD === true) return null;
  const localDate = normalizeSourceEventDate(start.localDate);
  // These flags override even a populated placeholder datetime. A confirmed
  // date is still useful, but it is not an explicit whole-day statement.
  if (start.timeTBA === true || start.noSpecificTime === true) return localDate;
  return normalizeSourceEventDateTime(start.dateTime, { timezone }) ||
    (localDate && typeof start.localTime === "string"
      ? normalizeSourceEventDateTime(`${localDate}T${start.localTime}`, { timezone }) : null) || localDate;
}

function buildDiscoveryUrl({ endpoint = DEFAULT_ENDPOINT, key, anchor, radiusKm, startDateTime, endDateTime, pageSize, page = 0 }) {
  const url = new URL(endpoint);
  url.searchParams.set("apikey", key);
  url.searchParams.set("latlong", `${anchor.lat},${anchor.lng}`);
  url.searchParams.set("radius", String(Math.max(1, Math.round(radiusKm || DEFAULT_RADIUS_KM))));
  url.searchParams.set("unit", "km");
  url.searchParams.set("sort", "date,asc");
  url.searchParams.set("size", String(pageSize || DEFAULT_PAGE_SIZE));
  url.searchParams.set("page", String(page));
  if (startDateTime) url.searchParams.set("startDateTime", startDateTime);
  if (endDateTime) url.searchParams.set("endDateTime", endDateTime);
  return url.toString();
}

function readDiscoveryPagination(body, pageNumber) {
  const page = body.page;
  if (page != null) {
    if (typeof page !== "object" || Array.isArray(page)) return null;
    for (const field of ["number", "totalPages", "totalElements", "size"]) {
      if (Object.hasOwn(page, field) && (!Number.isInteger(page[field]) || page[field] < (field === "size" ? 1 : 0))) return null;
    }
    if (Object.hasOwn(page, "number") && page.number !== pageNumber) return null;
  }
  return {
    totalPages: page?.totalPages || 0,
    totalElements: page?.totalElements || 0,
    // A next link indicates more inventory; its URL is never a fetch target.
    hasNext: typeof body._links?.next?.href === "string" && Boolean(body._links.next.href.trim()),
  };
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
  if (lat == null || lng == null || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  const start = event.dates && event.dates.start;
  const timezone = normalizeIanaTimezone(event.dates && event.dates.timezone);
  const starts = discoveryStart(start, timezone);
  const exactStart = normalizeSourceEventDateTime(starts, { timezone });
  const end = event.dates && event.dates.end;
  const exactEnd = end?.approximate === true ? null
    : normalizeSourceEventDateTime(discoveryStart(end, timezone), { timezone });
  const status = event.dates && event.dates.status && event.dates.status.code;
  const classification =
    Array.isArray(event.classifications) && event.classifications[0] && event.classifications[0].segment
      ? event.classifications[0].segment.name
      : null;
  return {
    id: typeof event.id === "string" ? `tm-${event.id}` : null,
    // Discovery IDs identify occurrences, not a recurring attraction/series.
    source_occurrence_id: typeof event.id === "string" && event.id.trim() && event.id.length <= 200 ? event.id : null,
    title,
    starts_at: typeof starts === "string" ? starts : null,
    // Missing/approximate ends stay unknown; never assign a standard duration.
    ends_at: exactStart && exactEnd && new Date(exactEnd) > new Date(exactStart) ? exactEnd : null,
    source_url: typeof event.url === "string" ? event.url : null,
    place_context: venue && typeof venue.name === "string" ? venue.name : null,
    lat,
    lng,
    tags: classification ? [String(classification).toLowerCase()] : [],
    // Event-level timezone from the API — the truest venue-local clock available.
    timezone,
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
  windowStart = null,
  windowEnd = null,
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
          const acquisitionStart = windowStart ? new Date(windowStart) : nowDate;
          const url = buildDiscoveryUrl({
            endpoint,
            key,
            anchor,
            radiusKm,
            pageSize,
            startDateTime: tmDateTime(acquisitionStart),
            endDateTime: tmDateTime(windowEnd || new Date(acquisitionStart.getTime() + windowDays * 24 * 60 * 60 * 1000)),
          });
          const controller = typeof AbortController === "function" ? new AbortController() : null;
          // Every page shares the existing collection budget, including JSON
          // reads. Never restart the clock or follow a source-supplied URL.
          const budgetMs = Math.max(1000, timeoutMs);
          const deadline = Date.now() + budgetMs;
          const timer = controller ? setTimeout(() => controller.abort(), budgetMs) : null;
          const mapped = [];
          const staleIds = new Set();
          const seenRows = new Set();
          const seenPages = new Set();
          let sourceRows = 0;
          let advertisedPages = 0;
          let advertisedRows = 0;
          let collectedPages = 0;
          let failure = null;
          try {
            for (let pageNumber = 0; pageNumber < MAX_PAGES; pageNumber += 1) {
              if (controller?.signal.aborted || Date.now() >= deadline) { failure = "source_timeout"; break; }
              const pageUrl = new URL(url);
              pageUrl.searchParams.set("page", String(pageNumber));
              const response = await fetcher(pageUrl.toString(), controller ? { signal: controller.signal } : {});
              if (!response || !response.ok) {
                failure = `source_http_${response?.status || "not_ok"}`; break;
              }
              let body;
              try {
                body = await response.json();
              } catch (_error) {
                failure = controller?.signal.aborted ? "source_timeout" : "source_payload_invalid"; break;
              }
              if (controller?.signal.aborted || Date.now() >= deadline) { failure = "source_timeout"; break; }
              const events = body && typeof body === "object" && !Array.isArray(body)
                ? Array.isArray(body._embedded?.events) ? body._embedded.events
                  : !Object.hasOwn(body, "_embedded") && body.page?.totalElements === 0 ? [] : null
                : null;
              if (!events) { failure = "source_payload_invalid"; break; }
              const boundedEvents = events.slice(0, MAX_EVENT_ROWS - sourceRows);
              const pagination = readDiscoveryPagination(body, pageNumber);
              if (!pagination) { failure = "source_payload_invalid"; break; }
              // A missing later metadata field cannot retract inventory that
              // an earlier page explicitly said remained to be collected.
              advertisedPages = Math.max(advertisedPages, pagination.totalPages);
              advertisedRows = Math.max(advertisedRows, pagination.totalElements);
              const hasMore = pagination.hasNext || advertisedPages > pageNumber + 1 ||
                advertisedRows > sourceRows + boundedEvents.length;
              const pageSignature = JSON.stringify(boundedEvents);
              if (seenPages.has(pageSignature)) { failure = "source_collection_truncated"; break; }
              seenPages.add(pageSignature);
              // A stated cancellation belongs to the known occurrence even
              // when this row cannot provide a positive place/geometry atom.
              for (const event of boundedEvents) {
                if (typeof event?.id === "string" && event.id.trim() && event.id.length <= 200 &&
                    typeof event.dates?.status?.code === "string" && /cancel|postpon/i.test(event.dates.status.code)) {
                  staleIds.add(event.id);
                }
              }
              const pageEvents = boundedEvents.map(mapDiscoveryEvent).filter(Boolean);
              if (events.length && !pageEvents.length) { failure = "source_payload_invalid"; break; }
              const previousRows = mapped.length;
              for (const event of pageEvents) {
                const id = typeof event.id === "string" && event.id.slice(3).trim() ? event.id : null;
                // Preserve changed/cancelled evidence for the same identity so
                // normalization and stale/conflict gates can assess it. A
                // repeated ID alone does not prove identical source facts.
                const rowKey = id ? JSON.stringify(event) : null;
                if (rowKey && seenRows.has(rowKey)) continue;
                if (rowKey) seenRows.add(rowKey);
                mapped.push(event);
              }
              sourceRows += boundedEvents.length;
              collectedPages += 1;
              if (events.length > boundedEvents.length || (pageNumber > 0 && mapped.length === previousRows) || (!events.length && hasMore)) {
                failure = "source_collection_truncated"; break;
              }
              if (!hasMore) break;
              if (pageNumber === MAX_PAGES - 1 || sourceRows >= MAX_EVENT_ROWS) {
                failure = "source_collection_truncated"; break;
              }
            }
          } catch (error) {
            failure = error?.name === "AbortError" ? "source_timeout" : "source_fetch_failed";
          } finally {
            if (timer) clearTimeout(timer);
          }
          // A later page may explicitly cancel/postpone an identity already
          // listed as on sale. Carry that stated status to its earlier atoms:
          // the shared date gate removes stale rows before cross-source fusion.
          return {
            time_sensitive_events: mapped.map(event => staleIds.has(event.source_occurrence_id) ? { ...event, freshness: "stale" } : event),
            collection_status: buildProviderCollectionOutcome(mapped.length ? "ok" : failure ? "failed" : "empty", {
              reason: failure ? collectedPages ? "source_collection_truncated" : failure : mapped.length ? null : "source_empty",
              eventRows: mapped.length,
            }),
          };
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
