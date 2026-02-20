-- Migration: Rename workspace_users to workspace_members
-- Aligns table name with RBAC system expectations

ALTER TABLE workspace_users RENAME TO workspace_members;

-- Update index names to reflect new table name
ALTER INDEX workspace_users_pkey RENAME TO workspace_members_pkey;
ALTER INDEX idx_wu_workspace_active RENAME TO idx_wm_workspace_active;
ALTER INDEX idx_wu_workspace_email RENAME TO idx_wm_workspace_email;
ALTER INDEX idx_wu_workspace_pandora RENAME TO idx_wm_workspace_pandora;
ALTER INDEX idx_wu_workspace_slack RENAME TO idx_wm_workspace_slack;
ALTER INDEX idx_wu_hubspot_owner RENAME TO idx_wm_hubspot_owner;
ALTER INDEX idx_wu_salesforce_user RENAME TO idx_wm_salesforce_user;

COMMENT ON TABLE workspace_members IS 'Workspace membership and user records';
