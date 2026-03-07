import { useReducer, useCallback, useRef } from 'react';
import { getWorkspaceId, getAuthToken } from '../../lib/api';
import type { OperatorProgress } from './AgentChip';
import type { ToolCallEvent } from './AgentConversationFeed';
import type { ChartSpec } from '../shared/ChartRenderer';

interface BriefStreamState {
  phase: 'idle' | 'loading' | 'streaming' | 'complete';
  operators: OperatorProgress[];
  toolCalls: ToolCallEvent[];
  chartSpecs: ChartSpec[];
  brief: any | null;
  error: string | null;
}

type Action = { type: 'START' } | { type: 'EVENT'; event: any } | { type: 'RESET' };

const initial: BriefStreamState = {
  phase: 'idle',
  operators: [],
  toolCalls: [],
  chartSpecs: [],
  brief: null,
  error: null,
};

function reducer(state: BriefStreamState, action: Action): BriefStreamState {
  if (action.type === 'RESET') return initial;
  if (action.type === 'START')
    return { ...state, phase: 'loading', error: null };

  if (action.type === 'EVENT') {
    const ev = action.event;
    switch (ev.type) {
      case 'recruiting':
        return {
          ...state,
          phase: 'streaming',
          operators: [
            ...state.operators,
            {
              agent_id: ev.agent_id,
              agent_name: ev.agent_name,
              icon: ev.icon,
              color: ev.color,
              phase: 'recruiting',
            },
          ],
        };
      case 'agent_thinking':
        return {
          ...state,
          operators: state.operators.map((o) =>
            o.agent_id === ev.agent_id ? { ...o, phase: 'thinking' } : o
          ),
        };
      case 'tool_call':
        return {
          ...state,
          toolCalls: [
            ...state.toolCalls,
            {
              agent_id: ev.agent_id,
              tool_name: ev.tool_name,
              label: ev.label,
              ts: ev.ts,
            },
          ],
        };
      case 'agent_done':
        return {
          ...state,
          operators: state.operators.map((o) =>
            o.agent_id === ev.agent_id
              ? { ...o, phase: 'done', finding_preview: ev.finding?.summary }
              : o
          ),
        };
      case 'chart_specs':
        return { ...state, chartSpecs: ev.specs ?? [] };
      case 'brief_ready':
        return { ...state, brief: ev.brief };
      case 'done':
        return { ...state, phase: 'complete' };
      case 'error':
        return { ...state, error: ev.message, phase: 'complete' };
      default:
        return state;
    }
  }
  return state;
}

export function useBriefStream() {
  const [state, dispatch] = useReducer(reducer, initial);
  const abortRef = useRef<AbortController | null>(null);

  const loadBrief = useCallback(async (force = false) => {
    if (abortRef.current) abortRef.current.abort();
    abortRef.current = new AbortController();

    dispatch({ type: 'START' });

    const workspaceId = getWorkspaceId();
    const token = getAuthToken();

    try {
      const res = await fetch(
        `/api/workspaces/${workspaceId}/assistant/brief/stream`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ force }),
          signal: abortRef.current.signal,
        }
      );

      if (!res.ok || !res.body) {
        dispatch({
          type: 'EVENT',
          event: { type: 'error', message: `HTTP ${res.status}` },
        });
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const event = JSON.parse(line.slice(6));
              dispatch({ type: 'EVENT', event });
            } catch {}
          }
        }
      }
    } catch (err: any) {
      if (err?.name !== 'AbortError') {
        dispatch({
          type: 'EVENT',
          event: {
            type: 'error',
            message: err?.message || 'Unknown error',
          },
        });
      }
    }
  }, []);

  return {
    state,
    loadBrief,
    reset: () => dispatch({ type: 'RESET' }),
  };
}
