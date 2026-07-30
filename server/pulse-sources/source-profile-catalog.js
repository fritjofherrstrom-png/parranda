"use strict";

const { eventFeedsFromReviewedSourceProfiles } = require("../place-candidates/reviewed-event-source-profile");

const CATALOG_FLAG_ENV_KEY = "PARRANDA_SOURCE_CATALOG";
const CATALOG_DATABASE_ENV_KEY = "PARRANDA_SOURCE_CATALOG_DATABASE_URL";
const MAX_PROFILE_BYTES = 512 * 1024;

const UPSERT_APPROVED_PROFILE_SQL = `
INSERT INTO pulse_source_profiles (
  profile_key,
  catalog_status,
  place_label,
  anchor_lat,
  anchor_lng,
  bbox_west,
  bbox_south,
  bbox_east,
  bbox_north,
  profile,
  discovered_at,
  reviewed_at,
  review_expires_at,
  updated_at
) VALUES (
  $1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb,
  $11::timestamptz, $12::timestamptz, $13::timestamptz, NOW()
)
ON CONFLICT (profile_key) DO UPDATE SET
  catalog_status = EXCLUDED.catalog_status,
  place_label = EXCLUDED.place_label,
  anchor_lat = EXCLUDED.anchor_lat,
  anchor_lng = EXCLUDED.anchor_lng,
  bbox_west = EXCLUDED.bbox_west,
  bbox_south = EXCLUDED.bbox_south,
  bbox_east = EXCLUDED.bbox_east,
  bbox_north = EXCLUDED.bbox_north,
  profile = EXCLUDED.profile,
  discovered_at = LEAST(pulse_source_profiles.discovered_at, EXCLUDED.discovered_at),
  reviewed_at = EXCLUDED.reviewed_at,
  review_expires_at = EXCLUDED.review_expires_at,
  updated_at = NOW()
RETURNING profile_key, catalog_status
`;

const UPSERT_DISCOVERY_PROFILE_SQL = `
INSERT INTO pulse_source_profiles (
  profile_key,
  catalog_status,
  place_label,
  anchor_lat,
  anchor_lng,
  bbox_west,
  bbox_south,
  bbox_east,
  bbox_north,
  profile,
  discovered_at,
  reviewed_at,
  review_expires_at,
  updated_at
) VALUES (
  $1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb,
  $11::timestamptz, $12::timestamptz, $13::timestamptz, NOW()
)
ON CONFLICT (profile_key) DO UPDATE SET
  catalog_status = CASE
    WHEN pulse_source_profiles.catalog_status = 'review_needed' THEN EXCLUDED.catalog_status
    ELSE pulse_source_profiles.catalog_status
  END,
  place_label = CASE
    WHEN pulse_source_profiles.catalog_status = 'review_needed' THEN EXCLUDED.place_label
    ELSE pulse_source_profiles.place_label
  END,
  anchor_lat = CASE
    WHEN pulse_source_profiles.catalog_status = 'review_needed' THEN EXCLUDED.anchor_lat
    ELSE pulse_source_profiles.anchor_lat
  END,
  anchor_lng = CASE
    WHEN pulse_source_profiles.catalog_status = 'review_needed' THEN EXCLUDED.anchor_lng
    ELSE pulse_source_profiles.anchor_lng
  END,
  bbox_west = CASE
    WHEN pulse_source_profiles.catalog_status = 'review_needed' THEN EXCLUDED.bbox_west
    ELSE pulse_source_profiles.bbox_west
  END,
  bbox_south = CASE
    WHEN pulse_source_profiles.catalog_status = 'review_needed' THEN EXCLUDED.bbox_south
    ELSE pulse_source_profiles.bbox_south
  END,
  bbox_east = CASE
    WHEN pulse_source_profiles.catalog_status = 'review_needed' THEN EXCLUDED.bbox_east
    ELSE pulse_source_profiles.bbox_east
  END,
  bbox_north = CASE
    WHEN pulse_source_profiles.catalog_status = 'review_needed' THEN EXCLUDED.bbox_north
    ELSE pulse_source_profiles.bbox_north
  END,
  profile = CASE
    WHEN pulse_source_profiles.catalog_status = 'review_needed' THEN EXCLUDED.profile
    ELSE pulse_source_profiles.profile
  END,
  discovered_at = LEAST(pulse_source_profiles.discovered_at, EXCLUDED.discovered_at),
  reviewed_at = CASE
    WHEN pulse_source_profiles.catalog_status = 'review_needed' THEN EXCLUDED.reviewed_at
    ELSE pulse_source_profiles.reviewed_at
  END,
  review_expires_at = CASE
    WHEN pulse_source_profiles.catalog_status = 'review_needed' THEN EXCLUDED.review_expires_at
    ELSE pulse_source_profiles.review_expires_at
  END,
  updated_at = NOW()
RETURNING profile_key, catalog_status
`;

const ACTIVE_PROFILES_FOR_ANCHOR_SQL = `
SELECT profile
FROM pulse_source_profiles
WHERE catalog_status = 'approved'
  AND review_expires_at > $3::timestamptz
  AND bbox_west <= $2
  AND bbox_east >= $2
  AND bbox_south <= $1
  AND bbox_north >= $1
ORDER BY reviewed_at DESC NULLS LAST, profile_key ASC
LIMIT 64
`;

function createSourceProfileCatalog({ query, now = () => new Date() } = {}) {
  if (typeof query !== "function") return null;

  async function recordDiscovery(profile) {
    const normalized = normalizeCatalogProfile(profile, {
      forcedStatus: "review_needed",
      now: now(),
    });
    if (!normalized) return { status: "rejected", reason: "invalid_source_profile" };

    try {
      const result = await query(UPSERT_DISCOVERY_PROFILE_SQL, catalogValues(normalized));
      const row = result?.rows?.[0] || {};
      return {
        status: "recorded",
        profile_key: publicString(row.profile_key) || normalized.profile.profile_key,
        catalog_status: publicString(row.catalog_status) || "review_needed",
      };
    } catch (_error) {
      return { status: "failed", reason: "source_catalog_write_failed" };
    }
  }

  async function recordApprovedProfile(profile) {
    const normalized = normalizeCatalogProfile(profile, {
      forcedStatus: "approved",
      now: now(),
    });
    if (!normalized) return { status: "rejected", reason: "invalid_reviewed_source_profile" };

    try {
      const result = await query(UPSERT_APPROVED_PROFILE_SQL, catalogValues(normalized));
      const row = result?.rows?.[0] || {};
      return {
        status: "recorded",
        profile_key: publicString(row.profile_key) || normalized.profile.profile_key,
        catalog_status: publicString(row.catalog_status) || "approved",
      };
    } catch (_error) {
      return { status: "failed", reason: "source_catalog_write_failed" };
    }
  }

  async function listApprovedEventFeedsForAnchor({ anchor, now: requestedNow = now() } = {}) {
    const lat = finiteCoordinate(anchor?.lat, -90, 90);
    const lng = finiteCoordinate(anchor?.lng, -180, 180);
    const at = normalizeDate(requestedNow);
    if (lat == null || lng == null || !at) return [];

    try {
      const result = await query(ACTIVE_PROFILES_FOR_ANCHOR_SQL, [lat, lng, at.toISOString()]);
      const profiles = (Array.isArray(result?.rows) ? result.rows : [])
        .map((row) => parseProfile(row?.profile))
        .filter(Boolean);
      return eventFeedsFromReviewedSourceProfiles(profiles, { now: at });
    } catch (_error) {
      return [];
    }
  }

  return {
    recordDiscovery,
    recordApprovedProfile,
    listApprovedEventFeedsForAnchor,
  };
}

function resolveDefaultSourceProfileCatalog(env = process.env, options = {}) {
  if (!enabled(env?.[CATALOG_FLAG_ENV_KEY])) return null;
  const connectionString = publicString(env?.[CATALOG_DATABASE_ENV_KEY]);
  if (!connectionString) return null;

  let Pool;
  try {
    ({ Pool } = options.pg || require("pg"));
  } catch (_error) {
    return null;
  }

  let pool;
  try {
    pool = new Pool({
      connectionString,
      max: positiveInteger(env?.PARRANDA_SOURCE_CATALOG_POOL_MAX) || 4,
      connectionTimeoutMillis:
        positiveInteger(env?.PARRANDA_SOURCE_CATALOG_CONNECT_TIMEOUT_MS) || 2_000,
      idleTimeoutMillis: 30_000,
    });
  } catch (_error) {
    return null;
  }

  const catalog = createSourceProfileCatalog({
    query: (text, values) => pool.query(text, values),
    now: options.now,
  });
  if (!catalog) return null;
  return { ...catalog, close: () => pool.end() };
}

function normalizeCatalogProfile(profile, { forcedStatus, now } = {}) {
  const cloned = parseProfile(profile);
  const profileKey = publicString(cloned?.profile_key);
  const place = cloned?.place_context;
  const bounds = normalizeBounds(place?.bounds);
  const anchorLat = finiteCoordinate(place?.lat, -90, 90);
  const anchorLng = finiteCoordinate(place?.lng, -180, 180);
  const at = normalizeDate(now);
  if (!profileKey?.startsWith("place-source-profile-v1:") || !bounds || !at) return null;

  if (forcedStatus === "review_needed") {
    cloned.runtime_review = {
      status: "unreviewed",
      reviewed_at: null,
      expires_at: null,
      feeds: [],
    };
  } else if (forcedStatus === "approved") {
    const feeds = eventFeedsFromReviewedSourceProfiles([cloned], { now: at });
    if (!feeds.length) return null;
  } else {
    return null;
  }

  const serialized = JSON.stringify(cloned);
  if (Buffer.byteLength(serialized, "utf8") > MAX_PROFILE_BYTES) return null;
  const review = cloned.runtime_review || {};
  return {
    profile: cloned,
    serialized,
    status: forcedStatus,
    placeLabel: publicString(place?.label),
    anchorLat,
    anchorLng,
    bounds,
    discoveredAt: at.toISOString(),
    reviewedAt: normalizeDate(review.reviewed_at)?.toISOString() || null,
    reviewExpiresAt: normalizeDate(review.expires_at)?.toISOString() || null,
  };
}

function catalogValues(normalized) {
  return [
    normalized.profile.profile_key,
    normalized.status,
    normalized.placeLabel,
    normalized.anchorLat,
    normalized.anchorLng,
    normalized.bounds.west,
    normalized.bounds.south,
    normalized.bounds.east,
    normalized.bounds.north,
    normalized.serialized,
    normalized.discoveredAt,
    normalized.reviewedAt,
    normalized.reviewExpiresAt,
  ];
}

function normalizeBounds(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const bounds = {
    west: finiteCoordinate(value.west, -180, 180),
    south: finiteCoordinate(value.south, -90, 90),
    east: finiteCoordinate(value.east, -180, 180),
    north: finiteCoordinate(value.north, -90, 90),
  };
  if (Object.values(bounds).some((item) => item == null)) return null;
  if (bounds.west > bounds.east || bounds.south > bounds.north) return null;
  return bounds;
}

function parseProfile(value) {
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : structuredClone(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch (_error) {
    return null;
  }
}

function normalizeDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function finiteCoordinate(value, min, max) {
  const number = Number(value);
  return Number.isFinite(number) && number >= min && number <= max ? number : null;
}

function positiveInteger(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : null;
}

function publicString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function enabled(value) {
  return ["enabled", "1", "true", "on", "yes"].includes(String(value || "").trim().toLowerCase());
}

module.exports = {
  ACTIVE_PROFILES_FOR_ANCHOR_SQL,
  CATALOG_DATABASE_ENV_KEY,
  CATALOG_FLAG_ENV_KEY,
  MAX_PROFILE_BYTES,
  UPSERT_APPROVED_PROFILE_SQL,
  UPSERT_DISCOVERY_PROFILE_SQL,
  createSourceProfileCatalog,
  resolveDefaultSourceProfileCatalog,
};
