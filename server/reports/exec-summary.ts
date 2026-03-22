import { callLLM } from '../utils/llm-router.js';
import { SectionContent } from './types.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('ExecSummary');

const REFUSAL_PATTERNS = [
  /^I cannot/i,
  /^I am unable/i,
  /^I'm unable/i,
  /no content generators/i,
  /only placeholder/i,
  /not enough data/i,
  /configure section/i,
  /no actual.*data/i,
];

function isRefusal(text: string): boolean {
  return REFUSAL_PATTERNS.some(p => p.test(text));
}

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
        .slice()
        .sort((a, b) => {
          const order: Record<string, number> = { critical: 0, warning: 1, good: 2 };
          return (order[a.severity ?? 'good'] ?? 3) - (order[b.severity ?? 'good'] ?? 3);
        })
        .slice(0, 2)
        .map(m => {
          const delta = m.delta && m.delta_direction
            ? ` (${m.delta} ${m.delta_direction})`
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
 * Generate a 3-sentence executive summary for WBR/QBR documents.
 * Returns null on failure or refusal so the caller falls back to mechanical headline.
 */
export async function generateExecSummary(
  sections: SectionContent[],
  documentType: 'wbr' | 'qbr',
  periodLabel: string,
  workspaceId: string
): Promise<string | null> {
  try {
    const compressed = compressSections(sections);
    if (!compressed.trim()) return null;

    const result = await callLLM(workspaceId, 'generate', {
      systemPrompt: [
        `You write 3-sentence executive summaries for ${documentType.toUpperCase()} reports.`,
        'RULES — violating any rule means failure:',
        '• Output ONLY the 3 sentences. No labels, no bullets, no preamble.',
        '• Under 60 words total.',
        '• No em dashes (use commas or periods).',
        '• Never start with "I cannot", "I am unable", "This week", or "The report shows".',
        '• Never explain what data is missing — write around it with directional language.',
        '• Use specific numbers and deal or rep names when the data contains them.',
        '• Sentence 1: the single most important metric or performance result.',
        '• Sentence 2: the biggest risk or week-over-week change.',
        '• Sentence 3: the single action required this period.',
        '• If a metric is unavailable, write a directional statement ("pipeline coverage remains under review") rather than omitting the sentence.',
      ].join('\n'),
      messages: [
        {
          role: 'user',
          content: [
            `${documentType.toUpperCase()} — ${periodLabel}`,
            '',
            compressed,
            '',
            'Write the 3-sentence executive summary now.',
          ].join('\n'),
        },
      ],
      maxTokens: 180,
      temperature: 0.3,
    });

    const text = result.content?.trim();
    if (!text || text.length < 20) return null;

    // Reject refusals — fall back to mechanical headline
    if (isRefusal(text)) {
      logger.warn('ExecSummary: LLM returned a refusal, falling back', {
        documentType,
        periodLabel,
        preview: text.slice(0, 80),
      });
      return null;
    }

    // Strip any em dashes that slipped through
    const clean = text.replace(/—/g, ',').replace(/\s{2,}/g, ' ').trim();

    logger.info('ExecSummary generated', {
      documentType,
      periodLabel,
      words: clean.split(/\s+/).length,
    });

    return clean;
  } catch (err) {
    logger.warn('ExecSummary generation failed (non-fatal)', {
      error: (err as Error).message,
    });
    return null;
  }
}
