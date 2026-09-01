"use strict";

const { createHash } = require("node:crypto");

const MAP_LINKED_PLACE_ADAPTER = "map_linked_place_html";
const MAX_CARD_BLOCKS = 200;
const MAX_CARD_BYTES = 64 * 1024;
const MAX_RECORDS = 100;

// Deliberately exact and closed. Category prose is not classification
// evidence; only a bounded label the publisher presents as the card's type is.
const PLACE_CATEGORY_MAP = Object.freeze({
  museum: "museum",
  museums: "museum",
  "art gallery": "gallery",
  "art galleries": "gallery",
  gallery: "gallery",
  galleries: "gallery",
  park: "park",
  parks: "park",
  "parks and nature": "park",
  "nature reserve": "park",
  "nature reserves": "park",
  garden: "garden",
  gardens: "garden",
  "botanical garden": "garden",
  "botanical gardens": "garden",
  restaurant: "restaurant",
  restaurants: "restaurant",
  cafe: "cafe",
  cafes: "cafe",
  bar: "bar",
  bars: "bar",
  beach: "beach",
  beaches: "beach",
  sight: "landmark",
  sights: "landmark",
  attraction: "landmark",
  attractions: "landmark",
  landmark: "landmark",
  landmarks: "landmark",
});

function extractMapLinkedPlaceRecords(html, feed = {}) {
  const endpoint = safeHttpsUrl(feed.endpoint);
  if (!endpoint) return [];
  const source = stripExecutableMarkup(String(html || ""));
  const blocks = extractCardBlocks(source);
  const records = [];
  const seen = new Set();
  for (const block of blocks) {
    const atom = placeAtomFromCard(block, endpoint);
    if (!atom || seen.has(atom.identityUrl)) continue;
    seen.add(atom.identityUrl);
    const record = mapAtomToRecord(atom, feed);
    if (record) records.push(record);
    if (records.length >= boundedInteger(feed.max_items ?? MAX_RECORDS, 1, MAX_RECORDS)) break;
  }
  return records;
}

function inspectMapLinkedPlacePayload(raw, {
  bbox,
  endpoint = "https://discovery.invalid/places",
  sourceId = "discovery-probe",
  maxItems = MAX_RECORDS,
} = {}) {
  const feed = {
    id: boundedString(sourceId, 120) || "discovery-probe",
    label: "Discovery probe",
    endpoint,
    evidence_family: "official",
    source_tier: "official",
    max_items: boundedInteger(maxItems, 1, MAX_RECORDS),
  };
  const records = extractMapLinkedPlaceRecords(raw, feed)
    .filter((record) => pointInBounds(record, bbox));
  return {
    status: records.length ? "ok" : "empty",
    accepted_place_count: records.length,
    distinct_place_type_count: new Set(records.map((record) => record.type)).size,
  };
}

function placeAtomFromCard(block, endpoint) {
  if (!block || Buffer.byteLength(block, "utf8") > MAX_CARD_BYTES) return null;
  const heading = extractHeadingIdentity(block, endpoint);
  const type = extractClosedCategory(block);
  const coords = extractPublishedMapCoordinates(block, endpoint);
  if (!heading || !type || !coords) return null;
  return {
    identityUrl: heading.url,
    name: heading.name,
    type,
    lat: coords.lat,
    lng: coords.lng,
  };
}

function extractCardBlocks(html) {
  const blocks = [];
  for (const tag of ["li", "section"]) {
    const pattern = new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}\\s*>`, "gi");
    let match;
    while ((match = pattern.exec(html)) !== null && blocks.length < MAX_CARD_BLOCKS) {
      const block = match[0];
      if (
        Buffer.byteLength(block, "utf8") <= MAX_CARD_BYTES &&
        /(?:google\.[a-z]|openstreetmap\.org|maps\.apple\.com)/i.test(block)
      ) blocks.push(block);
    }
    if (blocks.length >= MAX_CARD_BLOCKS) break;
  }
  return blocks;
}

function extractHeadingIdentity(block, endpoint) {
  const headings = /<h[2-4]\b[^>]*>([\s\S]*?)<\/h[2-4]\s*>/gi;
  let match;
  while ((match = headings.exec(block)) !== null) {
    const name = boundedString(visibleText(match[1]), 160);
    if (!name) continue;
    const links = extractAnchorUrls(match[1], endpoint);
    const url = links.find((item) => item && new URL(item).origin === new URL(endpoint).origin);
    if (url) return { name, url };
  }
  return null;
}

function extractClosedCategory(block) {
  const starts = /<(p|span|div)\b([^>]*)>/gi;
  let match;
  while ((match = starts.exec(block)) !== null) {
    const tag = match[1].toLowerCase();
    const attributes = match[2];
    const className = normalizePhrase(attributeValue(attributes, "class"));
    if (!/(?:^| )(?:category|poi category|place type|poi type|type label)(?: |$)/.test(className)) {
      const dataType = firstString(
        attributeValue(attributes, "data-category"),
        attributeValue(attributes, "data-place-type"),
      );
      const mapped = PLACE_CATEGORY_MAP[normalizePhrase(dataType)];
      if (mapped) return mapped;
      continue;
    }
    const closeAt = block.toLowerCase().indexOf(`</${tag}`, starts.lastIndex);
    if (closeAt < 0) continue;
    const mapped = PLACE_CATEGORY_MAP[normalizePhrase(visibleText(
      block.slice(starts.lastIndex, closeAt),
    ))];
    if (mapped) return mapped;
  }
  return null;
}

function extractPublishedMapCoordinates(block, endpoint) {
  for (const url of extractAnchorUrls(block, endpoint)) {
    const parsed = coordinateMapUrl(url);
    if (parsed) return parsed;
  }
  return null;
}

function coordinateMapUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch (_error) {
    return null;
  }
  const host = url.hostname.toLowerCase();
  if (isGoogleMapHost(host)) {
    for (const value of [
      url.searchParams.get("loc"),
      url.searchParams.get("ll"),
      url.searchParams.get("q"),
      url.pathname,
    ]) {
      const pair = coordinatePair(value);
      if (pair) return pair;
    }
    return null;
  }
  if (["openstreetmap.org", "www.openstreetmap.org"].includes(host)) {
    return coordinateValues(url.searchParams.get("mlat"), url.searchParams.get("mlon"));
  }
  if (host === "maps.apple.com") {
    return coordinatePair(url.searchParams.get("ll"));
  }
  return null;
}

function isGoogleMapHost(host) {
  return /^(?:www|maps)\.google\.(?:com|[a-z]{2,3}|co\.[a-z]{2}|com\.[a-z]{2})$/.test(host);
}

function coordinatePair(value) {
  const match = String(value || "").match(
    /(-?\d{1,3}(?:\.\d{3,}))[^\d.-]+(-?\d{1,3}(?:\.\d{3,}))/, 
  );
  return match ? coordinateValues(match[1], match[2]) : null;
}

function coordinateValues(latValue, lngValue) {
  if (
    !/^-?\d{1,3}\.\d{3,}$/.test(String(latValue || "")) ||
    !/^-?\d{1,3}\.\d{3,}$/.test(String(lngValue || ""))
  ) return null;
  const lat = Number(latValue);
  const lng = Number(lngValue);
  return Number.isFinite(lat) && Number.isFinite(lng) &&
    lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180
    ? { lat, lng }
    : null;
}

function mapAtomToRecord(atom, feed) {
  const id = boundedString(feed.id, 120);
  const label = boundedString(feed.label, 160);
  if (!id || !label || !atom) return null;
  const digest = createHash("sha256")
    .update(`${id}|${atom.identityUrl}`)
    .digest("hex")
    .slice(0, 20);
  return compact({
    id: `reviewed-place:${id}:${digest}`,
    name: atom.name,
    type: atom.type,
    lat: atom.lat,
    lng: atom.lng,
    website: atom.identityUrl,
    freshness: "fresh",
    operator_reviewed_source: true,
    source_policy: "reviewed_profile_bounded_refresh",
    sources: [{
      provider: id,
      label,
      family: feed.evidence_family,
      tier: feed.source_tier,
      url: atom.identityUrl,
      license: feed.license || undefined,
      freshness: "fresh",
    }],
  });
}

function extractAnchorUrls(html, endpoint) {
  const urls = [];
  const anchors = /<a\b([^>]*)>/gi;
  let match;
  while ((match = anchors.exec(html)) !== null) {
    const url = safeHttpsUrl(attributeValue(match[1], "href"), endpoint);
    if (url) urls.push(url);
  }
  return urls;
}

function attributeValue(attributes, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`\\b${escaped}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i");
  const match = String(attributes || "").match(pattern);
  return decodeHtml(firstString(match?.[1], match?.[2], match?.[3]));
}

function safeHttpsUrl(value, base) {
  try {
    const url = new URL(decodeHtml(firstString(value)), base);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    url.hash = "";
    return url.toString();
  } catch (_error) {
    return null;
  }
}

function pointInBounds(point, bbox) {
  const values = Array.isArray(bbox) ? bbox.map(Number) : [];
  if (values.length !== 4 || !values.every(Number.isFinite)) return false;
  const [west, south, east, north] = values;
  return west <= east && south <= north &&
    point.lng >= west && point.lng <= east && point.lat >= south && point.lat <= north;
}

function stripExecutableMarkup(value) {
  return value
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|template|noscript)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ");
}

function visibleText(value) {
  return decodeHtml(String(value || "").replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function decodeHtml(value) {
  return String(value || "")
    .replace(/&#(\d+);/g, (_all, digits) => safeCodePoint(Number(digits)))
    .replace(/&#x([a-f0-9]+);/gi, (_all, digits) => safeCodePoint(Number.parseInt(digits, 16)))
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;|&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function safeCodePoint(value) {
  try {
    return Number.isInteger(value) && value >= 0 && value <= 0x10ffff
      ? String.fromCodePoint(value)
      : "";
  } catch (_error) {
    return "";
  }
}

function normalizePhrase(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function boundedString(value, max) {
  const text = typeof value === "string" ? value.trim() : "";
  return text && text.length <= max ? text : null;
}

function boundedInteger(value, min, max) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, Math.floor(number))) : min;
}

function firstString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function compact(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item != null));
}

module.exports = {
  MAP_LINKED_PLACE_ADAPTER,
  PLACE_CATEGORY_MAP,
  coordinateMapUrl,
  extractMapLinkedPlaceRecords,
  inspectMapLinkedPlacePayload,
};
