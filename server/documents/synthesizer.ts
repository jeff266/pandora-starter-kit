import { AccumulatedDocument, DocumentContribution, DocumentTemplateType } from './types.js';
import { callLLM } from '../utils/llm-router.js';

export interface SynthesisInput {
  workspaceId: string;
  sessionId: string;
  document: AccumulatedDocument;
  workspaceMetrics?: {
    attainment?: number;
    coverage?: number;
    days_remaining?: number;
    quarter_phase?: 'early' | 'mid' | 'late';
  };
}

export interface SynthesisOutput {
  executiveSummary: string;
  sectionBridges: Record<string, string>;
  documentThroughline: string;
  lowConfidenceFlags: Array<{
    contributionId: string;
    reason: string;
  }>;
}

export async function synthesizeDocument(input: SynthesisInput): Promise<SynthesisOutput> {
  const { workspaceId, document, workspaceMetrics } = input;
  const { templateType, sections } = document;

  // Prepare compact context (<3K tokens)
  const sectionSummaries = sections.map(section => {
    // Top 2 findings per section to stay under budget
    const topContributions = section.content.slice(0, 2);
    const contributionsText = topContributions.map(c => `- ${c.title}${c.body ? `: ${c.body}` : ''}`).join('\n');
    
    return `Section: ${section.title} (ID: ${section.id})\n${contributionsText || 'No major updates.'}`;
  }).join('\n\n');

  const recommendations = sections.flatMap(s => s.content)
    .filter(c => c.type === 'recommendation')
    .slice(0, 5)
    .map(c => `- ${c.title}`)
    .join('\n');

  const systemPrompt = `You are the Pandora Strategy Engine. Your job is to synthesize a narrative throughline for a ${templateType} document based on scattered findings and metrics.
  
  Format your response as a JSON object with:
  - executiveSummary: 2-3 paragraphs of high-level narrative.
  - sectionBridges: An object mapping section IDs to a single transition sentence that connects it to the overall narrative.
  - documentThroughline: A single punchy sentence that captures the "so what" of the entire document.
  - lowConfidenceFlags: An array of { contributionId: string, reason: string } for items that seem contradictory or based on small sample sizes.
  
  Keep the tone professional, executive-ready, and data-driven.`;

  const userPrompt = `
  TEMPLATE TYPE: ${templateType}
  
  WORKSPACE METRICS:
  ${JSON.stringify(workspaceMetrics || {}, null, 2)}
  
  SECTION CLAIMS:
  ${sectionSummaries}
  
  TOP RECOMMENDATIONS:
  ${recommendations || 'None provided.'}
  
  Synthesize the document narrative now.`;

  try {
    const response = await callLLM(workspaceId, 'reason', {
      systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
      temperature: 0.3,
      schema: {
        type: 'object',
        properties: {
          executiveSummary: { type: 'string' },
          sectionBridges: { type: 'object' },
          documentThroughline: { type: 'string' },
          lowConfidenceFlags: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                contributionId: { type: 'string' },
                reason: { type: 'string' }
              }
            }
          }
        }
      }
    });

    // Handle stringified JSON from LLM if not automatically parsed by router (though router should handle it if schema is provided)
    const result = typeof response.content === 'string' ? JSON.parse(response.content) : response.content;
    
    // Low-confidence detection (Manual rules as requested in details)
    const manualFlags = [];
    for (const section of sections) {
      for (const contribution of section.content) {
        if (contribution.data?.record_count < 5) {
          manualFlags.push({ 
            contributionId: contribution.id, 
            reason: 'Small sample size (record_count < 5)' 
          });
        }
        if (contribution.data?.contradiction_found) {
          manualFlags.push({ 
            contributionId: contribution.id, 
            reason: 'Contradictory data detected' 
          });
        }
      }
    }

    return {
      executiveSummary: result.executiveSummary || '',
      sectionBridges: result.sectionBridges || {},
      documentThroughline: result.documentThroughline || '',
      lowConfidenceFlags: [...(result.lowConfidenceFlags || []), ...manualFlags]
    };
  } catch (err) {
    console.error('[Synthesizer] Synthesis failed:', err);
    return {
      executiveSummary: 'Narrative synthesis unavailable at this time.',
      sectionBridges: {},
      documentThroughline: `${templateType} in progress`,
      lowConfidenceFlags: []
    };
  }
}
