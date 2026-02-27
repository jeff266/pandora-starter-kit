-- Revert migration 115 which wrote pipeline_name = 'Default Pipeline' into stage_configs
-- for Imubit (Salesforce workspace). This was incorrect because deals.pipeline is NULL
-- for Salesforce deals (pipeline comes from opp.Type which is often null), so the JOIN
-- sc.pipeline_name = d.pipeline would never match 'Default Pipeline' against NULL.
-- The correct approach is to keep both NULL and use COALESCE in the JOIN condition.

UPDATE stage_configs
SET pipeline_name = NULL
WHERE workspace_id = '31551fe0-b746-4384-aab2-d5cdd70b19ed'
  AND pipeline_name = 'Default Pipeline';
