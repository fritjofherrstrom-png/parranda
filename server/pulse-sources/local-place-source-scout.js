"use strict";

const { createHash } = require("node:crypto");

const {
  inspectSchemaOrgPlacePayload,
  inspectSchemaOrgPlaceListDetailPayload,
  SCHEMA_ORG_PLACE_LIST_DETAIL_ADAPTER,
} = require("../place-candidates/schema-org-place-source");
const {
  MAP_LINKED_PLACE_ADAPTER,
  inspectMapLinkedPlacePayload,
} = require("../place-candidates/map-linked-html-place-source");

const MAX_PLACE_DISCOVERY_QUERIES = 8;
const MIN_PLACE_LIST_ITEMS = 2;
const DEFAULT_PLACE_SOURCE_RADIUS_KM = 20;

function buildLocalPlaceDiscoveryQueryPlan({
  place = {},
  localPlaceDiscoveryTerms = [],
} = {}) {
  const verboseLabel = firstString(place.label);
  const localityLabel = firstString(place.name, localityFromLabel(verboseLabel));
  const labels = uniqueStrings([
    localityLabel,
    ...(Array.isArray(place.region_terms) ? place.region_terms : []),
    verboseLabel,
  ]).slice(0, 4);
  const localTerms = uniqueStrings([
    ...localPlaceDiscoveryTerms,
    ...(Array.isArray(place.local_place_discovery_terms)
      ? place.local_place_discovery_terms
      : []),
  ]);
  const terms = uniqueStrings([
    localTerms[0],
    "official tourism attractions",
    localTerms[1],
    "things to do",
    localTerms[2],
    "places to visit",
    "local attractions",
    ...localTerms.slice(3),
  ]).slice(0, 8);
  if (!labels.length) return [];

  const plan = [];
  const seen = new Set();
  for (let index = 0; index < terms.length; index += 1) {
    const label = labels[index % labels.length];
    const term = terms[index];
    const query = `${label} ${term}`;
    const key = query.toLocaleLowerCase("en-US");
    if (seen.has(key)) continue;
    seen.add(key);
    plan.push({
      query,
      query_family: placeDiscoveryQueryFamily(term, localTerms),
      term_key: stableHash(term).slice(0, 12),
      label_scope: index % labels.length === 0 ? "locality" : "regional_rotation",
    });
    if (plan.length >= MAX_PLACE_DISCOVERY_QUERIES) break;
  }
  return plan;
}

function inspectPlaceSourcePage({
  seed = {},
  body = "",
  contentType = "text/html",
  context = {},
} = {}) {
  const endpoint = safeHttpsUrl(seed.url);
  const bbox = normalizeBounds(context.bounds) || boundsAroundAnchor(context.anchor);
  if (!endpoint || !bbox) return emptyInspection("place_source_input_invalid");
  const mediaType = String(contentType || "").split(";")[0].trim().toLowerCase();
  let adapter = mediaType === "application/ld+json" || mediaType === "application/json"
    ? "schema_org_place_json"
    : "schema_org_place_html";
  let summary = inspectSchemaOrgPlacePayload(body, {
    adapter,
    bbox,
    sourceId: `scout-place-${stableHash(endpoint).slice(0, 20)}`,
  });
  if (
    adapter === "schema_org_place_html" &&
    (summary.status !== "ok" || summary.accepted_place_count < MIN_PLACE_LIST_ITEMS)
  ) {
    const listDetail = inspectSchemaOrgPlaceListDetailPayload(body, { endpoint });
    if (listDetail.status === "ok" && listDetail.detail_link_count >= MIN_PLACE_LIST_ITEMS) {
      adapter = SCHEMA_ORG_PLACE_LIST_DETAIL_ADAPTER;
      summary = {
        ...listDetail,
        accepted_place_count: 0,
        distinct_place_type_count: 0,
      };
    }
  }
  if (
    adapter === "schema_org_place_html" &&
    (summary.status !== "ok" || summary.accepted_place_count < MIN_PLACE_LIST_ITEMS)
  ) {
    const mapLinked = inspectMapLinkedPlacePayload(body, {
      bbox,
      endpoint,
      sourceId: `scout-place-${stableHash(endpoint).slice(0, 20)}`,
    });
    if (mapLinked.status === "ok" && mapLinked.accepted_place_count >= MIN_PLACE_LIST_ITEMS) {
      adapter = MAP_LINKED_PLACE_ADAPTER;
      summary = mapLinked;
    }
  }
  const sourceShapeCount = adapter === SCHEMA_ORG_PLACE_LIST_DETAIL_ADAPTER
    ? summary.detail_link_count
    : summary.accepted_place_count;
  if (summary.status !== "ok" || sourceShapeCount < MIN_PLACE_LIST_ITEMS) {
    return {
      ...emptyInspection(summary.status === "failed"
        ? "place_source_payload_invalid"
        : "structured_place_list_not_detected"),
      accepted_place_count: summary.accepted_place_count,
      distinct_place_type_count: summary.distinct_place_type_count,
      detail_link_count: summary.detail_link_count,
    };
  }

  const sourceIdentity = new URL(endpoint).hostname.toLowerCase().replace(/^www\./, "");
  const termsStatus = normalizeTermsStatus(seed.terms_status);
  const candidate = {
    id: `scout-place-${stableHash(`${adapter}:${endpoint}`)}`,
    candidate_kind: "place_list",
    family: inferPlaceSourceFamily(seed),
    source_label: firstString(seed.label, sourceIdentity),
    url: endpoint,
    source_identity: sourceIdentity,
    discovery_method: firstString(seed.discovery_method, "reviewed_website_probe"),
    adapter,
    status: termsStatus === "restricted" ? "rejected" : "viable_place_provider_probe",
    maps_to_existing_provider: true,
    trust_tier: normalizePlaceTrustTier(seed.trust_tier),
    terms_status: termsStatus,
    source_health: "healthy",
    runtime_policy: "review_needed",
    corroboration_required: false,
    accepted_place_count: summary.accepted_place_count,
    distinct_place_type_count: summary.distinct_place_type_count,
    detail_link_count: summary.detail_link_count,
    reasons: ["structured_place_list_detected", "operator_review_required"],
    blockers: termsStatus === "restricted" ? ["terms_restricted"] : [],
  };
  const manifest = candidate.status === "rejected"
    ? null
    : buildPlaceManifestCandidate(candidate, { seed, bbox });
  return {
    detected: [adapter],
    candidate,
    manifest_candidate: manifest,
    accepted_place_count: summary.accepted_place_count,
    distinct_place_type_count: summary.distinct_place_type_count,
    detail_link_count: summary.detail_link_count,
    reasons: ["structured_place_source_detected"],
  };
}

function buildPlaceManifestCandidate(candidate, { seed = {}, bbox = null } = {}) {
  if (
    !candidate ||
    candidate.status !== "viable_place_provider_probe" ||
    candidate.maps_to_existing_provider !== true ||
    ![
      "schema_org_place_html",
      "schema_org_place_json",
      SCHEMA_ORG_PLACE_LIST_DETAIL_ADAPTER,
      MAP_LINKED_PLACE_ADAPTER,
    ]
      .includes(candidate.adapter) ||
    !normalizeBounds(bbox)
  ) return null;
  return compact({
    id: candidate.id,
    label: candidate.source_label,
    endpoint: candidate.url,
    adapter: candidate.adapter,
    format: candidate.adapter === "schema_org_place_json" ? "json" : "html",
    bbox: normalizeBounds(bbox),
    license: safeHttpsUrl(seed.license),
    source_tier: candidate.trust_tier,
    source_family: candidate.family,
    source_identity: candidate.source_identity,
    priority: 100,
    max_items: Math.min(
      candidate.adapter === SCHEMA_ORG_PLACE_LIST_DETAIL_ADAPTER ? 12 : 100,
      Math.max(
        MIN_PLACE_LIST_ITEMS,
        candidate.detail_link_count || candidate.accepted_place_count,
      ),
    ),
    status: "review-needed",
    runtime_policy: "review_required",
    review: {
      terms_status: candidate.terms_status,
      robots_status: "review_at_activation",
      discovered_from: firstString(seed.discovered_from, seed.url),
      reasons: candidate.reasons,
    },
  });
}

function extractPlaceListPageLinks({ links = [], pageUrl, localPlaceDiscoveryTerms = [] } = {}) {
  const base = safeHttpsUrl(pageUrl);
  if (!base) return [];
  const origin = new URL(base).origin;
  const phrases = uniqueStrings([
    ...localPlaceDiscoveryTerms,
    "attractions",
    "things to do",
    "places to visit",
    "sights",
    "see and do",
    "visitor guide",
    "destination guide",
  ]).map(normalizePhrase);
  const found = [];
  const seen = new Set();
  for (const link of Array.isArray(links) ? links : []) {
    const url = safeHttpsUrl(link?.url);
    if (!url || new URL(url).origin !== origin || seen.has(url)) continue;
    const haystack = normalizePhrase(`${new URL(url).pathname} ${link.text || ""}`);
    const matched = phrases.filter((phrase) => phrase && haystack.includes(phrase));
    if (!matched.length) continue;
    seen.add(url);
    found.push({
      url,
      reasons: ["same_origin_place_list_link", ...matched.slice(0, 2).map(() => "place_term_match")],
    });
  }
  return found.slice(0, 8);
}

function withPlaceManifestRobotsStatus(manifests, robots) {
  const status = firstString(robots?.status, "unknown");
  return (Array.isArray(manifests) ? manifests : []).map((manifest) => ({
    ...manifest,
    review: {
      ...(manifest.review || {}),
      robots_status: status,
      ...(robots?.reason ? { robots_reason: robots.reason } : {}),
    },
  }));
}

function inferPlaceSourceFamily(seed) {
  const family = firstString(seed?.family).toLowerCase();
  if (/official|municipal|tourism|destination/.test(family)) return "official_place_guide";
  if (/media|editorial|guide/.test(family)) return "editorial_place_guide";
  return "structured_place_guide";
}

function normalizePlaceTrustTier(value) {
  const tier = firstString(value).toLowerCase();
  if (["official", "editorial", "curated"].includes(tier)) return tier;
  if (["civic", "municipal"].includes(tier)) return "official";
  return "unknown";
}

function normalizeTermsStatus(value) {
  const status = firstString(value).toLowerCase();
  return ["open_license", "api_terms_compatible", "permission_required", "restricted"].includes(status)
    ? status
    : "unknown";
}

function placeDiscoveryQueryFamily(term, localTerms) {
  if (localTerms.includes(term)) return "local_place_guide";
  if (term === "official tourism attractions") return "official_place_guide";
  if (term === "things to do") return "things_to_do_guide";
  if (term === "places to visit") return "places_to_visit_guide";
  return "local_attractions_guide";
}

function normalizeBounds(value) {
  const numbers = Array.isArray(value)
    ? value.map(Number)
    : value && typeof value === "object"
      ? [value.west, value.south, value.east, value.north].map(Number)
      : [];
  if (numbers.length !== 4 || !numbers.every(Number.isFinite)) return null;
  const [west, south, east, north] = numbers;
  if (west > east || south > north || west < -180 || east > 180 || south < -90 || north > 90) return null;
  return numbers;
}

function boundsAroundAnchor(anchor, radiusKm = DEFAULT_PLACE_SOURCE_RADIUS_KM) {
  const lat = Number(anchor?.lat);
  const lng = Number(anchor?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  const latDelta = radiusKm / 111.32;
  const lngScale = Math.max(0.1, Math.cos((lat * Math.PI) / 180));
  const lngDelta = radiusKm / (111.32 * lngScale);
  return [
    Math.max(-180, lng - lngDelta),
    Math.max(-90, lat - latDelta),
    Math.min(180, lng + lngDelta),
    Math.min(90, lat + latDelta),
  ];
}

function emptyInspection(reason) {
  return {
    detected: [],
    candidate: null,
    manifest_candidate: null,
    accepted_place_count: 0,
    distinct_place_type_count: 0,
    reasons: [reason],
  };
}

function localityFromLabel(value) {
  return firstString(value)?.split(",")[0]?.trim() || "";
}

function normalizePhrase(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("en-US")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function safeHttpsUrl(value) {
  try {
    const url = new URL(firstString(value));
    if (url.protocol !== "https:") return null;
    url.hash = "";
    return url.toString();
  } catch (_error) {
    return null;
  }
}

function stableHash(value) {
  return createHash("sha256").update(String(value || "")).digest("hex").slice(0, 20);
}

function uniqueStrings(values) {
  return [...new Set((Array.isArray(values) ? values : []).map(firstString).filter(Boolean))];
}

function firstString(...values) {
  for (const value of values.flat()) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function compact(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item != null && item !== ""));
}

module.exports = {
  MAX_PLACE_DISCOVERY_QUERIES,
  MIN_PLACE_LIST_ITEMS,
  buildLocalPlaceDiscoveryQueryPlan,
  buildPlaceManifestCandidate,
  extractPlaceListPageLinks,
  inspectPlaceSourcePage,
  withPlaceManifestRobotsStatus,
};
