"use strict";

const { createHash, randomUUID } = require("node:crypto");
const { eventFeedsFromReviewedSourceProfiles } = require("../place-candidates/reviewed-event-source-profile");
const { placeFeedsFromReviewedSourceProfiles } = require("../place-candidates/reviewed-place-source-profile");
const {
  deriveLocalAnchorSpatialScope,
  sanitizeTrustedSpatialScope,
} = require("../place-candidates/spatial-scope");
const { eventFeedsFromQualifiedSourceProfiles } = require("./source-qualification");
const {
  normalizeSourceDiscoveryHealth,
  pendingSourceDiscoveryHealth,
  unavailableSourceDiscoveryHealth,
} = require("./source-discovery-health");

const CATALOG_FLAG_ENV_KEY = "PARRANDA_SOURCE_CATALOG";
const CATALOG_DATABASE_ENV_KEY = "PARRANDA_SOURCE_CATALOG_DATABASE_URL";
const MAX_PROFILE_BYTES = 512 * 1024;
const MAX_QUALIFICATION_BYTES = 128 * 1024;
const MAX_SCOUT_TARGETS = 10_000;
const SCOUT_LEASE_MS = 15 * 60 * 1000;
const SCOUT_REPROBE_MIN_MS = 5 * 60 * 1000;
const SCOUT_REFRESH_MS = 7 * 24 * 60 * 60 * 1000;

const UPSERT_SCOUT_TARGET_SQL = `
INSERT INTO pulse_source_scout_targets (
  target_key,
  status,
  place_label,
  anchor_lat,
  anchor_lng,
  bbox_west,
  bbox_south,
  bbox_east,
  bbox_north,
  place_context,
  spatial_scope,
  observed_at,
  next_attempt_at,
  updated_at
)
SELECT
  $1, 'pending', $2, $3, $4, $5, $6, $7, $8,
  $9::jsonb, $10::jsonb, $11::timestamptz, $11::timestamptz, NOW()
WHERE
  EXISTS (SELECT 1 FROM pulse_source_scout_targets WHERE target_key = $1)
  OR (
    SELECT COUNT(*)
    FROM pulse_source_scout_targets
    WHERE status <> 'disabled'
  ) < $12
ON CONFLICT (target_key) DO UPDATE SET
  place_label = EXCLUDED.place_label,
  anchor_lat = EXCLUDED.anchor_lat,
  anchor_lng = EXCLUDED.anchor_lng,
  bbox_west = EXCLUDED.bbox_west,
  bbox_south = EXCLUDED.bbox_south,
  bbox_east = EXCLUDED.bbox_east,
  bbox_north = EXCLUDED.bbox_north,
  place_context = EXCLUDED.place_context,
  spatial_scope = EXCLUDED.spatial_scope,
  observation_count = LEAST(pulse_source_scout_targets.observation_count + 1, 1000000),
  observed_at = GREATEST(pulse_source_scout_targets.observed_at, EXCLUDED.observed_at),
  updated_at = NOW()
RETURNING target_key, status, observation_count
`;

const CLAIM_SCOUT_TARGET_SQL = `
WITH candidate AS (
  SELECT target_key
  FROM pulse_source_scout_targets
  WHERE
    (status IN ('pending', 'retry_wait', 'completed') AND next_attempt_at <= $1::timestamptz)
    OR (status = 'leased' AND lease_until <= $1::timestamptz)
  ORDER BY observation_count DESC, observed_at DESC, target_key ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED
)
UPDATE pulse_source_scout_targets AS target
SET
  status = 'leased',
  lease_token = $2,
  lease_until = $3::timestamptz,
  attempt_count = target.attempt_count + 1,
  updated_at = NOW()
FROM candidate
WHERE target.target_key = candidate.target_key
RETURNING target.*
`;

const COMPLETE_SCOUT_TARGET_SQL = `
UPDATE pulse_source_scout_targets
SET
  status = 'completed',
  completed_at = $3::timestamptz,
  next_attempt_at = $4::timestamptz,
  lease_token = NULL,
  lease_until = NULL,
  attempt_count = 0,
  last_reason = $5,
  discovery_health = COALESCE($6::jsonb, discovery_health),
  updated_at = NOW()
WHERE target_key = $1 AND status = 'leased' AND lease_token = $2
RETURNING target_key, status
`;

const FAIL_SCOUT_TARGET_SQL = `
UPDATE pulse_source_scout_targets
SET
  status = 'retry_wait',
  next_attempt_at = $3::timestamptz,
  lease_token = NULL,
  lease_until = NULL,
  last_reason = $4,
  discovery_health = COALESCE($5::jsonb, discovery_health),
  updated_at = NOW()
WHERE target_key = $1 AND status = 'leased' AND lease_token = $2
RETURNING target_key, status
`;

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

const QUALIFIED_PROFILES_FOR_ANCHOR_SQL = `
SELECT profile
FROM pulse_source_profiles
WHERE catalog_status = 'review_needed'
  AND profile -> 'source_qualification' ->> 'status' = 'qualified_for_review'
  AND bbox_west <= $2
  AND bbox_east >= $2
  AND bbox_south <= $1
  AND bbox_north >= $1
ORDER BY updated_at DESC, profile_key ASC
LIMIT 64
`;

const SOURCE_QUALIFICATION_SQL = `
SELECT profile -> 'source_qualification' AS source_qualification
FROM pulse_source_profiles
WHERE profile_key = $1
  AND catalog_status = 'review_needed'
LIMIT 1
`;

const DISCOVERY_HEALTH_FOR_ANCHOR_SQL = `
SELECT status, last_reason, discovery_health, updated_at
FROM pulse_source_scout_targets
WHERE bbox_west <= $2
  AND bbox_east >= $2
  AND bbox_south <= $1
  AND bbox_north >= $1
ORDER BY observed_at DESC, updated_at DESC, target_key ASC
LIMIT 1
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

  async function listApprovedPlaceFeedsForAnchor({ anchor, now: requestedNow = now() } = {}) {
    const lat = finiteCoordinate(anchor?.lat, -90, 90);
    const lng = finiteCoordinate(anchor?.lng, -180, 180);
    const at = normalizeDate(requestedNow);
    if (lat == null || lng == null || !at) return [];

    try {
      const result = await query(ACTIVE_PROFILES_FOR_ANCHOR_SQL, [lat, lng, at.toISOString()]);
      const profiles = (Array.isArray(result?.rows) ? result.rows : [])
        .map((row) => parseProfile(row?.profile))
        .filter(Boolean);
      return placeFeedsFromReviewedSourceProfiles(profiles, { now: at });
    } catch (_error) {
      return [];
    }
  }

  async function listQualifiedEventFeedsForAnchor({ anchor, now: requestedNow = now() } = {}) {
    const lat = finiteCoordinate(anchor?.lat, -90, 90);
    const lng = finiteCoordinate(anchor?.lng, -180, 180);
    const at = normalizeDate(requestedNow);
    if (lat == null || lng == null || !at) return [];
    try {
      const result = await query(QUALIFIED_PROFILES_FOR_ANCHOR_SQL, [lat, lng]);
      const profiles = (Array.isArray(result?.rows) ? result.rows : [])
        .map((row) => parseProfile(row?.profile))
        .filter(Boolean);
      return eventFeedsFromQualifiedSourceProfiles(profiles, { now: at });
    } catch (_error) {
      return [];
    }
  }

  async function loadSourceQualification(profileKey) {
    const key = publicString(profileKey);
    if (!key?.startsWith("place-source-profile-v1:")) return null;
    try {
      const result = await query(SOURCE_QUALIFICATION_SQL, [key]);
      return normalizeStoredQualification(result?.rows?.[0]?.source_qualification);
    } catch (_error) {
      return null;
    }
  }

  async function getDiscoveryHealthForAnchor({ anchor } = {}) {
    const lat = finiteCoordinate(anchor?.lat, -90, 90);
    const lng = finiteCoordinate(anchor?.lng, -180, 180);
    if (lat == null || lng == null) return null;
    try {
      const result = await query(DISCOVERY_HEALTH_FOR_ANCHOR_SQL, [lat, lng]);
      const row = result?.rows?.[0];
      if (!row) return null;
      const stored = normalizeSourceDiscoveryHealth(parseProfile(row.discovery_health));
      if (stored) return stored;
      const targetStatus = publicString(row.status)?.toLowerCase();
      if (["pending", "leased"].includes(targetStatus)) {
        return pendingSourceDiscoveryHealth("source_discovery_pending");
      }
      return unavailableSourceDiscoveryHealth(
        "unavailable",
        targetStatus === "retry_wait" ? "source_discovery_retry_wait" : "source_discovery_state_unavailable",
      );
    } catch (_error) {
      return unavailableSourceDiscoveryHealth("unavailable", "source_catalog_unavailable");
    }
  }

  async function recordScoutDemand({ anchor, placeLabel, placeContext, spatialScope } = {}) {
    const normalized = normalizeScoutDemand({
      anchor,
      placeLabel,
      placeContext,
      spatialScope,
      observedAt: now(),
    });
    if (!normalized) return { status: "ignored", reason: "untrusted_or_unbounded_scout_demand" };

    try {
      const result = await query(UPSERT_SCOUT_TARGET_SQL, [
        normalized.targetKey,
        normalized.placeLabel,
        normalized.anchor.lat,
        normalized.anchor.lng,
        normalized.bounds.west,
        normalized.bounds.south,
        normalized.bounds.east,
        normalized.bounds.north,
        JSON.stringify(normalized.placeContext),
        JSON.stringify(normalized.spatialScope),
        normalized.observedAt.toISOString(),
        MAX_SCOUT_TARGETS,
      ]);
      const row = result?.rows?.[0];
      return row
        ? {
            status: "recorded",
            target_key: publicString(row.target_key) || normalized.targetKey,
            target_status: publicString(row.status) || "pending",
          }
        : { status: "ignored", reason: "source_scout_queue_capacity" };
    } catch (_error) {
      return { status: "failed", reason: "source_scout_demand_write_failed" };
    }
  }

  async function claimScoutTarget() {
    const claimedAt = normalizeDate(now());
    if (!claimedAt) return null;
    const leaseToken = randomUUID();
    const leaseUntil = new Date(claimedAt.getTime() + SCOUT_LEASE_MS);
    try {
      const result = await query(CLAIM_SCOUT_TARGET_SQL, [
        claimedAt.toISOString(),
        leaseToken,
        leaseUntil.toISOString(),
      ]);
      return normalizeClaimedScoutTarget(result?.rows?.[0], leaseToken);
    } catch (_error) {
      return null;
    }
  }

  async function completeScoutTarget(target, reason = "source_scout_completed", options = {}) {
    const normalized = normalizeLeasedScoutTarget(target);
    const completedAt = normalizeDate(now());
    if (!normalized || !completedAt) return { status: "ignored", reason: "invalid_source_scout_lease" };
    const refreshAt = boundedScoutRefreshAt(completedAt, options?.nextAttemptAt);
    const discoveryHealth = normalizeSourceDiscoveryHealth(options?.discoveryHealth);
    try {
      const result = await query(COMPLETE_SCOUT_TARGET_SQL, [
        normalized.targetKey,
        normalized.leaseToken,
        completedAt.toISOString(),
        refreshAt.toISOString(),
        safeReason(reason, "source_scout_completed"),
        discoveryHealth ? JSON.stringify(discoveryHealth) : null,
      ]);
      return result?.rows?.[0]
        ? { status: "completed", target_key: normalized.targetKey }
        : { status: "ignored", reason: "source_scout_lease_lost" };
    } catch (_error) {
      return { status: "failed", reason: "source_scout_completion_write_failed" };
    }
  }

  async function failScoutTarget(target, reason = "source_scout_failed", options = {}) {
    const normalized = normalizeLeasedScoutTarget(target);
    const failedAt = normalizeDate(now());
    if (!normalized || !failedAt) return { status: "ignored", reason: "invalid_source_scout_lease" };
    const retryAt = new Date(failedAt.getTime() + scoutRetryDelayMs(normalized.attemptCount));
    const discoveryHealth = normalizeSourceDiscoveryHealth(options?.discoveryHealth);
    try {
      const result = await query(FAIL_SCOUT_TARGET_SQL, [
        normalized.targetKey,
        normalized.leaseToken,
        retryAt.toISOString(),
        safeReason(reason, "source_scout_failed"),
        discoveryHealth ? JSON.stringify(discoveryHealth) : null,
      ]);
      return result?.rows?.[0]
        ? { status: "retry_wait", target_key: normalized.targetKey, retry_at: retryAt.toISOString() }
        : { status: "ignored", reason: "source_scout_lease_lost" };
    } catch (_error) {
      return { status: "failed", reason: "source_scout_failure_write_failed" };
    }
  }

  return {
    recordDiscovery,
    recordApprovedProfile,
    listApprovedEventFeedsForAnchor,
    listApprovedPlaceFeedsForAnchor,
    listQualifiedEventFeedsForAnchor,
    loadSourceQualification,
    getDiscoveryHealthForAnchor,
    recordScoutDemand,
    claimScoutTarget,
    completeScoutTarget,
    failScoutTarget,
  };
}

function boundedScoutRefreshAt(completedAt, requestedAt) {
  const earliestAt = new Date(completedAt.getTime() + SCOUT_REPROBE_MIN_MS);
  const defaultAt = new Date(completedAt.getTime() + SCOUT_REFRESH_MS);
  const requested = normalizeDate(requestedAt);
  if (!requested) return defaultAt;
  if (requested < earliestAt) return earliestAt;
  if (requested > defaultAt) return defaultAt;
  return requested;
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
      place_sources: [],
    };
  } else if (forcedStatus === "approved") {
    const eventFeeds = eventFeedsFromReviewedSourceProfiles([cloned], { now: at });
    const placeFeeds = placeFeedsFromReviewedSourceProfiles([cloned], { now: at });
    if (!eventFeeds.length && !placeFeeds.length) return null;
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

function normalizeScoutDemand({ anchor, placeLabel, placeContext, spatialScope, observedAt } = {}) {
  const lat = finiteCoordinate(anchor?.lat, -90, 90);
  const lng = finiteCoordinate(anchor?.lng, -180, 180);
  const label = boundedString(placeLabel, 160);
  const context = normalizePlaceContext(placeContext);
  const scope = deriveLocalAnchorSpatialScope(spatialScope, { lat, lng });
  const at = normalizeDate(observedAt);
  if (
    lat == null ||
    lng == null ||
    !label ||
    !context ||
    !scope?.bounds ||
    !["local_anchor", "regional_bounded"].includes(scope.collection_mode) ||
    !at
  ) return null;
  const identity = [
    scope.kind,
    context.country_code,
    context.locality,
    context.municipality,
    context.region,
    scope.bounds.west.toFixed(3),
    scope.bounds.south.toFixed(3),
    scope.bounds.east.toFixed(3),
    scope.bounds.north.toFixed(3),
  ].filter(Boolean).join("|").toLocaleLowerCase("en-US");
  if (!identity) return null;
  return {
    targetKey: `source-scout-target-v1:${createHash("sha256").update(identity).digest("hex").slice(0, 20)}`,
    placeLabel: label,
    anchor: { lat, lng },
    bounds: scope.bounds,
    placeContext: context,
    spatialScope: scope,
    observedAt: at,
  };
}

function normalizePlaceContext(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const fields = ["locality", "municipality", "county", "region", "country", "country_code"];
  const context = {};
  for (const field of fields) {
    const text = boundedString(value[field], 160);
    if (!text) continue;
    if (field === "country_code" && !/^[a-z]{2}$/i.test(text)) continue;
    context[field] = field === "country_code" ? text.toLowerCase() : text;
  }
  return Object.keys(context).length ? context : null;
}

function normalizeClaimedScoutTarget(row, leaseToken) {
  if (!row || typeof row !== "object") return null;
  const targetKey = publicString(row.target_key);
  const placeLabel = boundedString(row.place_label, 160);
  const anchor = {
    lat: finiteCoordinate(row.anchor_lat, -90, 90),
    lng: finiteCoordinate(row.anchor_lng, -180, 180),
  };
  const placeContext = parseProfile(row.place_context);
  const spatialScope = sanitizeTrustedSpatialScope(parseProfile(row.spatial_scope));
  const attemptCount = positiveInteger(row.attempt_count) || 1;
  if (!targetKey || !placeLabel || anchor.lat == null || anchor.lng == null || !placeContext || !spatialScope) {
    return null;
  }
  return {
    target_key: targetKey,
    lease_token: leaseToken,
    place_label: placeLabel,
    anchor,
    place_context: placeContext,
    spatial_scope: spatialScope,
    attempt_count: attemptCount,
  };
}

function normalizeLeasedScoutTarget(value) {
  const targetKey = publicString(value?.target_key);
  const leaseToken = publicString(value?.lease_token);
  if (!targetKey || !leaseToken) return null;
  return {
    targetKey,
    leaseToken,
    attemptCount: positiveInteger(value?.attempt_count) || 1,
  };
}

function scoutRetryDelayMs(attemptCount) {
  const exponent = Math.min(8, Math.max(0, (positiveInteger(attemptCount) || 1) - 1));
  return Math.min(24 * 60 * 60 * 1000, 5 * 60 * 1000 * (2 ** exponent));
}

function safeReason(value, fallback) {
  const token = publicString(value).toLowerCase();
  return /^[a-z0-9_:-]{1,120}$/.test(token) ? token : fallback;
}

function boundedString(value, maxLength) {
  const text = publicString(value);
  return text && text.length <= maxLength ? text : null;
}

function parseProfile(value) {
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : structuredClone(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch (_error) {
    return null;
  }
}

function normalizeStoredQualification(value) {
  const parsed = parseProfile(value);
  if (!parsed || parsed.schema_version !== 1 || parsed.activation_performed !== false) return null;
  const serialized = JSON.stringify(parsed);
  return Buffer.byteLength(serialized, "utf8") <= MAX_QUALIFICATION_BYTES ? parsed : null;
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
  QUALIFIED_PROFILES_FOR_ANCHOR_SQL,
  CLAIM_SCOUT_TARGET_SQL,
  COMPLETE_SCOUT_TARGET_SQL,
  CATALOG_DATABASE_ENV_KEY,
  CATALOG_FLAG_ENV_KEY,
  DISCOVERY_HEALTH_FOR_ANCHOR_SQL,
  FAIL_SCOUT_TARGET_SQL,
  MAX_SCOUT_TARGETS,
  MAX_PROFILE_BYTES,
  MAX_QUALIFICATION_BYTES,
  SCOUT_LEASE_MS,
  SCOUT_REPROBE_MIN_MS,
  SCOUT_REFRESH_MS,
  SOURCE_QUALIFICATION_SQL,
  UPSERT_APPROVED_PROFILE_SQL,
  UPSERT_DISCOVERY_PROFILE_SQL,
  UPSERT_SCOUT_TARGET_SQL,
  createSourceProfileCatalog,
  boundedScoutRefreshAt,
  normalizeScoutDemand,
  resolveDefaultSourceProfileCatalog,
  scoutRetryDelayMs,
};
