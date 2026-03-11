-- Migration 158: add skill_source to agent_tuning_pairs
-- Stamps each training pair with the origin class of its skill_id so that
-- downstream dataset assemblers can explicitly include or exclude custom skill
-- corrections rather than accidentally filtering them out via an unknown enum.
--
-- Valid values:
--   built_in  — skill is registered in the built-in SkillRegistry (shipped with Pandora)
--   custom    — skill was created via Skill Builder and lives in custom_skills table
--   unknown   — skill_id was null or the classification check was unavailable at write time

ALTER TABLE agent_tuning_pairs
  ADD COLUMN IF NOT EXISTS skill_source TEXT NOT NULL DEFAULT 'unknown';

CREATE INDEX IF NOT EXISTS idx_agent_tuning_pairs_skill_source
  ON agent_tuning_pairs(skill_source);

COMMENT ON COLUMN agent_tuning_pairs.skill_source IS 'Origin class of skill_id: built_in | custom | unknown. Stamped at write time. Allows pipeline to explicitly include custom skill corrections rather than silently dropping them.';
