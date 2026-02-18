-- Agent Builder: workspace-scoped agents backed by delivery rules
CREATE TABLE IF NOT EXISTS agents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,

  name TEXT NOT NULL,
  description TEXT,
  template_id TEXT,
  icon TEXT DEFAULT '🤖',

  skill_ids TEXT[] NOT NULL DEFAULT '{}',
  focus_config JSONB NOT NULL DEFAULT '{}',

  delivery_rule_id UUID REFERENCES delivery_rules(id) ON DELETE SET NULL,

  estimated_tokens_per_week INT,
  estimated_deliveries_per_week FLOAT,
  estimated_findings_per_delivery FLOAT,
  fatigue_score INT,
  focus_score INT,

  is_active BOOLEAN DEFAULT false,
  is_template BOOLEAN DEFAULT false,

  last_run_at TIMESTAMPTZ,
  total_deliveries INT DEFAULT 0,
  total_findings_delivered INT DEFAULT 0,

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agents_workspace ON agents(workspace_id);
CREATE INDEX IF NOT EXISTS idx_agents_active ON agents(workspace_id, is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_agents_template ON agents(template_id) WHERE is_template = true;
