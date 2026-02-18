/**
 * Push API — Slack Formatter
 * Builds Slack Block Kit JSON for standard digest and single-deal alert templates.
 */

import type { AssembledFinding } from '../finding-assembler.js';

function severityIcon(severity: string): string {
  switch (severity) {
    case 'act': return '🔴';
    case 'watch': return '🟡';
    case 'notable': return '🔵';
    case 'info': return '⬜';
    default: return '⬜';
  }
}

function headerIcon(findings: AssembledFinding[]): string {
  if (findings.some(f => f.severity === 'act')) return '🔴';
  if (findings.some(f => f.severity === 'watch' || f.severity === 'notable')) return '🟡';
  return '🔵';
}

function formatAmount(amount: number | null): string {
  if (amount === null || amount === 0) return '';
  return ` · $${Math.round(amount).toLocaleString()}`;
}

export function formatStandardSlack(
  findings: AssembledFinding[],
  workspaceName: string,
  ruleName: string,
  skillIds: string[]
): object {
  const icon = headerIcon(findings);
  const date = new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

  const blocks: any[] = [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: `${icon} Pandora Alert — ${workspaceName} · ${date}`,
        emoji: true,
      },
    },
    { type: 'divider' },
  ];

  const shown = findings.slice(0, 20);

  for (const f of shown) {
    const dealInfo = [
      f.deal_name,
      f.deal_amount !== null ? `$${Math.round(f.deal_amount).toLocaleString()}` : null,
      f.deal_owner,
      f.ai_score !== null ? `Score: ${f.ai_score}` : null,
    ].filter(Boolean).join(' · ');

    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `${severityIcon(f.severity)} *${f.category.replace(/_/g, ' ')}*\n${f.message}${dealInfo ? `\n_${dealInfo}_` : ''}`,
      },
    });
    blocks.push({ type: 'divider' });
  }

  // Footer
  const skillList = skillIds.length > 0 ? skillIds.join(', ') : 'all skills';
  blocks.push({
    type: 'context',
    elements: [
      {
        type: 'mrkdwn',
        text: `From: ${skillList} · ${findings.length} finding${findings.length !== 1 ? 's' : ''} · ${new Date().toISOString()}`,
      },
    ],
  });

  return { blocks };
}

export function formatAlertSlack(
  finding: AssembledFinding,
  workspaceName: string
): object {
  const blocks: any[] = [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: `⚠️ Deal Risk Alert — ${finding.deal_name || 'Unknown Deal'}`,
        emoji: true,
      },
    },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*Amount*\n${finding.deal_amount !== null ? '$' + Math.round(finding.deal_amount).toLocaleString() : 'N/A'}` },
        { type: 'mrkdwn', text: `*Owner*\n${finding.deal_owner || 'N/A'}` },
        { type: 'mrkdwn', text: `*AI Score*\n${finding.ai_score !== null ? finding.ai_score + '/100' : 'N/A'}` },
        { type: 'mrkdwn', text: `*Category*\n${finding.category.replace(/_/g, ' ')}` },
      ],
    },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: finding.message },
    },
    {
      type: 'context',
      elements: [
        { type: 'mrkdwn', text: `Workspace: ${workspaceName} · ${new Date().toISOString()}` },
      ],
    },
  ];

  return { blocks };
}

export function formatSlackPayload(
  findings: AssembledFinding[],
  template: string,
  workspaceName: string,
  ruleName: string,
  skillIds: string[]
): object {
  if (template === 'alert' && findings.length > 0) {
    return formatAlertSlack(findings[0], workspaceName);
  }
  return formatStandardSlack(findings, workspaceName, ruleName, skillIds);
}
