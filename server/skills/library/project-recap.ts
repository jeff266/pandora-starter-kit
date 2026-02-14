import type { SkillDefinition } from '../types.js';

export const projectRecapSkill: SkillDefinition = {
  id: 'project-recap',
  name: 'Project Recap',
  description: 'Formats project updates and cross-workspace metrics for the Friday recap agent. Pure compute, no LLM calls.',
  version: '1.0.0',
  category: 'reporting',
  tier: 'compute',

  requiredTools: ['prepareProjectRecap'],
  requiredContext: [],

  steps: [
    {
      id: 'load-project-recap',
      name: 'Load and Format Project Updates',
      tier: 'compute',
      computeFn: 'prepareProjectRecap',
      computeArgs: {},
      outputKey: 'project_data',
    },
  ],

  outputFormat: {
    type: 'narrative',
    sections: ['project_updates', 'cross_workspace_summary'],
  },
};
