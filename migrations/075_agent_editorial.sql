-- Phase 1: Agent Editorial Synthesis Engine
-- Links agents to report templates and adds editorial metadata

-- Link report templates to agents (only if table exists)
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'report_templates') THEN
    ALTER TABLE report_templates ADD COLUMN IF NOT EXISTS agent_id UUID REFERENCES agents(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_rt_agent ON report_templates(agent_id) WHERE agent_id IS NOT NULL;
    COMMENT ON COLUMN report_templates.agent_id IS 'If set, this template uses agent editorial synthesis instead of static section generation';
  END IF;
END $$;

-- Add editorial metadata to report_generations (only if table exists)
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'report_generations') THEN
    ALTER TABLE report_generations ADD COLUMN IF NOT EXISTS agent_id UUID REFERENCES agents(id);
    ALTER TABLE report_generations ADD COLUMN IF NOT EXISTS editorial_decisions JSONB;
    ALTER TABLE report_generations ADD COLUMN IF NOT EXISTS opening_narrative TEXT;
    ALTER TABLE report_generations ADD COLUMN IF NOT EXISTS run_digest JSONB;

    CREATE INDEX IF NOT EXISTS idx_rg_agent_digest
      ON report_generations(workspace_id, agent_id, created_at DESC)
      WHERE agent_id IS NOT NULL AND triggered_by != 'preview';

    COMMENT ON COLUMN report_generations.editorial_decisions IS 'Editorial decisions made by the agent (lead_with, drop_section, etc.)';
    COMMENT ON COLUMN report_generations.opening_narrative IS 'The narrative opening produced by the agent';
    COMMENT ON COLUMN report_generations.run_digest IS 'Compressed summary of this run for Phase 3 self-reference';
  END IF;
END $$;
