"use strict";

const { createHash } = require("node:crypto");
const { isIP } = require("node:net");
const dns = require("node:dns").promises;
const https = require("node:https");
const { Readable } = require("node:stream");
const ipaddr = require("ipaddr.js");
const { listFacts, detailFacts } = require("./simpleview-place-html");

const SIMPLEVIEW_EUROPE_PLACE_ADAPTER = "simpleview_europe_product_detail_html";
const SIMPLEVIEW_EUROPE_PLACE_CONTRACT = "simpleview-europe-product-detail-html-v2";
const DEFAULT_USER_AGENT = "Parranda/1.0 (+https://github.com/fritjofherrstrom-png/parranda)";
const MAX_DETAILS = 20;
const MAX_REDIRECTS = 3;
const MIN_BODY_BYTES = 1;
const SIMPLEVIEW_EUROPE_PLACE_LIMITS = Object.freeze({
  max_items: MAX_DETAILS,
  max_links: MAX_DETAILS,
  max_details: MAX_DETAILS,
  max_list_bytes: 256 * 1024,
  max_detail_bytes: 64 * 1024,
  max_total_bytes: 1024 * 1024,
  request_timeout_ms: 8_000,
  max_total_ms: 30_000,
});

const CATEGORY_MAP = Object.freeze({
  aquarium: "landmark",
  tower: "landmark",
  museum: "museum",
  "formal garden": "garden",
  garden: "garden",
  zoo: "landmark",
  "animal collection zoo": "landmark",
  "art gallery": "gallery",
  gallery: "gallery",
  restaurant: "restaurant",
  cafe: "cafe",
  "cafe or coffee shop": "cafe",
  "bar or pub": "bar",
  beach: "beach",
});

const DETAIL_SCHEMA_TYPE_MAP = Object.freeze({
  localbusiness: null,
  landmarksorhistoricalbuildings: "landmark",
  touristattraction: "landmark",
  zoo: "landmark",
  museum: "museum",
  artgallery: "gallery",
  park: "park",
  restaurant: "restaurant",
  cafeorcoffeeshop: "cafe",
  barorpub: "bar",
  beach: "beach",
});

function inspectSimpleviewEuropePlaceList(html, { endpoint, termsStatus = "unknown", maxLinks = MAX_DETAILS } = {}) {
  const rows = extractSimpleviewEuropeListItems(html, {
    endpoint,
    max_links: maxLinks,
  });
  return {
    status: rows.length >= 2 ? "ok" : "empty",
    adapter: rows.length >= 2 ? SIMPLEVIEW_EUROPE_PLACE_ADAPTER : null,
    detail_link_count: rows.length,
    distinct_place_type_count: new Set(rows.map((row) => row.type)).size,
    terms_status: normalizeTermsStatus(termsStatus),
  };
}

function extractSimpleviewEuropeListItems(html, feed = {}) {
  const endpoint = canonicalHttpsUrl(feed.endpoint);
  if (!endpoint || new URL(endpoint).search) return [];
  return listFacts(html, {
    endpoint,
    maxBytes: SIMPLEVIEW_EUROPE_PLACE_LIMITS.max_list_bytes,
    maxLinks: clampInteger(feed.max_links, 1, MAX_DETAILS, MAX_DETAILS),
    mapCategory, canonicalDetailUrl, productIdFromUrl,
  });
}

async function collectSimpleviewEuropePlaceFeed(feed, {
  fetcher = pinnedHttpsFetch,
  resolveHost = defaultResolveHost,
  now = () => Date.now(),
  probeOnly = false,
} = {}) {
  const config = validFeed(feed, { probeOnly });
  if (!config || typeof fetcher !== "function" || typeof resolveHost !== "function") return failed();
  const startedAt = Number(now());
  if (!Number.isFinite(startedAt)) return failed();
  const budget = { bytes: 0 };
  try {
    const list = await fetchBounded(config.endpoint, {
      config,
      fetcher,
      resolveHost,
      maxBytes: config.max_list_bytes,
      budget,
      startedAt,
      now,
      urlPolicy: (value) => canonicalHttpsUrl(value) === config.endpoint,
    });
    if (!list) return failed();
    const links = extractSimpleviewEuropeListItems(list.body, config)
      .slice(0, config.max_details);
    if (!links.length) return { status: "empty", records: [] };
    const records = [];
    for (const listItem of links) {
      if (Number(now()) - startedAt > config.max_total_ms) return failed();
      const detail = await fetchBounded(listItem.detail_url, {
        config,
        fetcher,
        resolveHost,
        maxBytes: config.max_detail_bytes,
        budget,
        startedAt,
        now,
        urlPolicy: (value) => canonicalHttpsUrl(value) === listItem.detail_url,
      });
      if (!detail) return failed();
      const finalDetailUrl = canonicalDetailUrl(
        detail.url,
        config.endpoint,
        new URL(config.endpoint).origin,
      );
      if (finalDetailUrl !== listItem.detail_url) return failed();
      const record = extractDetailRecord(detail.body, listItem, config);
      if (record && pointInBounds(record, config.bbox)) records.push(record);
      if (records.length >= config.max_items) break;
    }
    return { status: records.length ? "ok" : "empty", records };
  } catch (_error) {
    return failed();
  }
}

function extractDetailRecord(html, listItem, feed) {
  const facts = detailFacts(html, {
    maxBytes: SIMPLEVIEW_EUROPE_PLACE_LIMITS.max_detail_bytes,
    listItem, schemaTypes: DETAIL_SCHEMA_TYPE_MAP, normalizeText,
    canonicalHttpsUrl, productIdFromUrl,
  });
  if (!facts || mapCategory(listItem.category) !== listItem.type) return null;
  const { name, url: detailUrl, address, lat, lng } = facts;
  const newMind = newMindCoordinates(facts.scripts.join("\n"), listItem.product_id);
  if (newMind && (!Number.isFinite(newMind.lat) || !Number.isFinite(newMind.lng) ||
    Math.abs(newMind.lat - lat) > 0.0001 || Math.abs(newMind.lng - lng) > 0.0001)) return null;

  const digest = createHash("sha256")
    .update(`${feed.id}|${detailUrl}`)
    .digest("hex")
    .slice(0, 20);
  return {
    id: `reviewed-place:${feed.id}:${digest}`,
    name,
    type: listItem.type,
    lat,
    lng,
    website: detailUrl,
    address,
    geometry_source: "publisher_og_coordinates",
    freshness: "fresh",
    operator_reviewed_source: true,
    source_policy: "reviewed_profile_bounded_refresh",
    source_provenance: {
      list_source_id: feed.id,
      list_url: feed.endpoint,
      detail_url: detailUrl,
    },
    sources: [compact({
      provider: feed.id,
      label: feed.label,
      family: feed.evidence_family,
      tier: feed.source_tier,
      url: detailUrl,
      license: feed.license,
      freshness: "fresh",
    })],
  };
}

async function fetchBounded(initialUrl, {
  config,
  fetcher,
  resolveHost,
  maxBytes,
  budget,
  startedAt,
  now,
  urlPolicy,
}) {
  let current = initialUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const byteRemainder = config.max_total_bytes - budget.bytes;
    if (byteRemainder <= 0) return null;
    const elapsedMs = Number(now()) - startedAt;
    const remainingMs = config.max_total_ms - elapsedMs;
    if (!Number.isFinite(remainingMs) || remainingMs <= 0) return null;
    if (typeof urlPolicy !== "function" || !urlPolicy(current)) return null;
    const validatedAddresses = await publicAddressesForUrl(
      current,
      config.endpoint,
      resolveHost,
      Math.min(config.request_timeout_ms, remainingMs),
    );
    if (!validatedAddresses) return null;
    const requestRemainingMs = config.max_total_ms - (Number(now()) - startedAt);
    if (!Number.isFinite(requestRemainingMs) || requestRemainingMs <= 0) return null;
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      Math.max(1, Math.min(config.request_timeout_ms, requestRemainingMs)),
    );
    try {
      const response = await fetcher(current, {
        redirect: "manual",
        signal: controller.signal,
        validatedAddresses,
        headers: { "User-Agent": DEFAULT_USER_AGENT, Accept: "text/html, application/xhtml+xml" },
      });
      if (!response) return null;
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers?.get?.("location");
        await Promise.resolve(response.body?.cancel?.()).catch(() => {});
        if (!location || hop === MAX_REDIRECTS) return null;
        current = new URL(location, current).toString();
        continue;
      }
      if (response.ok !== true || response.status !== 200 ||
        (response.url && canonicalHttpsUrl(response.url) !== canonicalHttpsUrl(current))) {
        await Promise.resolve(response.body?.cancel?.()).catch(() => {});
        return null;
      }
      const mediaType = String(response.headers?.get?.("content-type") || "")
        .split(";")[0]
        .trim()
        .toLowerCase();
      if (!["text/html", "application/xhtml+xml"].includes(mediaType)) {
        await Promise.resolve(response.body?.cancel?.()).catch(() => {});
        return null;
      }
      const body = await readBoundedText(response, Math.min(maxBytes, byteRemainder));
      if (
        !body || controller.signal.aborted ||
        Number(now()) - startedAt > config.max_total_ms
      ) return null;
      const bytes = Buffer.byteLength(body, "utf8");
      budget.bytes += bytes;
      if (budget.bytes > config.max_total_bytes) return null;
      return { body, url: current };
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
}

async function safeFetchUrl(value, approvedEndpoint, resolveHost, timeoutMs = 8_000) {
  return Boolean(await publicAddressesForUrl(value, approvedEndpoint, resolveHost, timeoutMs));
}

async function publicAddressesForUrl(value, approvedEndpoint, resolveHost, timeoutMs) {
  const url = canonicalHttpsUrl(value);
  const approved = canonicalHttpsUrl(approvedEndpoint);
  if (!url || !approved || new URL(url).origin !== new URL(approved).origin) return null;
  const hostname = new URL(url).hostname;
  if (isForbiddenHostname(hostname)) return null;
  let addresses;
  try {
    addresses = await resolveWithin(
      () => resolveHost(hostname, { all: true, verbatim: true }),
      timeoutMs,
    );
  } catch (_error) {
    return null;
  }
  const rows = (Array.isArray(addresses) ? addresses : addresses ? [addresses] : [])
    .map((item) => ({
      address: String(item?.address || item || ""),
      family: Number(item?.family) || isIP(item?.address || item),
    }));
  return rows.length > 0 && rows.every((item) => isPublicAddress(item.address) &&
    item.family === isIP(item.address)) ? rows : null;
}

async function resolveWithin(resolve, timeoutMs) {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(resolve),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("dns_timeout")), Math.max(1, timeoutMs));
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function pinnedHttpsFetch(value, { headers = {}, signal, validatedAddresses = [] } = {}) {
  const lookup = createPinnedLookup(validatedAddresses);
  if (!lookup) return Promise.reject(new Error("validated_address_required"));
  return new Promise((resolve, reject) => {
    const request = https.request(value, {
      method: "GET",
      headers,
      signal,
      agent: false,
      lookup,
    }, (response) => {
      resolve({
        ok: response.statusCode >= 200 && response.statusCode < 300,
        status: response.statusCode || 0,
        url: String(value),
        redirected: false,
        headers: {
          get(name) {
            const header = response.headers[String(name || "").toLowerCase()];
            return Array.isArray(header) ? header.join(", ") : header == null ? null : String(header);
          },
        },
        body: Readable.toWeb(response),
      });
    });
    request.once("error", reject);
    request.end();
  });
}

function createPinnedLookup(validatedAddresses) {
  const rows = (Array.isArray(validatedAddresses) ? validatedAddresses : [])
    .map((item) => ({ address: String(item?.address || ""), family: Number(item?.family) }));
  if (!rows.length || !rows.every((item) => [4, 6].includes(item.family) &&
    item.family === isIP(item.address) && isPublicAddress(item.address))) return null;
  const pinned = rows[0];
  return (_hostname, options, callback) => {
    if (options?.all) callback(null, rows);
    else callback(null, pinned.address, pinned.family);
  };
}

async function defaultResolveHost(hostname, options) {
  return dns.lookup(hostname, options);
}

async function readBoundedText(response, maxBytes) {
  if (!response?.body || typeof response.body.getReader !== "function") return null;
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = value instanceof Uint8Array ? value : new Uint8Array(value || []);
    size += chunk.byteLength;
    if (size > maxBytes) {
      await Promise.resolve(reader.cancel()).catch(() => {});
      return null;
    }
    chunks.push(chunk);
  }
  if (size < MIN_BODY_BYTES) return null;
  const bytes = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes) || null;
}

function validFeed(feed, { probeOnly = false } = {}) {
  if (!feed || feed.adapter !== SIMPLEVIEW_EUROPE_PLACE_ADAPTER || feed.adapter_contract_revision !== SIMPLEVIEW_EUROPE_PLACE_CONTRACT) return null;
  const endpoint = canonicalHttpsUrl(feed.endpoint);
  const bbox = normalizeBounds(feed.bbox);
  if (
    !endpoint || new URL(endpoint).search || !bbox ||
    !["official", "editorial"].includes(feed.evidence_family) ||
    !["open_license", "api_terms_compatible"].includes(feed.terms_status) ||
    (probeOnly
      ? !["", "candidate", "healthy"].includes(String(feed.source_health || ""))
      : feed.source_health !== "healthy") ||
    (probeOnly
      ? feed.runtime_policy !== "review_required"
      : !["active", "bounded_refresh"].includes(feed.runtime_policy)) ||
    normalizedHostname(feed.source_identity) !== normalizedHostname(new URL(endpoint).hostname)
  ) return null;
  return {
    ...feed,
    endpoint,
    bbox,
    max_items: clampInteger(feed.max_items, 1, MAX_DETAILS, SIMPLEVIEW_EUROPE_PLACE_LIMITS.max_items),
    max_links: clampInteger(feed.max_links, 1, MAX_DETAILS, SIMPLEVIEW_EUROPE_PLACE_LIMITS.max_links),
    max_details: clampInteger(feed.max_details, 1, MAX_DETAILS, SIMPLEVIEW_EUROPE_PLACE_LIMITS.max_details),
    max_list_bytes: clampInteger(feed.max_list_bytes, 1024, SIMPLEVIEW_EUROPE_PLACE_LIMITS.max_list_bytes, SIMPLEVIEW_EUROPE_PLACE_LIMITS.max_list_bytes),
    max_detail_bytes: clampInteger(feed.max_detail_bytes, 1024, SIMPLEVIEW_EUROPE_PLACE_LIMITS.max_detail_bytes, SIMPLEVIEW_EUROPE_PLACE_LIMITS.max_detail_bytes),
    max_total_bytes: clampInteger(feed.max_total_bytes, 2048, SIMPLEVIEW_EUROPE_PLACE_LIMITS.max_total_bytes, SIMPLEVIEW_EUROPE_PLACE_LIMITS.max_total_bytes),
    request_timeout_ms: clampInteger(feed.request_timeout_ms, 50, SIMPLEVIEW_EUROPE_PLACE_LIMITS.request_timeout_ms, SIMPLEVIEW_EUROPE_PLACE_LIMITS.request_timeout_ms),
    max_total_ms: clampInteger(feed.max_total_ms, 100, SIMPLEVIEW_EUROPE_PLACE_LIMITS.max_total_ms, SIMPLEVIEW_EUROPE_PLACE_LIMITS.max_total_ms),
  };
}

function normalizedHostname(value) {
  return String(value || "").trim().toLowerCase().replace(/^www\./, "");
}

function canonicalDetailUrl(value, endpoint, origin) {
  try {
    const url = new URL(String(value || ""), endpoint);
    if (url.protocol !== "https:" || url.username || url.password || url.origin !== origin) return null;
    if (/%(?:2f|5c|2e|25)/i.test(url.pathname)) return null;
    if (!url.pathname.startsWith(detailPathPrefix(endpoint))) return null;
    url.hash = "";
    url.search = "";
    if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, "");
    return productIdFromUrl(url.toString()) ? url.toString() : null;
  } catch (_error) {
    return null;
  }
}

function detailPathPrefix(endpoint) {
  try {
    const pathname = new URL(endpoint).pathname;
    const slash = pathname.lastIndexOf("/");
    return `${pathname.slice(0, Math.max(0, slash))}/`.replace(/\/{2,}/g, "/");
  } catch (_error) {
    return "/";
  }
}

function canonicalHttpsUrl(value) {
  try {
    const url = new URL(String(value || ""));
    if (url.protocol !== "https:" || url.username || url.password) return null;
    url.hash = "";
    return url.toString();
  } catch (_error) {
    return null;
  }
}

function productIdFromUrl(value) {
  try {
    const match = new URL(value).pathname.match(/-p(\d+)\/?$/i);
    return match?.[1] || null;
  } catch (_error) {
    return null;
  }
}



function newMindCoordinates(source, productId) {
  const escaped = String(productId).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`ProductDetails\\.Location[^{};\\n]{0,200}?\\[\\s*["']${escaped}["']\\s*\\]\\s*=`, "gi");
  const matches = [...source.matchAll(pattern)];
  if (!matches.length) return null;
  let result;
  for (const match of matches) {
    const body = source.slice(match.index + match[0].length).match(/^\s*\{([^{}]{0,1000})\}/)?.[1];
    if (!body) return { lat: NaN, lng: NaN };
    const coordinate = (key) => {
      const values = [...body.matchAll(new RegExp(`\\b${key}\\s*:\\s*(-?\\d+(?:\\.\\d+)?)(?=\\s*[,}]|\\s*$)`, "gi"))];
      return values.length === 1 ? Number(values[0][1]) : NaN;
    };
    const lat = coordinate("Latitude"), lng = coordinate("Longitude");
    if (!Number.isFinite(lat) || !Number.isFinite(lng) ||
      (result && (Math.abs(result.lat - lat) > 0.0001 || Math.abs(result.lng - lng) > 0.0001))) {
      return { lat: NaN, lng: NaN };
    }
    result = { lat, lng };
  }
  return result;
}



function mapCategory(value) {
  return CATEGORY_MAP[normalizeText(value)] || null;
}

function normalizeText(value) {
  return String(value || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function boundedText(value, max) {
  const text = typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
  return text && text.length <= max ? text : null;
}

function normalizeTermsStatus(value) {
  return ["open_license", "api_terms_compatible", "permission_required", "restricted"].includes(value) ? value : "unknown";
}

function normalizeBounds(value) {
  const values = Array.isArray(value) ? value.map(Number) : [];
  if (values.length !== 4 || !values.every(Number.isFinite)) return null;
  const [west, south, east, north] = values;
  return west <= east && south <= north && west >= -180 && east <= 180 && south >= -90 && north <= 90 ? values : null;
}

function pointInBounds(point, bbox) {
  return point.lng >= bbox[0] && point.lng <= bbox[2] && point.lat >= bbox[1] && point.lat <= bbox[3];
}

function isForbiddenHostname(hostname) {
  const host = String(hostname || "").toLowerCase().replace(/^\[|\]$/g, "");
  return !host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host === "0.0.0.0";
}

function isPublicAddress(value) {
  const address = String(value || "").replace(/^\[|\]$/g, "");
  if (!isIP(address)) return false;
  try {
    const parsed = ipaddr.parse(address);
    // range() normalizes compressed/expanded IPv6 before checking. Mapped,
    // link-local, special-use and transition ranges are not public targets.
    return parsed.range() === "unicast";
  } catch (_error) {
    return false;
  }
}

function clampInteger(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, Math.floor(number))) : fallback;
}

function compact(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item != null && item !== ""));
}

function failed() {
  return { status: "failed", records: [] };
}

module.exports = {
  CATEGORY_MAP,
  MAX_DETAILS,
  SIMPLEVIEW_EUROPE_PLACE_ADAPTER,
  SIMPLEVIEW_EUROPE_PLACE_CONTRACT,
  SIMPLEVIEW_EUROPE_PLACE_LIMITS,
  collectSimpleviewEuropePlaceFeed,
  createPinnedLookup,
  extractDetailRecord,
  extractSimpleviewEuropeListItems,
  inspectSimpleviewEuropePlaceList,
  isPublicAddress,
  safeFetchUrl,
};
