"use strict";

// Country-wide source contract, not a city registry. Acquisition stays bounded
// and background-owned by the ordinary Live supply/cache.
const { buildProviderCollectionOutcome } = require("./provider-collection-outcome");
const { readBoundedText, DEFAULT_USER_AGENT } = require("./local-event-source-scout");
const { normalizeIanaTimezone, normalizeSourceEventDate, normalizeSourceEventDateTime } = require("./source-event-time");
const { haversineKm } = require("../candidates/area-intelligence");
const { addCalendarDays } = require("../place-candidates/event-calendar-date");
const { coordinateTimezone } = require("./coordinate-timezone");

const ENDPOINT = "https://api.datatourisme.fr/v1/entertainmentAndEvent";
const LICENSE = "Licence Ouverte";
const FIELDS = "uuid,uri,label,type,isLocatedAt,takesPlaceAt,hasBeenPublishedBy,lastUpdate";
const PAGE_SIZE = 80;
const MAX_PAGES = 2;
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_PERIODS = 24;
const MAX_ROWS = 160;

function datatourismeFeedForContext({ anchor, placeContext, radiusM = 3000 } = {}) {
  if (String(placeContext?.country_code || "").toLowerCase() !== "fr" || !coordinates(anchor)) return null;
  const radius = Math.min(40000, Math.max(100, Number(radiusM) || 3000));
  const latDelta = radius / 110000;
  const lngDelta = latDelta / Math.max(0.01, Math.cos(anchor.lat * Math.PI / 180));
  return {
    id: "datatourisme-fr", label: "DATAtourisme", endpoint: ENDPOINT,
    adapter: "datatourisme", bbox: [Math.max(-180, anchor.lng - lngDelta), Math.max(-90, anchor.lat - latDelta),
      Math.min(180, anchor.lng + lngDelta), Math.min(90, anchor.lat + latDelta)],
    source_family: "national_open", source_identity: "datatourisme.fr",
    source_tier: "official", confidence: "medium", license: LICENSE,
    status: "active", runtime_policy: "bounded_refresh", priority: 90,
    // Initial national supply is display-only; no automatic route weaving.
    pulse_only: true,
  };
}

function createDatatourismeEventProvider({ key, anchor, radiusM = 3000,
  fetcher = global.fetch, timeoutMs = 15000, timezoneResolver = coordinateTimezone } = {}) {
  return {
    id: "datatourisme-fr",
    create() {
      return {
        async collect({ date = null } = {}) {
          if (!String(key || "").trim()) return result([], "unavailable", "source_credentials_unavailable");
          if (!coordinates(anchor)) return result([], "unavailable", "trusted_anchor_unavailable");
          if (typeof fetcher !== "function") return result([], "unavailable", "source_fetch_unavailable");
          const queryDate = normalizeSourceEventDate(String(date || new Date().toISOString()).slice(0, 10));
          if (!queryDate) return result([], "unavailable", "collection_context_unavailable");
          // Pad the source-local calendar envelope; the shared per-event venue
          // timezone/date gates decide which actual days can be displayed.
          const from = addCalendarDays(queryDate, -1);
          const to = addCalendarDays(queryDate, 8);
          const controller = new AbortController();
          let timer;
          const rows = [];
          const seen = new Set();
          let phase = "fetch";
          const work = async () => {
            let remainingBytes = MAX_BYTES;
            for (let page = 1; page <= MAX_PAGES; page++) {
              controller.signal.throwIfAborted();
              const url = new URL(ENDPOINT);
              url.searchParams.set("fields", FIELDS);
              url.searchParams.set("lang", "fr");
              url.searchParams.set("filters", `(takesPlaceAt.endDate[gte]=${from} OR takesPlaceAt.startDate[gte]=${from}) AND takesPlaceAt.startDate[lte]=${to}`);
              url.searchParams.set("sort", "takesPlaceAt.endDate[asc],uuid[asc]");
              url.searchParams.set("geo_distance", `${anchor.lat},${anchor.lng},${Math.min(40, Math.max(0.1, Number(radiusM) / 1000 || 3))}km`);
              url.searchParams.set("page_size", String(PAGE_SIZE));
              url.searchParams.set("page", String(page));
              phase = "fetch";
              const response = await fetcher(url.toString(), { redirect: "manual", signal: controller.signal,
                headers: { Accept: "application/json", "User-Agent": DEFAULT_USER_AGENT, "X-API-Key": String(key).trim() } });
              if (!response?.ok) return result(rows, "failed", `source_http_${response?.status || "not_ok"}`);
              if (response.url && response.url !== url.toString()) return result(rows, "failed", "source_redirect_invalid");
              phase = "payload";
              const text = await readBoundedText(response, remainingBytes);
              if (text == null) return result(rows, "failed", "source_payload_invalid");
              remainingBytes -= Buffer.byteLength(text);
              const payload = JSON.parse(text);
              if (!Array.isArray(payload?.objects) || payload.objects.length > PAGE_SIZE || !validPagination(payload.meta, page)
                || payload.objects.length > payload.meta.total) {
                return result(rows, "failed", "source_payload_invalid");
              }
              let invalid = false;
              for (const record of payload.objects) {
                const mapped = mapDatatourismeEvent(record, { timezoneResolver, anchor, radiusM });
                if (mapped === null) { invalid = true; continue; }
                for (const event of mapped) {
                  // Provider geographic filtering is not the final trust gate.
                  if (haversineKm(anchor, event) > Math.min(40, Math.max(0.1, Number(radiusM) / 1000 || 3))) continue;
                  if (!seen.has(event.id)) {
                    if (rows.length >= MAX_ROWS) return result(rows, "failed", "source_collection_truncated");
                    seen.add(event.id); rows.push(event);
                  }
                }
              }
              if (invalid) return result(rows, "failed", "source_payload_invalid");
              if (payload.meta.page >= payload.meta.total_pages) return result(rows, rows.length ? "ok" : "empty");
              // Never follow meta.next: examples contain http URLs and keys.
              // Rebuild a fixed HTTPS endpoint and keep the key in its header.
              if (page === MAX_PAGES || remainingBytes < 1024) return result(rows, "failed", "source_collection_truncated");
            }
          };
          const expired = new Promise((resolve) => {
            timer = setTimeout(() => { controller.abort(); resolve(result(rows, "failed", "source_timeout")); },
              Math.min(30000, Math.max(50, Number(timeoutMs) || 15000)));
          });
          try { return await Promise.race([work(), expired]); }
          catch (error) { return result(rows, "failed", controller.signal.aborted ? "source_timeout"
            : phase === "payload" ? "source_payload_invalid" : "source_fetch_failed"); }
          finally { clearTimeout(timer); }
        },
      };
    },
  };
}

function validPagination(meta, page) {
  return meta && meta.page === page && Number.isInteger(meta.total_pages)
    && (meta.total === 0 && page === 1 && [0, 1].includes(meta.total_pages) || meta.total_pages >= page)
    && Number.isInteger(meta.total) && meta.total >= 0;
}

function mapDatatourismeEvent(record, { timezoneResolver = coordinateTimezone, anchor = null, radiusM = 3000 } = {}) {
  const uuid = text(record?.uuid, 80);
  const title = text(record?.label, 240) || text(record?.label?.fr, 240);
  const url = httpUrl(record?.uri);
  if (!uuid || !title || !url || !Array.isArray(record.isLocatedAt) || record.isLocatedAt.length !== 1
    || !Array.isArray(record.takesPlaceAt) || !record.takesPlaceAt.length || record.takesPlaceAt.length > MAX_PERIODS) return null;
  const location = record.isLocatedAt[0];
  const geo = { lat: location?.geo?.latitude, lng: location?.geo?.longitude };
  if (!coordinates(geo)) return null;
  if (coordinates(anchor) && haversineKm(anchor, geo) > Math.min(40, Math.max(0.1, Number(radiusM) / 1000 || 3))) return [];
  const timezone = normalizeIanaTimezone(timezoneResolver(geo.lat, geo.lng));
  if (!timezone) return null;
  const addresses = Array.isArray(location.address) ? location.address : [];
  const address = addresses.length === 1 ? addresses[0] : null;
  const place = text(address?.addressLocality, 200) || text(address?.hasAddressCity?.label, 200) || text(address?.hasAddressCity?.label?.fr, 200);
  const publishers = [...new Set((Array.isArray(record.hasBeenPublishedBy) ? record.hasBeenPublishedBy : [])
    .map(agent => text(agent?.legalName, 180)).filter(Boolean))];
  const updated = text(record.lastUpdate, 80);
  if (!publishers.length || publishers.length > 8 || !updated || !Number.isFinite(Date.parse(updated))) return null;
  const base = { title, ...geo, timezone, source_language: "fr", event_language: "fr", place_context: place,
    address: text(address?.streetAddress, 240), source_url: url, confidence: "medium",
    provenance: { source_url: url, source_label: "DATAtourisme", license: LICENSE,
      attribution: `${publishers.join(" · ")} — DATAtourisme — ${LICENSE} — ${updated}` },
  };
  const rows = [];
  for (const period of record.takesPlaceAt) {
    const start = normalizeSourceEventDate(period?.startDate);
    const end = normalizeSourceEventDate(period?.endDate) || start;
    if (!start || !end || end < start || period.endDate && !normalizeSourceEventDate(period.endDate)) return null;
    // Complex recurrence is not converted into daily attendance. Preserve a
    // stated range as period context without claiming occurrence days/times.
    const recurring = nonempty(period.appliesOnDay) || nonempty(period.weekOfMonth) || Boolean(text(period.openingDetails, 1000));
    const localStart = clock(period.startTime);
    const localEnd = clock(period.endTime);
    if (period.startTime && !localStart || period.endTime && !localEnd || localEnd && !localStart) return null;
    let timing;
    if (recurring || start !== end) {
      timing = { starts_on: start, ends_on: end, time_window: { kind: "period", starts_on: start, ends_on: end,
        local_start: localStart, local_end: localEnd } };
    } else if (!localStart) {
      timing = { starts_on: start, ends_on: end, time_window: { kind: "all_day", starts_on: start, ends_on: end } };
    } else {
      const startsAt = normalizeSourceEventDateTime(`${start}T${localStart}:00`, { timezone });
      // End without a date or a same-day earlier clock is not rolled forward.
      const endsAt = localEnd ? normalizeSourceEventDateTime(`${end}T${localEnd}:00`, { timezone }) : null;
      if (!startsAt || localEnd && (!endsAt || endsAt <= startsAt)) return null;
      timing = { starts_at: startsAt, ends_at: endsAt };
    }
    // Stable occurrence identity does not depend on response order.
    const id = `datatourisme:${uuid}:${start}:${end}:${localStart || "date"}:${localEnd || ""}`;
    rows.push({ ...base, ...timing, id });
  }
  return rows;
}

function result(rows, status, reason = null) {
  // Snapshot partial rows; a late, aborted transport must not mutate the view.
  const events = rows.slice();
  return { events: [], signals: [], time_sensitive_events: events,
    collection_status: buildProviderCollectionOutcome(status, { reason, eventRows: events.length }) };
}
function coordinates(value) {
  return value && typeof value.lat === "number" && Number.isFinite(value.lat) && Math.abs(value.lat) <= 90
    && typeof value.lng === "number" && Number.isFinite(value.lng) && Math.abs(value.lng) <= 180;
}
function nonempty(value) { return Array.isArray(value) ? value.length > 0 : value != null; }
function text(value, max) { return typeof value === "string" && value.trim() && value.trim().length <= max ? value.trim() : null; }
function clock(value) { return typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d(?::00)?$/.test(value) ? value.slice(0, 5) : null; }
function httpUrl(value) {
  if (!text(value, 2048)) return null;
  try { const url = new URL(value); return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password ? value : null; }
  catch { return null; }
}

module.exports = { createDatatourismeEventProvider, datatourismeFeedForContext, mapDatatourismeEvent, coordinateTimezone, ENDPOINT };
