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
 * Generic Slack formatter
 */
export function formatForSlack(result: SkillResult, skill: SkillDefinition): SlackBlock[] {
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
    const sections = parseTextIntoSections(result.output);
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
 * Pipeline Hygiene specific formatter
 */
export function formatPipelineHygiene(result: SkillResult): SlackBlock[] {
  const blocks: SlackBlock[] = [];

  blocks.push({
    type: 'header',
    text: {
      type: 'plain_text',
      text: '🔍 Pipeline Hygiene Check',
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

  // Parse output into sections
  const output = typeof result.output === 'string' ? result.output : JSON.stringify(result.output);
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
        text: `⏱ ${formatDuration(result.totalDuration_ms)} | 🎯 ${result.totalTokenUsage.claude} Claude tokens`,
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

  const output = typeof result.output === 'string' ? result.output : JSON.stringify(result.output);
  const sections = parseSectionsFromMarkdown(output);

  for (const section of sections) {
    if (section.title) {
      // Use different formatting for each major section
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
