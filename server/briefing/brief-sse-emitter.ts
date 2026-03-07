import { Response } from 'express';
import type { ChartSpec } from '../renderers/types.js';

export interface BriefSSEEmitter {
  toolCall(agentId: string, toolName: string, label: string): void;
  agentThinking(agentId: string): void;
  agentDone(agentId: string, summary?: string): void;
  chartSpec(spec: ChartSpec): void;
}

export function createBriefSSEEmitter(res: Response | null): BriefSSEEmitter {
  const charts: ChartSpec[] = [];

  function sse(event: any): void {
    if (!res || res.writableEnded) return;
    try {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
      // Flush if available (compression middleware adds flush method)
      if ((res as any).flush) {
        (res as any).flush();
      }
    } catch (err) {
      console.error('[brief-sse-emitter] Failed to write SSE event:', err);
    }
  }

  return {
    toolCall: (agentId, toolName, label) => {
      sse({
        type: 'tool_call',
        agent_id: agentId,
        tool_name: toolName,
        label,
        ts: Date.now(),
      });
    },

    agentThinking: (agentId) => {
      sse({
        type: 'agent_thinking',
        agent_id: agentId,
      });
    },

    agentDone: (agentId, summary) => {
      sse({
        type: 'agent_done',
        agent_id: agentId,
        finding: { agent_id: agentId, summary },
      });
    },

    chartSpec: (spec) => {
      charts.push(spec);
      sse({
        type: 'chart_specs',
        specs: charts,
      });
    },
  };
}

/**
 * No-op emitter for backward compatibility when no SSE response is available.
 * Used as default parameter in assembleBrief() to preserve existing behavior.
 */
export const NULL_EMITTER: BriefSSEEmitter = {
  toolCall: () => {},
  agentThinking: () => {},
  agentDone: () => {},
  chartSpec: () => {},
};
