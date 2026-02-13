-- Migration 018: Headless ActivePieces Workflow Engine
-- Tables for Ring 2 of Actions Engine: Generated Workflows
-- Spec: PANDORA_HEADLESS_ACTIVEPIECES_SPEC.md

-- ============================================================================
-- Workflow Definitions (Pandora's abstract workflow representation)
-- ============================================================================

CREATE TABLE workflow_definitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,

  -- Identity
  name TEXT NOT NULL,
  description TEXT,
  slug TEXT NOT NULL,                    -- 'stale-deal-cleanup', 'manager-escalation'

  -- Tree definition (Pandora's abstract workflow format)
  tree JSONB NOT NULL,                   -- See Tree Definition Schema in spec

  -- ActivePieces mapping
  ap_flow_id TEXT,                       -- AP flow ID after compilation
  ap_flow_version TEXT,                  -- AP flow version (for change tracking)
  compiled_at TIMESTAMPTZ,              -- When last compiled to AP
  compilation_hash TEXT,                 -- Hash of tree JSON at compilation time

  -- Status
  status TEXT NOT NULL DEFAULT 'draft',  -- 'draft', 'active', 'paused', 'error'
  enabled BOOLEAN DEFAULT false,

  -- Trigger binding
  trigger_type TEXT NOT NULL,            -- 'action_event', 'schedule', 'webhook', 'manual'
  trigger_config JSONB DEFAULT '{}',     -- Cron expression, action types, etc.

  -- Template origin
  template_id UUID,                      -- References workflow_templates(id) - FK added after table creation

  -- Metadata
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),

  -- Constraints
  UNIQUE(workspace_id, slug)
);

CREATE INDEX idx_workflow_def_workspace ON workflow_definitions(workspace_id, status);
CREATE INDEX idx_workflow_def_trigger ON workflow_definitions(trigger_type, enabled);
CREATE INDEX idx_workflow_def_template ON workflow_definitions(template_id) WHERE template_id IS NOT NULL;

COMMENT ON TABLE workflow_definitions IS 'Workflow definitions in Pandora abstract tree format. Compiled to ActivePieces flows on activation.';
COMMENT ON COLUMN workflow_definitions.tree IS 'Abstract workflow tree with trigger + steps. Decouples UX from AP internal format.';
COMMENT ON COLUMN workflow_definitions.compilation_hash IS 'Hash of tree JSON at last compilation. Used to detect when recompilation is needed.';

-- ============================================================================
-- Workflow Execution Records (Pandora's view of AP runs)
-- ============================================================================

CREATE TABLE workflow_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  workflow_id UUID NOT NULL REFERENCES workflow_definitions(id) ON DELETE CASCADE,

  -- ActivePieces mapping
  ap_run_id TEXT NOT NULL,               -- AP flow run ID

  -- Trigger context
  trigger_action_id UUID REFERENCES actions(id) ON DELETE SET NULL,  -- If triggered by an action
  trigger_payload JSONB,                 -- What triggered this run

  -- Execution
  status TEXT NOT NULL DEFAULT 'running', -- 'running', 'succeeded', 'failed', 'timeout'
  started_at TIMESTAMPTZ DEFAULT now(),
  completed_at TIMESTAMPTZ,
  duration_ms INTEGER,

  -- Result
  result JSONB,                          -- Success: step outputs. Failure: error details
  steps_completed INTEGER DEFAULT 0,
  steps_total INTEGER,

  -- Error handling
  error_message TEXT,
  error_step TEXT,                        -- Which step failed
  retry_count INTEGER DEFAULT 0,

  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_workflow_runs_workflow ON workflow_runs(workflow_id, started_at DESC);
CREATE INDEX idx_workflow_runs_workspace ON workflow_runs(workspace_id, started_at DESC);
CREATE INDEX idx_workflow_runs_status ON workflow_runs(status) WHERE status = 'running';
CREATE INDEX idx_workflow_runs_action ON workflow_runs(trigger_action_id) WHERE trigger_action_id IS NOT NULL;

COMMENT ON TABLE workflow_runs IS 'Execution records for workflows. Synced from ActivePieces flow runs.';
COMMENT ON COLUMN workflow_runs.ap_run_id IS 'ActivePieces flow run ID for status polling.';

-- ============================================================================
-- Workflow Templates (Pre-built patterns)
-- ============================================================================

CREATE TABLE workflow_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  name TEXT NOT NULL,
  description TEXT NOT NULL,
  category TEXT NOT NULL,                -- 'deal_management', 'notifications', 'data_hygiene', 'escalation'

  -- Template tree (with placeholder variables)
  tree JSONB NOT NULL,

  -- Requirements
  required_connectors TEXT[] NOT NULL DEFAULT '{}',   -- ['hubspot'] or ['salesforce', 'slack']
  required_action_types TEXT[] DEFAULT '{}',          -- ['re_engage_deal', 'close_stale_deal']

  -- Display
  icon TEXT,
  tags TEXT[] DEFAULT '{}',
  popularity INTEGER DEFAULT 0,          -- Usage count

  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_workflow_templates_category ON workflow_templates(category);

COMMENT ON TABLE workflow_templates IS 'Pre-built workflow patterns users can instantiate with one click.';

-- Add FK from workflow_definitions to workflow_templates
ALTER TABLE workflow_definitions
  ADD CONSTRAINT fk_workflow_template
  FOREIGN KEY (template_id) REFERENCES workflow_templates(id) ON DELETE SET NULL;

-- ============================================================================
-- Connector Registry (AP pieces availability and gating)
-- ============================================================================

CREATE TABLE connector_registry (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- ActivePieces piece identity
  piece_name TEXT NOT NULL UNIQUE,       -- '@activepieces/piece-hubspot'
  display_name TEXT NOT NULL,            -- 'HubSpot'

  -- Pandora connector mapping
  pandora_connector_type TEXT,           -- 'hubspot' — NULL if no Pandora connector

  -- Gating
  gate_status TEXT NOT NULL DEFAULT 'available',  -- 'available', 'beta', 'gated', 'disabled'
  gate_reason TEXT,                      -- 'Requires enterprise plan', 'Coming soon'
  requires_plan TEXT,                    -- 'starter', 'growth', 'enterprise'

  -- Metadata
  piece_version TEXT,                    -- Pinned version
  supported_triggers TEXT[] DEFAULT '{}',         -- ['new_deal', 'deal_updated', 'new_contact']
  supported_actions TEXT[] DEFAULT '{}',          -- ['update_deal', 'create_note', 'send_email']

  -- Capabilities
  supports_oauth BOOLEAN DEFAULT false,
  supports_api_key BOOLEAN DEFAULT false,
  auth_type TEXT,                        -- 'PLATFORM_OAUTH2', 'SECRET_TEXT', 'CUSTOM_AUTH'

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_connector_registry_status ON connector_registry(gate_status);
CREATE INDEX idx_connector_registry_pandora ON connector_registry(pandora_connector_type) WHERE pandora_connector_type IS NOT NULL;

COMMENT ON TABLE connector_registry IS 'ActivePieces pieces registry with gating controls and Pandora connector mappings.';

-- ============================================================================
-- Seed Data: Connector Registry
-- ============================================================================

INSERT INTO connector_registry (piece_name, display_name, pandora_connector_type, gate_status, auth_type, supported_actions, supports_oauth) VALUES
-- Ring 1: Native Pandora connectors (auto-provisioned connections)
('@activepieces/piece-hubspot', 'HubSpot', 'hubspot', 'available', 'PLATFORM_OAUTH2',
  ARRAY['update_deal', 'create_note', 'update_contact', 'create_task'], true),
('@activepieces/piece-salesforce', 'Salesforce', 'salesforce', 'available', 'PLATFORM_OAUTH2',
  ARRAY['update_record', 'create_note', 'create_task'], true),
('@activepieces/piece-slack', 'Slack', 'slack', 'available', 'PLATFORM_OAUTH2',
  ARRAY['send_message', 'send_dm', 'send_block_message', 'create_channel'], true),

-- Ring 2: Common integrations (user provides credentials in AP)
('@activepieces/piece-gmail', 'Gmail', NULL, 'available', 'PLATFORM_OAUTH2',
  ARRAY['send_email', 'create_draft'], true),
('@activepieces/piece-google-sheets', 'Google Sheets', NULL, 'available', 'PLATFORM_OAUTH2',
  ARRAY['insert_row', 'update_row', 'lookup_row'], true),
('@activepieces/piece-asana', 'Asana', 'asana', 'beta', 'PLATFORM_OAUTH2',
  ARRAY['create_task', 'update_task'], true),
('@activepieces/piece-monday', 'Monday.com', 'monday', 'beta', 'PLATFORM_OAUTH2',
  ARRAY['create_item', 'update_item'], true),

-- Ring 3: Advanced / Enterprise
('@activepieces/piece-openai', 'OpenAI', NULL, 'gated', 'SECRET_TEXT',
  ARRAY['chat_completion', 'generate_image'], false),
('@activepieces/piece-http', 'HTTP Request', NULL, 'available', NULL,
  ARRAY['send_request'], false),
('@activepieces/piece-webhook', 'Webhook', NULL, 'available', NULL,
  ARRAY['send_webhook'], false),
('@activepieces/piece-delay', 'Delay', NULL, 'available', NULL,
  ARRAY['delay'], false);

-- ============================================================================
-- Update Triggers
-- ============================================================================

CREATE TRIGGER workflow_definitions_updated_at
  BEFORE UPDATE ON workflow_definitions
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER connector_registry_updated_at
  BEFORE UPDATE ON connector_registry
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
