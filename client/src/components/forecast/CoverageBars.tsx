import React from 'react';
import { colors, fonts } from '../../styles/theme';
import type { ForecastAnnotation } from '../../hooks/useForecastAnnotations';

interface CoverageQuarter {
  label: string;
  pipeline: number;
  quota: number;
}

interface CoverageBarsProps {
  quarters: CoverageQuarter[];
  annotations?: ForecastAnnotation[];
  targetMultiple?: number;
}

const SEVERITY_COLORS: Record<string, string> = {
  critical: colors.red,
  warning: colors.yellow,
  positive: colors.green,
  info: colors.accent,
};

function formatCurrency(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
  return `$${value.toFixed(0)}`;
}

export default function CoverageBars({
  quarters,
  annotations = [],
  targetMultiple = 3,
}: CoverageBarsProps) {
  if (!quarters || quarters.length === 0) {
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
          No coverage data available
        </div>
      </div>
    );
  }

  const maxValue = Math.max(
    ...quarters.map(q => Math.max(q.pipeline, q.quota * targetMultiple))
  );

  const coverageAnnotations = annotations.filter(
    a => a.anchor.type === 'coverage'
  );

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
          fontSize: 13,
          fontWeight: 600,
          color: colors.text,
          marginBottom: 4,
        }}
      >
        Pipeline Coverage by Quarter
      </div>
      <div
        style={{
          fontSize: 11,
          color: colors.textMuted,
          marginBottom: 16,
        }}
      >
        Pipeline vs. {targetMultiple}x quota target
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {quarters.map(q => {
          const coverage = q.quota > 0 ? q.pipeline / q.quota : 0;
          const barWidth = maxValue > 0 ? (q.pipeline / maxValue) * 100 : 0;
          const targetPos =
            maxValue > 0 ? ((q.quota * targetMultiple) / maxValue) * 100 : 0;
          const meetsTarget = coverage >= targetMultiple;

          const matchingAnnotations = coverageAnnotations.filter(a => {
            if (a.anchor.type === 'coverage') {
              return a.anchor.period === q.label;
            }
            return false;
          });

          return (
            <div key={q.label}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'baseline',
                  marginBottom: 6,
                }}
              >
                <span
                  style={{
                    fontSize: 12,
                    fontWeight: 600,
                    color: colors.text,
                  }}
                >
                  {q.label}
                </span>
                <span
                  style={{
                    fontSize: 11,
                    color: meetsTarget ? colors.green : colors.yellow,
                    fontFamily: fonts.mono,
                  }}
                >
                  {coverage.toFixed(1)}x coverage
                </span>
              </div>

              <div
                style={{
                  position: 'relative',
                  height: 24,
                  background: colors.surfaceRaised,
                  borderRadius: 4,
                  overflow: 'visible',
                }}
              >
                <div
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    height: '100%',
                    width: `${Math.min(barWidth, 100)}%`,
                    background: meetsTarget
                      ? `linear-gradient(90deg, ${colors.green}, rgba(34,197,94,0.6))`
                      : `linear-gradient(90deg, ${colors.accent}, rgba(59,130,246,0.6))`,
                    borderRadius: 4,
                    transition: 'width 0.4s ease',
                  }}
                />

                {targetPos <= 100 && (
                  <div
                    style={{
                      position: 'absolute',
                      top: -2,
                      left: `${targetPos}%`,
                      width: 2,
                      height: 28,
                      background: colors.red,
                      zIndex: 2,
                    }}
                    title={`${targetMultiple}x target: ${formatCurrency(q.quota * targetMultiple)}`}
                  >
                    <div
                      style={{
                        position: 'absolute',
                        top: -14,
                        left: '50%',
                        transform: 'translateX(-50%)',
                        fontSize: 9,
                        color: colors.red,
                        fontFamily: fonts.mono,
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {targetMultiple}x
                    </div>
                  </div>
                )}

                <div
                  style={{
                    position: 'absolute',
                    top: '50%',
                    left: 8,
                    transform: 'translateY(-50%)',
                    fontSize: 10,
                    fontWeight: 600,
                    color: '#fff',
                    fontFamily: fonts.mono,
                    textShadow: '0 1px 2px rgba(0,0,0,0.5)',
                    zIndex: 3,
                  }}
                >
                  {formatCurrency(q.pipeline)}
                </div>
              </div>

              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  marginTop: 4,
                  fontSize: 10,
                  color: colors.textMuted,
                  fontFamily: fonts.mono,
                }}
              >
                <span>Quota: {formatCurrency(q.quota)}</span>
                <span>Target: {formatCurrency(q.quota * targetMultiple)}</span>
              </div>

              {matchingAnnotations.map(ann => (
                <div
                  key={ann.id}
                  style={{
                    marginTop: 6,
                    padding: '6px 10px',
                    background: colors.surfaceRaised,
                    borderLeft: `3px solid ${SEVERITY_COLORS[ann.severity] || colors.accent}`,
                    borderRadius: 4,
                    fontSize: 11,
                    color: colors.textSecondary,
                    lineHeight: 1.5,
                    fontFamily: fonts.sans,
                  }}
                >
                  {ann.title}
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
