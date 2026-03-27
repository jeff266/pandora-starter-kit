import type { BriefType, EditorialFocus, AiBlurbs } from './brief-types.js';
import { callLLM } from '../utils/llm-router.js';
import { formatCompact } from './brief-utils.js';
import { buildWorkspaceContextBlock } from '../context/workspace-memory.js';
import { PANDORA_VOICE_STANDARD } from '../lib/voice-standard.js';
import { 
  VoiceProfile, 
  DEFAULT_VOICE_PROFILE 
} from '../voice/types.js';
import { 
  buildVoiceSystemPromptSection, 
  applyPostTransforms, 
  buildVoiceContext 
} from '../voice/voice-renderer.js';

type QuarterPhase = 'early' | 'mid' | 'late' | 'final_week';

function getThesisFocusHint(phase: QuarterPhase): string {
  switch (phase) {
    case 'early':      return 'The quarter is young. The diagnosis should focus on pipeline build and coverage.';
    case 'mid':        return 'Mid-quarter. The diagnosis should focus on deal velocity and rep execution gaps.';
    case 'late':       return 'Late quarter. The diagnosis should focus on close plan rigor and which deals are real.';
    case 'final_week': return 'Final week. The diagnosis must name exactly what must close and what will slip.';
  }
}

export async function generateWeeklyThesis(
  workspaceId: string,
  findings: Array<{ severity: string; message: string; skillName?: string; dealName?: string }>,
  theNumber: { attainment_pct?: number | null; coverage_ratio?: number | null; pipeline_total?: number; deal_count?: number; days_remaining?: number; gap?: number },
  quarterPhase: QuarterPhase,
  weekOfQuarter?: number
): Promise<string | null> {
  if (!findings || findings.length < 3) return null;

  const focusHint = getThesisFocusHint(quarterPhase);
  const topFindings = findings
    .filter(f => f.severity === 'critical' || f.severity === 'high' || f.severity === 'warning')
    .slice(0, 5);
  if (topFindings.length < 3) {
    const allSlice = findings.slice(0, 5);
    if (allSlice.length < 3) return null;
    topFindings.push(...allSlice.slice(topFindings.length));
  }

  const findingLines = topFindings.map((f, i) =>
    `${i + 1}. [${f.severity}] ${f.message}${f.dealName ? ` (${f.dealName})` : ''}`
  ).join('\n');

  const attainmentStr = theNumber.attainment_pct != null
    ? `${theNumber.attainment_pct.toFixed(0)}% attainment`
    : null;
  const coverageStr = theNumber.coverage_ratio != null
    ? `${theNumber.coverage_ratio.toFixed(1)}× coverage`
    : null;
  const daysStr = theNumber.days_remaining != null
    ? `${theNumber.days_remaining} days remaining in quarter`
    : null;
  const situationParts = [attainmentStr, coverageStr, daysStr].filter(Boolean).join(', ');

  const systemPrompt = `${PANDORA_VOICE_STANDARD}

You are Pandora, a Chief of Staff AI for a B2B sales leadership team. Write a concise opening thesis for this week's revenue brief. Your output is the first thing the CRO reads — it must earn their attention in three short paragraphs.

TONE: Direct. No hedging. No filler. Write like a trusted advisor who has done the analysis and arrived at a clear view.

FORMAT RULES:
- Return a plain string. No JSON, no markdown, no bullet points, no headers.
- Three paragraphs separated by a single blank line.
- Each paragraph is 1-3 sentences.
- Total output under 120 words.
- Never start a sentence with "I".
- Do not use the word "critical", "alarming", "urgent", or "important".

PARAGRAPH STRUCTURE:
1. Theme/Diagnosis: What is the single most important thing happening in this business right now? Name the pattern across the findings. Be specific.
2. Situation: What does the attainment and pipeline data say? What happens if nothing changes?
3. Recommendation: What is the one thing the team must do this week? Name the action precisely — deal, rep, or move.

${focusHint}`;

  const userPrompt = `Week ${weekOfQuarter ?? '?'} of ${quarterPhase} phase.
${situationParts ? `Metrics: ${situationParts}.` : ''}

Top findings this week:
${findingLines}

Write the three-paragraph thesis now.`;

  try {
    const raw = await callLLM(workspaceId, 'reason', {
      systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
      temperature: 0.3,
      maxTokens: 300,
      _tracking: {
        workspaceId,
        phase: 'briefing',
        stepName: 'generate-weekly-thesis',
      },
    });
    const text = typeof raw === 'string' ? raw : (raw as any)?.content || '';
    const trimmed = text.trim();
    return trimmed.length > 20 ? trimmed : null;
  } catch (err) {
    console.error('[brief-narratives] generateWeeklyThesis failed:', err);
    return null;
  }
}

function getTemporalFocus(phase: QuarterPhase): string {
  switch (phase) {
    case 'early':     return 'Focus: pipeline build and qualification. Coverage ratio is the leading indicator.';
    case 'mid':       return 'Focus: deal velocity and advancement. Flag stalled deals, reinforce commit discipline.';
    case 'late':      return 'Focus: close plan rigor. Question every close date, name the pull-in opportunities.';
    case 'final_week':return 'Focus: landing the quarter. Name exactly what must close and what executive action is needed.';
  }
}

export async function generateBriefNarratives(
  workspaceId: string,
  briefType: BriefType,
  theNumber: any,
  whatChanged: any,
  reps: any[],
  deals: any[],
  editorialFocus: EditorialFocus,
  weekOfQuarter?: number,
  quarterPhase?: QuarterPhase,
  pctQuarterComplete?: number
): Promise<AiBlurbs> {
  const contextBlock = await buildWorkspaceContextBlock(workspaceId).catch(() => '');

  // V004 will load from DB, for now use default
  const voiceProfile: VoiceProfile = DEFAULT_VOICE_PROFILE;
  const voiceContext = buildVoiceContext({}, {
    attainment_pct: theNumber.attainment_pct,
    days_remaining: theNumber.days_remaining,
    quarter_phase: quarterPhase,
    surface: 'brief'
  });
  const voiceSection = buildVoiceSystemPromptSection(voiceProfile, voiceContext);

  const phase: QuarterPhase = quarterPhase ?? 'mid';
  const temporalFocus = getTemporalFocus(phase);
  const quarterPositionLine = weekOfQuarter != null
    ? `Quarter position: Week ${weekOfQuarter}, ${phase} phase, ${Math.round(pctQuarterComplete ?? 0)}% through the quarter.`
    : '';

  const systemPrompt = `${PANDORA_VOICE_STANDARD}

You are Pandora, writing a ${briefType} revenue briefing for a sales leadership team.

## Voice and Tone
${voiceSection}

TEMPORAL CONTEXT:
${temporalFocus}

TONE RULES:
- Calm, specific, professional. Trusted advisor, not an alarm system.
- Use actual names, dollar amounts, and timeframes from the data.
- Never say "terrifying", "flying blind", "alarming", "vanity metrics", "CRITICAL", or "urgent action required".
- Be prescriptive: tell them exactly what needs to happen this week, not just what occurred. Name the deal, name the rep, name the action.
- Give a forecast, not just a status report. Tell them if they're on track and what has to happen to stay on track.
- Short is better. Total output under 200 words.
- If data is sparse, work with what's there. Never refuse.

OUTPUT FORMAT:
Return a valid JSON object only. No markdown fences. No explanation outside the JSON.${contextBlock ? `\n\n${contextBlock}` : ''}`;

  const numberLine = theNumber.attainment_pct != null
    ? `${theNumber.attainment_pct.toFixed(0)}% attainment, ${formatCompact(theNumber.gap || 0)} gap, ${theNumber.days_remaining} days left`
    : `Pipeline: ${formatCompact(theNumber.pipeline_total || 0)} across ${theNumber.deal_count || 0} deals`;

  const pipelineDelta = whatChanged.total_pipeline_delta != null
    ? `${whatChanged.total_pipeline_delta >= 0 ? '+' : ''}${formatCompact(whatChanged.total_pipeline_delta)} WoW`
    : '';

  const coverageLine = theNumber.coverage_ratio != null && theNumber.required_pipeline != null
    ? `Coverage: ${theNumber.coverage_ratio}x (need ${formatCompact(theNumber.required_pipeline)} at ${Math.round((theNumber.forecast?.win_rate || 0.3) * 100)}% win rate to close the gap)`
    : '';

  const repLines = (reps || []).slice(0, 5).map((r: any) =>
    `${r.name}: ${formatCompact(r.pipeline || 0)}${r.attainment_pct != null ? `, ${r.attainment_pct}% attainment` : ''}${r.flag ? ` — ${r.flag}${r.flag_weeks > 1 ? ` (week ${r.flag_weeks})` : ''}` : ''}`
  ).join('\n');

  const dealLines = (deals || [])
    .filter((d: any) => d.severity === 'critical' || d.severity === 'warning')
    .slice(0, 4)
    .map((d: any) => `${d.name}: ${formatCompact(d.amount || 0)} ${d.stage} — ${d.signal_text || d.severity}`)
    .join('\n');

  let requestedKeys = '';
  if (briefType === 'monday_setup') {
    requestedKeys = `Return JSON with exactly these keys:
{"overall_summary":"1-2 sentences. State coverage ratio, attainment pace, and what needs to happen this week to stay on track. No adjectives.","rep_conversation":"2-3 sentences. Name the rep, name the deal, name the specific action required this week. State the dollar amount and close date.","deal_recommendation":"2-3 sentences. Name the deal. State the specific risk as a fact. State the one question to ask or action to take this week."}`;
  } else if (briefType === 'pulse') {
    requestedKeys = `Return JSON with exactly these keys:
{"pulse_summary":"1-2 sentences. State what changed since Monday and whether the forecast is still on track. Reference the coverage ratio if available.","key_action":"1 sentence. Name the deal or rep. State the specific action. State the dollar amount or date that makes it relevant this week."}`;
  } else if (briefType === 'friday_recap') {
    requestedKeys = `Return JSON with exactly these keys:
{"week_summary":"1-2 sentences. State what closed, what slipped, and whether attainment moved. Use dollar amounts, not adjectives.","next_week_focus":"1-2 sentences. Name the specific deal or rep to prioritize Monday. State why it is the highest-leverage action."}`;
  } else if (briefType === 'quarter_close') {
    requestedKeys = `Return JSON with exactly these keys:
{"quarter_situation":"2 sentences. State days remaining, gap to quota, and pipeline coverage as numbers. Do not characterize them.","close_plan":"2 sentences. Name 2-3 specific deals that will determine the quarter. State what needs to happen with each one this week."}`;
  }

  const userPrompt = `Brief Type: ${briefType}
Editorial Focus: ${editorialFocus.primary} — ${editorialFocus.reason}
${quarterPositionLine ? `${quarterPositionLine}\n` : ''}
DATA:
${numberLine}
${pipelineDelta ? `Pipeline change: ${pipelineDelta}` : ''}${whatChanged.streak ? ` (${whatChanged.streak})` : ''}
${coverageLine}
${repLines ? `\nReps:\n${repLines}` : ''}
${dealLines ? `\nAt-risk deals:\n${dealLines}` : ''}

${requestedKeys}`;

  try {
    const response = await callLLM(workspaceId, 'reason', {
      systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
      temperature: 0.3,
      maxTokens: 500,
      _tracking: {
        workspaceId,
        phase: 'briefing',
        stepName: 'generate-brief-narratives',
      },
    });

    const raw = typeof response === 'string' ? response : (response as any)?.content || '';
    const cleaned = raw.replace(/```json\n?|\n?```/g, '').trim();
    try {
      const parsed = JSON.parse(cleaned) as AiBlurbs;
      // Apply voice transforms to each blurb
      for (const key of Object.keys(parsed)) {
        const blurb = (parsed as any)[key];
        if (typeof blurb === 'string') {
          const transformed = applyPostTransforms(blurb, voiceProfile);
          (parsed as any)[key] = transformed.text;
        }
      }
      return parsed;
    } catch {
      console.error('[brief-narratives] Failed to parse LLM JSON:', cleaned.slice(0, 300));
      return {} as AiBlurbs;
    }
  } catch (err) {
    console.error('[brief-narratives] LLM call failed:', err);
    return {} as AiBlurbs;
  }
}
