import React from 'react';
import { RefreshCw, Settings } from 'lucide-react';
import { colors, fonts } from '../../styles/theme';
import { formatTimeAgo } from '../../lib/format';

interface PipelineOption {
  name: string;
  display_name?: string;
  deal_count?: number;
}

interface DashboardHeaderProps {
  timeRange: 'today' | 'this_week' | 'this_month' | 'this_quarter' | 'this_year';
  onTimeRangeChange: (range: 'today' | 'this_week' | 'this_month' | 'this_quarter' | 'this_year') => void;
  lastRefreshed?: string;
  onRefresh: () => void;
  onConfigureClick?: () => void;
  loading?: boolean;
  pipelines?: PipelineOption[];
  selectedPipeline?: string;
  onPipelineChange?: (pipeline: string) => void;
}

export function DashboardHeader({
  timeRange,
  onTimeRangeChange,
  lastRefreshed,
  onRefresh,
  onConfigureClick,
  loading = false,
  pipelines,
  selectedPipeline,
  onPipelineChange,
}: DashboardHeaderProps) {
  const timeRangeOptions: Array<{ value: typeof timeRange; label: string }> = [
    { value: 'today', label: 'Today' },
    { value: 'this_week', label: 'This Week' },
    { value: 'this_month', label: 'This Month' },
    { value: 'this_quarter', label: 'This Quarter' },
    { value: 'this_year', label: 'This Year' },
  ];

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'flex-end',
        marginBottom: 20,
        flexWrap: 'wrap',
        gap: 10,
      }}
    >
        {/* Time Range Selector */}
        <select
          value={timeRange}
          onChange={(e) => onTimeRangeChange(e.target.value as typeof timeRange)}
          style={{
            padding: '7px 10px',
            borderRadius: 7,
            border: `1px solid ${colors.border}`,
            background: colors.surface,
            color: colors.text,
            fontSize: 13,
            fontFamily: fonts.body,
            cursor: 'pointer',
            outline: 'none',
          }}
        >
          {timeRangeOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>

        {/* Pipeline Selector — shown inline when multiple pipelines exist */}
        {pipelines && pipelines.length > 1 && onPipelineChange && (
          <select
            value={selectedPipeline || 'all'}
            onChange={(e) => onPipelineChange(e.target.value)}
            style={{
              padding: '7px 10px',
              borderRadius: 7,
              border: `1px solid ${colors.border}`,
              background: colors.surface,
              color: colors.text,
              fontSize: 13,
              fontFamily: fonts.body,
              cursor: 'pointer',
              outline: 'none',
              minWidth: 130,
            }}
          >
            <option value="all">All Pipelines</option>
            {pipelines.map((p) => (
              <option key={p.name} value={p.name}>
                {p.display_name || p.name}{p.deal_count != null ? ` (${p.deal_count})` : ''}
              </option>
            ))}
          </select>
        )}

        {/* Last Updated */}
        {lastRefreshed && (
          <span
            style={{
              fontSize: 13,
              color: colors.textSecondary,
              fontFamily: fonts.body,
            }}
          >
            Updated {formatTimeAgo(lastRefreshed)}
          </span>
        )}

        {/* Refresh Button */}
        <button
          onClick={onRefresh}
          disabled={loading}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '8px 12px',
            borderRadius: 8,
            border: `1px solid ${colors.border}`,
            background: colors.surface,
            color: colors.text,
            fontSize: 14,
            fontFamily: fonts.body,
            cursor: loading ? 'not-allowed' : 'pointer',
            opacity: loading ? 0.6 : 1,
            transition: 'all 0.15s ease',
          }}
          onMouseEnter={(e) => {
            if (!loading) e.currentTarget.style.background = colors.surfaceHover;
          }}
          onMouseLeave={(e) => (e.currentTarget.style.background = colors.surface)}
        >
          <RefreshCw size={16} style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} />
          Refresh
        </button>

        {/* Settings Button (optional for future) */}
        {onConfigureClick && (
          <button
            onClick={onConfigureClick}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 8,
              borderRadius: 8,
              border: `1px solid ${colors.border}`,
              background: colors.surface,
              color: colors.textSecondary,
              cursor: 'pointer',
              transition: 'all 0.15s ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = colors.surfaceHover;
              e.currentTarget.style.color = colors.text;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = colors.surface;
              e.currentTarget.style.color = colors.textSecondary;
            }}
          >
            <Settings size={18} />
          </button>
        )}

      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
