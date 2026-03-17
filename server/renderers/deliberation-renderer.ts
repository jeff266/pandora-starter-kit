/**
 * deliberation-renderer.ts
 * Pure formatting functions for deliberation_runs rows.
 * No async, no DB calls — takes a raw DB row, returns structured UI/Slack output.
 *
 * Handles the current DB schema:
 *   perspectives = [{ agent: 'plan'|'red_team', label, output }]
 *   verdict      = { planSufficiency, missingAction, watchMetric, raw }
 *
 * Also handles the future prosecutor/defense/verdict schema described in the spec,
 * with agent values 'prosecutor'|'defense'|'verdict' and argument/data_points fields.
 */

const AGENT_CONFIG: Record<string, { label: string; emoji: string; color: string }> = {
  plan:       { label: 'Advocate',  emoji: '✅', color: '#38A169' },
  red_team:   { label: 'Skeptic',   emoji: '⚠️', color: '#E53E3E' },
  prosecutor: { label: 'Skeptic',   emoji: '⚠️', color: '#E53E3E' },
  defense:    { label: 'Advocate',  emoji: '✅', color: '#38A169' },
  verdict:    { label: 'Synthesis', emoji: '⚖️', color: '#3182CE' },
};

export interface DeliberationPerspective {
  role: string;
  label: string;
  emoji: string;
  color: string;
  argument: string;
  data_points: string[];
}

export interface DeliberationVerdict {
  planSufficiency: string;
  missingAction: string | null;
  watchMetric: string;
  conclusion: string;
}

export interface DeliberationUIOutput {
  deliberation_run_id: string;
  hypothesis_id: string | null;
  pattern: string;
  perspectives: DeliberationPerspective[];
  verdict: DeliberationVerdict | null;
  created_at: string;
  token_cost: number;
}

export function formatDeliberationForUI(run: any): DeliberationUIOutput {
  const rawPerspectives: any[] = run.perspectives || [];

  const perspectives: DeliberationPerspective[] = rawPerspectives
    .filter((p: any) => p.agent !== 'verdict')
    .map((p: any) => {
      const cfg = AGENT_CONFIG[p.agent] ?? { label: p.agent, emoji: '•', color: '#718096' };
      return {
        role: p.agent,
        label: cfg.label,
        emoji: cfg.emoji,
        color: cfg.color,
        argument: p.argument ?? p.output ?? '',
        data_points: p.data_points ?? [],
      };
    });

  let verdict: DeliberationVerdict | null = null;
  const raw = run.verdict;
  if (raw) {
    verdict = {
      planSufficiency: raw.planSufficiency ?? raw.sufficiency ?? 'borderline',
      missingAction: raw.missingAction ?? raw.missing_action ?? null,
      watchMetric: raw.watchMetric ?? raw.watch_metric ?? raw.key_variable ?? '',
      conclusion: raw.conclusion ?? raw.raw ?? '',
    };
  }

  return {
    deliberation_run_id: run.id,
    hypothesis_id: run.hypothesis_id ?? null,
    pattern: run.pattern ?? 'red_team',
    perspectives,
    verdict,
    created_at: run.created_at,
    token_cost: run.token_cost || 0,
  };
}

export function formatDeliberationForSlack(run: any): any[] {
  const formatted = formatDeliberationForUI(run);
  const blocks: any[] = [];

  blocks.push({
    type: 'header',
    text: { type: 'plain_text', text: '⚖️ Hypothesis Challenge Complete', emoji: true },
  });

  blocks.push({
    type: 'context',
    elements: [{
      type: 'mrkdwn',
      text: `Pattern: \`${formatted.pattern}\`  •  ${formatted.token_cost} tokens`,
    }],
  });

  blocks.push({ type: 'divider' });

  for (const p of formatted.perspectives) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `${p.emoji} *${p.label}*\n${p.argument}`,
      },
    });

    if (p.data_points.length > 0) {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: p.data_points.map((dp: string) => `• ${dp}`).join('\n'),
        },
      });
    }

    blocks.push({ type: 'divider' });
  }

  if (formatted.verdict) {
    const v = formatted.verdict;
    const sufficiencyEmoji =
      v.planSufficiency === 'sufficient' ? '✅' :
      v.planSufficiency === 'insufficient' ? '🔴' : '🟡';

    let verdictText = `⚖️ *Synthesis*\n${sufficiencyEmoji} *${v.planSufficiency.charAt(0).toUpperCase() + v.planSufficiency.slice(1)}*`;
    if (v.conclusion) verdictText += `\n${v.conclusion}`;
    if (v.missingAction) verdictText += `\n*Missing:* ${v.missingAction}`;
    if (v.watchMetric) verdictText += `\n*Watch:* ${v.watchMetric}`;

    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: verdictText },
    });
  }

  return blocks;
}
