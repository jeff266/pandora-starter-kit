-- Add is_active flag to stage_configs to distinguish active CRM stages from
-- historical/inactive ones that exist in deal_stage_history but are no longer
-- configured in the CRM. Inactive stages still contribute to normalized
-- benchmarks (via deal_stage_history JOIN on stage_normalized) but should NOT
-- appear as named rows in the Deal Stages view.

ALTER TABLE stage_configs ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

-- Mark the 15 historical Imubit stages (display_order >= 100, inserted in migration 117)
-- as inactive. These were confirmed inactive in Salesforce via OpportunityStage admin.
UPDATE stage_configs
SET is_active = false
WHERE workspace_id = '31551fe0-b746-4384-aab2-d5cdd70b19ed'
  AND display_order >= 100;
