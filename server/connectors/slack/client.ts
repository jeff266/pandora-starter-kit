import type { PipelineSnapshot } from '../../analysis/pipeline-snapshot.js';
import pool from '../../db.js';

export interface SlackBlock {
  type: string;
  text?: { type: string; text: string };
  fields?: { type: string; text: string }[];
  elements?: { type: string; text: string }[];
}

function formatCurrency(value: number): string {
  if (value >= 1_000_000) {
    return `$${(value / 1_000_000).toFixed(1)}M`;
  }
  if (value >= 1_000) {
    return `$${(value / 1_000).toFixed(0)}K`;
  }
  return `$${value.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
}

function formatFullCurrency(value: number): string {
  return `$${value.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
}

function formatPercent(value: number | null): string {
  if (value === null) return 'N/A';
  return `${value}%`;
}

export function formatHeader(text: string): SlackBlock {
  return {
    type: 'header',
    text: { type: 'plain_text', text },
  };
}

export function formatSection(text: string): SlackBlock {
  return {
    type: 'section',
    text: { type: 'mrkdwn', text },
  };
}

export function formatDivider(): SlackBlock {
  return { type: 'divider' };
}

export function formatFields(fields: { label: string; value: string }[]): SlackBlock {
  return {
    type: 'section',
    fields: fields.map(f => ({
      type: 'mrkdwn',
      text: `*${f.label}:* ${f.value}`,
    })),
  };
}

export function formatContext(text: string): SlackBlock {
  return {
    type: 'context',
    elements: [{ type: 'mrkdwn', text }],
  };
}

export function buildMessage(options: {
  header?: string;
  sections: string[];
  fields?: { label: string; value: string }[];
  footer?: string;
}): SlackBlock[] {
  const blocks: SlackBlock[] = [];

  if (options.header) {
    blocks.push(formatHeader(options.header));
  }

  for (const section of options.sections) {
    blocks.push(formatSection(section));
  }

  if (options.fields && options.fields.length > 0) {
    blocks.push(formatDivider());
    blocks.push(formatFields(options.fields));
  }

  if (options.footer) {
    blocks.push(formatDivider());
    blocks.push(formatContext(options.footer));
  }

  return blocks;
}

export function formatPipelineOneLiner(
  snapshot: PipelineSnapshot,
): string {
  const parts: string[] = [
    `Pipeline: ${formatCurrency(snapshot.totalPipeline)}`,
  ];

  if (snapshot.coverageRatio !== null) {
    parts[0] += ` (${snapshot.coverageRatio}x coverage)`;
  }

  parts.push(`Win Rate: ${formatPercent(snapshot.winRate.rate)}`);
  parts.push(`${snapshot.newDealsThisWeek.dealCount} new deals this week`);
  parts.push(`Avg deal: ${formatCurrency(snapshot.avgDealSize)}`);

  return parts.join(' | ');
}

export function formatPipelineSnapshot(
  snapshot: PipelineSnapshot,
  workspaceName: string
): SlackBlock[] {
  const dateStr = new Date(snapshot.generatedAt).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });

  const blocks: SlackBlock[] = [
    formatHeader(`Pipeline Snapshot | ${workspaceName} | ${dateStr}`),
    formatSection(
      `*Total Pipeline:* ${formatFullCurrency(snapshot.totalPipeline)} (${snapshot.dealCount} deals)\n*Avg Deal Size:* ${formatFullCurrency(snapshot.avgDealSize)}`
    ),
  ];

  if (snapshot.coverageRatio !== null) {
    blocks.push(formatSection(`*Pipeline Coverage:* ${snapshot.coverageRatio}x`));
  }

  blocks.push(
    formatFields([
      {
        label: 'Win Rate',
        value: `${formatPercent(snapshot.winRate.rate)} (${snapshot.winRate.won}W / ${snapshot.winRate.lost}L)`,
      },
      {
        label: 'New This Week',
        value: `${snapshot.newDealsThisWeek.dealCount} deals (${formatCurrency(snapshot.newDealsThisWeek.totalAmount)})`,
      },
    ])
  );

  if (snapshot.byStage.length > 0) {
    const pipelineGroups = new Map<string, typeof snapshot.byStage>();
    for (const s of snapshot.byStage) {
      const key = s.pipeline || 'Unknown';
      if (!pipelineGroups.has(key)) pipelineGroups.set(key, []);
      pipelineGroups.get(key)!.push(s);
    }

    const singlePipeline = pipelineGroups.size === 1;

    blocks.push(formatDivider());

    for (const [pipelineName, stages] of pipelineGroups) {
      const stageLines = stages
        .map(s => `  *${s.stage}:* ${formatCurrency(s.total_amount)} (${s.deal_count} deals)`)
        .join('\n');

      if (singlePipeline) {
        blocks.push(formatSection(`*By Stage:*\n${stageLines}`));
      } else {
        blocks.push(formatSection(`*${pipelineName}:*\n${stageLines}`));
      }
    }
  }

  blocks.push(formatDivider());
  blocks.push(
    formatFields([
      {
        label: 'Closing This Month',
        value: `${formatCurrency(snapshot.closingThisMonth.totalAmount)} (${snapshot.closingThisMonth.dealCount} deals)`,
      },
      {
        label: `Stale Deals (${snapshot.staleDeals.staleDaysThreshold}+ days)`,
        value: `${snapshot.staleDeals.dealCount} deals worth ${formatCurrency(snapshot.staleDeals.totalAmount)}`,
      },
    ])
  );

  return blocks;
}

export async function postBlocks(
  webhookUrl: string,
  blocks: SlackBlock[]
): Promise<{ ok: boolean; error?: string }> {
  return postToSlack(webhookUrl, { blocks });
}

export async function postText(
  webhookUrl: string,
  text: string
): Promise<{ ok: boolean; error?: string }> {
  return postToSlack(webhookUrl, { text });
}

export async function postToSlack(
  webhookUrl: string,
  payload: { blocks?: SlackBlock[]; text?: string }
): Promise<{ ok: boolean; error?: string }> {
  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return { ok: false, error: `Slack webhook error: ${response.status} - ${errorText}` };
    }

    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return { ok: false, error: message };
  }
}

export async function getSlackWebhook(workspaceId: string): Promise<string | null> {
  const result = await pool.query(
    `SELECT settings->>'slack_webhook_url' AS webhook_url FROM workspaces WHERE id = $1`,
    [workspaceId]
  );
  if (result.rows.length > 0) {
    const url = result.rows[0].webhook_url;
    if (typeof url === 'string' && url.startsWith('https://hooks.slack.com/') && url.length > 60) {
      return url;
    }
  }

  const envWebhook = process.env.SLACK_WEBHOOK;
  if (envWebhook && envWebhook.startsWith('https://hooks.slack.com/')) {
    if (result.rows.length > 0) {
      await pool.query(
        `UPDATE workspaces SET settings = jsonb_set(COALESCE(settings, '{}'::jsonb), '{slack_webhook_url}', to_jsonb($2::text)) WHERE id = $1`,
        [workspaceId, envWebhook]
      );
      console.log(`[slack] Saved SLACK_WEBHOOK env secret to workspace ${workspaceId} settings`);
    }
    return envWebhook;
  }

  return null;
}

export async function testSlackWebhook(
  webhookUrl: string
): Promise<{ ok: boolean; error?: string }> {
  const blocks = buildMessage({
    header: 'Pandora Connection Test',
    sections: ['Your Slack webhook is connected and working.'],
    footer: `Tested at ${new Date().toISOString()}`,
  });
  return postBlocks(webhookUrl, blocks);
}
