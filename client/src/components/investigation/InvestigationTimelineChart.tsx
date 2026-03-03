import React from 'react';
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import { colors, fonts } from '../../styles/theme';
import { useInvestigationTimeline } from '../../hooks/useInvestigationHistory';
import { formatDate } from '../../lib/format';

interface Props {
  skillId: string;
  days?: number;
}

const LINES = [
  { key: 'atRiskCount',    label: 'At Risk',   color: '#f59e0b' },
  { key: 'criticalCount',  label: 'Critical',  color: '#ef4444' },
  { key: 'warningCount',   label: 'Warning',   color: '#eab308' },
  { key: 'healthyCount',   label: 'Healthy',   color: '#22c55e' },
];

function trendBadge(dir: string | undefined) {
  if (dir === 'improving') return { icon: '📉', label: 'Improving', bg: 'rgba(34,197,94,0.12)', color: '#22c55e' };
  if (dir === 'worsening') return { icon: '📈', label: 'Worsening', bg: 'rgba(239,68,68,0.12)', color: '#ef4444' };
  return { icon: '➡️', label: 'Stable', bg: 'rgba(90,101,120,0.12)', color: colors.textSecondary };
}

export default function InvestigationTimelineChart({ skillId, days = 30 }: Props) {
  const { points, summary, loading, error } = useInvestigationTimeline(skillId, days);

  const chartData = points.map(p => ({
    date: formatDate(p.timestamp),
    atRiskCount: p.atRiskCount,
    criticalCount: p.criticalCount,
    warningCount: p.warningCount,
    healthyCount: p.healthyCount,
  }));

  const badge = trendBadge(summary?.trendDirection);

  return (
    <div style={{
      background: colors.surface,
      border: `1px solid ${colors.border}`,
      borderRadius: 10,
      padding: '16px 20px',
      marginBottom: 16,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: colors.textMuted, fontFamily: fonts.sans }}>
            TREND OVER {days} DAYS
          </div>
          {summary && (
            <div style={{ fontSize: 12, color: colors.textSecondary, marginTop: 2 }}>
              {summary.totalRuns} run{summary.totalRuns !== 1 ? 's' : ''} · avg {Math.round(summary.averageAtRisk)} at risk
            </div>
          )}
        </div>
        {summary && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '4px 10px', borderRadius: 20,
            background: badge.bg, color: badge.color,
            fontSize: 12, fontWeight: 600,
          }}>
            <span>{badge.icon}</span>
            <span>{badge.label}</span>
          </div>
        )}
      </div>

      {loading && (
        <div style={{ height: 160, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ color: colors.textMuted, fontSize: 13 }}>Loading timeline…</div>
        </div>
      )}

      {!loading && error && (
        <div style={{ height: 100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ color: colors.red, fontSize: 13 }}>Failed to load timeline</div>
        </div>
      )}

      {!loading && !error && chartData.length === 0 && (
        <div style={{ height: 100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ color: colors.textMuted, fontSize: 13 }}>No data yet for this skill</div>
        </div>
      )}

      {!loading && !error && chartData.length > 0 && (
        <ResponsiveContainer width="100%" height={180}>
          <LineChart data={chartData} margin={{ top: 4, right: 12, left: -20, bottom: 0 }}>
            <XAxis
              dataKey="date"
              tick={{ fill: colors.textMuted, fontSize: 10 }}
              axisLine={{ stroke: colors.border }}
              tickLine={false}
            />
            <YAxis
              tick={{ fill: colors.textMuted, fontSize: 10 }}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip
              contentStyle={{
                background: colors.surfaceRaised,
                border: `1px solid ${colors.border}`,
                borderRadius: 6,
                fontSize: 12,
                color: colors.text,
              }}
            />
            <Legend
              wrapperStyle={{ fontSize: 11, color: colors.textSecondary, paddingTop: 8 }}
            />
            {LINES.map(l => (
              <Line
                key={l.key}
                type="monotone"
                dataKey={l.key}
                name={l.label}
                stroke={l.color}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4 }}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
