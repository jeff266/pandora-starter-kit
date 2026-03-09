import type { SkillDefinition } from '../types.js';

export const coachingSkill: SkillDefinition = {
  id: 'coaching',
  name: 'Coaching Intelligence',
  category: 'intelligence',
  description: 'Methodology adherence and conversation quality by rep — sourced from conversation_enrichments',
  version: '0.1.0',
  tier: 'mixed',
  status: 'stub',
  requiredTools: [],
  optionalTools: [],
  requiredContext: [],
  steps: [],
  schedule: { cron: '0 5 1 1,4,7,10 *', trigger: 'on_demand' },
  outputFormat: 'json',
  estimatedDuration: '0s',
};
