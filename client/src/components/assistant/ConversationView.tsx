import React, { useEffect, useRef, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useNavigate } from 'react-router-dom';
import { colors } from '../../styles/theme';
import { useConversationStream } from './useConversationStream';
import { getWorkspaceId, getAuthToken } from '../../lib/api';
import AgentChip from './AgentChip';
import EvidenceCard from './EvidenceCard';
import ActionCard from './ActionCard';
import DeliverablePicker from './DeliverablePicker';
import StickyInput from './StickyInput';
import MessageFeedback from './MessageFeedback';

interface ConversationViewProps {
  initialMessage?: string;
  onBack: () => void;
}

const AGENT_ROUTES: Record<string, string> = {
  'forecast-rollup': '/forecast',
  'forecast-call-prep': '/forecast',
  'attainment-vs-goal': '/forecast',
  'monte-carlo-forecast': '/forecast',
  'pipeline-state': '/command-center',
  'pipeline-coverage': '/command-center',
  'bowtie-review': '/command-center',
};

export default function ConversationView({ initialMessage, onBack }: ConversationViewProps) {
  const { state, sendMessage, dismissAction, loadHistory, startNewThread } = useConversationStream();
  const navigate = useNavigate();
  const bottomRef = useRef<HTMLDivElement>(null);
  const latestAnswerRef = useRef<HTMLDivElement>(null);
  const prevPhaseRef = useRef<string>('idle');
  const sentRef = useRef(false);
  const historyLoadedRef = useRef(false);
  const sentMessagesRef = useRef<Set<string>>(new Set());

  const checkRepeatedQuestion = useCallback(async (text: string) => {
    const workspaceId = getWorkspaceId();
    const token = getAuthToken();
    if (!workspaceId) return;
    const key = text.trim().toLowerCase();
    if (sentMessagesRef.current.has(key)) {
      fetch(`/api/workspaces/${workspaceId}/chat/repeated-question`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ message: text }),
      }).catch(() => null);
    }
    sentMessagesRef.current.add(key);
  }, []);

  const handleSendWithTracking = useCallback((text: string) => {
    checkRepeatedQuestion(text);
    sendMessage(text);
  }, [checkRepeatedQuestion, sendMessage]);

  useEffect(() => {
    if (historyLoadedRef.current) return;
    historyLoadedRef.current = true;
    const workspaceId = getWorkspaceId();
    if (workspaceId) {
      loadHistory(workspaceId).then(() => {
        if (initialMessage && !sentRef.current) {
          sentRef.current = true;
          handleSendWithTracking(initialMessage);
        }
      });
    } else if (initialMessage && !sentRef.current) {
      sentRef.current = true;
      handleSendWithTracking(initialMessage);
    }
  }, [initialMessage, handleSendWithTracking, loadHistory]);

  useEffect(() => {
    const justCompleted =
      prevPhaseRef.current !== 'complete' &&
      prevPhaseRef.current !== 'idle' &&
      state.phase === 'complete';
    prevPhaseRef.current = state.phase;

    if (justCompleted) {
      setTimeout(() => latestAnswerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
    } else if (state.phase !== 'complete' && state.phase !== 'idle') {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [state.messages, state.synthesisText, state.evidenceCards, state.actions, state.deliverableOptions, state.phase]);

  const handleBack = () => {
    onBack();
  };

  const handleNewThread = () => {
    sentRef.current = false;
    startNewThread();
  };

  const inProgress = state.phase !== 'idle' && state.phase !== 'complete';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <button
          onClick={handleBack}
          style={{
            background: 'transparent', border: 'none', cursor: 'pointer',
            fontSize: 13, color: colors.textSecondary, padding: '4px 8px',
            display: 'flex', alignItems: 'center', gap: 4,
          }}
          onMouseEnter={e => (e.currentTarget as HTMLButtonElement).style.color = colors.text}
          onMouseLeave={e => (e.currentTarget as HTMLButtonElement).style.color = colors.textSecondary}
        >
          ← Back to brief
        </button>
        <button
          onClick={handleNewThread}
          disabled={inProgress}
          style={{
            background: 'transparent', border: `1px solid ${colors.border}`, cursor: inProgress ? 'not-allowed' : 'pointer',
            fontSize: 11, color: colors.textMuted, padding: '3px 10px', borderRadius: 6,
            opacity: inProgress ? 0.4 : 1,
          }}
          onMouseEnter={e => { if (!inProgress) (e.currentTarget as HTMLButtonElement).style.color = colors.text; }}
          onMouseLeave={e => (e.currentTarget as HTMLButtonElement).style.color = colors.textMuted}
        >
          New conversation
        </button>
      </div>

      {state.restored && state.messages.length > 0 && (
        <div style={{
          fontSize: 11, color: colors.textMuted, textAlign: 'center',
          marginBottom: 12, padding: '4px 10px',
          background: colors.surface, border: `1px solid ${colors.border}`,
          borderRadius: 6,
        }}>
          Previous conversation restored
        </div>
      )}

      <div style={{ flex: 1, overflowY: 'auto' }}>
        {state.messages.map(msg => (
          <div
            key={msg.id}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: msg.role === 'user' ? 'flex-end' : 'flex-start',
              marginBottom: 12,
            }}
          >
            <div style={{ display: 'flex', justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start', width: '100%' }}>
              {msg.role === 'assistant' && (
                <div style={{
                  width: 26, height: 26, borderRadius: '50%', flexShrink: 0, marginRight: 8, marginTop: 2,
                  background: 'linear-gradient(135deg, #48af9b 0%, #3a7fc1 100%)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 11, color: '#fff', fontWeight: 700,
                }}>✦</div>
              )}
              <div style={{
                maxWidth: '75%', padding: '10px 14px', borderRadius: 10, fontSize: 13, lineHeight: 1.6,
                background: msg.role === 'user' ? colors.accentSoft : colors.surface,
                color: msg.role === 'user' ? colors.accent : colors.text,
                border: `1px solid ${msg.role === 'user' ? colors.accent + '40' : colors.border}`,
              }}>
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={{
                    p: ({ children }) => <p style={{ margin: '0 0 8px 0' }}>{children}</p>,
                    strong: ({ children }) => <strong style={{ fontWeight: 700 }}>{children}</strong>,
                    em: ({ children }) => <em style={{ fontStyle: 'italic' }}>{children}</em>,
                    ul: ({ children }) => <ul style={{ margin: '0 0 8px 0', paddingLeft: 20 }}>{children}</ul>,
                    ol: ({ children }) => <ol style={{ margin: '0 0 8px 0', paddingLeft: 20 }}>{children}</ol>,
                    li: ({ children }) => <li style={{ margin: '2px 0' }}>{children}</li>,
                  }}
                >
                  {msg.content}
                </ReactMarkdown>
              </div>
            </div>
            {msg.role === 'assistant' && msg.response_id && (
              <div style={{ paddingLeft: 34 }}>
                <MessageFeedback responseId={msg.response_id} />
              </div>
            )}
          </div>
        ))}

        {state.activeOperators.length > 0 && (
          <div ref={latestAnswerRef} style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 10, fontWeight: 600, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>
              Consulting Operators
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {state.activeOperators.map(op => {
                const route = AGENT_ROUTES[op.agent_id];
                return (
                  <AgentChip
                    key={op.agent_id}
                    operator={op}
                    onClick={route ? () => navigate(route) : undefined}
                  />
                );
              })}
            </div>
          </div>
        )}

        {(state.phase === 'synthesis' || (state.synthesisComplete && state.synthesisText)) && state.messages.every(m => m.role !== 'assistant' || m.content !== state.synthesisText) && (
          <div ref={state.activeOperators.length === 0 ? latestAnswerRef : undefined} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 12 }}>
            <div style={{
              width: 26, height: 26, borderRadius: '50%', flexShrink: 0, marginTop: 2,
              background: 'linear-gradient(135deg, #48af9b 0%, #3a7fc1 100%)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 11, color: '#fff', fontWeight: 700,
            }}>✦</div>
            <div style={{
              maxWidth: '75%', padding: '10px 14px', borderRadius: 10,
              background: colors.surface, border: `1px solid ${colors.border}`,
              fontSize: 13, color: colors.text, lineHeight: 1.6,
            }}>
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  p: ({ children }) => <p style={{ margin: '0 0 8px 0' }}>{children}</p>,
                  strong: ({ children }) => <strong style={{ fontWeight: 700 }}>{children}</strong>,
                  em: ({ children }) => <em style={{ fontStyle: 'italic' }}>{children}</em>,
                  ul: ({ children }) => <ul style={{ margin: '0 0 8px 0', paddingLeft: 20 }}>{children}</ul>,
                  ol: ({ children }) => <ol style={{ margin: '0 0 8px 0', paddingLeft: 20 }}>{children}</ol>,
                  li: ({ children }) => <li style={{ margin: '2px 0' }}>{children}</li>,
                }}
              >
                {state.synthesisText}
              </ReactMarkdown>
              {!state.synthesisComplete && <span style={{ color: colors.accent }}>▋</span>}
            </div>
          </div>
        )}

        {state.evidenceCards.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 10, fontWeight: 600, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>
              Evidence
            </div>
            {state.evidenceCards.map(card => (
              <EvidenceCard key={card.id} card={card} />
            ))}
          </div>
        )}

        {state.actions.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 10, fontWeight: 600, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>
              Recommended Actions
            </div>
            {state.actions.map(action => (
              <ActionCard key={action.id} action={action} onDismiss={dismissAction} />
            ))}
          </div>
        )}

        {state.deliverableOptions.length > 0 && state.phase === 'complete' && (
          <DeliverablePicker
            options={state.deliverableOptions}
            content={state.synthesisText || state.messages.filter(m => m.role === 'assistant').map(m => m.content).join('\n\n')}
            title="Pandora Analysis"
          />
        )}

        {state.error && (
          <div style={{ padding: '10px 14px', background: '#ff8c8220', border: `1px solid #ff8c82`, borderRadius: 8, fontSize: 12, color: '#ff8c82', marginBottom: 12 }}>
            {state.error}
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      <StickyInput onSend={handleSendWithTracking} disabled={inProgress} />
    </div>
  );
}
