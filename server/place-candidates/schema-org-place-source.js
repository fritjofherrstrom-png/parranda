"use strict";

const { createHash } = require("node:crypto");
const { createSourceCache } = require("./source-cache");
const {
  resolveReviewedPlaceSourceProfileFeeds,
} = require("./reviewed-place-source-profile");
const {
  MAP_LINKED_PLACE_ADAPTER,
  PLACE_CATEGORY_MAP,
  extractMapLinkedPlaceRecords,
} = require("./map-linked-html-place-source");

const ENABLE_ENV_KEY = "PARRANDA_REVIEWED_PLACE_SOURCES";
const DEFAULT_TIMEOUT_MS = 8_000;
const DEFAULT_MAX_BYTES = 1024 * 1024;
const DEFAULT_RADIUS_KM = 5;
const DEFAULT_USER_AGENT = "Parranda/1.0 (+https://github.com/fritjofherrstrom-png/parranda)";
const MAX_JSON_LD_NODES = 500;
const MAX_RUNTIME_RECORDS = 100;
const EXPERIENCE_CARD_PLACE_LIST_DETAIL_ADAPTER = "experience_card_place_list_detail_html";
const MAX_LIST_DETAIL_LINKS = 12;
const MAX_EXPERIENCE_CARD_BLOCKS = 200;
const DEFAULT_LIST_DETAIL_MAX_BYTES = 4 * 1024 * 1024;

// Deliberately closed: generic Organization/LocalBusiness/Product records are
// not place ideas. Every accepted schema type has an existing Parranda type.
const PLACE_TYPE_MAP = Object.freeze({
  museum: "museum",
  artgallery: "gallery",
  park: "park",
  garden: "garden",
  botanicalgarden: "garden",
  restaurant: "restaurant",
  foodestablishment: "restaurant",
  cafeorcoffeeshop: "cafe",
  barorpub: "bar",
  beach: "beach",
  touristattraction: "landmark",
  landmarksorhistoricalbuildings: "landmark",
});

function createReviewedPlaceSource({
  sourceCatalog = null,
  env = process.env,
  fetcher = typeof globalThis.fetch === "function" ? globalThis.fetch.bind(globalThis) : null,
  cache = createSourceCache({
    namespace: "reviewed-place-sources-v1",
    dir: env?.PARRANDA_CACHE_DIR || null,
    ttlMs: positiveInteger(env?.PARRANDA_SOURCE_CACHE_TTL_MS) || undefined,
  }),
  now = () => new Date(),
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxBytes = DEFAULT_MAX_BYTES,
} = {}) {
  const persistentCatalog = typeof sourceCatalog?.listFreshApprovedPlaceCandidatesForAnchor === "function";
  if (typeof fetcher !== "function" && !persistentCatalog) return null;

  return {
    async load(anchor = {}) {
      if (!validAnchor(anchor)) return [];
      const at = normalizeDate(now());
      if (!at) return [];
      // Catalog-backed profiles are worker-owned. The request path consumes
      // only the fresh, revision-bound persistent reservoir and never performs
      // a source fetch merely because a user opened Planner.
      const persistentRecords = persistentCatalog
        ? await Promise.resolve(
          sourceCatalog.listFreshApprovedPlaceCandidatesForAnchor({ anchor, now: at }),
        ).catch(() => [])
        : [];
      const records = Array.isArray(persistentRecords) ? [...persistentRecords] : [];
      const direct = resolveReviewedPlaceSourceProfileFeeds(env, { now: at });
      // Older injected catalog implementations may still expose only approved
      // feeds. The real Postgres catalog always takes the persistent branch;
      // never source-fetch its approved rows on a Planner request.
      const catalogFeeds = !persistentCatalog && typeof sourceCatalog?.listApprovedPlaceFeedsForAnchor === "function"
        ? await Promise.resolve(sourceCatalog.listApprovedPlaceFeedsForAnchor({ anchor, now: at })).catch(() => [])
        : [];
      const feeds = dedupeFeeds([...direct, ...(Array.isArray(catalogFeeds) ? catalogFeeds : [])]);
      for (const feed of feeds) {
        if (records.length >= MAX_RUNTIME_RECORDS) break;
        if (typeof fetcher !== "function") break;
        // List -> detail traversal is worker-owned. Unlike the legacy direct
        // profile bridge, it must never fan out because a Planner request
        // happened to miss an in-process cache entry.
        if (feed.adapter === EXPERIENCE_CARD_PLACE_LIST_DETAIL_ADAPTER) continue;
        const key = cacheKey(feed);
        const cached = cache.peek(key);
        if (cached && Array.isArray(cached.records)) {
          const perFeed = filterRecordsForAnchor(cached.records, anchor, feed.bbox)
            .slice(0, boundedInteger(feed.max_items, 1, 100));
          records.push(...perFeed.slice(0, MAX_RUNTIME_RECORDS - records.length));
          continue;
        }
        cache.warm(
          key,
          () => collectReviewedPlaceFeedOutcome(feed, { fetcher, timeoutMs, maxBytes }),
          { shouldStore: (value) => value?.status === "ok" || value?.status === "empty" },
        );
      }
      return records;
    },
  };
}

function resolveDefaultReviewedPlaceSource(env = process.env, options = {}) {
  if (!enabled(env?.[ENABLE_ENV_KEY])) return null;
  const direct = String(env?.PARRANDA_REVIEWED_PLACE_SOURCE_PROFILES || "").trim();
  if (!direct && !options.sourceCatalog) return null;
  return createReviewedPlaceSource({ env, ...options });
}

async function collectReviewedPlaceFeed(feed, options = {}) {
  const outcome = await collectReviewedPlaceFeedOutcome(feed, options);
  return outcome.records;
}

async function collectReviewedPlaceFeedOutcome(feed, options = {}) {
  const fetcher = options.fetcher === undefined
    ? (typeof globalThis.fetch === "function" ? globalThis.fetch.bind(globalThis) : null)
    : options.fetcher;
  const timeoutMs = options.timeoutMs === undefined ? DEFAULT_TIMEOUT_MS : options.timeoutMs;
  const maxBytes = options.maxBytes === undefined
    ? feed?.adapter === EXPERIENCE_CARD_PLACE_LIST_DETAIL_ADAPTER
      ? DEFAULT_LIST_DETAIL_MAX_BYTES
      : DEFAULT_MAX_BYTES
    : options.maxBytes;
  const probeOnly = options.probeOnly === true;
  const valid = probeOnly ? validProbeFeed(feed) : validFeed(feed);
  if (!valid || typeof fetcher !== "function") return failed();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), boundedInteger(timeoutMs, 50, 30_000));
  try {
    const byteBudget = boundedInteger(maxBytes, 1024, 4 * 1024 * 1024);
    if (feed.adapter === EXPERIENCE_CARD_PLACE_LIST_DETAIL_ADAPTER) {
      return collectExperienceCardListDetailOutcome(feed, {
        fetcher,
        controller,
        byteBudget,
      });
    }
    const document = await fetchReviewedDocument(feed.endpoint, {
      fetcher,
      controller,
      maxBytes: byteBudget,
      accept: feed.adapter === "schema_org_place_json"
        ? "application/ld+json, application/json"
        : "text/html, application/xhtml+xml",
    });
    if (!document) return failed();
    const raw = document.raw;

    let records;
    if (feed.adapter === MAP_LINKED_PLACE_ADAPTER) {
      records = extractMapLinkedPlaceRecords(raw, feed);
    } else {
      let nodes;
      if (feed.adapter === "schema_org_place_json") {
        try {
          nodes = extractSchemaOrgPlaces(JSON.parse(raw));
        } catch (_error) {
          return failed();
        }
      } else {
        const parsed = parseSchemaOrgPlacesFromHtml(raw);
        if (!parsed.validScriptCount && parsed.invalidScriptCount) return failed();
        nodes = parsed.places;
      }
      records = nodes
        .map((place) => mapSchemaOrgPlaceToRecord(place, feed))
        .filter(Boolean);
    }
    records = records
      .filter((record) => pointInBounds(record, feed.bbox))
      .slice(0, boundedInteger(feed.max_items ?? MAX_RUNTIME_RECORDS, 1, 100));
    return { status: records.length ? "ok" : "empty", records };
  } catch (_error) {
    return failed();
  } finally {
    clearTimeout(timer);
  }
}

async function collectExperienceCardListDetailOutcome(feed, {
  fetcher,
  controller,
  byteBudget,
} = {}) {
  const listDocument = await fetchReviewedDocument(feed.endpoint, {
    fetcher,
    controller,
    maxBytes: byteBudget,
    accept: "text/html, application/xhtml+xml",
    requireExactUrl: true,
  });
  if (!listDocument || !isHtmlResponse(listDocument.response)) return failed();
  let remainingBytes = byteBudget - Buffer.byteLength(listDocument.raw, "utf8");
  const maxItems = Math.min(
    MAX_LIST_DETAIL_LINKS,
    boundedInteger(feed.max_items ?? MAX_LIST_DETAIL_LINKS, 1, MAX_LIST_DETAIL_LINKS),
  );
  const inspected = inspectExperienceCardPlaceListDetailPayload(listDocument.raw, {
    endpoint: feed.endpoint,
    maxLinks: maxItems,
  });
  if (inspected.status !== "ok") return failed();

  const records = [];
  const seen = new Set();
  let validDetailDocumentCount = 0;
  for (const pointer of inspected.detail_pointers) {
    if (records.length >= maxItems || remainingBytes < 1) break;
    const detailDocument = await fetchReviewedDocument(pointer.url, {
      fetcher,
      controller,
      maxBytes: remainingBytes,
      accept: "text/html, application/xhtml+xml",
      approvedOrigin: new URL(feed.endpoint).origin,
      requireExactUrl: true,
    });
    if (!detailDocument || !isHtmlResponse(detailDocument.response)) continue;
    validDetailDocumentCount += 1;
    remainingBytes -= Buffer.byteLength(detailDocument.raw, "utf8");
    const record = recordFromExactExperienceCardDetail(detailDocument.raw, pointer, feed);
    if (!record || !pointInBounds(record, feed.bbox) || seen.has(record.id)) continue;
    seen.add(record.id);
    records.push(record);
  }
  if (!validDetailDocumentCount) return failed();
  return { status: records.length ? "ok" : "empty", records };
}

async function fetchReviewedDocument(url, {
  fetcher,
  controller,
  maxBytes,
  accept,
  approvedOrigin = null,
  requireExactUrl = false,
} = {}) {
  const target = safeHttpsUrl(url);
  if (!target || typeof fetcher !== "function" || !controller || maxBytes < 1) return null;
  if (approvedOrigin && new URL(target).origin !== approvedOrigin) return null;
  const response = await fetcher(target, {
    headers: {
      "User-Agent": DEFAULT_USER_AGENT,
      Accept: accept,
    },
    // Each URL is exact. Do not let a reviewed fetch expand to an unreviewed
    // host or path through an HTTP redirect.
    redirect: "error",
    signal: controller.signal,
  });
  if (
    !response ||
    response.ok !== true ||
    !sameOriginResponse(target, response) ||
    (requireExactUrl && !exactUrlResponse(target, response))
  ) return null;
  const raw = await readBoundedText(response, maxBytes);
  return raw ? { raw, response } : null;
}

/**
 * Probe an unapproved discovery candidate through the exact same bounded
 * parser and network boundary as reviewed runtime sources. Only compact
 * counts leave this function: discovered place rows are never returned to the
 * scout, candidate reservoir, or request path.
 */
async function probeReviewedPlaceFeed(feed, options = {}) {
  const outcome = await collectReviewedPlaceFeedOutcome(feed, {
    ...options,
    probeOnly: true,
  });
  const records = Array.isArray(outcome.records) ? outcome.records : [];
  return {
    status: outcome.status,
    accepted_place_count: records.length,
    distinct_place_type_count: new Set(records.map((record) => record.type)).size,
  };
}

const probeSchemaOrgPlaceFeed = probeReviewedPlaceFeed;

/**
 * Inspect an already-fetched page without retaining its place rows. This is
 * used by background discovery to decide whether a page is a genuine
 * structured place list rather than an individual venue page.
 */
function inspectSchemaOrgPlacePayload(raw, {
  adapter = "schema_org_place_html",
  bbox,
  sourceId = "discovery-probe",
  maxItems = 100,
} = {}) {
  if (!["schema_org_place_html", "schema_org_place_json"].includes(adapter)) {
    return { status: "failed", accepted_place_count: 0, distinct_place_type_count: 0 };
  }
  let nodes;
  if (adapter === "schema_org_place_json") {
    try {
      nodes = extractSchemaOrgPlaces(JSON.parse(String(raw || "")));
    } catch (_error) {
      return { status: "failed", accepted_place_count: 0, distinct_place_type_count: 0 };
    }
  } else {
    const parsed = parseSchemaOrgPlacesFromHtml(raw);
    if (!parsed.validScriptCount && parsed.invalidScriptCount) {
      return { status: "failed", accepted_place_count: 0, distinct_place_type_count: 0 };
    }
    nodes = parsed.places;
  }
  const feed = {
    id: boundedString(sourceId, 120) || "discovery-probe",
    label: "Discovery probe",
    endpoint: "https://discovery.invalid/places",
    evidence_family: "official",
    source_tier: "official",
  };
  const seen = new Set();
  const records = [];
  for (const node of nodes) {
    const record = mapSchemaOrgPlaceToRecord(node, feed);
    if (!record || !pointInBounds(record, bbox) || seen.has(record.id)) continue;
    seen.add(record.id);
    records.push(record);
    if (records.length >= boundedInteger(maxItems, 1, 100)) break;
  }
  return {
    status: records.length ? "ok" : "empty",
    accepted_place_count: records.length,
    distinct_place_type_count: new Set(records.map((record) => record.type)).size,
  };
}

function inspectExperienceCardPlaceListDetailPayload(raw, {
  endpoint,
  maxLinks = MAX_LIST_DETAIL_LINKS,
} = {}) {
  const sourceUrl = safeHttpsUrl(endpoint);
  if (!sourceUrl) return emptyListDetailInspection("invalid_endpoint");
  const detailPointers = extractExperienceCardDetailPointers(raw, {
    endpoint: sourceUrl,
    maxLinks,
  });
  if (detailPointers.length < 2) {
    return emptyListDetailInspection("bounded_experience_card_list_not_detected");
  }
  return {
    status: "ok",
    detail_link_count: detailPointers.length,
    detail_pointers: detailPointers,
  };
}

function extractExperienceCardDetailPointers(raw, {
  endpoint,
  maxLinks = MAX_LIST_DETAIL_LINKS,
} = {}) {
  const sourceUrl = safeHttpsUrl(endpoint);
  if (!sourceUrl) return [];
  const sourceOrigin = new URL(sourceUrl).origin;
  const blocks = extractExperienceCardBlocks(stripExecutableMarkup(String(raw || "")));
  const found = [];
  const seen = new Set();
  const limit = Math.min(MAX_LIST_DETAIL_LINKS, boundedInteger(maxLinks, 1, MAX_LIST_DETAIL_LINKS));
  for (const block of blocks) {
    const pointer = experienceCardPointer(block, sourceUrl, sourceOrigin);
    if (!pointer || seen.has(pointer.url)) continue;
    seen.add(pointer.url);
    found.push(pointer);
    if (found.length >= limit) break;
  }
  return found;
}

function recordFromExactExperienceCardDetail(raw, pointer, feed) {
  const exactUrl = safeHttpsUrl(pointer?.url);
  if (!exactUrl) return null;
  const source = stripExecutableMarkup(String(raw || ""));
  const canonicalUrls = extractCanonicalUrls(source, exactUrl);
  const heroNames = extractClassTexts(source, "postHerosection__heroHeading", "h1");
  const contentNames = extractClassTexts(source, "experience-title", "h2");
  const types = extractExperienceDetailTypes(source);
  const coordinates = extractExperienceDetailCoordinates(source);
  if (
    canonicalUrls.length !== 1 || canonicalUrls[0] !== exactUrl ||
    heroNames.length !== 1 || contentNames.length !== 1 ||
    normalizePhrase(heroNames[0]) !== normalizePhrase(pointer.name) ||
    normalizePhrase(contentNames[0]) !== normalizePhrase(pointer.name) ||
    types.length !== 1 || types[0] !== pointer.type ||
    coordinates.length !== 1
  ) return null;
  return mapPlaceAtomToRecord({
    stableIdentity: exactUrl,
    name: heroNames[0],
    type: pointer.type,
    ...coordinates[0],
  }, feed);
}

function emptyListDetailInspection(reason) {
  return { status: "empty", detail_link_count: 0, detail_pointers: [], reason };
}

function extractSchemaOrgPlaces(payload) {
  const queue = [payload];
  const places = [];
  let visited = 0;
  while (queue.length && visited < MAX_JSON_LD_NODES) {
    const value = queue.shift();
    visited += 1;
    if (Array.isArray(value)) {
      queue.push(...value.slice(0, MAX_JSON_LD_NODES - visited));
      continue;
    }
    if (!value || typeof value !== "object") continue;
    if (placeType(value)) places.push(value);
    for (const key of ["@graph", "items", "itemListElement"]) {
      if (Array.isArray(value[key])) {
        queue.push(...value[key].slice(0, Math.max(0, MAX_JSON_LD_NODES - visited - queue.length)));
      }
    }
    if (value.item && typeof value.item === "object") queue.push(value.item);
  }
  return places.slice(0, MAX_JSON_LD_NODES);
}

function parseSchemaOrgPlacesFromHtml(html) {
  const parsed = parseJsonLdPayloadsFromHtml(html);
  const places = [];
  for (const payload of parsed.payloads) places.push(...extractSchemaOrgPlaces(payload));
  return {
    places,
    validScriptCount: parsed.validScriptCount,
    invalidScriptCount: parsed.invalidScriptCount,
  };
}

function parseJsonLdPayloadsFromHtml(html) {
  const payloads = [];
  let validScriptCount = 0;
  let invalidScriptCount = 0;
  const scriptPattern = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
  let match;
  while ((match = scriptPattern.exec(String(html || ""))) !== null) {
    if (!isJsonLdScript(match[1])) continue;
    const body = String(match[2] || "")
      .replace(/^\s*<!--/, "")
      .replace(/-->\s*$/, "")
      .trim();
    if (!body) continue;
    try {
      payloads.push(JSON.parse(body));
      validScriptCount += 1;
    } catch (_error) {
      invalidScriptCount += 1;
    }
  }
  return { payloads, validScriptCount, invalidScriptCount };
}

function mapSchemaOrgPlaceToRecord(place, feed) {
  const type = placeType(place);
  const name = localizedString(place?.name);
  const coords = extractCoordinates(place);
  if (!type || !name || !coords) return null;
  const stableIdentity = boundedString(firstString(place.url, place["@id"], place.identifier), 2048);
  if (!stableIdentity) return null;
  return mapPlaceAtomToRecord({
    stableIdentity,
    name,
    type,
    ...coords,
    website: safeHttpUrl(firstString(place.url, place["@id"])),
    openingHours: firstString(place.openingHours),
  }, feed);
}

function mapPlaceAtomToRecord(atom, feed) {
  const stableIdentity = boundedString(atom?.stableIdentity, 2048);
  const name = boundedString(atom?.name, 160);
  const type = PLACE_TYPE_MAP[String(atom?.type || "").replace(/[^a-z]/gi, "").toLowerCase()]
    || (Object.values(PLACE_TYPE_MAP).includes(atom?.type) ? atom.type : null);
  const lat = finiteCoordinate(atom?.lat, -90, 90);
  const lng = finiteCoordinate(atom?.lng, -180, 180);
  if (!stableIdentity || !name || !type || lat == null || lng == null) return null;
  const website = safeHttpUrl(atom.website || stableIdentity);
  const digest = createHash("sha256")
    .update(`${feed.id}|${stableIdentity}`)
    .digest("hex")
    .slice(0, 20);
  return compact({
    id: `reviewed-place:${feed.id}:${digest}`,
    name: boundedString(name, 160),
    type,
    lat,
    lng,
    website,
    opening_hours: boundedString(atom.openingHours, 512),
    freshness: "fresh",
    operator_reviewed_source: true,
    source_policy: "reviewed_profile_bounded_refresh",
    sources: [{
      provider: feed.id,
      label: feed.label,
      family: feed.evidence_family,
      tier: feed.source_tier,
      url: website || feed.endpoint,
      license: feed.license || undefined,
      freshness: "fresh",
    }],
  });
}

function extractExperienceCardBlocks(html) {
  const source = String(html || "");
  const tagPattern = /<\/?[a-z][a-z0-9:-]*\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi;
  const stack = [];
  const blocks = [];
  let match;
  while ((match = tagPattern.exec(source)) !== null) {
    const token = match[0];
    const parsed = token.match(/^<\s*(\/?)\s*([a-z][a-z0-9:-]*)\b/i);
    if (!parsed) continue;
    const closing = parsed[1] === "/";
    const tag = parsed[2].toLowerCase();
    if (closing) {
      let openIndex = -1;
      for (let index = stack.length - 1; index >= 0; index -= 1) {
        if (stack[index].tag === tag) {
          openIndex = index;
          break;
        }
      }
      if (openIndex < 0) continue;
      const removed = stack.splice(openIndex, stack.length - openIndex);
      const opened = removed[0];
      if (removed.length !== 1 || !opened?.experienceCard) continue;
      blocks.push(source.slice(opened.start, tagPattern.lastIndex));
      if (blocks.length >= MAX_EXPERIENCE_CARD_BLOCKS) break;
      continue;
    }
    if (/\/\s*>$/.test(token) || /^(?:area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)$/.test(tag)) {
      continue;
    }
    const attributes = token.slice(parsed[0].length, -1);
    stack.push({
      tag,
      start: match.index,
      experienceCard: tag === "div" && classTokens(attributes).includes("vs-experience-card"),
    });
  }
  return blocks;
}

function experienceCardPointer(block, endpoint, sourceOrigin) {
  const root = String(block || "").match(/^<div\b([^>]*)>/i);
  if (!root || !classTokens(root[1]).includes("vs-experience-card")) return null;
  const titles = extractClassTexts(block, "vs-title", "div");
  const links = extractClassAnchorUrls(block, "vs-readmore", endpoint)
    .filter((url) => new URL(url).origin === sourceOrigin && url !== endpoint);
  const types = extractExperienceListTypes(block);
  const dataTitle = boundedString(decodeHtml(attributeValue(root[1], "data-title")), 160);
  const subcategory = normalizeExperienceCategory(attributeValue(root[1], "data-subcategories"));
  if (
    titles.length !== 1 ||
    links.length !== 1 ||
    types.length !== 1 ||
    !dataTitle || normalizePhrase(dataTitle) !== normalizePhrase(titles[0]) ||
    !subcategory || subcategory !== types[0]
  ) return null;
  return { url: links[0], name: titles[0], type: types[0] };
}

function extractExperienceListTypes(block) {
  const values = [];
  const pattern = /<span\b([^>]*)>([\s\S]*?)<\/span\s*>/gi;
  let match;
  while ((match = pattern.exec(String(block || ""))) !== null) {
    if (!classTokens(match[1]).includes("vs-category")) continue;
    const type = normalizeExperienceCategory(visibleText(match[2]));
    if (type) values.push(type);
  }
  return [...new Set(values)];
}

function extractExperienceDetailTypes(source) {
  const values = [];
  const pattern = /<span\b([^>]*)>([\s\S]*?)<\/span\s*>/gi;
  let match;
  while ((match = pattern.exec(String(source || ""))) !== null) {
    if (!classTokens(match[1]).includes("experience-subcategory")) continue;
    const type = normalizeExperienceCategory(visibleText(match[2]));
    if (type) values.push(type);
  }
  return [...new Set(values)];
}

function extractExperienceDetailCoordinates(source) {
  const values = new Map();
  const pattern = /<div\b([^>]*)>/gi;
  let match;
  while ((match = pattern.exec(String(source || ""))) !== null) {
    if (!classTokens(match[1]).includes("experience-map")) continue;
    const lat = strictCoordinateAttribute(attributeValue(match[1], "data-lat"), -90, 90);
    const lng = strictCoordinateAttribute(attributeValue(match[1], "data-lng"), -180, 180);
    if (lat == null || lng == null) continue;
    values.set(`${lat},${lng}`, { lat, lng });
  }
  return [...values.values()];
}

function extractCanonicalUrls(source, endpoint) {
  const values = new Set();
  const pattern = /<link\b([^>]*)>/gi;
  let match;
  while ((match = pattern.exec(String(source || ""))) !== null) {
    if (!classlessTokenList(attributeValue(match[1], "rel")).includes("canonical")) continue;
    const url = resolveSameOriginHttpsUrl(
      attributeValue(match[1], "href"),
      endpoint,
      new URL(endpoint).origin,
    );
    if (url) values.add(url);
  }
  return [...values];
}

function extractClassTexts(source, expectedClass, tag) {
  const values = [];
  const input = String(source || "");
  const pattern = new RegExp(`<${tag}\\b([^>]*)>`, "gi");
  let match;
  while ((match = pattern.exec(input)) !== null) {
    if (!classTokens(match[1]).includes(expectedClass)) continue;
    const closeAt = input.toLowerCase().indexOf(`</${tag}`, pattern.lastIndex);
    if (closeAt < 0) continue;
    const value = boundedString(visibleText(input.slice(pattern.lastIndex, closeAt)), 160);
    if (value) values.push(value);
  }
  return values;
}

function extractClassAnchorUrls(source, expectedClass, endpoint) {
  const values = [];
  const pattern = /<a\b([^>]*)>/gi;
  let match;
  while ((match = pattern.exec(String(source || ""))) !== null) {
    if (!classTokens(match[1]).includes(expectedClass)) continue;
    const url = resolveSameOriginHttpsUrl(
      attributeValue(match[1], "href"),
      endpoint,
      new URL(endpoint).origin,
    );
    if (url) values.push(url);
  }
  return [...new Set(values)];
}

function normalizeExperienceCategory(value) {
  const normalized = normalizePhrase(value).replace(/ [a-z]{2}$/, "");
  return PLACE_CATEGORY_MAP[normalized] || null;
}

function strictCoordinateAttribute(value, min, max) {
  if (!/^-?\d{1,3}\.\d{3,}$/.test(String(value || ""))) return null;
  return finiteCoordinate(Number(value), min, max);
}

function classTokens(attributes) {
  return classlessTokenList(attributeValue(attributes, "class"));
}

function classlessTokenList(value) {
  return String(value || "").trim().split(/\s+/).filter(Boolean);
}

function attributeValue(attributes, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = String(attributes || "").match(
    new RegExp(`\\b${escaped}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"),
  );
  return firstString(match?.[1], match?.[2], match?.[3]);
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

function filterRecordsForAnchor(records, anchor, bbox) {
  return records.filter((record) =>
    pointInBounds(record, bbox) &&
    haversineKm(anchor.lat, anchor.lng, record.lat, record.lng) <= DEFAULT_RADIUS_KM,
  );
}

function pointInBounds(point, bbox) {
  if (!Array.isArray(bbox) || bbox.length !== 4 || !validAnchor(point)) return false;
  const [west, south, east, north] = bbox;
  return point.lng >= west && point.lng <= east && point.lat >= south && point.lat <= north;
}

function placeType(place) {
  const values = Array.isArray(place?.["@type"])
    ? place["@type"]
    : [place?.["@type"] || place?.type];
  for (const value of values) {
    const key = String(value || "").split(/[\/#:]/).pop().replace(/[^a-z]/gi, "").toLowerCase();
    if (PLACE_TYPE_MAP[key]) return PLACE_TYPE_MAP[key];
  }
  return null;
}

function extractCoordinates(place) {
  const geo = place?.geo || place?.location?.geo;
  const lat = finiteCoordinate(geo?.latitude ?? geo?.lat, -90, 90);
  const lng = finiteCoordinate(geo?.longitude ?? geo?.lng ?? geo?.lon, -180, 180);
  return lat == null || lng == null ? null : { lat, lng };
}

function isJsonLdScript(attributes) {
  const match = String(attributes || "").match(/\btype\s*=\s*(?:(["'])(.*?)\1|([^\s>]+))/i);
  const value = String(match?.[2] || match?.[3] || "").trim().toLowerCase();
  return value.split(";")[0].trim() === "application/ld+json";
}

function sameOriginResponse(endpoint, response) {
  if (!response.url) return response.redirected !== true;
  try {
    return new URL(response.url).origin === new URL(endpoint).origin;
  } catch (_error) {
    return false;
  }
}

function exactUrlResponse(endpoint, response) {
  if (!response.url) return response.redirected !== true;
  try {
    const expected = new URL(endpoint);
    const actual = new URL(response.url);
    expected.hash = "";
    actual.hash = "";
    return response.redirected !== true && expected.toString() === actual.toString();
  } catch (_error) {
    return false;
  }
}

function isHtmlResponse(response) {
  const value = typeof response?.headers?.get === "function"
    ? String(response.headers.get("content-type") || "").toLowerCase()
    : "";
  const mediaType = value.split(";")[0].trim();
  return ["text/html", "application/xhtml+xml"].includes(mediaType);
}

async function readBoundedText(response, maxBytes) {
  if (response?.body && typeof response.body.getReader === "function") {
    const reader = response.body.getReader();
    const chunks = [];
    let bytes = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = value instanceof Uint8Array ? value : new Uint8Array(value || []);
        bytes += chunk.byteLength;
        if (bytes > maxBytes) {
          await Promise.resolve(reader.cancel()).catch(() => {});
          return null;
        }
        chunks.push(chunk);
      }
    } catch (_error) {
      return null;
    }
    const joined = new Uint8Array(bytes);
    let offset = 0;
    for (const chunk of chunks) {
      joined.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return new TextDecoder("utf-8", { fatal: true }).decode(joined).trim() || null;
  }
  if (typeof response?.text !== "function") return null;
  const text = await response.text();
  return Buffer.byteLength(text, "utf8") <= maxBytes ? text : null;
}

function validFeed(feed) {
  const bbox = Array.isArray(feed?.bbox) ? feed.bbox : [];
  const validBounds = bbox.length === 4 &&
    bbox.every(Number.isFinite) &&
    bbox[0] >= -180 && bbox[2] <= 180 && bbox[1] >= -90 && bbox[3] <= 90 &&
    bbox[0] <= bbox[2] && bbox[1] <= bbox[3];
  return Boolean(
    feed &&
    typeof feed === "object" &&
    [
      "schema_org_place_html",
      "schema_org_place_json",
      EXPERIENCE_CARD_PLACE_LIST_DETAIL_ADAPTER,
      MAP_LINKED_PLACE_ADAPTER,
    ].includes(feed.adapter) &&
    safeHttpsUrl(feed.endpoint) &&
    validBounds &&
    ["official", "editorial"].includes(feed.evidence_family),
  );
}

function validProbeFeed(feed) {
  const bbox = Array.isArray(feed?.bbox) ? feed.bbox : [];
  return Boolean(
    feed &&
    typeof feed === "object" &&
    boundedString(feed.id, 120) &&
    [
      "schema_org_place_html",
      "schema_org_place_json",
      EXPERIENCE_CARD_PLACE_LIST_DETAIL_ADAPTER,
      MAP_LINKED_PLACE_ADAPTER,
    ].includes(feed.adapter) &&
    safeHttpsUrl(feed.endpoint) &&
    bbox.length === 4 &&
    bbox.every(Number.isFinite) &&
    bbox[0] >= -180 && bbox[2] <= 180 && bbox[1] >= -90 && bbox[3] <= 90 &&
    bbox[0] <= bbox[2] && bbox[1] <= bbox[3]
  );
}

function dedupeFeeds(feeds) {
  const seen = new Set();
  return (Array.isArray(feeds) ? feeds : []).filter((feed) => {
    if (!validFeed(feed)) return false;
    const key = `${feed.id}|${feed.endpoint}`.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function cacheKey(feed) {
  return createHash("sha256")
    .update(JSON.stringify({
      id: feed.id,
      endpoint: feed.endpoint,
      adapter: feed.adapter,
      bbox: feed.bbox,
      evidence_family: feed.evidence_family,
      source_tier: feed.source_tier,
      max_items: feed.max_items,
      profile_reviewed_at: feed.profile_reviewed_at || "reviewed",
    }))
    .digest("hex");
}

function validAnchor(value) {
  return finiteCoordinate(value?.lat, -90, 90) != null && finiteCoordinate(value?.lng, -180, 180) != null;
}

function finiteCoordinate(value, min, max) {
  const number = Number(value);
  return Number.isFinite(number) && number >= min && number <= max ? number : null;
}

function boundedInteger(value, min, max) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, Math.floor(number))) : min;
}

function positiveInteger(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : null;
}

function boundedString(value, max) {
  const text = typeof value === "string" ? value.trim() : "";
  return text && text.length <= max ? text : null;
}

function localizedString(value, depth = 0) {
  if (depth > 4) return null;
  if (typeof value === "string") return value.trim() || null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const text = localizedString(item, depth + 1);
      if (text) return text;
    }
  } else if (value && typeof value === "object") {
    if (typeof value["@value"] === "string") return value["@value"].trim() || null;
    for (const item of Object.values(value)) {
      const text = localizedString(item, depth + 1);
      if (text) return text;
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

function safeHttpUrl(value) {
  try {
    const url = new URL(firstString(value));
    return ["http:", "https:"].includes(url.protocol) ? url.toString() : null;
  } catch (_error) {
    return null;
  }
}

function safeHttpsUrl(value) {
  const url = safeHttpUrl(value);
  return url && new URL(url).protocol === "https:" ? url : null;
}

function resolveSameOriginHttpsUrl(value, base, origin) {
  try {
    const url = new URL(firstString(value), base);
    if (url.protocol !== "https:" || url.username || url.password || url.origin !== origin) return null;
    url.hash = "";
    return url.toString();
  } catch (_error) {
    return null;
  }
}

function normalizeDate(value) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function haversineKm(lat1, lng1, lat2, lng2) {
  const toRad = (degrees) => (degrees * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function failed() {
  return { status: "failed", records: [] };
}

function enabled(value) {
  return ["enabled", "1", "true", "on", "yes"].includes(String(value || "").trim().toLowerCase());
}

function compact(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item != null));
}

module.exports = {
  ENABLE_ENV_KEY,
  EXPERIENCE_CARD_PLACE_LIST_DETAIL_ADAPTER,
  MAX_LIST_DETAIL_LINKS,
  PLACE_TYPE_MAP,
  collectReviewedPlaceFeed,
  collectReviewedPlaceFeedOutcome,
  createReviewedPlaceSource,
  extractExperienceCardDetailPointers,
  extractSchemaOrgPlaces,
  inspectExperienceCardPlaceListDetailPayload,
  inspectSchemaOrgPlacePayload,
  mapSchemaOrgPlaceToRecord,
  parseSchemaOrgPlacesFromHtml,
  probeReviewedPlaceFeed,
  probeSchemaOrgPlaceFeed,
  resolveDefaultReviewedPlaceSource,
};
