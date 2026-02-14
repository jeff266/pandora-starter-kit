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

  evidenceSchema: {
    entity_type: 'workspace',
    columns: [
      { key: 'workspace_name', display: 'Workspace', format: 'text' },
      { key: 'open_deals', display: 'Open Deals', format: 'number' },
      { key: 'open_pipeline', display: 'Open Pipeline', format: 'currency' },
      { key: 'won_this_month', display: 'Won This Month', format: 'currency' },
      { key: 'project_status', display: 'Project Status', format: 'text' },
    ],
  },
};
