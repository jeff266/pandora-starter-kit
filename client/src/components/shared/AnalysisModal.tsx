import React, { useState, useEffect } from 'react';
import { api } from '../../lib/api';
import { colors, fonts } from '../../styles/theme';

interface AnalysisModalProps {
  scope: {
    type: 'deal' | 'account' | 'pipeline' | 'rep';
    entity_id?: string;
    rep_email?: string;
  };
  visible: boolean;
  onClose: () => void;
}

function confidenceColor(c: string): string {
  switch (c) {
    case 'high': return colors.green;
    case 'medium': return colors.yellow;
    default: return colors.textMuted;
  }
}

function confidenceBg(c: string): string {
  switch (c) {
    case 'high': return `${colors.green}18`;
    case 'medium': return `${colors.yellow}18`;
    default: return `${colors.textMuted}18`;
  }
}

export default function AnalysisModal({ scope, visible, onClose }: AnalysisModalProps) {
  const [question, setQuestion] = useState('');
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (visible) {
      api.get(`/analyze/suggestions?scope=${scope.type}`)
        .then((data: any) => setSuggestions(data.suggestions || []))
        .catch(() => {});
    }
  }, [visible, scope.type]);

  useEffect(() => {
    if (!visible) {
      setQuestion('');
      setResult(null);
      setError('');
    }
  }, [visible]);

  const runAnalysis = async (q: string) => {
    if (!q.trim() || loading) return;
    setLoading(true);
    setError('');
    try {
      const res = await api.post('/analyze', {
        question: q.trim(),
        scope,
      });
      setResult(res);
    } catch (err: any) {
      const msg = err.message || '';
      if (msg.includes('429') || msg.includes('rate limit')) {
        setError('Analysis limit reached. Try again in a few minutes.');
      } else {
        setError(msg || 'Analysis failed');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    runAnalysis(question);
  };

  if (!visible) return null;

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 2000,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)',
      }}
      onClick={onClose}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 640, maxHeight: '80vh',
          background: colors.surface,
          border: `1px solid ${colors.border}`,
          borderRadius: 12, overflow: 'auto',
          boxShadow: '0 20px 60px rgba(0,0,0,0.4)',
        }}
      >
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '16px 20px', borderBottom: `1px solid ${colors.border}`,
        }}>
          <h3 style={{ fontSize: 15, fontWeight: 600, color: colors.text, margin: 0 }}>
            Ask about this {scope.type}
          </h3>
          <button
            onClick={onClose}
            style={{
              background: 'none', border: 'none', color: colors.textMuted,
              fontSize: 18, cursor: 'pointer', padding: '2px 6px', lineHeight: 1,
            }}
          >
            &times;
          </button>
        </div>

        <div style={{ padding: 20 }}>
          <form onSubmit={handleSubmit} style={{ display: 'flex', gap: 8 }}>
            <input
              type="text"
              value={question}
              onChange={e => setQuestion(e.target.value)}
              placeholder={suggestions[0] || `Ask a question about this ${scope.type}...`}
              disabled={loading}
              autoFocus
              style={{
                flex: 1, fontSize: 13, padding: '10px 14px',
                background: colors.surfaceRaised,
                border: `1px solid ${colors.border}`,
                borderRadius: 8, color: colors.text, outline: 'none',
              }}
            />
            <button
              type="submit"
              disabled={loading || !question.trim()}
              style={{
                fontSize: 12, fontWeight: 600, padding: '10px 18px',
                background: loading || !question.trim() ? colors.surfaceRaised : colors.accent,
                color: loading || !question.trim() ? colors.textMuted : '#fff',
                border: 'none', borderRadius: 8,
                cursor: loading || !question.trim() ? 'not-allowed' : 'pointer',
              }}
            >
              {loading ? 'Analyzing...' : 'Ask'}
            </button>
          </form>

          {suggestions.length > 0 && !result && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 12 }}>
              {suggestions.slice(0, 4).map((s, i) => (
                <button
                  key={i}
                  onClick={() => { setQuestion(s); runAnalysis(s); }}
                  disabled={loading}
                  style={{
                    fontSize: 11, padding: '5px 10px', borderRadius: 6,
                    background: colors.surfaceRaised,
                    border: `1px solid ${colors.border}`,
                    color: colors.accent, cursor: loading ? 'not-allowed' : 'pointer',
                    transition: 'all 0.15s',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = colors.accentSoft; e.currentTarget.style.borderColor = colors.accent; }}
                  onMouseLeave={e => { e.currentTarget.style.background = colors.surfaceRaised; e.currentTarget.style.borderColor = colors.border; }}
                >
                  {s}
                </button>
              ))}
            </div>
          )}

          {loading && (
            <div style={{ padding: 32, textAlign: 'center' }}>
              <div style={{
                width: 28, height: 28,
                border: `3px solid ${colors.border}`,
                borderTopColor: colors.accent,
                borderRadius: '50%',
                animation: 'spin 0.8s linear infinite',
                margin: '0 auto 12px',
              }} />
              <p style={{ fontSize: 13, color: colors.textSecondary }}>Analyzing...</p>
            </div>
          )}

          {error && (
            <div style={{
              marginTop: 16, padding: 12, borderRadius: 8,
              background: colors.redSoft,
              border: `1px solid ${colors.red}33`,
              color: colors.red, fontSize: 12,
            }}>
              {error}
            </div>
          )}

          {result && !loading && (
            <div style={{ marginTop: 16 }}>
              <div style={{
                padding: 16, borderRadius: 8,
                background: colors.surfaceRaised,
                border: `1px solid ${colors.borderLight}`,
              }}>
                <p style={{
                  fontSize: 13, lineHeight: 1.7, color: colors.text,
                  margin: 0, whiteSpace: 'pre-wrap',
                }}>
                  {result.answer}
                </p>

                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
                  {result.confidence && (
                    <span style={{
                      fontSize: 10, fontWeight: 600, padding: '2px 8px',
                      borderRadius: 4,
                      background: confidenceBg(result.confidence),
                      color: confidenceColor(result.confidence),
                      textTransform: 'uppercase',
                    }}>
                      {result.confidence} confidence
                    </span>
                  )}

                  {Array.isArray(result.data_consulted) && result.data_consulted.map((d: string, i: number) => (
                    <span key={i} style={{
                      fontSize: 10, padding: '2px 6px', borderRadius: 3,
                      background: `${colors.accent}12`,
                      color: colors.accent,
                    }}>
                      {d}
                    </span>
                  ))}
                </div>

                <div style={{
                  display: 'flex', gap: 12, marginTop: 10,
                  fontSize: 10, color: colors.textDim, fontFamily: fonts.mono,
                }}>
                  {result.tokens_used && <span>{result.tokens_used} tokens</span>}
                  {result.latency_ms && <span>{(result.latency_ms / 1000).toFixed(1)}s</span>}
                </div>
              </div>

              {Array.isArray(result.suggested_followups) && result.suggested_followups.length > 0 && (
                <div style={{ marginTop: 12 }}>
                  <span style={{ fontSize: 10, fontWeight: 600, color: colors.textDim, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    Follow-up questions
                  </span>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
                    {result.suggested_followups.map((f: string, i: number) => (
                      <button
                        key={i}
                        onClick={() => { setQuestion(f); setResult(null); runAnalysis(f); }}
                        style={{
                          fontSize: 11, padding: '5px 10px', borderRadius: 6,
                          background: colors.surfaceRaised,
                          border: `1px solid ${colors.border}`,
                          color: colors.accent, cursor: 'pointer',
                          transition: 'all 0.15s',
                        }}
                        onMouseEnter={e => { e.currentTarget.style.background = colors.accentSoft; }}
                        onMouseLeave={e => { e.currentTarget.style.background = colors.surfaceRaised; }}
                      >
                        {f}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
