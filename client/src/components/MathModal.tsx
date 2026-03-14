import React, { useState, useEffect, useRef, useCallback } from 'react';
import { api } from '../lib/api';
import { useWorkspace } from '../context/WorkspaceContext';

interface MathBreakdownRow {
  label: string;
  value: string | number;
  warn?: boolean;
  good?: boolean;
  bold?: boolean;
}

interface MathRecord {
  [key: string]: string | number;
}

interface MathAction {
  id: string;
  title: string;
  description?: string;
  status: 'pending' | 'in_progress' | 'done';
}

interface MathData {
  title: string;
  type?: string;
  calculation?: {
    numerator?: { value: string | number; label: string };
    denominator?: { value: string | number; label: string };
    result?: { value: string | number; color?: string };
    note?: string;
  };
  breakdown?: MathBreakdownRow[];
  records?: { columns: string[]; rows: MathRecord[] };
  actions?: MathAction[];
  suggestions?: string[];
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface MathModalProps {
  mathKey: string | null;
  onClose: () => void;
  onActionApproved?: (actionId: string) => void;
  onActionsIgnored?: (actionIds: string[]) => void;
}

const S = {
  bg: '#090c12',
  surface: '#0f1219',
  surface2: '#141820',
  border: '#1a1f2b',
  border2: '#242b3a',
  text: '#e8ecf4',
  textSub: '#94a3b8',
  textMuted: '#5a6578',
  textDim: '#3a4252',
  teal: '#1D9E75',
  blue: '#378ADD',
  yellow: '#eab308',
  red: '#ef4444',
  font: "'IBM Plex Sans', -apple-system, sans-serif",
};

function typeColor(type?: string) {
  if (!type) return S.teal;
  if (type === 'coverage') return S.blue;
  if (type === 'attainment') return S.teal;
  if (type === 'risk') return S.red;
  return S.teal;
}

export default function MathModal({ mathKey, onClose, onActionApproved, onActionsIgnored }: MathModalProps) {
  const { currentWorkspace, user } = useWorkspace();
  const [data, setData] = useState<MathData | null>(null);
  const [loading, setLoading] = useState(false);
  const [recordsOpen, setRecordsOpen] = useState(false);
  const [actions, setActions] = useState<MathAction[]>([]);
  const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({});
  const [actionDone, setActionDone] = useState<Set<string>>(new Set());
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!mathKey || !currentWorkspace?.id) return;
    setLoading(true);
    setData(null);
    setRecordsOpen(false);
    setMessages([]);
    api.get(`/briefing/math/${mathKey}`)
      .then((d: MathData) => { setData(d); setActions(d.actions || []); })
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [mathKey, currentWorkspace?.id]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleApprove = useCallback(async (actionId: string) => {
    if (!currentWorkspace?.id || !user?.id) return;
    setActionLoading(prev => ({ ...prev, [actionId]: true }));
    try {
      await api.post(`/actions/${actionId}/execute-inline`, { user_id: user.id });
      setActionDone(prev => new Set([...prev, actionId]));
      onActionApproved?.(actionId);
    } catch {}
    setActionLoading(prev => ({ ...prev, [actionId]: false }));
  }, [currentWorkspace?.id, user?.id, onActionApproved]);

  const handleClose = useCallback(() => {
    if (onActionsIgnored && actions.length > 0) {
      const ignoredIds = actions.filter(a => !actionDone.has(a.id)).map(a => a.id);
      if (ignoredIds.length > 0) onActionsIgnored(ignoredIds);
    }
    onClose();
  }, [actions, actionDone, onActionsIgnored, onClose]);

  const handleSend = useCallback(async (msg?: string) => {
    const text = msg ?? input.trim();
    if (!text || !currentWorkspace?.id) return;
    setInput('');
    const userMsg: ChatMessage = { role: 'user', content: text };
    setMessages(prev => [...prev, userMsg]);
    setSending(true);
    try {
      const resp = await api.post('/chat', {
        message: text,
        scope: { mathKey, workspaceId: currentWorkspace.id },
      });
      const reply = resp?.answer || resp?.response || resp?.message || JSON.stringify(resp);
      setMessages(prev => [...prev, { role: 'assistant', content: reply }]);
    } catch {
      setMessages(prev => [...prev, { role: 'assistant', content: 'Sorry, something went wrong.' }]);
    }
    setSending(false);
  }, [input, mathKey, currentWorkspace?.id]);

  if (!mathKey) return null;

  const color = typeColor(data?.type);

  return (
    <div
      onClick={handleClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0,0,0,0.6)', display: 'flex',
        alignItems: 'center', justifyContent: 'center',
        padding: 20,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: S.bg,
          border: `0.5px solid ${S.border}`,
          borderRadius: 12,
          width: '100%',
          maxWidth: 660,
          maxHeight: '88vh',
          display: 'flex',
          flexDirection: 'column',
          fontFamily: S.font,
          overflow: 'hidden',
        }}
      >
        {/* HEADER */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 18px', borderBottom: `0.5px solid ${S.border}`, flexShrink: 0 }}>
          <span style={{
            fontSize: 10, fontWeight: 700, color, background: `${color}22`,
            border: `0.5px solid ${color}44`, borderRadius: 99, padding: '2px 8px',
            textTransform: 'uppercase', letterSpacing: '0.04em',
          }}>
            ∑ Show math
          </span>
          <span style={{ flex: 1, fontSize: 14, fontWeight: 600, color: S.text }}>
            {loading ? 'Loading…' : (data?.title || mathKey)}
          </span>
          <button onClick={handleClose} style={{ background: 'none', border: 'none', color: S.textMuted, fontSize: 18, cursor: 'pointer', lineHeight: 1 }}>×</button>
        </div>

        {/* BODY */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 18px' }}>
          {loading && (
            <div style={{ color: S.textMuted, fontSize: 13, textAlign: 'center', padding: 32 }}>Loading math…</div>
          )}

          {!loading && data && (
            <>
              {/* CALCULATION */}
              {data.calculation && (
                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: S.textDim, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>
                    The Calculation
                  </div>
                  {data.calculation.numerator && data.calculation.denominator && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 12, flexWrap: 'wrap' }}>
                      <div style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: 22, fontWeight: 600, color: S.text }}>{data.calculation.numerator.value}</div>
                        <div style={{ fontSize: 10, color: S.textMuted }}>{data.calculation.numerator.label}</div>
                      </div>
                      <div style={{ fontSize: 18, color: S.textDim }}>÷</div>
                      <div style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: 22, fontWeight: 600, color: S.text }}>{data.calculation.denominator.value}</div>
                        <div style={{ fontSize: 10, color: S.textMuted }}>{data.calculation.denominator.label}</div>
                      </div>
                      <div style={{ fontSize: 18, color: S.textDim }}>=</div>
                      <div style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: 26, fontWeight: 700, color: data.calculation.result?.color || color }}>
                          {data.calculation.result?.value ?? '—'}
                        </div>
                      </div>
                    </div>
                  )}
                  {data.calculation.note && (
                    <div style={{
                      background: S.surface2,
                      borderLeft: `2px solid ${S.border2}`,
                      borderRadius: 6,
                      padding: '8px 12px',
                      fontSize: 12,
                      color: S.textSub,
                      lineHeight: 1.5,
                    }}>
                      {data.calculation.note}
                    </div>
                  )}
                </div>
              )}

              {/* BREAKDOWN */}
              {data.breakdown && data.breakdown.length > 0 && (
                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: S.textDim, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
                    Breakdown
                  </div>
                  <div style={{ background: S.surface, border: `0.5px solid ${S.border}`, borderRadius: 8, padding: '10px 12px' }}>
                    {data.breakdown.map((row, i) => (
                      <div key={i} style={{
                        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                        padding: '5px 0', borderBottom: i < data.breakdown!.length - 1 ? `0.5px solid ${S.border}` : 'none',
                      }}>
                        <span style={{ fontSize: 12, color: S.textSub }}>{row.label}</span>
                        <span style={{
                          fontSize: 12,
                          fontWeight: row.bold ? 700 : 400,
                          color: row.warn ? S.red : row.good ? S.teal : S.text,
                        }}>
                          {row.value}
                        </span>
                      </div>
                    ))}

                    {/* Records toggle */}
                    {data.records && data.records.rows.length > 0 && (
                      <div style={{ marginTop: 8 }}>
                        <button
                          onClick={() => setRecordsOpen(v => !v)}
                          style={{ background: 'none', border: 'none', color: S.textMuted, fontSize: 11, cursor: 'pointer', padding: 0 }}
                        >
                          {recordsOpen ? '▾ Collapse' : '▸ Underlying records'}
                        </button>
                        {recordsOpen && (
                          <div style={{ overflowX: 'auto', marginTop: 8 }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                              <thead>
                                <tr>
                                  {data.records.columns.map(col => (
                                    <th key={col} style={{ textAlign: 'left', padding: '4px 8px', color: S.textMuted, fontWeight: 600 }}>{col}</th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody>
                                {data.records.rows.map((row, ri) => (
                                  <tr key={ri}>
                                    {data.records!.columns.map((col, ci) => (
                                      <td key={col} style={{
                                        padding: '4px 8px', color: ci === data.records!.columns.length - 1 ? S.text : S.textSub,
                                        textAlign: ci === data.records!.columns.length - 1 ? 'right' : 'left',
                                        borderTop: `0.5px solid ${S.border}`,
                                      }}>
                                        {String(row[col] ?? '')}
                                      </td>
                                    ))}
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* ACTIONS */}
              {actions.length > 0 && (
                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: S.textDim, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
                    Actions
                  </div>
                  {actions.map(action => {
                    const done = actionDone.has(action.id);
                    const busy = actionLoading[action.id];
                    const statusBg = done ? 'rgba(29,158,117,0.10)' : action.status === 'in_progress' ? 'rgba(55,138,221,0.10)' : 'rgba(234,179,8,0.10)';
                    const statusBorder = done ? 'rgba(29,158,117,0.22)' : action.status === 'in_progress' ? 'rgba(55,138,221,0.22)' : 'rgba(234,179,8,0.22)';
                    return (
                      <div key={action.id} style={{
                        background: statusBg, border: `0.5px solid ${statusBorder}`,
                        borderRadius: 8, padding: '10px 12px', marginBottom: 8,
                      }}>
                        <div style={{ fontSize: 13, fontWeight: 500, color: S.text, marginBottom: 4 }}>{action.title}</div>
                        {action.description && <div style={{ fontSize: 11, color: S.textSub, marginBottom: 8 }}>{action.description}</div>}
                        {!done && (
                          <div style={{ display: 'flex', gap: 8 }}>
                            <button
                              onClick={() => handleApprove(action.id)}
                              disabled={busy}
                              style={{
                                fontSize: 11, fontWeight: 600, background: S.teal, color: '#fff',
                                border: 'none', borderRadius: 6, padding: '5px 12px', cursor: busy ? 'not-allowed' : 'pointer',
                                opacity: busy ? 0.7 : 1,
                              }}
                            >
                              {busy ? 'Approving…' : 'Approve & execute'}
                            </button>
                            <button style={{
                              fontSize: 11, background: 'none', color: S.textMuted,
                              border: `0.5px solid ${S.border2}`, borderRadius: 6, padding: '5px 12px', cursor: 'pointer',
                            }}>
                              Modify
                            </button>
                            <button style={{
                              fontSize: 11, background: 'none', color: S.textDim,
                              border: 'none', padding: '5px 0', cursor: 'pointer',
                            }}>
                              Reject
                            </button>
                          </div>
                        )}
                        {done && <div style={{ fontSize: 11, color: S.teal, fontWeight: 600 }}>✓ Done</div>}
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}

          {!loading && !data && (
            <div style={{ color: S.textMuted, fontSize: 13, textAlign: 'center', padding: 32 }}>
              No math data available for this key.
            </div>
          )}
        </div>

        {/* CHAT THREAD */}
        <div style={{ borderTop: `0.5px solid ${S.border}`, flexShrink: 0, padding: '10px 18px 14px' }}>
          {messages.length > 0 && (
            <div style={{ maxHeight: 180, overflowY: 'auto', marginBottom: 10 }}>
              {messages.map((msg, i) => (
                <div key={i} style={{
                  display: 'flex', justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start',
                  marginBottom: 6,
                }}>
                  {msg.role === 'assistant' && (
                    <div style={{
                      width: 20, height: 20, borderRadius: '50%', background: S.teal,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 9, color: '#fff', fontWeight: 700, flexShrink: 0, marginRight: 6, marginTop: 2,
                    }}>P</div>
                  )}
                  <div style={{
                    maxWidth: '75%', fontSize: 12, lineHeight: 1.5, padding: '7px 10px', borderRadius: 8,
                    background: msg.role === 'user' ? '#1e3a5f' : S.surface2,
                    color: S.text, borderTopRightRadius: msg.role === 'user' ? 2 : 8,
                    borderTopLeftRadius: msg.role === 'assistant' ? 2 : 8,
                  }}>
                    {msg.content}
                  </div>
                </div>
              ))}
              <div ref={chatEndRef} />
            </div>
          )}

          {/* Suggestion chips */}
          {data?.suggestions && data.suggestions.length > 0 && messages.length === 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
              {data.suggestions.map((s, i) => (
                <button
                  key={i}
                  onClick={() => handleSend(s)}
                  style={{
                    fontSize: 11, color: S.textMuted, background: 'none',
                    border: `0.5px solid ${S.border2}`, borderRadius: 99,
                    padding: '3px 10px', cursor: 'pointer', fontFamily: S.font,
                  }}
                >
                  {s}
                </button>
              ))}
            </div>
          )}

          {/* Input row */}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
              placeholder="Ask Pandora about this metric…"
              style={{
                flex: 1, background: S.surface2, border: `0.5px solid ${S.border2}`,
                borderRadius: 8, padding: '8px 12px', fontSize: 12, color: S.text,
                fontFamily: S.font, outline: 'none',
              }}
            />
            <button
              onClick={() => handleSend()}
              disabled={!input.trim() || sending}
              style={{
                background: S.teal, color: '#fff', border: 'none', borderRadius: 8,
                padding: '8px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
                opacity: (!input.trim() || sending) ? 0.6 : 1, fontFamily: S.font,
              }}
            >
              Send
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
