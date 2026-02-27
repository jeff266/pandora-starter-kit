-- Fix stage_configs unique constraint to include pipeline_name.
-- Previously UNIQUE(workspace_id, stage_name) caused Customer Expansion sync
-- to overwrite Core Sales Pipeline's stage entries when stage names collide.

-- Drop old constraint
ALTER TABLE stage_configs DROP CONSTRAINT IF EXISTS stage_configs_workspace_id_stage_name_key;

-- Add new constraint that scopes uniqueness to (workspace_id, pipeline_name, stage_name)
ALTER TABLE stage_configs ADD CONSTRAINT stage_configs_workspace_pipeline_stage_key
  UNIQUE (workspace_id, pipeline_name, stage_name);

-- Restore Core Sales Pipeline stages that were overwritten by Customer Expansion sync
-- Verified mapping derived from deal_stage_history normalized values matching open deal stage_normalized:
--   appointmentscheduled  → 'qualification'   = "Demo Scheduled"     (order 2)
--   presentationscheduled → 'evaluation'      = "Demo Conducted"     (order 3)
--   contractsent          → 'negotiation'     = "Contract Sent"      (order 7)
-- (decisionmakerboughtin → Proposal Reviewed already inserted in earlier fix)

INSERT INTO stage_configs (workspace_id, pipeline_name, stage_name, display_order, stage_id)
VALUES
  ('4160191d-73bc-414b-97dd-5a1853190378', 'Core Sales Pipeline', 'Demo Scheduled',  2, 'appointmentscheduled'),
  ('4160191d-73bc-414b-97dd-5a1853190378', 'Core Sales Pipeline', 'Demo Conducted',  3, 'presentationscheduled'),
  ('4160191d-73bc-414b-97dd-5a1853190378', 'Core Sales Pipeline', 'Contract Sent',   7, 'contractsent')
ON CONFLICT (workspace_id, pipeline_name, stage_name) DO UPDATE
  SET stage_id = EXCLUDED.stage_id,
      display_order = EXCLUDED.display_order,
      updated_at = NOW();
