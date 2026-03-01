import type { BriefType, EditorialFocus, AiBlurbs } from './brief-types.js';
import { callLLM } from '../utils/llm-router.js';
import { formatCompact } from './brief-utils.js';
import { buildWorkspaceContextBlock } from '../context/workspace-memory.js';

export async function generateBriefNarratives(
  workspaceId: string,
  briefType: BriefType,
  theNumber: any,
  whatChanged: any,
  reps: any[],
  deals: any[],
  editorialFocus: EditorialFocus
): Promise<AiBlurbs> {
  const contextBlock = await buildWorkspaceContextBlock(workspaceId).catch(() => '');

  const systemPrompt = `You are Pandora, a virtual VP of Revenue Operations writing a daily briefing for a CRO.

TONE RULES:
- Calm, specific, professional. Trusted advisor, not an alarm system.
- Use actual names, dollar amounts, and timeframes from the data.
- Never say "terrifying", "flying blind", "alarming", "vanity metrics", "CRITICAL", or "urgent action required".
- No homework. Don't assign tasks or deadlines unless directly asked.
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
{"overall_summary":"1-2 sentences setting up the week for the CRO. What they need to know in 10 seconds.","rep_conversation":"2-3 sentences. Which rep needs attention this week and why. Reference week count if a flag persisted.","deal_recommendation":"2-3 sentences. The ONE deal to ask about today. Name it, state the risk, suggest what to ask."}`;
  } else if (briefType === 'pulse') {
    requestedKeys = `Return JSON with exactly these keys:
{"pulse_summary":"1 sentence summarizing material changes since Monday. Be specific with numbers.","key_action":"1 sentence on the most important thing to act on today."}`;
  } else if (briefType === 'friday_recap') {
    requestedKeys = `Return JSON with exactly these keys:
{"week_summary":"1-2 sentences on how the week went. Wins, misses, net result.","next_week_focus":"1-2 sentences on the one thing to prioritize when Monday arrives."}`;
  } else if (briefType === 'quarter_close') {
    requestedKeys = `Return JSON with exactly these keys:
{"quarter_situation":"2 sentences. Days remaining, gap to quota, what it realistically looks like.","close_plan":"2 sentences. Name the specific deals that will determine the quarter outcome and why."}`;
  }

  const userPrompt = `Brief Type: ${briefType}
Editorial Focus: ${editorialFocus.primary} — ${editorialFocus.reason}

DATA:
${numberLine}
${pipelineDelta ? `Pipeline change: ${pipelineDelta}` : ''}${whatChanged.streak ? ` (${whatChanged.streak})` : ''}
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
