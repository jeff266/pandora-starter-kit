-- CRM Write-Back Audit Log
-- Records every write operation (update, create) made to external CRM systems.
-- Used for compliance, debugging, and rollback reference.

CREATE TABLE IF NOT EXISTS crm_write_log (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID NOT NULL REFERENCES workspaces(id),
  connector_name TEXT NOT NULL,          -- 'hubspot' | 'salesforce'
  operation     TEXT NOT NULL,           -- 'update_deal' | 'create_task' | 'update_contact'
  object_type   TEXT NOT NULL,           -- 'deal' | 'task' | 'contact' | 'opportunity'
  source_id     TEXT,                    -- CRM-side record ID (HubSpot/Salesforce ID)
  pandora_id    UUID,                    -- Pandora-side entity ID (deals.id, contacts.id, etc.)
  payload       JSONB NOT NULL,          -- fields/properties sent to CRM
  success       BOOLEAN NOT NULL,
  error         TEXT,                    -- error message on failure
  response      JSONB,                   -- raw CRM API response
  duration_ms   INTEGER,                 -- round-trip time
  triggered_by  TEXT NOT NULL DEFAULT 'system',  -- 'system' | 'playbook:pipeline-state' | 'user:email@...'
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for workspace + time range queries (audit dashboard)
CREATE INDEX IF NOT EXISTS idx_crm_write_log_workspace_time
  ON crm_write_log (workspace_id, created_at DESC);

-- Index for finding writes to a specific CRM record
CREATE INDEX IF NOT EXISTS idx_crm_write_log_source
  ON crm_write_log (connector_name, source_id)
  WHERE source_id IS NOT NULL;

-- Index for failure analysis
CREATE INDEX IF NOT EXISTS idx_crm_write_log_failures
  ON crm_write_log (workspace_id, success)
  WHERE success = false;
