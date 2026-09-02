ALTER TABLE pulse_source_profiles
  ADD COLUMN IF NOT EXISTS profile_revision TEXT,
  ADD COLUMN IF NOT EXISTS approved_profile_revision TEXT,
  ADD COLUMN IF NOT EXISTS approval_key TEXT,
  ADD COLUMN IF NOT EXISTS approval_config_revision TEXT,
  ADD COLUMN IF NOT EXISTS approved_by TEXT;

CREATE TABLE IF NOT EXISTS pulse_source_profile_approvals (
  approval_key TEXT PRIMARY KEY,
  profile_key TEXT NOT NULL REFERENCES pulse_source_profiles(profile_key),
  profile_revision TEXT NOT NULL,
  approval_config_revision TEXT NOT NULL,
  approved_at TIMESTAMPTZ NOT NULL,
  approved_by TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  decision JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (profile_key, profile_revision, approval_config_revision),
  CHECK (expires_at > approved_at)
);

CREATE INDEX IF NOT EXISTS pulse_source_profile_approvals_profile_idx
  ON pulse_source_profile_approvals (profile_key, approved_at DESC);

CREATE TABLE IF NOT EXISTS pulse_source_place_refresh_targets (
  profile_key TEXT NOT NULL REFERENCES pulse_source_profiles(profile_key),
  source_id TEXT NOT NULL,
  profile_revision TEXT NOT NULL,
  approval_key TEXT NOT NULL REFERENCES pulse_source_profile_approvals(approval_key),
  feed JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (
    status IN ('pending', 'leased', 'retry_wait', 'completed', 'disabled')
  ),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  next_attempt_at TIMESTAMPTZ NOT NULL,
  lease_token TEXT,
  lease_until TIMESTAMPTZ,
  last_reason TEXT,
  last_completed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (profile_key, source_id),
  CHECK (
    status <> 'leased'
    OR (lease_token IS NOT NULL AND lease_until IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS pulse_source_place_refresh_claim_idx
  ON pulse_source_place_refresh_targets (status, next_attempt_at, lease_until);

CREATE TABLE IF NOT EXISTS pulse_source_place_fetch_observations (
  fetch_key TEXT PRIMARY KEY,
  profile_key TEXT NOT NULL REFERENCES pulse_source_profiles(profile_key),
  source_id TEXT NOT NULL,
  profile_revision TEXT NOT NULL,
  approval_key TEXT NOT NULL REFERENCES pulse_source_profile_approvals(approval_key),
  adapter TEXT NOT NULL,
  source_identity TEXT NOT NULL,
  observed_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('ok', 'empty', 'failed')),
  candidate_count INTEGER NOT NULL CHECK (candidate_count >= 0),
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS pulse_source_place_fetch_profile_idx
  ON pulse_source_place_fetch_observations (profile_key, source_id, observed_at DESC);

CREATE TABLE IF NOT EXISTS pulse_source_place_candidates (
  profile_key TEXT NOT NULL REFERENCES pulse_source_profiles(profile_key),
  source_id TEXT NOT NULL,
  candidate_key TEXT NOT NULL,
  profile_revision TEXT NOT NULL,
  approval_key TEXT NOT NULL REFERENCES pulse_source_profile_approvals(approval_key),
  adapter TEXT NOT NULL,
  source_identity TEXT NOT NULL,
  lat DOUBLE PRECISION NOT NULL CHECK (lat BETWEEN -90 AND 90),
  lng DOUBLE PRECISION NOT NULL CHECK (lng BETWEEN -180 AND 180),
  record JSONB NOT NULL,
  observed_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (profile_key, source_id, candidate_key),
  CHECK (expires_at > observed_at)
);

CREATE INDEX IF NOT EXISTS pulse_source_place_candidates_active_geo_idx
  ON pulse_source_place_candidates (
    profile_key,
    profile_revision,
    expires_at,
    lat,
    lng
  );
