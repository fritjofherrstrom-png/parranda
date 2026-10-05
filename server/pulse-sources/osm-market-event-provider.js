"use strict";

const { buildProviderCollectionOutcome } = require("./provider-collection-outcome");
const { normalizeIanaTimezone, normalizeSourceEventDate, normalizeSourceEventDateTime } = require("./source-event-time");
const { coordinateTimezone } = require("./coordinate-timezone");
const { buildSelectedDayHoursFact, normalizeOpeningHours } = require("../place-candidates/opening-hours");
const { addCalendarDays } = require("../place-candidates/event-calendar-date");
const { haversineKm } = require("../candidates/area-intelligence");

const LICENSE = "ODbL";
const CREDIT = "© OpenStreetMap contributors — ODbL";
const MAX_PLACES = 500;
const MAX_ROWS = 160;

function osmMarketFeedForAnchor(anchor) {
  if (!coordinates(anchor)) return null;
  return { id: "osm-market-schedules", label: "OpenStreetMap", adapter: "osm_market_schedules",
    endpoint: "https://www.openstreetmap.org/", bbox: [-180, -90, 180, 90],
    source_identity: "openstreetmap.org", source_family: "recurring_map", source_tier: "inferred",
    confidence: "low", license: LICENSE, priority: -10, status: "active",
    runtime_policy: "bounded_refresh", pulse_only: true };
}

function createOsmMarketEventProvider({ anchor, loader, radiusM = 3000, timeoutMs = 30000,
  timezoneResolver = coordinateTimezone } = {}) {
  return { id: "osm-market-schedules", create() { return { async collect({ date = null } = {}) {
    if (!coordinates(anchor) || typeof loader !== "function") return result([], "unavailable", "source_unavailable");
    const reference = normalizeSourceEventDate(String(date || new Date().toISOString()).slice(0, 10));
    if (!reference) return result([], "unavailable", "collection_context_unavailable");
    let timer;
    let expired = false;
    const work = async () => {
      // Existing cached Overpass loader only. Its own bounds/failover apply;
      // this reader neither creates an endpoint nor calls other place sources.
      const places = await loader({ ...anchor, requestedIntents: ["market"], anchorMode: "coordinates" });
      if (!Array.isArray(places) || !/^loaded:\d+$/.test(places.loader_status || "")
        || places.loader_error || places.loader_metadata?.cache?.served_stale) {
        return result([], "failed", "source_collect_failed");
      }
      const rows = [];
      const ids = new Set();
      const mappedPlaces = new Set();
      for (const place of places.slice(0, MAX_PLACES)) {
        if (expired) return result([], "failed", "source_timeout");
        if (mappedPlaces.has(place?.id)) continue;
        const mapped = mapOsmMarketSchedule(place, { reference, anchor, radiusM, timezoneResolver });
        if (mapped.length) mappedPlaces.add(place.id);
        for (const event of mapped) {
          if (ids.has(event.id)) continue;
          if (rows.length >= MAX_ROWS) return result(rows, "failed", "source_collection_truncated");
          ids.add(event.id); rows.push(event);
        }
        // Allow the bounded deadline to run during a dense map projection.
        if (mapped.length) await new Promise(resolve => setImmediate(resolve));
      }
      return result(rows, places.length > MAX_PLACES ? "failed" : rows.length ? "ok" : "empty",
        places.length > MAX_PLACES ? "source_collection_truncated" : null);
    };
    try {
      return await Promise.race([work(), new Promise(resolve => {
        timer = setTimeout(() => { expired = true; resolve(result([], "failed", "source_timeout")); },
          Math.min(30000, Math.max(50, Number(timeoutMs) || 30000)));
      })]);
    } catch { return result([], "failed", "source_collect_failed"); }
    finally { clearTimeout(timer); }
  } }; } };
}

function mapOsmMarketSchedule(place, { reference, anchor, radiusM = 3000,
  timezoneResolver = coordinateTimezone } = {}) {
  if (!coordinates(place) || !coordinates(anchor) || !normalizeSourceEventDate(reference)
    || place.osm_marketplace !== true || place.osm_market_hall === true || place.type !== "market"
    || place.operational_status === "closed" || place.operational_status === "inactive"
    || haversineKm(anchor, place) > Math.min(40, Math.max(0.1, Number(radiusM) / 1000 || 3))) return [];
  const identity = /^osm-(node|way|relation)-(\d+)$/.exec(place.id || "");
  const title = typeof place.name === "string" ? place.name.trim() : "";
  if (!identity || !title || title.length > 240) return [];
  const url = `https://www.openstreetmap.org/${identity[1]}/${identity[2]}`;
  if (!place.sources?.some(source => source.provider === "osm" && source.url === url)) return [];
  const rule = normalizeOpeningHours(place.opening_hours);
  // A bare clock range and 24/7 are permanent opening hours. Seasonal,
  // holiday, comment, overlapping and overnight grammar remains unsupported.
  if (!rule || !/\b(?:Mo|Tu|We|Th|Fr|Sa|Su)\b/.test(rule)) return [];
  const clockPairs = [...rule.matchAll(/(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})/g)];
  if (clockPairs.some(([, start, end]) => end === "24:00" || minutes(end) <= minutes(start))) return [];
  const week = Array.from({ length: 7 }, (_, weekday) => buildSelectedDayHoursFact(rule, { weekday }));
  if (week.some(fact => !fact || fact.all_day) || week.every(fact => fact.status === "known")) return [];
  const timezone = normalizeIanaTimezone(timezoneResolver(place.lat, place.lng));
  if (!timezone) return [];
  const groups = new Map();
  // Pad for venue local dates; the existing selected-date gates choose the
  // real requested day. Project only explicitly stated weekdays and clocks.
  for (let offset = -1; offset <= 8; offset++) {
    const day = addCalendarDays(reference, offset);
    const weekday = new Date(`${day}T12:00:00Z`).getUTCDay();
    for (const window of week[weekday].windows) {
      if (!normalizeSourceEventDateTime(`${day}T${window.opens}`, { timezone })
        || !normalizeSourceEventDateTime(`${day}T${window.closes}`, { timezone })) continue;
      const key = `${window.opens}-${window.closes}`;
      if (!groups.has(key)) groups.set(key, { window, dates: [] });
      groups.get(key).dates.push(day);
    }
  }
  return [...groups].map(([key, { window, dates }]) => ({
    id: `osm-market:${identity[1]}:${identity[2]}:${key}`, title, lat: place.lat, lng: place.lng,
    timezone, place_context: title, confidence: "low", tags: ["market"], intents: ["market"],
    source_url: url,
    time_window: { kind: "occurrences", dates, local_start: window.opens, local_end: window.closes, timezone },
    recurrence: { rule, timezone, label: "OSM weekly market schedule", occurrence_status: "unconfirmed" },
    provenance: { source_url: url, source_label: "OpenStreetMap", license: LICENSE, attribution: CREDIT },
  }));
}

function coordinates(value) {
  return value && typeof value.lat === "number" && Number.isFinite(value.lat) && Math.abs(value.lat) <= 90
    && typeof value.lng === "number" && Number.isFinite(value.lng) && Math.abs(value.lng) <= 180;
}
function minutes(clock) { const [hour, minute] = clock.split(":").map(Number); return hour * 60 + minute; }
function result(rows, status, reason = null) {
  return { events: [], signals: [], time_sensitive_events: rows,
    collection_status: buildProviderCollectionOutcome(status, { reason, eventRows: rows.length }) };
}

module.exports = { createOsmMarketEventProvider, mapOsmMarketSchedule, osmMarketFeedForAnchor, CREDIT };
