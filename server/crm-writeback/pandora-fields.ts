/**
 * Pandora Field Registry
 *
 * Complete registry of Pandora-computed fields that can be written back to CRM.
 * Each entry defines what the field contains, which CRM object types it applies to,
 * and what CRM field types are compatible.
 */

export type CRMObjectType = 'deal' | 'account' | 'company' | 'contact';

export interface PandoraWritableField {
  key: string;                   // internal identifier
  label: string;                 // human display name
  description: string;           // tooltip text
  applies_to: CRMObjectType[];   // which CRM object types this field maps to
  value_type: 'number' | 'text' | 'textarea' | 'boolean';
  compatible_crm_types: string[]; // CRM field types that can receive this
  source_skill: string;          // which skill produces this field
  example_value: string;         // shown in the mapper UI
}

export const PANDORA_WRITABLE_FIELDS: PandoraWritableField[] = [
  {
    key: 'deal_score',
    label: 'Deal Score',
    description: 'Numeric deal health score (0–100) based on CRM signals',
    applies_to: ['deal'],
    value_type: 'number',
    compatible_crm_types: ['number'],
    source_skill: 'deal-score',
    example_value: '74',
  },
  {
    key: 'enhanced_deal_score',
    label: 'Enhanced Deal Score',
    description: 'Deal score enriched with conversation intelligence signals',
    applies_to: ['deal'],
    value_type: 'number',
    compatible_crm_types: ['number'],
    source_skill: 'enhanced-deal-score',
    example_value: '81',
  },
  {
    key: 'account_score',
    label: 'Account Score',
    description: 'Numeric account health score (0–100)',
    applies_to: ['account', 'company'],
    value_type: 'number',
    compatible_crm_types: ['number'],
    source_skill: 'account-score',
    example_value: '68',
  },
  {
    key: 'enhanced_account_score',
    label: 'Enhanced Account Score',
    description: 'Account score enriched with ICP fit signals',
    applies_to: ['account', 'company'],
    value_type: 'number',
    compatible_crm_types: ['number'],
    source_skill: 'enhanced-account-score',
    example_value: '79',
  },
  {
    key: 'account_signals_text',
    label: 'Account Signals',
    description: 'Free-text summary of account risk and engagement signals',
    applies_to: ['account', 'company', 'deal'],
    value_type: 'textarea',
    compatible_crm_types: ['textarea', 'text'],
    source_skill: 'account-score',
    example_value: 'No executive sponsor. Last activity 47 days ago. 2 open support tickets.',
  },
  {
    key: 'deal_risk_summary',
    label: 'Deal Risk Summary',
    description: 'AI-generated risk narrative for the deal',
    applies_to: ['deal'],
    value_type: 'textarea',
    compatible_crm_types: ['textarea', 'text'],
    source_skill: 'deal-score',
    example_value: 'Single-threaded with IC only. No procurement contact identified. Close date 12 days out.',
  },
  {
    key: 'next_step_recommendation',
    label: 'Next Step Recommendation',
    description: 'AI-recommended next action to advance the deal',
    applies_to: ['deal'],
    value_type: 'textarea',
    compatible_crm_types: ['textarea', 'text'],
    source_skill: 'deal-score',
    example_value: 'Schedule executive alignment call. Loop in VP Sales before security review.',
  },
  {
    key: 'pandora_last_analyzed_at',
    label: 'Pandora Last Analyzed',
    description: 'Timestamp of the last Pandora analysis for this record',
    applies_to: ['deal', 'account', 'company'],
    value_type: 'text',
    compatible_crm_types: ['text', 'date', 'datetime'],
    source_skill: '*',
    example_value: '2026-02-21T09:00:00Z',
  },
];

export function getFieldByKey(key: string): PandoraWritableField | undefined {
  return PANDORA_WRITABLE_FIELDS.find(f => f.key === key);
}

export function getFieldsForObjectType(objectType: CRMObjectType): PandoraWritableField[] {
  return PANDORA_WRITABLE_FIELDS.filter(f => f.applies_to.includes(objectType));
}
