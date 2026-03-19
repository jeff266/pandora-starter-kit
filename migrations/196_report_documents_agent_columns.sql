-- Migration 196: Add agent_id and config to report_documents
-- Enables agent runs to write to report_documents for unified Reports timeline

ALTER TABLE report_documents
  ADD COLUMN IF NOT EXISTS agent_id UUID REFERENCES agents(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS config JSONB DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_report_documents_agent
  ON report_documents(agent_id)
  WHERE agent_id IS NOT NULL;

COMMENT ON COLUMN report_documents.agent_id IS 'Agent that generated this report (NULL for scheduled briefings)';
COMMENT ON COLUMN report_documents.config IS 'Agent metadata: agent_name, agent_goal, run_id, skills_run';
