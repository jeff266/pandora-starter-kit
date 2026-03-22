import React from 'react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';

interface TrendDataPoint {
  week: string;
  count: number;
}

interface SkillTrendChartProps {
  skillId: string;
  skillName: string;
  data: TrendDataPoint[];
  color?: string;
}

const SKILL_COLORS: Record<string, string> = {
  'pipeline-hygiene': '#3b82f6',
  'pipeline-coverage': '#8b5cf6',
  'forecast-rollup': '#10b981',
  'deal-risk-review': '#f59e0b',
  'pipeline-waterfall': '#ec4899',
  'rep-scorecard': '#06b6d4',
  'conversation-intelligence': '#6366f1',
  'meddic-coverage': '#14b8a6',
};

export function SkillTrendChart({ skillId, skillName, data, color }: SkillTrendChartProps) {
  const chartColor = color || SKILL_COLORS[skillId] || '#64748b';

  // Format week date for display (e.g., "2024-01-15" -> "Jan 15")
  const formatWeek = (week: string): string => {
    const date = new Date(week);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  // Calculate stats
  const totalRuns = data.reduce((sum, d) => sum + d.count, 0);
  const avgPerWeek = data.length > 0 ? Math.round(totalRuns / data.length) : 0;
  const lastWeek = data.length > 0 ? data[data.length - 1].count : 0;

  const colors = {
    background: '#ffffff',
    surface: '#f8fafc',
    border: '#e2e8f0',
    text: '#0f172a',
    textSecondary: '#64748b',
    textMuted: '#94a3b8',
  };

  const fonts = {
    sans: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    mono: 'ui-monospace, "SF Mono", Consolas, monospace',
  };

  return (
    <div
      style={{
        background: colors.background,
        border: `1px solid ${colors.border}`,
        borderRadius: 8,
        padding: 16,
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div
            style={{
              fontFamily: fonts.sans,
              fontSize: 14,
              fontWeight: 600,
              color: colors.text,
            }}
          >
            {skillName}
          </div>
          <div
            style={{
              fontFamily: fonts.sans,
              fontSize: 12,
              color: colors.textMuted,
              marginTop: 2,
            }}
          >
            Last {data.length} weeks
          </div>
        </div>
        <div style={{ display: 'flex', gap: 12 }}>
          <div style={{ textAlign: 'right' }}>
            <div
              style={{
                fontFamily: fonts.mono,
                fontSize: 16,
                fontWeight: 700,
                color: colors.text,
              }}
            >
              {lastWeek}
            </div>
            <div
              style={{
                fontFamily: fonts.sans,
                fontSize: 11,
                color: colors.textSecondary,
              }}
            >
              Last week
            </div>
          </div>
          <div
            style={{
              borderLeft: `1px solid ${colors.border}`,
              paddingLeft: 12,
              textAlign: 'right',
            }}
          >
            <div
              style={{
                fontFamily: fonts.mono,
                fontSize: 16,
                fontWeight: 700,
                color: colors.textSecondary,
              }}
            >
              {avgPerWeek}
            </div>
            <div
              style={{
                fontFamily: fonts.sans,
                fontSize: 11,
                color: colors.textSecondary,
              }}
            >
              Avg/week
            </div>
          </div>
        </div>
      </div>

      {/* Chart */}
      <div style={{ height: 120 }}>
        {data.length === 0 ? (
          <div
            style={{
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: colors.textMuted,
              fontSize: 13,
              fontFamily: fonts.sans,
            }}
          >
            No runs in last {12} weeks
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id={`gradient-${skillId}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={chartColor} stopOpacity={0.3} />
                  <stop offset="95%" stopColor={chartColor} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke={colors.border} />
              <XAxis
                dataKey="week"
                tickFormatter={formatWeek}
                stroke={colors.textMuted}
                style={{ fontSize: 11, fontFamily: fonts.sans }}
                tick={{ fill: colors.textMuted }}
              />
              <YAxis
                stroke={colors.textMuted}
                style={{ fontSize: 11, fontFamily: fonts.sans }}
                tick={{ fill: colors.textMuted }}
                allowDecimals={false}
              />
              <Tooltip
                contentStyle={{
                  background: colors.surface,
                  border: `1px solid ${colors.border}`,
                  borderRadius: 6,
                  fontSize: 12,
                  fontFamily: fonts.sans,
                }}
                labelFormatter={formatWeek}
                formatter={(value: number) => [`${value} runs`, 'Count']}
              />
              <Area
                type="monotone"
                dataKey="count"
                stroke={chartColor}
                strokeWidth={2}
                fill={`url(#gradient-${skillId})`}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
