import React from 'react';
import { useScores } from '../../hooks/useScores';
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
      <div className={`p-6 ${className || ''}`}>
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-gray-100 rounded w-1/3" />
          <div className="space-y-3">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="h-16 bg-gray-100 rounded" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (error || !scores) {
    return (
      <div className={`p-6 ${className || ''}`}>
        <div className="text-red-600 text-sm">
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
      <div className="flex items-center justify-between p-4 border-b border-gray-200">
        <h3 className="text-lg font-semibold">Account Scores</h3>
        <button
          onClick={handleRecalculate}
          disabled={recalculating}
          className="text-xs text-blue-600 hover:text-blue-800 flex items-center gap-1 disabled:opacity-50"
          title="Recalculate scores"
        >
          <RefreshCw className={`h-3 w-3 ${recalculating ? 'animate-spin' : ''}`} />
          Recalculate
        </button>
      </div>

      <div className="p-4 space-y-4">
        {/* Primary Scores */}
        <div className="grid grid-cols-2 gap-4">
          {/* ICP Score */}
          <div
            className="p-4 rounded-lg border"
            style={{
              backgroundColor: icpColors.bg,
              borderColor: icpColors.border,
            }}
          >
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium" style={{ color: icpColors.color }}>
                ICP SCORE
              </span>
              <div
                className="px-2 py-0.5 rounded text-xs font-bold"
                style={{
                  backgroundColor: icpColors.color,
                  color: 'white',
                }}
              >
                {scores.icp_tier}
              </div>
            </div>
            <div className="flex items-baseline gap-1">
              <span className="text-3xl font-bold" style={{ color: icpColors.color }}>
                {scores.icp_score}
              </span>
              <span className="text-sm text-gray-600">/100</span>
            </div>
          </div>

          {/* Lead Score */}
          <div
            className="p-4 rounded-lg border"
            style={{
              backgroundColor: leadColors.bg,
              borderColor: leadColors.border,
            }}
          >
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium" style={{ color: leadColors.color }}>
                LEAD SCORE
              </span>
              <div
                className="px-2 py-0.5 rounded text-xs font-bold"
                style={{
                  backgroundColor: leadColors.color,
                  color: 'white',
                }}
              >
                {scores.lead_tier}
              </div>
            </div>
            <div className="flex items-baseline gap-1">
              <span className="text-3xl font-bold" style={{ color: leadColors.color }}>
                {scores.lead_score}
              </span>
              <span className="text-sm text-gray-600">/100</span>
            </div>
          </div>
        </div>

        {/* Component Scores */}
        <div className="space-y-3">
          {scoreMetrics.map((metric) => {
            const Icon = metric.icon;
            return (
              <div key={metric.label} className="flex items-center gap-3">
                <div
                  className="p-2 rounded-lg"
                  style={{ backgroundColor: `${metric.color}15` }}
                >
                  <Icon className="h-4 w-4" style={{ color: metric.color }} />
                </div>
                <div className="flex-1">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-medium text-gray-700">{metric.label}</span>
                    <span className="text-sm font-semibold" style={{ color: metric.color }}>
                      {metric.value}
                    </span>
                  </div>
                  <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{
                        backgroundColor: metric.color,
                        width: `${metric.value}%`,
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
          <div className="pt-3 border-t border-gray-200">
            <p className="text-xs text-gray-500">
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
    </div>
  );
}
