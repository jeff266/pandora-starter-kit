import React, { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import { api } from '../../lib/api';
import { colors, fonts } from '../../styles/theme';

interface LearnedPreferencesProps {
  workspaceId: string;
  agentId: string;
}

interface TuningPair {
  key: string;
  instruction: string;
  confidence: number;
  source: string;
  created_at?: string;
  feedback_id?: string;
}

export default function LearnedPreferences({ workspaceId, agentId }: LearnedPreferencesProps) {
  const [tuningPairs, setTuningPairs] = useState<TuningPair[]>([]);
  const [count, setCount] = useState(0);
  const [cap, setCap] = useState(15);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadTuningPairs();
  }, [workspaceId, agentId]);

  async function loadTuningPairs() {
    try {
      setLoading(true);
      const data = await api.get(`/agents/${agentId}/tuning`);
      setTuningPairs(data.tuning_pairs || []);
      setCount(data.count || 0);
      setCap(data.cap || 15);
    } catch (err) {
      console.error('Failed to load tuning pairs:', err);
    } finally {
      setLoading(false);
    }
  }

  async function deleteTuningPair(key: string) {
    try {
      await api.delete(`/agents/${agentId}/tuning/${encodeURIComponent(key)}`);
      // Optimistically remove from UI
      setTuningPairs((prev) => prev.filter((p) => p.key !== key));
      setCount((prev) => prev - 1);
    } catch (err) {
      console.error('Failed to delete tuning pair:', err);
      alert('Failed to delete preference');
      // Reload on error
      loadTuningPairs();
    }
  }

  function formatRelativeDate(dateStr?: string): string {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return 'today';
    if (diffDays === 1) return 'yesterday';
    if (diffDays < 7) return `${diffDays} days ago`;
    if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
    return `${Math.floor(diffDays / 30)} months ago`;
  }

  if (loading) {
    return (
      <div style={{
        marginTop: 32,
        paddingTop: 32,
        borderTop: `1px solid ${colors.border}`,
      }}>
        <div style={{ fontSize: 14, color: colors.textMuted, fontFamily: fonts.sans }}>
          Loading learned preferences...
        </div>
      </div>
    );
  }

  return (
    <div style={{
      marginTop: 32,
      paddingTop: 32,
      borderTop: `1px solid ${colors.border}`,
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <h3 style={{ fontSize: 18, fontWeight: 600, color: colors.text, fontFamily: fonts.sans, margin: 0 }}>
          Learned Preferences
        </h3>
        <span style={{
          padding: '4px 8px',
          background: colors.surfaceRaised,
          color: colors.textMuted,
          fontSize: 12,
          fontWeight: 500,
          borderRadius: 4,
          fontFamily: fonts.sans,
        }}>
          {count}/{cap} active
        </span>
      </div>

      {/* Description */}
      <p style={{
        fontSize: 14,
        color: colors.textMuted,
        fontFamily: fonts.sans,
        marginBottom: 16,
      }}>
        These preferences were learned from your feedback on previous briefings. The agent applies them on every run.
      </p>

      {/* Empty state */}
      {tuningPairs.length === 0 && (
        <p style={{
          fontSize: 14,
          color: colors.textMuted,
          fontStyle: 'italic',
          fontFamily: fonts.sans,
          margin: 0,
        }}>
          No preferences yet. Give feedback on a briefing to start teaching the agent.
        </p>
      )}

      {/* Tuning pairs list */}
      {tuningPairs.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {tuningPairs.map((pair) => (
            <div
              key={pair.key}
              style={{
                display: 'flex',
                alignItems: 'start',
                gap: 12,
                padding: 12,
                background: colors.surfaceRaised,
                borderRadius: 8,
                border: `1px solid ${colors.border}`,
              }}
            >
              <div style={{ flex: 1 }}>
                <p style={{
                  fontSize: 14,
                  color: colors.text,
                  fontFamily: fonts.sans,
                  margin: '0 0 4px 0',
                  lineHeight: 1.5,
                }}>
                  {pair.instruction}
                </p>
                <p style={{
                  fontSize: 12,
                  color: colors.textMuted,
                  fontFamily: fonts.sans,
                  margin: 0,
                }}>
                  Confidence: {Math.round(pair.confidence * 100)}%
                  {pair.created_at && (
                    <>
                      {' · '}
                      {formatRelativeDate(pair.created_at)}
                    </>
                  )}
                </p>
              </div>
              <button
                onClick={() => deleteTuningPair(pair.key)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: colors.textMuted,
                  cursor: 'pointer',
                  padding: 4,
                }}
                onMouseEnter={(e) => (e.currentTarget.style.color = colors.text)}
                onMouseLeave={(e) => (e.currentTarget.style.color = colors.textMuted)}
              >
                <X style={{ width: 16, height: 16 }} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
