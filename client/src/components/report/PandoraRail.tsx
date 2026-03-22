import { useState, useRef, useEffect, useCallback } from 'react';
import { api } from '../../lib/api';
import { colors, fonts } from '../../styles/theme';
import { renderMarkdown } from '../../lib/render-markdown';
import { getActiveSectionEditor, getAnyActiveEditor } from '../../lib/sectionEditorRegistry';
import { insertTextIntoEditor, replaceSelectionInEditor } from '../../lib/insertBlock';

interface ReportContext {
  documentId?: string;
  documentType?: string;
  periodLabel?: string;
  activeSectionId?: string | null;
  activeSectionTitle?: string | null;
}

interface InjectedPrompt {
  instruction: string;
  selectedText: string;
  sectionId: string;
}

interface PandoraRailProps {
  workspaceId: string;
  reportContext?: ReportContext;
  forcedMode: string | null;
  onModeChange: (mode: string | null) => void;
  injectedPrompt?: InjectedPrompt;
  onInjectedPromptConsumed?: () => void;
}

interface RailMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
}

const MODES = [
  {
    id: 'bull_bear',
    label: 'Bull/Bear',
    avatar: '/avatars/char-21.png',
    tooltip: 'Argue both sides — upside vs risk',
    instruction: 'You are operating in Bull/Bear mode. When answering, argue BOTH sides clearly — present the bull case (upside) first, then the bear case (risk). Take clear positions on each side. Do not hedge.',
  },
  {
    id: 'socratic',
    label: 'Socratic',
    avatar: '/avatars/char-23.png',
    tooltip: 'Question the assumption',
    instruction: 'You are operating in Socratic mode. Do not accept the premise at face value. Ask probing questions, surface hidden assumptions, and challenge the user to think more rigorously about their conclusions.',
  },
  {
    id: 'boardroom',
    label: 'Boardroom',
    avatar: '/avatars/char-24.png',
    tooltip: 'Multiple stakeholder perspectives',
    instruction: 'You are operating in Boardroom mode. Present this from multiple stakeholder perspectives — what does sales leadership care about? Finance? Marketing? Where do priorities conflict?',
  },
  {
    id: 'prosecutor_defense',
    label: 'Stress Test',
    avatar: '/avatars/char-25.png',
    tooltip: 'What could go wrong with this plan?',
    instruction: 'You are operating in Stress Test mode. Act as both prosecutor and defense — first identify every way this plan, number, or assumption could fail; then build the strongest possible defense of it.',
  },
] as const;

function buildReportPreamble(ctx: ReportContext, modeInstruction: string | null): string {
  const lines: string[] = [];
  if (ctx.documentType) {
    const typeLabel = ctx.documentType === 'wbr' ? 'Weekly Business Review'
      : ctx.documentType === 'qbr' ? 'Quarterly Business Review'
      : ctx.documentType.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    lines.push(`You are helping a RevOps leader work through a ${typeLabel}.`);
  }
  if (ctx.periodLabel) lines.push(`Period: ${ctx.periodLabel}.`);
  if (ctx.activeSectionTitle) lines.push(`The user is currently viewing the "${ctx.activeSectionTitle}" section.`);
  lines.push('Help answer questions, rewrite sections, suggest charts, or analyze deals in this document.');
  if (modeInstruction) lines.push('', modeInstruction);
  return lines.join(' ');
}

export default function PandoraRail({
  workspaceId,
  reportContext = {},
  forcedMode,
  onModeChange,
  injectedPrompt,
  onInjectedPromptConsumed,
}: PandoraRailProps) {
  const [messages, setMessages] = useState<RailMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [hoveredMsgIdx, setHoveredMsgIdx] = useState<number | null>(null);
  const [insertedMsgIdx, setInsertedMsgIdx] = useState<number | null>(null);
  const [noSectionMsgIdx, setNoSectionMsgIdx] = useState<number | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const prevSectionRef = useRef<string | null | undefined>(null);
  const lastRewriteSectionIdRef = useRef<string | null>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    if (prevSectionRef.current !== reportContext.activeSectionId && reportContext.activeSectionId && messages.length > 0) {
      prevSectionRef.current = reportContext.activeSectionId;
    }
  }, [reportContext.activeSectionId, messages.length]);

  // Handle injected rewrite prompts
  useEffect(() => {
    if (!injectedPrompt) return;

    const sectionTitle = reportContext.activeSectionTitle || 'this section';
    const rewriteMessage = `Rewrite the following text from the "${sectionTitle}" section.

Original text:
"${injectedPrompt.selectedText}"

Instruction: ${injectedPrompt.instruction}

Return only the rewritten text. No preamble, no explanation.`;

    // Store section ID for later replacement
    lastRewriteSectionIdRef.current = injectedPrompt.sectionId;

    // Auto-submit the message
    sendMessage(rewriteMessage);

    // Clear injected prompt after consumption
    if (onInjectedPromptConsumed) {
      onInjectedPromptConsumed();
    }
  }, [injectedPrompt, reportContext.activeSectionTitle, sendMessage, onInjectedPromptConsumed]);

  const currentMode = MODES.find(m => m.id === forcedMode) ?? null;

  const sendMessage = useCallback(async (text?: string) => {
    const raw = (text || input).trim();
    if (!raw || loading) return;
    setInput('');

    const modeInstruction = currentMode?.instruction ?? null;
    const preamble = buildReportPreamble(reportContext, modeInstruction);
    const fullMessage = messages.length === 0 && preamble
      ? `[Context: ${preamble}]\n\n${raw}`
      : raw;

    const userMsg: RailMessage = { role: 'user', content: raw, timestamp: new Date().toISOString() };
    setMessages(prev => [...prev, userMsg]);
    setLoading(true);

    try {
      const body: Record<string, unknown> = { message: fullMessage };
      if (threadId) body.thread_id = threadId;
      const result: any = await api.post('/chat', body);
      if (result.thread_id && !threadId) setThreadId(result.thread_id);
      const assistantMsg: RailMessage = {
        role: 'assistant',
        content: result.answer || result.message || '...',
        timestamp: new Date().toISOString(),
      };
      setMessages(prev => [...prev, assistantMsg]);
    } catch {
      setMessages(prev => [...prev, { role: 'assistant', content: 'Something went wrong. Please try again.', timestamp: new Date().toISOString() }]);
    } finally {
      setLoading(false);
    }
  }, [input, loading, messages.length, threadId, currentMode, reportContext]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const handleModeClick = (modeId: string) => {
    onModeChange(forcedMode === modeId ? null : modeId);
  };

  const startNew = () => {
    setMessages([]);
    setThreadId(null);
    setInput('');
  };

  const handleInsert = useCallback((idx: number, content: string) => {
    // Check if this is a rewrite response (last message after a rewrite prompt)
    const isRewrite = lastRewriteSectionIdRef.current !== null && idx === messages.length - 1;

    if (isRewrite && lastRewriteSectionIdRef.current) {
      // Replace the selected text in the specific section
      replaceSelectionInEditor(content, lastRewriteSectionIdRef.current);
      setInsertedMsgIdx(idx);
      setTimeout(() => setInsertedMsgIdx(n => n === idx ? null : n), 2000);
      // Clear the rewrite ref after use
      lastRewriteSectionIdRef.current = null;
      return;
    }

    // Standard insert flow
    const editor =
      getActiveSectionEditor(reportContext.activeSectionId ?? null) ??
      getAnyActiveEditor();
    if (!editor || editor.isDestroyed) {
      setNoSectionMsgIdx(idx);
      setTimeout(() => setNoSectionMsgIdx(n => n === idx ? null : n), 3000);
      return;
    }
    insertTextIntoEditor(editor, content);
    setInsertedMsgIdx(idx);
    setTimeout(() => setInsertedMsgIdx(n => n === idx ? null : n), 2000);
  }, [reportContext.activeSectionId, messages.length]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', background: colors.surface }}>

      {/* Mode selector bar */}
      <div style={{
        flexShrink: 0,
        padding: '8px 10px',
        borderBottom: `1px solid ${colors.border}`,
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        flexWrap: 'wrap',
        background: colors.surface,
      }}>
        {MODES.map(mode => {
          const active = forcedMode === mode.id;
          return (
            <button
              key={mode.id}
              title={mode.tooltip}
              onClick={() => handleModeClick(mode.id)}
              style={{
                display: 'flex', alignItems: 'center', gap: 5,
                padding: '4px 8px', borderRadius: 20, cursor: 'pointer',
                border: `1px solid ${active ? colors.accent : colors.border}`,
                background: active ? `${colors.accent}18` : 'transparent',
                color: active ? colors.accent : colors.textSecondary,
                fontSize: 11, fontWeight: 600, fontFamily: fonts.sans,
                transition: 'all 0.15s ease',
                flexShrink: 0,
              }}
            >
              <img src={mode.avatar} alt={mode.label} style={{ width: 18, height: 18, borderRadius: '50%', objectFit: 'cover', imageRendering: 'pixelated' }} />
              {mode.label}
            </button>
          );
        })}
        <button
          title="Auto · Pandora picks the right mode"
          onClick={() => onModeChange(null)}
          style={{
            display: 'flex', alignItems: 'center', gap: 5,
            padding: '4px 8px', borderRadius: 20, cursor: 'pointer',
            border: `1px solid ${forcedMode === null ? colors.accent : colors.border}`,
            background: forcedMode === null ? `${colors.accent}18` : 'transparent',
            color: forcedMode === null ? colors.accent : colors.textSecondary,
            fontSize: 11, fontWeight: 600, fontFamily: fonts.sans,
            transition: 'all 0.15s ease',
            flexShrink: 0,
          }}
        >
          <span style={{ fontSize: 13 }}>✦</span>
          Auto
        </button>
        {messages.length > 0 && (
          <button
            onClick={startNew}
            title="Start new conversation"
            style={{
              marginLeft: 'auto', padding: '4px 8px', borderRadius: 20,
              border: `1px solid ${colors.border}`, background: 'transparent',
              color: colors.textMuted, fontSize: 11, fontFamily: fonts.sans,
              cursor: 'pointer', flexShrink: 0,
            }}
          >
            New chat
          </button>
        )}
      </div>

      {/* Messages */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 12px 4px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {messages.length === 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: 1, gap: 12, padding: '24px 16px' }}>
            <span style={{ fontSize: 28 }}>✦</span>
            <p style={{ fontSize: 13, color: colors.textMuted, fontFamily: fonts.sans, textAlign: 'center', margin: 0, lineHeight: 1.6 }}>
              {reportContext.activeSectionTitle
                ? `Ask me about "${reportContext.activeSectionTitle}"`
                : 'Ask me anything about this document'}
            </p>
            {currentMode && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '6px 12px', borderRadius: 20,
                background: `${colors.accent}14`, border: `1px solid ${colors.accent}33`,
              }}>
                <img src={currentMode.avatar} alt={currentMode.label} style={{ width: 20, height: 20, borderRadius: '50%', imageRendering: 'pixelated', objectFit: 'cover' }} />
                <span style={{ fontSize: 12, color: colors.accent, fontFamily: fonts.sans, fontWeight: 600 }}>{currentMode.label} mode</span>
              </div>
            )}
          </div>
        ) : (
          messages.map((msg, i) => (
            <div
              key={i}
              style={{ display: 'flex', flexDirection: 'column', gap: 2, alignItems: msg.role === 'user' ? 'flex-end' : 'flex-start' }}
              onMouseEnter={() => msg.role === 'assistant' && setHoveredMsgIdx(i)}
              onMouseLeave={() => msg.role === 'assistant' && setHoveredMsgIdx(null)}
            >
              {msg.role === 'user' ? (
                <div style={{
                  maxWidth: '85%', padding: '8px 12px', borderRadius: '12px 12px 4px 12px',
                  background: colors.accent, color: '#fff', fontSize: 13, fontFamily: fonts.sans, lineHeight: 1.5,
                }}>
                  {msg.content}
                </div>
              ) : (
                <div style={{ maxWidth: '100%', position: 'relative' }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                    <span style={{ fontSize: 14, flexShrink: 0, marginTop: 2 }}>✦</span>
                    <div style={{ fontSize: 13, lineHeight: 1.6, color: colors.text, fontFamily: fonts.sans, flex: 1 }}>
                      {renderMarkdown(msg.content)}
                    </div>
                  </div>
                  {/* Insert button — appears on hover */}
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    marginTop: 4, marginLeft: 22,
                    opacity: hoveredMsgIdx === i || insertedMsgIdx === i || noSectionMsgIdx === i ? 1 : 0,
                    transition: 'opacity 150ms ease',
                    pointerEvents: hoveredMsgIdx === i ? 'auto' : 'none',
                  }}>
                    <button
                      onClick={() => handleInsert(i, msg.content)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 4,
                        padding: '3px 10px', borderRadius: 12, cursor: 'pointer',
                        border: `1px solid ${insertedMsgIdx === i ? colors.accent : colors.border}`,
                        background: insertedMsgIdx === i ? `${colors.accent}18` : colors.surface,
                        color: insertedMsgIdx === i ? colors.accent : colors.textSecondary,
                        fontSize: 11, fontFamily: fonts.sans, fontWeight: 600,
                        transition: 'all 120ms ease',
                      }}
                    >
                      {insertedMsgIdx === i
                        ? '✓ Inserted'
                        : lastRewriteSectionIdRef.current !== null && i === messages.length - 1
                          ? '↩ Replace selection'
                          : '↓ Insert'}
                    </button>
                    {noSectionMsgIdx === i && (
                      <span style={{ fontSize: 11, color: colors.textMuted, fontFamily: fonts.sans, fontStyle: 'italic' }}>
                        Click into a section first
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))
        )}
        {loading && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '4px 0' }}>
            <span style={{ fontSize: 14 }}>✦</span>
            <div style={{ display: 'flex', gap: 4 }}>
              {[0, 1, 2].map(i => (
                <div key={i} style={{
                  width: 5, height: 5, borderRadius: '50%',
                  background: colors.accent, opacity: 0.7,
                  animation: `pandoraRailDot 1.2s ease-in-out ${i * 0.2}s infinite`,
                }} />
              ))}
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input area */}
      <div style={{
        flexShrink: 0,
        padding: '8px 10px 10px',
        borderTop: `1px solid ${colors.border}`,
        background: colors.surface,
      }}>
        {reportContext.activeSectionTitle && (
          <div style={{ fontSize: 10, color: colors.textMuted, fontFamily: fonts.sans, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ opacity: 0.5 }}>§</span>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '90%' }}>
              {reportContext.activeSectionTitle}
            </span>
          </div>
        )}
        <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end' }}>
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={currentMode ? `${currentMode.label} mode — ask anything…` : 'Ask Pandora…'}
            rows={2}
            style={{
              flex: 1, resize: 'none', padding: '8px 10px', borderRadius: 8,
              border: `1px solid ${colors.border}`,
              background: colors.bg, color: colors.text,
              fontSize: 13, fontFamily: fonts.sans, lineHeight: 1.5,
              outline: 'none',
            }}
          />
          <button
            onClick={() => sendMessage()}
            disabled={!input.trim() || loading}
            style={{
              padding: '8px 12px', borderRadius: 8,
              background: input.trim() && !loading ? colors.accent : colors.border,
              border: 'none', color: '#fff', cursor: input.trim() && !loading ? 'pointer' : 'not-allowed',
              fontSize: 14, fontWeight: 600, flexShrink: 0, alignSelf: 'flex-end',
              transition: 'background 0.15s ease',
            }}
          >
            ↑
          </button>
        </div>
      </div>

      <style>{`
        @keyframes pandoraRailDot {
          0%, 80%, 100% { transform: scale(0.6); opacity: 0.4; }
          40% { transform: scale(1); opacity: 1; }
        }
      `}</style>
    </div>
  );
}
