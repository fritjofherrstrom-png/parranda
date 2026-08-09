CREATE TABLE IF NOT EXISTS pulse_source_scout_targets (
  target_key TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (
    status IN ('pending', 'leased', 'retry_wait', 'completed', 'disabled')
  ),
  place_label TEXT NOT NULL,
  anchor_lat DOUBLE PRECISION NOT NULL CHECK (anchor_lat BETWEEN -90 AND 90),
  anchor_lng DOUBLE PRECISION NOT NULL CHECK (anchor_lng BETWEEN -180 AND 180),
  bbox_west DOUBLE PRECISION NOT NULL CHECK (bbox_west BETWEEN -180 AND 180),
  bbox_south DOUBLE PRECISION NOT NULL CHECK (bbox_south BETWEEN -90 AND 90),
  bbox_east DOUBLE PRECISION NOT NULL CHECK (bbox_east BETWEEN -180 AND 180),
  bbox_north DOUBLE PRECISION NOT NULL CHECK (bbox_north BETWEEN -90 AND 90),
  place_context JSONB NOT NULL,
  spatial_scope JSONB NOT NULL,
  observation_count INTEGER NOT NULL DEFAULT 1 CHECK (observation_count > 0),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  observed_at TIMESTAMPTZ NOT NULL,
  next_attempt_at TIMESTAMPTZ NOT NULL,
  lease_token TEXT,
  lease_until TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  last_reason TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (bbox_west <= bbox_east),
  CHECK (bbox_south <= bbox_north),
  CHECK (
    status <> 'leased'
    OR (lease_token IS NOT NULL AND lease_until IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS pulse_source_scout_targets_claim_idx
  ON pulse_source_scout_targets (
    status,
    next_attempt_at,
    lease_until,
    completed_at,
    observation_count DESC,
    observed_at DESC
  );
