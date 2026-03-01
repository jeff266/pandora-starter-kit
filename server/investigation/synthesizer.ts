import Anthropic from '@anthropic-ai/sdk';
import { query } from '../db.js';
import { trackTokenUsage } from '../lib/token-tracker.js';
import type { InvestigationPlan } from '../goals/types.js';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY || process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY,
});

function daysBetween(a: Date, b: Date): number {
  return Math.floor((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24));
}

export async function synthesizeInvestigation(
  plan: InvestigationPlan,
  allFindings: Array<{ step: number; skill_id: string; findings: string[]; summary: string }>,
  onChunk?: (text: string) => void,
  workspaceContext?: string,
): Promise<{ text: string; tokens: number }> {
  const goalBlock =
    plan.goal_context.length > 0
      ? plan.goal_context
          .map((g: any) => {
            const attainment = g.attainment_pct
              ? `${Number(g.attainment_pct).toFixed(1)}% attainment`
              : 'attainment unknown';
            const trajectory = g.trajectory || 'unknown';
            const daysLeft = g.days_remaining != null ? `${g.days_remaining} days remaining` : '';
            return `- ${g.label}: $${Number(g.current || 0).toLocaleString()} of $${Number(g.target || 0).toLocaleString()} (${attainment}, ${trajectory}${daysLeft ? `, ${daysLeft}` : ''})`;
          })
          .join('\n')
      : 'No structured goals configured.';

  const investigationChainBlock = allFindings
    .map((f) => {
      const step = plan.steps[f.step];
      if (!step) return '';
      const trigger =
        step.trigger === 'initial'
          ? 'Initial investigation'
          : `Follow-up from step ${(step.triggered_by?.step_index ?? 0) + 1}: ${step.triggered_by?.reasoning || ''}`;
      return `Step ${f.step + 1} — ${step.operator_name} (${step.skill_id})${step.used_cache ? ' [cached]' : ''}\nTrigger: ${trigger}\nFindings: ${f.summary}`;
    })
    .filter(Boolean)
    .join('\n\n');

  const persistentFindings = await query<{
    message: string;
    times_flagged: number;
    trend: string;
    first_flagged_at: string;
    escalation_level: number;
  }>(
    `SELECT message, times_flagged, trend, first_flagged_at, escalation_level
     FROM findings
     WHERE workspace_id = $1 AND times_flagged > 1 AND resolved_at IS NULL
     ORDER BY escalation_level DESC, times_flagged DESC LIMIT 8`,
    [plan.workspace_id],
  );

  const persistenceBlock =
    persistentFindings.rows.length > 0
      ? persistentFindings.rows
          .map((f) => {
            const days = daysBetween(new Date(f.first_flagged_at), new Date());
            return `- [${(f.trend || 'stable').toUpperCase()}, flagged ${f.times_flagged}x over ${days} days] ${f.message}`;
          })
          .join('\n')
      : 'No recurring unresolved findings.';

  const wordBudget = allFindings.length <= 1
    ? '50-150 words. Just answer the question.'
    : allFindings.length <= 2
      ? '100-250 words. Answer plus key context.'
      : '250-500 words. Answer, investigation summary, and 3-5 actions.';

  const prompt = `You are Pandora, a RevOps intelligence system.

QUESTION: "${plan.question}"
${workspaceContext ? `\nWORKSPACE CONTEXT:\n${workspaceContext}\n` : ''}
GOAL CONTEXT:
${goalBlock}

INVESTIGATION CHAIN (${allFindings.length} step${allFindings.length !== 1 ? 's' : ''} executed):
${investigationChainBlock || 'No steps executed.'}

RECURRING FINDINGS (previously flagged, not yet resolved):
${persistenceBlock}

VOICE AND TONE — MANDATORY:
- Lead with the answer to the question. Data before commentary.
- Be direct, specific, and calm. Never alarmist, never preachy.
- Report what the data shows. If data is missing, say what's missing in one sentence and move on.
- Add goal context when available. Never withhold a number because goal context is missing.
- Missing quotas means you can't show ratios — it does NOT mean you can't show the raw numbers. Always show the raw numbers.
- If something is genuinely urgent, state the fact calmly. No emotional language.
- Never lecture about data hygiene or system configuration unless the question was about that.
- Never assign deadlines or homework unless the user asked "what should we do."
- Treat the user as a competent professional who can draw their own conclusions.
- Short answers beat long ones. A table beats three paragraphs.

TITLE: Give this response a short title (2-4 words). Do NOT use the word "Investigation." Name the topic. Examples: "Pipeline Summary", "Forecast Update", "Deal Risk Summary".

RESPONSE LENGTH: ${wordBudget}`;

  let fullText = '';
  let inputTokens = 0;
  let outputTokens = 0;
  const startTime = Date.now();

  try {
    const stream = anthropic.messages.stream({
      model: 'claude-sonnet-4-5',
      max_tokens: 1500,
      temperature: 0.4,
      messages: [{ role: 'user', content: prompt }],
    });

    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        const chunk = event.delta.text;
        if (chunk) {
          fullText += chunk;
          onChunk?.(chunk);
        }
      }
      if (event.type === 'message_start' && event.message.usage) {
        inputTokens += event.message.usage.input_tokens || 0;
      }
      if (event.type === 'message_delta' && event.usage) {
        outputTokens += event.usage.output_tokens || 0;
      }
    }
  } catch (err) {
    console.error('[Synthesizer] Streaming failed:', err);
    fullText = allFindings.map((f) => f.summary).join('\n\n') || 'Investigation complete. No synthesis available.';
  }

  const latencyMs = Date.now() - startTime;
  const totalTokens = inputTokens + outputTokens;

  trackTokenUsage({
    workspaceId: plan.workspace_id,
    phase: 'chat',
    stepName: 'pandora-agent-synthesis',
    provider: 'anthropic',
    model: 'claude-sonnet-4-5',
    inputTokens,
    outputTokens,
    estimatedCostUsd: (inputTokens / 1_000_000) * 3.0 + (outputTokens / 1_000_000) * 15.0,
    promptChars: prompt.length,
    responseChars: fullText.length,
    truncated: false,
    payloadSummary: {
      totalChars: prompt.length,
      largestField: 'prompt',
      largestFieldChars: prompt.length,
      estimatedTokens: Math.round(prompt.length / 4),
      sections: [{ role: 'user', chars: prompt.length, hasSourceData: false, hasTranscript: false, hasRawJson: false }],
    },
    latencyMs,
  }).catch((err) => console.warn('[Synthesizer] Token tracking failed:', err?.message));

  return { text: fullText, tokens: totalTokens };
}
