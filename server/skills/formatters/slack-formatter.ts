/**
 * Slack Formatter for Skill Results
 *
 * Converts skill results into Slack Block Kit format.
 * Provides both generic formatting and skill-specific templates.
 */

import type { SkillResult, SkillDefinition, SkillEvidence, EvidenceClaim, EvaluatedRecord } from '../types.js';

interface SlackBlock {
  type: string;
  [key: string]: any;
}

/**
 * Generic Slack formatter with skill-specific routing.
 * When evidence is present, renders structured claim blocks with deal lists
 * and methodology footers. Falls back to narrative-based formatting otherwise.
 */
export function formatForSlack(result: SkillResult, skill: SkillDefinition): SlackBlock[] {
  if (result.evidence?.claims?.length) {
    return formatWithEvidence(result, skill);
  }

  if (skill.slackTemplate === 'pipeline-hygiene') {
    return formatPipelineHygiene(result, skill);
  } else if (skill.slackTemplate === 'weekly-recap') {
    return formatWeeklyRecap(result);
  } else if (skill.slackTemplate === 'deal-risk-review') {
    return formatDealRiskReview(result);
  } else if (skill.slackTemplate === 'single-thread-alert') {
    return formatSingleThreadAlert(result);
  } else if (skill.slackTemplate === 'data-quality-audit') {
    return formatDataQualityAudit(result);
  } else if (skill.slackTemplate === 'pipeline-coverage') {
    return formatPipelineCoverage(result);
  } else if (skill.slackTemplate === 'icp-discovery') {
    return formatICPDiscovery(result);
  }

  // Generic formatter fallback
  const blocks: SlackBlock[] = [];

  // Header
  blocks.push({
    type: 'header',
    text: {
      type: 'plain_text',
      text: `${getStatusEmoji(result.status)} ${skill.name}`,
      emoji: true,
    },
  });

  // Timestamp
  blocks.push({
    type: 'context',
    elements: [
      {
        type: 'mrkdwn',
        text: `Completed: <!date^${Math.floor(result.completedAt.getTime() / 1000)}^{date_short_pretty} at {time}|${result.completedAt.toISOString()}>`,
      },
    ],
  });

  blocks.push({ type: 'divider' });

  // Output content
  if (typeof result.output === 'string') {
    // Text output - split into sections if it has headers
    const sections = parseTextIntoSections(markdownToSlack(result.output));
    for (const section of sections) {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: section,
        },
      });
    }
  } else if (result.output && typeof result.output === 'object') {
    // Structured output - format as code block
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `\`\`\`${JSON.stringify(result.output, null, 2)}\`\`\``,
      },
    });
  }

  blocks.push({ type: 'divider' });

  // Footer with metadata
  blocks.push({
    type: 'context',
    elements: [
      {
        type: 'mrkdwn',
        text: `Duration: ${formatDuration(result.totalDuration_ms)} | Tokens: Claude ${result.totalTokenUsage.claude}, DeepSeek ${result.totalTokenUsage.deepseek} | Run ID: \`${result.runId}\``,
      },
    ],
  });

  return blocks;
}

/**
 * Pipeline Hygiene specific formatter with rich visual elements
 */
export function formatPipelineHygiene(result: SkillResult, skill?: SkillDefinition): SlackBlock[] {
  const blocks: SlackBlock[] = [];

  // Header
  blocks.push({
    type: 'header',
    text: {
      type: 'plain_text',
      text: '🔍 Pipeline Hygiene Check',
      emoji: true,
    },
  });

  // Timestamp and status
  blocks.push({
    type: 'context',
    elements: [
      {
        type: 'mrkdwn',
        text: `${getStatusEmoji(result.status)} Completed <!date^${Math.floor(result.completedAt.getTime() / 1000)}^{date_short_pretty} at {time}|${result.completedAt.toISOString()}>`,
      },
    ],
  });

  blocks.push({ type: 'divider' });

  // Parse output into sections and convert Markdown to Slack format
  const output = typeof result.output === 'string' ? result.output : JSON.stringify(result.output);
  const rawSections = parsePipelineHygieneReport(output);
  const reportSections: PipelineHygieneSections = {};
  for (const [key, value] of Object.entries(rawSections)) {
    (reportSections as any)[key] = value ? markdownToSlack(value) : value;
  }

  // 1. PIPELINE HEALTH - Compact metrics with trend indicators
  if (reportSections.pipelineHealth) {
    appendSectionBlocks(blocks, '📊 Pipeline Health', reportSections.pipelineHealth, 2800);
  }

  // 2. STALE DEAL CRISIS - Highlighted if severe
  if (reportSections.staleDeals) {
    const isCritical = reportSections.staleDeals.toLowerCase().includes('critical');
    const emoji = isCritical ? '🚨' : '⚠️';
    appendSectionBlocks(blocks, `${emoji} Stale Deals`, reportSections.staleDeals, 2800);
  }

  // 3. CLOSING SOON - Important for near-term focus
  if (reportSections.closingSoon) {
    appendSectionBlocks(blocks, '📅 Closing This Period', reportSections.closingSoon, 2800);
  }

  // 4. REP PERFORMANCE - Collapsed to avoid wall of text
  if (reportSections.repPerformance) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*👥 Rep Performance*\n${truncateSection(reportSections.repPerformance, 800)}`,
      },
    });
  }

  blocks.push({ type: 'divider' });

  // 5. TOP 3 ACTIONS - Most prominent, actionable
  if (reportSections.topActions) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '*🎯 Top 3 Actions*',
      },
    });

    const actions = parseTopActions(reportSections.topActions);
    for (const action of actions) {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: action,
        },
      });
    }
  }

  // Any other sections (summary, intro, etc.)
  if (reportSections.other && reportSections.other.trim()) {
    blocks.push({ type: 'divider' });
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: reportSections.other,
      },
    });
  }

  // Footer
  blocks.push({ type: 'divider' });
  blocks.push({
    type: 'context',
    elements: [
      {
        type: 'mrkdwn',
        text: `⏱ ${formatDuration(result.totalDuration_ms)} | 💰 ${formatTokenCount(result.totalTokenUsage.claude)} Claude + ${formatTokenCount(result.totalTokenUsage.deepseek)} DeepSeek | Run \`${result.runId.slice(0, 8)}\``,
      },
    ],
  });

  if (blocks.length > 48) {
    const trimmed = blocks.slice(0, 47);
    trimmed.push({
      type: 'context',
      elements: [{ type: 'mrkdwn', text: '_Message truncated — view full report in Pandora_' }],
    });
    return trimmed;
  }

  return blocks;
}

/**
 * Deal Risk Review specific formatter
 */
export function formatDealRiskReview(result: SkillResult): SlackBlock[] {
  const blocks: SlackBlock[] = [];

  blocks.push({
    type: 'header',
    text: {
      type: 'plain_text',
      text: '🎯 Deal Risk Review',
      emoji: true,
    },
  });

  blocks.push({
    type: 'context',
    elements: [
      {
        type: 'mrkdwn',
        text: `<!date^${Math.floor(result.completedAt.getTime() / 1000)}^{date_short_pretty} at {time}|${result.completedAt.toISOString()}>`,
      },
    ],
  });

  blocks.push({ type: 'divider' });

  const rawOutput = typeof result.output === 'string' ? result.output : JSON.stringify(result.output);
  const sections = parseSectionsFromMarkdown(rawOutput);

  for (const section of sections) {
    const content = markdownToSlack(section.content);
    if (section.title) {
      appendSectionBlocks(blocks, `*${section.title}*`, content, 2800);
    } else if (content.trim()) {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: truncateSection(content, 2800),
        },
      });
    }
  }

  blocks.push({ type: 'divider' });
  blocks.push({
    type: 'context',
    elements: [
      {
        type: 'mrkdwn',
        text: `⏱ ${formatDuration(result.totalDuration_ms)}`,
      },
    ],
  });

  return blocks;
}

/**
 * Single-Thread Alert specific formatter
 */
export function formatSingleThreadAlert(result: SkillResult): SlackBlock[] {
  const blocks: SlackBlock[] = [];

  blocks.push({
    type: 'header',
    text: {
      type: 'plain_text',
      text: '🔗 Single-Thread Risk Alert',
      emoji: true,
    },
  });

  blocks.push({
    type: 'context',
    elements: [
      {
        type: 'mrkdwn',
        text: `<!date^${Math.floor(result.completedAt.getTime() / 1000)}^{date_short_pretty} at {time}|${result.completedAt.toISOString()}>`,
      },
    ],
  });

  blocks.push({ type: 'divider' });

  const rawOutput = typeof result.output === 'string' ? result.output : JSON.stringify(result.output);
  const sections = parseSectionsFromMarkdown(rawOutput);

  for (const section of sections) {
    const content = markdownToSlack(section.content);
    if (section.title) {
      let emoji = '📊';
      const lower = section.title.toLowerCase();
      if (lower.includes('team')) emoji = '👥';
      if (lower.includes('rep')) emoji = '🎯';
      if (lower.includes('critical')) emoji = '🚨';
      if (lower.includes('action')) emoji = '⚡';
      if (lower.includes('situation') || lower.includes('overview')) emoji = '🔴';

      appendSectionBlocks(blocks, `${emoji} ${section.title}`, content, 2800);
    } else if (content.trim()) {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: truncateSection(content, 2800),
        },
      });
    }
  }

  blocks.push({ type: 'divider' });
  blocks.push({
    type: 'context',
    elements: [
      {
        type: 'mrkdwn',
        text: `⏱ ${formatDuration(result.totalDuration_ms)} | 💰 ${formatTokenCount(result.totalTokenUsage.claude)}k Claude`,
      },
    ],
  });

  if (blocks.length > 48) {
    const trimmed = blocks.slice(0, 47);
    trimmed.push({
      type: 'context',
      elements: [{ type: 'mrkdwn', text: '_Message truncated — view full report in Pandora_' }],
    });
    return trimmed;
  }

  return blocks;
}

/**
 * Data Quality Audit specific formatter
 */
export function formatDataQualityAudit(result: SkillResult): SlackBlock[] {
  const blocks: SlackBlock[] = [];

  blocks.push({
    type: 'header',
    text: {
      type: 'plain_text',
      text: '📊 Data Quality Audit',
      emoji: true,
    },
  });

  blocks.push({
    type: 'context',
    elements: [
      {
        type: 'mrkdwn',
        text: `<!date^${Math.floor(result.completedAt.getTime() / 1000)}^{date_short_pretty} at {time}|${result.completedAt.toISOString()}>`,
      },
    ],
  });

  blocks.push({ type: 'divider' });

  const rawOutput = typeof result.output === 'string' ? result.output : JSON.stringify(result.output);
  const sections = parseSectionsFromMarkdown(rawOutput);

  for (const section of sections) {
    const content = markdownToSlack(section.content);
    if (section.title) {
      let emoji = '📊';
      const lower = section.title.toLowerCase();
      if (lower.includes('health') || lower.includes('grade')) emoji = '🏥';
      if (lower.includes('risk')) emoji = '⚠️';
      if (lower.includes('rep') || lower.includes('pattern')) emoji = '👤';
      if (lower.includes('trend')) emoji = '📈';
      if (lower.includes('action')) emoji = '⚡';

      appendSectionBlocks(blocks, `${emoji} ${section.title}`, content, 2800);
    } else if (content.trim()) {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: truncateSection(content, 2800),
        },
      });
    }
  }

  blocks.push({ type: 'divider' });
  blocks.push({
    type: 'context',
    elements: [
      {
        type: 'mrkdwn',
        text: `⏱ ${formatDuration(result.totalDuration_ms)} | 💰 ${formatTokenCount(result.totalTokenUsage.claude)}k Claude`,
      },
    ],
  });

  if (blocks.length > 48) {
    const trimmed = blocks.slice(0, 47);
    trimmed.push({
      type: 'context',
      elements: [{ type: 'mrkdwn', text: '_Message truncated — view full report in Pandora_' }],
    });
    return trimmed;
  }

  return blocks;
}

/**
 * Pipeline Coverage specific formatter
 */
export function formatPipelineCoverage(result: SkillResult): SlackBlock[] {
  const blocks: SlackBlock[] = [];

  blocks.push({
    type: 'header',
    text: {
      type: 'plain_text',
      text: '🎯 Pipeline Coverage by Rep',
      emoji: true,
    },
  });

  blocks.push({
    type: 'context',
    elements: [
      {
        type: 'mrkdwn',
        text: `<!date^${Math.floor(result.completedAt.getTime() / 1000)}^{date_short_pretty} at {time}|${result.completedAt.toISOString()}>`,
      },
    ],
  });

  blocks.push({ type: 'divider' });

  const rawOutput = typeof result.output === 'string' ? result.output : JSON.stringify(result.output);
  const sections = parseSectionsFromMarkdown(rawOutput);

  for (const section of sections) {
    const content = markdownToSlack(section.content);
    if (section.title) {
      let emoji = '📊';
      const lower = section.title.toLowerCase();
      if (lower.includes('headline') || lower.includes('team')) emoji = '🎯';
      if (lower.includes('gap') || lower.includes('coverage')) emoji = '📈';
      if (lower.includes('at-risk') || lower.includes('rep')) emoji = '⚠️';
      if (lower.includes('quality')) emoji = '🔍';
      if (lower.includes('action')) emoji = '⚡';

      appendSectionBlocks(blocks, `${emoji} ${section.title}`, content, 2800);
    } else if (content.trim()) {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: truncateSection(content, 2800),
        },
      });
    }
  }

  blocks.push({ type: 'divider' });
  blocks.push({
    type: 'context',
    elements: [
      {
        type: 'mrkdwn',
        text: `⏱ ${formatDuration(result.totalDuration_ms)} | 💰 ${formatTokenCount(result.totalTokenUsage.claude)}k Claude`,
      },
    ],
  });

  if (blocks.length > 48) {
    const trimmed = blocks.slice(0, 47);
    trimmed.push({
      type: 'context',
      elements: [{ type: 'mrkdwn', text: '_Message truncated — view full report in Pandora_' }],
    });
    return trimmed;
  }

  return blocks;
}

/**
 * Weekly Recap specific formatter
 */
export function formatWeeklyRecap(result: SkillResult): SlackBlock[] {
  const blocks: SlackBlock[] = [];

  blocks.push({
    type: 'header',
    text: {
      type: 'plain_text',
      text: '📊 Weekly Pipeline Recap',
      emoji: true,
    },
  });

  blocks.push({
    type: 'context',
    elements: [
      {
        type: 'mrkdwn',
        text: `Week of <!date^${Math.floor((result.completedAt.getTime() - 7 * 24 * 60 * 60 * 1000) / 1000)}^{date_short_pretty}|${new Date(result.completedAt.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString()}>`,
      },
    ],
  });

  blocks.push({ type: 'divider' });

  const rawOutput = typeof result.output === 'string' ? result.output : JSON.stringify(result.output);
  const sections = parseSectionsFromMarkdown(rawOutput);

  for (const section of sections) {
    const content = markdownToSlack(section.content);
    if (section.title) {
      const emoji = getSectionEmoji(section.title);
      appendSectionBlocks(blocks, `${emoji} ${section.title}`, content, 2800);
    } else if (content.trim()) {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: truncateSection(content, 2800),
        },
      });
    }
  }

  blocks.push({ type: 'divider' });

  blocks.push({
    type: 'context',
    elements: [
      {
        type: 'mrkdwn',
        text: `Generated in ${formatDuration(result.totalDuration_ms)}`,
      },
    ],
  });

  return blocks;
}

// ============================================================================
// Evidence-Aware Slack Formatter
// ============================================================================

function formatWithEvidence(result: SkillResult, skill: SkillDefinition): SlackBlock[] {
  const evidence = result.evidence!;
  const blocks: SlackBlock[] = [];

  blocks.push({
    type: 'header',
    text: {
      type: 'plain_text',
      text: `${getStatusEmoji(result.status)} ${skill.name}`,
      emoji: true,
    },
  });

  blocks.push({
    type: 'context',
    elements: [{
      type: 'mrkdwn',
      text: `<!date^${Math.floor(result.completedAt.getTime() / 1000)}^{date_short_pretty} at {time}|${result.completedAt.toISOString()}>`,
    }],
  });

  blocks.push({ type: 'divider' });

  for (const claim of evidence.claims) {
    const emoji = claim.severity === 'critical' ? '🔴'
      : claim.severity === 'warning' ? '🟡' : 'ℹ️';

    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `${emoji} *${claim.claim_text}*` },
    });

    const entityLines = formatClaimEntityLines(claim, evidence.evaluated_records);
    if (entityLines) {
      blocks.push({
        type: 'section',
        text: { type: 'mrkdwn', text: entityLines },
      });
    }

    if (claim.entity_ids.length > 5) {
      blocks.push({
        type: 'context',
        elements: [{ type: 'mrkdwn', text: `_+ ${claim.entity_ids.length - 5} more_` }],
      });
    }
  }

  const narrative = typeof result.output === 'string'
    ? result.output
    : (result.output as any)?.narrative || '';

  if (narrative && evidence.claims.length === 0) {
    const sections = parseTextIntoSections(markdownToSlack(narrative));
    for (const section of sections) {
      blocks.push({
        type: 'section',
        text: { type: 'mrkdwn', text: section },
      });
    }
  }

  blocks.push({ type: 'divider' });

  const sourceList = evidence.data_sources
    .map(ds => `${ds.source} ${ds.connected ? '✓' : '✗'}${!ds.connected ? ' (not connected)' : ''}`)
    .join(', ');

  const thresholds = evidence.parameters
    .filter(p => p.configurable)
    .map(p => `${p.display_name}: ${p.value}`)
    .join(', ');

  blocks.push({
    type: 'context',
    elements: [{
      type: 'mrkdwn',
      text: `_Sources: ${sourceList}. ${thresholds ? `Thresholds: ${thresholds}.` : ''}_`,
    }],
  });

  blocks.push({
    type: 'context',
    elements: [{
      type: 'mrkdwn',
      text: `⏱ ${formatDuration(result.totalDuration_ms)} | 💰 ${formatTokenCount(result.totalTokenUsage.claude)}k Claude + ${formatTokenCount(result.totalTokenUsage.deepseek)}k DeepSeek | Run \`${result.runId.slice(0, 8)}\``,
    }],
  });

  if (blocks.length > 48) {
    const trimmed = blocks.slice(0, 47);
    trimmed.push({
      type: 'context',
      elements: [{ type: 'mrkdwn', text: '_Message truncated — view full report in Pandora_' }],
    });
    return trimmed;
  }

  return blocks;
}

function formatClaimEntityLines(claim: EvidenceClaim, records: EvaluatedRecord[]): string | null {
  const lines = claim.entity_ids
    .slice(0, 5)
    .map((id, idx) => {
      const record = records.find(r => r.entity_id === id);
      if (!record) return null;

      const amount = record.fields?.amount
        ? `$${Math.round(Number(record.fields.amount) / 1000)}K` : '';
      const owner = record.owner_name || '';
      const metricValue = claim.metric_values?.[idx];
      const metricLabel = claim.metric_name?.replace(/_/g, ' ') || '';

      const parts = [record.entity_name];
      if (amount) parts.push(amount);
      if (owner) parts.push(owner);
      if (metricValue !== undefined && metricLabel) parts.push(`${metricValue} ${metricLabel}`);

      return `→ ${parts.join(' — ')}`;
    })
    .filter(Boolean);

  return lines.length > 0 ? lines.join('\n') : null;
}

export function formatAgentWithEvidence(
  narrative: string,
  skillEvidence: Record<string, SkillEvidence>,
  agentName: string,
  duration: number
): SlackBlock[] {
  const blocks: SlackBlock[] = [];

  blocks.push({
    type: 'header',
    text: { type: 'plain_text', text: `📊 ${agentName}`, emoji: true },
  });

  blocks.push({ type: 'divider' });

  const narrativeSections = parseTextIntoSections(markdownToSlack(narrative));
  for (const section of narrativeSections) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: section },
    });
  }

  const allClaims: { skillKey: string; claim: EvidenceClaim; records: EvaluatedRecord[] }[] = [];
  const allSources = new Map<string, { connected: boolean }>();
  const allParams: { name: string; display_name: string; value: any }[] = [];

  for (const [key, evidence] of Object.entries(skillEvidence)) {
    for (const claim of evidence.claims) {
      allClaims.push({ skillKey: key, claim, records: evidence.evaluated_records });
    }
    for (const ds of evidence.data_sources) {
      if (!allSources.has(ds.source) || ds.connected) {
        allSources.set(ds.source, { connected: ds.connected });
      }
    }
    for (const p of evidence.parameters.filter(p => p.configurable)) {
      if (!allParams.some(existing => existing.name === p.name)) {
        allParams.push(p);
      }
    }
  }

  if (allClaims.length > 0) {
    blocks.push({ type: 'divider' });
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: '*📋 Evidence Summary*' },
    });

    for (const { claim, records } of allClaims.slice(0, 10)) {
      const emoji = claim.severity === 'critical' ? '🔴'
        : claim.severity === 'warning' ? '🟡' : 'ℹ️';

      blocks.push({
        type: 'section',
        text: { type: 'mrkdwn', text: `${emoji} *${claim.claim_text}*` },
      });

      const entityLines = formatClaimEntityLines(claim, records);
      if (entityLines) {
        blocks.push({
          type: 'section',
          text: { type: 'mrkdwn', text: entityLines },
        });
      }
    }

    if (allClaims.length > 10) {
      blocks.push({
        type: 'context',
        elements: [{ type: 'mrkdwn', text: `_+ ${allClaims.length - 10} more claims in full report_` }],
      });
    }
  }

  blocks.push({ type: 'divider' });

  const sourceList = Array.from(allSources.entries())
    .map(([name, s]) => `${name} ${s.connected ? '✓' : '✗'}`)
    .join(', ');

  const thresholds = allParams
    .map(p => `${p.display_name}: ${p.value}`)
    .join(', ');

  blocks.push({
    type: 'context',
    elements: [{
      type: 'mrkdwn',
      text: `_Sources: ${sourceList}. ${thresholds ? `Config: ${thresholds}.` : ''}_`,
    }],
  });

  blocks.push({
    type: 'context',
    elements: [{
      type: 'mrkdwn',
      text: `⏱ ${formatDuration(duration)}`,
    }],
  });

  if (blocks.length > 48) {
    const trimmed = blocks.slice(0, 47);
    trimmed.push({
      type: 'context',
      elements: [{ type: 'mrkdwn', text: '_Message truncated — view full report in Pandora_' }],
    });
    return trimmed;
  }

  return blocks;
}

// ============================================================================
// Markdown → Slack mrkdwn Conversion
// ============================================================================

function markdownToSlack(text: string): string {
  let result = text;
  result = result.replace(/\*\*(.+?)\*\*/g, '*$1*');
  result = result.replace(/^### (.+)$/gm, '*$1*');
  result = result.replace(/^## (.+)$/gm, '*$1*');
  result = result.replace(/^# (.+)$/gm, '*$1*');
  result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<$2|$1>');
  return result;
}

// ============================================================================
// Helper Functions
// ============================================================================

function getStatusEmoji(status: string): string {
  switch (status) {
    case 'completed':
      return '✅';
    case 'partial':
      return '⚠️';
    case 'failed':
      return '❌';
    default:
      return '🔵';
  }
}

function appendSectionBlocks(blocks: SlackBlock[], title: string, content: string, maxChars: number): void {
  const fullText = `*${title}*\n${content}`;
  if (fullText.length <= maxChars) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: fullText },
    });
    return;
  }

  blocks.push({
    type: 'section',
    text: { type: 'mrkdwn', text: `*${title}*` },
  });

  const chunks = splitAtParagraphs(content, maxChars);
  for (const chunk of chunks) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: chunk },
    });
  }
}

function splitAtParagraphs(text: string, maxChars: number): string[] {
  const paragraphs = text.split(/\n\n+/);
  const chunks: string[] = [];
  let current = '';

  for (const para of paragraphs) {
    if (current.length + para.length + 2 > maxChars) {
      if (current) chunks.push(current.trim());
      if (para.length > maxChars) {
        chunks.push(truncateSection(para, maxChars));
      } else {
        current = para;
      }
    } else {
      current += (current ? '\n\n' : '') + para;
    }
  }

  if (current.trim()) chunks.push(current.trim());
  return chunks.length > 0 ? chunks : [truncateSection(text, maxChars)];
}

function formatTokenCount(tokens: number): string {
  if (tokens >= 1000) {
    return `${(tokens / 1000).toFixed(1)}k`;
  }
  return `${tokens}`;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
}

function parseTextIntoSections(text: string): string[] {
  // Split text into sections (max 3000 chars per section for Slack)
  const maxLength = 3000;
  const sections: string[] = [];

  if (text.length <= maxLength) {
    return [text];
  }

  // Try to split on double newlines or major headers
  const paragraphs = text.split(/\n\n+/);
  let currentSection = '';

  for (const para of paragraphs) {
    if (currentSection.length + para.length + 2 > maxLength) {
      if (currentSection) {
        sections.push(currentSection.trim());
      }
      currentSection = para;
    } else {
      currentSection += (currentSection ? '\n\n' : '') + para;
    }
  }

  if (currentSection) {
    sections.push(currentSection.trim());
  }

  return sections;
}

interface Section {
  title?: string;
  content: string;
}

function parseSectionsFromMarkdown(text: string): Section[] {
  const sections: Section[] = [];
  const lines = text.split('\n');

  let currentSection: Section | null = null;

  for (const line of lines) {
    if (line.match(/^-{3,}$/)) {
      continue;
    }

    const numberedHeaderMatch = line.match(/^(?:#{1,3}\s+)?(\d+)\.\s+(.+)$/);
    if (numberedHeaderMatch) {
      if (currentSection) {
        sections.push(currentSection);
      }
      currentSection = {
        title: numberedHeaderMatch[2].trim(),
        content: '',
      };
      continue;
    }

    const headerMatch = line.match(/^#{1,3}\s+(.+)$/);
    if (headerMatch) {
      if (currentSection) {
        sections.push(currentSection);
      }
      currentSection = {
        title: headerMatch[1].trim(),
        content: '',
      };
      continue;
    }

    if (currentSection) {
      currentSection.content += line + '\n';
    } else {
      if (line.trim()) {
        if (sections.length === 0 || sections[sections.length - 1].title) {
          sections.push({ content: line + '\n' });
        } else {
          sections[sections.length - 1].content += line + '\n';
        }
      }
    }
  }

  if (currentSection) {
    sections.push(currentSection);
  }

  return sections.map(s => ({
    ...s,
    content: s.content.trim(),
  }));
}

function getSectionEmoji(title: string): string {
  const lower = title.toLowerCase();
  if (lower.includes('win') || lower.includes('loss')) return '🏆';
  if (lower.includes('pipeline') || lower.includes('movement')) return '📈';
  if (lower.includes('activity')) return '⚡';
  if (lower.includes('call') || lower.includes('theme')) return '🎙️';
  if (lower.includes('priority') || lower.includes('next')) return '🎯';
  return '📌';
}

/**
 * Parse pipeline hygiene report into structured sections
 */
interface PipelineHygieneSections {
  pipelineHealth?: string;
  staleDeals?: string;
  closingSoon?: string;
  repPerformance?: string;
  topActions?: string;
  other?: string;
}

function parsePipelineHygieneReport(text: string): PipelineHygieneSections {
  const sections: PipelineHygieneSections = {};
  const lines = text.split('\n');

  let currentSection: keyof PipelineHygieneSections | null = null;
  let currentContent: string[] = [];

  const sectionMapping: Record<string, keyof PipelineHygieneSections> = {
    'PIPELINE HEALTH': 'pipelineHealth',
    'STALE DEAL': 'staleDeals',
    'CLOSING': 'closingSoon',
    'REP PERFORMANCE': 'repPerformance',
    'TOP 3 ACTION': 'topActions',
    'TOP ACTION': 'topActions',
  };

  for (const line of lines) {
    // Check for numbered section headers (1. SECTION NAME, 2. SECTION NAME)
    const numberedMatch = line.match(/^(\d+)\.\s+([A-Z\s&]+)$/);
    if (numberedMatch) {
      // Save previous section
      if (currentSection) {
        sections[currentSection] = currentContent.join('\n').trim();
      }

      // Identify new section
      const title = numberedMatch[2].trim();
      currentSection = null;
      for (const [key, value] of Object.entries(sectionMapping)) {
        if (title.includes(key)) {
          currentSection = value;
          break;
        }
      }

      currentContent = [];
      continue;
    }

    // Check for markdown headers (## SECTION NAME)
    const headerMatch = line.match(/^(#{1,3})\s+(.+)$/);
    if (headerMatch) {
      const level = headerMatch[1].length;
      const title = headerMatch[2].trim().toUpperCase();

      let matchedSection: keyof PipelineHygieneSections | null = null;
      for (const [key, value] of Object.entries(sectionMapping)) {
        if (title.includes(key)) {
          matchedSection = value;
          break;
        }
      }

      if (matchedSection) {
        if (currentSection) {
          sections[currentSection] = currentContent.join('\n').trim();
        }
        currentSection = matchedSection;
        currentContent = [];
        continue;
      }

      if (level >= 3 && currentSection) {
        currentContent.push(line);
        continue;
      }

      if (level <= 2 && !matchedSection) {
        if (currentSection) {
          sections[currentSection] = currentContent.join('\n').trim();
          currentSection = null;
          currentContent = [];
        }
        continue;
      }
    }

    // Accumulate content
    if (currentSection) {
      currentContent.push(line);
    } else {
      // Content before first section or unmatched content
      if (!sections.other) sections.other = '';
      sections.other += line + '\n';
    }
  }

  // Save last section
  if (currentSection && currentContent.length > 0) {
    sections[currentSection] = currentContent.join('\n').trim();
  }

  return sections;
}

/**
 * Parse top 3 actions into separate bullet points
 */
function parseTopActions(text: string): string[] {
  const actions: string[] = [];
  const lines = text.split('\n');

  let currentAction: string[] = [];

  for (const line of lines) {
    // Check for action headers (Action 1:, Action 2:, - Action 1:, etc.)
    const actionMatch = line.match(/^[-•*]?\s*(?:Action\s+)?(\d+)[:.]\s*(.+)$/i);
    if (actionMatch) {
      // Save previous action
      if (currentAction.length > 0) {
        actions.push(currentAction.join('\n'));
      }

      // Start new action with emoji number
      const actionNum = actionMatch[1];
      const emoji = ['1️⃣', '2️⃣', '3️⃣'][parseInt(actionNum) - 1] || '▪️';
      currentAction = [`${emoji} ${actionMatch[2]}`];
      continue;
    }

    // Accumulate continuation lines (indented or bulleted sub-items)
    if (currentAction.length > 0 && line.trim()) {
      currentAction.push(line);
    }
  }

  // Save last action
  if (currentAction.length > 0) {
    actions.push(currentAction.join('\n'));
  }

  // If no structured actions found, split by double newline or numbered list
  if (actions.length === 0 && text.trim()) {
    const fallbackActions = text.split(/\n\n+/).filter(s => s.trim());
    return fallbackActions.slice(0, 3).map((action, i) => {
      const emoji = ['1️⃣', '2️⃣', '3️⃣'][i] || '▪️';
      return `${emoji} ${action.trim()}`;
    });
  }

  return actions.slice(0, 3);
}

interface ICPReportSections {
  summary: string;
  personas: string;
  buyingCommittee: string;
  sweetSpot: string;
  channels: string;
  customFields: string;
  conversationIntel: string;
  gaps: string;
  dataQuality: string;
}

/**
 * Extract TL;DR summary from ICP Discovery sections
 */
function extractICPTLDR(sections: Partial<ICPReportSections>, stepData?: any): string[] {
  const tldr: string[] = [];

  // Extract top ICP from sweet spot section
  if (sections.sweetSpot) {
    const topICPMatch = sections.sweetSpot.match(/^-\s*\*\*([^:]+):\*\*\s*([^(]+)\(([^)]+)\)/m);
    if (topICPMatch) {
      const industry = topICPMatch[1].trim();
      const winRate = topICPMatch[2].match(/(\d+\.?\d*)%/)?.[1];
      const deals = topICPMatch[3].match(/(\d+)\s+deal/)?.[1];
      tldr.push(`✅ *Top ICP:* ${industry} (${winRate}% win rate, ${deals} deals analyzed)`);
    } else {
      // Fallback: extract first industry mention with win rate
      const fallbackMatch = sections.sweetSpot.match(/([A-Z][^:\n]+?):\s*(\d+\.?\d*)%\s+win\s+rate/);
      if (fallbackMatch) {
        tldr.push(`✅ *Top ICP:* ${fallbackMatch[1].trim()} (${fallbackMatch[2]}% win rate)`);
      }
    }
  }

  // Extract segments to avoid from sweet spot or gaps
  const avoidSegments: string[] = [];
  if (sections.sweetSpot) {
    const avoidSection = sections.sweetSpot.match(/Avoid[:\s]*\n([\s\S]*?)(?=\n\n|$)/i);
    if (avoidSection) {
      const avoidMatches = Array.from(avoidSection[1].matchAll(/^-\s*([^:]+):\s*(\d+)%\s+win\s+rate/gm));
      for (const match of avoidMatches) {
        if (match[2] === '0' || parseInt(match[2]) < 15) {
          avoidSegments.push(`${match[1].trim()} (${match[2]}%)`);
        }
      }
    }
  }
  if (avoidSegments.length > 0) {
    tldr.push(`❌ *Avoid:* ${avoidSegments.slice(0, 3).join(', ')}`);
  }

  // Extract top persona insight
  if (sections.personas && !sections.personas.includes('SKIPPED')) {
    const topPersonaMatch = sections.personas.match(/1\.\s*\*\*([^—]+)—\s*([0-9.]+)x\s+lift/);
    if (topPersonaMatch) {
      const persona = topPersonaMatch[1].trim();
      const lift = topPersonaMatch[2];
      tldr.push(`🎯 *Best persona:* ${persona} (${lift}x lift vs baseline)`);
    }
  }

  // Extract top channel insight
  if (sections.channels) {
    const topChannelMatch = sections.channels.match(/(?:1\.\s*|^-\s*)([^:]+):\s*(\d+\.?\d*)%\s+(?:close|win)\s+rate/m);
    if (topChannelMatch) {
      const channel = topChannelMatch[1].trim();
      const rate = topChannelMatch[2];
      tldr.push(`📣 *Best channel:* ${channel} (${rate}% close rate)`);
    }
  }

  // Extract key action from gaps section
  if (sections.gaps) {
    const actionMatch = sections.gaps.match(/What Sales Should Do Differently[:\s]*\n\n1\.\s*([^:]+):\s*([^\n]+)/i);
    if (actionMatch) {
      const actionType = actionMatch[1].trim();
      const actionDetail = actionMatch[2].trim().replace(/\.$/, '');
      tldr.push(`⚡ *Action:* ${actionType} — ${actionDetail.substring(0, 80)}${actionDetail.length > 80 ? '...' : ''}`);
    } else {
      // Fallback: extract first numbered recommendation
      const fallbackAction = sections.gaps.match(/^\d+\.\s*\*\*([^*]+)\*\*[:\s—-]\s*([^\n]+)/m);
      if (fallbackAction) {
        const action = fallbackAction[1].trim();
        const detail = fallbackAction[2].trim().substring(0, 80);
        tldr.push(`⚡ *Action:* ${action} — ${detail}${fallbackAction[2].length > 80 ? '...' : ''}`);
      }
    }
  }

  // Add data completeness note if persona data is missing
  if (sections.personas && sections.personas.includes('SKIPPED')) {
    tldr.push(`⚠️ *Note:* Upload contact data to unlock persona & buying committee analysis`);
  } else if (sections.conversationIntel && sections.conversationIntel.includes('NO CONVERSATION DATA')) {
    tldr.push(`⚠️ *Note:* Connect Gong/Fireflies to unlock conversation intelligence patterns`);
  }

  return tldr;
}

/**
 * ICP Discovery specific formatter
 */
export function formatICPDiscovery(result: SkillResult): SlackBlock[] {
  const blocks: SlackBlock[] = [];

  blocks.push({
    type: 'header',
    text: {
      type: 'plain_text',
      text: '🎯 ICP Discovery Report',
      emoji: true,
    },
  });

  const completedAt = result.completedAt || new Date();
  blocks.push({
    type: 'context',
    elements: [
      {
        type: 'mrkdwn',
        text: `${getStatusEmoji(result.status)} Completed <!date^${Math.floor(completedAt.getTime() / 1000)}^{date_short_pretty} at {time}|${completedAt.toISOString()}>`,
      },
    ],
  });

  const report = typeof result.output === 'string'
    ? result.output
    : (result.output as any)?.report || '';

  const sections = parseICPReportSections(report);

  // Add TL;DR summary at the top
  const tldr = extractICPTLDR(sections, result.stepData);
  if (tldr && tldr.length > 0) {
    blocks.push({ type: 'divider' });
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*📌 TL;DR*\n${tldr.join('\n')}`,
      },
    });
  }

  // Add Scoring Weights section
  const weightsText = formatScoringWeights(result.stepData);
  if (weightsText) {
    blocks.push({ type: 'divider' });
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: weightsText,
      },
    });
  }

  blocks.push({ type: 'divider' });

  if (sections.summary) {
    appendSectionBlocks(blocks, '📋 ICP Summary', markdownToSlack(sections.summary), 2800);
  }

  if (sections.personas) {
    appendSectionBlocks(blocks, '👤 Winning Personas', markdownToSlack(sections.personas), 2800);
  }

  if (sections.buyingCommittee) {
    blocks.push({ type: 'divider' });
    appendSectionBlocks(blocks, '🏛️ Ideal Buying Committee', markdownToSlack(sections.buyingCommittee), 2800);
  }

  if (sections.sweetSpot) {
    appendSectionBlocks(blocks, '🏢 Company Sweet Spot', markdownToSlack(sections.sweetSpot), 2800);
  }

  blocks.push({ type: 'divider' });

  if (sections.channels) {
    appendSectionBlocks(blocks, '📣 Acquisition Channels', markdownToSlack(sections.channels), 2800);
  }

  if (sections.customFields) {
    appendSectionBlocks(blocks, '🔧 Custom Field Discoveries', markdownToSlack(sections.customFields), 2800);
  }

  if (sections.conversationIntel) {
    blocks.push({ type: 'divider' });
    appendSectionBlocks(blocks, '🎙️ Conversation Intelligence', markdownToSlack(sections.conversationIntel), 2800);
  }

  if (sections.gaps) {
    blocks.push({ type: 'divider' });
    appendSectionBlocks(blocks, '⚡ Gaps & Recommendations', markdownToSlack(sections.gaps), 2800);
  }

  if (sections.dataQuality) {
    appendSectionBlocks(blocks, '📊 Data Quality', markdownToSlack(sections.dataQuality), 2800);
  }

  blocks.push({ type: 'divider' });

  const duration = result.totalDuration_ms || 0;
  const claudeTokens = result.totalTokenUsage?.claude || 0;
  const deepseekTokens = result.totalTokenUsage?.deepseek || 0;

  blocks.push({
    type: 'context',
    elements: [
      {
        type: 'mrkdwn',
        text: `Duration: ${formatDuration(duration)} | Tokens: Claude ${formatTokenCount(claudeTokens)}, DeepSeek ${formatTokenCount(deepseekTokens)} | Run ID: \`${result.runId}\``,
      },
    ],
  });

  return blocks;
}

function formatScoringWeights(stepData: any): string | null {
  if (!stepData?.discovery_result?.scoringWeights) return null;

  const weights = stepData.discovery_result.scoringWeights;
  const lines: string[] = ['*⚖️ Lead Scoring Weights*', '_These weights are now applied to all open deals:_', ''];

  // Persona weights
  if (weights.personas && Object.keys(weights.personas).length > 0) {
    lines.push('*Top Personas:*');
    const topPersonas = Object.entries(weights.personas)
      .sort(([, a]: any, [, b]: any) => (b as number) - (a as number))
      .slice(0, 5);

    for (const [persona, points] of topPersonas) {
      lines.push(`• ${persona}: *+${points} points*`);
    }
    lines.push('');
  }

  // Industry weights
  if (weights.industries && Object.keys(weights.industries).length > 0) {
    lines.push('*Top Industries:*');
    const topIndustries = Object.entries(weights.industries)
      .sort(([, a]: any, [, b]: any) => (b as number) - (a as number))
      .slice(0, 5);

    for (const [industry, points] of topIndustries) {
      lines.push(`• ${industry}: *+${points} points*`);
    }
    lines.push('');
  }

  // Lead source weights
  if (weights.leadSources && Object.keys(weights.leadSources).length > 0) {
    lines.push('*Lead Sources:*');
    const topSources = Object.entries(weights.leadSources)
      .sort(([, a]: any, [, b]: any) => (b as number) - (a as number))
      .slice(0, 3);

    for (const [source, points] of topSources) {
      lines.push(`• ${source}: *+${points} points*`);
    }
    lines.push('');
  }

  // Committee bonuses (if available)
  const discoveryResult = stepData.discovery_result;
  if (discoveryResult?.committees && discoveryResult.committees.length > 0) {
    const topCommittee = discoveryResult.committees[0];
    if (topCommittee.personaNames && topCommittee.lift) {
      const bonus = Math.round(topCommittee.lift * 5);
      lines.push('*Ideal Committee Bonus:*');
      lines.push(`• ${topCommittee.personaNames.join(' + ')}: *+${bonus} points* (${Math.round(topCommittee.winRate * 100)}% win rate)`);
      lines.push('');
    }
  }

  lines.push(`_Profile ID: \`${discoveryResult?.profileId || 'pending'}\`_`);

  return lines.join('\n');
}

function parseICPReportSections(report: string): Partial<ICPReportSections> {
  if (!report) return {};

  const sections: Partial<ICPReportSections> = {};
  const allSections = report.split(/(?=^## )/m).filter(s => s.trim());

  for (const section of allSections) {
    const firstLine = section.split('\n')[0].toLowerCase();
    const body = section.replace(/^##[^\n]*\n/, '').trim();
    if (!body) continue;

    if (firstLine.includes('icp summary')) {
      sections.summary = body;
    } else if (firstLine.includes('winning persona')) {
      sections.personas = body;
    } else if (firstLine.includes('buying committee')) {
      sections.buyingCommittee = body;
    } else if (firstLine.includes('company sweet spot') || firstLine.includes('sweet spot')) {
      sections.sweetSpot = body;
    } else if (firstLine.includes('acquisition channel') || firstLine.includes('channel insight')) {
      sections.channels = body;
    } else if (firstLine.includes('custom field')) {
      sections.customFields = body;
    } else if (firstLine.includes('conversation intelligence') || firstLine.includes('conversation intel')) {
      sections.conversationIntel = body;
    } else if (firstLine.includes('gap') && firstLine.includes('recommendation')) {
      sections.gaps = body;
    } else if (firstLine.includes('data quality') || firstLine.includes('data limitation')) {
      sections.dataQuality = body;
    }
  }

  return sections;
}

export interface ActionButtonContext {
  skill_id: string;
  run_id: string;
  workspace_id: string;
  deals?: Array<{ id: string; name: string }>;
}

export function buildActionButtons(ctx: ActionButtonContext): SlackBlock[] {
  const blocks: SlackBlock[] = [];

  const primaryElements: any[] = [
    {
      type: 'button',
      text: { type: 'plain_text', text: '✓ Reviewed', emoji: true },
      style: 'primary',
      action_id: 'mark_reviewed',
      value: JSON.stringify({
        skill_id: ctx.skill_id,
        run_id: ctx.run_id,
        workspace_id: ctx.workspace_id,
      }),
    },
    {
      type: 'button',
      text: { type: 'plain_text', text: 'Snooze 1 Week', emoji: true },
      action_id: 'snooze_findings',
      value: JSON.stringify({
        skill_id: ctx.skill_id,
        run_id: ctx.run_id,
        workspace_id: ctx.workspace_id,
        days: 7,
      }),
    },
  ];

  blocks.push({
    type: 'actions',
    block_id: `actions_${ctx.run_id.slice(0, 8)}`,
    elements: primaryElements,
  });

  if (ctx.deals && ctx.deals.length > 0) {
    const topDeals = ctx.deals.slice(0, 3);
    blocks.push({
      type: 'actions',
      block_id: `deals_${ctx.run_id.slice(0, 8)}`,
      elements: topDeals.map(deal => ({
        type: 'button',
        text: { type: 'plain_text', text: `🔍 ${deal.name.slice(0, 50)}`, emoji: true },
        action_id: 'drill_deal',
        value: JSON.stringify({
          deal_id: deal.id,
          deal_name: deal.name,
          workspace_id: ctx.workspace_id,
          run_id: ctx.run_id,
        }),
      })),
    });
  }

  return blocks;
}

/**
 * Truncate section content to max length with ellipsis
 */
function truncateSection(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }

  // Try to truncate at sentence boundary
  const truncated = text.slice(0, maxLength);
  const lastPeriod = truncated.lastIndexOf('.');
  const lastNewline = truncated.lastIndexOf('\n');
  const breakPoint = Math.max(lastPeriod, lastNewline);

  if (breakPoint > maxLength * 0.7) {
    return text.slice(0, breakPoint + 1) + '\n_...see full report for details_';
  }

  return truncated + '...\n_...see full report for details_';
}
