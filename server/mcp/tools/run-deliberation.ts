import { z } from 'zod';
import type { McpTool } from './index.js';

const InputSchema = z.object({
  question: z.string().min(1),
  mode: z.enum(['bull_bear', 'boardroom', 'socratic', 'prosecutor_defense']),
  deal_id: z.string().uuid().optional(),
  context: z.string().optional().default(''),
});

export const runDeliberationTool: McpTool = {
  name: 'run_deliberation',
  description: [
    'Runs multi-perspective deliberation analysis on a question.',
    'Modes: bull_bear (deal risk vs upside — requires deal_id),',
    'boardroom (CEO/CFO/VP Sales perspectives on a strategic question),',
    'socratic (challenge an assumption with probing questions),',
    'prosecutor_defense (stress-test a plan from both sides).',
    'Use bull_bear for deal close probability and risk questions.',
    'Use boardroom for strategic decisions and resource allocation.',
    'Use socratic when examining a hypothesis or assumption.',
    'Use prosecutor_defense when evaluating a go/no-go plan.',
  ].join(' '),
  inputSchema: {
    type: 'object',
    required: ['question', 'mode'],
    properties: {
      question: {
        type: 'string',
        description: 'The question, claim, or plan to deliberate on',
      },
      mode: {
        type: 'string',
        enum: ['bull_bear', 'boardroom', 'socratic', 'prosecutor_defense'],
        description: 'Deliberation mode',
      },
      deal_id: {
        type: 'string',
        description: 'Deal UUID — required for bull_bear mode',
      },
      context: {
        type: 'string',
        description: 'Additional context to include in the deliberation',
      },
    },
  },
  handler: async (args: any, workspaceId: string) => {
    const input = InputSchema.parse(args);

    if (input.mode === 'bull_bear') {
      if (!input.deal_id) {
        throw new Error('deal_id (UUID) is required for bull_bear mode');
      }
      const { runDeliberation } = await import('../../chat/deliberation-engine.js');
      const result = await runDeliberation(workspaceId, input.deal_id, input.question, 'mcp');
      return { ...result, saved: true, save_location: 'deliberation_runs' };
    }

    if (input.mode === 'boardroom') {
      const { runBoardroomDeliberation } = await import('../../chat/deliberation-engine.js');
      const result = await runBoardroomDeliberation(workspaceId, input.question, input.context, 'mcp');
      return { ...result, saved: true, save_location: 'deliberation_runs' };
    }

    if (input.mode === 'socratic') {
      const { runSocraticDeliberation } = await import('../../chat/deliberation-engine.js');
      const result = await runSocraticDeliberation(workspaceId, input.question, input.context, 'mcp');
      return { ...result, saved: true, save_location: 'deliberation_runs' };
    }

    if (input.mode === 'prosecutor_defense') {
      const { runProsecutorDefenseDeliberation } = await import('../../chat/deliberation-engine.js');
      const result = await runProsecutorDefenseDeliberation(workspaceId, input.question, input.context, 'mcp');
      return { ...result, saved: true, save_location: 'deliberation_runs' };
    }

    throw new Error(`Unknown mode: ${input.mode}`);
  },
};
