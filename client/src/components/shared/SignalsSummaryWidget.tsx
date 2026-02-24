import React from 'react';
import { useSignals } from '../../hooks/useSignals';
import { TrendingUp, AlertCircle, Zap, Calendar } from 'lucide-react';
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
      <div className={`animate-pulse ${className || ''}`}>
        <div className="h-16 bg-gray-100 rounded" />
      </div>
    );
  }

  if (!summary || summary.total_signals === 0) {
    if (compact) return null;
    return (
      <div className={`p-3 bg-gray-50 rounded-lg border border-gray-200 ${className || ''}`}>
        <div className="text-sm text-gray-600">No recent signals</div>
      </div>
    );
  }

  const strengthColors = {
    HOT: { bg: '#fee2e2', text: '#dc2626', border: '#fca5a5' },
    WARM: { bg: '#fef3c7', text: '#d97706', border: '#fcd34d' },
    NEUTRAL: { bg: '#dbeafe', text: '#2563eb', border: '#93c5fd' },
    COLD: { bg: '#f3f4f6', text: '#6b7280', border: '#d1d5db' },
  };

  const colors = strengthColors[summary.signal_strength];

  if (compact) {
    return (
      <div
        className={`inline-flex items-center gap-2 px-2 py-1 rounded-lg border ${className || ''}`}
        style={{
          backgroundColor: colors.bg,
          borderColor: colors.border,
        }}
      >
        <Zap className="h-3 w-3" style={{ color: colors.text }} />
        <span className="text-xs font-medium" style={{ color: colors.text }}>
          {summary.signal_strength}
        </span>
        {summary.buying_triggers > 0 && (
          <span className="text-xs" style={{ color: colors.text }}>
            • {summary.buying_triggers} trigger{summary.buying_triggers !== 1 ? 's' : ''}
          </span>
        )}
      </div>
    );
  }

  const recentSignals = summary.recent_signals || signals.slice(0, 3);

  return (
    <div
      className={`p-4 rounded-lg border ${className || ''}`}
      style={{
        backgroundColor: colors.bg,
        borderColor: colors.border,
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <TrendingUp className="h-4 w-4" style={{ color: colors.text }} />
          <span className="text-sm font-semibold" style={{ color: colors.text }}>
            Market Signals
          </span>
        </div>
        <div
          className="px-2 py-0.5 rounded text-xs font-bold"
          style={{
            backgroundColor: colors.text,
            color: 'white',
          }}
        >
          {summary.signal_strength}
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-3 gap-2 mb-3">
        <div className="text-center">
          <div className="text-lg font-bold" style={{ color: colors.text }}>
            {summary.total_signals}
          </div>
          <div className="text-xs" style={{ color: colors.text, opacity: 0.8 }}>
            Total
          </div>
        </div>
        <div className="text-center">
          <div className="text-lg font-bold" style={{ color: colors.text }}>
            {summary.high_priority}
          </div>
          <div className="text-xs" style={{ color: colors.text, opacity: 0.8 }}>
            High Priority
          </div>
        </div>
        <div className="text-center">
          <div className="text-lg font-bold" style={{ color: colors.text }}>
            {summary.buying_triggers}
          </div>
          <div className="text-xs" style={{ color: colors.text, opacity: 0.8 }}>
            Buying Triggers
          </div>
        </div>
      </div>

      {/* Recent Signals */}
      {showDetails && recentSignals.length > 0 && (
        <div className="space-y-2 pt-3 border-t" style={{ borderColor: colors.border }}>
          <div className="text-xs font-medium" style={{ color: colors.text }}>
            Recent Signals:
          </div>
          {recentSignals.map((signal, idx) => (
            <div key={signal.id || idx} className="text-xs space-y-0.5">
              <div className="font-medium" style={{ color: colors.text }}>
                {signal.headline}
              </div>
              <div style={{ color: colors.text, opacity: 0.7 }}>
                <TimeAgo date={signal.signal_date} />
                {signal.buying_trigger && (
                  <span className="ml-2 font-medium">• Buying Trigger</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Signal Categories */}
      {showDetails && summary.by_category && summary.by_category.length > 0 && (
        <div className="pt-2 mt-2 border-t" style={{ borderColor: colors.border }}>
          <div className="flex flex-wrap gap-1">
            {summary.by_category.slice(0, 4).map(({ category, count }) => (
              <span
                key={category}
                className="px-1.5 py-0.5 rounded text-xs"
                style={{
                  backgroundColor: colors.text,
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
