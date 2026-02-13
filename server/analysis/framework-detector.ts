/**
 * Qualification Framework Detection
 *
 * Detects MEDDPIC/BANT/SPICED/MEDDICC frameworks in CRM custom fields
 * by pattern matching field names and labels.
 *
 * Spec: PANDORA_DEAL_INSIGHTS_SPEC.md (Part 2)
 */

import { createLogger } from '../utils/logger.js';

const logger = createLogger('FrameworkDetector');

// ============================================================================
// Types
// ============================================================================

export interface FrameworkPattern {
  insight_type: string;
  patterns: RegExp[];
  description: string;
}

export interface MatchedField {
  crm_field_name: string;
  crm_field_label: string;
  insight_type: string;
  fill_rate: number;
  object_type: string;
}

export interface FrameworkDetectionResult {
  detected_framework: string | null;
  confidence: number; // % of framework fields found
  matched_fields: MatchedField[];
  unmatched_framework_fields: string[]; // framework fields with no CRM equivalent
  unmapped_custom_fields: {
    crm_field_name: string;
    crm_field_label: string;
    fill_rate: number;
    object_type: string;
  }[];
}

// ============================================================================
// Framework Patterns
// ============================================================================

const FRAMEWORK_PATTERNS: Record<string, FrameworkPattern[]> = {
  meddpic: [
    {
      insight_type: 'metrics',
      patterns: [/meddpic.*metric/i, /measurable.*result/i, /quantified.*value/i, /\bmetrics?\b/i],
      description: 'Measurable results or quantified value the solution will deliver',
    },
    {
      insight_type: 'economic_buyer',
      patterns: [/economic.*buyer/i, /\beb\b/i, /exec.*sponsor/i, /financial.*approver/i],
      description: 'Person with budget authority to approve the purchase',
    },
    {
      insight_type: 'decision_criteria',
      patterns: [/decision.*criter/i, /\bdc\b/i, /eval.*criter/i, /selection.*criter/i],
      description: 'Technical and business criteria used to evaluate solutions',
    },
    {
      insight_type: 'decision_process',
      patterns: [/decision.*process/i, /\bdp\b/i, /buying.*process/i, /approval.*process/i, /paper.*process/i],
      description: 'Steps and timeline for approval, including stakeholders',
    },
    {
      insight_type: 'implicate_pain',
      patterns: [/implicate.*pain/i, /\bip\b/i, /pain.*point/i, /business.*impact/i, /cost.*problem/i],
      description: 'Business impact and cost of not solving the problem',
    },
    {
      insight_type: 'champion',
      patterns: [/champion/i, /internal.*advocate/i, /coach/i, /sponsor/i],
      description: 'Internal advocate who actively sells on your behalf',
    },
  ],

  meddpicc: [
    {
      insight_type: 'metrics',
      patterns: [/meddpicc.*metric/i, /measurable.*result/i, /quantified.*value/i, /\bmetrics?\b/i],
      description: 'Measurable results or quantified value',
    },
    {
      insight_type: 'economic_buyer',
      patterns: [/economic.*buyer/i, /\beb\b/i, /exec.*sponsor/i],
      description: 'Person with budget authority',
    },
    {
      insight_type: 'decision_criteria',
      patterns: [/decision.*criter/i, /\bdc\b/i, /eval.*criter/i],
      description: 'Evaluation criteria',
    },
    {
      insight_type: 'decision_process',
      patterns: [/decision.*process/i, /\bdp\b/i, /buying.*process/i, /paper.*process/i],
      description: 'Approval process and timeline',
    },
    {
      insight_type: 'implicate_pain',
      patterns: [/implicate.*pain/i, /\bip\b/i, /pain.*point/i],
      description: 'Business impact of problem',
    },
    {
      insight_type: 'champion',
      patterns: [/champion/i, /internal.*advocate/i, /coach/i],
      description: 'Internal advocate',
    },
    {
      insight_type: 'competition',
      patterns: [/competi/i, /alternative/i, /incumbent/i, /other.*vendor/i],
      description: 'Other vendors being evaluated or incumbent solutions',
    },
  ],

  meddicc: [
    {
      insight_type: 'metrics',
      patterns: [/meddicc.*metric/i, /measurable.*result/i, /\bmetrics?\b/i],
      description: 'Measurable results',
    },
    {
      insight_type: 'economic_buyer',
      patterns: [/economic.*buyer/i, /\beb\b/i, /exec.*sponsor/i],
      description: 'Budget authority',
    },
    {
      insight_type: 'decision_criteria',
      patterns: [/decision.*criter/i, /\bdc\b/i, /eval.*criter/i],
      description: 'Evaluation criteria',
    },
    {
      insight_type: 'decision_process',
      patterns: [/decision.*process/i, /\bdp\b/i, /buying.*process/i],
      description: 'Approval process',
    },
    {
      insight_type: 'implicate_pain',
      patterns: [/implicate.*pain/i, /\bip\b/i, /pain.*point/i],
      description: 'Business impact',
    },
    {
      insight_type: 'champion',
      patterns: [/champion/i, /internal.*advocate/i, /coach/i],
      description: 'Internal advocate',
    },
    {
      insight_type: 'competition',
      patterns: [/competi/i, /alternative/i, /incumbent/i],
      description: 'Competitors',
    },
  ],

  bant: [
    {
      insight_type: 'budget',
      patterns: [/budget/i, /funding/i, /spend.*authority/i, /financial.*approval/i],
      description: 'Budget range, funding status, fiscal constraints',
    },
    {
      insight_type: 'authority',
      patterns: [/authority/i, /decision.*maker/i, /\bdm\b/i, /approver/i, /sign.*off/i],
      description: 'Person with authority to approve the purchase',
    },
    {
      insight_type: 'need',
      patterns: [/\bneed\b/i, /requirement/i, /use.*case/i, /pain/i, /problem/i],
      description: 'Business need or problem to be solved',
    },
    {
      insight_type: 'timeline',
      patterns: [/timeline/i, /timeframe/i, /urgency/i, /go.*live/i, /implement.*date/i, /deadline/i],
      description: 'When they need a solution, go-live dates',
    },
  ],

  spiced: [
    {
      insight_type: 'situation',
      patterns: [/situation/i, /current.*state/i, /status.*quo/i, /as.*is/i],
      description: 'Current state and context',
    },
    {
      insight_type: 'pain_point',
      patterns: [/pain/i, /challenge/i, /problem/i, /frustrat/i, /issue/i],
      description: 'Specific problems or challenges',
    },
    {
      insight_type: 'impact',
      patterns: [/impact/i, /consequence/i, /cost.*inaction/i, /downside/i],
      description: 'Business impact or cost of inaction',
    },
    {
      insight_type: 'critical_event',
      patterns: [/critical.*event/i, /trigger/i, /catalyst/i, /deadline/i, /compelling.*event/i],
      description: 'Trigger or compelling event driving urgency',
    },
    {
      insight_type: 'decision_criteria',
      patterns: [/decision/i, /criter/i, /eval/i, /requirement/i, /selection/i],
      description: 'What they are evaluating against',
    },
  ],
};

// ============================================================================
// Detection Logic
// ============================================================================

/**
 * Detect qualification framework from CRM custom fields
 */
export function detectFramework(
  customFields: {
    name: string;
    label: string;
    fill_rate: number;
    object_type: string;
  }[]
): FrameworkDetectionResult {
  logger.info('Detecting qualification framework', {
    fieldCount: customFields.length,
  });

  // Only look at Opportunity/Deal fields
  const opportunityFields = customFields.filter(
    f => f.object_type === 'opportunity' || f.object_type === 'deal'
  );

  if (opportunityFields.length === 0) {
    logger.info('No opportunity/deal custom fields found');
    return {
      detected_framework: null,
      confidence: 0,
      matched_fields: [],
      unmatched_framework_fields: [],
      unmapped_custom_fields: customFields,
    };
  }

  // Score each framework
  const frameworkScores: Record<string, {
    matches: MatchedField[];
    totalFields: number;
  }> = {};

  for (const [frameworkName, patterns] of Object.entries(FRAMEWORK_PATTERNS)) {
    const matches: MatchedField[] = [];

    for (const pattern of patterns) {
      // Check each opportunity field against this pattern
      for (const field of opportunityFields) {
        const nameMatch = pattern.patterns.some(p => p.test(field.name));
        const labelMatch = pattern.patterns.some(p => p.test(field.label));

        if (nameMatch || labelMatch) {
          matches.push({
            crm_field_name: field.name,
            crm_field_label: field.label,
            insight_type: pattern.insight_type,
            fill_rate: field.fill_rate,
            object_type: field.object_type,
          });
          break; // Don't double-count a field for the same pattern
        }
      }
    }

    frameworkScores[frameworkName] = {
      matches,
      totalFields: patterns.length,
    };
  }

  // Determine best match
  let bestFramework: string | null = null;
  let bestScore = 0;
  let bestMatches: MatchedField[] = [];

  for (const [frameworkName, score] of Object.entries(frameworkScores)) {
    const matchCount = score.matches.length;

    // Require at least 3 matches to detect a framework
    if (matchCount >= 3 && matchCount > bestScore) {
      bestScore = matchCount;
      bestFramework = frameworkName;
      bestMatches = score.matches;
    }
  }

  if (!bestFramework) {
    logger.info('No framework detected (< 3 matching fields)');
    return {
      detected_framework: null,
      confidence: 0,
      matched_fields: [],
      unmatched_framework_fields: [],
      unmapped_custom_fields: opportunityFields,
    };
  }

  // Calculate confidence
  const totalFrameworkFields = frameworkScores[bestFramework].totalFields;
  const confidence = Math.round((bestScore / totalFrameworkFields) * 100);

  // Find unmatched framework fields
  const matchedTypes = new Set(bestMatches.map(m => m.insight_type));
  const unmatchedTypes = FRAMEWORK_PATTERNS[bestFramework]
    .filter(p => !matchedTypes.has(p.insight_type))
    .map(p => p.insight_type);

  // Find unmapped custom fields (fields that didn't match any pattern)
  const matchedFieldNames = new Set(bestMatches.map(m => m.crm_field_name));
  const unmappedFields = opportunityFields
    .filter(f => !matchedFieldNames.has(f.name))
    .map(f => ({
      crm_field_name: f.name,
      crm_field_label: f.label,
      fill_rate: f.fill_rate,
      object_type: f.object_type,
    }));

  logger.info('Framework detected', {
    framework: bestFramework,
    confidence,
    matchedFields: bestScore,
    totalFields: totalFrameworkFields,
  });

  return {
    detected_framework: bestFramework,
    confidence,
    matched_fields: bestMatches,
    unmatched_framework_fields: unmatchedTypes,
    unmapped_custom_fields: unmappedFields,
  };
}

/**
 * Get default insight types for a framework
 */
export function getFrameworkInsightTypes(
  framework: string
): Array<{
  insight_type: string;
  label: string;
  description: string;
  framework_source: string;
  enabled: boolean;
}> {
  const patterns = FRAMEWORK_PATTERNS[framework.toLowerCase()];

  if (!patterns) {
    return getDefaultInsightTypes();
  }

  return patterns.map(p => ({
    insight_type: p.insight_type,
    label: capitalize(p.insight_type.replace(/_/g, ' ')),
    description: p.description,
    framework_source: framework,
    enabled: true,
  }));
}

/**
 * Get universal insight types (when no framework selected)
 */
export function getDefaultInsightTypes(): Array<{
  insight_type: string;
  label: string;
  description: string;
  framework_source: string;
  enabled: boolean;
}> {
  return [
    {
      insight_type: 'champion',
      label: 'Champion / Internal Advocate',
      description: 'Person inside the buying org who actively supports your deal',
      framework_source: 'universal',
      enabled: true,
    },
    {
      insight_type: 'decision_maker',
      label: 'Decision Maker',
      description: 'Person with authority to approve the purchase',
      framework_source: 'universal',
      enabled: true,
    },
    {
      insight_type: 'pain_point',
      label: 'Pain Point / Challenge',
      description: 'Specific problems the prospect is trying to solve',
      framework_source: 'universal',
      enabled: true,
    },
    {
      insight_type: 'timeline',
      label: 'Timeline / Urgency',
      description: 'When they need a solution, go-live dates, deadlines',
      framework_source: 'universal',
      enabled: true,
    },
    {
      insight_type: 'budget',
      label: 'Budget',
      description: 'Budget range, funding status, fiscal year constraints',
      framework_source: 'universal',
      enabled: true,
    },
    {
      insight_type: 'competition',
      label: 'Competition / Alternatives',
      description: 'Other vendors being evaluated, incumbent solutions',
      framework_source: 'universal',
      enabled: true,
    },
    {
      insight_type: 'next_steps',
      label: 'Next Steps',
      description: 'Agreed next actions from the call',
      framework_source: 'universal',
      enabled: true,
    },
    {
      insight_type: 'decision_criteria',
      label: 'Decision Criteria',
      description: 'What the buyer is evaluating against (technical, business)',
      framework_source: 'universal',
      enabled: true,
    },
  ];
}

function capitalize(str: string): string {
  return str
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}
