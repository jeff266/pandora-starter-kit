-- Imubit (Salesforce) stage_configs were synced without a pipeline_name because
-- Salesforce doesn't have a pipeline concept by default (pipeline comes from opp.Type,
-- which is often null). Assign a label so Deal Stages view can group and display them.

UPDATE stage_configs
SET pipeline_name = 'Default Pipeline'
WHERE workspace_id = '31551fe0-b746-4384-aab2-d5cdd70b19ed'
  AND pipeline_name IS NULL;
