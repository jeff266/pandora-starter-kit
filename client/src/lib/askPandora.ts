import type { NavigateFunction } from 'react-router-dom';

export type PandoraContextSource =
  | 'report_block'
  | 'finding_card'
  | 'metric_tile'
  | 'deal_finding'
  | 'deal_metric'
  | 'account_health'
  | 'forecast_line'
  | 'rep_scorecard_tile'
  | 'slack_deeplink';

export interface EvidenceRow {
  label: string;
  value: string | number;
  meta?: string;
}

export interface PandoraContext {
  source: PandoraContextSource;
  label: string;
  value: string;

  section?: string;
  dealId?: string;
  dealName?: string;
  accountId?: string;
  accountName?: string;
  repId?: string;
  repName?: string;
  skillId?: string;
  skillRunId?: string;

  evidenceRows?: EvidenceRow[];
  evidenceSummary?: string;

  anomaly?: string;
  benchmark?: string;
  priorValue?: string;
}

export function buildContextMessage(ctx: PandoraContext): string {
  const parts: string[] = [];

  if (ctx.section) parts.push(`Section: ${ctx.section}`);
  if (ctx.dealName) parts.push(`Deal: ${ctx.dealName}`);
  if (ctx.accountName) parts.push(`Account: ${ctx.accountName}`);
  if (ctx.repName) parts.push(`Rep: ${ctx.repName}`);

  parts.push(`Data point: ${ctx.label} = ${ctx.value}`);

  if (ctx.priorValue) parts.push(`Prior value: ${ctx.priorValue}`);
  if (ctx.anomaly) parts.push(`Notable: ${ctx.anomaly}`);
  if (ctx.benchmark) parts.push(`Benchmark: ${ctx.benchmark}`);

  if (ctx.evidenceRows && ctx.evidenceRows.length > 0) {
    const rows = ctx.evidenceRows
      .map(r => `  • ${r.label}: ${r.value}${r.meta ? ` (${r.meta})` : ''}`)
      .join('\n');
    parts.push(`Backing data:\n${rows}`);
  } else if (ctx.evidenceSummary) {
    parts.push(`Context: ${ctx.evidenceSummary}`);
  }

  parts.push(`Help me understand this figure or investigate further.`);

  return parts.join('\n');
}

export function openAskPandora(
  context: PandoraContext,
  navigate: NavigateFunction,
  targetPath = '.'
): void {
  const message = buildContextMessage(context);

  navigate(targetPath, {
    state: {
      openChatWithMessage: message,
      pandoraContext: context,
    },
  });
}
