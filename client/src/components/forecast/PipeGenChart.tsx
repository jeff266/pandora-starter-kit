import React from 'react';
import { colors, fonts } from '../../styles/theme';

interface WeekData {
  week_label: string;
  created: number;
}

interface PipeGenChartProps {
  weeks: WeekData[];
  subtitle?: string;
  onBarClick?: (weekIndex: number, weekData: WeekData) => void;
}

function formatCurrency(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
  return `$${value.toFixed(0)}`;
}

function computeOutlierCap(values: number[], avg: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const q1 = sorted[Math.floor(sorted.length * 0.25)] ?? 0;
  const q3 = sorted[Math.floor(sorted.length * 0.75)] ?? 0;
  const iqr = q3 - q1;
  const tukeyFence = q3 + 1.5 * iqr;
  return Math.max(tukeyFence, avg * 2.5, 1);
}

export default function PipeGenChart({ weeks, subtitle, onBarClick }: PipeGenChartProps) {
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
  const values = trailingWeeks.map(w => w.created);
  const rawMax = Math.max(...values, 1);
  const avg = values.reduce((s, v) => s + v, 0) / values.length;

  const capVal = computeOutlierCap(values, avg);
  const hasOutliers = values.some(v => v > capVal);
  const scaleMax = hasOutliers ? capVal : rawMax;

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
        {hasOutliers && (
          <span style={{ marginLeft: 6, opacity: 0.6 }}>· outliers clipped</span>
        )}
      </div>

      {/* Extra top padding so value labels for tall bars don't get clipped */}
      <div style={{ position: 'relative', height: chartHeight + 20, paddingTop: 20 }}>

        {/* Cap label — top-left, only when outliers present */}
        {hasOutliers && (
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              fontSize: 9,
              color: colors.textMuted,
              fontFamily: fonts.mono,
              lineHeight: 1,
              userSelect: 'none',
            }}
          >
            ↑ {formatCurrency(capVal)}
          </div>
        )}

        {/* Average dashed line — positioned relative to padded chart area */}
        {avg > 0 && (
          <div
            style={{
              position: 'absolute',
              top: 20 + (1 - Math.min(avg, scaleMax) / scaleMax) * chartHeight,
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

        {/* Bar columns — contained within the padded chart area */}
        <div
          style={{
            position: 'absolute',
            top: 20,
            left: 0,
            right: 0,
            bottom: 0,
            display: 'flex',
            alignItems: 'flex-end',
            gap: barGap,
          }}
        >
          {trailingWeeks.map((w, i) => {
            const isOutlier = w.created > capVal;
            const barHeight = isOutlier
              ? chartHeight
              : scaleMax > 0 ? (w.created / scaleMax) * chartHeight : 0;
            const isAboveAvg = w.created >= avg;
            const barColor = isAboveAvg
              ? `linear-gradient(180deg, ${colors.green}, rgba(34,197,94,0.5))`
              : `linear-gradient(180deg, ${colors.accent}, rgba(59,130,246,0.5))`;
            const zigzagColor = isAboveAvg ? colors.green : colors.accent;

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
                {/* Value label — above the bar; always visible for outliers */}
                <div
                  style={{
                    fontSize: 9,
                    color: colors.textMuted,
                    fontFamily: fonts.mono,
                    marginBottom: 4,
                    opacity: isOutlier ? 1 : barHeight > 20 ? 1 : 0,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {formatCurrency(w.created)}
                </div>

                {/* The bar itself */}
                <div
                  style={{
                    width: '100%',
                    height: Math.max(barHeight, 2),
                    background: barColor,
                    borderRadius: isOutlier ? '3px 3px 0 0' : '3px 3px 0 0',
                    transition: 'all 0.2s ease',
                    position: 'relative',
                    cursor: onBarClick ? 'pointer' : 'default',
                    overflow: 'visible',
                  }}
                  title={`${w.week_label}: ${formatCurrency(w.created)}`}
                  onClick={() => onBarClick?.(i, w)}
                  onMouseEnter={(e) => {
                    if (onBarClick) {
                      e.currentTarget.style.opacity = '0.8';
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (onBarClick) {
                      e.currentTarget.style.opacity = '1';
                    }
                  }}
                >
                  {/* Zigzag break mark — sits at top of the capped bar */}
                  {isOutlier && (
                    <svg
                      width="100%"
                      height="9"
                      viewBox="0 0 100 9"
                      preserveAspectRatio="none"
                      style={{
                        position: 'absolute',
                        top: -9,
                        left: 0,
                        display: 'block',
                      }}
                    >
                      <polyline
                        points="0,9 16.67,0 33.33,9 50,0 66.67,9 83.33,0 100,9"
                        fill="none"
                        stroke={zigzagColor}
                        strokeWidth="2"
                        vectorEffect="non-scaling-stroke"
                      />
                    </svg>
                  )}
                </div>
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
