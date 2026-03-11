-- Migration 164: Skill Runs Config Stamp
-- Adds methodology config tracking to skill_runs for audit trail
-- Enables "what config drove this finding?" reconstruction

ALTER TABLE skill_runs
  ADD COLUMN IF NOT EXISTS methodology_config_id UUID REFERENCES methodology_configs(id),
  ADD COLUMN IF NOT EXISTS methodology_config_version INTEGER,
  ADD COLUMN IF NOT EXISTS context_snapshot JSONB;

-- Index for finding runs by config
CREATE INDEX IF NOT EXISTS idx_skill_runs_methodology_config
ON skill_runs(methodology_config_id)
WHERE methodology_config_id IS NOT NULL;

-- Comments
COMMENT ON COLUMN skill_runs.methodology_config_id IS 'References the methodology_configs row active when this skill run executed';
COMMENT ON COLUMN skill_runs.methodology_config_version IS 'Snapshot of config version number at execution time';
COMMENT ON COLUMN skill_runs.context_snapshot IS 'Lightweight capture of key config values: { base_methodology, scope, version, config_hash }';
