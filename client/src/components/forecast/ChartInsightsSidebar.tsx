import React, { useState } from 'react';
import type { ForecastAnnotation } from '../../hooks/useForecastAnnotations';
import { colors, fonts } from '../../styles/theme';

interface ChartInsightsSidebarProps {
  annotations: ForecastAnnotation[];
  onDismiss?: (id: string) => Promise<void>;
  onSnooze?: (id: string, weeks: 1 | 2) => Promise<void>;
}

const SEVERITY_CONFIG = {
  critical: { accent: colors.red, bg: colors.redSoft, icon: '🔴', textColor: '#fca5a5' },
  warning: { accent: colors.yellow, bg: colors.yellowSoft, icon: '⚠️', textColor: '#fde68a' },
  positive: { accent: colors.green, bg: colors.greenSoft, icon: '✅', textColor: '#86efac' },
  info: { accent: colors.accent, bg: colors.accentSoft, icon: 'ℹ️', textColor: '#93c5fd' },
};

export default function ChartInsightsSidebar({
  annotations,
  onDismiss,
  onSnooze,
}: ChartInsightsSidebarProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const chartAnnotations = annotations.filter(a => a.anchor.type === 'chart');

  if (chartAnnotations.length === 0) {
    return (
      <div
        style={{
          background: colors.surface,
          border: `1px solid ${colors.border}`,
          borderRadius: 8,
          padding: '20px 16px',
          textAlign: 'center',
        }}
      >
        <div style={{ fontSize: 13, color: colors.textMuted, fontFamily: fonts.sans }}>
          No chart insights available
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        background: colors.surface,
        border: `1px solid ${colors.border}`,
        borderRadius: 8,
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          padding: '10px 14px',
          borderBottom: `1px solid ${colors.border}`,
          background: colors.surfaceRaised,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <span style={{ fontSize: 14 }}>📊</span>
        <span style={{ fontSize: 12, fontWeight: 600, color: colors.text, fontFamily: fonts.sans }}>
          Chart Insights
        </span>
        <span
          style={{
            fontSize: 11,
            padding: '1px 7px',
            background: colors.accentSoft,
            color: colors.accent,
            borderRadius: 10,
            fontWeight: 500,
            fontFamily: fonts.mono,
            marginLeft: 'auto',
          }}
        >
          {chartAnnotations.length}
        </span>
      </div>

      <div style={{ padding: 8 }}>
        {chartAnnotations.map(annotation => {
          const config = SEVERITY_CONFIG[annotation.severity];
          const isExpanded = expandedId === annotation.id;
          const weekNum = annotation.anchor.type === 'chart' ? annotation.anchor.week : null;

          return (
            <div
              key={annotation.id}
              style={{
                background: colors.surfaceRaised,
                border: `1px solid ${colors.border}`,
                borderLeft: `3px solid ${config.accent}`,
                borderRadius: 6,
                padding: '8px 10px',
                marginBottom: 6,
                cursor: 'pointer',
                transition: 'background 0.15s',
              }}
              onMouseEnter={e => (e.currentTarget.style.background = colors.surfaceHover)}
              onMouseLeave={e => (e.currentTarget.style.background = colors.surfaceRaised)}
              onClick={() => setExpandedId(isExpanded ? null : annotation.id)}
            >
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                <div style={{ fontSize: 12, flexShrink: 0 }}>{config.icon}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <div
                      style={{
                        fontSize: 12,
                        fontWeight: 600,
                        color: config.textColor,
                        lineHeight: 1.4,
                        fontFamily: fonts.sans,
                        flex: 1,
                      }}
                    >
                      {annotation.title}
                    </div>
                    {weekNum != null && (
                      <span
                        style={{
                          fontSize: 10,
                          padding: '1px 6px',
                          background: colors.surfaceActive,
                          color: colors.textMuted,
                          borderRadius: 8,
                          fontFamily: fonts.mono,
                          flexShrink: 0,
                        }}
                      >
                        W{weekNum}
                      </span>
                    )}
                  </div>

                  {isExpanded && (
                    <div style={{ marginTop: 8 }} onClick={e => e.stopPropagation()}>
                      {annotation.body && (
                        <div
                          style={{
                            fontSize: 11,
                            color: colors.textSecondary,
                            lineHeight: 1.6,
                            marginBottom: 6,
                            fontFamily: fonts.sans,
                          }}
                        >
                          {annotation.body}
                        </div>
                      )}

                      {annotation.impact && (
                        <div style={{ fontSize: 11, marginBottom: 6, fontFamily: fonts.sans }}>
                          <span style={{ fontWeight: 600, color: colors.text }}>Impact: </span>
                          <span style={{ color: colors.textSecondary }}>{annotation.impact}</span>
                        </div>
                      )}

                      {annotation.recommendation && (
                        <div
                          style={{
                            fontSize: 11,
                            background: 'rgba(59,130,246,0.06)',
                            borderRadius: 4,
                            padding: '6px 8px',
                            border: `1px solid ${colors.border}`,
                            marginBottom: 8,
                            fontFamily: fonts.sans,
                          }}
                        >
                          <span style={{ fontWeight: 600, color: colors.accent }}>→ </span>
                          <span style={{ color: colors.textSecondary }}>{annotation.recommendation}</span>
                        </div>
                      )}

                      {(onDismiss || onSnooze) && (
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 4,
                            paddingTop: 6,
                            borderTop: `1px solid ${colors.border}`,
                          }}
                        >
                          {onDismiss && (
                            <button
                              onClick={() => onDismiss(annotation.id)}
                              style={{
                                fontSize: 10,
                                padding: '3px 8px',
                                background: colors.surfaceHover,
                                border: `1px solid ${colors.borderLight}`,
                                borderRadius: 4,
                                color: colors.textSecondary,
                                fontWeight: 500,
                                cursor: 'pointer',
                                fontFamily: fonts.sans,
                              }}
                            >
                              Dismiss
                            </button>
                          )}
                          {onSnooze && (
                            <>
                              <button
                                onClick={() => onSnooze(annotation.id, 1)}
                                style={{
                                  fontSize: 10,
                                  padding: '3px 8px',
                                  background: colors.surfaceHover,
                                  border: `1px solid ${colors.borderLight}`,
                                  borderRadius: 4,
                                  color: colors.textSecondary,
                                  fontWeight: 500,
                                  cursor: 'pointer',
                                  fontFamily: fonts.sans,
                                }}
                              >
                                Snooze 1w
                              </button>
                              <button
                                onClick={() => onSnooze(annotation.id, 2)}
                                style={{
                                  fontSize: 10,
                                  padding: '3px 8px',
                                  background: colors.surfaceHover,
                                  border: `1px solid ${colors.borderLight}`,
                                  borderRadius: 4,
                                  color: colors.textSecondary,
                                  fontWeight: 500,
                                  cursor: 'pointer',
                                  fontFamily: fonts.sans,
                                }}
                              >
                                Snooze 2w
                              </button>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
