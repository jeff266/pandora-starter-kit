import { query } from '../../db.js';
import type { McpTool } from './index.js';
import type { AssembledBrief } from '../../briefing/brief-types.js';

function briefToResponse(brief: AssembledBrief) {
  return {
    workspace_id: brief.workspace_id,
    generated_at: brief.generated_at ?? new Date().toISOString(),
    headline: brief.ai_blurbs?.key_action ?? null,
    narrative: brief.ai_blurbs?.overall_summary ?? brief.ai_blurbs?.pulse_summary ?? null,
    signals: brief.deals_to_watch?.items ?? [],
    actions: [],
    pipeline: brief.the_number ?? null,
    forecast: brief.the_number?.forecast ?? null,
  };
}

export const getConciergeBrief: McpTool = {
  name: 'get_concierge_brief',
  description: [
    'Returns the current Pandora daily brief — the same intelligence',
    'surface shown at the top of the Pandora app every morning.',
    'Includes pipeline signals, deal flags, forecast position,',
    'this-week actions, and key alerts. Uses the most recently',
    'assembled brief; no LLM call required.',
  ].join(' '),
  inputSchema: {
    type: 'object',
    properties: {},
  },
  handler: async (_args: any, workspaceId: string) => {
    const { getLatestBrief } = await import('../../briefing/brief-assembler.js');
    const brief = await getLatestBrief(workspaceId);

    if (!brief) {
      const { assembleLiveBrief } = await import('../../briefing/brief-assembler.js');
      const result = await assembleLiveBrief(workspaceId, 'user_request');
      if (result.brief) {
        return briefToResponse(result.brief);
      }
      return {
        workspace_id: workspaceId,
        generated_at: new Date().toISOString(),
        narrative: null,
        signals: [],
        actions: [],
      };
    }

    return briefToResponse(brief);
  },
};
