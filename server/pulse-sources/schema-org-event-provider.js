/**
 * Generic schema.org/Event source provider (first time-sensitive event source).
 *
 * Moves Parranda from "what exists here statically?" to "what is happening
 * here/today/tonight?" by ingesting source-backed, time-windowed happenings
 * from ANY feed that publishes schema.org/Event records (JSON-LD). The provider
 * is feed-agnostic: it normalizes the schema.org shape, not a single portal, so
 * the same code can later ingest Visit Sweden (CC-BY 4.0, covers Skåne/Österlen),
 * a municipal open calendar, or any other schema.org Event feed by configuration.
 *
 * What this is and is NOT:
 *   - It emits `time_sensitive_events` only — never legacy live events, Pulse
 *     cards, route candidates, or route stops. The #280 registry bridge
 *     normalizes them through the #279 contract and they stay collect+inspect
 *     until a later gated consumption PR.
 *   - It NEVER fabricates: missing source/coords/timing are passed through so
 *     the #279 normalizer can downgrade confidence / mark stale honestly.
 *   - It is env-gated default-off (like the open-data loader #237/#269 and the
 *     Nominatim resolver #263): no configured endpoint → no provider.
 *   - Fail-soft: a missing fetcher, bad endpoint, non-200, parse error, timeout,
 *     or malformed payload returns [] — it never throws and never breaks Pulse.
 *
 * Live wiring (a real endpoint, e.g. Visit Sweden, which needs an API key) is a
 * deployment concern carried by env; the capability + normalization are proven
 * here against fixtures.
 */

const { GENERIC_PROVIDER_CITY } = require("./provider-registry");
const { buildProviderCollectionOutcome } = require("./provider-collection-outcome");

const SCHEMA_ORG_EVENT_PROVIDER_ID = "generic-schema-org-events";
const DEFAULT_USER_AGENT = "Parranda/1.0 (+https://github.com/fritjofherrstrom-png/parranda)";
const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

function buildDescriptor({ label, sourceUrl, license } = {}) {
  return {
    id: SCHEMA_ORG_EVENT_PROVIDER_ID,
    label: label || "Generic schema.org events",
    city: GENERIC_PROVIDER_CITY,
    role: "official_live_baseline",
    sourceType: "official_open_data",
    sourceUrl: sourceUrl || null,
    // Configuring an endpoint IS the explicit opt-in (resolveDefault* returns
    // null with no endpoint), so the provider runs when wired — no redundant
    // second status gate.
    status: "active",
    intendedUse: "pulse",
    supportedLanguages: ["en", "sv"],
    updateCadence: "daily",
    parsingRisk: "medium",
    trust: {
      source_tier: "official",
      confidence: "medium",
      human_verified: false,
      freshness: "fresh",
    },
    cachePolicy: { kind: "memory", ttlSeconds: 1800 },
    sourceOwnedFields: ["title", "starts_at", "ends_at", "lat", "lng", "source_url", "place_context"],
    parrandaOwnedFields: ["intents", "route_role_hint"],
    // Display-attribution contract (#279/#280 review): carry a user-displayable
    // license so a consumer can show the source honestly later.
    license_label: license || null,
  };
}

/**
 * Factory → provider spec for the source registry. `endpoint` + `fetcher` make
 * it testable without network. Default-off is enforced by resolveDefault* below
 * (no endpoint → no provider).
 */
function createSchemaOrgEventProvider(providerOptions = {}) {
  // The descriptor requires a non-empty http sourceUrl; the feed endpoint IS a
  // valid source URL when no separate display URL is configured.
  const descriptor = buildDescriptor({
    ...providerOptions,
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
          if (!endpoint) return emptyCollection("unavailable", "source_endpoint_unavailable");
          if (typeof fetcher !== "function") return emptyCollection("unavailable", "source_fetch_unavailable");

          const limit = Math.max(1, Math.min(Math.floor(providerOptions.limit || DEFAULT_LIMIT), MAX_LIMIT));
          const userAgent = providerOptions.userAgent || DEFAULT_USER_AGENT;
          const timeoutMs = Math.max(50, Math.floor(providerOptions.timeoutMs || DEFAULT_TIMEOUT_MS));
          const format = normalizeFormat(providerOptions.format || context.format || collectionContext.format);
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), timeoutMs);

          let phase = "fetch";
          let events;
          try {
            const response = await fetcher(endpoint, {
              headers: {
                "User-Agent": userAgent,
                Accept: format === "html"
                  ? "text/html, application/xhtml+xml"
                  : "application/ld+json, application/json",
              },
              signal: controller.signal,
            });
            if (!response || response.ok !== true) {
              return emptyCollection("failed", `source_http_${response?.status || "not_ok"}`);
            }
            phase = "payload";
            if (format === "html") {
              const html = typeof response.text === "function" ? await response.text() : "";
              const parsed = parseSchemaOrgEventsFromHtml(html);
              if (parsed.events.length === 0 && parsed.invalidScriptCount > 0) {
                return emptyCollection("failed", "source_payload_invalid");
              }
              events = parsed.events;
            } else {
              const payload = await response.json();
              events = extractSchemaOrgEvents(payload);
            }
          } catch (error) {
            const reason = error?.name === "AbortError"
              ? "source_timeout"
              : phase === "payload"
                ? "source_payload_invalid"
                : "source_fetch_failed";
            return emptyCollection("failed", reason);
          } finally {
            clearTimeout(timer);
          }

          const normalizedEvents = (Array.isArray(events) ? events : [])
            .slice(0, limit)
            .map(mapSchemaOrgEventToRaw)
            .filter(Boolean);
          return {
            events: [],
            signals: [],
            time_sensitive_events: normalizedEvents,
            collection_status: buildProviderCollectionOutcome(normalizedEvents.length ? "ok" : "empty", {
              reason: normalizedEvents.length ? null : "source_empty",
              eventRows: normalizedEvents.length,
            }),
          };
        },
      };
    },
  };
}

function normalizeFormat(value) {
  return String(value || "json").trim().toLowerCase() === "html" ? "html" : "json";
}

function emptyCollection(status, reason) {
  return {
    events: [],
    signals: [],
    time_sensitive_events: [],
    collection_status: buildProviderCollectionOutcome(status, { reason, eventRows: 0 }),
  };
}

// schema.org JSON-LD comes in several envelopes: a bare object, an array, or a
// `@graph` wrapper. Pull out the records whose @type is (or includes) Event.
function extractSchemaOrgEvents(payload) {
  if (!payload) return [];
  let records = [];
  if (Array.isArray(payload)) records = payload;
  else if (Array.isArray(payload["@graph"])) records = payload["@graph"];
  else if (Array.isArray(payload.items)) records = payload.items; // common feed wrapper
  else if (typeof payload === "object") records = [payload];
  return records.filter((record) => record && typeof record === "object" && isEventType(record));
}

/**
 * Extract factual schema.org/Event atoms from reviewed HTML calendar pages.
 * This deliberately reads JSON-LD only; it does not copy editorial page copy,
 * images, or attempt an unconstrained DOM scrape.
 */
function extractSchemaOrgEventsFromHtml(html) {
  return parseSchemaOrgEventsFromHtml(html).events;
}

function parseSchemaOrgEventsFromHtml(html) {
  const source = typeof html === "string" ? html : "";
  const events = [];
  let scriptCount = 0;
  let validScriptCount = 0;
  let invalidScriptCount = 0;
  const scriptPattern = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
  let match;
  while ((match = scriptPattern.exec(source)) !== null) {
    if (!isJsonLdScript(match[1])) continue;
    scriptCount += 1;
    const body = String(match[2] || "")
      .replace(/^\s*<!--/, "")
      .replace(/-->\s*$/, "")
      .trim();
    if (!body) continue;
    try {
      const payload = JSON.parse(body);
      validScriptCount += 1;
      events.push(...extractSchemaOrgEvents(payload));
    } catch (_error) {
      invalidScriptCount += 1;
      // One malformed JSON-LD block must not hide valid event blocks elsewhere
      // on the same reviewed page. If all JSON-LD is malformed, collect() marks
      // the provider failed instead of falsely reporting a healthy empty source.
    }
  }
  return { events, scriptCount, validScriptCount, invalidScriptCount };
}

function isJsonLdScript(attributes) {
  const match = String(attributes || "").match(/\btype\s*=\s*(?:(["'])(.*?)\1|([^\s>]+))/i);
  const value = String(match?.[2] || match?.[3] || "").trim().toLowerCase();
  return value.split(";")[0].trim() === "application/ld+json";
}

function isEventType(record) {
  const type = record["@type"] || record.type;
  if (typeof type === "string") return /event/i.test(type);
  if (Array.isArray(type)) return type.some((t) => typeof t === "string" && /event/i.test(t));
  return false;
}

// Map a schema.org/Event record to the raw shape the #280 bridge feeds into
// normalizeTimeSensitiveSourceEvent. Source label/url are filled from the
// descriptor by the bridge when absent; we still pass through the event's own
// url so a per-event link survives. Pure — exported for tests.
function mapSchemaOrgEventToRaw(event) {
  if (!event || typeof event !== "object") return null;
  const coords = extractCoordinates(event);
  const url = firstString(event.url, event["@id"], event.identifier);
  return compact({
    id: firstString(event["@id"], event.identifier, event.url),
    title: localizedString(event.name),
    starts_at: firstString(event.startDate, event.start_date, event["schema:startDate"]),
    ends_at: firstString(event.endDate, event.end_date, event["schema:endDate"]),
    source_url: url,
    place_context: localizedString(event.location && event.location.name),
    area: localizedString(event.location && event.location.address && event.location.address.addressLocality),
    lat: coords.lat,
    lng: coords.lng,
    tags: stringList(event.keywords),
    // event_status maps schema.org EventCancelled → freshness signal the
    // normalizer reads; never claim "now" for a cancelled event.
    freshness: isCancelled(event) ? "stale" : null,
  });
}

function extractCoordinates(event) {
  const geo = (event.geo || (event.location && event.location.geo)) || null;
  if (geo && typeof geo === "object") {
    const lat = toFinite(geo.latitude ?? geo.lat);
    const lng = toFinite(geo.longitude ?? geo.lng ?? geo.lon);
    if (lat != null && lng != null) return { lat, lng };
  }
  return { lat: null, lng: null };
}

function isCancelled(event) {
  const status = firstString(event.eventStatus, event["schema:eventStatus"]);
  return typeof status === "string" && /cancel/i.test(status);
}

// schema.org name can be a plain string or a language map / array of language
// objects. Prefer a plain string; otherwise take the first usable value.
function localizedString(value) {
  if (typeof value === "string") return value.trim() || null;
  if (Array.isArray(value)) {
    for (const entry of value) {
      const s = localizedString(entry);
      if (s) return s;
    }
    return null;
  }
  if (value && typeof value === "object") {
    if (typeof value["@value"] === "string") return value["@value"].trim() || null;
    for (const key of Object.keys(value)) {
      const s = localizedString(value[key]);
      if (s) return s;
    }
  }
  return null;
}

function firstString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function stringList(value) {
  if (Array.isArray(value)) return value.map((v) => (typeof v === "string" ? v.trim() : "")).filter(Boolean);
  if (typeof value === "string" && value.trim()) return value.split(",").map((v) => v.trim()).filter(Boolean);
  return [];
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
 * Read PARRANDA_SCHEMA_ORG_EVENT_SOURCE from the env at call time. Returns null
 * when no endpoint is configured, so a default deploy has NO event provider —
 * production opts in explicitly (mirrors resolveDefaultOpenDataLoader).
 */
function resolveDefaultSchemaOrgEventProvider(env = process.env) {
  const endpoint = String(env?.PARRANDA_SCHEMA_ORG_EVENT_SOURCE || "").trim();
  if (!endpoint) return null;
  return createSchemaOrgEventProvider({
    endpoint,
    label: firstString(env?.PARRANDA_SCHEMA_ORG_EVENT_LABEL) || undefined,
    sourceUrl: firstString(env?.PARRANDA_SCHEMA_ORG_EVENT_SOURCE_URL) || undefined,
    license: firstString(env?.PARRANDA_SCHEMA_ORG_EVENT_LICENSE) || undefined,
  });
}

module.exports = {
  SCHEMA_ORG_EVENT_PROVIDER_ID,
  DEFAULT_USER_AGENT,
  createSchemaOrgEventProvider,
  resolveDefaultSchemaOrgEventProvider,
  // exported for tests / introspection
  extractSchemaOrgEvents,
  extractSchemaOrgEventsFromHtml,
  mapSchemaOrgEventToRaw,
};
