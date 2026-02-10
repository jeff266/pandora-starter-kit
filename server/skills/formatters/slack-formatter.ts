/**
 * Slack Formatter for Skill Results
 *
 * Converts skill results into Slack Block Kit format.
 * Provides both generic formatting and skill-specific templates.
 */

import type { SkillResult, SkillDefinition } from '../types.js';

interface SlackBlock {
  type: string;
  [key: string]: any;
}

/**
 * Generic Slack formatter with skill-specific routing
 */
export function formatForSlack(result: SkillResult, skill: SkillDefinition): SlackBlock[] {
  // Route to skill-specific formatter if template is defined
  if (skill.slackTemplate === 'pipeline-hygiene') {
    return formatPipelineHygiene(result, skill);
  } else if (skill.slackTemplate === 'weekly-recap') {
    return formatWeeklyRecap(result);
  } else if (skill.slackTemplate === 'deal-risk-review') {
    return formatDealRiskReview(result);
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

  // Generic parsing for now
  const output = markdownToSlack(typeof result.output === 'string' ? result.output : JSON.stringify(result.output));
  const sections = parseSectionsFromMarkdown(output);

  for (const section of sections) {
    if (section.title) {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*${section.title}*\n${section.content}`,
        },
      });
    } else {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: section.content,
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

  const output = markdownToSlack(typeof result.output === 'string' ? result.output : JSON.stringify(result.output));
  const sections = parseSectionsFromMarkdown(output);

  for (const section of sections) {
    if (section.title) {
      const emoji = getSectionEmoji(section.title);
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `${emoji} *${section.title}*\n${section.content}`,
        },
      });
    } else {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: section.content,
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
    // Check for numbered headers (1. HEADER, 2. HEADER)
    const numberedHeaderMatch = line.match(/^(\d+)\.\s+([A-Z\s&]+)$/);
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

    // Check for markdown headers (## HEADER)
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

    // Add line to current section
    if (currentSection) {
      currentSection.content += line + '\n';
    } else {
      // Content before first header
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
