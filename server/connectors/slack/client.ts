import type { PipelineSnapshot } from '../../analysis/pipeline-snapshot.js';

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
): any[] {
  const dateStr = new Date(snapshot.generatedAt).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });

  const blocks: any[] = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: `Pipeline Snapshot | ${workspaceName} | ${dateStr}`,
      },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Total Pipeline:* ${formatFullCurrency(snapshot.totalPipeline)} (${snapshot.dealCount} deals)\n*Avg Deal Size:* ${formatFullCurrency(snapshot.avgDealSize)}`,
      },
    },
  ];

  if (snapshot.coverageRatio !== null) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Pipeline Coverage:* ${snapshot.coverageRatio}x`,
      },
    });
  }

  blocks.push({
    type: "section",
    fields: [
      {
        type: "mrkdwn",
        text: `*Win Rate:* ${formatPercent(snapshot.winRate.rate)} (${snapshot.winRate.won}W / ${snapshot.winRate.lost}L)`,
      },
      {
        type: "mrkdwn",
        text: `*New This Week:* ${snapshot.newDealsThisWeek.dealCount} deals (${formatCurrency(snapshot.newDealsThisWeek.totalAmount)})`,
      },
    ],
  });

  if (snapshot.byStage.length > 0) {
    const pipelineGroups = new Map<string, typeof snapshot.byStage>();
    for (const s of snapshot.byStage) {
      const key = s.pipeline || 'Unknown';
      if (!pipelineGroups.has(key)) pipelineGroups.set(key, []);
      pipelineGroups.get(key)!.push(s);
    }

    const singlePipeline = pipelineGroups.size === 1;

    blocks.push({ type: "divider" });

    for (const [pipelineName, stages] of pipelineGroups) {
      const stageLines = stages
        .map(s => `  *${s.stage}:* ${formatCurrency(s.total_amount)} (${s.deal_count} deals)`)
        .join('\n');

      if (singlePipeline) {
        blocks.push({
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*By Stage:*\n${stageLines}`,
          },
        });
      } else {
        blocks.push({
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*${pipelineName}:*\n${stageLines}`,
          },
        });
      }
    }
  }

  blocks.push(
    { type: "divider" },
    {
      type: "section",
      fields: [
        {
          type: "mrkdwn",
          text: `*Closing This Month:*\n${formatCurrency(snapshot.closingThisMonth.totalAmount)} (${snapshot.closingThisMonth.dealCount} deals)`,
        },
        {
          type: "mrkdwn",
          text: `*Stale Deals (${snapshot.staleDeals.staleDaysThreshold}+ days):*\n${snapshot.staleDeals.dealCount} deals worth ${formatCurrency(snapshot.staleDeals.totalAmount)}`,
        },
      ],
    }
  );

  return blocks;
}

export async function postToSlack(
  webhookUrl: string,
  payload: { blocks?: any[]; text?: string }
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
