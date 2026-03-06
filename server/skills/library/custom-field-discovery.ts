/**
 * Custom Field Discovery Skill (Standalone)
 *
 * Runs custom field discovery independently for debugging and workspace setup.
 * Useful for:
 * - Initial workspace setup ("here's what we found in your CRM")
 * - Debugging ("why isn't field X showing up?")
 * - Ongoing monitoring ("new fields appeared since last run")
 *
 * Works with file imports: Custom fields are preserved in CSV/Excel uploads.
 * If data is >14 days old, discovered fields may not reflect recent CRM schema changes.
 */

import type { SkillDefinition } from '../types.js';

export const customFieldDiscoverySkill: SkillDefinition = {
  id: 'custom-field-discovery',
  name: 'Custom Field Discovery',
  description: 'Automatically discovers which CRM custom fields are meaningful for ICP analysis',
  version: '1.0.0',
  category: 'enrichment',
  tier: 'mixed',

  requiredTools: ['discoverCustomFields', 'generateCustomFieldReport'],
  requiredContext: [],

  steps: [
    {
      id: 'discover-fields',
      name: 'Discover Custom Fields',
      tier: 'compute',
      computeFn: 'discoverCustomFields',
      computeArgs: {
        enableClassification: true, // DeepSeek classification enabled with 30 field cap
      },
      outputKey: 'discovered_fields',
    },

    {
      id: 'classify-field-types',
      name: 'Classify Field Business Types (DeepSeek)',
      tier: 'deepseek',
      dependsOn: ['discover-fields'],
      deepseekPrompt: `You are a sales operations analyst classifying CRM custom fields.

{{#if discovered_fields.topFields}}
CUSTOM FIELDS (classifying top {{discovered_fields.topFields.length}} by ICP relevance score):

{{#each discovered_fields.topFields}}
[{{@index}}] fieldKey="{{this.fieldKey}}" | entity={{this.entityType}} | fillRate={{this.fillRate}} | cardinality={{this.cardinality}} | winRateSpread={{this.winRateSpread}} | icpScore={{this.icpRelevanceScore}}
{{/each}}

Category definitions:
- qualification: fields that indicate deal quality or fit (pain severity, BANT, use case)
- commercial_terms: pricing, contract terms, billing details
- stakeholder_role: decision-maker titles, champion info, buying committee roles
- technical_requirement: integration needs, security requirements, product SKUs
- risk_indicator: competitor presence, renewal risk, churn signals
- stage_tracking: deal milestones, next steps, close plan
- account_info: company metadata (industry, size, region)
- unknown: unclear or generic fields

Classify each field above. Return a JSON array with exactly {{discovered_fields.topFields.length}} entries, one per field in the same order listed.
For each entry, the "fieldKey" must be copied EXACTLY as shown in the list (e.g. fieldKey="Type" → output "fieldKey": "Type", fieldKey="Number_of_Tasks__c" → output "fieldKey": "Number_of_Tasks__c").

Example: [{ "fieldKey": "LeadSource", "field_name": "Lead Source", "object_type": "deal", "category": "qualification", "confidence": 0.8, "reasoning": "Tracks where deals originate." }]
{{else}}
No custom fields discovered. Return empty array: []
{{/if}}`,
      deepseekSchema: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            fieldKey: { type: 'string', description: 'Verbatim copy of the fieldKey from the input object' },
            field_name: { type: 'string' },
            object_type: { type: 'string' },
            category: { type: 'string' },
            confidence: { type: 'number' },
            reasoning: { type: 'string' },
          },
          required: ['fieldKey', 'field_name', 'object_type', 'category', 'confidence', 'reasoning'],
        },
      },
      outputKey: 'field_classifications',
    },

    {
      id: 'generate-report',
      name: 'Generate Discovery Report',
      tier: 'compute',
      dependsOn: ['discover-fields', 'classify-field-types'],
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

  answers_questions: ['custom fields', 'crm fields', 'field discovery', 'mapping', 'schema'],

  evidenceSchema: {
    entity_type: 'deal',
    columns: [
      { key: 'field_key', display: 'Field Key', format: 'text' },
      { key: 'field_label', display: 'Field Label', format: 'text' },
      { key: 'entity_type', display: 'Entity Type', format: 'text' },
      { key: 'fill_rate', display: 'Fill Rate %', format: 'percentage' },
      { key: 'unique_values', display: 'Unique Values', format: 'number' },
      { key: 'icp_relevant', display: 'ICP Relevant', format: 'boolean' },
      { key: 'scoring_weight', display: 'Scoring Weight', format: 'number' },
    ],
  },
};
