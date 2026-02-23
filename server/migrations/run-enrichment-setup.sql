-- Manual migration script for enrichment setup
-- Run this if npm run migrate fails

-- 084: workspace_settings table
CREATE TABLE IF NOT EXISTS workspace_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(workspace_id, key)
);

CREATE INDEX IF NOT EXISTS idx_workspace_settings_workspace ON workspace_settings(workspace_id);
CREATE INDEX IF NOT EXISTS idx_workspace_settings_key ON workspace_settings(workspace_id, key);

-- 085: enriched_accounts table
CREATE TABLE IF NOT EXISTS enriched_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,

  -- Identifiers
  domain TEXT,
  company_name TEXT,

  -- Firmographic data
  industry TEXT,
  employee_count INTEGER,
  employee_range TEXT,
  revenue_range TEXT,
  funding_stage TEXT,

  -- Location
  hq_country TEXT,
  hq_state TEXT,
  hq_city TEXT,

  -- Signals
  tech_stack TEXT[],
  growth_signal TEXT,
  founded_year INTEGER,
  public_or_private TEXT,

  -- Metadata
  enrichment_source TEXT NOT NULL CHECK (enrichment_source IN ('apollo', 'webhook', 'csv')),
  confidence_score REAL NOT NULL CHECK (confidence_score >= 0.0 AND confidence_score <= 1.0),
  pandora_batch_id TEXT,
  enriched_at TIMESTAMPTZ DEFAULT NOW(),

  CONSTRAINT enriched_accounts_check_identifier CHECK (domain IS NOT NULL OR company_name IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_enriched_accounts_workspace ON enriched_accounts(workspace_id);
CREATE INDEX IF NOT EXISTS idx_enriched_accounts_domain ON enriched_accounts(workspace_id, domain);
CREATE INDEX IF NOT EXISTS idx_enriched_accounts_company ON enriched_accounts(workspace_id, company_name);
CREATE INDEX IF NOT EXISTS idx_enriched_accounts_source ON enriched_accounts(workspace_id, enrichment_source);
CREATE INDEX IF NOT EXISTS idx_enriched_accounts_batch ON enriched_accounts(workspace_id, pandora_batch_id);

-- 086: webhook connector tables
CREATE TABLE IF NOT EXISTS webhook_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  deactivated_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_webhook_tokens_workspace ON webhook_tokens(workspace_id);
CREATE INDEX IF NOT EXISTS idx_webhook_tokens_active ON webhook_tokens(workspace_id, is_active) WHERE is_active = true;

CREATE TABLE IF NOT EXISTS webhook_outbound_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  endpoint_url TEXT NOT NULL,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(workspace_id)
);

CREATE TABLE IF NOT EXISTS webhook_delivery_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  config_id UUID NOT NULL REFERENCES webhook_outbound_configs(id) ON DELETE CASCADE,
  payload JSONB NOT NULL,
  attempt_count INTEGER DEFAULT 0,
  last_attempt_at TIMESTAMPTZ,
  last_status_code INTEGER,
  last_error TEXT,
  retry_at TIMESTAMPTZ,
  delivered BOOLEAN DEFAULT false,
  delivered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_webhook_delivery_workspace ON webhook_delivery_log(workspace_id);
CREATE INDEX IF NOT EXISTS idx_webhook_delivery_retry ON webhook_delivery_log(retry_at) WHERE retry_at IS NOT NULL AND delivered = false;

CREATE TABLE IF NOT EXISTS webhook_dead_letter_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  delivery_id UUID NOT NULL REFERENCES webhook_delivery_log(id) ON DELETE CASCADE,
  payload JSONB NOT NULL,
  final_error TEXT,
  final_attempt_count INTEGER,
  replayed BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_webhook_dlq_workspace ON webhook_dead_letter_queue(workspace_id);
CREATE INDEX IF NOT EXISTS idx_webhook_dlq_replayed ON webhook_dead_letter_queue(workspace_id, replayed);

CREATE TABLE IF NOT EXISTS webhook_inbound_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  batch_id TEXT NOT NULL,
  records_received INTEGER NOT NULL,
  records_matched INTEGER NOT NULL,
  records_failed INTEGER NOT NULL,
  received_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(workspace_id, batch_id)
);

CREATE INDEX IF NOT EXISTS idx_webhook_inbound_workspace ON webhook_inbound_log(workspace_id);
CREATE INDEX IF NOT EXISTS idx_webhook_inbound_batch ON webhook_inbound_log(workspace_id, batch_id);

-- 087: csv_imports table
CREATE TABLE IF NOT EXISTS csv_imports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  row_count INTEGER NOT NULL,
  column_mappings JSONB NOT NULL,
  records_imported INTEGER DEFAULT 0,
  records_matched INTEGER DEFAULT 0,
  records_unmatched INTEGER DEFAULT 0,
  unmatched_records JSONB,
  average_confidence REAL,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_csv_imports_workspace ON csv_imports(workspace_id);
CREATE INDEX IF NOT EXISTS idx_csv_imports_status ON csv_imports(workspace_id, status);

-- Record migrations as completed
INSERT INTO migrations (name, applied_at)
VALUES
  ('084_workspace_settings.sql', NOW()),
  ('085_enriched_accounts.sql', NOW()),
  ('086_webhook_connector.sql', NOW()),
  ('087_csv_imports.sql', NOW())
ON CONFLICT (name) DO NOTHING;

-- Verify
SELECT 'Migration complete. Tables created:' as status;
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
AND table_name IN ('workspace_settings', 'enriched_accounts', 'webhook_tokens', 'csv_imports')
ORDER BY table_name;
