-- Migration 150: Seed dummy users with varied roles across demo, mt-test, frontera-health, imubit
-- Password for all dummy users: Pandora123! (bcrypt hash below)
-- Email domain @pandora-test.local ensures no collision with real CRM or auth integrations

-- ============================================================
-- 1. Seed manager + analyst workspace_roles for the 4 workspaces
--    (workspace seeding only creates admin/member/viewer by default)
-- ============================================================

DO $$
DECLARE
  manager_perms jsonb := '{
    "connectors.view": true, "connectors.connect": false, "connectors.disconnect": false, "connectors.trigger_sync": true,
    "skills.view_results": true, "skills.view_evidence": true, "skills.run_manual": true, "skills.run_request": true, "skills.configure": false,
    "agents.view": true, "agents.run": true, "agents.draft": true, "agents.publish": false,
    "agents.edit_own": true, "agents.edit_any": true, "agents.delete_own": true, "agents.delete_any": false,
    "config.view": true, "config.edit": false,
    "members.view": true, "members.invite": false, "members.invite_request": true, "members.remove": false, "members.change_roles": false,
    "billing.view": false, "billing.manage": false,
    "flags.toggle": false,
    "data.deals_view": true, "data.accounts_view": true,
    "data.reps_view_own": true, "data.reps_view_team": true, "data.reps_view_all": true, "data.export": true
  }'::jsonb;

  analyst_perms jsonb := '{
    "connectors.view": true, "connectors.connect": false, "connectors.disconnect": false, "connectors.trigger_sync": false,
    "skills.view_results": true, "skills.view_evidence": true, "skills.run_manual": false, "skills.run_request": true, "skills.configure": false,
    "agents.view": true, "agents.run": true, "agents.draft": true, "agents.publish": false,
    "agents.edit_own": true, "agents.edit_any": false, "agents.delete_own": true, "agents.delete_any": false,
    "config.view": false, "config.edit": false,
    "members.view": true, "members.invite": false, "members.invite_request": true, "members.remove": false, "members.change_roles": false,
    "billing.view": false, "billing.manage": false,
    "flags.toggle": false,
    "data.deals_view": true, "data.accounts_view": true,
    "data.reps_view_own": true, "data.reps_view_team": false, "data.reps_view_all": false, "data.export": false
  }'::jsonb;

  ws_id uuid;
  ws_ids uuid[] := ARRAY[
    '00000000-0000-0000-0000-000000000002'::uuid,
    '43bf45e5-8094-483f-b790-a8d88dbf46dd'::uuid,
    '31551fe0-b746-4384-aab2-d5cdd70b19ed'::uuid,
    '4160191d-73bc-414b-97dd-5a1853190378'::uuid
  ];
BEGIN
  FOREACH ws_id IN ARRAY ws_ids LOOP
    INSERT INTO workspace_roles (workspace_id, name, description, is_system, system_type, permissions)
    VALUES (ws_id, 'Manager', 'Team lead access: view all rep data, edit any agent, trigger syncs.', true, 'manager', manager_perms)
    ON CONFLICT DO NOTHING;

    INSERT INTO workspace_roles (workspace_id, name, description, is_system, system_type, permissions)
    VALUES (ws_id, 'Analyst', 'Data analyst access: view all data, run skill requests, no configuration or export.', true, 'analyst', analyst_perms)
    ON CONFLICT DO NOTHING;
  END LOOP;
END $$;

-- ============================================================
-- 2. Insert dummy users (idempotent)
-- ============================================================

INSERT INTO users (id, email, name, account_type, password_hash, role, created_at)
VALUES
  ('a0000000-0000-0000-0000-000000000001', 'sarah.chen@pandora-test.local',  'Sarah Chen',   'standard', '$2b$12$ys/rXPLgl42exZXUHAJzz.4033FeWOsNQquaCeWt99fIKA3dDC1Xm', 'member', now()),
  ('a0000000-0000-0000-0000-000000000002', 'marcus.hill@pandora-test.local', 'Marcus Hill',  'standard', '$2b$12$ys/rXPLgl42exZXUHAJzz.4033FeWOsNQquaCeWt99fIKA3dDC1Xm', 'member', now()),
  ('a0000000-0000-0000-0000-000000000003', 'priya.nair@pandora-test.local',  'Priya Nair',   'standard', '$2b$12$ys/rXPLgl42exZXUHAJzz.4033FeWOsNQquaCeWt99fIKA3dDC1Xm', 'member', now()),
  ('a0000000-0000-0000-0000-000000000004', 'diego.reyes@pandora-test.local', 'Diego Reyes',  'standard', '$2b$12$ys/rXPLgl42exZXUHAJzz.4033FeWOsNQquaCeWt99fIKA3dDC1Xm', 'member', now())
ON CONFLICT (email) DO NOTHING;

-- ============================================================
-- 3. user_workspaces entries for all 4 workspaces
-- ============================================================

-- Demo workspace
INSERT INTO user_workspaces (user_id, workspace_id, role)
VALUES
  ('a0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002', 'manager'),
  ('a0000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000002', 'member'),
  ('a0000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000002', 'analyst'),
  ('a0000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000002', 'viewer')
ON CONFLICT (user_id, workspace_id) DO NOTHING;

-- mt-test workspace
INSERT INTO user_workspaces (user_id, workspace_id, role)
VALUES
  ('a0000000-0000-0000-0000-000000000001', '43bf45e5-8094-483f-b790-a8d88dbf46dd', 'manager'),
  ('a0000000-0000-0000-0000-000000000002', '43bf45e5-8094-483f-b790-a8d88dbf46dd', 'member'),
  ('a0000000-0000-0000-0000-000000000003', '43bf45e5-8094-483f-b790-a8d88dbf46dd', 'analyst'),
  ('a0000000-0000-0000-0000-000000000004', '43bf45e5-8094-483f-b790-a8d88dbf46dd', 'viewer')
ON CONFLICT (user_id, workspace_id) DO NOTHING;

-- Imubit workspace
INSERT INTO user_workspaces (user_id, workspace_id, role)
VALUES
  ('a0000000-0000-0000-0000-000000000001', '31551fe0-b746-4384-aab2-d5cdd70b19ed', 'manager'),
  ('a0000000-0000-0000-0000-000000000002', '31551fe0-b746-4384-aab2-d5cdd70b19ed', 'member'),
  ('a0000000-0000-0000-0000-000000000003', '31551fe0-b746-4384-aab2-d5cdd70b19ed', 'analyst'),
  ('a0000000-0000-0000-0000-000000000004', '31551fe0-b746-4384-aab2-d5cdd70b19ed', 'viewer')
ON CONFLICT (user_id, workspace_id) DO NOTHING;

-- Frontera Health workspace
INSERT INTO user_workspaces (user_id, workspace_id, role)
VALUES
  ('a0000000-0000-0000-0000-000000000001', '4160191d-73bc-414b-97dd-5a1853190378', 'manager'),
  ('a0000000-0000-0000-0000-000000000002', '4160191d-73bc-414b-97dd-5a1853190378', 'member'),
  ('a0000000-0000-0000-0000-000000000003', '4160191d-73bc-414b-97dd-5a1853190378', 'analyst'),
  ('a0000000-0000-0000-0000-000000000004', '4160191d-73bc-414b-97dd-5a1853190378', 'viewer')
ON CONFLICT (user_id, workspace_id) DO NOTHING;

-- ============================================================
-- 4. workspace_members entries (look up role_id by system_type)
-- ============================================================

-- Demo workspace
INSERT INTO workspace_members (workspace_id, user_id, role_id, status, pandora_role, accepted_at)
SELECT
  '00000000-0000-0000-0000-000000000002',
  u.user_id,
  (SELECT id FROM workspace_roles WHERE workspace_id = '00000000-0000-0000-0000-000000000002' AND system_type = u.sys_type LIMIT 1),
  'active',
  u.sys_type,
  now()
FROM (VALUES
  ('a0000000-0000-0000-0000-000000000001'::uuid, 'manager'),
  ('a0000000-0000-0000-0000-000000000002'::uuid, 'member'),
  ('a0000000-0000-0000-0000-000000000003'::uuid, 'analyst'),
  ('a0000000-0000-0000-0000-000000000004'::uuid, 'viewer')
) AS u(user_id, sys_type)
ON CONFLICT (workspace_id, user_id) DO NOTHING;

-- mt-test workspace
INSERT INTO workspace_members (workspace_id, user_id, role_id, status, pandora_role, accepted_at)
SELECT
  '43bf45e5-8094-483f-b790-a8d88dbf46dd',
  u.user_id,
  (SELECT id FROM workspace_roles WHERE workspace_id = '43bf45e5-8094-483f-b790-a8d88dbf46dd' AND system_type = u.sys_type LIMIT 1),
  'active',
  u.sys_type,
  now()
FROM (VALUES
  ('a0000000-0000-0000-0000-000000000001'::uuid, 'manager'),
  ('a0000000-0000-0000-0000-000000000002'::uuid, 'member'),
  ('a0000000-0000-0000-0000-000000000003'::uuid, 'analyst'),
  ('a0000000-0000-0000-0000-000000000004'::uuid, 'viewer')
) AS u(user_id, sys_type)
ON CONFLICT (workspace_id, user_id) DO NOTHING;

-- Imubit workspace
INSERT INTO workspace_members (workspace_id, user_id, role_id, status, pandora_role, accepted_at)
SELECT
  '31551fe0-b746-4384-aab2-d5cdd70b19ed',
  u.user_id,
  (SELECT id FROM workspace_roles WHERE workspace_id = '31551fe0-b746-4384-aab2-d5cdd70b19ed' AND system_type = u.sys_type LIMIT 1),
  'active',
  u.sys_type,
  now()
FROM (VALUES
  ('a0000000-0000-0000-0000-000000000001'::uuid, 'manager'),
  ('a0000000-0000-0000-0000-000000000002'::uuid, 'member'),
  ('a0000000-0000-0000-0000-000000000003'::uuid, 'analyst'),
  ('a0000000-0000-0000-0000-000000000004'::uuid, 'viewer')
) AS u(user_id, sys_type)
ON CONFLICT (workspace_id, user_id) DO NOTHING;

-- Frontera Health workspace
INSERT INTO workspace_members (workspace_id, user_id, role_id, status, pandora_role, accepted_at)
SELECT
  '4160191d-73bc-414b-97dd-5a1853190378',
  u.user_id,
  (SELECT id FROM workspace_roles WHERE workspace_id = '4160191d-73bc-414b-97dd-5a1853190378' AND system_type = u.sys_type LIMIT 1),
  'active',
  u.sys_type,
  now()
FROM (VALUES
  ('a0000000-0000-0000-0000-000000000001'::uuid, 'manager'),
  ('a0000000-0000-0000-0000-000000000002'::uuid, 'member'),
  ('a0000000-0000-0000-0000-000000000003'::uuid, 'analyst'),
  ('a0000000-0000-0000-0000-000000000004'::uuid, 'viewer')
) AS u(user_id, sys_type)
ON CONFLICT (workspace_id, user_id) DO NOTHING;
