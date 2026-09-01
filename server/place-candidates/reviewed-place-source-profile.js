"use strict";

const PROFILE_ENV_KEY = "PARRANDA_REVIEWED_PLACE_SOURCE_PROFILES";
const MAX_REVIEW_AGE_MS = 90 * 24 * 60 * 60 * 1000;
const REVIEWABLE_DISCOVERY_STATUSES = new Set([
  "viable_provider_probe",
  "needs_adapter_or_permission",
  "viable_place_provider_probe",
]);
const ADAPTER_MAP = Object.freeze({
  schema_org_place: "schema_org_place_html",
  schema_org_place_html: "schema_org_place_html",
  schema_org_place_json: "schema_org_place_json",
});
const RUNTIME_POLICIES = new Set(["active", "bounded_refresh"]);
const TERMS_STATUSES = new Set(["open_license", "api_terms_compatible"]);
const EVIDENCE_FAMILIES = new Set(["official", "editorial"]);

/**
 * Turn an operator-reviewed discovery profile into bounded place-list sources.
 *
 * Discovery never activates itself. The review must bind an exact discovered
 * candidate, endpoint, adapter and source identity, and remains server-owned.
 * Request payloads are intentionally absent from this seam.
 */
function resolveReviewedPlaceSourceProfileFeeds(env = process.env, options = {}) {
  const raw = publicString(env?.[PROFILE_ENV_KEY]);
  if (!raw) return [];
  try {
    const profiles = JSON.parse(raw);
    return placeFeedsFromReviewedSourceProfiles(profiles, options);
  } catch (_error) {
    return [];
  }
}

function placeFeedsFromReviewedSourceProfiles(profiles = [], { now = Date.now() } = {}) {
  const nowMs = normalizeNow(now);
  if (nowMs == null || !Array.isArray(profiles)) return [];
  const feeds = [];
  const seen = new Set();
  for (const profile of profiles) {
    const review = validRuntimeReview(profile?.runtime_review, nowMs);
    const bbox = normalizeBounds(profile?.place_context?.bounds);
    const profileKey = boundedString(profile?.profile_key, 240);
    if (!review || !bbox || !profileKey.startsWith("place-source-profile-v1:")) continue;
    const candidates = candidateIndex(profile);
    for (const row of Array.isArray(profile?.runtime_review?.place_sources)
      ? profile.runtime_review.place_sources
      : []) {
      const candidate = candidates.get(publicString(row?.candidate_id));
      const feed = reviewedPlaceFeed({ row, candidate, bbox, profileKey, review });
      if (!feed) continue;
      const identity = `${feed.id.toLowerCase()}|${feed.endpoint.toLowerCase()}`;
      if (seen.has(identity)) continue;
      seen.add(identity);
      feeds.push(feed);
    }
  }
  return feeds.sort((left, right) => left.priority - right.priority || left.id.localeCompare(right.id));
}

function reviewedPlaceFeed({ row, candidate, bbox, profileKey, review }) {
  if (!row || typeof row !== "object" || !candidate) return null;
  if (candidate.corroboration_required === true) return null;
  if (!REVIEWABLE_DISCOVERY_STATUSES.has(publicString(candidate.status))) return null;
  if (candidate.maps_to_existing_provider !== true) return null;

  const candidateUrl = safeHttpsUrl(candidate.url);
  const endpoint = safeHttpsUrl(row.endpoint);
  if (!candidateUrl || !endpoint || candidateUrl !== endpoint) return null;
  const candidateAdapter = ADAPTER_MAP[publicString(candidate.adapter)] || null;
  const adapter = ADAPTER_MAP[publicString(row.adapter)] || null;
  if (!candidateAdapter || candidateAdapter !== adapter) return null;

  const runtimePolicy = publicString(row.runtime_policy).toLowerCase();
  const termsStatus = publicString(row.terms_status).toLowerCase();
  const sourceHealth = publicString(row.source_health).toLowerCase();
  const evidenceFamily = publicString(row.evidence_family).toLowerCase();
  const sourceTier = normalizeSourceTier(row.source_tier, candidate.trust_tier);
  if (!RUNTIME_POLICIES.has(runtimePolicy)) return null;
  if (!TERMS_STATUSES.has(termsStatus) || sourceHealth !== "healthy") return null;
  if (!EVIDENCE_FAMILIES.has(evidenceFamily)) return null;
  if (evidenceFamily === "official" && sourceTier !== "official") return null;
  if (evidenceFamily === "editorial" && !["editorial", "curated"].includes(sourceTier)) return null;

  const id = safeMachineId(publicString(row.id, candidate.id));
  const label = boundedString(publicString(row.label, candidate.source_label), 160);
  const sourceIdentity = boundedString(publicString(row.source_identity, candidate.source_identity), 200);
  if (!id || !label || !sourceIdentity) return null;
  if (
    publicString(candidate.source_identity) &&
    sourceIdentity.toLowerCase() !== publicString(candidate.source_identity).toLowerCase()
  ) return null;

  return compact({
    id,
    label,
    endpoint,
    adapter,
    bbox,
    license: boundedString(row.license, 160),
    source_tier: sourceTier,
    evidence_family: evidenceFamily,
    source_identity: sourceIdentity,
    priority: finitePriority(row.priority),
    max_items: boundedInteger(row.max_items, 1, 100) || 40,
    status: "active",
    runtime_policy: runtimePolicy,
    terms_status: termsStatus,
    source_health: sourceHealth,
    profile_key: profileKey,
    profile_reviewed_at: review.reviewed_at,
    profile_expires_at: review.expires_at,
  });
}

function validRuntimeReview(value, nowMs) {
  if (!value || typeof value !== "object") return null;
  if (publicString(value.status).toLowerCase() !== "approved") return null;
  const reviewedAtMs = Date.parse(publicString(value.reviewed_at));
  const expiresAtMs = Date.parse(publicString(value.expires_at));
  if (!Number.isFinite(reviewedAtMs) || !Number.isFinite(expiresAtMs)) return null;
  if (reviewedAtMs > nowMs || nowMs - reviewedAtMs > MAX_REVIEW_AGE_MS) return null;
  if (expiresAtMs <= nowMs || expiresAtMs - reviewedAtMs > MAX_REVIEW_AGE_MS) return null;
  return {
    reviewed_at: new Date(reviewedAtMs).toISOString(),
    expires_at: new Date(expiresAtMs).toISOString(),
  };
}

function candidateIndex(profile) {
  const index = new Map();
  for (const family of Array.isArray(profile?.source_families) ? profile.source_families : []) {
    for (const candidate of Array.isArray(family?.candidates) ? family.candidates : []) {
      const id = publicString(candidate?.id);
      if (id && !index.has(id)) index.set(id, candidate);
    }
  }
  for (const candidate of Array.isArray(profile?.place_source_candidates)
    ? profile.place_source_candidates
    : []) {
    const id = publicString(candidate?.id);
    if (id && !index.has(id)) index.set(id, candidate);
  }
  return index;
}

function normalizeBounds(value) {
  const values = Array.isArray(value)
    ? value.map(Number)
    : value && typeof value === "object"
      ? [value.west, value.south, value.east, value.north].map(Number)
      : [];
  if (values.length !== 4 || !values.every(Number.isFinite)) return null;
  const [west, south, east, north] = values;
  if (west > east || south > north || west < -180 || east > 180 || south < -90 || north > 90) return null;
  return values;
}

function safeHttpsUrl(value) {
  try {
    const url = new URL(publicString(value));
    if (url.protocol !== "https:") return null;
    url.hash = "";
    return url.toString();
  } catch (_error) {
    return null;
  }
}

function normalizeSourceTier(value, fallback) {
  const tier = publicString(value, fallback).toLowerCase();
  return ["official", "curated", "editorial"].includes(tier) ? tier : "unknown";
}

function safeMachineId(value) {
  const text = boundedString(value, 120);
  return text && /^[a-z0-9][a-z0-9._:-]*$/i.test(text) ? text : null;
}

function boundedString(value, max) {
  const text = typeof value === "string" ? value.trim() : "";
  return text && text.length <= max ? text : null;
}

function boundedInteger(value, min, max) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, Math.floor(number))) : null;
}

function finitePriority(value) {
  return Number.isFinite(Number(value)) ? Number(value) : 100;
}

function normalizeNow(value) {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

function publicString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function compact(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item != null));
}

module.exports = {
  PROFILE_ENV_KEY,
  MAX_REVIEW_AGE_MS,
  placeFeedsFromReviewedSourceProfiles,
  resolveReviewedPlaceSourceProfileFeeds,
};
