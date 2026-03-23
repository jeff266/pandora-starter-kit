import { z } from 'zod';
import type { McpTool } from './index.js';
import { runSkillWithAutoSave } from './skills/helpers.js';
import { maybeAutoSave } from './types.js';

const InputSchema = z.object({
  rep_email: z.string().optional(),
  save: z.boolean().optional().default(true),
  dimension_key: z.string().optional(),
});

export const getRepScorecard: McpTool = {
  name: 'get_rep_scorecard',
  description: [
    'Returns rep performance scorecard as a structured narrative.',
    'Includes QTD attainment, pipeline coverage, activity metrics,',
    'and deal velocity per rep. Optionally filter to a single rep by email.',
    'Uses the most recent rep-scorecard skill run (< 8 hours) or triggers a fresh one.',
  ].join(' '),
  inputSchema: {
    type: 'object',
    properties: {
      rep_email: {
        type: 'string',
        description: 'Filter to a specific rep by email (optional — returns all reps if omitted)',
      },
      save: {
        type: 'boolean',
        description: 'Auto-save findings to claude_insights (default: true)',
      },
      dimension_key: {
        type: 'string',
        description: 'Optional. Filter to a specific business dimension. Use list_dimensions to see available keys for this workspace. If omitted, uses the workspace default dimension.',
      },
    },
  },
  handler: async (args: any, workspaceId: string) => {
    const input = InputSchema.parse(args ?? {});

    const result = await runSkillWithAutoSave(
      workspaceId,
      'rep-scorecard',
      input.dimension_key ? { dimension_key: input.dimension_key } : {},
      false,
      'get_rep_scorecard'
    );

    const rawOutput = result.output;

    // rep-scorecard output is a plain markdown string stored
    // directly as JSONB string — not a structured object
    const narrative: string =
      typeof rawOutput === 'string'
        ? rawOutput
        : rawOutput?.narrative ?? rawOutput?.summary ?? result.narrative ?? '';

    // Filter narrative to the relevant rep section if rep_email provided
    let filteredNarrative = narrative;
    if (input.rep_email && narrative) {
      const lines = narrative.split('\n');
      const repSection: string[] = [];
      let inSection = false;

      for (const line of lines) {
        if (line.toLowerCase().includes(input.rep_email.toLowerCase())) {
          inSection = true;
        }
        if (inSection) {
          repSection.push(line);
          // Stop at next rep header that isn't this rep
          if (
            repSection.length > 3 &&
            line.startsWith('##') &&
            !line.toLowerCase().includes(input.rep_email.toLowerCase())
          ) {
            repSection.pop();
            break;
          }
        }
      }

      if (repSection.length > 0) {
        filteredNarrative = repSection.join('\n');
      }
    }

    if (input.save && narrative) {
      await maybeAutoSave(
        workspaceId,
        'rep-scorecard',
        narrative.slice(0, 1000),
        'rep',
        'info',
        'get_rep_scorecard'
      );
    }

    return {
      skill_id: 'rep-scorecard',
      run_id: result.run_id,
      narrative: filteredNarrative.slice(0, 3000),
      rep_email_filter: input.rep_email ?? null,
      saved: input.save && !!narrative,
      generated_at: new Date().toISOString(),
    };
  },
};
