import Anthropic from '@anthropic-ai/sdk';
import { query } from '../db.js';
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

  const prompt = `You are Pandora, a RevOps intelligence system delivering an investigation summary.

QUESTION: "${plan.question}"

GOAL CONTEXT:
${goalBlock}

INVESTIGATION CHAIN (${allFindings.length} step${allFindings.length !== 1 ? 's' : ''} executed):
${investigationChainBlock || 'No steps executed.'}

RECURRING FINDINGS (previously flagged, not yet resolved):
${persistenceBlock}

SYNTHESIS RULES:
1. Start with THE NUMBER — answer the question directly against the goal. "You're tracking to $X against $Y target."
2. Explain the trajectory — is it improving or declining? Reference the run rate if available.
3. Walk through the investigation chain — each step revealed something. Connect them causally.
4. For recurring findings, note how long they've persisted: "This is the Nth time I've flagged X."
5. End with 3-5 specific actions with named people, dollar amounts, and deadlines where possible.
6. Every number should be relative to a goal. Don't say "pipeline is $2.4M" — say "pipeline is $2.4M against $4.2M needed."

VOICE: Direct, specific, actionable. A CRO reading this at 7:42am should know exactly what to worry about and what to do first.

Word budget: 300-500 words.`;

  let fullText = '';
  let tokens = 0;

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
      if (event.type === 'message_delta' && event.usage) {
        tokens += event.usage.output_tokens || 0;
      }
    }
  } catch (err) {
    console.error('[Synthesizer] Streaming failed:', err);
    fullText = allFindings.map((f) => f.summary).join('\n\n') || 'Investigation complete. No synthesis available.';
  }

  return { text: fullText, tokens };
}
