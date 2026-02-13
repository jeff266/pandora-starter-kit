/**
 * AI-Powered Stage Mapping for Deal Imports
 *
 * Uses DeepSeek to normalize raw CRM stage names into Pandora's standardized pipeline stages.
 * Integrates with stage_mappings table for persistence and workspace config for runtime lookups.
 */

import { callLLM } from '../utils/llm-router.js';

export interface StageMappingEntry {
  normalized: 'discovery' | 'qualification' | 'proposal' | 'negotiation' | 'closed_won' | 'closed_lost';
  is_open: boolean;
  display_order: number;
}

export interface StageMappingResult {
  stageMapping: Record<string, StageMappingEntry>;
  confidence: number;
  notes: string;
}

/**
 * Classify raw stage values using DeepSeek
 */
export async function classifyStages(
  stageValues: string[],
  sampleDealsByStage: Record<string, any[]>,
  workspaceId: string
): Promise<StageMappingResult> {
  // Build sample deals table
  let sampleDealsText = '';
  for (const [stage, deals] of Object.entries(sampleDealsByStage)) {
    sampleDealsText += `\nStage: "${stage}"\n`;
    sampleDealsText += deals.map(d =>
      `  - ${d.name || 'Unnamed'} | Amount: ${d.amount || 'N/A'} | Close: ${d.close_date || 'N/A'}`
    ).join('\n');
  }

  const prompt = `You are mapping CRM deal stages to a standardized sales pipeline model.

Raw stages found in the data:
${stageValues.map(s => `- "${s}"`).join('\n')}

Sample deals at each stage (up to 3 per stage):
${sampleDealsText}

Map each raw stage to one of these normalized categories:
- discovery: Early stage — initial conversations, demos, intros
- qualification: Evaluating fit — needs analysis, BANT, MEDDICC
- proposal: Proposal or quote sent, pricing discussed
- negotiation: Terms being negotiated, contracts under review, legal, procurement
- closed_won: Deal won, signed, booked
- closed_lost: Deal lost, disqualified, no decision, churned

Also determine for each stage:
- is_open: true if deals in this stage are still active pipeline, false if terminal (closed_won, closed_lost)
- display_order: numerical sort order where 1 = earliest stage in the funnel

Common tricky mappings:
- "Appointment Scheduled" → discovery (it's early stage)
- "Decision Maker Bought-In" → negotiation (past proposal, working to close)
- "Contract Sent" → negotiation (late stage)
- "Closed - No Decision" → closed_lost
- "On Hold" / "Paused" → keep as-is but mark is_open = true (still in pipeline)

Respond with ONLY valid JSON, no markdown:
{
  "stageMapping": {
    "Discovery Call": { "normalized": "discovery", "is_open": true, "display_order": 1 },
    "Qualified": { "normalized": "qualification", "is_open": true, "display_order": 2 },
    "Proposal Sent": { "normalized": "proposal", "is_open": true, "display_order": 3 },
    "Negotiation": { "normalized": "negotiation", "is_open": true, "display_order": 4 },
    "Closed Won": { "normalized": "closed_won", "is_open": false, "display_order": 5 },
    "Closed Lost": { "normalized": "closed_lost", "is_open": false, "display_order": 6 }
  },
  "confidence": 0.90,
  "notes": "Standard HubSpot pipeline stages detected. 'On Hold' kept as open pipeline."
}`;

  const response = await callLLM(workspaceId, 'classify', {
    messages: [{ role: 'user', content: prompt }],
    maxTokens: 4096,
    temperature: 0.1,
  });

  try {
    let content = response.content.trim();

    // Extract JSON from markdown code fences if present
    const jsonMatch = content.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    if (jsonMatch) {
      content = jsonMatch[1].trim();
    }

    const result = JSON.parse(content);
    return result as StageMappingResult;
  } catch (error) {
    console.error('[StageClassifier] AI response:', response.content);
    console.error('[StageClassifier] Parse error:', error);
    throw new Error('Failed to parse AI stage mapping response. Falling back to heuristic mapping.');
  }
}

/**
 * Heuristic fallback for stage mapping when AI fails
 */
export function heuristicMapStages(stageValues: string[]): StageMappingResult {
  const STAGE_PATTERNS: Record<string, { pattern: RegExp; is_open: boolean; display_order: number }> = {
    closed_won: { pattern: /closed.?won|won|signed|booked|converted/i, is_open: false, display_order: 5 },
    closed_lost: { pattern: /closed.?lost|lost|disqualified|no.?decision|dead|churned/i, is_open: false, display_order: 6 },
    discovery: { pattern: /discovery|intro|initial|first.?call|demo|appointment/i, is_open: true, display_order: 1 },
    qualification: { pattern: /qualif|evaluation|assess|bant|meddicc|needs/i, is_open: true, display_order: 2 },
    proposal: { pattern: /proposal|quote|pricing|presented|solution/i, is_open: true, display_order: 3 },
    negotiation: { pattern: /negotiat|contract|legal|procurement|decision|verbal|commit/i, is_open: true, display_order: 4 },
  };

  const stageMapping: Record<string, StageMappingEntry> = {};

  for (const rawStage of stageValues) {
    let matched = false;

    for (const [normalized, { pattern, is_open, display_order }] of Object.entries(STAGE_PATTERNS)) {
      if (pattern.test(rawStage)) {
        stageMapping[rawStage] = {
          normalized: normalized as any,
          is_open,
          display_order,
        };
        matched = true;
        break;
      }
    }

    // If no match, default to discovery (open pipeline)
    if (!matched) {
      stageMapping[rawStage] = {
        normalized: 'discovery',
        is_open: true,
        display_order: 1,
      };
    }
  }

  return {
    stageMapping,
    confidence: 0.6,
    notes: 'Heuristic pattern matching used. Please verify stage mappings.',
  };
}
