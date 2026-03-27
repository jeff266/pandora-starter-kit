import { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useIsMobile } from '../hooks/useIsMobile';
import { api, getAuthToken } from '../lib/api';
import { useDemoMode } from '../contexts/DemoModeContext';
import { Icon } from './icons';
import ChartRenderer from './shared/ChartRenderer';
import type { ChartSpec } from './shared/ChartRenderer';
import ResponseEnvelopeRenderer from './shared/ResponseEnvelopeRenderer';
import DeliberationCard from './DeliberationCard';
import ChatDocBar from './ChatDocBar';
import SaveAsAgentBanner from './chat/SaveAsAgentBanner';
import AddToReportButton from './chat/AddToReportButton';
import RunBullBearButton from './chat/RunBullBearButton';
import { useSaveAsAgentTrigger } from '../hooks/useSaveAsAgentTrigger';
import SuggestedActionsPanel from './assistant/SuggestedActionsPanel';
import type { SuggestedAction } from './assistant/useConversationStream';
import { type ConciergeContext, formatConciergeContextPreamble } from '../types/concierge-context';
import { useCrmInfo } from '../lib/deeplinks';
import { PixelAvatarPandora } from './PixelAvatar';

interface ToolCall {
  tool: string;
  params: Record<string, any>;
  result: any;
  description: string;
  error?: string;
}

interface CitedRecord {
  type: string;
  id: string;
  name: string;
  key_fields: Record<string, any>;
}

interface Evidence {
  tool_calls: ToolCall[];
  cited_records: CitedRecord[];
  // Legacy loop fields — optional for backwards compat
  skill_evidence_used?: { skill_id: string; last_run_at: string; claims_referenced: number }[];
  loop_iterations?: number;
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  responseId?: string;
  feedbackEnabled?: boolean;
  evidence?: Evidence;
  tool_call_count?: number;
  latency_ms?: number;
  chart_specs?: ChartSpec[];
  response_chart?: { spec: any; png_base64: string; suggested_section_id?: string };
  deliberation?: any;
  pandora_response?: any; // PandoraResponse from response-blocks.ts
}

interface ChatScope {
  type: string;
  entity_id?: string;
  entity_name?: string;
  rep_email?: string;
}

interface ChatPanelProps {
  isOpen: boolean;
  onClose: () => void;
  scope?: ChatScope;
  initialSessionId?: string;
  pendingMessage?: string | null;
  onPendingMessageSent?: () => void;
  conciergeContext?: Record<string, unknown> | null;
  forceNewThread?: boolean;
  onForceNewThreadConsumed?: () => void;
  wbrContributions?: any[] | null;
  onWbrContributionsConsumed?: () => void;
  prefillInput?: string | null;
  onPrefillInputConsumed?: () => void;
}

interface ChatSessionPreview {
  id: string;
  title: string;
  created_at: string;
  last_message_at: string;
  message_count: number;
  user_name?: string;
  user_email?: string;
}

const CHAT_MIN_WIDTH = 380;
const CHAT_DEFAULT_WIDTH = 440;
const CHAT_TABLE_WIDTH = 720;
const CHAT_MAX_WIDTH = 900;
const CHAT_WIDTH_KEY = 'pandora_chat_width';

function getStoredWidth(): number {
  try {
    const v = sessionStorage.getItem(CHAT_WIDTH_KEY);
    if (v) {
      const n = parseInt(v, 10);
      if (n >= CHAT_MIN_WIDTH && n <= CHAT_MAX_WIDTH) return n;
    }
  } catch {}
  return CHAT_DEFAULT_WIDTH;
}

// Module-level navigate ref — populated by the component, used by the standalone formatInlineMarkdown function
let _navigateFn: ((to: string) => void) | undefined;
// Module-level HubSpot portal ID — populated from useCrmInfo hook, used by resolveLink
let _hubspotPortalId: number | null = null;

export default function ChatPanel({ isOpen, onClose, scope, initialSessionId, pendingMessage, onPendingMessageSent, conciergeContext, forceNewThread, onForceNewThreadConsumed, wbrContributions, onWbrContributionsConsumed, prefillInput, onPrefillInputConsumed }: ChatPanelProps) {
  const isMobile = useIsMobile();
  const navigate = useNavigate();
  _navigateFn = navigate;
  const { crmInfo } = useCrmInfo();
  _hubspotPortalId = crmInfo.portalId ?? null;
  const { anon } = useDemoMode();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatSuggestedActions, setChatSuggestedActions] = useState<SuggestedAction[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [feedbackMap, setFeedbackMap] = useState<Record<string, 'thumbs_up' | 'thumbs_down'>>({});
  const [hoveredMsgIdx, setHoveredMsgIdx] = useState<number | null>(null);
  const [isHistoryView, setIsHistoryView] = useState(false);
  const [sessions, setSessions] = useState<ChatSessionPreview[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const lastAssistantRef = useRef<HTMLDivElement>(null);
  const [exportingIdx, setExportingIdx] = useState<number | null>(null);
  const [exportDesc, setExportDesc] = useState('');
  const prevMessageCount = useRef(0);
  const [panelWidth, setPanelWidth] = useState(getStoredWidth);
  const isResizing = useRef(false);
  const resizeStartX = useRef(0);
  const resizeStartWidth = useRef(0);
  const [agentSaved, setAgentSaved] = useState(false);
  const [agentBannerDismissed, setAgentBannerDismissed] = useState(false);
  const [extractedAgentData, setExtractedAgentData] = useState<any>(null);
  const [extractionLoading, setExtractionLoading] = useState(false);
  const [navPendingOpen, setNavPendingOpen] = useState(false);
  const contextInjectedRef = useRef(false);

  useEffect(() => {
    if (forceNewThread && isOpen) {
      setMessages([]);
      setThreadId(null);
      setSessionId(null);
      setError(null);
      setInput('');
      setLoading(false);
      setIsHistoryView(false);
      contextInjectedRef.current = false;
      onForceNewThreadConsumed?.();
    }
  }, [forceNewThread, isOpen, onForceNewThreadConsumed]);

  useEffect(() => {
    if (conciergeContext && isOpen && !contextInjectedRef.current && messages.length === 0 && !threadId) {
      contextInjectedRef.current = true;
      const preamble = formatConciergeContextPreamble(conciergeContext as ConciergeContext);
      const systemMsg: ChatMessage = {
        role: 'assistant',
        content: `**Briefing context loaded**\n\n${preamble}`,
        timestamp: new Date().toISOString(),
      };
      setMessages([systemMsg]);
    }
  }, [conciergeContext, isOpen, messages.length, threadId]);

  useEffect(() => {
    if (!isOpen) {
      contextInjectedRef.current = false;
    }
  }, [isOpen]);

  const hasTableContent = messages.some(m => m.role === 'assistant' && m.content.split('\n').some(l => isTableRow(l)));

  useEffect(() => {
    if (hasTableContent) {
      setPanelWidth(prev => {
        if (prev < CHAT_TABLE_WIDTH) {
          try { sessionStorage.setItem(CHAT_WIDTH_KEY, String(CHAT_TABLE_WIDTH)); } catch {}
          return CHAT_TABLE_WIDTH;
        }
        return prev;
      });
    }
  }, [hasTableContent]);

  const activeMoveRef = useRef<((ev: MouseEvent) => void) | null>(null);
  const activeUpRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    return () => {
      if (activeMoveRef.current) document.removeEventListener('mousemove', activeMoveRef.current);
      if (activeUpRef.current) document.removeEventListener('mouseup', activeUpRef.current);
      isResizing.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, []);

  useEffect(() => {
    if (!isOpen && isResizing.current) {
      if (activeMoveRef.current) document.removeEventListener('mousemove', activeMoveRef.current);
      if (activeUpRef.current) document.removeEventListener('mouseup', activeUpRef.current);
      isResizing.current = false;
      activeMoveRef.current = null;
      activeUpRef.current = null;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }
  }, [isOpen]);

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    isResizing.current = true;
    resizeStartX.current = e.clientX;
    resizeStartWidth.current = panelWidth;

    const handleMouseMove = (ev: MouseEvent) => {
      if (!isResizing.current) return;
      const delta = resizeStartX.current - ev.clientX;
      const newWidth = Math.min(CHAT_MAX_WIDTH, Math.max(CHAT_MIN_WIDTH, resizeStartWidth.current + delta));
      setPanelWidth(newWidth);
    };

    const handleMouseUp = () => {
      isResizing.current = false;
      activeMoveRef.current = null;
      activeUpRef.current = null;
      setPanelWidth(w => {
        try { sessionStorage.setItem(CHAT_WIDTH_KEY, String(w)); } catch {}
        return w;
      });
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    activeMoveRef.current = handleMouseMove;
    activeUpRef.current = handleMouseUp;
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, [panelWidth]);

  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  useEffect(() => {
    const newCount = messages.length;
    const lastMsg = messages[newCount - 1];
    if (newCount > prevMessageCount.current && lastMsg?.role === 'assistant') {
      setTimeout(() => {
        lastAssistantRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 50);
    } else if (newCount > prevMessageCount.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
    prevMessageCount.current = newCount;
  }, [messages]);

  // Save-as-Agent CTA trigger detection
  const { shouldShow: agentBannerEligible } = useSaveAsAgentTrigger(
    messages,
    agentBannerDismissed,
    agentSaved,
  );
  const showAgentBanner = !isHistoryView && agentBannerEligible;

  // Auto-extract when banner first becomes eligible
  useEffect(() => {
    if (showAgentBanner && threadId && !extractedAgentData && !extractionLoading) {
      setExtractionLoading(true);
      api.post('/chat/extract-agent', { conversation_id: threadId })
        .then((data: any) => {
          setExtractedAgentData(data);
          // If user clicked "Save" while extraction was in flight, navigate now
          setNavPendingOpen(pending => {
            if (pending) {
              setAgentSaved(true);
              navigate('/agent-builder', { state: { chatPrefill: data, threadId } });
              return false;
            }
            return false;
          });
        })
        .catch(() => {})
        .finally(() => setExtractionLoading(false));
    }
  }, [showAgentBanner, threadId, extractedAgentData, extractionLoading]);


  const submitFeedback = async (responseId: string, signalType: 'thumbs_up' | 'thumbs_down') => {
    try {
      await api.post('/feedback', {
        targetType: 'chat_response',
        targetId: responseId,
        signalType,
        source: 'command_center',
      });
      setFeedbackMap(prev => ({ ...prev, [responseId]: signalType }));
    } catch (err) {
      console.error('Failed to submit feedback:', err);
    }
  };

  const loadSessions = async () => {
    setLoadingSessions(true);
    try {
      const data = await api.get('/chat/sessions?limit=50');
      setSessions(data.sessions || []);
    } catch (err) {
      console.error('Failed to load sessions:', err);
    } finally {
      setLoadingSessions(false);
    }
  };

  const stripChartBlocks = (text: string) =>
    text.replace(/```chart_spec[^\n]*\n[\s\S]*?```/g, '').trim();

  const loadSession = async (id: string) => {
    try {
      const data = await api.get(`/chat/sessions/${id}`);
      const mapped = data.messages.map((msg: any) => ({
        role: msg.role,
        content: stripChartBlocks(msg.content),
        timestamp: msg.created_at,
        responseId: msg.metadata?.response_id,
        feedbackEnabled: msg.metadata?.feedback_enabled,
        evidence: msg.metadata?.evidence,
        tool_call_count: msg.metadata?.tool_call_count,
        latency_ms: msg.metadata?.latency_ms,
        chart_specs: msg.metadata?.chart_specs,
        response_chart: msg.metadata?.chart,
        deliberation: msg.metadata?.deliberation,
      }));
      setMessages(mapped);
      setSessionId(id);
      setIsHistoryView(false);

      // Re-hydrate action cards from the last assistant message's saved suggested_actions
      const lastAssistant = [...data.messages].reverse().find((m: any) => m.role === 'assistant');
      const savedActions = lastAssistant?.metadata?.suggested_actions;
      if (savedActions && savedActions.length > 0) {
        setChatSuggestedActions(savedActions);
      } else {
        setChatSuggestedActions([]);
      }
    } catch (err) {
      console.error('Failed to load session:', err);
      setError('Failed to load conversation');
    }
  };

  const startNewChat = useCallback(() => {
    setMessages([]);
    setThreadId(null);
    setSessionId(null);
    setError(null);
    setInput('');
    setLoading(false);
    setIsHistoryView(false);
  }, []);

  const toggleHistoryView = () => {
    if (!isHistoryView) {
      loadSessions();
    }
    setIsHistoryView(!isHistoryView);
  };

  useEffect(() => {
    startNewChat();
  }, [scope?.type, scope?.entity_id, startNewChat]);

  useEffect(() => {
    if (isOpen && initialSessionId) {
      loadSession(initialSessionId);
    }
  }, [isOpen, initialSessionId]);

  useEffect(() => {
    if (isOpen && pendingMessage && !loading) {
      const t = setTimeout(() => {
        sendMessage(pendingMessage);
        onPendingMessageSent?.();
      }, 300);
      return () => clearTimeout(t);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, pendingMessage, loading]);

  useEffect(() => {
    if (isOpen && prefillInput) {
      setInput(prefillInput);
      onPrefillInputConsumed?.();
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen, prefillInput]);

  const sendMessage = async (overrideText?: string) => {
    const text = (overrideText || input).trim();
    if (!text || loading) return;

    setInput('');
    setError(null);

    const userMsg: ChatMessage = {
      role: 'user',
      content: text,
      timestamp: new Date().toISOString(),
    };
    setMessages(prev => [...prev, userMsg]);
    setChatSuggestedActions([]);
    setLoading(true);

    try {
      const body: any = { message: text };
      if (threadId) body.thread_id = threadId;
      if (sessionId) body.session_id = sessionId;
      if (scope && !threadId) body.scope = scope;
      if (conciergeContext) body.conciergeContext = conciergeContext;

      const result: any = await api.post('/chat', body);

      if (result.thread_id && !threadId) {
        setThreadId(result.thread_id);

        if (wbrContributions && wbrContributions.length > 0) {
          try {
            await api.post('/sessions/seed-wbr', {
              sessionId: `wbr-${Date.now()}`,
              threadId: result.thread_id,
              contributions: wbrContributions,
            });
          } catch (e) {
            console.warn('[ChatPanel] WBR seed failed:', e);
          }
          onWbrContributionsConsumed?.();
        }
      }

      if (result.session_id && !sessionId) {
        setSessionId(result.session_id);
      }

      const assistantMsg: ChatMessage = {
        role: 'assistant',
        content: result.answer,
        timestamp: new Date().toISOString(),
        responseId: result.response_id,
        feedbackEnabled: result.feedback_enabled,
        evidence: result.evidence,
        tool_call_count: result.tool_call_count,
        latency_ms: result.latency_ms,
        chart_specs: result.chart_specs,
        response_chart: result.chart,
        deliberation: result.deliberation,
      };
      setMessages(prev => [...prev, assistantMsg]);
      if (result.suggested_actions && result.suggested_actions.length > 0) {
        setChatSuggestedActions(result.suggested_actions);
      }
    } catch (err) {
      let msg = err instanceof Error ? err.message : 'Something went wrong';
      try {
        const parsed = JSON.parse(msg);
        msg = parsed.error || parsed.message || msg;
      } catch {}
      if (/limit|too many|rate/i.test(msg)) {
        msg = 'This conversation has reached its limit. Please start a new chat.';
      } else if (/^\{/.test(msg) || /^\[/.test(msg)) {
        msg = 'Something went wrong. Please try again in a moment.';
      }
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleExportAsDoc = (idx: number) => {
    if (exportingIdx === idx) {
      setExportingIdx(null);
      setExportDesc('');
      return;
    }
    setExportingIdx(idx);
    setExportDesc('');
  };

  const submitExport = (msgContent: string) => {
    const title = exportDesc.trim();
    const dateStr = new Date().toISOString().slice(0, 10);
    const safeTitle = title
      ? title.replace(/[^a-z0-9\s-]/gi, '').trim().replace(/\s+/g, '_').slice(0, 50)
      : `pandora_export_${dateStr}`;
    const filename = `${safeTitle}.md`;
    const content = title ? `# ${title}\n\n${msgContent}` : msgContent;

    const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    setExportingIdx(null);
    setExportDesc('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  if (!isOpen) return null;

  const scopeLabel = scope?.entity_name
    ? `About: ${scope.entity_name}`
    : scope?.type === 'pipeline' ? 'Pipeline Analysis'
    : scope?.type === 'rep' ? `Rep: ${scope.rep_email}`
    : 'Ask anything about your data';

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={{ ...styles.panel, ...(isMobile ? { width: '100%' } : { width: panelWidth }) }} onClick={e => e.stopPropagation()}>
        {!isMobile && (
          <div
            onMouseDown={handleResizeStart}
            style={{
              position: 'absolute', left: 0, top: 0, bottom: 0, width: 6,
              cursor: 'col-resize', zIndex: 10,
              background: 'transparent',
            }}
            onMouseEnter={e => (e.currentTarget.style.background = 'rgba(100,136,234,0.4)')}
            onMouseLeave={e => { if (!isResizing.current) e.currentTarget.style.background = 'transparent'; }}
          />
        )}
        <div style={{ ...styles.header, ...(isMobile ? { padding: '12px 14px' } : {}) }}>
          <div>
            <div style={styles.title}>{isHistoryView ? 'Past Conversations' : 'Ask Pandora'}</div>
            <div style={styles.scopeLabel}>{isHistoryView ? '' : scopeLabel}</div>
          </div>
          <div style={styles.headerActions}>
            {!isHistoryView && messages.length > 0 && (
              <button style={styles.newChatBtn} onClick={startNewChat}>New Chat</button>
            )}
            {!isHistoryView && (
              <button style={styles.historyBtn} onClick={toggleHistoryView} title="History">
                🕐
              </button>
            )}
            {isHistoryView && (
              <button style={styles.backBtn} onClick={() => setIsHistoryView(false)}>
                ← Back
              </button>
            )}
            <button style={styles.closeBtn} onClick={onClose}>×</button>
          </div>
        </div>

        <div ref={messagesContainerRef} style={{ ...styles.messagesContainer, ...(isMobile ? { padding: '12px 10px' } : {}) }}>
          {isHistoryView ? (
            <div style={styles.historyView}>
              {loadingSessions ? (
                <div style={styles.historyLoading}>Loading conversations...</div>
              ) : sessions.length === 0 ? (
                <div style={styles.historyEmpty}>
                  <div style={styles.emptyIcon}><Icon name="network" size={40} /></div>
                  <div style={styles.emptyTitle}>No conversations yet</div>
                  <div style={styles.emptyText}>Your chat history will appear here</div>
                </div>
              ) : (
                <>
                  {sessions.map((session) => (
                    <div
                      key={session.id}
                      style={styles.sessionRow}
                      onClick={() => loadSession(session.id)}
                    >
                      <div style={styles.sessionTitle}>{session.title}</div>
                      <div style={styles.sessionMeta}>
                        {session.user_name && (
                          <span style={styles.sessionUser}>{session.user_name} · </span>
                        )}
                        <span style={styles.sessionDate}>{formatSessionDate(session.last_message_at || session.created_at)}</span>
                      </div>
                    </div>
                  ))}
                </>
              )}
              <div style={styles.historyActions}>
                <button style={styles.newConversationBtn} onClick={startNewChat}>
                  + New Conversation
                </button>
              </div>
            </div>
          ) : (
            <>
              {messages.length === 0 && !loading && (
                <div style={styles.emptyState}>
                  <div style={styles.emptyIcon}><Icon name="network" size={40} /></div>
                  <div style={styles.emptyTitle}>Ask Pandora</div>
                  <div style={styles.emptyText}>
                    Ask about your pipeline, deals, reps, or any RevOps data.
                  </div>
                  <div style={{ ...styles.suggestions, ...(isMobile ? { maxWidth: '100%' } : {}) }}>
                    {getSuggestions(scope).map((s, i) => (
                      <button
                        key={i}
                        style={{ ...styles.suggestionBtn, ...(isMobile ? { whiteSpace: 'normal', wordBreak: 'break-word' } : {}) }}
                        onClick={() => { setInput(s); inputRef.current?.focus(); }}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              )}

          {messages.map((msg, idx) => {
            const isLastAssistant = msg.role === 'assistant' && idx === messages.length - 1;
            const isLongResponse = msg.role === 'assistant' && msg.content.length > 400;
            const alreadyHasDoc = msg.content.includes('/generated-docs/');
            return (
            <div
              key={idx}
              ref={isLastAssistant ? lastAssistantRef : undefined}
              style={{
                ...styles.messageBubble,
                ...(msg.role === 'user' ? styles.userBubble : styles.assistantBubble),
                ...(isMobile && msg.role === 'user' ? { marginLeft: 16 } : {}),
                ...(isMobile && msg.role === 'assistant' ? { marginRight: 16 } : {}),
              }}
              onMouseEnter={() => setHoveredMsgIdx(idx)}
              onMouseLeave={() => setHoveredMsgIdx(null)}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                {msg.role === 'assistant' && (
                  <PixelAvatarPandora size={20} borderRadius={4} />
                )}
                <span style={styles.messageRole}>
                  {msg.role === 'user' ? 'You' : 'Pandora'}
                </span>
              </div>
              <div style={styles.messageContent}>
                {formatMarkdown(anon.text(msg.content), msg.role === 'assistant' ? (text) => sendMessage(text) : undefined)}
              </div>
              {msg.role === 'assistant' && (() => {
                const choices = parseChoiceOptions(msg.content);
                if (!choices) return null;
                return (
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
                    {choices.map(choice => (
                      <button
                        key={choice.value}
                        onClick={() => sendMessage(`${choice.value}) ${choice.label}`)}
                        style={{
                          padding: '8px 14px',
                          minHeight: 44,
                          borderRadius: 20,
                          border: '1px solid rgba(20,184,166,0.4)',
                          background: 'rgba(20,184,166,0.08)',
                          color: '#14B8A6',
                          fontSize: 13,
                          cursor: 'pointer',
                          transition: 'all 150ms',
                          display: 'flex',
                          alignItems: 'center',
                        }}
                        onMouseEnter={e => { e.currentTarget.style.background = 'rgba(20,184,166,0.18)'; }}
                        onMouseLeave={e => { e.currentTarget.style.background = 'rgba(20,184,166,0.08)'; }}
                      >
                        <span style={{ fontWeight: 600, marginRight: 5 }}>{choice.value})</span>
                        {choice.label}
                      </button>
                    ))}
                  </div>
                );
              })()}
              {msg.role === 'assistant' && msg.evidence && msg.evidence.tool_calls.length > 0 && (
                <ChainOfThoughtPanel
                  evidence={msg.evidence}
                  latencyMs={msg.latency_ms}
                />
              )}
              {msg.role === 'assistant' && msg.evidence && msg.evidence.tool_calls.length > 0 && (
                <EvidencePanel
                  evidence={msg.evidence}
                  toolCallCount={msg.tool_call_count}
                  latencyMs={msg.latency_ms}
                />
              )}
              {msg.role === 'assistant' && msg.chart_specs && msg.chart_specs.length > 0 && (
                <div style={{ marginTop: 16 }}>
                  {msg.chart_specs.map((spec, i) => (
                    <div key={i} style={{ marginBottom: i < msg.chart_specs!.length - 1 ? 16 : 0 }}>
                      <ChartRenderer spec={spec} compact={false} />
                    </div>
                  ))}
                </div>
              )}
              {msg.role === 'assistant' && msg.response_chart && (
                <div style={{ marginTop: 12, paddingTop: 12, borderTop: '0.5px solid rgba(148,163,184,0.2)' }}>
                  <img
                    src={`data:image/png;base64,${msg.response_chart.png_base64}`}
                    alt={msg.response_chart.spec?.title || 'chart'}
                    style={{ width: '100%', maxWidth: 480, height: 'auto', borderRadius: 6, display: 'block', marginBottom: 8 }}
                  />
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 11, color: '#94a3b8', fontStyle: 'italic' }}>
                      {msg.response_chart.spec?.title}
                    </span>
                    <AddToReportButton chart={msg.response_chart} />
                  </div>
                </div>
              )}
              {msg.role === 'assistant' && msg.deliberation && (
                <DeliberationCard deliberation={msg.deliberation} />
              )}
              {msg.role === 'assistant' && msg.pandora_response && (
                <div style={{ marginTop: 12 }}>
                  <ResponseEnvelopeRenderer response={msg.pandora_response} />
                </div>
              )}
              {msg.role === 'assistant'
                && !msg.deliberation
                && scope?.entity_id
                && scope?.entity_name
                && !loading
                && msg === messages.filter(m => m.role === 'assistant').at(-1)
                && (
                <RunBullBearButton
                  entityName={scope.entity_name}
                  onRun={() => sendMessage(`Run a Bull/Bear analysis on ${scope.entity_name}`)}
                />
              )}
              {msg.role === 'assistant' && isLongResponse && !alreadyHasDoc && !loading && (
                <div style={{ marginTop: 10, borderTop: '1px solid #1e293b', paddingTop: 10 }}>
                  {exportingIdx === idx ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <div style={{ fontSize: 12, color: '#94a3b8' }}>
                        Document title (optional — leave blank to use date):
                      </div>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <input
                          type="text"
                          value={exportDesc}
                          onChange={e => setExportDesc(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); submitExport(msg.content); } }}
                          placeholder="e.g. QBR deck, executive summary..."
                          autoFocus
                          style={{
                            flex: 1,
                            background: '#0f172a',
                            border: '1px solid #2a3150',
                            borderRadius: 6,
                            padding: '6px 10px',
                            color: '#e2e8f0',
                            fontSize: 12,
                            outline: 'none',
                          }}
                        />
                        <button
                          onClick={() => submitExport(msg.content)}
                          style={{
                            padding: '6px 14px',
                            background: '#6488ea',
                            border: 'none',
                            borderRadius: 6,
                            color: '#fff',
                            fontSize: 12,
                            cursor: 'pointer',
                            fontWeight: 600,
                            whiteSpace: 'nowrap',
                          }}
                        >
                          ↓ Download
                        </button>
                        <button
                          onClick={() => { setExportingIdx(null); setExportDesc(''); }}
                          style={{
                            padding: '6px 10px',
                            background: 'transparent',
                            border: '1px solid #2a3150',
                            borderRadius: 6,
                            color: '#94a3b8',
                            fontSize: 12,
                            cursor: 'pointer',
                          }}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      onClick={() => handleExportAsDoc(idx)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        padding: '6px 14px',
                        background: 'rgba(100, 136, 234, 0.1)',
                        border: '1px solid rgba(100, 136, 234, 0.3)',
                        borderRadius: 6,
                        color: '#6488ea',
                        fontSize: 12,
                        cursor: 'pointer',
                        fontWeight: 500,
                      }}
                    >
                      Export as Document
                    </button>
                  )}
                </div>
              )}
              {msg.role === 'assistant' && msg.feedbackEnabled && msg.responseId && (
                <div style={{
                  display: 'flex',
                  gap: 4,
                  marginTop: 8,
                  opacity: hoveredMsgIdx === idx || feedbackMap[msg.responseId] ? 1 : 0,
                  transition: 'opacity 0.15s',
                }}>
                  <button
                    onClick={(e) => { e.stopPropagation(); submitFeedback(msg.responseId!, 'thumbs_up'); }}
                    style={{
                      padding: '2px 8px',
                      fontSize: 14,
                      background: feedbackMap[msg.responseId!] === 'thumbs_up' ? 'rgba(100, 136, 234, 0.15)' : 'transparent',
                      border: `1px solid ${feedbackMap[msg.responseId!] === 'thumbs_up' ? '#6488ea' : '#2a3150'}`,
                      borderRadius: 4,
                      cursor: 'pointer',
                      opacity: feedbackMap[msg.responseId!] === 'thumbs_down' ? 0.3 : 1,
                      color: '#94a3b8',
                    }}
                    title="Helpful response"
                  >
                    👍
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); submitFeedback(msg.responseId!, 'thumbs_down'); }}
                    style={{
                      padding: '2px 8px',
                      fontSize: 14,
                      background: feedbackMap[msg.responseId!] === 'thumbs_down' ? 'rgba(239, 68, 68, 0.15)' : 'transparent',
                      border: `1px solid ${feedbackMap[msg.responseId!] === 'thumbs_down' ? '#ef4444' : '#2a3150'}`,
                      borderRadius: 4,
                      cursor: 'pointer',
                      opacity: feedbackMap[msg.responseId!] === 'thumbs_up' ? 0.3 : 1,
                      color: '#94a3b8',
                    }}
                    title="Not helpful"
                  >
                    👎
                  </button>
                </div>
              )}
            </div>
          );
          })}

          {chatSuggestedActions.length > 0 && !loading && (
            <div style={{ padding: '0 16px 8px' }}>
              <SuggestedActionsPanel
                actions={chatSuggestedActions}
                onDismissAll={() => setChatSuggestedActions([])}
              />
            </div>
          )}

          {loading && <ThinkingBubble query={messages[messages.length - 1]?.content || ''} />}

              {error && (
                <div style={styles.errorMsg}>{error}</div>
              )}

              <div ref={messagesEndRef} />
            </>
          )}
        </div>

        {!isHistoryView && <ChatDocBar threadId={threadId} />}

        {showAgentBanner && (
          <SaveAsAgentBanner
            suggestedName={extractedAgentData?.suggested_name}
            isLoading={extractionLoading}
            onSave={() => {
              if (extractedAgentData) {
                setAgentSaved(true);
                navigate('/agent-builder', { state: { chatPrefill: extractedAgentData, threadId } });
              } else {
                // Extraction still in flight — navigate as soon as it lands
                setNavPendingOpen(true);
              }
            }}
            onDismiss={() => setAgentBannerDismissed(true)}
          />
        )}

        {!isHistoryView && (
          <div style={{
            ...styles.inputContainer,
            ...(isMobile ? { paddingTop: 10, paddingLeft: 10, paddingRight: 10 } : {}),
            paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 16px)' as unknown as number,
          }}>
            <textarea
              ref={inputRef}
              style={styles.input}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask a question..."
              rows={1}
              disabled={loading}
            />
            <button
              style={{
                ...styles.sendBtn,
                ...((!input.trim() || loading) ? styles.sendBtnDisabled : {}),
              }}
              onClick={() => sendMessage()}
              disabled={!input.trim() || loading}
            >
              →
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Thinking Bubble (Expanded Chain of Thought) ─────────────────────────────

interface ThinkingStep {
  label: string;
  icon: string;
  delay: number;
}

function getThinkingSteps(query: string): ThinkingStep[] {
  const q = query.toLowerCase();

  if (/pipeline|forecast|close|quarter|revenue/i.test(q)) {
    return [
      { label: 'Analyzing query intent...', icon: '🔮', delay: 200 },
      { label: 'Querying deals database...', icon: '💼', delay: 800 },
      { label: 'Computing pipeline metrics...', icon: '📊', delay: 1600 },
      { label: 'Aggregating by stage & owner...', icon: '🎯', delay: 2400 },
      { label: 'Generating insights...', icon: '✨', delay: 3200 },
    ];
  }

  if (/risk|stall|dark|churn|lose/i.test(q)) {
    return [
      { label: 'Analyzing query intent...', icon: '🔮', delay: 200 },
      { label: 'Scanning deal activity...', icon: '⚡', delay: 800 },
      { label: 'Detecting risk signals...', icon: '⚠️', delay: 1600 },
      { label: 'Scoring engagement levels...', icon: '📈', delay: 2400 },
      { label: 'Synthesizing recommendations...', icon: '💡', delay: 3200 },
    ];
  }

  if (/call|conversation|meeting|transcript/i.test(q)) {
    return [
      { label: 'Analyzing query intent...', icon: '🔮', delay: 200 },
      { label: 'Querying conversation database...', icon: '💬', delay: 800 },
      { label: 'Analyzing transcript content...', icon: '📝', delay: 1600 },
      { label: 'Extracting key topics...', icon: '🔍', delay: 2400 },
      { label: 'Generating summary...', icon: '✨', delay: 3200 },
    ];
  }

  if (/contact|stakeholder|champion|buyer/i.test(q)) {
    return [
      { label: 'Analyzing query intent...', icon: '🔮', delay: 200 },
      { label: 'Querying contacts database...', icon: '👥', delay: 800 },
      { label: 'Analyzing engagement patterns...', icon: '📊', delay: 1600 },
      { label: 'Mapping stakeholder roles...', icon: '🎭', delay: 2400 },
      { label: 'Generating insights...', icon: '✨', delay: 3200 },
    ];
  }

  // Default generic steps
  return [
    { label: 'Analyzing query intent...', icon: '🔮', delay: 200 },
    { label: 'Searching relevant data...', icon: '🔍', delay: 800 },
    { label: 'Computing metrics...', icon: '📊', delay: 1600 },
    { label: 'Synthesizing answer...', icon: '✨', delay: 2400 },
  ];
}

function ThinkingBubble({ query }: { query: string }) {
  const [visibleSteps, setVisibleSteps] = useState<number>(0);
  const steps = getThinkingSteps(query);

  useEffect(() => {
    const timers: NodeJS.Timeout[] = [];
    steps.forEach((step, i) => {
      const timer = setTimeout(() => {
        setVisibleSteps(i + 1);
      }, step.delay);
      timers.push(timer);
    });

    return () => timers.forEach(clearTimeout);
  }, [query]);

  return (
    <div style={{ ...styles.messageBubble, ...styles.assistantBubble }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
        <PixelAvatarPandora size={20} borderRadius={4} />
        <span style={styles.messageRole}>Pandora</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {steps.slice(0, visibleSteps).map((step, i) => (
          <div
            key={i}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              opacity: 0,
              animation: 'fadeInStep 0.3s ease forwards',
              animationDelay: '0.05s',
            }}
          >
            <div style={{
              width: 28,
              height: 28,
              borderRadius: '50%',
              background: 'rgba(100, 136, 234, 0.15)',
              border: '1px solid rgba(100, 136, 234, 0.3)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 14,
              flexShrink: 0,
            }}>
              {step.icon}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{
                fontSize: 13,
                color: '#cbd5e1',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}>
                {step.label}
                {i === visibleSteps - 1 && (
                  <div style={{ display: 'flex', gap: 3, marginLeft: 4 }}>
                    <span style={{ ...styles.dot }}>●</span>
                    <span style={{ ...styles.dot, animationDelay: '0.2s' }}>●</span>
                    <span style={{ ...styles.dot, animationDelay: '0.4s' }}>●</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Chain of Thought hover panel ────────────────────────────────────────────

function formatCompactParams(params: Record<string, any>): string {
  return Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== false)
    .slice(0, 3)
    .map(([k, v]) => {
      const val = typeof v === 'string'
        ? (v.length > 24 ? v.slice(0, 24) + '…' : v)
        : Array.isArray(v) ? v.join(',') : String(v);
      return `${k}: ${val}`;
    })
    .join('  ');
}

function summarizeResult(toolName: string, result: any): string {
  if (!result) return 'no data';
  if (result.error) return `error`;
  switch (toolName) {
    case 'query_deals':
      return `${result.total_count ?? result.deals?.length ?? 0} deals · ${formatAmount(result.total_amount)}`;
    case 'query_conversations':
      return `${result.total_count ?? result.conversations?.length ?? 0} calls`;
    case 'compute_metric':
      return result.formatted || 'computed';
    case 'get_skill_evidence':
      return result ? `${result.claim_count || 0} findings` : 'no data';
    case 'query_contacts':
      return `${result.total_count ?? result.contacts?.length ?? 0} contacts`;
    case 'query_activity_timeline':
      return `${result.total_count ?? result.events?.length ?? 0} events`;
    case 'query_accounts':
      return `${result.total_count ?? result.accounts?.length ?? 0} accounts`;
    default:
      return 'done';
  }
}

function ChainOfThoughtPanel({ evidence, latencyMs }: {
  evidence?: Evidence;
  latencyMs?: number;
}) {
  const [open, setOpen] = useState(false);
  const toolCalls = evidence?.tool_calls || [];
  const hasTools = toolCalls.length > 0;

  if (!hasTools) return null;

  return (
    <div style={{
      marginTop: 10,
      borderTop: '1px solid rgba(100, 136, 234, 0.2)',
      paddingTop: 10,
      background: 'rgba(100, 136, 234, 0.05)',
      borderRadius: '0 0 8px 8px',
      marginLeft: -14,
      marginRight: -14,
      marginBottom: -10,
      paddingLeft: 14,
      paddingRight: 14,
      paddingBottom: open ? 10 : 0,
    }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          padding: 0,
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          marginBottom: open && hasTools ? 8 : 0,
          paddingBottom: open ? 0 : 10,
        }}
      >
        <Icon name="filter" size={12} style={{ filter: 'brightness(0) saturate(100%) invert(47%) sepia(68%) saturate(1869%) hue-rotate(204deg) brightness(96%) contrast(94%)' }} />
        <span style={{
          fontSize: 11,
          color: '#6488ea',
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: '0.5px',
        }}>
          Show the Math
        </span>
        <span style={{ fontSize: 10, color: '#64748b' }}>
          ({toolCalls.length} step{toolCalls.length !== 1 ? 's' : ''})
        </span>
        <span style={{ fontSize: 10, color: '#6488ea', marginLeft: 2 }}>{open ? '▼' : '▶'}</span>
        {latencyMs != null && (
          <span style={{
            marginLeft: 'auto',
            fontSize: 10,
            color: '#64748b',
            fontWeight: 400,
            textTransform: 'none',
            letterSpacing: 'normal',
          }}>
            {(latencyMs / 1000).toFixed(1)}s
          </span>
        )}
      </button>
      {open && toolCalls.map((tc, i) => (
        <div key={i} style={{
          display: 'flex',
          gap: 8,
          marginBottom: 8,
          alignItems: 'flex-start',
          background: 'rgba(0, 0, 0, 0.2)',
          padding: '8px 10px',
          borderRadius: 6,
          border: '1px solid rgba(100, 136, 234, 0.15)',
        }}>
          <div style={{
            width: 24,
            height: 24,
            borderRadius: '50%',
            background: 'rgba(100, 136, 234, 0.2)',
            border: '1px solid rgba(100, 136, 234, 0.3)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            marginTop: 2,
          }}>
            <Icon name={(TOOL_ICONS[tc.tool] || 'filter') as any} size={12} style={{ filter: 'brightness(0) saturate(100%) invert(47%) sepia(68%) saturate(1869%) hue-rotate(204deg) brightness(96%) contrast(94%)' }} />
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
              <span style={{ color: '#6488ea', fontSize: 12, fontWeight: 600 }}>{tc.tool}</span>
              <span style={{
                fontSize: 9,
                color: '#64748b',
                background: 'rgba(100, 136, 234, 0.1)',
                padding: '2px 6px',
                borderRadius: 4,
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
              }}>
                Step {i + 1}
              </span>
            </div>
            {Object.keys(tc.params || {}).length > 0 && (
              <div style={{
                color: '#94a3b8',
                fontSize: 11,
                marginBottom: 4,
                fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
              }}>
                {formatCompactParams(tc.params)}
              </div>
            )}
            <div style={{
              color: tc.error ? '#ef4444' : '#cbd5e1',
              fontSize: 12,
              display: 'flex',
              alignItems: 'center',
              gap: 4,
            }}>
              <span style={{ color: '#6488ea' }}>→</span>
              {tc.error ? `Failed: ${tc.error}` : summarizeResult(tc.tool, tc.result)}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Evidence Panel ───────────────────────────────────────────────────────────

function formatAmount(v: any): string {
  const n = Number(v);
  if (isNaN(n) || !v) return '';
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toLocaleString()}`;
}

const TOOL_ICONS: Record<string, string> = {
  query_deals: 'chart-growth',
  query_accounts: 'building',
  query_conversations: 'network',
  get_skill_evidence: 'target',
  compute_metric: 'trending',
  query_contacts: 'connections',
  query_activity_timeline: 'flow',
};

function CollapsibleDeals({ deals, totalCount, totalAmount }: { deals: any[]; totalCount: number; totalAmount: number }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div style={{ marginTop: 4 }}>
      <button
        onClick={() => setExpanded(!expanded)}
        style={{
          background: 'none',
          border: '1px solid #1e2230',
          borderRadius: 4,
          color: '#6488ea',
          cursor: 'pointer',
          padding: '3px 8px',
          fontSize: 11,
          display: 'flex',
          alignItems: 'center',
          gap: 4,
        }}
      >
        <span style={{ fontSize: 10 }}>{expanded ? '▼' : '▶'}</span>
        {expanded ? 'Hide' : 'View'} deals ({totalCount} deals · {formatAmount(totalAmount)})
      </button>
      {expanded && (
        <div style={{ overflowX: 'auto', marginTop: 4 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #1e2230' }}>
                {['Deal', 'Amount', 'Stage', 'Close', 'Owner'].map(h => (
                  <th key={h} style={{ textAlign: 'left', padding: '3px 6px', color: '#64748b', fontWeight: 500 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {deals.slice(0, 15).map((d: any, di: number) => (
                <tr key={di} style={{ borderBottom: '1px solid #1a1f30' }}>
                  <td style={{ padding: '3px 6px', color: '#e2e8f0', maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.name}</td>
                  <td style={{ padding: '3px 6px', color: '#94a3b8' }}>{formatAmount(d.amount)}</td>
                  <td style={{ padding: '3px 6px', color: '#94a3b8' }}>{d.stage || '—'}</td>
                  <td style={{ padding: '3px 6px', color: '#94a3b8' }}>{d.close_date?.slice(0, 10) || '—'}</td>
                  <td style={{ padding: '3px 6px', color: '#94a3b8', maxWidth: 80, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.owner_name || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {deals.length > 15 && (
            <div style={{ color: '#64748b', fontSize: 11, marginTop: 4, paddingLeft: 6 }}>
              +{deals.length - 15} more deals not shown
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function EvidencePanel({ evidence, toolCallCount, latencyMs }: {
  evidence: Evidence;
  toolCallCount?: number;
  latencyMs?: number;
}) {
  const [open, setOpen] = useState(false);

  const totalToolCalls = evidence.tool_calls.length;
  const totalRecords = evidence.cited_records.length;

  const latencyLabel = latencyMs != null
    ? `${(latencyMs / 1000).toFixed(1)}s`
    : null;

  const summaryParts = [
    `${totalToolCalls} tool call${totalToolCalls !== 1 ? 's' : ''}`,
    totalRecords > 0 ? `${totalRecords} record${totalRecords !== 1 ? 's' : ''}` : null,
    latencyLabel,
  ].filter(Boolean);
  const summaryLabel = summaryParts.join(' · ');

  return (
    <div style={{ marginTop: 8 }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          background: 'transparent',
          border: 'none',
          color: '#6488ea',
          fontSize: 12,
          cursor: 'pointer',
          padding: '2px 0',
          display: 'flex',
          alignItems: 'center',
          gap: 4,
        }}
      >
        <span style={{ fontSize: 10 }}>{open ? '▼' : '▶'}</span>
        Show work ({summaryLabel})
      </button>

      {open && (
        <div style={{
          marginTop: 8,
          padding: '10px 12px',
          backgroundColor: '#0d101a',
          borderRadius: 6,
          border: '1px solid #1e2230',
          fontSize: 12,
          color: '#94a3b8',
        }}>
          {evidence.tool_calls.map((tc, i) => (
            <div key={i} style={{ marginBottom: 12 }}>
              <div style={{ color: '#6488ea', fontWeight: 600, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
                <Icon name={(TOOL_ICONS[tc.tool] || 'filter') as any} size={14} style={{ filter: 'brightness(0) saturate(100%) invert(47%) sepia(68%) saturate(1869%) hue-rotate(204deg) brightness(96%) contrast(94%)' }} />
                {tc.tool}
                {tc.error && <span style={{ color: '#ef4444', marginLeft: 8 }}>FAILED</span>}
              </div>
              <div style={{ color: '#64748b', marginBottom: 4, fontSize: 11 }}>
                → {tc.description}
              </div>

              {/* Render deal table if result has deals */}
              {tc.result?.deals && tc.result.deals.length > 0 && (
                <CollapsibleDeals deals={tc.result.deals} totalCount={tc.result.total_count} totalAmount={tc.result.total_amount} />
              )}

              {/* Render compute_metric result */}
              {tc.result?.formula && (
                <div style={{ marginTop: 4, padding: '6px 8px', backgroundColor: '#161926', borderRadius: 4 }}>
                  <div style={{ color: '#e2e8f0', fontWeight: 600, marginBottom: 2 }}>{tc.result.formatted}</div>
                  <div style={{ color: '#64748b', fontFamily: 'monospace', fontSize: 11 }}>{tc.result.formula}</div>
                </div>
              )}

              {/* Render skill evidence findings */}
              {tc.result?.claims && tc.result.claims.length > 0 && (
                <div style={{ marginTop: 4 }}>
                  {tc.result.claims.slice(0, 8).map((c: any, ci: number) => (
                    <div key={ci} style={{
                      display: 'flex',
                      gap: 6,
                      marginBottom: 3,
                      padding: '3px 6px',
                      backgroundColor: '#161926',
                      borderRadius: 3,
                    }}>
                      <span style={{
                        color: c.severity === 'act' ? '#ef4444' : c.severity === 'watch' ? '#f59e0b' : '#6488ea',
                        fontSize: 10,
                        flexShrink: 0,
                        marginTop: 1,
                        display: 'inline-flex',
                        alignItems: 'center',
                      }}>
                        {c.severity === 'act' ? <Icon name="target" size={10} style={{ filter: 'brightness(0) saturate(100%) invert(36%) sepia(95%) saturate(3186%) hue-rotate(346deg) brightness(95%) contrast(92%)' }} /> : c.severity === 'watch' ? '●' : 'ℹ'}
                      </span>
                      <span style={{ color: '#94a3b8' }}>
                        {c.entity_name && <strong style={{ color: '#cbd5e1' }}>{c.entity_name}: </strong>}
                        {c.message}
                      </span>
                    </div>
                  ))}
                  {tc.result.claims.length > 8 && (
                    <div style={{ color: '#64748b', fontSize: 11, paddingLeft: 6 }}>+{tc.result.claims.length - 8} more findings</div>
                  )}
                </div>
              )}

              {/* Render conversations */}
              {tc.result?.conversations && tc.result.conversations.length > 0 && (
                <div style={{ marginTop: 4 }}>
                  {tc.result.conversations.slice(0, 8).map((c: any, ci: number) => (
                    <div key={ci} style={{ marginBottom: 3, padding: '3px 6px', backgroundColor: '#161926', borderRadius: 3 }}>
                      <span style={{ color: '#cbd5e1' }}>{c.title || 'Untitled'}</span>
                      <span style={{ color: '#64748b', marginLeft: 6 }}>
                        {c.date?.slice(0, 10)} {c.account_name ? `· ${c.account_name}` : ''} {c.duration_minutes ? `· ${c.duration_minutes}m` : ''}
                      </span>
                    </div>
                  ))}
                  <div style={{ color: '#64748b', fontSize: 11, paddingLeft: 6, marginTop: 2 }}>
                    {tc.result.total_count} total · {tc.result.summary_coverage}% have summaries
                  </div>
                </div>
              )}

              {/* Error message */}
              {tc.error && (
                <div style={{ color: '#ef4444', fontSize: 11, marginTop: 4 }}>Error: {tc.error}</div>
              )}
            </div>
          ))}

          {evidence.skill_evidence_used && evidence.skill_evidence_used.length > 0 && (
            <div style={{ borderTop: '1px solid #1e2230', paddingTop: 8, marginTop: 4 }}>
              <div style={{ color: '#6488ea', fontWeight: 600, marginBottom: 4 }}>Skills referenced:</div>
              {evidence.skill_evidence_used.map((s, i) => (
                <div key={i} style={{ color: '#64748b', fontSize: 11 }}>
                  {s.skill_id} · {s.claims_referenced} findings · ran {s.last_run_at?.slice(0, 16) || 'unknown'}
                </div>
              ))}
            </div>
          )}

          <div style={{ borderTop: '1px solid #1e2230', paddingTop: 6, marginTop: 6, color: '#64748b', fontSize: 11 }}>
            {totalToolCalls} tool call{totalToolCalls !== 1 ? 's' : ''}{latencyMs != null ? ` · ${(latencyMs / 1000).toFixed(1)}s` : ''}
          </div>
        </div>
      )}
    </div>
  );
}

function parseChoiceOptions(text: string): Array<{ label: string; value: string }> | null {
  const lines = text.split('\n');
  const choices: Array<{ label: string; value: string }> = [];

  for (const line of lines) {
    const match = line.match(/^\s*([A-C])\)\s+(.+)$/);
    if (match) {
      choices.push({ label: match[2].trim(), value: match[1] });
    }
  }

  return choices.length >= 2 ? choices : null;
}

function getSuggestions(scope?: ChatScope): string[] {
  if (scope?.type === 'deal') {
    return [
      'What are the main risks for this deal?',
      'Who are the key contacts?',
      'What should the next steps be?',
    ];
  }
  if (scope?.type === 'account') {
    return [
      'How is our relationship with this account?',
      'What deals are in play?',
      'Are there any coverage gaps?',
    ];
  }
  return [
    "What's our pipeline looking like?",
    'Which deals are at risk?',
    'How are reps tracking against quota?',
    'What changed this week?',
  ];
}

function formatSessionDate(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays} days ago`;

  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function isTableRow(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.startsWith('|') && trimmed.endsWith('|') && trimmed.includes(' | ');
}

function isSeparatorRow(line: string): boolean {
  return /^\|[\s\-:|]+\|$/.test(line.trim());
}

function parseTableCells(line: string): string[] {
  const trimmed = line.trim();
  const inner = trimmed.startsWith('|') ? trimmed.slice(1) : trimmed;
  const cleaned = inner.endsWith('|') ? inner.slice(0, -1) : inner;
  return cleaned.split('|').map(c => c.trim());
}

const STAGE_MAP_OPTIONS = [
  { key: 'prospecting',  label: 'Prospecting' },
  { key: 'qualification', label: 'Qualification' },
  { key: 'demo',        label: 'Demo' },
  { key: 'evaluation',  label: 'Evaluation' },
  { key: 'proposal',    label: 'Proposal' },
  { key: 'negotiation', label: 'Negotiation' },
  { key: 'closed_won',  label: 'Closed Won' },
  { key: 'closed_lost', label: 'Closed Lost' },
];

function renderStageMappingTable(
  headers: string[],
  rows: string[][],
  keyBase: number,
  onSend: (msg: string) => void
): React.ReactElement {
  const thStyle: React.CSSProperties = {
    padding: '8px 12px', textAlign: 'left', fontWeight: 600, fontSize: 11,
    textTransform: 'uppercase', letterSpacing: '0.05em',
    color: '#94a3b8', background: 'rgba(30, 41, 59, 0.8)',
    borderBottom: '1px solid rgba(148, 163, 184, 0.15)', whiteSpace: 'nowrap',
  };
  const tdStyle: React.CSSProperties = {
    padding: '6px 12px', color: '#e2e8f0',
    borderBottom: '1px solid rgba(148, 163, 184, 0.08)', whiteSpace: 'nowrap',
  };

  return (
    <div key={`stgmap-${keyBase}`}>
      <div style={{ overflowX: 'auto', margin: '8px 0', borderRadius: 8, border: '1px solid rgba(148, 163, 184, 0.15)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, fontFamily: "'Inter', sans-serif" }}>
          <thead>
            <tr>
              {headers.map((h, ci) => (
                <th key={ci} style={thStyle}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((cells, ri) => {
              const stageName  = cells[0] ?? '';
              const pipeline   = cells[1] ?? '';
              const guessLabel = cells[2] ?? '';
              const deals      = cells[3] ?? '';
              const value      = cells[4] ?? '';
              const defaultKey = STAGE_MAP_OPTIONS.find(o => o.label === guessLabel)?.key ?? '';

              return (
                <tr key={ri} style={{ background: ri % 2 === 0 ? 'transparent' : 'rgba(30, 41, 59, 0.3)' }}>
                  <td style={tdStyle}>{stageName}</td>
                  <td style={{ ...tdStyle, color: '#94a3b8', fontSize: 12 }}>{pipeline}</td>
                  <td style={tdStyle}>
                    <select
                      defaultValue={defaultKey}
                      onChange={(e) => {
                        const key = e.target.value;
                        const label = STAGE_MAP_OPTIONS.find(o => o.key === key)?.label ?? key;
                        onSend(`${stageName} is actually ${label}`);
                      }}
                      style={{
                        background: 'rgba(30, 41, 59, 0.9)',
                        color: '#e2e8f0',
                        border: '1px solid rgba(148, 163, 184, 0.3)',
                        borderRadius: 6,
                        padding: '4px 8px',
                        fontSize: 12,
                        cursor: 'pointer',
                        outline: 'none',
                        appearance: 'auto',
                      }}
                    >
                      {!defaultKey && (
                        <option value="" disabled>— pick one —</option>
                      )}
                      {STAGE_MAP_OPTIONS.map(o => (
                        <option key={o.key} value={o.key}>{o.label}</option>
                      ))}
                    </select>
                  </td>
                  <td style={{ ...tdStyle, color: '#94a3b8' }}>{deals}</td>
                  <td style={tdStyle}>{value}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <button
        onClick={() => onSend('looks right')}
        style={{
          marginTop: 8,
          padding: '7px 16px',
          background: 'rgba(99, 102, 241, 0.15)',
          border: '1px solid rgba(99, 102, 241, 0.4)',
          borderRadius: 8,
          color: '#a5b4fc',
          fontSize: 13,
          fontWeight: 500,
          cursor: 'pointer',
          transition: 'background 0.15s',
        }}
        onMouseEnter={e => { (e.target as HTMLButtonElement).style.background = 'rgba(99, 102, 241, 0.28)'; }}
        onMouseLeave={e => { (e.target as HTMLButtonElement).style.background = 'rgba(99, 102, 241, 0.15)'; }}
      >
        ✓ Looks right — confirm all
      </button>
    </div>
  );
}

function renderTable(tableLines: string[], keyBase: number, onSend?: (msg: string) => void): React.ReactElement {
  const headerLine = tableLines[0];
  const hasSeparator = tableLines.length > 1 && isSeparatorRow(tableLines[1]);
  const dataStartIdx = hasSeparator ? 2 : 1;
  const headers = parseTableCells(headerLine);
  const rows = tableLines.slice(dataStartIdx).map(l => parseTableCells(l));

  // Detect the stage mapping calibration table by its distinctive column headers
  const isStageMappingTable =
    onSend &&
    headers.length >= 5 &&
    headers[1]?.toLowerCase().trim() === 'pipeline' &&
    headers[2]?.toLowerCase().trim() === "pandora's guess";

  if (isStageMappingTable) {
    return renderStageMappingTable(headers, rows, keyBase, onSend!);
  }

  return (
    <div key={`table-${keyBase}`} style={{ overflowX: 'auto', margin: '8px 0', borderRadius: 8, border: '1px solid rgba(148, 163, 184, 0.15)' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, fontFamily: "'Inter', sans-serif" }}>
        <thead>
          <tr>
            {headers.map((h, ci) => (
              <th key={ci} style={{
                padding: '8px 12px', textAlign: 'left', fontWeight: 600, fontSize: 11,
                textTransform: 'uppercase', letterSpacing: '0.05em',
                color: '#94a3b8', background: 'rgba(30, 41, 59, 0.8)',
                borderBottom: '1px solid rgba(148, 163, 184, 0.15)', whiteSpace: 'nowrap',
              }}>{formatInlineMarkdown(h)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((cells, ri) => (
            <tr key={ri} style={{ background: ri % 2 === 0 ? 'transparent' : 'rgba(30, 41, 59, 0.3)' }}>
              {cells.map((cell, ci) => (
                <td key={ci} style={{
                  padding: '6px 12px', color: '#e2e8f0',
                  borderBottom: '1px solid rgba(148, 163, 184, 0.08)', whiteSpace: 'nowrap',
                }}>{formatInlineMarkdown(cell)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function formatMarkdown(text: string, onSend?: (msg: string) => void): React.ReactElement[] {
  // Pre-pass: rejoin lines where a markdown link's URL was split across lines.
  // The LLM sometimes breaks a long `[label](url)` at the `-` character inside a UUID,
  // producing a line ending with `(...url-fragment` and the next line starting with `rest)`.
  // Detect: line contains `](` but has no matching `)` after the last `(`.
  const rawLines = text.split('\n');
  const lines: string[] = [];
  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i];
    // Check if the line has an open markdown link paren that isn't closed
    const lastOpenParen = line.lastIndexOf('](');
    if (lastOpenParen !== -1 && !line.includes(')', lastOpenParen + 2) && i + 1 < rawLines.length) {
      // Join this line with the next to reassemble the broken URL
      lines.push(line + rawLines[i + 1]);
      i++;
    } else {
      lines.push(line);
    }
  }
  const elements: React.ReactElement[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (isTableRow(line)) {
      const tableLines: string[] = [line];
      let j = i + 1;
      if (j < lines.length && isSeparatorRow(lines[j])) {
        tableLines.push(lines[j]);
        j++;
      }
      while (j < lines.length && isTableRow(lines[j])) {
        tableLines.push(lines[j]);
        j++;
      }
      i = j;
      if (tableLines.length >= 2) {
        elements.push(renderTable(tableLines, i, onSend));
      } else {
        elements.push(<div key={i}>{formatInlineMarkdown(tableLines[0])}</div>);
      }
      continue;
    }

    let content: React.ReactElement;

    if (line.startsWith('#### ')) {
      content = <div key={i} style={{ fontSize: 14, fontWeight: 600, color: '#cbd5e1', marginTop: 8, marginBottom: 4 }}>{formatInlineMarkdown(line.slice(5))}</div>;
    } else if (line.startsWith('### ')) {
      content = <div key={i} style={{ fontSize: 15, fontWeight: 600, color: '#e2e8f0', marginTop: 10, marginBottom: 4 }}>{formatInlineMarkdown(line.slice(4))}</div>;
    } else if (line.startsWith('## ')) {
      content = <div key={i} style={{ fontSize: 16, fontWeight: 600, color: '#e2e8f0', marginTop: 12, marginBottom: 6 }}>{formatInlineMarkdown(line.slice(3))}</div>;
    } else if (line.startsWith('# ')) {
      content = <div key={i} style={{ fontSize: 18, fontWeight: 700, color: '#f1f5f9', marginTop: 14, marginBottom: 8 }}>{formatInlineMarkdown(line.slice(2))}</div>;
    } else if (line.startsWith('**') && line.endsWith('**')) {
      content = <strong key={i}>{line.slice(2, -2)}</strong>;
    } else if (line.startsWith('• ') || line.startsWith('- ') || line.startsWith('* ')) {
      content = <div key={i} style={{ paddingLeft: 12, marginBottom: 2 }}>• {formatInlineMarkdown(line.slice(2))}</div>;
    } else if (/^\d+\.\s/.test(line)) {
      content = <div key={i} style={{ paddingLeft: 12, marginBottom: 2 }}>{formatInlineMarkdown(line)}</div>;
    } else if (line.trim() === '') {
      content = <div key={i} style={{ height: 8 }} />;
    } else {
      content = <div key={i}>{formatInlineMarkdown(line)}</div>;
    }

    elements.push(content);
    i++;
  }

  return elements;
}

function resolveLink(href: string): { url: string; external: boolean } {
  if (href.startsWith('pandora://deals/')) {
    return { url: `/deals/${href.replace('pandora://deals/', '')}`, external: false };
  }
  if (href.startsWith('pandora://accounts/')) {
    return { url: `/accounts/${href.replace('pandora://accounts/', '')}`, external: false };
  }
  if (href.startsWith('pandora://contacts/')) {
    return { url: `/contacts/${href.replace('pandora://contacts/', '')}`, external: false };
  }
  if (href.startsWith('pandora://conversations/')) {
    return { url: `/conversations/${href.replace('pandora://conversations/', '')}`, external: false };
  }
  if (href.startsWith('gong://calls/')) {
    return { url: `https://app.gong.io/call?id=${href.replace('gong://calls/', '')}`, external: true };
  }
  if (href.startsWith('hubspot://deals/')) {
    const sourceId = href.replace('hubspot://deals/', '');
    if (_hubspotPortalId) {
      return { url: `https://app.hubspot.com/contacts/${_hubspotPortalId}/record/0-3/${sourceId}`, external: true };
    }
    return { url: href, external: true };
  }
  if (href.startsWith('hubspot://contacts/')) {
    const sourceId = href.replace('hubspot://contacts/', '');
    if (_hubspotPortalId) {
      return { url: `https://app.hubspot.com/contacts/${_hubspotPortalId}/record/0-1/${sourceId}`, external: true };
    }
    return { url: href, external: true };
  }
  return { url: href, external: true };
}

function formatInlineMarkdown(text: string): (string | React.ReactElement)[] {
  const parts: (string | React.ReactElement)[] = [];
  const regex = /\*\*(.*?)\*\*|\[([^\]]+)\]\(([^)]+)\)/g;
  let last = 0;
  let match;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    if (match[1] !== undefined) {
      parts.push(<strong key={match.index}>{match[1]}</strong>);
    } else if (match[2] !== undefined && match[3] !== undefined) {
      const isDownload = match[3].includes('/generated-docs/');
      if (isDownload) {
        const url = match[3];
        const label = match[2];
        parts.push(
          <button
            key={match.index}
            onClick={async (e) => {
              e.preventDefault();
              const btn = e.currentTarget;
              btn.textContent = 'Downloading...';
              try {
                const res = await fetch(url, {
                  headers: { 'Authorization': `Bearer ${getAuthToken()}` },
                });
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const blob = await res.blob();
                const a = document.createElement('a');
                a.href = URL.createObjectURL(blob);
                a.download = url.split('/').pop() || 'document';
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(a.href);
                btn.textContent = '\u2705 Downloaded';
              } catch (err) {
                btn.textContent = '\u274C Download failed';
                console.error('[Download]', err);
              }
            }}
            style={{
              color: '#6488ea',
              cursor: 'pointer',
              border: '1px solid rgba(100, 136, 234, 0.3)',
              background: 'rgba(100, 136, 234, 0.1)',
              borderRadius: 6,
              fontWeight: 500,
              padding: '4px 10px',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              marginTop: 4,
              marginBottom: 4,
              fontFamily: 'inherit',
              fontSize: 'inherit',
            }}
          >
            {'\u{1F4E5}'} {label}
          </button>
        );
      } else {
        const { url, external } = resolveLink(match[3]);
        const linkStyle: React.CSSProperties = {
          color: '#6488ea',
          textDecoration: 'none',
          borderBottom: '1px solid rgba(100, 136, 234, 0.4)',
          paddingBottom: 1,
          cursor: 'pointer',
        };
        if (!external && _navigateFn) {
          const dest = url;
          parts.push(
            <a
              key={match.index}
              href={dest}
              onClick={(e) => { e.preventDefault(); _navigateFn!(dest); }}
              style={linkStyle}
            >
              {match[2]}
            </a>
          );
        } else {
          parts.push(
            <a
              key={match.index}
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              style={linkStyle}
            >
              {match[2]}
            </a>
          );
        }
      }
    }
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));

  return parts;
}

const thinkingKeyframes = `
@keyframes pulse {
  0%, 100% { opacity: 0.3; }
  50% { opacity: 1; }
}

@keyframes fadeInStep {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
`;

if (typeof document !== 'undefined' && !document.getElementById('chat-pulse-keyframes')) {
  const style = document.createElement('style');
  style.id = 'chat-pulse-keyframes';
  style.textContent = thinkingKeyframes;
  document.head.appendChild(style);
}

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.4)',
    zIndex: 1000,
    display: 'flex',
    justifyContent: 'flex-end',
  },
  panel: {
    maxWidth: '100vw',
    height: '100%',
    backgroundColor: '#0f1117',
    borderLeft: '1px solid #1e2230',
    display: 'flex',
    flexDirection: 'column',
    position: 'relative',
  },
  header: {
    padding: '16px 20px',
    borderBottom: '1px solid #1e2230',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  title: {
    fontSize: 16,
    fontWeight: 600,
    color: '#e2e8f0',
  },
  scopeLabel: {
    fontSize: 12,
    color: '#64748b',
    marginTop: 2,
  },
  headerActions: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  newChatBtn: {
    padding: '4px 10px',
    fontSize: 12,
    backgroundColor: 'transparent',
    color: '#6488ea',
    border: '1px solid #2a3150',
    borderRadius: 4,
    cursor: 'pointer',
  },
  closeBtn: {
    width: 28,
    height: 28,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 20,
    backgroundColor: 'transparent',
    color: '#94a3b8',
    border: 'none',
    borderRadius: 4,
    cursor: 'pointer',
  },
  messagesContainer: {
    flex: 1,
    overflowY: 'auto',
    padding: '16px 20px',
  },
  emptyState: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100%',
    textAlign: 'center',
    padding: 20,
  },
  emptyIcon: {
    fontSize: 40,
    marginBottom: 12,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: 600,
    color: '#e2e8f0',
    marginBottom: 8,
  },
  emptyText: {
    fontSize: 14,
    color: '#64748b',
    marginBottom: 20,
  },
  suggestions: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    width: '100%',
    maxWidth: 320,
  },
  suggestionBtn: {
    padding: '10px 14px',
    fontSize: 13,
    color: '#94a3b8',
    backgroundColor: '#161926',
    border: '1px solid #1e2230',
    borderRadius: 8,
    cursor: 'pointer',
    textAlign: 'left',
  },
  messageBubble: {
    marginBottom: 16,
    padding: '10px 14px',
    borderRadius: 10,
    fontSize: 14,
    lineHeight: 1.5,
  },
  userBubble: {
    backgroundColor: '#1a2442',
    color: '#e2e8f0',
    marginLeft: 40,
  },
  assistantBubble: {
    backgroundColor: '#161926',
    color: '#cbd5e1',
    marginRight: 40,
  },
  messageRole: {
    fontSize: 11,
    fontWeight: 600,
    color: '#6488ea',
    marginBottom: 4,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.5px',
  },
  messageContent: {
    whiteSpace: 'pre-wrap' as const,
    wordBreak: 'break-word' as const,
  },
  thinking: {
    display: 'flex',
    gap: 4,
    padding: '4px 0',
  },
  dot: {
    color: '#6488ea',
    fontSize: 10,
    animation: 'pulse 1.4s infinite',
  },
  errorMsg: {
    padding: '8px 12px',
    backgroundColor: 'rgba(239,68,68,0.1)',
    border: '1px solid rgba(239,68,68,0.2)',
    borderRadius: 6,
    color: '#ef4444',
    fontSize: 13,
    marginBottom: 12,
  },
  inputContainer: {
    paddingTop: 12,
    paddingLeft: 20,
    paddingRight: 20,
    paddingBottom: 16,
    borderTop: '1px solid #1e2230',
    display: 'flex',
    gap: 8,
    alignItems: 'flex-end',
  },
  input: {
    flex: 1,
    padding: '10px 14px',
    backgroundColor: '#161926',
    color: '#e2e8f0',
    border: '1px solid #1e2230',
    borderRadius: 8,
    fontSize: 14,
    resize: 'none' as const,
    outline: 'none',
    fontFamily: 'inherit',
    lineHeight: 1.4,
    maxHeight: 120,
    overflowY: 'auto' as const,
  },
  sendBtn: {
    width: 36,
    height: 36,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#6488ea',
    color: '#fff',
    border: 'none',
    borderRadius: 8,
    fontSize: 18,
    cursor: 'pointer',
    flexShrink: 0,
  },
  sendBtnDisabled: {
    backgroundColor: '#2a3150',
    color: '#475569',
    cursor: 'not-allowed',
  },
  historyBtn: {
    width: 28,
    height: 28,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 16,
    backgroundColor: 'transparent',
    color: '#94a3b8',
    border: '1px solid #2a3150',
    borderRadius: 4,
    cursor: 'pointer',
  },
  backBtn: {
    padding: '4px 10px',
    fontSize: 12,
    backgroundColor: 'transparent',
    color: '#6488ea',
    border: '1px solid #2a3150',
    borderRadius: 4,
    cursor: 'pointer',
  },
  historyView: {
    display: 'flex',
    flexDirection: 'column' as const,
    height: '100%',
  },
  historyLoading: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#64748b',
    fontSize: 14,
  },
  historyEmpty: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    justifyContent: 'center',
    textAlign: 'center' as const,
  },
  sessionRow: {
    padding: '12px 14px',
    borderBottom: '1px solid #1e2230',
    cursor: 'pointer',
    transition: 'background-color 0.15s',
  },
  sessionTitle: {
    fontSize: 14,
    color: '#e2e8f0',
    marginBottom: 4,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  },
  sessionMeta: {
    fontSize: 12,
    color: '#64748b',
  },
  sessionUser: {
    color: '#94a3b8',
  },
  sessionDate: {
    color: '#64748b',
  },
  historyActions: {
    padding: '16px',
    borderTop: '1px solid #1e2230',
    marginTop: 'auto',
  },
  newConversationBtn: {
    width: '100%',
    padding: '10px',
    fontSize: 14,
    fontWeight: 600,
    backgroundColor: '#6488ea',
    color: '#fff',
    border: 'none',
    borderRadius: 8,
    cursor: 'pointer',
  },
};
