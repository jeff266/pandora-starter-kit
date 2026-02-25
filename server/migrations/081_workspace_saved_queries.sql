-- workspace_saved_queries: user-created query forks
CREATE TABLE IF NOT EXISTS workspace_saved_queries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  sql_text TEXT NOT NULL,

  -- Provenance: where this query came from
  source_type TEXT NOT NULL DEFAULT 'scratch',  -- 'tool', 'skill', 'scratch'
  source_id TEXT,                                -- tool id or skill id it was forked from
  source_name TEXT,                              -- display name of the source

  -- DeepSeek interpretation (populated async after save)
  predicates JSONB DEFAULT '[]',                 -- extracted filter predicates
  applicable_skills TEXT[] DEFAULT '{}',         -- skill IDs this filter applies to

  -- Metadata
  last_run_at TIMESTAMPTZ,
  last_run_rows INTEGER,
  last_run_ms INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_by TEXT                                -- user email or ID
);

CREATE INDEX idx_saved_queries_workspace ON workspace_saved_queries(workspace_id);
