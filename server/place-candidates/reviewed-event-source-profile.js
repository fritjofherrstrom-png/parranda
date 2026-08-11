"use strict";

const PROFILE_ENV_KEY = "PARRANDA_REVIEWED_EVENT_SOURCE_PROFILES";
const REVIEW_STATUS = "approved";
const MAX_REVIEW_AGE_MS = 90 * 24 * 60 * 60 * 1000;

const ADAPTER_MAP = Object.freeze({
  linked_events: "linked_events",
  schema_org_event: "schema_org_html",
  schema_org_html: "schema_org_html",
  the_events_calendar: "events_calendar",
  events_calendar: "events_calendar",
  ical: "ical",
  rss_atom_event_detail: "rss_atom_event_detail",
  rss_atom: "rss_atom_event_detail",
  venue_calendar: "html_venue_calendar",
  html_venue_calendar: "html_venue_calendar",
  sitevision_calendar: "sitevision_calendar",
  wix_event_sitemap: "wix_event_sitemap",
  localized_events_api: "localized_events_api",
  embedded_program_rsc: "embedded_program_rsc",
  embedded_program: "embedded_program_rsc",
  next_rsc_program: "embedded_program_rsc",
  nextjs_program: "embedded_program_rsc",
});

const RUNTIME_POLICIES = new Set(["active", "bounded_refresh"]);
const TERMS_STATUSES = new Set(["open_license", "api_terms_compatible"]);
const REVIEWABLE_DISCOVERY_STATUSES = new Set([
  "viable_provider_probe",
  "needs_adapter_or_permission",
]);
const SOCIAL_FAMILIES = new Set(["community_social_listing"]);
const TIMEZONE_REQUIRED_ADAPTERS = new Set([
  "ical",
  "sitevision_calendar",
  "wix_event_sitemap",
  "embedded_program_rsc",
]);

/**
 * Convert operator-reviewed source profiles into existing event-feed rows.
 *
 * Discovery evidence never activates itself. A review must bind one discovered
 * candidate to the exact endpoint and compatible adapter, remain fresh, and
 * carry explicit runtime/terms/health decisions. The caller is a trusted
 * server-side config seam; request payload is intentionally not accepted.
 */
function resolveReviewedEventSourceProfileFeeds(env = process.env, options = {}) {
  const raw = String((env && env[PROFILE_ENV_KEY]) || "").trim();
  if (!raw) return [];

  let profiles;
  try {
    profiles = JSON.parse(raw);
  } catch (_error) {
    return [];
  }
  if (!Array.isArray(profiles)) return [];
  return eventFeedsFromReviewedSourceProfiles(profiles, options);
}

function eventFeedsFromReviewedSourceProfiles(profiles = [], { now = Date.now() } = {}) {
  const nowMs = normalizeNow(now);
  if (nowMs == null) return [];

  const feeds = [];
  const seen = new Set();
  for (const profile of Array.isArray(profiles) ? profiles : []) {
    const review = validRuntimeReview(profile?.runtime_review, nowMs);
    const bbox = normalizeBounds(profile?.place_context?.bounds);
    const profileKey = publicString(profile?.profile_key);
    if (!review || !bbox || !profileKey.startsWith("place-source-profile-v1:")) continue;

    const candidates = candidateIndex(profile?.source_families);
    for (const row of Array.isArray(profile.runtime_review.feeds)
      ? profile.runtime_review.feeds
      : []) {
      const candidate = candidates.get(publicString(row?.candidate_id));
      const feed = reviewedFeedRow({
        row,
        candidate,
        bbox,
        profileKey,
        review,
      });
      if (!feed) continue;
      const identity = `${feed.id.toLowerCase()}|${feed.endpoint.toLowerCase()}`;
      if (seen.has(identity)) continue;
      seen.add(identity);
      feeds.push(feed);
    }
  }
  return feeds.sort(compareFeeds);
}

function reviewedFeedRow({ row, candidate, bbox, profileKey, review }) {
  if (!row || typeof row !== "object" || !candidate) return null;
  if (candidate.corroboration_required === true) return null;
  if (SOCIAL_FAMILIES.has(publicString(candidate.family))) return null;
  if (!REVIEWABLE_DISCOVERY_STATUSES.has(publicString(candidate.status))) return null;

  const candidateUrl = safeHttpsUrl(candidate.url);
  const endpoint = safeHttpsUrl(row.endpoint);
  if (!candidateUrl || !endpoint || candidateUrl !== endpoint) return null;

  const candidateAdapter = ADAPTER_MAP[publicString(candidate.adapter)] || null;
  const adapter = ADAPTER_MAP[publicString(row.adapter)] || null;
  if (!candidateAdapter || !adapter || candidateAdapter !== adapter) return null;
  if (candidate.maps_to_existing_provider !== true) return null;

  const runtimePolicy = publicString(row.runtime_policy).toLowerCase();
  const termsStatus = publicString(row.terms_status).toLowerCase();
  const sourceHealth = publicString(row.source_health).toLowerCase();
  if (!RUNTIME_POLICIES.has(runtimePolicy)) return null;
  if (!TERMS_STATUSES.has(termsStatus)) return null;
  if (sourceHealth !== "healthy") return null;

  const timezone = normalizeTimezone(row.timezone);
  if (TIMEZONE_REQUIRED_ADAPTERS.has(adapter) && !timezone) return null;
  const eventPathPrefix = publicString(row.event_path_prefix);
  if (adapter === "wix_event_sitemap" && !eventPathPrefix) return null;

  const id = publicString(row.id, candidate.id);
  const label = publicString(row.label, candidate.source_label);
  const sourceIdentity = publicString(row.source_identity, candidate.source_identity);
  if (!id || !label || !sourceIdentity) return null;
  if (
    publicString(candidate.source_identity) &&
    sourceIdentity.toLowerCase() !== publicString(candidate.source_identity).toLowerCase()
  ) {
    return null;
  }
  const candidateFamily = publicString(candidate.family);
  const reviewedFamily = publicString(row.source_family, candidateFamily);
  if (!candidateFamily || reviewedFamily !== candidateFamily) return null;

  return compact({
    id,
    label,
    endpoint,
    base: endpoint,
    adapter,
    format: publicString(row.format) || null,
    bbox,
    license: publicString(row.license) || null,
    timezone,
    timezone_offset: publicString(row.timezone_offset) || null,
    source_language: publicString(row.source_language, candidate.source_language) || null,
    supported_languages: normalizeStringList(row.supported_languages),
    route_role_hint: publicString(row.route_role_hint) || null,
    fetch_details: row.fetch_details !== false,
    detail_limit: positiveInteger(row.detail_limit),
    detail_budget: positiveInteger(row.detail_budget),
    sitemap_limit: positiveInteger(row.sitemap_limit),
    page_size: positiveInteger(row.page_size),
    horizon_days: positiveInteger(row.horizon_days),
    event_path_prefix: eventPathPrefix || null,
    source_tier: normalizeSourceTier(row.source_tier, candidate.trust_tier),
    confidence: normalizeConfidence(row.confidence),
    source_family: reviewedFamily,
    source_identity: sourceIdentity,
    priority: finitePriority(row.priority),
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
  if (publicString(value.status).toLowerCase() !== REVIEW_STATUS) return null;
  const reviewedAtMs = Date.parse(publicString(value.reviewed_at));
  const expiresAtMs = Date.parse(publicString(value.expires_at));
  if (!Number.isFinite(reviewedAtMs) || !Number.isFinite(expiresAtMs)) return null;
  if (reviewedAtMs > nowMs || nowMs - reviewedAtMs > MAX_REVIEW_AGE_MS) return null;
  if (expiresAtMs - reviewedAtMs > MAX_REVIEW_AGE_MS) return null;
  if (expiresAtMs <= nowMs) return null;
  return {
    reviewed_at: new Date(reviewedAtMs).toISOString(),
    expires_at: new Date(expiresAtMs).toISOString(),
  };
}

function candidateIndex(sourceFamilies) {
  const index = new Map();
  for (const family of Array.isArray(sourceFamilies) ? sourceFamilies : []) {
    for (const candidate of Array.isArray(family?.candidates) ? family.candidates : []) {
      const id = publicString(candidate?.id);
      if (!id || index.has(id)) continue;
      index.set(id, { ...candidate, family: publicString(candidate.family, family.family) });
    }
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
  if (west > east || south > north) return null;
  if (west < -180 || east > 180 || south < -90 || north > 90) return null;
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

function normalizeTimezone(value) {
  const timezone = publicString(value);
  if (!timezone) return null;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(new Date(0));
    return timezone;
  } catch (_error) {
    return null;
  }
}

function normalizeSourceTier(value, fallback) {
  const tier = publicString(value, fallback).toLowerCase();
  return ["official", "verified", "curated", "editorial", "institution", "civic", "commercial", "community"].includes(tier)
    ? tier
    : "unknown";
}

function normalizeConfidence(value) {
  const confidence = publicString(value).toLowerCase();
  return ["medium", "strong", "high"].includes(confidence) ? "medium" : "low";
}

function normalizeStringList(value) {
  if (!Array.isArray(value)) return null;
  const values = [...new Set(value.map((item) => publicString(item)).filter(Boolean))];
  return values.length ? values : null;
}

function positiveInteger(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : null;
}

function finitePriority(value) {
  return Number.isFinite(Number(value)) ? Number(value) : 100;
}

function compareFeeds(left, right) {
  return left.priority - right.priority || left.id.localeCompare(right.id);
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
  eventFeedsFromReviewedSourceProfiles,
  resolveReviewedEventSourceProfileFeeds,
};
