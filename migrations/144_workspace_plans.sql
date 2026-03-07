-- T007: Plan scaffold for workspace-level feature gating

ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS plan_type VARCHAR(20) DEFAULT 'design_partner',
  ADD COLUMN IF NOT EXISTS plan_started_at TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS plan_features JSONB DEFAULT '{}';

UPDATE workspaces SET plan_type = 'design_partner' WHERE plan_type IS NULL;
