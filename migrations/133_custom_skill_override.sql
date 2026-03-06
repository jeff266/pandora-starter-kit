-- Migration 133: Custom Skill Override
--
-- Adds replaces_skill_id to custom_skills so a custom skill can suppress
-- a built-in skill from the planner. When set, Ask Pandora will route to
-- the custom skill instead of the named built-in.

ALTER TABLE custom_skills
  ADD COLUMN IF NOT EXISTS replaces_skill_id TEXT DEFAULT NULL;

COMMENT ON COLUMN custom_skills.replaces_skill_id IS
  'When set, this custom skill suppresses the named built-in skill from the planner. The router always prefers this custom skill over the built-in for matching questions.';
