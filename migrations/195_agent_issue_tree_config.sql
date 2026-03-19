-- Migration 195: Agent Issue Tree Config
-- Extends agent_issue_tree with config fields for config-driven Orchestrator
-- All columns are nullable — existing rows unaffected

ALTER TABLE agent_issue_tree
  ADD COLUMN IF NOT EXISTS section_intent TEXT,
  -- Values: 'forecast' | 'pipeline_health' | 'execution' | 'hygiene' | 'retention' | 'generation' | 'custom'
  -- Tells the Orchestrator what kind of analysis to run for this section

  ADD COLUMN IF NOT EXISTS action_format TEXT DEFAULT 'deal_level',
  -- Values: 'deal_level' | 'rep_level' | 'system_level' | 'auto'
  -- 'deal_level': TODAY: Close Beacon ($108K)
  -- 'rep_level': THIS WEEK: Coach Nate on hygiene
  -- 'system_level': CONFIGURE: Add required fields

  ADD COLUMN IF NOT EXISTS data_extraction_config JSONB DEFAULT '{}',
  -- Controls what the Orchestrator extracts from skill output for this section:
  -- {
  --   extract_deals: boolean,
  --   extract_contacts: boolean,
  --   extract_rep_metrics: boolean,
  --   extract_activities: boolean,
  --   key_metrics: string[]
  -- }

  ADD COLUMN IF NOT EXISTS reasoning_layers TEXT[] DEFAULT ARRAY['cause', 'second_order', 'third_order', 'action'];
  -- Which reasoning tree layers to generate
  -- Hygiene sections might skip third_order
  -- Simple sections might only need cause + action

COMMENT ON COLUMN agent_issue_tree.section_intent IS 'Type of analysis: forecast, pipeline_health, execution, hygiene, retention, generation, custom';
COMMENT ON COLUMN agent_issue_tree.action_format IS 'Level of actions generated: deal_level, rep_level, system_level, auto';
COMMENT ON COLUMN agent_issue_tree.data_extraction_config IS 'JSON config for what data to extract from skills';
COMMENT ON COLUMN agent_issue_tree.reasoning_layers IS 'Array of reasoning tree layers to generate for this section';
