import { useReducer, useCallback, useRef, useState } from 'react';
import { getWorkspaceId, getAuthToken } from '../../lib/api';
import type { OperatorProgress } from './AgentChip';
import type { EvidenceCardData } from './EvidenceCard';
import type { RecommendedAction } from './ActionCard';
import type { DeliverableOption } from './DeliverablePicker';
import type { ToolCallEvent } from './AgentConversationFeed';
import type { ChartSpec } from '../../types/chart-types';

export interface ConversationMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  response_id?: string;
}

export interface InlineAction {
  id: string;
  action_type: string;
  severity: 'critical' | 'warning' | 'info';
  title: string;
  summary: string;
  confidence: number;
  from_value: string | null;
  to_value: string | null;
  evidence: Array<{
    label: string;
    value: string;
    signal_type: string;
  }>;
  impact_label: string | null;
  urgency_label: string | null;
  created_at: string;
  deal_name?: string;
}

export interface ConversationState {
  phase: 'idle' | 'recruiting' | 'findings' | 'synthesis' | 'complete';
  messages: ConversationMessage[];
  activeOperators: OperatorProgress[];
  toolCalls: ToolCallEvent[];
  synthesisText: string;
  synthesisComplete: boolean;
  evidenceCards: EvidenceCardData[];
  actions: RecommendedAction[];
  inlineActions: InlineAction[];
  deliverableOptions: DeliverableOption[];
  chartSpecs: ChartSpec[];
  error: string | null;
  restored: boolean;
}

type Action =
  | { type: 'USER_MESSAGE'; text: string }
  | { type: 'STREAM_EVENT'; event: any }
  | { type: 'DISMISS_ACTION'; id: string }
  | { type: 'DISMISS_INLINE_ACTION'; id: string }
  | { type: 'INIT_MESSAGES'; messages: ConversationMessage[] }
  | { type: 'RESET' };

function makeId(): string {
  return Math.random().toString(36).slice(2);
}

const initial: ConversationState = {
  phase: 'idle',
  messages: [],
  activeOperators: [],
  toolCalls: [],
  synthesisText: '',
  synthesisComplete: false,
  evidenceCards: [],
  actions: [],
  inlineActions: [],
  deliverableOptions: [],
  chartSpecs: [],
  error: null,
  restored: false,
};

function reducer(state: ConversationState, action: Action): ConversationState {
  if (action.type === 'RESET') return { ...initial };
  if (action.type === 'INIT_MESSAGES') {
    if (action.messages.length === 0) return state;
    return { ...state, messages: action.messages, restored: true };
  }
  if (action.type === 'DISMISS_ACTION') {
    return { ...state, actions: state.actions.filter(a => a.id !== action.id) };
  }
  if (action.type === 'DISMISS_INLINE_ACTION') {
    return { ...state, inlineActions: state.inlineActions.filter(a => a.id !== action.id) };
  }
  if (action.type === 'USER_MESSAGE') {
    return {
      ...state,
      phase: 'recruiting',
      synthesisText: '',
      synthesisComplete: false,
      activeOperators: [],
      toolCalls: [],
      evidenceCards: [],
      actions: [],
      inlineActions: [],
      deliverableOptions: [],
      chartSpecs: [],
      error: null,
      restored: false,
      messages: [...state.messages, { id: makeId(), role: 'user', content: action.text, timestamp: Date.now() }],
    };
  }
  if (action.type === 'STREAM_EVENT') {
    const ev = action.event;
    switch (ev.type) {
      case 'tool_call': {
        return {
          ...state,
          toolCalls: [...state.toolCalls, {
            agent_id: ev.agent_id,
            tool_name: ev.tool_name,
            label: ev.label,
            ts: ev.ts ?? Date.now(),
          }],
        };
      }
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
          messages: [...state.messages, { id: makeId(), role: 'assistant', content: ev.full_text, timestamp: Date.now(), response_id: ev.response_id ?? undefined }],
        };
      }
      case 'evidence': {
        return { ...state, evidenceCards: ev.cards ?? [] };
      }
      case 'actions': {
        return { ...state, actions: ev.items ?? [] };
      }
      case 'inline_actions': {
        return { ...state, inlineActions: ev.items ?? [] };
      }
      case 'deliverable_options': {
        return { ...state, deliverableOptions: ev.options ?? [] };
      }
      case 'chart_specs': {
        return { ...state, chartSpecs: ev.specs ?? [] };
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

function storageKey(workspaceId: string): string {
  return `pandora_assistant_thread_${workspaceId}`;
}

export function useConversationStream() {
  const [state, dispatch] = useReducer(reducer, initial);
  const abortRef = useRef<AbortController | null>(null);
  const threadIdRef = useRef<string | null>(null);
  const [threadId, setThreadId] = useState<string | null>(null);

  const updateThreadId = useCallback((id: string) => {
    const workspaceId = getWorkspaceId();
    if (workspaceId) {
      localStorage.setItem(storageKey(workspaceId), id);
    }
    threadIdRef.current = id;
    setThreadId(id);
  }, []);

  const loadHistory = useCallback(async (workspaceId: string) => {
    const savedThreadId = localStorage.getItem(storageKey(workspaceId));
    if (!savedThreadId) return;

    const token = getAuthToken();
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/conversation/history/${savedThreadId}`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (!res.ok) return;
      const data = await res.json();
      if (data.messages && data.messages.length > 0) {
        const messages: ConversationMessage[] = data.messages.map((m: any) => ({
          id: makeId(),
          role: m.role as 'user' | 'assistant',
          content: m.content,
          timestamp: m.timestamp ? new Date(m.timestamp).getTime() : Date.now(),
        }));
        dispatch({ type: 'INIT_MESSAGES', messages });
        threadIdRef.current = savedThreadId;
        setThreadId(savedThreadId);
      }
    } catch {
    }
  }, []);

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
        body: JSON.stringify({
          message: text,
          thread_id: threadIdRef.current ?? undefined,
        }),
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
              if (event.type === 'done' && event.thread_id) {
                updateThreadId(event.thread_id);
              }
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
  }, [updateThreadId]);

  const reset = useCallback(() => {
    if (abortRef.current) abortRef.current.abort();
    dispatch({ type: 'RESET' });
  }, []);

  const startNewThread = useCallback(() => {
    const workspaceId = getWorkspaceId();
    if (workspaceId) {
      localStorage.removeItem(storageKey(workspaceId));
    }
    threadIdRef.current = null;
    setThreadId(null);
    if (abortRef.current) abortRef.current.abort();
    dispatch({ type: 'RESET' });
  }, []);

  const dismissAction = useCallback((id: string) => {
    dispatch({ type: 'DISMISS_ACTION', id });
  }, []);

  const dismissInlineAction = useCallback((id: string) => {
    dispatch({ type: 'DISMISS_INLINE_ACTION', id });
  }, []);

  return { state, sendMessage, reset, dismissAction, dismissInlineAction, threadId, loadHistory, startNewThread };
}
