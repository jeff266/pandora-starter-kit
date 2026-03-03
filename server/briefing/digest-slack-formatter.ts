/**
 * Slack Formatter for Investigation Weekly Digest
 *
 * Generates Slack Block Kit JSON for posting investigation summaries
 */

import { DigestData, InvestigationSummary } from './investigation-digest.js';

function formatCurrency(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
  return `$${value.toFixed(0)}`;
}

function getTrendEmoji(trend: 'improving' | 'worsening' | 'stable'): string {
  switch (trend) {
    case 'improving':
      return ':chart_with_downwards_trend:';
    case 'worsening':
      return ':chart_with_upwards_trend:';
    default:
      return ':arrow_right:';
  }
}

function getSeverityEmoji(severity: string): string {
  switch (severity) {
    case 'critical':
      return ':red_circle:';
    case 'warning':
      return ':large_orange_circle:';
    default:
      return ':large_green_circle:';
  }
}

function buildInvestigationSections(investigations: InvestigationSummary[]): any[] {
  const blocks: any[] = [];

  for (const inv of investigations) {
    if (inv.runsCount === 0) {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*${inv.skillName}*\n:information_source: No investigations ran in the past 7 days`,
        },
      });
      continue;
    }

    const deltaPrefix = inv.deltaAtRisk > 0 ? '+' : '';
    const trendLabel = inv.trend.charAt(0).toUpperCase() + inv.trend.slice(1);

    // Skill header with trend
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*${inv.skillName}* ${getTrendEmoji(inv.trend)}\n*At-Risk:* ${inv.currentAtRisk} ${
          inv.deltaAtRisk !== 0 ? `(${deltaPrefix}${inv.deltaAtRisk} this week)` : ''
        }\n*Trend:* ${trendLabel} • ${inv.runsCount} run${inv.runsCount !== 1 ? 's' : ''}`,
      },
    });

    // Critical findings
    if (inv.criticalFindings.length > 0) {
      const findingsText = inv.criticalFindings
        .map((f) => `• *${f.dealName}* (${formatCurrency(f.amount)}) — ${f.message}`)
        .join('\n');

      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `_Top Critical Findings:_\n${findingsText}`,
        },
      });
    }

    blocks.push({ type: 'divider' });
  }

  // Remove last divider
  if (blocks.length > 0 && blocks[blocks.length - 1].type === 'divider') {
    blocks.pop();
  }

  return blocks;
}

export function formatDigestSlack(digest: DigestData): any[] {
  const appUrl = process.env.APP_URL || 'http://localhost:3000';
  const historyUrl = `${appUrl}/investigation/history`;

  const startDate = new Date(digest.periodStart).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
  const endDate = new Date(digest.periodEnd).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
  const periodLabel = `${startDate} — ${endDate}`;

  // Calculate summary stats
  const totalRuns = digest.investigations.reduce((sum, inv) => sum + inv.runsCount, 0);
  const totalAtRisk = digest.investigations.reduce((sum, inv) => sum + inv.currentAtRisk, 0);
  const worseningCount = digest.investigations.filter((inv) => inv.trend === 'worsening').length;

  const blocks: any[] = [];

  // Header
  blocks.push({
    type: 'header',
    text: {
      type: 'plain_text',
      text: '📊 Weekly Investigation Digest',
      emoji: true,
    },
  });

  blocks.push({
    type: 'context',
    elements: [
      {
        type: 'mrkdwn',
        text: `${digest.workspaceName} • ${periodLabel}`,
      },
    ],
  });

  blocks.push({ type: 'divider' });

  // Summary metrics as fields
  const summaryFields: any[] = [
    {
      type: 'mrkdwn',
      text: `*Total Investigations*\n${totalRuns}`,
    },
    {
      type: 'mrkdwn',
      text: `*At-Risk Deals*\n${totalAtRisk}`,
    },
    {
      type: 'mrkdwn',
      text: `*Worsening Trends*\n${worseningCount > 0 ? ':warning:' : ':white_check_mark:'} ${worseningCount}`,
    },
  ];

  blocks.push({
    type: 'section',
    fields: summaryFields,
  });

  blocks.push({ type: 'divider' });

  // Investigation sections
  blocks.push({
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: '*Investigations*',
    },
  });

  const investigationBlocks = buildInvestigationSections(digest.investigations);
  blocks.push(...investigationBlocks);

  // Top critical findings
  if (digest.topCriticalFindings.length > 0) {
    blocks.push({ type: 'divider' });

    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '*Top Critical Findings*',
      },
    });

    const findingsText = digest.topCriticalFindings
      .map((f) => `${getSeverityEmoji('critical')} *${f.dealName}* (${formatCurrency(f.amount)})\n   ${f.message}`)
      .join('\n\n');

    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: findingsText,
      },
    });
  }

  blocks.push({ type: 'divider' });

  // CTA Button
  blocks.push({
    type: 'actions',
    elements: [
      {
        type: 'button',
        text: {
          type: 'plain_text',
          text: 'View Full History →',
          emoji: true,
        },
        url: historyUrl,
        style: 'primary',
      },
    ],
  });

  // Footer
  blocks.push({
    type: 'context',
    elements: [
      {
        type: 'mrkdwn',
        text: '_Generated by Pandora_',
      },
    ],
  });

  return blocks;
}
