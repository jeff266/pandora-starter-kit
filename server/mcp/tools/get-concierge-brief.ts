import { query } from '../../db.js';
import type { McpTool } from './index.js';

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
      const live = await assembleLiveBrief(workspaceId);
      return {
        workspace_id: workspaceId,
        generated_at: new Date().toISOString(),
        narrative: live.narrative ?? null,
        signals: live.signals ?? [],
        actions: live.actions ?? [],
      };
    }

    return {
      workspace_id: workspaceId,
      generated_at: (brief as any).generated_at ?? new Date().toISOString(),
      headline: (brief as any).headline ?? null,
      narrative: (brief as any).narrative ?? (brief as any).opening_narrative ?? null,
      signals: (brief as any).signals ?? [],
      actions: (brief as any).actions ?? (brief as any).action_items ?? [],
      pipeline: (brief as any).pipeline ?? null,
      forecast: (brief as any).forecast ?? null,
    };
  },
};
