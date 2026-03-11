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
  value_type: 'number' | 'text' | 'textarea' | 'boolean' | 'date' | 'enum';
  compatible_crm_types: string[]; // CRM field types that can receive this
  source_skill: string;          // which skill produces this field
  example_value: string;         // shown in the mapper UI
  writable?: boolean;            // can be written by workflow rules (default false)
  always_queue?: boolean;        // must always require HITL approval (default false)
  value_expr_supported?: boolean;// supports expressions like today+3d (default false)
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

  // MEDDPICC fields
  {
    key: 'meddic_metrics',
    label: 'MEDDIC - Metrics',
    description: 'Quantifiable metrics that show value to the customer',
    applies_to: ['deal'],
    value_type: 'textarea',
    compatible_crm_types: ['textarea', 'text'],
    source_skill: 'workflow',
    example_value: 'Reduce ticket volume by 40%, save $250K annually in support costs',
    writable: true,
  },
  {
    key: 'meddic_economic_buyer',
    label: 'MEDDIC - Economic Buyer',
    description: 'Person with budget authority and power to approve purchase',
    applies_to: ['deal'],
    value_type: 'text',
    compatible_crm_types: ['text'],
    source_skill: 'workflow',
    example_value: 'Sarah Chen, VP Customer Success',
    writable: true,
  },
  {
    key: 'meddic_decision_criteria',
    label: 'MEDDIC - Decision Criteria',
    description: 'Formal and informal criteria used to evaluate vendors',
    applies_to: ['deal'],
    value_type: 'textarea',
    compatible_crm_types: ['textarea', 'text'],
    source_skill: 'workflow',
    example_value: 'SOC 2 compliance, uptime SLA >99.9%, API integration capability',
    writable: true,
  },
  {
    key: 'meddic_decision_process',
    label: 'MEDDIC - Decision Process',
    description: 'Steps and timeline for making purchasing decision',
    applies_to: ['deal'],
    value_type: 'textarea',
    compatible_crm_types: ['textarea', 'text'],
    source_skill: 'workflow',
    example_value: 'Technical review (Week 1), Security review (Week 2), CFO approval (Week 3)',
    writable: true,
  },
  {
    key: 'meddic_identify_pain',
    label: 'MEDDIC - Identify Pain',
    description: 'Critical business pain that drives urgency to buy',
    applies_to: ['deal'],
    value_type: 'textarea',
    compatible_crm_types: ['textarea', 'text'],
    source_skill: 'workflow',
    example_value: 'Manual data entry causing 15% error rate, compliance audit coming in Q3',
    writable: true,
  },
  {
    key: 'meddic_champion',
    label: 'MEDDIC - Champion',
    description: 'Internal advocate who sells on your behalf',
    applies_to: ['deal'],
    value_type: 'text',
    compatible_crm_types: ['text'],
    source_skill: 'workflow',
    example_value: 'David Kim, Director of Operations',
    writable: true,
  },
  {
    key: 'meddic_competition',
    label: 'MEDDIC - Competition',
    description: 'Competing vendors and differentiation strategy',
    applies_to: ['deal'],
    value_type: 'textarea',
    compatible_crm_types: ['textarea', 'text'],
    source_skill: 'workflow',
    example_value: 'Also evaluating Competitor A (lacks API), Competitor B (poor support)',
    writable: true,
  },

  // SPICED fields
  {
    key: 'spiced_situation',
    label: 'SPICED - Situation',
    description: "Current state of prospect's business",
    applies_to: ['deal'],
    value_type: 'textarea',
    compatible_crm_types: ['textarea', 'text'],
    source_skill: 'workflow',
    example_value: 'Growing fast, hiring 20 support reps this quarter, current system not scaling',
    writable: true,
  },
  {
    key: 'spiced_pain',
    label: 'SPICED - Pain',
    description: 'Specific pain points causing problems',
    applies_to: ['deal'],
    value_type: 'textarea',
    compatible_crm_types: ['textarea', 'text'],
    source_skill: 'workflow',
    example_value: 'Customer wait times up 3x, CSAT dropped from 85 to 72',
    writable: true,
  },
  {
    key: 'spiced_impact',
    label: 'SPICED - Impact',
    description: 'Business impact of solving the pain',
    applies_to: ['deal'],
    value_type: 'textarea',
    compatible_crm_types: ['textarea', 'text'],
    source_skill: 'workflow',
    example_value: 'Reduce churn by 15%, increase NPS by 20 points, save 10 hours/week per agent',
    writable: true,
  },
  {
    key: 'spiced_critical_event',
    label: 'SPICED - Critical Event',
    description: 'Deadline or event driving urgency',
    applies_to: ['deal'],
    value_type: 'text',
    compatible_crm_types: ['text'],
    source_skill: 'workflow',
    example_value: 'New fiscal year budget freeze after Q4, compliance audit in August',
    writable: true,
  },
  {
    key: 'spiced_decision',
    label: 'SPICED - Decision',
    description: 'Decision-making process and stakeholders',
    applies_to: ['deal'],
    value_type: 'textarea',
    compatible_crm_types: ['textarea', 'text'],
    source_skill: 'workflow',
    example_value: 'VP Customer Success decides, CFO signs off on contracts >$50K',
    writable: true,
  },

  // BANT fields
  {
    key: 'bant_budget',
    label: 'BANT - Budget',
    description: 'Budget allocated and approval process',
    applies_to: ['deal'],
    value_type: 'text',
    compatible_crm_types: ['text'],
    source_skill: 'workflow',
    example_value: '$75K allocated in Customer Success budget, VP can approve',
    writable: true,
  },
  {
    key: 'bant_authority',
    label: 'BANT - Authority',
    description: 'Who has authority to make the purchase decision',
    applies_to: ['deal'],
    value_type: 'text',
    compatible_crm_types: ['text'],
    source_skill: 'workflow',
    example_value: 'VP Customer Success (primary), CFO approval needed for contracts >$50K',
    writable: true,
  },
  {
    key: 'bant_need',
    label: 'BANT - Need',
    description: 'Business need and pain driving the purchase',
    applies_to: ['deal'],
    value_type: 'textarea',
    compatible_crm_types: ['textarea', 'text'],
    source_skill: 'workflow',
    example_value: 'Scaling support team 3x this year, current tools causing agent burnout',
    writable: true,
  },
  {
    key: 'bant_timeline',
    label: 'BANT - Timeline',
    description: 'Expected timeline for purchase decision',
    applies_to: ['deal'],
    value_type: 'text',
    compatible_crm_types: ['text'],
    source_skill: 'workflow',
    example_value: 'Need to go live before Q4 hiring push, decision by end of Q2',
    writable: true,
  },

  // High-value pipeline fields
  {
    key: 'next_action_date',
    label: 'Next Action Date',
    description: 'Date when next action should be taken on this deal',
    applies_to: ['deal'],
    value_type: 'date',
    compatible_crm_types: ['date', 'datetime'],
    source_skill: 'workflow',
    example_value: '2026-03-15',
    writable: true,
    value_expr_supported: true,
  },
  {
    key: 'next_steps',
    label: 'Next Steps',
    description: 'Specific next steps to advance the deal',
    applies_to: ['deal'],
    value_type: 'textarea',
    compatible_crm_types: ['textarea', 'text'],
    source_skill: 'workflow',
    example_value: 'Schedule security review with CISO, send pricing for 100-user tier',
    writable: true,
  },
  {
    key: 'forecast_category',
    label: 'Forecast Category',
    description: 'Deal forecast category (Commit, Best Case, Pipeline, Omit)',
    applies_to: ['deal'],
    value_type: 'enum',
    compatible_crm_types: ['enumeration', 'picklist', 'text'],
    source_skill: 'workflow',
    example_value: 'Best Case',
    writable: true,
    always_queue: true,
  },
  {
    key: 'deal_stage',
    label: 'Deal Stage',
    description: 'Current stage in the sales pipeline',
    applies_to: ['deal'],
    value_type: 'enum',
    compatible_crm_types: ['enumeration', 'picklist', 'text'],
    source_skill: 'workflow',
    example_value: 'Proposal',
    writable: true,
    always_queue: true,
  },
  {
    key: 'amount',
    label: 'Amount',
    description: 'Deal amount in USD',
    applies_to: ['deal'],
    value_type: 'number',
    compatible_crm_types: ['number', 'currency'],
    source_skill: 'workflow',
    example_value: '75000',
    writable: true,
    always_queue: true,
  },
  {
    key: 'close_date',
    label: 'Close Date',
    description: 'Expected close date',
    applies_to: ['deal'],
    value_type: 'date',
    compatible_crm_types: ['date', 'datetime'],
    source_skill: 'workflow',
    example_value: '2026-06-30',
    writable: true,
    always_queue: true,
  },

  // Contact fields
  {
    key: 'contact_role',
    label: 'Contact Role',
    description: 'Role in the buying process (Champion, Decision Maker, Influencer, etc.)',
    applies_to: ['contact'],
    value_type: 'enum',
    compatible_crm_types: ['enumeration', 'picklist', 'text'],
    source_skill: 'workflow',
    example_value: 'Champion',
    writable: true,
  },
  {
    key: 'contact_title',
    label: 'Contact Title',
    description: 'Job title',
    applies_to: ['contact'],
    value_type: 'text',
    compatible_crm_types: ['text'],
    source_skill: 'workflow',
    example_value: 'VP Customer Success',
    writable: true,
  },
];

export function getFieldByKey(key: string): PandoraWritableField | undefined {
  return PANDORA_WRITABLE_FIELDS.find(f => f.key === key);
}

export function getFieldsForObjectType(objectType: CRMObjectType): PandoraWritableField[] {
  return PANDORA_WRITABLE_FIELDS.filter(f => f.applies_to.includes(objectType));
}

export function getWritableFields(objectType?: CRMObjectType): PandoraWritableField[] {
  const fields = objectType
    ? PANDORA_WRITABLE_FIELDS.filter(f => f.writable && f.applies_to.includes(objectType))
    : PANDORA_WRITABLE_FIELDS.filter(f => f.writable);
  return fields;
}

export function requiresApproval(fieldKey: string): boolean {
  const field = getFieldByKey(fieldKey);
  return field?.always_queue === true;
}
