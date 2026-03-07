import type { AssembledBrief } from '../briefing/brief-types.js';
import type { SlackBlock } from './types.js';

function formatAmount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`;
  return String(Math.round(n));
}

function formatDate(ts: string | Date): string {
  const d = new Date(ts);
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
}

function formatTime(ts: string | Date): string {
  const d = new Date(ts);
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
}

export function renderBriefToBlockKit(
  brief: AssembledBrief,
  options: { compact?: boolean; includeFullFindingsButton?: boolean } = {}
): SlackBlock[] {
  const blocks: SlackBlock[] = [];
  const appUrl = process.env.APP_URL || 'https://pandora.replit.app';

  blocks.push({
    type: 'header',
    text: {
      type: 'plain_text',
      text: `VP RevOps Brief · ${formatDate(brief.generated_at || new Date())}`,
    },
  });

  const narrative =
    (brief.ai_blurbs as any)?.pulse_summary ||
    (brief.ai_blurbs as any)?.week_summary ||
    (brief.ai_blurbs as any)?.narrative;

  if (narrative) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: narrative },
    });
  }

  const theNumber = brief.the_number as any;
  if (theNumber) {
    const parts: string[] = [];
    if (theNumber.attainment_pct != null) parts.push(`*${Math.round(theNumber.attainment_pct)}% attainment*`);
    if (theNumber.coverage_ratio != null) parts.push(`${Number(theNumber.coverage_ratio).toFixed(1)}x coverage`);
    if (theNumber.gap != null) parts.push(`$${formatAmount(theNumber.gap)} gap`);
    if (theNumber.days_remaining != null) parts.push(`${theNumber.days_remaining}d remaining`);

    if (parts.length > 0) {
      blocks.push({
        type: 'context',
        elements: [{ type: 'mrkdwn', text: parts.join('  ·  ') }],
      });
    }
  }

  if (!options.compact && (brief.comparison_data as any)) {
    const comp = brief.comparison_data as any;
    const lines: string[] = [];
    (comp.resolved || []).slice(0, 2).forEach((r: any) => lines.push(`✓  ${r.summary || r}`));
    (comp.persisted || []).slice(0, 2).forEach((p: any) => {
      const suffix = p.occurrenceCount >= 3 ? ` · ${p.occurrenceCount} weeks` : '';
      lines.push(`→  ${p.summary || p}${suffix}`);
    });
    (comp.new || comp.added || []).slice(0, 2).forEach((n: any) => lines.push(`⚡  ${n.summary || n}`));

    if (lines.length > 0) {
      blocks.push({ type: 'divider' });
      blocks.push({
        type: 'section',
        text: { type: 'mrkdwn', text: `*Since last week*\n${lines.join('\n')}` },
      });
    }
  }

  const focus =
    (brief.ai_blurbs as any)?.key_action ||
    (brief.ai_blurbs as any)?.next_week_focus ||
    (brief.editorial_focus as any)?.key_action;

  if (focus && !options.compact) {
    blocks.push({ type: 'divider' });
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `*Focus this week*\n${focus}` },
    });
  }

  if (!options.compact) {
    const deals = brief.deals_to_watch as any;
    const items: any[] = deals?.items || deals?.critical || [];
    const topFindings = items.slice(0, 3);

    if (topFindings.length > 0) {
      blocks.push({ type: 'divider' });
      topFindings.forEach((finding: any) => {
        const severity = finding.severity || 'info';
        const icon = severity === 'critical' ? '🔴' : severity === 'warning' ? '🟡' : '🔵';
        const msg = finding.signal_text || finding.message || finding.name || String(finding);
        blocks.push({
          type: 'section',
          text: { type: 'mrkdwn', text: `${icon} ${msg}` },
        });
      });
    }
  }

  if ((brief as any).is_potentially_stale) {
    blocks.push({
      type: 'context',
      elements: [
        { type: 'mrkdwn', text: '⚠️ A sync ran after this brief was assembled. Some numbers may have changed.' },
      ],
    });
  }

  blocks.push({
    type: 'context',
    elements: [
      { type: 'mrkdwn', text: `As of ${formatTime(brief.generated_at || new Date())}  ·  Reply to ask a follow-up question` },
    ],
  });

  const actionElements: SlackBlock[] = [
    {
      type: 'button',
      text: { type: 'plain_text', text: 'Open in Pandora' },
      url: `${appUrl}/command-center`,
      action_id: 'open_in_pandora',
    },
    {
      type: 'button',
      text: { type: 'plain_text', text: 'Ask a question' },
      action_id: 'open_ask_modal',
      value: JSON.stringify({ workspaceId: brief.workspace_id }),
    },
  ];

  if (options.includeFullFindingsButton) {
    actionElements.push({
      type: 'button',
      text: { type: 'plain_text', text: 'All findings →' },
      action_id: 'view_all_findings',
      value: brief.workspace_id,
    });
  }

  blocks.push({ type: 'actions', elements: actionElements });

  return blocks;
}
