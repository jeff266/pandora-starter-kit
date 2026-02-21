-- CRM Write-back + Custom Property Map Builder
-- Stores user-configured mappings between Pandora fields and CRM properties

CREATE TABLE IF NOT EXISTS crm_property_mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,

  -- Which CRM this mapping applies to
  crm_type TEXT NOT NULL CHECK (crm_type IN ('hubspot', 'salesforce')),

  -- The Pandora-side field being written
  pandora_field TEXT NOT NULL,
  -- Examples: 'account_score', 'enhanced_account_score', 'deal_score',
  --           'enhanced_deal_score', 'account_signals_text',
  --           'deal_risk_summary', 'next_step_recommendation'

  -- The CRM-side property receiving the write
  crm_object_type TEXT NOT NULL, -- 'deal' | 'contact' | 'account' | 'company'
  crm_property_name TEXT NOT NULL, -- internal API name, e.g. 'pandora_deal_score'
  crm_property_label TEXT,         -- human label, e.g. 'Pandora Deal Score'
  crm_field_type TEXT,             -- 'number' | 'text' | 'textarea' | 'checkbox'
                                   -- used for type validation warnings

  -- Sync behavior
  sync_trigger TEXT NOT NULL DEFAULT 'after_skill_run',
  -- 'after_skill_run' | 'manual'

  -- Write behavior — how Pandora handles the field on each sync
  write_mode TEXT NOT NULL DEFAULT 'overwrite',
  -- 'overwrite'       — always replace the CRM value with the new Pandora value
  -- 'never_overwrite' — write ONLY if the CRM field is currently blank/null
  --                     (safe first-write, no clobber)
  -- 'append'          — for text/textarea fields only: append new value below existing,
  --                     separated by a timestamp prefix. Numeric fields ignore this and
  --                     fall back to 'overwrite'.
  -- 'append_if_changed' — append only when the new Pandora value differs from
  --                       the last value Pandora wrote (tracked in write_log).
  --                       Prevents duplicate appends on unchanged values.
  CHECK (write_mode IN ('overwrite', 'never_overwrite', 'append', 'append_if_changed')),

  -- For 'append' and 'append_if_changed' modes:
  append_separator TEXT DEFAULT E'\n---\n',
  -- The string placed between the existing CRM value and the new appended value.
  -- Defaults to a newline + dashes. User can override (e.g. '\n' for plain newline,
  -- ' | ' for inline, or a custom divider string).

  append_timestamp_format TEXT DEFAULT 'prefix',
  -- 'prefix'  — prepend "[Feb 21, 2026] " before the new value in the append
  -- 'suffix'  — append " (Feb 21, 2026)" after the new value
  -- 'none'    — append raw value with no timestamp

  append_max_entries INTEGER DEFAULT NULL,
  -- For append modes: max number of Pandora entries to keep in the field.
  -- When this limit is reached, oldest entries are trimmed to make room.
  -- NULL = unlimited (the full CRM field length is the only constraint).
  -- Recommended: 5 for most text fields to prevent unbounded growth.

  -- Condition-based write guard
  write_condition TEXT DEFAULT NULL,
  -- Optional: only write if a condition is met. NULL means always write.
  -- Supported conditions:
  -- 'score_above:{n}'      — only write if the Pandora score value is above n
  -- 'score_below:{n}'      — only write if the Pandora score value is below n
  -- 'score_changed_by:{n}' — only write if score changed by more than n points
  --                          since the last write (requires write_log lookup)
  -- 'field_is_blank'       — alias for write_mode = 'never_overwrite' (kept for clarity)

  -- Value transformation before write
  value_transform TEXT DEFAULT 'raw',
  -- 'raw'              — write the Pandora value as-is
  -- 'truncate:{n}'     — truncate to n characters (useful for short text fields)
  -- 'round:{n}'        — round numeric value to n decimal places
  -- 'date_only'        — for datetime fields, strip the time component before writing
  -- 'uppercase'        — uppercase the string before writing
  -- 'score_label'      — convert numeric score to label: 90-100=Excellent, 70-89=Good,
  --                      50-69=Fair, <50=At Risk (useful for picklist fields)

  is_active BOOLEAN NOT NULL DEFAULT true,
  last_synced_at TIMESTAMPTZ,
  last_sync_status TEXT, -- 'success' | 'error' | null
  last_sync_error TEXT,

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),

  UNIQUE(workspace_id, crm_type, pandora_field, crm_object_type)
);

CREATE INDEX IF NOT EXISTS idx_crm_mappings_workspace ON crm_property_mappings(workspace_id);
CREATE INDEX IF NOT EXISTS idx_crm_mappings_active ON crm_property_mappings(workspace_id, is_active)
  WHERE is_active = true;

-- Enhance existing crm_write_log table to match spec
-- Check if columns exist before adding them
DO $$
BEGIN
  -- Add mapping_id if it doesn't exist
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'crm_write_log' AND column_name = 'mapping_id') THEN
    ALTER TABLE crm_write_log ADD COLUMN mapping_id UUID REFERENCES crm_property_mappings(id);
  END IF;

  -- Add crm_type if it doesn't exist (may already be connector_name)
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'crm_write_log' AND column_name = 'crm_type') THEN
    -- If connector_name exists, rename it to crm_type for consistency
    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_name = 'crm_write_log' AND column_name = 'connector_name') THEN
      ALTER TABLE crm_write_log RENAME COLUMN connector_name TO crm_type;
    ELSE
      ALTER TABLE crm_write_log ADD COLUMN crm_type TEXT NOT NULL DEFAULT 'hubspot';
    END IF;
  END IF;

  -- Add crm_object_type if it doesn't exist (may already be object_type)
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'crm_write_log' AND column_name = 'crm_object_type') THEN
    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_name = 'crm_write_log' AND column_name = 'object_type') THEN
      ALTER TABLE crm_write_log RENAME COLUMN object_type TO crm_object_type;
    ELSE
      ALTER TABLE crm_write_log ADD COLUMN crm_object_type TEXT NOT NULL DEFAULT 'deal';
    END IF;
  END IF;

  -- Add crm_record_id if it doesn't exist (may already be source_id)
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'crm_write_log' AND column_name = 'crm_record_id') THEN
    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_name = 'crm_write_log' AND column_name = 'source_id') THEN
      ALTER TABLE crm_write_log RENAME COLUMN source_id TO crm_record_id;
    ELSE
      ALTER TABLE crm_write_log ADD COLUMN crm_record_id TEXT;
    END IF;
  END IF;

  -- Add crm_property_name if it doesn't exist
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'crm_write_log' AND column_name = 'crm_property_name') THEN
    ALTER TABLE crm_write_log ADD COLUMN crm_property_name TEXT;
  END IF;

  -- Add value_written if it doesn't exist (may already be payload)
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'crm_write_log' AND column_name = 'value_written') THEN
    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_name = 'crm_write_log' AND column_name = 'payload') THEN
      ALTER TABLE crm_write_log RENAME COLUMN payload TO value_written;
    ELSE
      ALTER TABLE crm_write_log ADD COLUMN value_written JSONB;
    END IF;
  END IF;

  -- Add trigger_source if it doesn't exist (may already be triggered_by)
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'crm_write_log' AND column_name = 'trigger_source') THEN
    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_name = 'crm_write_log' AND column_name = 'triggered_by') THEN
      ALTER TABLE crm_write_log RENAME COLUMN triggered_by TO trigger_source;
    ELSE
      ALTER TABLE crm_write_log ADD COLUMN trigger_source TEXT;
    END IF;
  END IF;

  -- Add trigger_skill_run_id if it doesn't exist
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'crm_write_log' AND column_name = 'trigger_skill_run_id') THEN
    ALTER TABLE crm_write_log ADD COLUMN trigger_skill_run_id UUID;
  END IF;

  -- Add status if it doesn't exist (may already be success boolean)
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'crm_write_log' AND column_name = 'status') THEN
    ALTER TABLE crm_write_log ADD COLUMN status TEXT;
    -- Populate from success boolean if it exists
    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_name = 'crm_write_log' AND column_name = 'success') THEN
      UPDATE crm_write_log SET status = CASE WHEN success THEN 'success' ELSE 'error' END;
    END IF;
  END IF;

  -- Add error_message if it doesn't exist (may already be error)
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'crm_write_log' AND column_name = 'error_message') THEN
    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_name = 'crm_write_log' AND column_name = 'error') THEN
      ALTER TABLE crm_write_log RENAME COLUMN error TO error_message;
    ELSE
      ALTER TABLE crm_write_log ADD COLUMN error_message TEXT;
    END IF;
  END IF;

  -- Add http_status_code if it doesn't exist
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'crm_write_log' AND column_name = 'http_status_code') THEN
    ALTER TABLE crm_write_log ADD COLUMN http_status_code INTEGER;
  END IF;
END $$;

-- Create indexes for write_log lookups
CREATE INDEX IF NOT EXISTS idx_crm_write_log_mapping ON crm_write_log(mapping_id, created_at DESC);
