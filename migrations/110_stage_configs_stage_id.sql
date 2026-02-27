ALTER TABLE stage_configs ADD COLUMN IF NOT EXISTS stage_id TEXT;
CREATE INDEX IF NOT EXISTS idx_stage_configs_stage_id ON stage_configs(workspace_id, stage_id);
