/**
 * Contact Role Resolution Skill
 *
 * Multi-source resolution engine that fills gaps in buying roles using
 * progressively lower-confidence methods. Runs post-sync to maximize
 * threading coverage before lead scoring.
 *
 * REQUIRES CONTACT DATA: This skill will skip execution if no contacts are available
 * (file import workspace without contacts). The compute function checks dataFreshness
 * and returns a skip message if hasContacts === false.
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

  evidenceSchema: {
    entity_type: 'contact',
    columns: [
      { key: 'contact_name', display: 'Contact Name', format: 'text' },
      { key: 'email', display: 'Email', format: 'text' },
      { key: 'title', display: 'Title', format: 'text' },
      { key: 'deal_name', display: 'Deal', format: 'text' },
      { key: 'resolved_role', display: 'Resolved Role', format: 'text' },
      { key: 'resolution_source', display: 'Resolution Source', format: 'text' },
      { key: 'confidence', display: 'Confidence', format: 'percentage' },
    ],
  },
};
