-- Add key_source column to token_usage to distinguish BYOK from Pandora-managed calls
ALTER TABLE token_usage ADD COLUMN IF NOT EXISTS key_source VARCHAR(10) DEFAULT 'pandora';

-- Customer billing meter for arrears invoicing
CREATE TABLE IF NOT EXISTS billing_meter (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  billing_period DATE NOT NULL,
  pandora_input_tokens BIGINT DEFAULT 0,
  pandora_output_tokens BIGINT DEFAULT 0,
  pandora_cost_usd NUMERIC(10,6) DEFAULT 0,
  byok_input_tokens BIGINT DEFAULT 0,
  byok_output_tokens BIGINT DEFAULT 0,
  byok_cost_usd NUMERIC(10,6) DEFAULT 0,
  total_calls INTEGER DEFAULT 0,
  markup_multiplier NUMERIC(4,2) DEFAULT 2.50,
  customer_charge_usd NUMERIC(10,6) GENERATED ALWAYS AS (pandora_cost_usd * markup_multiplier) STORED,
  invoice_status VARCHAR(20) DEFAULT 'pending',
  invoice_reference VARCHAR(100),
  invoiced_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(workspace_id, billing_period)
);

CREATE INDEX IF NOT EXISTS billing_meter_workspace_period_idx ON billing_meter(workspace_id, billing_period);
CREATE INDEX IF NOT EXISTS billing_meter_period_status_idx ON billing_meter(billing_period, invoice_status);
CREATE INDEX IF NOT EXISTS token_usage_key_source_idx ON token_usage(workspace_id, key_source, created_at);
