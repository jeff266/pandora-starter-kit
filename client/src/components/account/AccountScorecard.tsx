import React from 'react';
import { useScores } from '../../hooks/useScores';
import { colors } from '../../styles/theme';
import { TrendingUp, Target, Zap, Users, Calendar, RefreshCw } from 'lucide-react';

interface AccountScorecardProps {
  accountId: string;
  workspaceId: string;
  className?: string;
}

export function AccountScorecard({ accountId, workspaceId, className }: AccountScorecardProps) {
  const { scores, loading, error, recalculateScores } = useScores({ accountId });
  const [recalculating, setRecalculating] = React.useState(false);

  const handleRecalculate = async () => {
    try {
      setRecalculating(true);
      await recalculateScores();
    } catch (err) {
      console.error('Failed to recalculate scores:', err);
    } finally {
      setRecalculating(false);
    }
  };

  if (loading) {
    return (
      <div style={{ padding: 24 }} className={className}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ height: 32, background: colors.surfaceHover, borderRadius: 8, width: '33%' }} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {[1, 2, 3, 4].map(i => (
              <div key={i} style={{ height: 64, background: colors.surfaceHover, borderRadius: 8 }} />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (error || !scores) {
    return (
      <div style={{ padding: 24 }} className={className}>
        <div style={{ color: colors.red, fontSize: 13 }}>
          {error || 'No scores available for this account'}
        </div>
      </div>
    );
  }

  const getTierColor = (tier: string) => {
    switch (tier) {
      case 'A': return { bg: '#dcfce7', color: '#166534', border: '#86efac' };
      case 'B': return { bg: '#dbeafe', color: '#1e40af', border: '#93c5fd' };
      case 'C': return { bg: '#fef3c7', color: '#92400e', border: '#fcd34d' };
      case 'D': return { bg: '#fee2e2', color: '#991b1b', border: '#fca5a5' };
      case 'HOT': return { bg: '#fef3c7', color: '#dc2626', border: '#fcd34d' };
      case 'WARM': return { bg: '#dbeafe', color: '#2563eb', border: '#93c5fd' };
      case 'COLD': return { bg: '#f3f4f6', color: '#6b7280', border: '#d1d5db' };
      default: return { bg: '#f3f4f6', color: '#6b7280', border: '#d1d5db' };
    }
  };

  const icpColors = getTierColor(scores.icp_tier);
  const leadColors = getTierColor(scores.lead_tier);

  const scoreMetrics = [
    { label: 'Intent Score', value: scores.intent_score, icon: Zap, color: '#8b5cf6' },
    { label: 'Engagement', value: scores.engagement_score, icon: Users, color: '#3b82f6' },
    { label: 'Fit Score', value: scores.fit_score, icon: Target, color: '#10b981' },
    { label: 'Recency', value: scores.recency_score, icon: Calendar, color: '#f59e0b' },
  ];

  return (
    <div className={className}>
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: 16,
          borderBottom: `1px solid ${colors.border}`,
        }}
      >
        <h3 style={{ fontSize: 18, fontWeight: 600, color: colors.text, margin: 0 }}>
          Account Scores
        </h3>
        <button
          onClick={handleRecalculate}
          disabled={recalculating}
          style={{
            fontSize: 11,
            color: colors.accent,
            background: 'transparent',
            border: 'none',
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            opacity: recalculating ? 0.5 : 1,
            cursor: recalculating ? 'not-allowed' : 'pointer',
          }}
          title="Recalculate scores"
          onMouseEnter={(e) => !recalculating && (e.currentTarget.style.color = colors.accentSoft)}
          onMouseLeave={(e) => !recalculating && (e.currentTarget.style.color = colors.accent)}
        >
          <RefreshCw
            style={{
              width: 12,
              height: 12,
              animation: recalculating ? 'spin 1s linear infinite' : 'none',
            }}
          />
          Recalculate
        </button>
      </div>

      <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* Primary Scores */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 16 }}>
          {/* ICP Score */}
          <div
            style={{
              padding: 16,
              borderRadius: 8,
              border: `1px solid ${icpColors.border}`,
              backgroundColor: icpColors.bg,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <span style={{ fontSize: 11, fontWeight: 500, color: icpColors.color }}>
                ICP SCORE
              </span>
              <div
                style={{
                  padding: '2px 8px',
                  borderRadius: 4,
                  fontSize: 11,
                  fontWeight: 700,
                  backgroundColor: icpColors.color,
                  color: 'white',
                }}
              >
                {scores.icp_tier}
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
              <span style={{ fontSize: 30, fontWeight: 700, color: icpColors.color }}>
                {scores.icp_score}
              </span>
              <span style={{ fontSize: 13, color: colors.textMuted }}>/100</span>
            </div>
          </div>

          {/* Lead Score */}
          <div
            style={{
              padding: 16,
              borderRadius: 8,
              border: `1px solid ${leadColors.border}`,
              backgroundColor: leadColors.bg,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <span style={{ fontSize: 11, fontWeight: 500, color: leadColors.color }}>
                LEAD SCORE
              </span>
              <div
                style={{
                  padding: '2px 8px',
                  borderRadius: 4,
                  fontSize: 11,
                  fontWeight: 700,
                  backgroundColor: leadColors.color,
                  color: 'white',
                }}
              >
                {scores.lead_tier}
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
              <span style={{ fontSize: 30, fontWeight: 700, color: leadColors.color }}>
                {scores.lead_score}
              </span>
              <span style={{ fontSize: 13, color: colors.textMuted }}>/100</span>
            </div>
          </div>
        </div>

        {/* Component Scores */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {scoreMetrics.map((metric) => {
            const Icon = metric.icon;
            return (
              <div key={metric.label} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div
                  style={{
                    padding: 8,
                    borderRadius: 8,
                    backgroundColor: `${metric.color}15`,
                  }}
                >
                  <Icon style={{ width: 16, height: 16, color: metric.color }} />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span style={{ fontSize: 11, fontWeight: 500, color: colors.textSecondary }}>
                      {metric.label}
                    </span>
                    <span style={{ fontSize: 13, fontWeight: 600, color: metric.color }}>
                      {metric.value}
                    </span>
                  </div>
                  <div style={{ height: 6, background: colors.surfaceHover, borderRadius: 999, overflow: 'hidden' }}>
                    <div
                      style={{
                        height: '100%',
                        borderRadius: 999,
                        backgroundColor: metric.color,
                        width: `${metric.value}%`,
                        transition: 'width 0.5s',
                      }}
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Last Scored */}
        {scores.last_scored_at && (
          <div style={{ paddingTop: 12, borderTop: `1px solid ${colors.border}` }}>
            <p style={{ fontSize: 11, color: colors.textMuted, margin: 0 }}>
              Last scored: {new Date(scores.last_scored_at).toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
                year: 'numeric',
                hour: 'numeric',
                minute: '2-digit',
              })}
            </p>
          </div>
        )}
      </div>

      <style>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
