import React, { useState } from 'react';
import type { ForecastAnnotation } from '../../hooks/useForecastAnnotations';
import { colors, fonts } from '../../styles/theme';

interface AnnotationCardProps {
  annotation: ForecastAnnotation;
  onDismiss: (id: string) => Promise<void>;
  onSnooze: (id: string, weeks: 1 | 2) => Promise<void>;
}

const SEVERITY_CONFIG = {
  critical: {
    accent: colors.red,
    bg: colors.redSoft,
    icon: '🔴',
    textColor: '#fca5a5',
  },
  warning: {
    accent: colors.yellow,
    bg: colors.yellowSoft,
    icon: '⚠️',
    textColor: '#fde68a',
  },
  positive: {
    accent: colors.green,
    bg: colors.greenSoft,
    icon: '✅',
    textColor: '#86efac',
  },
  info: {
    accent: colors.accent,
    bg: colors.accentSoft,
    icon: 'ℹ️',
    textColor: '#93c5fd',
  },
};

const ACTIONABILITY_LABELS = {
  immediate: 'This Week',
  strategic: 'Next 30 Days',
  monitor: 'Ongoing',
};

export default function AnnotationCard({
  annotation,
  onDismiss,
  onSnooze,
}: AnnotationCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [actionInProgress, setActionInProgress] = useState(false);

  const config = SEVERITY_CONFIG[annotation.severity];

  const handleDismiss = async () => {
    if (actionInProgress) return;
    setActionInProgress(true);
    try {
      await onDismiss(annotation.id);
    } catch (err) {
      console.error('Failed to dismiss annotation:', err);
      setActionInProgress(false);
    }
  };

  const handleSnooze = async (weeks: 1 | 2) => {
    if (actionInProgress) return;
    setActionInProgress(true);
    try {
      await onSnooze(annotation.id, weeks);
    } catch (err) {
      console.error('Failed to snooze annotation:', err);
      setActionInProgress(false);
    }
  };

  return (
    <div
      style={{
        background: colors.surfaceRaised,
        border: `1px solid ${colors.border}`,
        borderLeft: `3px solid ${config.accent}`,
        borderRadius: 6,
        padding: '10px 12px',
        marginBottom: 6,
        cursor: 'pointer',
        transition: 'background 0.15s',
      }}
      onMouseEnter={e => (e.currentTarget.style.background = colors.surfaceHover)}
      onMouseLeave={e => (e.currentTarget.style.background = colors.surfaceRaised)}
      onClick={() => setExpanded(!expanded)}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <div style={{ fontSize: 14, flexShrink: 0, marginTop: 1 }}>{config.icon}</div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: config.textColor, lineHeight: 1.4, fontFamily: fonts.sans }}>
                {annotation.title}
              </div>
              <div style={{ fontSize: 11, color: colors.textMuted, marginTop: 2, fontFamily: fonts.sans }}>
                {ACTIONABILITY_LABELS[annotation.actionability]}
              </div>
            </div>

            <svg
              style={{
                width: 16,
                height: 16,
                flexShrink: 0,
                color: colors.textMuted,
                transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)',
                transition: 'transform 0.2s',
              }}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </div>

          {expanded && (
            <div style={{ marginTop: 10 }} onClick={e => e.stopPropagation()}>
              {annotation.body && (
                <div style={{ fontSize: 12, color: colors.textSecondary, lineHeight: 1.6, marginBottom: 8, fontFamily: fonts.sans }}>
                  {annotation.body}
                </div>
              )}

              {annotation.impact && (
                <div style={{ fontSize: 12, marginBottom: 8, fontFamily: fonts.sans }}>
                  <span style={{ fontWeight: 600, color: colors.text }}>Impact: </span>
                  <span style={{ color: colors.textSecondary }}>{annotation.impact}</span>
                </div>
              )}

              {annotation.recommendation && (
                <div style={{
                  fontSize: 12,
                  background: 'rgba(59,130,246,0.06)',
                  borderRadius: 4,
                  padding: '8px 10px',
                  border: `1px solid ${colors.border}`,
                  marginBottom: 10,
                  fontFamily: fonts.sans,
                }}>
                  <span style={{ fontWeight: 600, color: colors.accent }}>→ </span>
                  <span style={{ color: colors.textSecondary }}>{annotation.recommendation}</span>
                </div>
              )}

              <div style={{ display: 'flex', alignItems: 'center', gap: 6, paddingTop: 8, borderTop: `1px solid ${colors.border}` }}>
                {[
                  { label: 'Dismiss', onClick: handleDismiss },
                  { label: 'Snooze 1w', onClick: () => handleSnooze(1) },
                  { label: 'Snooze 2w', onClick: () => handleSnooze(2) },
                ].map(btn => (
                  <button
                    key={btn.label}
                    onClick={btn.onClick}
                    disabled={actionInProgress}
                    style={{
                      fontSize: 11,
                      padding: '4px 10px',
                      background: colors.surfaceHover,
                      border: `1px solid ${colors.borderLight}`,
                      borderRadius: 4,
                      color: colors.textSecondary,
                      fontWeight: 500,
                      cursor: actionInProgress ? 'not-allowed' : 'pointer',
                      opacity: actionInProgress ? 0.5 : 1,
                      fontFamily: fonts.sans,
                      transition: 'background 0.12s',
                    }}
                    onMouseEnter={e => { if (!actionInProgress) e.currentTarget.style.background = colors.surfaceActive; }}
                    onMouseLeave={e => { e.currentTarget.style.background = colors.surfaceHover; }}
                  >
                    {btn.label}
                  </button>
                ))}
                {annotation.evidence.deal_names.length > 0 && (
                  <span style={{ fontSize: 11, color: colors.textMuted, marginLeft: 'auto', fontFamily: fonts.mono }}>
                    {annotation.evidence.deal_names.length} deal{annotation.evidence.deal_names.length !== 1 ? 's' : ''}
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
