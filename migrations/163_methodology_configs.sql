-- Migration 163: Methodology Configs
-- Enables workspace-specific customization of sales methodology frameworks
-- with versioning, scope cascade, and audit trail

CREATE TABLE methodology_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,

  -- Scope (cascade: workspace → segment → product, most specific wins)
  scope_type TEXT NOT NULL DEFAULT 'workspace' CHECK (scope_type IN (
    'workspace', 'segment', 'product', 'segment_product'
  )),
  scope_segment TEXT,   -- e.g. 'enterprise', 'smb', 'mid-market'
  scope_product TEXT,   -- e.g. 'platform', 'services', 'expansion'

  -- Base framework (maps to methodology-frameworks.ts keys)
  base_methodology TEXT NOT NULL,  -- e.g. 'gap_selling', 'miller_heiman', 'meddpicc'
  display_name TEXT,               -- Custom name: "Frontera Enterprise Qualification"

  -- User-authored prompt sections (JSONB for flexibility)
  config JSONB NOT NULL DEFAULT '{}',
  -- Schema of config object:
  -- {
  --   problem_definition: string,       // What counts as confirmed pain in our ICP
  --   champion_signals: string,         // How we identify a champion in our market
  --   economic_buyer_signals: string,   // Title/behavior patterns for EB
  --   disqualifying_signals: string,    // What triggers a DQ recommendation
  --   qualifying_questions: string[],   // Questions reps should ask (feeds call scoring)
  --   stage_criteria: {                 // Per-stage advancement evidence requirements
  --     [stage_name]: string
  --   },
  --   framework_fields: {              // Per-framework field definitions
  --     [field_key]: {
  --       label: string,               // Custom label override
  --       description: string,         // What counts as this field being filled
  --       detection_hints: string,     // Vocabulary/signals specific to their market
  --       crm_field_key: string        // Which CRM field to write back to
  --     }
  --   },
  --   call_scoring_rubric: {           // Per-dimension scoring weights
  --     [dimension]: {
  --       weight: number,
  --       pass_signals: string[],
  --       fail_signals: string[]
  --     }
  --   }
  -- }

  -- Versioning
  version INTEGER NOT NULL DEFAULT 1,
  is_current BOOLEAN NOT NULL DEFAULT true,  -- only one current per workspace+scope
  parent_version_id UUID REFERENCES methodology_configs(id),

  -- Metadata
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_methodology_configs_workspace ON methodology_configs(workspace_id);
CREATE INDEX idx_methodology_configs_scope ON methodology_configs(workspace_id, scope_type, scope_segment, scope_product);
CREATE INDEX idx_methodology_configs_current ON methodology_configs(workspace_id, is_current) WHERE is_current = true;
CREATE INDEX idx_methodology_configs_version_chain ON methodology_configs(parent_version_id) WHERE parent_version_id IS NOT NULL;

-- Unique constraint: one current config per workspace + scope combo
-- Using partial unique index to handle NULLs properly
CREATE UNIQUE INDEX idx_methodology_configs_unique_current
ON methodology_configs(workspace_id, scope_type, COALESCE(scope_segment, ''), COALESCE(scope_product, ''))
WHERE is_current = true;

-- Auto-update timestamp trigger
CREATE OR REPLACE FUNCTION update_methodology_configs_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER methodology_configs_updated_at
  BEFORE UPDATE ON methodology_configs
  FOR EACH ROW
  EXECUTE FUNCTION update_methodology_configs_updated_at();

-- Comments
COMMENT ON TABLE methodology_configs IS 'Workspace-customizable sales methodology framework configurations with versioning and scope cascade';
COMMENT ON COLUMN methodology_configs.scope_type IS 'Scope level: workspace (default) | segment | product | segment_product';
COMMENT ON COLUMN methodology_configs.config IS 'JSONB containing workspace-specific framework customizations (problem_definition, champion_signals, framework_fields, call_scoring_rubric, etc.)';
COMMENT ON COLUMN methodology_configs.version IS 'Version number, increments with each update to create audit trail';
COMMENT ON COLUMN methodology_configs.is_current IS 'Only one current version per workspace+scope combination';
COMMENT ON COLUMN methodology_configs.parent_version_id IS 'Links to previous version for version history chain';
