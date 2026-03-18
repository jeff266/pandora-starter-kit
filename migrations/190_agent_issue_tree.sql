-- Migration 190: Agent Issue Tree
-- Adds MECE issue tree structure to agents

-- Add use_issue_tree flag and custom_skill_ids to agents table
ALTER TABLE agents
  ADD COLUMN IF NOT EXISTS use_issue_tree BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS custom_skill_ids TEXT[] NOT NULL DEFAULT '{}';

-- Create agent_issue_tree table for structured MECE report nodes
CREATE TABLE IF NOT EXISTS agent_issue_tree (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id TEXT NOT NULL,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  node_id TEXT NOT NULL,
  title TEXT NOT NULL,
  standing_question TEXT,
  mece_category TEXT NOT NULL DEFAULT 'custom',
  primary_skill_ids TEXT[] NOT NULL DEFAULT '{}',
  position INTEGER NOT NULL DEFAULT 1,
  confirmed_pattern BOOLEAN NOT NULL DEFAULT FALSE,
  pattern_summary TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (agent_id, node_id)
);

CREATE INDEX IF NOT EXISTS idx_agent_issue_tree_agent ON agent_issue_tree(agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_issue_tree_workspace ON agent_issue_tree(workspace_id);
CREATE INDEX IF NOT EXISTS idx_agent_issue_tree_position ON agent_issue_tree(agent_id, position);

COMMENT ON TABLE agent_issue_tree IS 'MECE issue tree nodes for structured agent reports';
COMMENT ON COLUMN agent_issue_tree.node_id IS 'Slug-style identifier, unique per agent (e.g. deal_execution)';
COMMENT ON COLUMN agent_issue_tree.mece_category IS 'generation | conversion | execution | retention | custom';
COMMENT ON COLUMN agent_issue_tree.primary_skill_ids IS 'Skill IDs to run for this section';
COMMENT ON COLUMN agent_issue_tree.confirmed_pattern IS 'True when pattern has been confirmed over 6+ weeks';
COMMENT ON COLUMN agent_issue_tree.pattern_summary IS 'Human-readable summary of the confirmed pattern';
