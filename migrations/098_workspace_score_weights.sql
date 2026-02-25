-- Workspace score weights table for production and experimental scoring
-- Allows per-workspace A/B testing of composite score formulas

CREATE TABLE IF NOT EXISTS workspace_score_weights (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,

  weight_type TEXT NOT NULL CHECK (weight_type IN ('production', 'experimental')),

  -- Weights must sum to 1.0
  crm_weight NUMERIC NOT NULL CHECK (crm_weight >= 0 AND crm_weight <= 1),
  findings_weight NUMERIC NOT NULL CHECK (findings_weight >= 0 AND findings_weight <= 1),
  conversations_weight NUMERIC NOT NULL CHECK (conversations_weight >= 0 AND conversations_weight <= 1),

  active BOOLEAN NOT NULL DEFAULT false,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(workspace_id, weight_type),
  CHECK (crm_weight + findings_weight + conversations_weight = 1.0)
);

CREATE INDEX idx_workspace_score_weights_workspace ON workspace_score_weights(workspace_id);
CREATE INDEX idx_workspace_score_weights_active ON workspace_score_weights(workspace_id, weight_type, active) WHERE active = true;

COMMENT ON TABLE workspace_score_weights IS 'Per-workspace score weighting for production and experimental scoring models';
COMMENT ON COLUMN workspace_score_weights.weight_type IS 'production (active) or experimental (A/B test)';
COMMENT ON COLUMN workspace_score_weights.active IS 'Whether this weight set is active (only one per type per workspace)';

-- Seed production weights for all existing workspaces (0.40 CRM, 0.35 findings, 0.25 conversations)
INSERT INTO workspace_score_weights (workspace_id, weight_type, crm_weight, findings_weight, conversations_weight, active)
SELECT
  id,
  'production',
  0.40,
  0.35,
  0.25,
  true
FROM workspaces
ON CONFLICT (workspace_id, weight_type) DO NOTHING;
