"use strict";

// Country/admin calendar facts, never venue programmes. Runs only in the
// existing background source acquisition, with resolver-attested context.
const { createHash } = require("node:crypto");
const { createSourceCache } = require("../place-candidates/source-cache");
const { addCalendarDays } = require("../place-candidates/event-calendar-date");
const { readBoundedText, DEFAULT_USER_AGENT } = require("./local-event-source-scout");
const { normalizeSourceEventDate, normalizeIanaTimezone } = require("./source-event-time");
const { coordinateTimezone } = require("./coordinate-timezone");
const { buildProviderCollectionOutcome } = require("./provider-collection-outcome");

const FESTIVOS = "https://festivos.io/v1";
const OPEN = "https://openholidaysapi.org";
const FESTIVOS_CREDIT = "festivos.io — CC BY 4.0";
const OPEN_CREDIT = "OpenHolidays API — ODbL";
const MAX_BYTES = 4 * 1024 * 1024;
const MAX_ROWS = 160;

function publicHolidayFeedForContext({ anchor, placeContext, scope } = {}) {
  const country = countryCode(placeContext);
  // Mapless admin facts do not enter near-me, in-place or route corridors.
  if (!country || !coordinates(anchor) || scope && (scope.kind !== "around_place" || scope.trusted_nearby_fallback_m)) return null;
  const spanish = country === "ES";
  const binding = createHash("sha256").update(JSON.stringify(placeContext)).digest("hex").slice(0, 16);
  return { id: `public-holidays:${country}:${binding}`, label: spanish ? "festivos.io" : "OpenHolidays API",
    endpoint: spanish ? FESTIVOS : OPEN, adapter: "public_holidays", bbox: [-180, -90, 180, 90],
    source_family: "calendar_open", source_identity: spanish ? "festivos.io" : "openholidaysapi.org",
    source_tier: "official", confidence: "low", license: spanish ? "CC-BY-4.0" : "ODbL",
    status: "active", runtime_policy: "bounded_refresh", priority: 150,
    pulse_only: true, source_scoped_pulse: true };
}

function createPublicHolidayEventProvider({ anchor, placeContext, fetcher = global.fetch,
  referenceCache = createSourceCache({ namespace: "public-holiday-reference-v1", ttlMs: 86400000 }),
  timeoutMs = 15000, timezoneResolver = coordinateTimezone } = {}) {
  return { id: "public-holidays", create() { return { async collect({ date } = {}) {
    const country = countryCode(placeContext);
    const reference = normalizeSourceEventDate(String(date || new Date().toISOString()).slice(0, 10));
    const timezone = coordinates(anchor) ? normalizeIanaTimezone(timezoneResolver(anchor.lat, anchor.lng)) : null;
    if (!country || !reference || !timezone) return result([], "unavailable", "collection_context_unavailable");
    if (typeof fetcher !== "function") return result([], "unavailable", "source_fetch_unavailable");
    const from = addCalendarDays(reference, -1), to = addCalendarDays(reference, 8);
    const controller = new AbortController();
    let timer, remainingBytes = MAX_BYTES;
    const rows = [];
    const json = async (url) => {
      controller.signal.throwIfAborted();
      const response = await fetcher(url, { redirect: "manual", signal: controller.signal,
        headers: { Accept: "application/json", "User-Agent": DEFAULT_USER_AGENT } });
      if (!response?.ok) throw failure(`source_http_${response?.status || "not_ok"}`);
      if (response.url && response.url !== url) throw failure("source_redirect_invalid");
      const body = await readBoundedText(response, remainingBytes);
      if (body == null) throw failure("source_payload_invalid");
      remainingBytes -= Buffer.byteLength(body);
      try { return JSON.parse(body); } catch { throw failure("source_payload_invalid"); }
    };
    const metadata = (key, url, validate) => referenceCache.get(key, async () => {
      const value = await json(url);
      if (!validate(value)) throw failure("source_payload_invalid");
      return value;
    }, { signal: controller.signal });
    const work = async () => {
      let unresolved = false;
      if (country === "ES") {
        const index = await metadata("festivos-municipalities", `${FESTIVOS}/ref/municipios.json`, validMunicipalities);
        const municipality = matchMunicipality(index.municipalities, placeContext);
        if (!municipality) return result([], "unavailable", "calendar_admin_join_unavailable");
        const years = [...new Set([from.slice(0, 4), to.slice(0, 4)])];
        for (const year of years) {
          const payload = await json(`${FESTIVOS}/${year}/municipio/${municipality.ine}.json`);
          if (!validMunicipalCalendar(payload, municipality, Number(year))) throw failure("source_payload_invalid");
          for (const holiday of payload.holidays) {
            const mapped = mapFestivosHoliday(holiday, { municipality, attribution: payload.attribution, timezone });
            if (!mapped || mapped.starts_on.slice(0, 4) !== year) throw failure("source_payload_invalid");
            if (mapped.ends_on >= from && mapped.starts_on <= to) rows.push(mapped);
          }
        }
      } else {
        const countries = await metadata("openholidays-countries", `${OPEN}/Countries`, validCountries);
        const supported = countries.filter(value => value.isoCode === country);
        if (supported.length !== 1) return result([], "unavailable", "calendar_country_unsupported");
        const subdivisions = await metadata(`openholidays-subdivisions-${country}`,
          `${OPEN}/Subdivisions?countryIsoCode=${country}`, validSubdivisions);
        const matched = matchSubdivisions(subdivisions, placeContext);
        const url = `${OPEN}/PublicHolidays?countryIsoCode=${country}&validFrom=${from}&validTo=${to}`;
        const holidays = await json(url);
        if (!Array.isArray(holidays) || holidays.length > MAX_ROWS) throw failure("source_payload_invalid");
        for (const holiday of holidays) {
          const mapped = mapOpenHoliday(holiday, { country: supported[0], matched, subdivisions, timezone, sourceUrl: url });
          if (mapped === null) throw failure("source_payload_invalid");
          if (mapped === "unresolved") { unresolved = true; continue; }
          if (mapped && mapped.ends_on >= from && mapped.starts_on <= to) rows.push(mapped);
        }
      }
      const unique = [...new Map(rows.map(row => [row.id, row])).values()];
      if (unique.length > MAX_ROWS) return result(unique.slice(0, MAX_ROWS), "failed", "source_collection_truncated");
      return result(unique, unresolved ? "failed" : unique.length ? "ok" : "empty",
        unresolved ? "calendar_scope_unresolved" : null);
    };
    try { return await Promise.race([work(), new Promise(resolve => {
      timer = setTimeout(() => { controller.abort(); resolve(result(rows, "failed", "source_timeout")); },
        Math.min(30000, Math.max(50, Number(timeoutMs) || 15000)));
    })]); }
    catch (error) { return result(rows, "failed", controller.signal.aborted ? "source_timeout"
      : error.calendarReason || "source_fetch_failed"); }
    finally { clearTimeout(timer); }
  } }; } };
}

function matchMunicipality(values, context) {
  const name = normalized(context?.municipality || context?.locality);
  if (countryCode(context) !== "ES" || !name) return null;
  const province = normalized(context.county), region = normalized(context.region);
  if (!province && !region) return null;
  const matches = values.filter(value => aliases(value.name).includes(name)
    && (!province || aliases(value.province_name).includes(province))
    && (!region || aliases(value.ccaa_name).includes(region)));
  return matches.length === 1 ? matches[0] : null;
}

function mapFestivosHoliday(holiday, { municipality, attribution, timezone } = {}) {
  const date = normalizeSourceEventDate(holiday?.date), title = text(holiday?.name?.es, 240);
  const scope = ({ national: "national", regional: "regional", local: "local" })[holiday?.level];
  const ref = text(holiday?.source?.ref, 800);
  const url = holiday?.source?.url == null ? null : httpUrl(holiday.source.url);
  if (!date || !title || !scope || !ref || holiday.source.url != null && !url
    || !["fixed", "movable", "substitute"].includes(holiday.type)) return null;
  const area = scope === "national" ? "ES" : scope === "regional" ? municipality.ccaa_name : municipality.name;
  const credit = [...new Set([FESTIVOS_CREDIT, text(attribution, 1200), ref].filter(Boolean))].join(" · ");
  return { id: `festivos:${municipality.ine}:${date}:${scope}:${title}`, title,
    starts_on: date, ends_on: date, time_window: { kind: "all_day", starts_on: date, ends_on: date },
    calendar_fact: { kind: "public_holiday", scope, country_code: "ES", area, temporal_scope: "full_day", flags: [] },
    source_location_scope: ({ national: "country", regional: "region", local: "municipality" })[scope], place_context: area, timezone,
    source_url: url, source_language: "es", event_language: "es", confidence: "low",
    provenance: { source_url: url, source_label: "festivos.io", license: "CC-BY-4.0", attribution: credit } };
}

function mapOpenHoliday(holiday, { country, matched, subdivisions, timezone, sourceUrl } = {}) {
  const start = normalizeSourceEventDate(holiday?.startDate), end = normalizeSourceEventDate(holiday?.endDate);
  const scope = ({ National: "national", Regional: "regional", Local: "local" })[holiday?.regionalScope];
  const temporal = ({ FullDay: "full_day", HalfDay: "half_day" })[holiday?.temporalScope];
  const name = localizedName(holiday?.name, country.officialLanguages);
  if (!text(holiday?.id, 100) || !start || !end || end < start || !scope || !temporal || !name
    || holiday.type !== "Public" || typeof holiday.nationwide !== "boolean"
    || !Array.isArray(holiday.subdivisions) || !Array.isArray(holiday.groups)
    || !Array.isArray(holiday.tags) || holiday.tags.some(tag => !["Recommended", "Provisional", "OneTime", "Exception"].includes(tag))) return null;
  // Subgroup applicability is not proved by a geographic/country join.
  if (holiday.groups.length) return "unresolved";
  let area;
  if (holiday.nationwide) {
    if (scope !== "national" || holiday.subdivisions.length) return null;
    area = localizedName(country.name, country.officialLanguages)?.text || country.isoCode;
  } else {
    if (scope === "national" || !holiday.subdivisions.length) return null;
    const flat = flattenSubdivisions(subdivisions);
    if (holiday.subdivisions.some(value => !text(value?.code, 80) || !flat.some(item => item.code === value.code))) return null;
    const applicable = holiday.subdivisions.filter(value => matched.has(value.code));
    if (!applicable.length) {
      const possiblyLocal = holiday.subdivisions.some(value => flat.find(item => item.code === value.code)
        .ancestors.some(code => matched.has(code)));
      return !matched.size || possiblyLocal ? "unresolved" : false;
    }
    const narrowest = applicable.map(value => flat.find(item => item.code === value.code))
      .sort((left, right) => right.ancestors.length - left.ancestors.length || left.code.localeCompare(right.code))[0];
    area = localizedName(narrowest.name, country.officialLanguages).text;
  }
  return { id: `openholidays:${country.isoCode}:${holiday.id}`, title: name.text,
    starts_on: start, ends_on: end,
    // Half days are date context, never an invented half-day clock.
    time_window: { kind: temporal === "half_day" ? "period" : "all_day", starts_on: start, ends_on: end },
    calendar_fact: { kind: "public_holiday", scope, country_code: country.isoCode, area,
      temporal_scope: temporal, flags: [...new Set(holiday.tags)] },
    source_location_scope: ({ national: "country", regional: "region", local: "municipality" })[scope], place_context: area, timezone,
    source_url: sourceUrl, source_language: name.language.toLowerCase(), event_language: name.language.toLowerCase(),
    confidence: "low", provenance: { source_url: sourceUrl, source_label: "OpenHolidays API", license: "ODbL", attribution: OPEN_CREDIT } };
}

function matchSubdivisions(values, context) {
  const flat = flattenSubdivisions(values), codes = new Set();
  // Exact unique source-name joins only. A local unit also needs a matched
  // regional ancestor; name-only municipality matches have no authority.
  for (const field of ["region", "county", "municipality", "locality"]) {
    const target = normalized(context?.[field]);
    if (!target) continue;
    const matches = flat.filter(value => value.name.some(name => normalized(name.text) === target));
    if (matches.length === 1 && (["region", "county"].includes(field)
      || matches[0].ancestors.some(code => codes.has(code)))) {
      codes.add(matches[0].code);
      matches[0].ancestors.forEach(code => codes.add(code));
    }
  }
  return codes;
}

function validMunicipalities(value) {
  return Array.isArray(value?.municipalities) && value.municipalities.length > 0 && value.municipalities.length <= 10000
    && new Set(value.municipalities.map(row => row?.ine)).size === value.municipalities.length
    && value.municipalities.every(row => /^\d{5}$/.test(row?.ine) && /^\d{2}$/.test(row?.province)
      && row.ine.startsWith(row.province) && /^ES-[A-Z]{2}$/.test(row.ccaa_iso)
      && [row.name, row.province_name, row.ccaa_name].every(name => text(name, 240)));
}
function validMunicipalCalendar(value, expected, year) {
  const municipality = value?.municipality;
  return value?.year === year && text(value.version, 40) && municipality?.ine === expected.ine
    && municipality.name === expected.name && municipality.province?.ine === expected.province
    && municipality.province.name === expected.province_name && municipality.ccaa?.code === expected.ccaa_iso
    && municipality.ccaa.name === expected.ccaa_name && Array.isArray(value.holidays) && value.holidays.length <= 64
    && (value.attribution == null || Boolean(text(value.attribution, 1200)))
    && (value.license == null || ["CC-BY-4.0", "CC BY 4.0", "https://creativecommons.org/licenses/by/4.0/"].includes(value.license));
}
function validCountries(value) {
  return Array.isArray(value) && value.length > 0 && value.length <= 300
    && new Set(value.map(row => row?.isoCode)).size === value.length
    && value.every(row => /^[A-Z]{2}$/.test(row?.isoCode) && validNames(row.name)
      && Array.isArray(row.officialLanguages) && row.officialLanguages.length > 0
      && row.officialLanguages.every(lang => /^[A-Z]{2,3}$/.test(lang)));
}
function validSubdivisions(value) {
  let count = 0;
  const codes = new Set();
  const visit = (rows, depth) => Array.isArray(rows) && depth <= 8 && rows.every(row => {
    if (++count > 5000 || !text(row?.code, 80) || codes.has(row.code) || !validNames(row.name)) return false;
    codes.add(row.code);
    return row.children == null || visit(row.children, depth + 1);
  });
  return visit(value, 0);
}
function flattenSubdivisions(values, ancestors = []) {
  return values.flatMap(value => [{ ...value, ancestors }, ...flattenSubdivisions(value.children || [], [...ancestors, value.code])]);
}
function validNames(value) {
  return Array.isArray(value) && value.length > 0 && value.length <= 20
    && value.every(row => /^[A-Z]{2,3}$/.test(row?.language) && text(row.text, 240));
}
function localizedName(values, preferred) {
  if (!validNames(values)) return null;
  return preferred.map(language => values.find(value => value.language === language)).find(Boolean)
    || values.find(value => value.language === "EN") || values[0];
}
function countryCode(context) { const code = String(context?.country_code || "").toUpperCase(); return /^[A-Z]{2}$/.test(code) ? code : null; }
function coordinates(value) { return Number.isFinite(value?.lat) && Math.abs(value.lat) <= 90 && Number.isFinite(value?.lng) && Math.abs(value.lng) <= 180; }
function text(value, max) { return typeof value === "string" && value.trim() && value.trim().length <= max ? value.trim() : null; }
function normalized(value) { return typeof value === "string" ? value.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().trim().replace(/\s+/g, " ") : ""; }
function aliases(value) { return [normalized(value), ...String(value || "").split("/").map(normalized)].filter(Boolean); }
function httpUrl(value) {
  if (!text(value, 2048)) return null;
  try { const url = new URL(value); return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password ? value : null; } catch { return null; }
}
function failure(reason) { return Object.assign(new Error(reason), { calendarReason: reason }); }
function result(rows, status, reason = null) {
  return { events: [], signals: [], time_sensitive_events: rows.slice(),
    collection_status: buildProviderCollectionOutcome(status, { reason, eventRows: rows.length }) };
}

module.exports = { createPublicHolidayEventProvider, publicHolidayFeedForContext, mapFestivosHoliday, mapOpenHoliday,
  matchMunicipality, matchSubdivisions, FESTIVOS_CREDIT, OPEN_CREDIT };
