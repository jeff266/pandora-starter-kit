-- ICP profile storage
CREATE TABLE IF NOT EXISTS icp_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  generated_at TIMESTAMPTZ DEFAULT NOW(),
  profile JSONB NOT NULL,
  deal_sample_size INT,
  confidence TEXT CHECK (confidence IN ('high', 'medium', 'low')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_icp_profiles_workspace ON icp_profiles(workspace_id, generated_at DESC);

-- ICP fit scores on deals table
ALTER TABLE deals ADD COLUMN IF NOT EXISTS icp_fit_score INT;
ALTER TABLE deals ADD COLUMN IF NOT EXISTS icp_fit_at TIMESTAMPTZ;
