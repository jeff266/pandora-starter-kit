-- Migration 168: Extend approval_status check constraint on actions table
-- Adds 'blocked' and 'failed' values required by action-approver.ts

ALTER TABLE actions DROP CONSTRAINT IF EXISTS actions_approval_status_check;

ALTER TABLE actions ADD CONSTRAINT actions_approval_status_check
  CHECK (approval_status IN ('pending', 'approved', 'rejected', 'auto_executed', 'blocked', 'failed'));
