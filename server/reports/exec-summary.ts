import { callLLM } from '../utils/llm-router.js';
import { SectionContent, MetricCard } from './types.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('ExecSummary');

/**
 * Generate a 3-sentence executive summary for WBR/QBR documents
 * Uses compressed section data to stay within token limits
 */
export async function generateExecSummary(
  sections: SectionContent[],
  documentType: 'wbr' | 'qbr',
  periodLabel: string,
  workspaceId: string
): Promise<string> {
  try {
    // Compress sections to stay within ~1500 tokens
    const compressedSections = sections
      .map(section => {
        // Extract first 2 sentences from narrative
        const sentences = (section.narrative || '').split(/\.\s+/);
        const firstTwo = sentences.slice(0, 2).join('. ');
        const narrative = firstTwo ? firstTwo + '.' : '';

        // Get top 2 metrics by severity priority
        const metrics = (section.metrics || [])
          .slice()
          .sort((a, b) => {
            const severityOrder = { critical: 0, warning: 1, good: 2 };
            const aSev = severityOrder[a.severity || 'good'] ?? 3;
            const bSev = severityOrder[b.severity || 'good'] ?? 3;
            return aSev - bSev;
          })
          .slice(0, 2)
          .map(m => {
            const delta = m.delta && m.delta_direction
              ? ` ${m.delta} ${m.delta_direction}`
              : '';
            return `${m.label}: ${m.value}${delta}`;
          });

        return {
          title: section.title,
          narrative,
          metrics,
        };
      })
      .filter(s => s.narrative || s.metrics.length > 0);

    // Build compressed input
    const sectionsText = compressedSections
      .map(s => {
        const metricsText = s.metrics.length > 0
          ? `\nMetrics: ${s.metrics.join(', ')}`
          : '';
        return `### ${s.title}\n${s.narrative}${metricsText}`;
      })
      .join('\n\n');

    const systemPrompt = `You are a RevOps analyst writing a 3-sentence executive summary for a ${documentType.toUpperCase()} covering ${periodLabel}.

Section highlights:
${sectionsText}

Write exactly 3 sentences:
1. The single most important number or status (lead with the metric, not "this week")
2. The biggest risk or change from prior period
3. The most important action or decision needed

Rules:
- Specific numbers over adjectives
- Name deals, reps, or segments when relevant
- No throat-clearing ("This WBR covers...")
- No em dashes
- Under 60 words total

Respond with only the 3 sentences. No labels, no bullets.`;

    const response = await callLLM(workspaceId, 'generate', {
      systemPrompt,
      messages: [{ role: 'user', content: 'Generate the executive summary.' }],
      maxTokens: 200,
      temperature: 0.3,
    });

    const summary = response.content.trim();

    // Validate output
    if (!summary || summary.length > 400) {
      logger.warn('Summary invalid or too long, using fallback', {
        length: summary?.length,
        documentType,
        periodLabel,
      });
      return null as any; // Will trigger fallback in generator
    }

    logger.info('Executive summary generated', {
      documentType,
      periodLabel,
      wordCount: summary.split(/\s+/).length,
      sectionCount: sections.length,
    });

    return summary;
  } catch (err) {
    logger.error('Executive summary generation failed', err instanceof Error ? err : undefined);
    // Return null to trigger fallback to mechanical headline
    return null as any;
  }
}
