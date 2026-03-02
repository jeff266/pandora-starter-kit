import React from 'react';
import { colors, fonts } from '../../styles/theme';

interface WeekData {
  week_label: string;
  created: number;
}

interface PipeGenChartProps {
  weeks: WeekData[];
  subtitle?: string;
}

function formatCurrency(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
  return `$${value.toFixed(0)}`;
}

export default function PipeGenChart({ weeks, subtitle }: PipeGenChartProps) {
  if (!weeks || weeks.length === 0) {
    return (
      <div
        style={{
          background: colors.surface,
          border: `1px solid ${colors.border}`,
          borderRadius: 8,
          padding: 24,
          textAlign: 'center',
          fontFamily: fonts.sans,
        }}
      >
        <div style={{ fontSize: 13, color: colors.textMuted }}>
          No pipeline generation data available
        </div>
      </div>
    );
  }

  const trailingWeeks = weeks.slice(-13);
  const maxVal = Math.max(...trailingWeeks.map(w => w.created), 1);
  const avg =
    trailingWeeks.reduce((s, w) => s + w.created, 0) / trailingWeeks.length;

  const chartHeight = 160;
  const barGap = 6;

  return (
    <div
      style={{
        background: colors.surface,
        border: `1px solid ${colors.border}`,
        borderRadius: 8,
        padding: 20,
        fontFamily: fonts.sans,
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          marginBottom: 4,
        }}
      >
        <div style={{ fontSize: 13, fontWeight: 600, color: colors.text }}>
          Pipeline Generation
        </div>
        <div
          style={{
            fontSize: 11,
            color: colors.textMuted,
            fontFamily: fonts.mono,
          }}
        >
          Avg: {formatCurrency(avg)}/wk
        </div>
      </div>
      <div style={{ fontSize: 11, color: colors.textMuted, marginBottom: 16 }}>
        {subtitle ?? 'Trailing 13 weeks'}
      </div>

      <div style={{ position: 'relative', height: chartHeight }}>
        {avg > 0 && (
          <div
            style={{
              position: 'absolute',
              top: `${((1 - avg / maxVal) * 100)}%`,
              left: 0,
              right: 0,
              height: 1,
              borderTop: `1px dashed ${colors.textMuted}`,
              zIndex: 1,
            }}
          >
            <span
              style={{
                position: 'absolute',
                right: 0,
                top: -12,
                fontSize: 9,
                color: colors.textMuted,
                fontFamily: fonts.mono,
              }}
            >
              avg
            </span>
          </div>
        )}

        <div
          style={{
            display: 'flex',
            alignItems: 'flex-end',
            height: '100%',
            gap: barGap,
          }}
        >
          {trailingWeeks.map((w, i) => {
            const barHeight = maxVal > 0 ? (w.created / maxVal) * chartHeight : 0;
            const isAboveAvg = w.created >= avg;

            return (
              <div
                key={i}
                style={{
                  flex: 1,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  height: '100%',
                  justifyContent: 'flex-end',
                }}
              >
                <div
                  style={{
                    fontSize: 9,
                    color: colors.textMuted,
                    fontFamily: fonts.mono,
                    marginBottom: 4,
                    opacity: barHeight > 20 ? 1 : 0,
                  }}
                >
                  {formatCurrency(w.created)}
                </div>

                <div
                  style={{
                    width: '100%',
                    height: Math.max(barHeight, 2),
                    background: isAboveAvg
                      ? `linear-gradient(180deg, ${colors.green}, rgba(34,197,94,0.5))`
                      : `linear-gradient(180deg, ${colors.accent}, rgba(59,130,246,0.5))`,
                    borderRadius: '3px 3px 0 0',
                    transition: 'height 0.3s ease',
                    position: 'relative',
                  }}
                  title={`${w.week_label}: ${formatCurrency(w.created)}`}
                />
              </div>
            );
          })}
        </div>
      </div>

      <div
        style={{
          display: 'flex',
          gap: barGap,
          marginTop: 6,
        }}
      >
        {trailingWeeks.map((w, i) => (
          <div
            key={i}
            style={{
              flex: 1,
              fontSize: 9,
              color: colors.textMuted,
              textAlign: 'center',
              fontFamily: fonts.mono,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {w.week_label}
          </div>
        ))}
      </div>
    </div>
  );
}
