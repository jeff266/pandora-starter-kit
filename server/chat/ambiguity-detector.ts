import { query } from '../db.js';
import { getWorkspacePipelineNames } from './pipeline-resolver.js';
import { filterResolver } from '../tools/filter-resolver.js';

export interface AmbiguityOption {
  label: string;
  value: string;
}

export interface AmbiguityResult {
  question: string;
  dimension: string;
  options: AmbiguityOption[];
}

/**
 * Detects if a query is underspecified and requires clarification.
 * 
 * Rules:
 * 1. Pipeline ambiguity: message mentions pipeline/deals/revenue without specifying a scope 
 *    AND workspace has 2+ analysis_scopes.
 * 2. Dimension ambiguity: message matches keywords for a user-defined dimension 
 *    AND that dimension has 2+ options.
 * 
 * Skips if:
 * - Message already contains a scope name
 * - Message contains a [Dimension:] marker
 */
export async function detectQueryAmbiguity(
  message: string,
  workspaceId: string
): Promise<AmbiguityResult | null> {
  // Skip if it's a follow-up with a selection
  if (message.includes('[Dimension:')) {
    return null;
  }

  const normalizedMsg = message.toLowerCase();

  // Skip clarification for broad advisory/analytical queries — interpret comprehensively
  const broadQueryPatterns = [
    /\btell me about\b/i,
    /\bwhat can we do\b/i,
    /\bhow can we improve\b/i,
    /\bwhat should we\b/i,
    /\bdeal hygiene\b/i,
    /\bpipeline health\b/i,
    /\bdeal health\b/i,
    /\bpipeline hygiene\b/i,
  ];
  if (broadQueryPatterns.some(p => p.test(message))) {
    return null;
  }

  // Skip if query mentions two distinct domain topics joined with "and" — treat comprehensively
  const domainTerms = ['hygiene', 'forecast', 'pipeline', 'attainment', 'risk', 'coverage', 'velocity', 'health'];
  const mentionedDomainTerms = domainTerms.filter(t => normalizedMsg.includes(t));
  if (normalizedMsg.includes(' and ') && mentionedDomainTerms.length >= 2) {
    return null;
  }

  // 1. Check for Pipeline Ambiguity
  const pipelineKeywords = ['pipeline', 'deal', 'revenue', 'forecast', 'attainment', 'coverage'];
  const mentionsPipeline = pipelineKeywords.some(k => normalizedMsg.includes(k));

  if (mentionsPipeline) {
    const pipelines = await getWorkspacePipelineNames(workspaceId);
    
    // Check if any pipeline name is already in the message
    const alreadySpecified = pipelines.some(p => normalizedMsg.includes(p.name.toLowerCase()));
    
    if (!alreadySpecified && pipelines.length >= 2) {
      return {
        question: "Which pipeline are you asking about?",
        dimension: "pipeline",
        options: [
          ...pipelines.map(p => ({ label: p.name, value: p.scope_id })),
          { label: "All Pipelines", value: "all" }
        ]
      };
    }
  }

  // 2. Check for User-Defined Dimension Ambiguity
  try {
    const dimensions = await filterResolver.getWorkspaceDimensions(workspaceId);
    // filterResolver.getWorkspaceDimensions already includes 'pipeline' at index 0
    // We want to check other dimensions
    for (const dim of dimensions) {
      if (dim.id === 'pipeline') continue;

      const dimKeywords = [dim.label.toLowerCase(), dim.id.toLowerCase()];
      const mentionsDim = dimKeywords.some(k => normalizedMsg.includes(k));

      if (mentionsDim) {
        // Check if any option is already specified
        const alreadySpecified = dim.options.some(opt => normalizedMsg.includes(opt.label.toLowerCase()));
        
        if (!alreadySpecified && dim.options.length >= 2) {
          return {
            question: `Which ${dim.label} are you interested in?`,
            dimension: dim.id,
            options: [
              ...dim.options.map(opt => ({ label: opt.label, value: opt.value })),
              { label: `All ${dim.label}s`, value: "all" }
            ]
          };
        }
      }
    }
  } catch (err) {
    console.error('[AmbiguityDetector] Error checking dimensions:', err);
  }

  return null;
}
