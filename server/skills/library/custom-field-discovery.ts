/**
 * Custom Field Discovery Skill (Standalone)
 *
 * Runs custom field discovery independently for debugging and workspace setup.
 * Useful for:
 * - Initial workspace setup ("here's what we found in your CRM")
 * - Debugging ("why isn't field X showing up?")
 * - Ongoing monitoring ("new fields appeared since last run")
 */

import type { SkillDefinition } from '../types.js';

export const customFieldDiscoverySkill: SkillDefinition = {
  id: 'custom-field-discovery',
  name: 'Custom Field Discovery',
  description: 'Automatically discovers which CRM custom fields are meaningful for ICP analysis',
  version: '1.0.0',
  category: 'enrichment',
  tier: 'compute',

  requiredTools: ['discoverCustomFields'],
  requiredContext: [],

  steps: [
    {
      id: 'discover-fields',
      name: 'Discover Custom Fields',
      tier: 'compute',
      computeFn: 'discoverCustomFields',
      computeArgs: {
        enableClassification: false, // DeepSeek classification disabled for now
      },
      outputKey: 'discovery_result',
    },

    {
      id: 'generate-report',
      name: 'Generate Discovery Report',
      tier: 'compute',
      dependsOn: ['discover-fields'],
      computeFn: 'generateCustomFieldReport',
      computeArgs: {},
      outputKey: 'report',
    },
  ],

  schedule: {
    trigger: 'on_demand', // Only runs when explicitly triggered
  },

  outputFormat: 'markdown',
  estimatedDuration: '15s',
};
