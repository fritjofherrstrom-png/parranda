ALTER TABLE pulse_source_scout_targets
  ADD COLUMN IF NOT EXISTS discovery_health JSONB;
