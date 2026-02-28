import React from 'react';
import { useSignals } from '../../hooks/useSignals';
import { TrendingUp, AlertCircle, Zap, Calendar } from 'lucide-react';
import { colors } from '../../styles/theme';
import TimeAgo from './TimeAgo';

interface SignalsSummaryWidgetProps {
  accountId: string;
  compact?: boolean;
  showDetails?: boolean;
  className?: string;
}

export function SignalsSummaryWidget({
  accountId,
  compact = false,
  showDetails = true,
  className,
}: SignalsSummaryWidgetProps) {
  const { signals, summary, loading } = useSignals({ accountId, lookbackDays: 90 });

  if (loading) {
    return (
      <div style={{ padding: 16 }} className={className}>
        <div style={{ height: 64, background: colors.surfaceHover, borderRadius: 8 }} />
      </div>
    );
  }

  if (!summary || summary.total_signals === 0) {
    if (compact) return null;
    return (
      <div
        style={{
          padding: 12,
          background: colors.surface,
          borderRadius: 8,
          border: `1px solid ${signalStyle.border}`,
        }}
        className={className}
      >
        <div style={{ fontSize: 13, color: colors.textMuted }}>No recent signals</div>
      </div>
    );
  }

  const strengthColors = {
    HOT: { bg: '#fee2e2', text: '#dc2626', border: '#fca5a5' },
    WARM: { bg: '#fef3c7', text: '#d97706', border: '#fcd34d' },
    NEUTRAL: { bg: '#dbeafe', text: '#2563eb', border: '#93c5fd' },
    COLD: { bg: '#f3f4f6', text: '#6b7280', border: '#d1d5db' },
  };

  const signalStyle = strengthColors[summary.signal_strength];

  if (compact) {
    return (
      <div
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
          padding: '4px 8px',
          borderRadius: 8,
          border: `1px solid ${signalStyle.border}`,
          backgroundColor: signalStyle.bg,
          borderColor: signalStyle.border,
        }}
        className={className}
      >
        <Zap style={{ width: 12, height: 12, color: signalStyle.text }} />
        <span style={{ fontSize: 11, fontWeight: 500, color: signalStyle.text }}>
          {summary.signal_strength}
        </span>
        {summary.buying_triggers > 0 && (
          <span style={{ fontSize: 11, color: signalStyle.text }}>
            • {summary.buying_triggers} trigger{summary.buying_triggers !== 1 ? 's' : ''}
          </span>
        )}
      </div>
    );
  }

  const recentSignals = summary.recent_signals || signals.slice(0, 3);

  return (
    <div
      style={{
        padding: 16,
        borderRadius: 8,
        border: `1px solid ${signalStyle.border}`,
        backgroundColor: signalStyle.bg,
        borderColor: signalStyle.border,
      }}
      className={className}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <TrendingUp style={{ width: 16, height: 16, color: signalStyle.text }} />
          <span style={{ fontSize: 13, fontWeight: 600, color: signalStyle.text }}>
            Market Signals
          </span>
        </div>
        <div
          style={{
            padding: '2px 8px',
            borderRadius: 4,
            fontSize: 11,
            fontWeight: 700,
            backgroundColor: signalStyle.text,
            color: 'white',
          }}
        >
          {summary.signal_strength}
        </div>
      </div>

      {/* Stats Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 12 }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: signalStyle.text }}>
            {summary.total_signals}
          </div>
          <div style={{ fontSize: 11, color: signalStyle.text, opacity: 0.8 }}>
            Total
          </div>
        </div>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: signalStyle.text }}>
            {summary.high_priority}
          </div>
          <div style={{ fontSize: 11, color: signalStyle.text, opacity: 0.8 }}>
            High Priority
          </div>
        </div>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: signalStyle.text }}>
            {summary.buying_triggers}
          </div>
          <div style={{ fontSize: 11, color: signalStyle.text, opacity: 0.8 }}>
            Buying Triggers
          </div>
        </div>
      </div>

      {/* Recent Signals */}
      {showDetails && recentSignals.length > 0 && (
        <div style={{ paddingTop: 12, marginTop: 12, borderTop: `1px solid ${signalStyle.border}` }}>
          <div style={{ fontSize: 11, fontWeight: 500, color: signalStyle.text, marginBottom: 8 }}>
            Recent Signals:
          </div>
          {recentSignals.map((signal, idx) => (
            <div key={signal.id || idx} style={{ fontSize: 11, marginBottom: 8 }}>
              <div style={{ fontWeight: 500, color: signalStyle.text, marginBottom: 2 }}>
                {signal.headline}
              </div>
              <div style={{ color: signalStyle.text, opacity: 0.7 }}>
                <TimeAgo date={signal.signal_date} />
                {signal.buying_trigger && (
                  <span style={{ marginLeft: 8, fontWeight: 500 }}>• Buying Trigger</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Signal Categories */}
      {showDetails && summary.by_category && summary.by_category.length > 0 && (
        <div style={{ paddingTop: 8, marginTop: 8, borderTop: `1px solid ${signalStyle.border}` }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {summary.by_category.slice(0, 4).map(({ category, count }) => (
              <span
                key={category}
                style={{
                  padding: '2px 6px',
                  borderRadius: 4,
                  fontSize: 11,
                  backgroundColor: signalStyle.text,
                  color: 'white',
                  opacity: 0.9,
                }}
              >
                {category} ({count})
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
