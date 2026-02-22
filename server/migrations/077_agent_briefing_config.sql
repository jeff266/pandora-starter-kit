-- 077: Agent Briefing Config + Agent Templates Table
-- Extends agents table with briefing configuration columns
-- Creates agent_templates table for pre-built starting points

ALTER TABLE agents ADD COLUMN IF NOT EXISTS audience JSONB DEFAULT '{}';
ALTER TABLE agents ADD COLUMN IF NOT EXISTS focus_questions JSONB DEFAULT '[]';
ALTER TABLE agents ADD COLUMN IF NOT EXISTS data_window JSONB DEFAULT '{"primary": "current_week", "comparison": "previous_period"}';
ALTER TABLE agents ADD COLUMN IF NOT EXISTS output_formats JSONB DEFAULT '["slack"]';
ALTER TABLE agents ADD COLUMN IF NOT EXISTS event_config JSONB;

CREATE TABLE IF NOT EXISTS agent_templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  icon TEXT,
  category TEXT DEFAULT 'briefing',
  defaults JSONB NOT NULL,
  prep_agent JSONB,
  is_system BOOLEAN DEFAULT true,
  workspace_id UUID REFERENCES workspaces(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_templates_category ON agent_templates(category);
CREATE INDEX IF NOT EXISTS idx_agent_templates_workspace ON agent_templates(workspace_id) WHERE workspace_id IS NOT NULL;
