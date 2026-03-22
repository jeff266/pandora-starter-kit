import { callLLM } from '../utils/llm-router.js';
import type { SectionContent } from './types.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('ExecSummary');

/**
 * Compress section content to ~1500 tokens for the summary prompt.
 * Extracts: first 2 sentences of narrative + top 2 metrics per section.
 */
function compressSections(sections: SectionContent[]): string {
  const parts: string[] = [];

  for (const section of sections) {
    const lines: string[] = [];

    if (section.narrative) {
      const sentences = section.narrative
        .split(/(?<=[.!?])\s+/)
        .map(s => s.trim())
        .filter(Boolean);
      lines.push(...sentences.slice(0, 2));
    }

    if (section.metrics && section.metrics.length > 0) {
      const topMetrics = section.metrics
        .slice(0, 2)
        .map(m => {
          const delta = m.delta != null
            ? ` (${m.delta > 0 ? '+' : ''}${m.delta})`
            : '';
          return `${m.label}: ${m.value}${delta}`;
        });
      lines.push(...topMetrics);
    }

    if (lines.length > 0) {
      parts.push(`${section.title}: ${lines.join(' ')}`);
    }
  }

  return parts.join('\n').slice(0, 6000);
}

/**
 * Generate a 3-sentence executive summary for a WBR or QBR.
 * Returns null on failure so the caller falls back to the mechanical headline.
 */
export async function generateExecSummary(
  workspaceId: string,
  sections: SectionContent[],
  documentType: string,
  periodLabel: string
): Promise<string | null> {
  try {
    const compressed = compressSections(sections);
    if (!compressed.trim()) return null;

    const result = await callLLM(workspaceId, 'generate', {
      systemPrompt: [
        `You write 3-sentence executive summaries for ${documentType.toUpperCase()} reports.`,
        'Rules: under 60 words total, no em dashes (use commas), specific numbers and names,',
        'no hedging ("seems", "may", "could"), no bullet points, no line breaks,',
        'do not start with "This week" or "The report shows".',
        'Output only the 3 sentences — nothing else.',
      ].join(' '),
      messages: [
        {
          role: 'user',
          content: [
            `${documentType.toUpperCase()} — ${periodLabel}`,
            '',
            compressed,
            '',
            'Write exactly 3 sentences:',
            '1. The most important metric or performance result.',
            '2. The biggest risk or week-over-week change.',
            '3. The single action required this week.',
          ].join('\n'),
        },
      ],
      maxTokens: 150,
      temperature: 0.3,
    });

    const text = result.content?.trim();
    if (!text || text.length < 20) return null;

    return text.replace(/—/g, ',').replace(/\s{2,}/g, ' ').trim();
  } catch (err) {
    logger.warn('Exec summary generation failed (non-fatal)', {
      error: (err as Error).message,
      documentType,
      periodLabel,
    });
    return null;
  }
}
