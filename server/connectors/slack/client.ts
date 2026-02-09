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

function formatStageName(stage: string): string {
  return stage
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
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

  if (snapshot.byStage.length > 0) {
    const stageLines = snapshot.byStage
      .map(s => `  *${formatStageName(s.stage)}:* ${formatCurrency(s.total_amount)} (${s.deal_count} deals)`)
      .join('\n');

    blocks.push(
      { type: "divider" },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*By Stage:*\n${stageLines}`,
        },
      }
    );
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

export async function postToSlack(webhookUrl: string, blocks: any[]): Promise<{ ok: boolean; error?: string }> {
  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ blocks }),
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
