-- Migration 082: Webhook Connector Infrastructure
-- Creates tables for bidirectional webhook enrichment connector

-- ============================================================================
-- Webhook Tokens (Inbound Authentication)
-- ============================================================================
CREATE TABLE IF NOT EXISTS webhook_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  rotated_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_webhook_tokens_workspace ON webhook_tokens(workspace_id);
CREATE INDEX IF NOT EXISTS idx_webhook_tokens_token ON webhook_tokens(token) WHERE is_active = true;
CREATE UNIQUE INDEX IF NOT EXISTS idx_webhook_tokens_unique_active ON webhook_tokens(workspace_id) WHERE is_active = true;

COMMENT ON TABLE webhook_tokens IS 'Rotatable authentication tokens for inbound webhook endpoints';
COMMENT ON COLUMN webhook_tokens.token IS 'URL-safe random token embedded in webhook path';
COMMENT ON COLUMN webhook_tokens.is_active IS 'Only one active token per workspace at a time';

-- ============================================================================
-- Outbound Webhook Configuration
-- ============================================================================
CREATE TABLE IF NOT EXISTS webhook_outbound_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  endpoint_url TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  last_test_at TIMESTAMPTZ,
  last_test_success BOOLEAN,
  last_test_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT webhook_outbound_configs_one_per_workspace UNIQUE (workspace_id)
);

CREATE INDEX IF NOT EXISTS idx_webhook_outbound_workspace ON webhook_outbound_configs(workspace_id);

COMMENT ON TABLE webhook_outbound_configs IS 'User-configured webhook URLs for outbound enrichment requests';
COMMENT ON COLUMN webhook_outbound_configs.endpoint_url IS 'Clay, Zapier, Make, or custom webhook URL';

-- ============================================================================
-- Outbound Delivery Log
-- ============================================================================
CREATE TABLE IF NOT EXISTS webhook_delivery_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  batch_id TEXT NOT NULL,
  endpoint_url TEXT NOT NULL,
  payload JSONB NOT NULL,
  attempt_number INTEGER NOT NULL DEFAULT 1,
  status_code INTEGER,
  response_body TEXT,
  error_message TEXT,
  delivered_at TIMESTAMPTZ,
  retry_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT webhook_delivery_log_check_attempt CHECK (attempt_number >= 1 AND attempt_number <= 7)
);

CREATE INDEX IF NOT EXISTS idx_webhook_delivery_workspace ON webhook_delivery_log(workspace_id);
CREATE INDEX IF NOT EXISTS idx_webhook_delivery_batch ON webhook_delivery_log(batch_id);
CREATE INDEX IF NOT EXISTS idx_webhook_delivery_retry ON webhook_delivery_log(retry_at) WHERE retry_at IS NOT NULL;

COMMENT ON TABLE webhook_delivery_log IS 'Tracks all outbound webhook delivery attempts with retry history';
COMMENT ON COLUMN webhook_delivery_log.batch_id IS 'pandora_batch_id for idempotency tracking';
COMMENT ON COLUMN webhook_delivery_log.attempt_number IS 'Retry attempt number (1-7)';
COMMENT ON COLUMN webhook_delivery_log.retry_at IS 'Scheduled time for next retry attempt';

-- ============================================================================
-- Dead Letter Queue
-- ============================================================================
CREATE TABLE IF NOT EXISTS webhook_dead_letter_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  batch_id TEXT NOT NULL,
  endpoint_url TEXT NOT NULL,
  payload JSONB NOT NULL,
  final_error TEXT NOT NULL,
  final_status_code INTEGER,
  total_attempts INTEGER NOT NULL DEFAULT 7,
  failed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  replayed BOOLEAN NOT NULL DEFAULT false,
  replayed_at TIMESTAMPTZ,
  replay_result TEXT
);

CREATE INDEX IF NOT EXISTS idx_webhook_dlq_workspace ON webhook_dead_letter_queue(workspace_id);
CREATE INDEX IF NOT EXISTS idx_webhook_dlq_replayed ON webhook_dead_letter_queue(replayed);

COMMENT ON TABLE webhook_dead_letter_queue IS 'Failed outbound webhook payloads after exhausting all retry attempts';
COMMENT ON COLUMN webhook_dead_letter_queue.replayed IS 'Whether admin has manually replayed this failed delivery';

-- ============================================================================
-- Inbound Processing Log (for deduplication)
-- ============================================================================
CREATE TABLE IF NOT EXISTS webhook_inbound_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  batch_id TEXT NOT NULL,
  records_received INTEGER NOT NULL,
  records_processed INTEGER NOT NULL,
  records_matched INTEGER NOT NULL,
  records_failed INTEGER NOT NULL,
  error_details JSONB,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT webhook_inbound_log_unique_batch UNIQUE (workspace_id, batch_id)
);

CREATE INDEX IF NOT EXISTS idx_webhook_inbound_workspace ON webhook_inbound_log(workspace_id);
CREATE INDEX IF NOT EXISTS idx_webhook_inbound_batch ON webhook_inbound_log(batch_id);

COMMENT ON TABLE webhook_inbound_log IS 'Tracks inbound webhook deliveries for idempotency (deduplicates on batch_id)';
COMMENT ON COLUMN webhook_inbound_log.batch_id IS 'pandora_batch_id echoed back from third-party tool';
