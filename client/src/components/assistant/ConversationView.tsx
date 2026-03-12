import React, { useEffect, useRef, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useNavigate } from 'react-router-dom';
import { colors, fonts } from '../../styles/theme';
import { useConversationStream } from './useConversationStream';
import { getWorkspaceId, getAuthToken, api } from '../../lib/api';
import EvidenceCard from './EvidenceCard';
import InlineActionsPrompt from './InlineActionsPrompt';
import ActionsPrompt from './ActionsPrompt';
import ActionCard from './ActionCard';
import StrategicCard from './StrategicCard';
import ClarifyingQuestionCard from './ClarifyingQuestionCard';
import DeliverablePicker from './DeliverablePicker';
import StickyInput from './StickyInput';
import MessageFeedback from './MessageFeedback';
import AgentConversationFeed from './AgentConversationFeed';
import ChartRenderer from '../shared/ChartRenderer';
import SankeyChart from '../reports/SankeyChart';
import WinningPathsChart from '../pipeline/WinningPathsChart';
import SuggestedActionsPanel from './SuggestedActionsPanel';

interface EntityScope {
  entityType: 'deal';
  entityId: string;
  entityName: string;
}

interface ConversationViewProps {
  initialMessage?: string;
  onBack: () => void;
  onThreadId?: (threadId: string) => void;
  scope?: EntityScope | null;
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

export default function ConversationView({ initialMessage, onBack, onThreadId, scope }: ConversationViewProps) {
  const { state, sendMessage, dismissAction, dismissJudgedAction, dismissInlineAction, dismissSuggestedActions, loadHistory, startNewThread, setScope } = useConversationStream();
  const navigate = useNavigate();
  const bottomRef = useRef<HTMLDivElement>(null);
  const latestAnswerRef = useRef<HTMLDivElement>(null);
  const prevPhaseRef = useRef<string>('idle');
  const sentRef = useRef(false);
  const historyLoadedRef = useRef(false);
  const sentMessagesRef = useRef<Set<string>>(new Set());

  // Set scope when component mounts
  useEffect(() => {
    if (scope) {
      setScope(scope);
    }
  }, [scope, setScope]);

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
  }, [state.messages, state.synthesisText, state.evidenceCards, state.actions, state.inlineActions, state.deliverableOptions, state.phase]);

  useEffect(() => {
    if (state.threadId && onThreadId) {
      onThreadId(state.threadId);
    }
  }, [state.threadId, onThreadId]);

  const handleBack = () => {
    onBack();
  };

  const handleNewThread = () => {
    sentRef.current = false;
    startNewThread();
  };

  const handleClarifyingSelection = (option: { label: string; value: string }) => {
    if (!state.clarifyingQuestion) return;
    const lastUserMsg = state.messages.filter(m => m.role === 'user').pop();
    if (!lastUserMsg) return;

    // Append the dimension marker to the original message and re-send
    const dimensionTag = `[Dimension: ${state.clarifyingQuestion.dimension}=${option.label}]`;
    handleSendWithTracking(`${lastUserMsg.content} ${dimensionTag}`);
  };

  const inProgress = state.phase !== 'idle' && state.phase !== 'complete' && state.phase !== 'clarifying';

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

      {state.scope && (
        <div style={{
          fontSize: 12, color: colors.text, textAlign: 'center',
          marginBottom: 12, padding: '6px 12px',
          background: 'linear-gradient(135deg, #48af9b15 0%, #3a7fc115 100%)',
          border: `1px solid ${colors.accent}40`,
          borderRadius: 6,
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
        }}>
          <span style={{ fontSize: 14 }}>📋</span>
          <span>Viewing: <strong>{state.scope.entityName}</strong></span>
          <button
            onClick={() => setScope(null)}
            style={{
              background: 'transparent', border: 'none', cursor: 'pointer',
              fontSize: 11, color: colors.textMuted, padding: '2px 6px',
              marginLeft: 4,
            }}
            onMouseEnter={e => (e.currentTarget as HTMLButtonElement).style.color = colors.text}
            onMouseLeave={e => (e.currentTarget as HTMLButtonElement).style.color = colors.textMuted}
            title="Clear deal context"
          >
            ✕
          </button>
        </div>
      )}

      <div style={{ flex: 1, overflowY: 'auto' }}>
        {/* Plan Text */}
        {state.planText && (
          <div style={{
            padding: 12,
            marginBottom: 16,
            background: colors.surfaceRaised,
            border: `1px solid ${colors.border}`,
            borderRadius: 8,
            fontSize: 13,
            color: colors.textMuted,
            fontStyle: 'italic',
            lineHeight: 1.6,
          }}>
            <div style={{ fontWeight: 600, marginBottom: 6, color: colors.text }}>📋 {state.planText.split('\n')[0]}</div>
            {state.planText.split('\n').slice(1).map((line, i) => (
              <div key={i}>{line}</div>
            ))}
          </div>
        )}

        {/* Progress Panel */}
        {state.showProgress && state.toolProgress.length >= 2 && (
          <div style={{
            padding: 16,
            marginBottom: 16,
            background: colors.surfaceRaised,
            border: `1px solid ${colors.border}`,
            borderRadius: 10,
            fontSize: 13,
          }}>
            <div style={{ fontWeight: 600, color: colors.text, marginBottom: 12 }}>
              ⚙️ Analyzing...
            </div>
            {state.toolProgress.map((progress, idx) => (
              <div
                key={idx}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  marginBottom: 8,
                  color: colors.textSecondary,
                }}
              >
                <span>{progress.status === 'completed' ? '✅' : '⏳'}</span>
                <span style={{ flex: 1 }}>{progress.tool_display_name}</span>
                <span style={{ fontSize: 11, color: colors.textMuted }}>
                  {progress.result_summary}
                </span>
              </div>
            ))}
          </div>
        )}

        {state.messages.map(msg => (
          <div
            key={msg.id}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: msg.role === 'user' ? 'flex-end' : 'flex-start',
              marginBottom: 12,
              opacity: state.phase === 'clarifying' && msg === state.messages[state.messages.length - 1] ? 0.6 : 1,
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

        {state.crossSignalFindings.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 10, fontWeight: 600, color: colors.accent, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ fontSize: 12 }}>🔗</span> Connected Intelligence
            </div>
            {state.crossSignalFindings.map(f => (
              <div key={f.id} style={{
                background: colors.surface,
                border: `1px solid ${colors.border}`,
                borderLeft: `3px solid ${f.severity === 'critical' ? '#ff4d4d' : f.severity === 'warning' ? '#ff9800' : colors.accent}`,
                borderRadius: 8,
                padding: '12px 14px',
                marginBottom: 10,
                fontSize: 13
              }}>
                <div style={{ fontWeight: 600, marginBottom: 4, color: colors.text }}>{f.title}</div>
                <div style={{ color: colors.textSecondary, marginBottom: 8, lineHeight: 1.5 }}>{f.summary}</div>
                
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 12, paddingTop: 12, borderTop: `1px solid ${colors.border}` }}>
                  <div>
                    <div style={{ fontSize: 10, fontWeight: 700, color: colors.textMuted, textTransform: 'uppercase', marginBottom: 4 }}>Root Cause</div>
                    <div style={{ fontSize: 12, color: colors.textSecondary }}>{f.rootCause}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 10, fontWeight: 700, color: colors.textMuted, textTransform: 'uppercase', marginBottom: 4 }}>Recommendation</div>
                    <div style={{ fontSize: 12, color: colors.accent, fontWeight: 500 }}>{f.recommendation}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {state.activeOperators.length > 0 && (
          <div ref={latestAnswerRef}>
            <AgentConversationFeed
              operators={state.activeOperators}
              toolCalls={state.toolCalls}
              phase={state.phase}
              onOperatorClick={(agentId) => {
                const route = AGENT_ROUTES[agentId];
                if (route) navigate(route);
              }}
            />
          </div>
        )}

        {state.sankeyData !== null && (state.phase === 'synthesis' || state.synthesisComplete) && (
          <div style={{ display: 'flex', justifyContent: 'flex-start', width: '100%', marginBottom: 12 }}>
            <div style={{ maxWidth: '90%', width: '100%' }}>
              <SankeyChart chartData={state.sankeyData} />
            </div>
          </div>
        )}

        {state.winningPathsData !== null && (state.phase === 'synthesis' || state.synthesisComplete) && (
          <div style={{ display: 'flex', justifyContent: 'flex-start', width: '100%', marginBottom: 12 }}>
            <div style={{ maxWidth: '90%', width: '100%' }}>
              <WinningPathsChart data={state.winningPathsData} embedded={true} />
            </div>
          </div>
        )}

        {state.chartSpecs.length > 0 && (state.phase === 'synthesis' || state.synthesisComplete) && (
          <div style={{ display: 'flex', justifyContent: 'flex-start', width: '100%', marginBottom: 12 }}>
            <div style={{
              maxWidth: '75%', padding: '12px 14px', borderRadius: 10,
              background: colors.surface, border: `1px solid ${colors.border}`,
              width: '100%',
            }}>
              {state.chartSpecs.map((spec, i) => (
                <div key={i} style={{ marginBottom: i < state.chartSpecs.length - 1 ? 20 : 0 }}>
                  <ChartRenderer spec={spec} compact={true} />
                </div>
              ))}
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

        {state.strategicAnalysis && (
          <StrategicCard data={state.strategicAnalysis} />
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
          <ActionsPrompt actions={state.actions} onDismiss={dismissAction} />
        )}

        {state.judgedActions.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 10, fontWeight: 600, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>
              Recommended Actions
            </div>
            {state.judgedActions.map((action, i) => (
              <ActionCard 
                key={i} 
                action={{
                  id: action.id,
                  title: action.title,
                  detail: action.summary,
                  type: action.action_type.startsWith('ops_') ? 'generic' : 'crm',
                  judgment_mode: action.judgment_mode,
                  judgment_reason: action.judgment_reason,
                  approval_prompt: action.approval_prompt,
                  escalation_reason: action.escalation_reason
                }} 
                onDismiss={() => dismissJudgedAction(i)} 
              />
            ))}
          </div>
        )}

        {state.inlineActions.length > 0 && (
          <InlineActionsPrompt
            actions={state.inlineActions}
            onExecute={async (actionId, overrideStage) => {
              const workspaceId = getWorkspaceId();
              if (!workspaceId) return;
              await api.post(`/workspaces/${workspaceId}/actions/${actionId}/execute-inline`, {
                override_value: overrideStage
              });
              dismissInlineAction(actionId);
            }}
            onDismiss={async (actionId) => {
              const workspaceId = getWorkspaceId();
              if (!workspaceId) return;
              await api.post(`/workspaces/${workspaceId}/actions/${actionId}/dismiss`);
              dismissInlineAction(actionId);
            }}
          />
        )}

        {state.suggestedActions.length > 0 && (
          <SuggestedActionsPanel
            actions={state.suggestedActions}
            onDismissAll={dismissSuggestedActions}
          />
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

        {state.phase === 'clarifying' && state.clarifyingQuestion && (
          <ClarifyingQuestionCard
            question={state.clarifyingQuestion.question}
            dimension={state.clarifyingQuestion.dimension}
            options={state.clarifyingQuestion.options}
            onSelect={handleClarifyingSelection}
          />
        )}

        <div ref={bottomRef} />
      </div>

      <StickyInput onSend={handleSendWithTracking} disabled={inProgress} />
    </div>
  );
}
