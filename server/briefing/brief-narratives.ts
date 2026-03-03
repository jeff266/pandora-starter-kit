import type { BriefType, EditorialFocus, AiBlurbs } from './brief-types.js';
import { callLLM } from '../utils/llm-router.js';
import { formatCompact } from './brief-utils.js';
import { buildWorkspaceContextBlock } from '../context/workspace-memory.js';

type QuarterPhase = 'early' | 'mid' | 'late' | 'final_week';

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

  const phase: QuarterPhase = quarterPhase ?? 'mid';
  const temporalFocus = getTemporalFocus(phase);
  const quarterPositionLine = weekOfQuarter != null
    ? `Quarter position: Week ${weekOfQuarter}, ${phase} phase, ${Math.round(pctQuarterComplete ?? 0)}% through the quarter.`
    : '';

  const systemPrompt = `You are Pandora, writing a ${briefType} revenue briefing for a sales leadership team.

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
{"overall_summary":"1-2 sentences: where we stand entering the week and whether we're on pace. Reference the coverage ratio and what it means for the week ahead.","rep_conversation":"2-3 sentences. Which rep needs attention and specifically what they need to do this week — name the deal, name the action, name the stakes.","deal_recommendation":"2-3 sentences. The ONE deal to focus on today. Name it, state the specific risk, and tell them exactly what question to ask."}`;
  } else if (briefType === 'pulse') {
    requestedKeys = `Return JSON with exactly these keys:
{"pulse_summary":"1-2 sentences: what changed since Monday AND whether the forecast still shows we hit target. Reference coverage ratio if available.","key_action":"1 sentence: the single most important thing to do today — specific deal or rep, specific action, specific reason why it matters to hitting the number."}`;
  } else if (briefType === 'friday_recap') {
    requestedKeys = `Return JSON with exactly these keys:
{"week_summary":"1-2 sentences on how the week went. Wins, misses, net result, and whether attainment moved in the right direction.","next_week_focus":"1-2 sentences on the one concrete thing to prioritize when Monday arrives — name it specifically."}`;
  } else if (briefType === 'quarter_close') {
    requestedKeys = `Return JSON with exactly these keys:
{"quarter_situation":"2 sentences. Days remaining, gap to quota, and a frank assessment: will we hit it based on what's in the pipe?","close_plan":"2 sentences. Name the 2-3 specific deals that will determine the quarter outcome and what needs to happen with each one this week."}`;
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
      return JSON.parse(cleaned) as AiBlurbs;
    } catch {
      console.error('[brief-narratives] Failed to parse LLM JSON:', cleaned.slice(0, 300));
      return {} as AiBlurbs;
    }
  } catch (err) {
    console.error('[brief-narratives] LLM call failed:', err);
    return {} as AiBlurbs;
  }
}
