import { useReducer, useCallback, useRef, useState } from 'react';
import { getWorkspaceId, getAuthToken } from '../../lib/api';
import type { OperatorProgress } from './AgentChip';
import type { EvidenceCardData } from './EvidenceCard';
import type { RecommendedAction } from './ActionCard';
import type { DeliverableOption } from './DeliverablePicker';
import type { ToolCallEvent } from './AgentConversationFeed';
import type { ChartSpec } from '../../types/chart-types';
import type { SankeyChartData, WinningPathsData } from '../reports/types';

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

export interface EntityScope {
  entityType: 'deal';
  entityId: string;
  entityName: string;
}

export interface ToolProgress {
  iteration: number;
  tool_name: string;
  tool_display_name: string;
  status: 'running' | 'completed';
  result_summary: string;
  timestamp: string;
}

export interface SuggestedAction {
  id: string;
  type: string;
  title: string;
  description?: string;
  evidence?: string;
  priority: 'P1' | 'P2' | 'P3';
  deal_id?: string;
  execution_mode?: string;
}

export interface ConversationState {
  phase: 'idle' | 'recruiting' | 'findings' | 'synthesis' | 'complete' | 'clarifying';
  messages: ConversationMessage[];
  threadId: string | null;
  activeOperators: OperatorProgress[];
  toolCalls: ToolCallEvent[];
  synthesisText: string;
  synthesisComplete: boolean;
  evidenceCards: EvidenceCardData[];
  crossSignalFindings: any[];
  actions: RecommendedAction[];
  judgedActions: any[];
  inlineActions: InlineAction[];
  suggestedActions: SuggestedAction[];
  strategicAnalysis: any | null;
  deliverableOptions: DeliverableOption[];
  chartSpecs: ChartSpec[];
  responseChart: { spec: any; png_base64: string; suggested_section_id?: string } | null;
  pandoraResponse: any | null; // PandoraResponse from response-blocks.ts
  sankeyData: SankeyChartData | null;
  winningPathsData: WinningPathsData | null;
  error: string | null;
  restored: boolean;
  clarifyingQuestion: { question: string; dimension: string; options: { label: string; value: string }[] } | null;
  scope: EntityScope | null;
  planText: string | null;
  toolProgress: ToolProgress[];
  showProgress: boolean;
}

type Action =
  | { type: 'USER_MESSAGE'; text: string }
  | { type: 'STREAM_EVENT'; event: any }
  | { type: 'DISMISS_ACTION'; id: string }
  | { type: 'DISMISS_JUDGED_ACTION'; id: string }
  | { type: 'DISMISS_INLINE_ACTION'; id: string }
  | { type: 'DISMISS_SUGGESTED_ACTIONS' }
  | { type: 'INIT_MESSAGES'; messages: ConversationMessage[] }
  | { type: 'SET_SCOPE'; scope: EntityScope | null }
  | { type: 'RESET' };

function makeId(): string {
  return Math.random().toString(36).slice(2);
}

const initial: ConversationState = {
  phase: 'idle',
  messages: [],
  threadId: null,
  activeOperators: [],
  toolCalls: [],
  synthesisText: '',
  synthesisComplete: false,
  evidenceCards: [],
  crossSignalFindings: [],
  actions: [],
  judgedActions: [],
  inlineActions: [],
  suggestedActions: [],
  strategicAnalysis: null,
  deliverableOptions: [],
  chartSpecs: [],
  responseChart: null,
  pandoraResponse: null,
  sankeyData: null,
  winningPathsData: null,
  planText: null,
  toolProgress: [],
  showProgress: false,
  error: null,
  restored: false,
  clarifyingQuestion: null,
  scope: null,
};

function reducer(state: ConversationState, action: Action): ConversationState {
  if (action.type === 'RESET') return { ...initial };
  if (action.type === 'SET_SCOPE') {
    return { ...state, scope: action.scope };
  }
  if (action.type === 'INIT_MESSAGES') {
    if (action.messages.length === 0) return state;
    const workspaceId = getWorkspaceId();
    const savedThreadId = workspaceId ? localStorage.getItem(storageKey(workspaceId)) : null;
    return { ...state, messages: action.messages, threadId: savedThreadId, restored: true };
  }
  if (action.type === 'DISMISS_ACTION') {
    return { ...state, actions: state.actions.filter(a => a.id !== action.id) };
  }
  if (action.type === 'DISMISS_JUDGED_ACTION') {
    return { ...state, judgedActions: state.judgedActions.filter((_, i) => i !== (action as any).index) };
  }
  if (action.type === 'DISMISS_INLINE_ACTION') {
    return { ...state, inlineActions: state.inlineActions.filter(a => a.id !== action.id) };
  }
  if (action.type === 'DISMISS_SUGGESTED_ACTIONS') {
    return { ...state, suggestedActions: [] };
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
      crossSignalFindings: [],
      actions: [],
      inlineActions: [],
      suggestedActions: [],
      strategicAnalysis: null,
      deliverableOptions: [],
      chartSpecs: [],
      responseChart: null,
      pandoraResponse: null,
      sankeyData: null,
      winningPathsData: null,
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
      case 'cross_signal_findings': {
        return { ...state, crossSignalFindings: ev.findings ?? [] };
      }
      case 'actions': {
        return { ...state, actions: ev.items ?? [] };
      }
      case 'actions_judged': {
        return { ...state, judgedActions: ev.items ?? [] };
      }
      case 'inline_actions': {
        return { ...state, inlineActions: ev.items ?? [] };
      }
      case 'suggested_actions': {
        return { ...state, suggestedActions: ev.actions ?? [] };
      }
      case 'strategic_reasoning': {
        return { ...state, strategicAnalysis: ev.data };
      }
      case 'deliverable_options': {
        return { ...state, deliverableOptions: ev.options ?? [] };
      }
      case 'chart_specs': {
        return { ...state, chartSpecs: ev.specs ?? [] };
      }
      case 'response_chart': {
        return { ...state, responseChart: ev.chart ?? null };
      }
      case 'pandora_response': {
        return { ...state, pandoraResponse: ev.response ?? null };
      }
      case 'sankey_data': {
        return { ...state, sankeyData: ev.data ?? null };
      }
      case 'winning_paths_data': {
        return { ...state, winningPathsData: ev.data ?? null };
      }
      case 'plan': {
        return { ...state, planText: ev.plan ?? null };
      }
      case 'tool_progress': {
        const progressEntry: ToolProgress = {
          iteration: ev.data.iteration,
          tool_name: ev.data.tool_name,
          tool_display_name: ev.data.tool_display_name,
          status: ev.data.status,
          result_summary: ev.data.result_summary,
          timestamp: ev.data.timestamp,
        };
        return {
          ...state,
          toolProgress: [...state.toolProgress, progressEntry],
          showProgress: true,
        };
      }
      case 'synthesis_started': {
        return { ...state, showProgress: false };
      }
      case 'clarifying_question': {
        return {
          ...state,
          phase: 'clarifying',
          clarifyingQuestion: {
            question: ev.question,
            dimension: ev.dimension,
            options: ev.options
          }
        };
      }
      case 'error': {
        return { ...state, error: ev.message, phase: 'complete' };
      }
      case 'done': {
        return { ...state, phase: 'complete', threadId: ev.thread_id ?? state.threadId };
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
          scope: state.scope ?? undefined,
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
              if (event.type === 'suggested_actions' || event.type === 'done') {
                console.log('[stream] received event:', event.type, event.type === 'suggested_actions' ? 'count=' + (event.actions?.length ?? 0) : '');
              }
              if (event.type === 'done' && event.thread_id) {
                updateThreadId(event.thread_id);
              }
              dispatch({ type: 'STREAM_EVENT', event });
            } catch (parseErr) {
              const raw = line.slice(6);
              console.error('[stream] JSON parse error on event:', parseErr, 'raw (first 200):', raw.slice(0, 200));
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

  const dismissJudgedAction = useCallback((index: number) => {
    dispatch({ type: 'DISMISS_JUDGED_ACTION', index } as any);
  }, []);

  const dismissInlineAction = useCallback((id: string) => {
    dispatch({ type: 'DISMISS_INLINE_ACTION', id });
  }, []);

  const dismissSuggestedActions = useCallback(() => {
    dispatch({ type: 'DISMISS_SUGGESTED_ACTIONS' });
  }, []);

  const setScope = useCallback((scope: EntityScope | null) => {
    dispatch({ type: 'SET_SCOPE', scope });
  }, []);

  return { state, sendMessage, reset, dismissAction, dismissJudgedAction, dismissInlineAction, dismissSuggestedActions, threadId, loadHistory, startNewThread, setScope };
}
