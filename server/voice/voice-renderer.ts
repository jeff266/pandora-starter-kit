import type { VoiceProfile, VoiceRenderContext, VoiceRenderOutput } from './types.js';

export function buildVoiceSystemPromptSection(profile: VoiceProfile, context: VoiceRenderContext): string {
  const sections: string[] = [];

  // Persona Block
  const personaBlocks: Record<string, string> = {
    teammate: `PERSONA: Teammate. 
- You are an embedded member of the sales team. 
- Use "we" and "us" when referring to company goals and collective progress. 
- Your tone is collaborative, proactive, and supportive.`,
    advisor: `PERSONA: Strategic Advisor. 
- You are an external expert providing objective guidance. 
- Maintain professional distance while being deeply insightful. 
- Focus on "the organization" or "the team" rather than "we".`,
    analyst: `PERSONA: Rigorous Analyst. 
- You are a data-driven specialist. 
- Focus strictly on the numbers, trends, and evidence. 
- Avoid subjective encouragement; let the data speak for itself.`
  };
  sections.push(personaBlocks[profile.persona] || personaBlocks.teammate);

  // Directness Block
  const directnessBlocks: Record<string, string> = {
    direct: `DIRECTNESS: Direct. 
- State findings plainly. 
- Do not soften bad news or hedge certainties. 
- If a target is being missed, say so explicitly.`,
    diplomatic: `DIRECTNESS: Diplomatic. 
- Frame gaps as opportunities for growth. 
- Use constructive language for performance issues. 
- Focus on the path forward rather than just the current deficit.`
  };
  sections.push(directnessBlocks[profile.directness] || directnessBlocks.direct);

  // Detail Level Block
  const detailBlocks: Record<string, string> = {
    executive: `DETAIL LEVEL: Executive. 
- High-level summaries only. 
- Focus on bottom-line impact and major risks. 
- Omit tactical details unless they threaten the quarter.`,
    manager: `DETAIL LEVEL: Managerial. 
- Balanced view of strategy and tactics. 
- Include relevant deal-level details that require attention. 
- Focus on team-level performance and pipeline health.`,
    analyst: `DETAIL LEVEL: Analyst. 
- Deep dive into data points. 
- Include granular evidence, stage-by-stage breakdowns, and historical comparisons. 
- Do not summarize away the complexity.`
  };
  sections.push(detailBlocks[profile.detail_level] || detailBlocks.manager);

  // Entity Naming
  if (profile.name_entities) {
    sections.push(`ENTITY NAMING: Always use specific names for deals, reps, and accounts to ensure accountability and clarity.`);
  } else {
    sections.push(`ENTITY NAMING: Anonymize or generalize entities where possible (e.g., "a key account", "one of the reps") to maintain high-level focus.`);
  }

  // Temporal Context & Urgency
  if (profile.temporal_awareness !== 'none') {
    let temporalMsg = `TEMPORAL CONTEXT: `;
    if (context.week_day && (profile.temporal_awareness === 'week_day' || profile.temporal_awareness === 'both')) {
      temporalMsg += `Today is ${context.week_day}. `;
    }
    if (context.days_remaining !== undefined && (profile.temporal_awareness === 'quarter_phase' || profile.temporal_awareness === 'both')) {
      temporalMsg += `There are ${context.days_remaining} days remaining in the quarter. `;
      
      if (context.days_remaining <= 14) {
        temporalMsg += `URGENCY: Extremely high. Focus exclusively on deals that can close in the next 2 weeks.`;
      } else if (context.days_remaining <= 30) {
        temporalMsg += `URGENCY: High. The quarter is entering its final month. Prioritize late-stage pipeline hygiene.`;
      }
    }
    sections.push(temporalMsg);
  }

  // Wins Celebration
  if (profile.celebrate_wins && context.attainment_pct !== undefined && context.attainment_pct >= 100) {
    sections.push(`CELEBRATE WINS: The team has exceeded 100% attainment (${context.attainment_pct}%). Acknowledge this achievement with high energy before diving into further opportunities.`);
  }

  // Uncertainty
  if (profile.surface_uncertainty) {
    sections.push(`UNCERTAINTY: Explicitly state where data is missing or where a trend is too early to call. Do not over-confidently predict outcomes with low evidence.`);
  }

  return sections.join('\n\n');
}

export function applyPostTransforms(text: string, profile: VoiceProfile): VoiceRenderOutput {
  const transformationsApplied: string[] = [];
  let transformedText = text;

  // Hedge phrases to strip
  const hedgePhrases = [
    'it appears that',
    'it seems that',
    'it may be that',
    'it\'s possible that',
    'one could argue that',
    'based on the available data,',
    'the data suggests that',
    'it\'s worth noting that'
  ];

  hedgePhrases.forEach(phrase => {
    const regex = new RegExp(phrase, 'gi');
    if (regex.test(transformedText)) {
      transformedText = transformedText.replace(regex, '');
      transformationsApplied.push(`Stripped hedge: "${phrase}"`);
    }
  });

  // Teammate pronoun transformation
  if (profile.persona === 'teammate') {
    const teamRegex = /\bthe team\b/gi;
    if (teamRegex.test(transformedText)) {
      transformedText = transformedText.replace(teamRegex, 'we');
      transformationsApplied.push('Replaced "the team" with "we"');
    }
  }

  // Cleanup: Capitalize sentence starts after transforms, remove double spaces, and ensure capitalization after newlines
  transformedText = transformedText.replace(/\. +([a-z])/g, (match, char) => `. ${char.toUpperCase()}`);
  transformedText = transformedText.replace(/\n([a-z])/g, (match, char) => `\n${char.toUpperCase()}`);
  transformedText = transformedText.replace(/^([a-z])/, (match, char) => char.toUpperCase());
  transformedText = transformedText.replace(/ +/g, ' ').trim();

  return {
    text: transformedText,
    transformationsApplied
  };
}

export function buildVoiceContext(session: any, workspaceMetrics: any): VoiceRenderContext {
  return {
    attainment_pct: workspaceMetrics?.attainment_pct,
    days_remaining: workspaceMetrics?.days_remaining,
    quarter_phase: workspaceMetrics?.quarter_phase,
    week_day: new Intl.DateTimeFormat('en-US', { weekday: 'long' }).format(new Date()),
    surface: 'chat' // Default to chat, can be overridden
  };
}
