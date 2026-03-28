-- Add 15 historical Salesforce stage names for Imubit that appear in deal_stage_history
-- but have no stage_configs entry. Without these rows, the Deal Stages view silently
-- drops all history records for these stages (guarded by AND sc.stage_name IS NOT NULL).
-- These are historical CRM stages from before Imubit's current active pipeline was configured.
-- pipeline_name = NULL to match the existing 8 active stage_configs rows (which are also NULL).
-- display_order starts at 100 so they appear after the 8 active stages (orders 0-7).

-- Only insert if workspace exists (migration-safe for environments where workspace was deleted)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM workspaces WHERE id = '31551fe0-b746-4384-aab2-d5cdd70b19ed') THEN
    INSERT INTO stage_configs (workspace_id, pipeline_name, stage_name, display_order)
    VALUES
      ('31551fe0-b746-4384-aab2-d5cdd70b19ed', NULL, '01 - Discovery',              100),
      ('31551fe0-b746-4384-aab2-d5cdd70b19ed', NULL, '01 - Prospect',               101),
      ('31551fe0-b746-4384-aab2-d5cdd70b19ed', NULL, '02 - Negotiation',            102),
      ('31551fe0-b746-4384-aab2-d5cdd70b19ed', NULL, '02 - Opportunity Identified', 103),
      ('31551fe0-b746-4384-aab2-d5cdd70b19ed', NULL, '03 - AIO Assessment',         104),
      ('31551fe0-b746-4384-aab2-d5cdd70b19ed', NULL, '03 - Agreement',              105),
      ('31551fe0-b746-4384-aab2-d5cdd70b19ed', NULL, '03 - Optimization Workshop',  106),
      ('31551fe0-b746-4384-aab2-d5cdd70b19ed', NULL, '04 - Value Alignment',        107),
      ('31551fe0-b746-4384-aab2-d5cdd70b19ed', NULL, '05 - Go No Go',               108),
      ('31551fe0-b746-4384-aab2-d5cdd70b19ed', NULL, '06 - Agreement',              109),
      ('31551fe0-b746-4384-aab2-d5cdd70b19ed', NULL, '08 - Application Review',     110),
      ('31551fe0-b746-4384-aab2-d5cdd70b19ed', NULL, '09 - First Closed Loop',      111),
      ('31551fe0-b746-4384-aab2-d5cdd70b19ed', NULL, '10 - Prove value',            112),
      ('31551fe0-b746-4384-aab2-d5cdd70b19ed', NULL, '11 - Expansion Alignment',    113),
      ('31551fe0-b746-4384-aab2-d5cdd70b19ed', NULL, '12 - Expansion Agreement',    114);
  END IF;
END $$;
