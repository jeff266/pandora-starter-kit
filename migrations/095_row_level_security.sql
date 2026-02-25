-- ============================================================================
-- Row-Level Security (RLS) for Workspace Isolation
-- ============================================================================
-- Created: 2026-02-24
-- Purpose: Enforce workspace data isolation at the database level
--
-- CRITICAL: This prevents users from accessing data from other workspaces
-- even if they bypass application-level filters in SQL Workspace.
--
-- Security Model:
-- - Set session variable 'app.current_workspace_id' before each query
-- - RLS policies check this variable and filter all rows automatically
-- - Users CANNOT bypass this by modifying their SQL queries
-- ============================================================================

-- Enable RLS on all workspace-scoped tables
ALTER TABLE deals ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE deal_stage_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE deal_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE lead_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE findings ENABLE ROW LEVEL SECURITY;
ALTER TABLE action_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_saved_queries ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- RLS Policies - Force workspace filtering
-- ============================================================================

-- Deals table
CREATE POLICY workspace_isolation_deals ON deals
  USING (workspace_id = current_setting('app.current_workspace_id', true)::uuid);

-- Accounts table
CREATE POLICY workspace_isolation_accounts ON accounts
  USING (workspace_id = current_setting('app.current_workspace_id', true)::uuid);

-- Contacts table
CREATE POLICY workspace_isolation_contacts ON contacts
  USING (workspace_id = current_setting('app.current_workspace_id', true)::uuid);

-- Activities table
CREATE POLICY workspace_isolation_activities ON activities
  USING (workspace_id = current_setting('app.current_workspace_id', true)::uuid);

-- Conversations table
CREATE POLICY workspace_isolation_conversations ON conversations
  USING (workspace_id = current_setting('app.current_workspace_id', true)::uuid);

-- Deal stage history table
CREATE POLICY workspace_isolation_deal_stage_history ON deal_stage_history
  USING (workspace_id = current_setting('app.current_workspace_id', true)::uuid);

-- Deal contacts table
CREATE POLICY workspace_isolation_deal_contacts ON deal_contacts
  USING (workspace_id = current_setting('app.current_workspace_id', true)::uuid);

-- Lead scores table
CREATE POLICY workspace_isolation_lead_scores ON lead_scores
  USING (workspace_id = current_setting('app.current_workspace_id', true)::uuid);

-- Findings table
CREATE POLICY workspace_isolation_findings ON findings
  USING (workspace_id = current_setting('app.current_workspace_id', true)::uuid);

-- Action items table
CREATE POLICY workspace_isolation_action_items ON action_items
  USING (workspace_id = current_setting('app.current_workspace_id', true)::uuid);

-- Workspace saved queries table
CREATE POLICY workspace_isolation_saved_queries ON workspace_saved_queries
  USING (workspace_id = current_setting('app.current_workspace_id', true)::uuid);

-- ============================================================================
-- Comments
-- ============================================================================

COMMENT ON POLICY workspace_isolation_deals ON deals IS
  'Enforces workspace isolation - users can only see deals from their current workspace';

COMMENT ON POLICY workspace_isolation_accounts ON accounts IS
  'Enforces workspace isolation - users can only see accounts from their current workspace';

COMMENT ON POLICY workspace_isolation_contacts ON contacts IS
  'Enforces workspace isolation - users can only see contacts from their current workspace';

-- ============================================================================
-- Usage
-- ============================================================================
-- Before executing user queries, the application must run:
-- SET LOCAL app.current_workspace_id = '<workspace-uuid>';
--
-- This ensures ALL queries in that transaction are automatically filtered
-- to only show data from the specified workspace, regardless of the SQL written.
-- ============================================================================
