CREATE TABLE IF NOT EXISTS workflow_definitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  slug TEXT NOT NULL,
  tree JSONB NOT NULL,
  ap_flow_id TEXT,
  ap_flow_version TEXT,
  compiled_at TIMESTAMPTZ,
  compilation_hash TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'paused', 'error')),
  enabled BOOLEAN NOT NULL DEFAULT false,
  trigger_type TEXT NOT NULL CHECK (trigger_type IN ('action_event', 'schedule', 'webhook', 'manual')),
  trigger_config JSONB NOT NULL DEFAULT '{}',
  template_id UUID,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, slug)
);

CREATE TABLE IF NOT EXISTS workflow_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  workflow_id UUID NOT NULL REFERENCES workflow_definitions(id) ON DELETE CASCADE,
  ap_run_id TEXT,
  trigger_action_id UUID,
  trigger_payload JSONB,
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'succeeded', 'failed', 'timeout')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  duration_ms INTEGER,
  result JSONB,
  steps_completed INTEGER NOT NULL DEFAULT 0,
  steps_total INTEGER,
  error_message TEXT,
  error_step TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS workflow_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL,
  category TEXT NOT NULL,
  tree JSONB NOT NULL,
  required_connectors TEXT[] NOT NULL DEFAULT '{}',
  required_action_types TEXT[] NOT NULL DEFAULT '{}',
  icon TEXT,
  tags TEXT[] NOT NULL DEFAULT '{}',
  popularity INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS connector_registry (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  piece_name TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  pandora_connector_type TEXT,
  gate_status TEXT NOT NULL DEFAULT 'available' CHECK (gate_status IN ('available', 'beta', 'gated', 'disabled')),
  gate_reason TEXT,
  requires_plan TEXT CHECK (requires_plan IN ('starter', 'growth', 'enterprise')),
  piece_version TEXT,
  supported_triggers TEXT[] NOT NULL DEFAULT '{}',
  supported_actions TEXT[] NOT NULL DEFAULT '{}',
  supports_oauth BOOLEAN NOT NULL DEFAULT false,
  supports_api_key BOOLEAN NOT NULL DEFAULT false,
  auth_type TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_workflow_definitions_workspace ON workflow_definitions(workspace_id);
CREATE INDEX IF NOT EXISTS idx_workflow_definitions_status ON workflow_definitions(workspace_id, status);
CREATE INDEX IF NOT EXISTS idx_workflow_definitions_trigger ON workflow_definitions(workspace_id, trigger_type);
CREATE INDEX IF NOT EXISTS idx_workflow_runs_workflow ON workflow_runs(workflow_id);
CREATE INDEX IF NOT EXISTS idx_workflow_runs_status ON workflow_runs(status) WHERE status = 'running';
CREATE INDEX IF NOT EXISTS idx_workflow_runs_workspace ON workflow_runs(workspace_id);
CREATE INDEX IF NOT EXISTS idx_connector_registry_pandora ON connector_registry(pandora_connector_type);

INSERT INTO connector_registry (piece_name, display_name, pandora_connector_type, gate_status, supports_oauth, supported_actions, supported_triggers)
VALUES
  ('@activepieces/piece-hubspot', 'HubSpot', 'hubspot', 'available', true,
   ARRAY['create_contact', 'update_contact', 'create_deal', 'update_deal', 'create_note', 'search_contacts'],
   ARRAY['new_contact', 'new_deal', 'deal_stage_changed']),
  ('@activepieces/piece-salesforce', 'Salesforce', 'salesforce', 'available', true,
   ARRAY['create_record', 'update_record', 'query_records', 'create_note'],
   ARRAY['new_record', 'updated_record']),
  ('@activepieces/piece-slack', 'Slack', 'slack', 'available', true,
   ARRAY['send_message', 'send_dm', 'send_approval', 'create_channel', 'add_reaction'],
   ARRAY['new_message']),
  ('@activepieces/piece-google-sheets', 'Google Sheets', NULL, 'available', true,
   ARRAY['insert_row', 'update_row', 'get_values', 'create_spreadsheet'],
   ARRAY['new_row']),
  ('@activepieces/piece-gmail', 'Gmail', NULL, 'available', true,
   ARRAY['send_email', 'read_email'],
   ARRAY['new_email']),
  ('@activepieces/piece-http', 'HTTP / Webhooks', NULL, 'available', false,
   ARRAY['send_request'],
   ARRAY['catch_webhook']),
  ('@activepieces/piece-schedule', 'Schedule', NULL, 'available', false,
   ARRAY[],
   ARRAY['every_hour', 'every_day', 'every_week', 'cron_expression'])
ON CONFLICT (piece_name) DO NOTHING;
