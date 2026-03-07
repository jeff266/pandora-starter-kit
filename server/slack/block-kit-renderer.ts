import type { ConversationTurnResult } from '../chat/orchestrator.js';
import type { BlockKitRenderOptions, SlackBlock } from './types.js';

export function renderToBlockKit(
  result: ConversationTurnResult,
  options: BlockKitRenderOptions = {}
): SlackBlock[] {
  const blocks: SlackBlock[] = [];
  const text = result.answer || '';

  if (!text.trim()) {
    return blocks;
  }

  const sections = splitIntoSections(text);

  for (const section of sections) {
    if (section.type === 'code') {
      blocks.push({
        type: 'section',
        text: { type: 'mrkdwn', text: section.content },
      });
    } else if (section.type === 'heading') {
      blocks.push({ type: 'divider' });
      blocks.push({
        type: 'section',
        text: { type: 'mrkdwn', text: `*${section.content}*` },
      });
    } else {
      const chunk = section.content.trim();
      if (!chunk) continue;

      if (chunk.length <= 3000) {
        blocks.push({
          type: 'section',
          text: { type: 'mrkdwn', text: chunk },
        });
      } else {
        for (const sub of chunkText(chunk, 3000)) {
          blocks.push({
            type: 'section',
            text: { type: 'mrkdwn', text: sub },
          });
        }
      }
    }
  }

  if (blocks.length === 0) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: text.slice(0, 3000) },
    });
  }

  const actionElements: SlackBlock[] = [];

  if (options.includeShareButton) {
    actionElements.push({
      type: 'button',
      text: { type: 'plain_text', text: 'Share in channel' },
      action_id: 'share_in_channel',
      value: text.slice(0, 2000),
    });
  }

  if (options.includeDeepLink) {
    const appUrl = process.env.APP_URL || 'https://pandora.replit.app';
    blocks.push({
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: `<${appUrl}/command-center|Open in Pandora →>`,
        },
      ],
    });
  }

  if (actionElements.length > 0) {
    blocks.push({ type: 'actions', elements: actionElements });
  }

  return blocks;
}

export function extractPlainText(result: ConversationTurnResult): string {
  const text = result.answer || '';
  return text
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/__(.*?)__/g, '$1')
    .replace(/_(.*?)_/g, '$1')
    .replace(/`{3}[\s\S]*?`{3}/g, '[table]')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '• ')
    .trim()
    .slice(0, 200);
}

interface TextSection {
  type: 'prose' | 'code' | 'heading';
  content: string;
}

function splitIntoSections(text: string): TextSection[] {
  const sections: TextSection[] = [];
  const lines = text.split('\n');
  let currentProse: string[] = [];

  const flushProse = () => {
    const content = currentProse.join('\n').trim();
    if (content) {
      sections.push({ type: 'prose', content });
    }
    currentProse = [];
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    if (line.startsWith('```')) {
      flushProse();
      const codeLines: string[] = [line];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      if (i < lines.length) {
        codeLines.push(lines[i]);
      }
      sections.push({ type: 'code', content: codeLines.join('\n') });
    } else if (/^#{1,3}\s+/.test(line)) {
      flushProse();
      sections.push({ type: 'heading', content: line.replace(/^#{1,3}\s+/, '') });
    } else {
      currentProse.push(line);

      if (currentProse.join('\n').length > 2800) {
        flushProse();
      }
    }
    i++;
  }

  flushProse();
  return sections;
}

function chunkText(text: string, maxLen: number): string[] {
  const chunks: string[] = [];
  const paragraphs = text.split('\n\n');
  let current = '';

  for (const para of paragraphs) {
    if ((current + '\n\n' + para).length > maxLen && current) {
      chunks.push(current.trim());
      current = para;
    } else {
      current = current ? current + '\n\n' + para : para;
    }
  }

  if (current.trim()) {
    chunks.push(current.trim());
  }

  return chunks;
}
