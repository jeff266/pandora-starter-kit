-- Track before/after snapshots for every internal action write
CREATE TABLE IF NOT EXISTS knowledge_change_log (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid        NOT NULL,
  table_name    varchar(64) NOT NULL,
  record_key    text        NOT NULL,
  action_id     uuid        REFERENCES actions(id) ON DELETE SET NULL,
  changed_by    text        NOT NULL DEFAULT 'system',
  change_type   varchar(16) NOT NULL DEFAULT 'write',  -- 'write' | 'revert'
  before_snapshot jsonb,          -- NULL on first-ever write
  after_snapshot  jsonb,          -- NULL when reverting a first-ever write (row deleted)
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_knowledge_change_log_workspace_table_key
  ON knowledge_change_log (workspace_id, table_name, record_key);

CREATE INDEX IF NOT EXISTS idx_knowledge_change_log_action_id
  ON knowledge_change_log (action_id)
  WHERE action_id IS NOT NULL;
