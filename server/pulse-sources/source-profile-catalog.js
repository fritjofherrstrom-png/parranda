"use strict";

const { createHash, randomUUID } = require("node:crypto");
const { eventFeedsFromReviewedSourceProfiles } = require("../place-candidates/reviewed-event-source-profile");
const {
  PLACE_SOURCE_ADAPTER_CONTRACTS,
  placeFeedsFromReviewedSourceProfiles,
  placeSourceAdapterContract,
} = require("../place-candidates/reviewed-place-source-profile");
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
const PLACE_SOURCE_REFRESH_MS = 6 * 60 * 60 * 1000;
const PLACE_SOURCE_CANDIDATE_TTL_MS = 24 * 60 * 60 * 1000;
const APPROVAL_CONTRACT_VERSION = "trusted-place-source-approval-v1";
const MAX_APPROVAL_AGE_MS = 90 * 24 * 60 * 60 * 1000;

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
  profile_revision,
  updated_at
) VALUES (
  $1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb,
  $11::timestamptz, $12::timestamptz, $13::timestamptz, $14, NOW()
)
ON CONFLICT (profile_key) DO UPDATE SET
  catalog_status = CASE
    WHEN pulse_source_profiles.catalog_status = 'review_needed' THEN EXCLUDED.catalog_status
    WHEN pulse_source_profiles.catalog_status = 'approved'
      AND pulse_source_profiles.approved_profile_revision IS DISTINCT FROM EXCLUDED.profile_revision
      THEN 'review_needed'
    ELSE pulse_source_profiles.catalog_status
  END,
  place_label = CASE
    WHEN pulse_source_profiles.catalog_status = 'review_needed'
      OR (pulse_source_profiles.catalog_status = 'approved'
        AND pulse_source_profiles.approved_profile_revision IS DISTINCT FROM EXCLUDED.profile_revision)
      THEN EXCLUDED.place_label
    ELSE pulse_source_profiles.place_label
  END,
  anchor_lat = CASE
    WHEN pulse_source_profiles.catalog_status = 'review_needed'
      OR (pulse_source_profiles.catalog_status = 'approved'
        AND pulse_source_profiles.approved_profile_revision IS DISTINCT FROM EXCLUDED.profile_revision)
      THEN EXCLUDED.anchor_lat
    ELSE pulse_source_profiles.anchor_lat
  END,
  anchor_lng = CASE
    WHEN pulse_source_profiles.catalog_status = 'review_needed'
      OR (pulse_source_profiles.catalog_status = 'approved'
        AND pulse_source_profiles.approved_profile_revision IS DISTINCT FROM EXCLUDED.profile_revision)
      THEN EXCLUDED.anchor_lng
    ELSE pulse_source_profiles.anchor_lng
  END,
  bbox_west = CASE
    WHEN pulse_source_profiles.catalog_status = 'review_needed'
      OR (pulse_source_profiles.catalog_status = 'approved'
        AND pulse_source_profiles.approved_profile_revision IS DISTINCT FROM EXCLUDED.profile_revision)
      THEN EXCLUDED.bbox_west
    ELSE pulse_source_profiles.bbox_west
  END,
  bbox_south = CASE
    WHEN pulse_source_profiles.catalog_status = 'review_needed'
      OR (pulse_source_profiles.catalog_status = 'approved'
        AND pulse_source_profiles.approved_profile_revision IS DISTINCT FROM EXCLUDED.profile_revision)
      THEN EXCLUDED.bbox_south
    ELSE pulse_source_profiles.bbox_south
  END,
  bbox_east = CASE
    WHEN pulse_source_profiles.catalog_status = 'review_needed'
      OR (pulse_source_profiles.catalog_status = 'approved'
        AND pulse_source_profiles.approved_profile_revision IS DISTINCT FROM EXCLUDED.profile_revision)
      THEN EXCLUDED.bbox_east
    ELSE pulse_source_profiles.bbox_east
  END,
  bbox_north = CASE
    WHEN pulse_source_profiles.catalog_status = 'review_needed'
      OR (pulse_source_profiles.catalog_status = 'approved'
        AND pulse_source_profiles.approved_profile_revision IS DISTINCT FROM EXCLUDED.profile_revision)
      THEN EXCLUDED.bbox_north
    ELSE pulse_source_profiles.bbox_north
  END,
  profile = CASE
    WHEN pulse_source_profiles.catalog_status = 'review_needed'
      OR (pulse_source_profiles.catalog_status = 'approved'
        AND pulse_source_profiles.approved_profile_revision IS DISTINCT FROM EXCLUDED.profile_revision)
      THEN EXCLUDED.profile
    ELSE pulse_source_profiles.profile
  END,
  profile_revision = CASE
    WHEN pulse_source_profiles.catalog_status IN ('review_needed', 'approved')
      THEN EXCLUDED.profile_revision
    ELSE pulse_source_profiles.profile_revision
  END,
  discovered_at = LEAST(pulse_source_profiles.discovered_at, EXCLUDED.discovered_at),
  reviewed_at = CASE
    WHEN pulse_source_profiles.catalog_status = 'review_needed'
      OR (pulse_source_profiles.catalog_status = 'approved'
        AND pulse_source_profiles.approved_profile_revision IS DISTINCT FROM EXCLUDED.profile_revision)
      THEN NULL
    ELSE pulse_source_profiles.reviewed_at
  END,
  review_expires_at = CASE
    WHEN pulse_source_profiles.catalog_status = 'review_needed'
      OR (pulse_source_profiles.catalog_status = 'approved'
        AND pulse_source_profiles.approved_profile_revision IS DISTINCT FROM EXCLUDED.profile_revision)
      THEN NULL
    ELSE pulse_source_profiles.review_expires_at
  END,
  approved_profile_revision = CASE
    WHEN pulse_source_profiles.catalog_status = 'approved'
      AND pulse_source_profiles.approved_profile_revision = EXCLUDED.profile_revision
      THEN pulse_source_profiles.approved_profile_revision
    ELSE NULL
  END,
  approval_key = CASE
    WHEN pulse_source_profiles.catalog_status = 'approved'
      AND pulse_source_profiles.approved_profile_revision = EXCLUDED.profile_revision
      THEN pulse_source_profiles.approval_key
    ELSE NULL
  END,
  approval_config_revision = CASE
    WHEN pulse_source_profiles.catalog_status = 'approved'
      AND pulse_source_profiles.approved_profile_revision = EXCLUDED.profile_revision
      THEN pulse_source_profiles.approval_config_revision
    ELSE NULL
  END,
  approved_by = CASE
    WHEN pulse_source_profiles.catalog_status = 'approved'
      AND pulse_source_profiles.approved_profile_revision = EXCLUDED.profile_revision
      THEN pulse_source_profiles.approved_by
    ELSE NULL
  END,
  updated_at = NOW()
RETURNING profile_key, catalog_status
`;

const ACTIVE_PROFILES_FOR_ANCHOR_SQL = `
SELECT profile
FROM pulse_source_profiles
WHERE catalog_status = 'approved'
  AND profile_revision IS NOT NULL
  AND approved_profile_revision = profile_revision
  AND approval_key IS NOT NULL
  AND review_expires_at > $3::timestamptz
  AND bbox_west <= $2
  AND bbox_east >= $2
  AND bbox_south <= $1
  AND bbox_north >= $1
ORDER BY reviewed_at DESC NULLS LAST, profile_key ASC
LIMIT 64
`;

const PROFILE_FOR_REVIEW_SQL = `
SELECT profile, catalog_status, profile_revision, approved_profile_revision,
  approval_key, approval_config_revision, approved_by, reviewed_at, review_expires_at
FROM pulse_source_profiles
WHERE profile_key = $1
LIMIT 1
`;

const APPLY_PROFILE_APPROVAL_SQL = `
WITH approved AS (
  UPDATE pulse_source_profiles
  SET catalog_status = 'approved',
      profile = $4::jsonb,
      profile_revision = $2,
      approved_profile_revision = $2,
      approval_key = $3,
      approval_config_revision = $5,
      approved_by = $6,
      reviewed_at = $7::timestamptz,
      review_expires_at = $8::timestamptz,
      updated_at = NOW()
  WHERE profile_key = $1
    AND catalog_status = 'review_needed'
    AND profile = $9::jsonb
    AND (profile_revision IS NULL OR profile_revision = $2)
  RETURNING profile_key
), audit AS (
  INSERT INTO pulse_source_profile_approvals (
    approval_key, profile_key, profile_revision, approval_config_revision,
    approved_at, approved_by, expires_at, decision
  )
  SELECT $3, $1, $2, $5, $7::timestamptz, $6, $8::timestamptz, $10::jsonb
  FROM approved
  ON CONFLICT (approval_key) DO NOTHING
  RETURNING approval_key
), targets AS (
  INSERT INTO pulse_source_place_refresh_targets (
    profile_key, source_id, profile_revision, approval_key, feed,
    status, attempt_count, next_attempt_at, lease_token, lease_until,
    last_reason, last_completed_at, updated_at
  )
  SELECT $1, source_id, $2, $3, feed, 'pending', 0, $7::timestamptz,
    NULL, NULL, NULL, NULL, NOW()
  FROM approved,
    jsonb_to_recordset($11::jsonb) AS source(source_id text, feed jsonb)
  ON CONFLICT (profile_key, source_id) DO UPDATE SET
    profile_revision = EXCLUDED.profile_revision,
    approval_key = EXCLUDED.approval_key,
    feed = EXCLUDED.feed,
    status = 'pending',
    attempt_count = 0,
    next_attempt_at = EXCLUDED.next_attempt_at,
    lease_token = NULL,
    lease_until = NULL,
    last_reason = NULL,
    updated_at = NOW()
  RETURNING source_id
)
SELECT approved.profile_key, $3::text AS approval_key,
  (SELECT COUNT(*)::integer FROM targets) AS refresh_target_count
FROM approved
`;

const CLAIM_PLACE_SOURCE_REFRESH_SQL = `
WITH candidate AS (
  SELECT target.profile_key, target.source_id
  FROM pulse_source_place_refresh_targets AS target
  JOIN pulse_source_profiles AS profile
    ON profile.profile_key = target.profile_key
   AND profile.catalog_status = 'approved'
   AND profile.profile_revision = target.profile_revision
   AND profile.approved_profile_revision = target.profile_revision
   AND profile.approval_key = target.approval_key
   AND profile.review_expires_at > $1::timestamptz
   AND target.feed->>'adapter_contract_revision' = ANY($4::text[])
  WHERE
    (target.status IN ('pending', 'retry_wait', 'completed') AND target.next_attempt_at <= $1::timestamptz)
    OR (target.status = 'leased' AND target.lease_until <= $1::timestamptz)
  ORDER BY target.next_attempt_at ASC, target.profile_key ASC, target.source_id ASC
  LIMIT 1
  FOR UPDATE OF target SKIP LOCKED
)
UPDATE pulse_source_place_refresh_targets AS target
SET status = 'leased', lease_token = $2, lease_until = $3::timestamptz,
  attempt_count = target.attempt_count + 1, updated_at = NOW()
FROM candidate
WHERE target.profile_key = candidate.profile_key AND target.source_id = candidate.source_id
RETURNING target.*
`;

const COMPLETE_PLACE_SOURCE_REFRESH_SQL = `
WITH current_target AS (
  SELECT target.*
  FROM pulse_source_place_refresh_targets AS target
  JOIN pulse_source_profiles AS profile
    ON profile.profile_key = target.profile_key
   AND profile.catalog_status = 'approved'
   AND profile.profile_revision = target.profile_revision
   AND profile.approved_profile_revision = target.profile_revision
   AND profile.approval_key = target.approval_key
   AND profile.review_expires_at > $5::timestamptz
  WHERE target.profile_key = $1 AND target.source_id = $2
    AND target.status = 'leased' AND target.lease_token = $3
), observation AS (
  INSERT INTO pulse_source_place_fetch_observations (
    fetch_key, profile_key, source_id, profile_revision, approval_key,
    adapter, source_identity, observed_at, status, candidate_count, reason
  )
  SELECT $4, target.profile_key, target.source_id, target.profile_revision,
    target.approval_key, target.feed->>'adapter', target.feed->>'source_identity',
    $5::timestamptz, $6, $7, $8
  FROM current_target AS target
  ON CONFLICT (fetch_key) DO NOTHING
), upserted AS (
  INSERT INTO pulse_source_place_candidates (
    profile_key, source_id, candidate_key, profile_revision, approval_key,
    adapter, source_identity, lat, lng, record, observed_at, expires_at, updated_at
  )
  SELECT target.profile_key, target.source_id, row.candidate_key,
    target.profile_revision, target.approval_key, target.feed->>'adapter',
    target.feed->>'source_identity', row.lat, row.lng, row.record,
    row.observed_at, row.expires_at, NOW()
  FROM current_target AS target,
    jsonb_to_recordset($9::jsonb) AS row(
      candidate_key text, lat double precision, lng double precision,
      record jsonb, observed_at timestamptz, expires_at timestamptz
    )
  ON CONFLICT (profile_key, source_id, candidate_key) DO UPDATE SET
    profile_revision = EXCLUDED.profile_revision,
    approval_key = EXCLUDED.approval_key,
    adapter = EXCLUDED.adapter,
    source_identity = EXCLUDED.source_identity,
    lat = EXCLUDED.lat,
    lng = EXCLUDED.lng,
    record = EXCLUDED.record,
    observed_at = EXCLUDED.observed_at,
    expires_at = EXCLUDED.expires_at,
    updated_at = NOW()
  RETURNING candidate_key
), removed AS (
  DELETE FROM pulse_source_place_candidates AS candidate
  USING current_target AS target
  WHERE candidate.profile_key = target.profile_key
    AND candidate.source_id = target.source_id
    AND candidate.candidate_key NOT IN (
      SELECT row.candidate_key
      FROM jsonb_to_recordset($9::jsonb) AS row(candidate_key text)
    )
  RETURNING candidate.candidate_key
)
UPDATE pulse_source_place_refresh_targets AS target
SET status = 'completed', attempt_count = 0, next_attempt_at = $10::timestamptz,
  lease_token = NULL, lease_until = NULL, last_reason = $8,
  last_completed_at = $5::timestamptz, updated_at = NOW()
FROM current_target
WHERE target.profile_key = current_target.profile_key
  AND target.source_id = current_target.source_id
RETURNING target.profile_key, target.source_id,
  (SELECT COUNT(*)::integer FROM upserted) AS candidate_count
`;

const FAIL_PLACE_SOURCE_REFRESH_SQL = `
WITH current_target AS (
  SELECT target.*
  FROM pulse_source_place_refresh_targets AS target
  WHERE target.profile_key = $1 AND target.source_id = $2
    AND target.status = 'leased' AND target.lease_token = $3
), observation AS (
  INSERT INTO pulse_source_place_fetch_observations (
    fetch_key, profile_key, source_id, profile_revision, approval_key,
    adapter, source_identity, observed_at, status, candidate_count, reason
  )
  SELECT $4, target.profile_key, target.source_id, target.profile_revision,
    target.approval_key, target.feed->>'adapter', target.feed->>'source_identity',
    $5::timestamptz, 'failed', 0, $6
  FROM current_target AS target
  ON CONFLICT (fetch_key) DO NOTHING
)
UPDATE pulse_source_place_refresh_targets AS target
SET status = 'retry_wait', next_attempt_at = $7::timestamptz,
  lease_token = NULL, lease_until = NULL, last_reason = $6, updated_at = NOW()
FROM current_target
WHERE target.profile_key = current_target.profile_key
  AND target.source_id = current_target.source_id
RETURNING target.profile_key, target.source_id
`;

const FRESH_PLACE_CANDIDATES_FOR_ANCHOR_SQL = `
SELECT candidate.record
FROM pulse_source_place_candidates AS candidate
JOIN pulse_source_profiles AS profile
  ON profile.profile_key = candidate.profile_key
 AND profile.catalog_status = 'approved'
 AND profile.profile_revision = candidate.profile_revision
 AND profile.approved_profile_revision = candidate.profile_revision
 AND profile.approval_key = candidate.approval_key
WHERE candidate.expires_at > $3::timestamptz
  AND profile.review_expires_at > $3::timestamptz
  AND profile.bbox_west <= $2
  AND profile.bbox_east >= $2
  AND profile.bbox_south <= $1
  AND profile.bbox_north >= $1
ORDER BY candidate.observed_at DESC, candidate.candidate_key ASC
LIMIT 400
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

const PLACE_SOURCE_QUALIFICATION_SQL = `
SELECT profile -> 'place_source_qualification' AS place_source_qualification
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
        profile_revision: normalized.profileRevision,
      };
    } catch (_error) {
      return { status: "failed", reason: "source_catalog_write_failed" };
    }
  }

  async function recordApprovedProfile(profile) {
    return profile
      ? { status: "rejected", reason: "operator_revision_bound_approval_required" }
      : { status: "rejected", reason: "invalid_reviewed_source_profile" };
  }

  async function inspectProfileForReview(profileKey) {
    const key = publicString(profileKey);
    if (!key?.startsWith("place-source-profile-v1:")) {
      return { status: "rejected", reason: "invalid_profile_key" };
    }
    try {
      const result = await query(PROFILE_FOR_REVIEW_SQL, [key]);
      const row = result?.rows?.[0];
      const profile = parseProfile(row?.profile);
      if (!row || !profile) return { status: "not_found", reason: "source_profile_not_found" };
      const revision = buildProfileReviewRevision(profile);
      if (!revision) return { status: "rejected", reason: "invalid_source_profile" };
      return {
        status: row.catalog_status === "review_needed" ? "reviewable" : "unavailable",
        profile_key: key,
        profile_revision: revision,
        catalog_status: publicString(row.catalog_status),
        place_context: reviewablePlaceContext(profile.place_context),
        place_source_candidates: reviewablePlaceCandidates(profile),
        ...(row.approval_key ? {
          current_approval: {
            approval_key: publicString(row.approval_key),
            profile_revision: publicString(row.approved_profile_revision),
            approval_config_revision: publicString(row.approval_config_revision),
            approved_by: publicString(row.approved_by),
            reviewed_at: normalizeDate(row.reviewed_at)?.toISOString() || null,
            expires_at: normalizeDate(row.review_expires_at)?.toISOString() || null,
          },
        } : {}),
      };
    } catch (_error) {
      return { status: "failed", reason: "source_catalog_read_failed" };
    }
  }

  async function approveProfile(decision, { operatorId } = {}) {
    const key = publicString(decision?.profile_key);
    if (!key?.startsWith("place-source-profile-v1:")) {
      return { status: "rejected", reason: "invalid_profile_key" };
    }
    let row;
    try {
      const loaded = await query(PROFILE_FOR_REVIEW_SQL, [key]);
      row = loaded?.rows?.[0];
    } catch (_error) {
      return { status: "failed", reason: "source_catalog_read_failed" };
    }
    const profile = parseProfile(row?.profile);
    if (!row || !profile) return { status: "not_found", reason: "source_profile_not_found" };
    const built = buildReviewedProfile(profile, decision, { operatorId, now: now() });
    if (!built) return { status: "rejected", reason: "profile_revision_mismatch_or_invalid_review" };

    if (row.catalog_status === "approved") {
      if (
        publicString(row.approval_key) === built.audit.approval_key &&
        publicString(row.approved_profile_revision) === built.audit.profile_revision &&
        publicString(row.approval_config_revision) === built.audit.approval_config_revision
      ) {
        return {
          status: "recorded",
          catalog_status: "approved",
          profile_key: key,
          profile_revision: built.audit.profile_revision,
          approval_key: built.audit.approval_key,
          approval_config_revision: built.audit.approval_config_revision,
          idempotent: true,
        };
      }
      return { status: "rejected", reason: "profile_already_approved" };
    }
    if (row.catalog_status !== "review_needed") {
      return { status: "rejected", reason: "profile_not_reviewable" };
    }

    const feeds = placeFeedsFromReviewedSourceProfiles([built.profile], { now: built.audit.approved_at });
    if (!feeds.length) return { status: "rejected", reason: "approved_place_source_unavailable" };
    const refreshTargets = feeds.map((feed) => ({ source_id: feed.id, feed }));
    try {
      const applied = await query(APPLY_PROFILE_APPROVAL_SQL, [
        key,
        built.audit.profile_revision,
        built.audit.approval_key,
        JSON.stringify(built.profile),
        built.audit.approval_config_revision,
        built.audit.approved_by,
        built.audit.approved_at,
        built.audit.expires_at,
        JSON.stringify(profile),
        JSON.stringify(built.audit.decision),
        JSON.stringify(refreshTargets),
      ]);
      if (!applied?.rows?.[0]) {
        return { status: "rejected", reason: "profile_changed_during_approval" };
      }
      return {
        status: "recorded",
        catalog_status: "approved",
        profile_key: key,
        profile_revision: built.audit.profile_revision,
        approval_key: built.audit.approval_key,
        approval_config_revision: built.audit.approval_config_revision,
        refresh_target_count: Number(applied.rows[0].refresh_target_count) || refreshTargets.length,
        idempotent: false,
      };
    } catch (_error) {
      return { status: "failed", reason: "source_profile_approval_write_failed" };
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

  async function listFreshApprovedPlaceCandidatesForAnchor({ anchor, now: requestedNow = now() } = {}) {
    const lat = finiteCoordinate(anchor?.lat, -90, 90);
    const lng = finiteCoordinate(anchor?.lng, -180, 180);
    const at = normalizeDate(requestedNow);
    if (lat == null || lng == null || !at) return [];
    try {
      const result = await query(FRESH_PLACE_CANDIDATES_FOR_ANCHOR_SQL, [lat, lng, at.toISOString()]);
      const records = (Array.isArray(result?.rows) ? result.rows : [])
        .map((row) => parseProfile(row?.record))
        .filter((record) =>
          validPersistedPlaceRecord(record) &&
          haversineKm(lat, lng, record.lat, record.lng) <= 5,
        )
        .slice(0, 100);
      Object.defineProperty(records, "loader_status", { value: `loaded:${records.length}` });
      return records;
    } catch (_error) {
      const records = [];
      Object.defineProperty(records, "loader_status", { value: "error_failed_closed" });
      Object.defineProperty(records, "loader_error", { value: "source_catalog_read_failed" });
      return records;
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

  async function loadPlaceSourceQualification(profileKey) {
    const key = publicString(profileKey);
    if (!key?.startsWith("place-source-profile-v1:")) return null;
    try {
      const result = await query(PLACE_SOURCE_QUALIFICATION_SQL, [key]);
      return normalizeStoredQualification(result?.rows?.[0]?.place_source_qualification);
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

  async function claimApprovedPlaceSourceRefresh() {
    const claimedAt = normalizeDate(now());
    if (!claimedAt) return null;
    const leaseToken = randomUUID();
    const leaseUntil = new Date(claimedAt.getTime() + SCOUT_LEASE_MS);
    try {
      const result = await query(CLAIM_PLACE_SOURCE_REFRESH_SQL, [
        claimedAt.toISOString(),
        leaseToken,
        leaseUntil.toISOString(),
        Object.values(PLACE_SOURCE_ADAPTER_CONTRACTS),
      ]);
      return normalizeClaimedPlaceSourceRefresh(result?.rows?.[0], leaseToken);
    } catch (_error) {
      return null;
    }
  }

  async function recordApprovedPlaceSourceOutcome(target, outcome = {}) {
    const claimed = normalizeClaimedPlaceSourceRefresh(target, target?.lease_token);
    const observedAt = normalizeDate(outcome.observed_at || now());
    if (!claimed || !observedAt) {
      return { status: "ignored", reason: "invalid_place_source_refresh_lease" };
    }
    const outcomeStatus = ["ok", "empty", "failed"].includes(outcome.status)
      ? outcome.status
      : "failed";
    const reason = safeReason(outcome.reason, outcomeStatus === "failed" ? "source_fetch_failed" : "source_fetch_complete");
    const fetchKey = `place-source-fetch-v1:${createHash("sha256")
      .update(`${claimed.profile_key}|${claimed.source_id}|${claimed.profile_revision}|${observedAt.toISOString()}`)
      .digest("hex").slice(0, 24)}`;

    if (outcomeStatus === "failed") {
      const retryAt = new Date(observedAt.getTime() + scoutRetryDelayMs(claimed.attempt_count));
      try {
        const failed = await query(FAIL_PLACE_SOURCE_REFRESH_SQL, [
          claimed.profile_key,
          claimed.source_id,
          claimed.lease_token,
          fetchKey,
          observedAt.toISOString(),
          reason,
          retryAt.toISOString(),
        ]);
        return failed?.rows?.[0]
          ? { status: "retry_wait", candidate_count: 0, retry_at: retryAt.toISOString() }
          : { status: "ignored", reason: "place_source_refresh_lease_lost" };
      } catch (_error) {
        return { status: "failed", reason: "place_source_refresh_write_failed" };
      }
    }

    const profileExpiry = normalizeDate(claimed.feed?.profile_expires_at);
    const freshnessExpiry = new Date(observedAt.getTime() + PLACE_SOURCE_CANDIDATE_TTL_MS);
    const expiresAt = profileExpiry && profileExpiry < freshnessExpiry ? profileExpiry : freshnessExpiry;
    const normalizedRecords = (Array.isArray(outcome.records) ? outcome.records : [])
      .map((record) => normalizePersistedPlaceRecord(record, {
        target: claimed,
        observedAt,
        expiresAt,
      }))
      .filter(Boolean)
      .slice(0, 100);
    // A provider page may repeat the same stable identity. PostgreSQL cannot
    // update one conflict target twice in the same INSERT, and repetition is
    // not additional evidence, so collapse it before the atomic write.
    const persisted = [...new Map(
      normalizedRecords.map((record) => [record.candidate_key, record]),
    ).values()];
    const nextAttemptAt = new Date(observedAt.getTime() + PLACE_SOURCE_REFRESH_MS);
    try {
      const completed = await query(COMPLETE_PLACE_SOURCE_REFRESH_SQL, [
        claimed.profile_key,
        claimed.source_id,
        claimed.lease_token,
        fetchKey,
        observedAt.toISOString(),
        outcomeStatus,
        persisted.length,
        reason,
        JSON.stringify(persisted),
        nextAttemptAt.toISOString(),
      ]);
      return completed?.rows?.[0]
        ? { status: "completed", candidate_count: persisted.length, next_attempt_at: nextAttemptAt.toISOString() }
        : { status: "ignored", reason: "place_source_refresh_lease_lost" };
    } catch (_error) {
      return { status: "failed", reason: "place_source_refresh_write_failed" };
    }
  }

  return {
    recordDiscovery,
    recordApprovedProfile,
    inspectProfileForReview,
    approveProfile,
    listApprovedEventFeedsForAnchor,
    listApprovedPlaceFeedsForAnchor,
    listFreshApprovedPlaceCandidatesForAnchor,
    listQualifiedEventFeedsForAnchor,
    loadSourceQualification,
    loadPlaceSourceQualification,
    getDiscoveryHealthForAnchor,
    recordScoutDemand,
    claimScoutTarget,
    completeScoutTarget,
    failScoutTarget,
    claimApprovedPlaceSourceRefresh,
    recordApprovedPlaceSourceOutcome,
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
  const profileRevision = buildProfileReviewRevision(cloned);
  if (!profileRevision) return null;

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
    profileRevision,
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
    normalized.profileRevision,
  ];
}

function buildProfileReviewRevision(profile) {
  const parsed = parseProfile(profile);
  const profileKey = publicString(parsed?.profile_key);
  const placeContext = reviewablePlaceContext(parsed?.place_context);
  if (!profileKey?.startsWith("place-source-profile-v1:") || !placeContext?.bounds) return null;
  const candidates = reviewablePlaceCandidates(parsed);
  const surface = {
    contract_version: APPROVAL_CONTRACT_VERSION,
    profile_key: profileKey,
    place_context: placeContext,
    place_source_candidates: candidates,
  };
  return `sha256:${createHash("sha256").update(stableJson(surface)).digest("hex")}`;
}

function buildReviewedProfile(profile, decision, { operatorId, now = new Date() } = {}) {
  const parsed = parseProfile(profile);
  const at = normalizeDate(now);
  const operator = boundedString(operatorId, 160);
  const key = publicString(parsed?.profile_key);
  const expectedKey = publicString(decision?.profile_key);
  const expectedRevision = publicString(decision?.expected_profile_revision);
  const actualRevision = buildProfileReviewRevision(parsed);
  const expiresAt = normalizeDate(decision?.expires_at);
  if (
    !parsed || !at || !operator || !key || key !== expectedKey ||
    !actualRevision || expectedRevision !== actualRevision ||
    decision?.schema_version !== 1 || !expiresAt || expiresAt <= at ||
    expiresAt.getTime() - at.getTime() > MAX_APPROVAL_AGE_MS
  ) return null;

  const candidates = new Map(reviewablePlaceCandidates(parsed).map((candidate) => [candidate.id, candidate]));
  const rows = Array.isArray(decision?.place_sources) ? decision.place_sources : [];
  if (!rows.length || rows.length > 16) return null;
  const placeSources = [];
  const seen = new Set();
  for (const row of rows) {
    const candidateId = publicString(row?.candidate_id);
    const candidate = candidates.get(candidateId);
    if (!candidate || seen.has(candidateId)) return null;
    seen.add(candidateId);
    const id = safeMachineId(row?.id || candidateId);
    const label = boundedString(row?.label || candidate.source_label, 160);
    const evidenceFamily = closedToken(row?.evidence_family, ["official", "editorial"]);
    const sourceTier = closedToken(row?.source_tier, ["official", "editorial", "curated"]);
    const termsStatus = closedToken(row?.terms_status, ["open_license", "api_terms_compatible"]);
    const sourceHealth = closedToken(row?.source_health, ["healthy"]);
    const runtimePolicy = closedToken(row?.runtime_policy, ["active", "bounded_refresh"]);
    if (!id || !label || !evidenceFamily || !sourceTier || !termsStatus || !sourceHealth || !runtimePolicy) {
      return null;
    }
    placeSources.push(compact({
      candidate_id: candidateId,
      id,
      label,
      endpoint: candidate.url,
      adapter: candidate.adapter,
      adapter_contract_revision: candidate.adapter_contract_revision,
      evidence_family: evidenceFamily,
      source_tier: sourceTier,
      source_identity: candidate.source_identity,
      license: boundedString(row?.license, 160),
      terms_status: termsStatus,
      source_health: sourceHealth,
      runtime_policy: runtimePolicy,
      max_items: boundedInteger(
        row?.max_items,
        1,
        candidate.adapter === "experience_card_place_list_detail_html" ? 12 : 100,
      ) || (candidate.adapter === "experience_card_place_list_detail_html" ? 12 : 40),
      priority: finiteNumber(row?.priority),
    }));
  }

  const reviewedAt = at.toISOString();
  const expiry = expiresAt.toISOString();
  const approvedProfile = {
    ...parsed,
    runtime_review: {
      status: "approved",
      reviewed_at: reviewedAt,
      expires_at: expiry,
      feeds: [],
      place_sources: placeSources,
    },
  };
  const validatedFeeds = placeFeedsFromReviewedSourceProfiles([approvedProfile], { now: at });
  if (validatedFeeds.length !== placeSources.length) return null;
  const normalizedDecision = {
    schema_version: 1,
    contract_version: APPROVAL_CONTRACT_VERSION,
    profile_key: key,
    expected_profile_revision: actualRevision,
    expires_at: expiry,
    place_sources: placeSources.map((row) => ({
      candidate_id: row.candidate_id,
      id: row.id,
      evidence_family: row.evidence_family,
      source_tier: row.source_tier,
      license: row.license,
      terms_status: row.terms_status,
      source_health: row.source_health,
      runtime_policy: row.runtime_policy,
      max_items: row.max_items,
      priority: row.priority,
    })),
  };
  const approvalConfigRevision = `sha256:${createHash("sha256")
    .update(stableJson(normalizedDecision)).digest("hex")}`;
  const approvalKey = `source-profile-approval-v1:${createHash("sha256")
    .update(`${key}|${actualRevision}|${approvalConfigRevision}`).digest("hex").slice(0, 24)}`;
  return {
    profile: approvedProfile,
    audit: {
      approval_key: approvalKey,
      profile_key: key,
      profile_revision: actualRevision,
      approval_config_revision: approvalConfigRevision,
      approved_at: reviewedAt,
      approved_by: operator,
      expires_at: expiry,
      decision: normalizedDecision,
    },
  };
}

function reviewablePlaceContext(value) {
  const bounds = normalizeBounds(value?.bounds);
  if (!bounds) return null;
  return compact({
    label: boundedString(value?.label, 160),
    lat: finiteCoordinate(value?.lat, -90, 90),
    lng: finiteCoordinate(value?.lng, -180, 180),
    bounds,
  });
}

function reviewablePlaceCandidates(profile) {
  const candidates = [];
  for (const family of Array.isArray(profile?.source_families) ? profile.source_families : []) {
    for (const candidate of Array.isArray(family?.candidates) ? family.candidates : []) candidates.push(candidate);
  }
  for (const candidate of Array.isArray(profile?.place_source_candidates)
    ? profile.place_source_candidates
    : []) candidates.push(candidate);
  const seen = new Set();
  return candidates
    .map((candidate) => compact({
      id: boundedString(candidate?.id, 160),
      source_label: boundedString(candidate?.source_label, 160),
      url: safeHttpsUrl(candidate?.url),
      status: closedToken(candidate?.status, [
        "viable_provider_probe",
        "needs_adapter_or_permission",
        "viable_place_provider_probe",
      ]),
      adapter: closedToken(candidate?.adapter, [
        "schema_org_place",
        "schema_org_place_html",
        "schema_org_place_json",
        "experience_card_place_list_detail_html",
        "map_linked_place_html",
      ]),
      adapter_contract_revision: placeSourceAdapterContract(candidate?.adapter),
      maps_to_existing_provider: candidate?.maps_to_existing_provider === true,
      trust_tier: boundedString(candidate?.trust_tier, 40),
      source_identity: boundedString(candidate?.source_identity, 200),
      candidate_kind: boundedString(candidate?.candidate_kind, 80),
      corroboration_required: candidate?.corroboration_required === true,
    }))
    .filter((candidate) =>
      candidate.id && candidate.url && candidate.status && candidate.adapter &&
      candidate.maps_to_existing_provider === true && candidate.source_identity,
    )
    .filter((candidate) => {
      if (seen.has(candidate.id)) return false;
      seen.add(candidate.id);
      return true;
    })
    .sort((left, right) => left.id.localeCompare(right.id));
}

function normalizeClaimedPlaceSourceRefresh(row, leaseToken) {
  const profileKey = publicString(row?.profile_key);
  const sourceId = safeMachineId(row?.source_id);
  const profileRevision = publicString(row?.profile_revision);
  const approvalKey = publicString(row?.approval_key);
  const token = publicString(leaseToken || row?.lease_token);
  const feed = parseProfile(row?.feed);
  if (
    !profileKey?.startsWith("place-source-profile-v1:") || !sourceId ||
    !profileRevision?.startsWith("sha256:") ||
    !approvalKey?.startsWith("source-profile-approval-v1:") || !token ||
    !feed || feed.id !== sourceId || !safeHttpsUrl(feed.endpoint) ||
    !closedToken(feed.adapter, [
      "schema_org_place_html",
      "schema_org_place_json",
      "experience_card_place_list_detail_html",
      "map_linked_place_html",
    ]) ||
    feed.adapter_contract_revision !== placeSourceAdapterContract(feed.adapter) ||
    !boundedString(feed.source_identity, 200)
  ) return null;
  return {
    profile_key: profileKey,
    source_id: sourceId,
    profile_revision: profileRevision,
    approval_key: approvalKey,
    feed,
    lease_token: token,
    attempt_count: positiveInteger(row?.attempt_count) || 1,
  };
}

function normalizePersistedPlaceRecord(record, { target, observedAt, expiresAt } = {}) {
  const parsed = parseProfile(record);
  const id = boundedString(parsed?.id, 240);
  const lat = finiteCoordinate(parsed?.lat, -90, 90);
  const lng = finiteCoordinate(parsed?.lng, -180, 180);
  if (
    !id || lat == null || lng == null || !normalizeDate(observedAt) ||
    !normalizeDate(expiresAt) || parsed?.operator_reviewed_source !== true ||
    parsed?.source_policy !== "reviewed_profile_bounded_refresh"
  ) return null;
  const enriched = {
    ...parsed,
    freshness: "fresh",
    source_profile_key: target.profile_key,
    source_profile_revision: target.profile_revision,
    source_approval_key: target.approval_key,
    source_feed_id: target.source_id,
    source_adapter: target.feed.adapter,
    source_adapter_contract_revision: target.feed.adapter_contract_revision,
    source_identity: target.feed.source_identity,
    source_observed_at: observedAt.toISOString(),
    source_expires_at: expiresAt.toISOString(),
  };
  return {
    candidate_key: id,
    lat,
    lng,
    record: enriched,
    observed_at: observedAt.toISOString(),
    expires_at: expiresAt.toISOString(),
  };
}

function validPersistedPlaceRecord(record) {
  return Boolean(
    record && typeof record === "object" &&
    boundedString(record.id, 240) && boundedString(record.name, 160) &&
    finiteCoordinate(record.lat, -90, 90) != null &&
    finiteCoordinate(record.lng, -180, 180) != null &&
    record.operator_reviewed_source === true &&
    record.source_policy === "reviewed_profile_bounded_refresh" &&
    publicString(record.source_profile_key)?.startsWith("place-source-profile-v1:") &&
    publicString(record.source_profile_revision)?.startsWith("sha256:") &&
    publicString(record.source_approval_key)?.startsWith("source-profile-approval-v1:") &&
    safeMachineId(record.source_feed_id) &&
    closedToken(record.source_adapter, [
      "schema_org_place_html",
      "schema_org_place_json",
      "experience_card_place_list_detail_html",
      "map_linked_place_html",
    ]) &&
    record.source_adapter_contract_revision === placeSourceAdapterContract(record.source_adapter) &&
    normalizeDate(record.source_observed_at) && normalizeDate(record.source_expires_at)
  );
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function compact(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item != null && item !== ""));
}

function safeMachineId(value) {
  const token = boundedString(value, 120);
  return token && /^[a-z0-9][a-z0-9._:-]*$/i.test(token) ? token : null;
}

function safeHttpsUrl(value) {
  try {
    const url = new URL(publicString(value));
    if (url.protocol !== "https:" || url.username || url.password) return null;
    url.hash = "";
    return url.toString();
  } catch (_error) {
    return null;
  }
}

function closedToken(value, allowed) {
  const token = publicString(value)?.toLowerCase();
  return token && allowed.includes(token) ? token : null;
}

function boundedInteger(value, min, max) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, Math.floor(number))) : null;
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function haversineKm(lat1, lng1, lat2, lng2) {
  const radians = (degrees) => (degrees * Math.PI) / 180;
  const dLat = radians(lat2 - lat1);
  const dLng = radians(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(radians(lat1)) * Math.cos(radians(lat2)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
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
  const token = publicString(value)?.toLowerCase() || "";
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
  APPLY_PROFILE_APPROVAL_SQL,
  ACTIVE_PROFILES_FOR_ANCHOR_SQL,
  APPROVAL_CONTRACT_VERSION,
  CLAIM_PLACE_SOURCE_REFRESH_SQL,
  QUALIFIED_PROFILES_FOR_ANCHOR_SQL,
  PLACE_SOURCE_QUALIFICATION_SQL,
  CLAIM_SCOUT_TARGET_SQL,
  COMPLETE_SCOUT_TARGET_SQL,
  CATALOG_DATABASE_ENV_KEY,
  CATALOG_FLAG_ENV_KEY,
  DISCOVERY_HEALTH_FOR_ANCHOR_SQL,
  COMPLETE_PLACE_SOURCE_REFRESH_SQL,
  FAIL_PLACE_SOURCE_REFRESH_SQL,
  FRESH_PLACE_CANDIDATES_FOR_ANCHOR_SQL,
  FAIL_SCOUT_TARGET_SQL,
  MAX_SCOUT_TARGETS,
  MAX_PROFILE_BYTES,
  MAX_QUALIFICATION_BYTES,
  SCOUT_LEASE_MS,
  SCOUT_REPROBE_MIN_MS,
  SCOUT_REFRESH_MS,
  SOURCE_QUALIFICATION_SQL,
  UPSERT_DISCOVERY_PROFILE_SQL,
  UPSERT_SCOUT_TARGET_SQL,
  PROFILE_FOR_REVIEW_SQL,
  createSourceProfileCatalog,
  boundedScoutRefreshAt,
  buildProfileReviewRevision,
  buildReviewedProfile,
  normalizeScoutDemand,
  resolveDefaultSourceProfileCatalog,
  scoutRetryDelayMs,
};
