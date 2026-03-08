import React, { useState, useEffect, useRef } from 'react';
import { X, ArrowLeft, Send, Loader2 } from 'lucide-react';
import { api, getWorkspaceId } from '../../lib/api';
import { colors, fonts } from '../../styles/theme';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

interface GuidedAgentChatProps {
  workspaceId: string;
  onReadyToSave: (result: any, conversationId: string) => void;
  onClose: () => void;
}

const OPENING_MESSAGE = "What business outcome do you want to stay on top of week over week?";

export default function GuidedAgentChat({ workspaceId, onReadyToSave, onClose }: GuidedAgentChatProps) {
  const [messages, setMessages] = useState<Message[]>([
    { role: 'assistant', content: OPENING_MESSAGE },
  ]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [userTurnCount, setUserTurnCount] = useState(0);
  const [inputText, setInputText] = useState('');
  const [sending, setSending] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, extracting]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  async function handleSend() {
    const text = inputText.trim();
    if (!text || sending || extracting) return;

    const userMessage: Message = { role: 'user', content: text };
    const allMessages = [...messages, userMessage];

    setMessages(allMessages);
    setInputText('');
    setSending(true);

    try {
      const res = await api.post(`/chat/guided-agent`, {
        messages: allMessages,
        conversation_id: conversationId || undefined,
      });

      const { message, shouldExtract, conversation_id: newConvId } = res;

      if (!conversationId && newConvId) {
        setConversationId(newConvId);
      }

      const newUserTurnCount = userTurnCount + 1;
      setUserTurnCount(newUserTurnCount);
      setMessages(prev => [...prev, { role: 'assistant', content: message }]);
      setSending(false);

      if (shouldExtract) {
        const finalConvId = conversationId || newConvId;
        setExtracting(true);
        try {
          const extractionResult = await api.post(`/chat/extract-agent`, {
            conversation_id: finalConvId,
          });
          onReadyToSave(extractionResult, finalConvId);
        } catch {
          onReadyToSave(null, finalConvId);
        }
      }
    } catch (err) {
      console.error('[guided-agent] send error:', err);
      setSending(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  const showReadyHint = userTurnCount >= 2 && !extracting && !sending;

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1100,
      background: 'rgba(0,0,0,0.55)',
      display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
    }} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{
        width: '100%', maxWidth: 520,
        height: '100%',
        background: colors.surface,
        borderLeft: `1px solid ${colors.border}`,
        display: 'flex', flexDirection: 'column',
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '14px 18px',
          borderBottom: `1px solid ${colors.border}`,
          flexShrink: 0,
        }}>
          <button onClick={onClose} style={btnGhost}>
            <ArrowLeft size={15} />
          </button>
          <div style={{ flex: 1 }}>
            <div style={{ font: `600 15px ${fonts.sans}`, color: colors.text }}>Create an Agent</div>
            <div style={{ font: `400 12px ${fonts.sans}`, color: colors.textMuted, marginTop: 1 }}>
              Describe what you want to track — Pandora builds the rest
            </div>
          </div>
          <button onClick={onClose} style={btnGhost}>
            <X size={16} />
          </button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {messages.map((m, i) => (
            <div key={i} style={{
              display: 'flex',
              justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start',
            }}>
              <div style={{
                maxWidth: '82%',
                padding: '10px 14px',
                borderRadius: m.role === 'user' ? '12px 12px 3px 12px' : '12px 12px 12px 3px',
                background: m.role === 'user' ? colors.accent : colors.surfaceRaised,
                border: m.role === 'user' ? 'none' : `1px solid ${colors.border}`,
                font: `400 14px ${fonts.sans}`,
                color: m.role === 'user' ? '#fff' : colors.text,
                lineHeight: 1.55,
              }}>
                {m.content}
              </div>
            </div>
          ))}

          {(sending || extracting) && (
            <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
              <div style={{
                padding: '10px 14px',
                borderRadius: '12px 12px 12px 3px',
                background: colors.surfaceRaised,
                border: `1px solid ${colors.border}`,
                display: 'flex', alignItems: 'center', gap: 8,
                font: `400 14px ${fonts.sans}`,
                color: colors.textMuted,
              }}>
                <Loader2 size={14} style={{ animation: 'spin 1s linear infinite', flexShrink: 0 }} />
                {extracting ? 'Building your Agent config…' : '…'}
              </div>
            </div>
          )}

          <div ref={bottomRef} />
        </div>

        <div style={{
          flexShrink: 0,
          borderTop: `1px solid ${colors.border}`,
          padding: '12px 16px',
          background: colors.surface,
        }}>
          {showReadyHint && (
            <div style={{
              font: `400 12px ${fonts.sans}`,
              color: colors.textMuted,
              marginBottom: 8,
              textAlign: 'center',
            }}>
              Ready to build? Hit send or type one more thought.
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
            <textarea
              ref={inputRef}
              value={inputText}
              onChange={e => setInputText(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={sending || extracting}
              placeholder="Describe what you want to track…"
              rows={2}
              style={{
                flex: 1,
                background: colors.surfaceRaised,
                border: `1px solid ${colors.border}`,
                borderRadius: 8,
                padding: '9px 12px',
                font: `400 14px ${fonts.sans}`,
                color: colors.text,
                resize: 'none',
                outline: 'none',
                lineHeight: 1.5,
              }}
            />
            <button
              onClick={handleSend}
              disabled={!inputText.trim() || sending || extracting}
              style={{
                ...btnPrimary,
                opacity: (!inputText.trim() || sending || extracting) ? 0.5 : 1,
                padding: '10px 14px',
                flexShrink: 0,
              }}
            >
              <Send size={14} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

const btnGhost: React.CSSProperties = {
  background: 'none', border: 'none', cursor: 'pointer',
  color: colors.textMuted, padding: 4, borderRadius: 4,
  display: 'inline-flex', alignItems: 'center',
};

const btnPrimary: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 6,
  font: `500 13px ${fonts.sans}`,
  color: '#fff', background: colors.accent,
  border: 'none', borderRadius: 8,
  cursor: 'pointer',
};
