export type QuestionComplexity = 'lookup' | 'focused' | 'investigation';

export interface ComplexityResult {
  tier: QuestionComplexity;
  primary_skill: string | null;
  max_skills: number;
  allow_fresh_runs: boolean;
  reasoning: string;
}

export async function classifyComplexity(
  message: string,
  context?: {
    hasStructuredGoals: boolean;
    recentSkillRunCount: number;
  },
): Promise<ComplexityResult> {
  const lower = message.toLowerCase().trim();

  // ─── TIER 1: Lookup patterns ───────────────────────────────────────────────

  // Direct entity/metric list requests
  if (
    /^(show|list|give|get|pull|what('?s| is| are))\s+(me\s+)?(the\s+)?\w+('?s)?\s+(deals?|pipeline|opportunities|accounts?|contacts?)/i.test(
      lower,
    )
  ) {
    return {
      tier: 'lookup',
      primary_skill: inferPrimarySkill(lower),
      max_skills: 1,
      allow_fresh_runs: false,
      reasoning: 'Direct entity/metric request — single skill lookup',
    };
  }

  // Single metric questions
  if (/^what('?s| is| are)\s+(the|our|my)\s+(close|win|conversion)\s+rate/i.test(lower)) {
    return {
      tier: 'lookup',
      primary_skill: 'forecast-rollup',
      max_skills: 1,
      allow_fresh_runs: false,
      reasoning: 'Single metric question',
    };
  }

  // Rep-specific without "why"
  if (
    /\b(sarah|mike|jack|nate|jake|alex|emily|chris|jessica|ryan|megan|ashley|brandon|david|kate)\b.*\b(deals?|pipeline|quota|numbers?|attainment|performance)\b/i.test(
      lower,
    ) &&
    !/\bwhy\b/i.test(lower)
  ) {
    return {
      tier: 'lookup',
      primary_skill: 'rep-scorecard',
      max_skills: 1,
      allow_fresh_runs: false,
      reasoning: 'Rep-specific lookup without causal question',
    };
  }

  // Quick status checks — single domain, no causal component
  if (
    /^(show|give|pull|get)\s+(me\s+)?(the\s+)?(forecast|pipeline|coverage|hygiene|dashboard|brief|summary|update)$/i.test(
      lower,
    )
  ) {
    return {
      tier: 'lookup',
      primary_skill: inferPrimarySkill(lower),
      max_skills: 1,
      allow_fresh_runs: false,
      reasoning: 'Single-word status request — direct lookup',
    };
  }

  // ─── TIER 3: Investigation patterns ───────────────────────────────────────

  // Goal/target reference + causal/predictive component
  if (
    /\b(hit(ting)?|miss(ing)?|make|on.?track|behind|ahead|gap|target|goal|quota|number)\b/i.test(lower) &&
    /\b(going to|will we|can we|are we|why|what.*(need|change|do|fix)|how do we|what.*(happen|wrong))\b/i.test(lower)
  ) {
    return {
      tier: 'investigation',
      primary_skill: 'forecast-rollup',
      max_skills: 5,
      allow_fresh_runs: true,
      reasoning: 'Goal-referenced question with causal/predictive component',
    };
  }

  // Explicit "why" questions
  if (/^why\b/i.test(lower) || /\bwhy (did|is|are|has|have|does)\b/i.test(lower)) {
    return {
      tier: 'investigation',
      primary_skill: inferPrimarySkill(lower),
      max_skills: 5,
      allow_fresh_runs: true,
      reasoning: '"Why" question requires causal investigation across skills',
    };
  }

  // Multi-domain questions
  if (/\b(and|versus|vs\.?|compared|across|between)\b/i.test(lower) && countDomains(lower) >= 2) {
    return {
      tier: 'investigation',
      primary_skill: inferPrimarySkill(lower),
      max_skills: 5,
      allow_fresh_runs: true,
      reasoning: 'Multi-domain comparison requires cross-skill analysis',
    };
  }

  // Open-ended strategic questions
  if (
    /\b(what('?s| is)\s+(going\s+)?(wrong|happening|off)|what\s+should\s+(we|i)|give me the full picture|deep.?dive|full.?review|everything|root cause)\b/i.test(
      lower,
    )
  ) {
    return {
      tier: 'investigation',
      primary_skill: inferPrimarySkill(lower),
      max_skills: 5,
      allow_fresh_runs: true,
      reasoning: 'Open-ended strategic question',
    };
  }

  // ─── TIER 2: Default ───────────────────────────────────────────────────────
  return {
    tier: 'focused',
    primary_skill: inferPrimarySkill(lower),
    max_skills: 2,
    allow_fresh_runs: false,
    reasoning: 'Standard question — focused investigation with 1-2 skills',
  };
}

export function inferPrimarySkill(lower: string): string {
  if (
    /\b(forecast|predict|landing|commit|best case|worst case|upside|p50|weighted|coverage ratio)\b/i.test(lower)
  ) {
    return 'forecast-rollup';
  }
  if (/\b(pipeline|hygiene|stale|stuck|aging|no next step|missing)\b/i.test(lower)) {
    return 'pipeline-hygiene';
  }
  if (/\b(rep|scorecard|performance|quota attainment|activity|ramp|individual)\b/i.test(lower)) {
    return 'rep-scorecard';
  }
  if (/\b(deal|risk|regression|slip|push|close date|single.?thread)\b/i.test(lower)) {
    return 'deal-risk-review';
  }
  if (/\b(waterfall|created|generation|gen|new pipeline|sourced|net new)\b/i.test(lower)) {
    return 'pipeline-waterfall';
  }
  if (
    /\b(coverage|pipe.?to.?quota|pipeline coverage)\b/i.test(lower) &&
    !/waterfall/i.test(lower)
  ) {
    return 'pipeline-coverage';
  }
  if (/\b(conversation|call|meeting|talk|said|discussed|sentiment|objection)\b/i.test(lower)) {
    return 'conversation-intelligence';
  }
  if (/\b(bowtie|funnel|full|review|everything|overview|brief)\b/i.test(lower)) {
    return 'forecast-rollup';
  }
  return 'forecast-rollup';
}

function countDomains(lower: string): number {
  let count = 0;
  if (/\b(pipeline|coverage|hygiene)\b/.test(lower)) count++;
  if (/\b(forecast|commit|weighted|landing)\b/.test(lower)) count++;
  if (/\b(rep|scorecard|performance|quota)\b/.test(lower)) count++;
  if (/\b(deal|risk|regression|slip)\b/.test(lower)) count++;
  if (/\b(conversation|call|meeting|sentiment)\b/.test(lower)) count++;
  return count;
}
