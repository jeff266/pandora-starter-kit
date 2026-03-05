-- Migration 129: Webhook Endpoints + Delivery Log
-- Multi-endpoint outbound webhook infrastructure for prospect.scored and future events.
-- Intentionally separate from webhook_delivery_log (enrichment system) and
-- webhook_outbound_configs (Clay/Zapier enrichment outbound).

CREATE TABLE IF NOT EXISTS webhook_endpoints (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  secret TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  event_types TEXT[],                    -- NULL = all events; filter to specific types
  last_success_at TIMESTAMPTZ,
  last_failure_at TIMESTAMPTZ,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  disabled_reason TEXT,                  -- 'manual' | 'consecutive_failures'
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_webhook_endpoints_workspace
  ON webhook_endpoints(workspace_id, enabled);

-- Delivery log for per-endpoint, per-event tracking and debugging.
-- Named webhook_endpoint_deliveries to avoid collision with the enrichment
-- system's webhook_delivery_log table.
CREATE TABLE IF NOT EXISTS webhook_endpoint_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  endpoint_id UUID NOT NULL REFERENCES webhook_endpoints(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL,
  event_type TEXT NOT NULL,
  event_id TEXT NOT NULL,
  payload JSONB NOT NULL,
  status_code INTEGER,
  success BOOLEAN NOT NULL,
  attempt INTEGER NOT NULL DEFAULT 1,
  error TEXT,
  duration_ms INTEGER,
  delivered_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Primary access pattern: fetch deliveries for a given endpoint, newest first
CREATE INDEX IF NOT EXISTS idx_wep_deliveries_endpoint
  ON webhook_endpoint_deliveries(endpoint_id, delivered_at DESC);

-- Idempotency / dedup lookups by event_id
CREATE INDEX IF NOT EXISTS idx_wep_deliveries_event
  ON webhook_endpoint_deliveries(event_id);

-- Supports the daily retention DELETE (full table scan on delivered_at)
CREATE INDEX IF NOT EXISTS idx_wep_deliveries_cleanup
  ON webhook_endpoint_deliveries(delivered_at);
