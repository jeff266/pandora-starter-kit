import type { SkillDefinition } from '../types.js';

export const coachingSkill: SkillDefinition = {
  id: 'coaching',
  name: 'Coaching Intelligence',
  category: 'intelligence',
  description: 'Rep Coaching Signals: Analyzes all rep conversations to score methodology adherence and conversation quality. Outputs: coaching_signals, rep_scores_by_dimension. Use to: auto-assign coaching tasks or flag reps needing support.',
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
