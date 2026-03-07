-- Cross-Session Workspace Memory
-- Tracks recurring findings, strategic context, and cross-session entity state

CREATE TABLE IF NOT EXISTS workspace_memory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  
  -- Type of memory: 'recurring_finding', 'strategic_priority', 'entity_context', 'data_gap'
  memory_type VARCHAR(50) NOT NULL,
  
  -- Optional entity linkage
  entity_type VARCHAR(50), -- 'deal', 'account', 'rep', 'contact'
  entity_id UUID,
  entity_name VARCHAR(255),
  
  -- Time period scoping (optional)
  period_start DATE,
  period_end DATE,
  period_label VARCHAR(50), -- 'W12', 'Q1-2024'
  
  -- Content
  content JSONB NOT NULL DEFAULT '{}',
  summary TEXT NOT NULL,
  
  -- Metadata for persistence/recurrence
  occurrence_count INTEGER DEFAULT 1,
  first_seen_at TIMESTAMPTZ DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Source tracking
  source_skill_run_ids UUID[] DEFAULT '{}',
  source_document_ids UUID[] DEFAULT '{}',
  
  -- Resolution status
  is_resolved BOOLEAN DEFAULT FALSE,
  resolved_at TIMESTAMPTZ,
  resolution_note TEXT,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS workspace_memory_workspace_type_idx ON workspace_memory(workspace_id, memory_type) WHERE is_resolved = FALSE;
CREATE INDEX IF NOT EXISTS workspace_memory_entity_idx ON workspace_memory(entity_type, entity_id) WHERE entity_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS workspace_memory_period_idx ON workspace_memory(workspace_id, period_label);
CREATE INDEX IF NOT EXISTS workspace_memory_last_seen_idx ON workspace_memory(workspace_id, last_seen_at DESC);
