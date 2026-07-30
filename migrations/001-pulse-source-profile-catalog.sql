CREATE TABLE IF NOT EXISTS pulse_source_profiles (
  profile_key TEXT PRIMARY KEY,
  catalog_status TEXT NOT NULL CHECK (
    catalog_status IN ('review_needed', 'approved', 'rejected', 'disabled')
  ),
  place_label TEXT,
  anchor_lat DOUBLE PRECISION,
  anchor_lng DOUBLE PRECISION,
  bbox_west DOUBLE PRECISION NOT NULL CHECK (bbox_west BETWEEN -180 AND 180),
  bbox_south DOUBLE PRECISION NOT NULL CHECK (bbox_south BETWEEN -90 AND 90),
  bbox_east DOUBLE PRECISION NOT NULL CHECK (bbox_east BETWEEN -180 AND 180),
  bbox_north DOUBLE PRECISION NOT NULL CHECK (bbox_north BETWEEN -90 AND 90),
  profile JSONB NOT NULL,
  discovered_at TIMESTAMPTZ NOT NULL,
  reviewed_at TIMESTAMPTZ,
  review_expires_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (bbox_west <= bbox_east),
  CHECK (bbox_south <= bbox_north),
  CHECK (
    catalog_status <> 'approved'
    OR (reviewed_at IS NOT NULL AND review_expires_at IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS pulse_source_profiles_geo_active_idx
  ON pulse_source_profiles (
    catalog_status,
    bbox_west,
    bbox_east,
    bbox_south,
    bbox_north,
    review_expires_at
  );
