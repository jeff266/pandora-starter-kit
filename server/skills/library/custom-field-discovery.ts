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

{{#if discovered_fields.total}}
{{#if discovered_fields.total > 30}}
⚠️ Too many fields ({{discovered_fields.total}}). Only classifying top 30 by usage frequency.
{{/if}}

CUSTOM FIELDS:
{{{json discovered_fields.topFields}}}

Classify each field's business purpose. Return JSON array:
[
  {
    "field_name": "...",
    "object_type": "deal" | "contact" | "account",
    "category": "qualification" | "commercial_terms" | "stakeholder_role" | "technical_requirement" | "risk_indicator" | "stage_tracking" | "account_info" | "unknown",
    "confidence": 0.0 to 1.0,
    "reasoning": "one sentence why this classification makes sense"
  }
]

Definitions:
- qualification: fields that indicate deal quality or fit (pain severity, BANT, use case)
- commercial_terms: pricing, contract terms, billing details
- stakeholder_role: decision-maker titles, champion info, buying committee roles
- technical_requirement: integration needs, security requirements, product SKUs
- risk_indicator: competitor presence, renewal risk, churn signals
- stage_tracking: deal milestones, next steps, close plan
- account_info: company metadata (industry, size, region)
- unknown: unclear or generic fields
{{else}}
No custom fields discovered. Return empty array: []
{{/if}}`,
      deepseekSchema: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            field_name: { type: 'string' },
            object_type: { type: 'string' },
            category: { type: 'string' },
            confidence: { type: 'number' },
            reasoning: { type: 'string' },
          },
          required: ['field_name', 'object_type', 'category', 'confidence', 'reasoning'],
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
