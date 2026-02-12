/**
 * Contact Role Resolution Skill
 *
 * Multi-source resolution engine that fills gaps in buying roles using
 * progressively lower-confidence methods. Runs post-sync to maximize
 * threading coverage before lead scoring.
 */

import type { SkillDefinition } from '../types.js';

export const contactRoleResolutionSkill: SkillDefinition = {
  id: 'contact-role-resolution',
  name: 'Contact Role Resolution',
  description: 'Resolves buying roles for deal contacts using multi-source inference (CRM, titles, activities, conversations)',
  version: '1.0.0',
  category: 'enrichment',
  tier: 'compute',

  requiredTools: ['resolveContactRoles'],
  requiredContext: [],

  steps: [
    {
      id: 'resolve-roles',
      name: 'Resolve Contact Roles',
      tier: 'compute',
      computeFn: 'resolveContactRoles',
      computeArgs: {},
      outputKey: 'resolution_result',
    },

    {
      id: 'generate-report',
      name: 'Generate Resolution Report',
      tier: 'compute',
      dependsOn: ['resolve-roles'],
      computeFn: 'generateContactRoleReport',
      computeArgs: {},
      outputKey: 'report',
    },
  ],

  schedule: {
    trigger: ['post_sync', 'on_demand'],
  },

  outputFormat: 'markdown',
  estimatedDuration: '30s',
};
