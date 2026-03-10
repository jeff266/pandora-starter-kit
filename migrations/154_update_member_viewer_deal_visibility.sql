-- Migration 154: Update member and viewer roles to restrict deal visibility
--
-- Context:
--   Implement Option B for data scoping: non-admin roles see only their own deals.
--   Previously all roles had data.deals_view = true (see all deals).
--   Now member/viewer roles have data.deals_view = false (see only own deals).
--
-- Roles affected:
--   - member: data.deals_view: true → false
--   - viewer: data.deals_view: true → false
--
-- Roles unchanged (still see all deals):
--   - admin: all permissions true
--   - manager: needs team visibility
--   - analyst: needs full visibility for reporting
--
-- This migration updates existing workspace_roles to match server/permissions/system-roles.ts

-- Update member roles
UPDATE workspace_roles
SET permissions = jsonb_set(
  permissions,
  '{data.deals_view}',
  'false'::jsonb
)
WHERE system_type = 'member'
  AND (permissions->>'data.deals_view')::boolean = true;

-- Update viewer roles
UPDATE workspace_roles
SET permissions = jsonb_set(
  permissions,
  '{data.deals_view}',
  'false'::jsonb
)
WHERE system_type = 'viewer'
  AND (permissions->>'data.deals_view')::boolean = true;

-- Verify the change
DO $$
DECLARE
  member_count int;
  viewer_count int;
BEGIN
  SELECT COUNT(*) INTO member_count
  FROM workspace_roles
  WHERE system_type = 'member' AND (permissions->>'data.deals_view')::boolean = false;

  SELECT COUNT(*) INTO viewer_count
  FROM workspace_roles
  WHERE system_type = 'viewer' AND (permissions->>'data.deals_view')::boolean = false;

  RAISE NOTICE 'Updated % member roles to data.deals_view = false', member_count;
  RAISE NOTICE 'Updated % viewer roles to data.deals_view = false', viewer_count;
END $$;
