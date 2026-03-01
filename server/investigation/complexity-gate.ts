import { SkillRegistry } from '../skills/registry.js';

export type QuestionComplexity = 'data_query' | 'lookup' | 'focused' | 'investigation';

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

  // ─── TIER 0: Direct data queries — SQL, no AI synthesis ────────────────────
  // Questions answerable with a single aggregation or filter query against deals.

  const dataQueryPatterns = [
    /^how (much|many)\s+(pipeline|revenue|deals?|opportunities?|arr)\b/i,
    /\b(break\s*down|breakdown|split|segment)\b.+\b(by|per|across)\b/i,
    /^(total|sum|count)\s+(pipeline|revenue|deals?|opportunities?)\b/i,
    /^(list|show|give me|pull)\s+(all\s+)?(the\s+)?(open\s+)?(deals?|opportunities?)\b/i,
    /\b(average|avg|mean|median)\s+(deal\s+size|deal\s+value|cycle|amount)\b/i,
    /how many\s+(deals?|opportunities?|opps?)\s+(in|at)\s+/i,
    /^pipeline\s+(by|per|across)\s+/i,
  ];

  const notDataQuery = [
    /\bwhy\b/i,
    /\bshould\b/i,
    /\bhealthy\b/i,
    /\bon track\b/i,
    /\bcompare\b.*\b(to|with|against)\b/i,
    /\btrend\b/i,
    /\bchanged?\b/i,
    /\bimprove\b/i,
    /\brisk\b/i,
    /\bforecast\b/i,
    /\bgoing to\b/i,
    /\bwill we\b/i,
    /\bcan we\b/i,
    /\bdo we need\b/i,
  ];

  const isDataQuery = dataQueryPatterns.some(p => p.test(lower));
  const isAnalytical = notDataQuery.some(p => p.test(lower));

  if (isDataQuery && !isAnalytical) {
    return {
      tier: 'data_query',
      primary_skill: null,
      max_skills: 0,
      allow_fresh_runs: false,
      reasoning: 'Direct data query — SQL, no AI needed',
    };
  }

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

  // Direct metric amount questions — "How much pipeline...", "What's the pipeline in...", etc.
  if (
    /^(how much|what('?s| is| are) (the|our|my|total)(\s+\w+)?)\s+(pipeline|forecast|revenue|deals?|quota|coverage|weighted)\b/i.test(lower) &&
    !/\b(why|going to|will we|can we|do we need|compare|versus|vs\.?|across)\b/i.test(lower)
  ) {
    return {
      tier: 'lookup',
      primary_skill: inferPrimarySkill(lower),
      max_skills: 1,
      allow_fresh_runs: false,
      reasoning: 'Direct metric amount question — single skill lookup',
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
  const registry = SkillRegistry.getInstance();
  const skills = registry.getAll();
  
  let bestSkillId = 'forecast-rollup';
  let highestScore = 0;
  let firstMatchIndex = Infinity;

  for (const skill of skills) {
    if (!skill.answers_questions || skill.answers_questions.length === 0) continue;

    let score = 0;
    let skillFirstMatchIndex = Infinity;

    for (const phrase of skill.answers_questions) {
      const index = lower.indexOf(phrase.toLowerCase());
      if (index !== -1) {
        score++;
        if (index < skillFirstMatchIndex) {
          skillFirstMatchIndex = index;
        }
      }
    }

    if (score > highestScore) {
      highestScore = score;
      bestSkillId = skill.id;
      firstMatchIndex = skillFirstMatchIndex;
    } else if (score > 0 && score === highestScore) {
      // Tie-break by position (earlier match wins)
      if (skillFirstMatchIndex < firstMatchIndex) {
        bestSkillId = skill.id;
        firstMatchIndex = skillFirstMatchIndex;
      }
    }
  }

  return bestSkillId;
}

function countDomains(lower: string): number {
  const registry = SkillRegistry.getInstance();
  const skills = registry.getAll();
  const matchedCategories = new Set<string>();

  for (const skill of skills) {
    if (!skill.answers_questions) continue;
    
    const hasMatch = skill.answers_questions.some(phrase => 
      lower.includes(phrase.toLowerCase())
    );

    if (hasMatch) {
      matchedCategories.add(skill.category);
    }
  }

  return matchedCategories.size;
}
