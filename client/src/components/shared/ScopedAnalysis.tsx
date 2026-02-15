import React, { useState } from 'react';
import { api } from '../../lib/api';
import { colors, fonts } from '../../styles/theme';

interface ScopedAnalysisProps {
  scope: {
    type: 'deal' | 'account' | 'pipeline' | 'rep' | 'workspace';
    entity_id?: string;
    rep_email?: string;
  };
  workspaceId: string;
}

export default function ScopedAnalysis({ scope, workspaceId }: ScopedAnalysisProps) {
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!question.trim() || loading) return;

    setLoading(true);
    setError('');

    try {
      const result = await api.post('/analyze', {
        question: question.trim(),
        scope,
      });
      setAnswer(result);
    } catch (err: any) {
      setError(err.message || 'Failed to get answer');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        background: colors.surface,
        border: `1px solid ${colors.border}`,
        borderRadius: 10,
        padding: 20,
      }}
    >
      <h3 style={{ fontSize: 13, fontWeight: 600, color: colors.text, marginBottom: 12 }}>
        Ask about this {scope.type}
      </h3>

      <form onSubmit={handleSubmit} style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <input
          type="text"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder={`What would you like to know about this ${scope.type}?`}
          disabled={loading}
          style={{
            flex: 1,
            fontSize: 13,
            padding: '8px 12px',
            background: colors.surfaceRaised,
            border: `1px solid ${colors.border}`,
            borderRadius: 6,
            color: colors.text,
            outline: 'none',
          }}
        />
        <button
          type="submit"
          disabled={loading || !question.trim()}
          style={{
            fontSize: 12,
            fontWeight: 500,
            padding: '8px 16px',
            background: loading || !question.trim() ? colors.surfaceRaised : colors.accentSoft,
            color: loading || !question.trim() ? colors.textMuted : colors.accent,
            border: 'none',
            borderRadius: 6,
            cursor: loading || !question.trim() ? 'not-allowed' : 'pointer',
          }}
        >
          {loading ? 'Analyzing...' : 'Ask'}
        </button>
      </form>

      {error && (
        <div
          style={{
            padding: 12,
            background: colors.redSoft,
            border: `1px solid ${colors.red}33`,
            borderRadius: 6,
            color: colors.red,
            fontSize: 12,
          }}
        >
          {error}
        </div>
      )}

      {answer && (
        <div
          style={{
            padding: 16,
            background: colors.surfaceRaised,
            border: `1px solid ${colors.borderLight}`,
            borderRadius: 6,
          }}
        >
          <p
            style={{
              fontSize: 13,
              lineHeight: 1.6,
              color: colors.text,
              margin: 0,
              marginBottom: 12,
            }}
          >
            {answer.answer}
          </p>

          <div
            style={{
              display: 'flex',
              gap: 16,
              fontSize: 11,
              color: colors.textMuted,
              fontFamily: fonts.mono,
            }}
          >
            {answer.data_consulted && (
              <span>
                Data: {Object.values(answer.data_consulted).filter((v: any) => typeof v === 'number' && v > 0).length} sources
              </span>
            )}
            {answer.tokens_used && (
              <span>{answer.tokens_used} tokens</span>
            )}
            {answer.latency_ms && (
              <span>{(answer.latency_ms / 1000).toFixed(1)}s</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
