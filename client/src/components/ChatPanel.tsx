import { useState, useRef, useEffect, useCallback } from 'react';
import { api } from '../lib/api';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  responseId?: string;
  feedbackEnabled?: boolean;
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
}

export default function ChatPanel({ isOpen, onClose, scope }: ChatPanelProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [feedbackMap, setFeedbackMap] = useState<Record<string, 'thumbs_up' | 'thumbs_down'>>({});
  const [hoveredMsgIdx, setHoveredMsgIdx] = useState<number | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

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

  const startNewChat = useCallback(() => {
    setMessages([]);
    setThreadId(null);
    setError(null);
    setInput('');
  }, []);

  useEffect(() => {
    startNewChat();
  }, [scope?.type, scope?.entity_id, startNewChat]);

  const sendMessage = async () => {
    const text = input.trim();
    if (!text || loading) return;

    setInput('');
    setError(null);

    const userMsg: ChatMessage = {
      role: 'user',
      content: text,
      timestamp: new Date().toISOString(),
    };
    setMessages(prev => [...prev, userMsg]);
    setLoading(true);

    try {
      const body: any = { message: text };
      if (threadId) body.thread_id = threadId;
      if (scope && !threadId) body.scope = scope;

      const result: any = await api.post('/chat', body);

      if (result.thread_id && !threadId) {
        setThreadId(result.thread_id);
      }

      const assistantMsg: ChatMessage = {
        role: 'assistant',
        content: result.answer,
        timestamp: new Date().toISOString(),
        responseId: result.response_id,
        feedbackEnabled: result.feedback_enabled,
      };
      setMessages(prev => [...prev, assistantMsg]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Something went wrong';
      setError(msg);
    } finally {
      setLoading(false);
    }
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
      <div style={styles.panel} onClick={e => e.stopPropagation()}>
        <div style={styles.header}>
          <div>
            <div style={styles.title}>Ask Pandora</div>
            <div style={styles.scopeLabel}>{scopeLabel}</div>
          </div>
          <div style={styles.headerActions}>
            {messages.length > 0 && (
              <button style={styles.newChatBtn} onClick={startNewChat}>New Chat</button>
            )}
            <button style={styles.closeBtn} onClick={onClose}>×</button>
          </div>
        </div>

        <div style={styles.messagesContainer}>
          {messages.length === 0 && !loading && (
            <div style={styles.emptyState}>
              <div style={styles.emptyIcon}>💬</div>
              <div style={styles.emptyTitle}>Ask Pandora</div>
              <div style={styles.emptyText}>
                Ask about your pipeline, deals, reps, or any RevOps data.
              </div>
              <div style={styles.suggestions}>
                {getSuggestions(scope).map((s, i) => (
                  <button
                    key={i}
                    style={styles.suggestionBtn}
                    onClick={() => { setInput(s); inputRef.current?.focus(); }}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((msg, idx) => (
            <div
              key={idx}
              style={{
                ...styles.messageBubble,
                ...(msg.role === 'user' ? styles.userBubble : styles.assistantBubble),
              }}
              onMouseEnter={() => setHoveredMsgIdx(idx)}
              onMouseLeave={() => setHoveredMsgIdx(null)}
            >
              <div style={styles.messageRole}>
                {msg.role === 'user' ? 'You' : 'Pandora'}
              </div>
              <div style={styles.messageContent}>
                {formatMarkdown(msg.content)}
              </div>
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
          ))}

          {loading && (
            <div style={{ ...styles.messageBubble, ...styles.assistantBubble }}>
              <div style={styles.messageRole}>Pandora</div>
              <div style={styles.thinking}>
                <span style={styles.dot}>●</span>
                <span style={{ ...styles.dot, animationDelay: '0.2s' }}>●</span>
                <span style={{ ...styles.dot, animationDelay: '0.4s' }}>●</span>
              </div>
            </div>
          )}

          {error && (
            <div style={styles.errorMsg}>{error}</div>
          )}

          <div ref={messagesEndRef} />
        </div>

        <div style={styles.inputContainer}>
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
            onClick={sendMessage}
            disabled={!input.trim() || loading}
          >
            →
          </button>
        </div>
      </div>
    </div>
  );
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

function formatMarkdown(text: string): JSX.Element[] {
  const lines = text.split('\n');
  const elements: JSX.Element[] = [];

  lines.forEach((line, i) => {
    let content: JSX.Element;

    if (line.startsWith('**') && line.endsWith('**')) {
      content = <strong key={i}>{line.slice(2, -2)}</strong>;
    } else if (line.startsWith('• ') || line.startsWith('- ') || line.startsWith('* ')) {
      content = <div key={i} style={{ paddingLeft: 12 }}>• {formatInlineMarkdown(line.slice(2))}</div>;
    } else if (/^\d+\.\s/.test(line)) {
      content = <div key={i} style={{ paddingLeft: 12 }}>{formatInlineMarkdown(line)}</div>;
    } else if (line.trim() === '') {
      content = <div key={i} style={{ height: 8 }} />;
    } else {
      content = <div key={i}>{formatInlineMarkdown(line)}</div>;
    }

    elements.push(content);
  });

  return elements;
}

function formatInlineMarkdown(text: string): (string | JSX.Element)[] {
  const parts: (string | JSX.Element)[] = [];
  const regex = /\*\*(.*?)\*\*/g;
  let last = 0;
  let match;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    parts.push(<strong key={match.index}>{match[1]}</strong>);
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
    width: 440,
    maxWidth: '100vw',
    height: '100vh',
    backgroundColor: '#0f1117',
    borderLeft: '1px solid #1e2230',
    display: 'flex',
    flexDirection: 'column',
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
    padding: '12px 20px 16px',
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
};
