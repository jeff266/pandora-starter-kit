-- Create a non-superuser role for SQL Workspace query execution
-- RLS policies are bypassed for superusers, so we need a restricted role
-- The app switches to this role via SET LOCAL ROLE before running user queries

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pandora_rls_user') THEN
    CREATE ROLE pandora_rls_user NOLOGIN;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO pandora_rls_user;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO pandora_rls_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO pandora_rls_user;

-- Enable RLS on tables that are missing it (calls, documents, tasks)
ALTER TABLE calls ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;

-- Create workspace isolation policies for newly-RLS-enabled tables
DROP POLICY IF EXISTS workspace_isolation_calls ON calls;
CREATE POLICY workspace_isolation_calls ON calls
  FOR ALL
  USING (workspace_id = current_setting('app.current_workspace_id', true)::uuid);

DROP POLICY IF EXISTS workspace_isolation_documents ON documents;
CREATE POLICY workspace_isolation_documents ON documents
  FOR ALL
  USING (workspace_id = current_setting('app.current_workspace_id', true)::uuid);

DROP POLICY IF EXISTS workspace_isolation_tasks ON tasks;
CREATE POLICY workspace_isolation_tasks ON tasks
  FOR ALL
  USING (workspace_id = current_setting('app.current_workspace_id', true)::uuid);
