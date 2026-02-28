import { useReducer, useCallback, useRef } from 'react';
import { getWorkspaceId, getAuthToken } from '../../lib/api';
import type { OperatorProgress } from './AgentChip';
import type { EvidenceCardData } from './EvidenceCard';
import type { RecommendedAction } from './ActionCard';
import type { DeliverableOption } from './DeliverablePicker';

export interface ConversationMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

export interface ConversationState {
  phase: 'idle' | 'recruiting' | 'findings' | 'synthesis' | 'complete';
  messages: ConversationMessage[];
  activeOperators: OperatorProgress[];
  synthesisText: string;
  synthesisComplete: boolean;
  evidenceCards: EvidenceCardData[];
  actions: RecommendedAction[];
  deliverableOptions: DeliverableOption[];
  error: string | null;
}

type Action =
  | { type: 'USER_MESSAGE'; text: string }
  | { type: 'STREAM_EVENT'; event: any }
  | { type: 'DISMISS_ACTION'; id: string }
  | { type: 'RESET' };

function makeId(): string {
  return Math.random().toString(36).slice(2);
}

const initial: ConversationState = {
  phase: 'idle',
  messages: [],
  activeOperators: [],
  synthesisText: '',
  synthesisComplete: false,
  evidenceCards: [],
  actions: [],
  deliverableOptions: [],
  error: null,
};

function reducer(state: ConversationState, action: Action): ConversationState {
  if (action.type === 'RESET') return { ...initial };
  if (action.type === 'DISMISS_ACTION') {
    return { ...state, actions: state.actions.filter(a => a.id !== action.id) };
  }
  if (action.type === 'USER_MESSAGE') {
    return {
      ...state,
      phase: 'recruiting',
      synthesisText: '',
      synthesisComplete: false,
      evidenceCards: [],
      actions: [],
      deliverableOptions: [],
      error: null,
      messages: [...state.messages, { id: makeId(), role: 'user', content: action.text, timestamp: Date.now() }],
    };
  }
  if (action.type === 'STREAM_EVENT') {
    const ev = action.event;
    switch (ev.type) {
      case 'recruiting': {
        const existing = state.activeOperators.find(o => o.agent_id === ev.agent_id);
        if (existing) return state;
        return {
          ...state, phase: 'recruiting',
          activeOperators: [...state.activeOperators, {
            agent_id: ev.agent_id, agent_name: ev.agent_name,
            icon: ev.icon, color: ev.color, phase: 'recruiting',
            skills: ev.skills,
          }],
        };
      }
      case 'agent_thinking': {
        return {
          ...state, phase: 'findings',
          activeOperators: state.activeOperators.map(o =>
            o.agent_id === ev.agent_id ? { ...o, phase: 'thinking' } : o
          ),
        };
      }
      case 'agent_found': {
        return {
          ...state,
          activeOperators: state.activeOperators.map(o =>
            o.agent_id === ev.agent_id ? { ...o, phase: 'found', finding_preview: ev.finding_preview } : o
          ),
        };
      }
      case 'agent_done': {
        return {
          ...state,
          activeOperators: state.activeOperators.map(o =>
            o.agent_id === ev.agent_id ? { ...o, phase: 'done', finding_preview: ev.finding?.summary } : o
          ),
        };
      }
      case 'synthesis_start': {
        return { ...state, phase: 'synthesis', synthesisText: '', synthesisComplete: false };
      }
      case 'synthesis_chunk': {
        return { ...state, synthesisText: state.synthesisText + ev.text };
      }
      case 'synthesis_done': {
        return {
          ...state,
          synthesisText: ev.full_text,
          synthesisComplete: true,
          messages: [...state.messages, { id: makeId(), role: 'assistant', content: ev.full_text, timestamp: Date.now() }],
        };
      }
      case 'evidence': {
        return { ...state, evidenceCards: ev.cards ?? [] };
      }
      case 'actions': {
        return { ...state, actions: ev.items ?? [] };
      }
      case 'deliverable_options': {
        return { ...state, deliverableOptions: ev.options ?? [] };
      }
      case 'error': {
        return { ...state, error: ev.message, phase: 'complete' };
      }
      case 'done': {
        return { ...state, phase: 'complete' };
      }
      default: return state;
    }
  }
  return state;
}

export function useConversationStream() {
  const [state, dispatch] = useReducer(reducer, initial);
  const abortRef = useRef<AbortController | null>(null);

  const sendMessage = useCallback(async (text: string) => {
    if (abortRef.current) abortRef.current.abort();
    abortRef.current = new AbortController();

    dispatch({ type: 'USER_MESSAGE', text });

    const workspaceId = getWorkspaceId();
    const token = getAuthToken();

    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/conversation/stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ message: text }),
        signal: abortRef.current.signal,
      });

      if (!res.ok || !res.body) {
        dispatch({ type: 'STREAM_EVENT', event: { type: 'error', message: `HTTP ${res.status}` } });
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
              dispatch({ type: 'STREAM_EVENT', event });
            } catch {
            }
          }
        }
      }
    } catch (err: any) {
      if (err?.name !== 'AbortError') {
        dispatch({ type: 'STREAM_EVENT', event: { type: 'error', message: err?.message ?? 'Stream error' } });
      }
    }
  }, []);

  const reset = useCallback(() => {
    if (abortRef.current) abortRef.current.abort();
    dispatch({ type: 'RESET' });
  }, []);

  const dismissAction = useCallback((id: string) => {
    dispatch({ type: 'DISMISS_ACTION', id });
  }, []);

  return { state, sendMessage, reset, dismissAction };
}
