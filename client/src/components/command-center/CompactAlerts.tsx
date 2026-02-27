import React from 'react';
import { useForecastAnnotations } from '../../hooks/useForecastAnnotations';
import type { ForecastAnnotation } from '../../hooks/useForecastAnnotations';
import { colors, fonts } from '../../styles/theme';
import { useDemoMode } from '../../contexts/DemoModeContext';

interface CompactAlertsProps {
  workspaceId: string;
  period?: string;
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

function firstSentence(text: string): string {
  if (!text) return '';
  const match = text.match(/^[^.!?]*[.!?]/);
  return match ? match[0] : text;
}

function CompactAlertCard({ annotation }: { annotation: ForecastAnnotation }) {
  const { anon } = useDemoMode();
  const config = SEVERITY_CONFIG[annotation.severity];

  return (
    <div
      style={{
        background: colors.surfaceRaised,
        border: `1px solid ${colors.border}`,
        borderLeft: `3px solid ${config.accent}`,
        borderRadius: 6,
        padding: '8px 12px',
        marginBottom: 6,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <span style={{ fontSize: 13, flexShrink: 0, marginTop: 1 }}>{config.icon}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: config.textColor,
              lineHeight: 1.4,
              fontFamily: fonts.sans,
            }}
          >
            {anon.text(annotation.title)}
          </div>
          {annotation.body && (
            <div
              style={{
                fontSize: 12,
                color: colors.textSecondary,
                lineHeight: 1.5,
                marginTop: 3,
                fontFamily: fonts.sans,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {anon.text(firstSentence(annotation.body))}
            </div>
          )}
          {annotation.severity === 'critical' && annotation.impact && (
            <div
              style={{
                fontSize: 11,
                color: colors.red,
                marginTop: 4,
                fontFamily: fonts.sans,
                fontWeight: 500,
              }}
            >
              Impact: {anon.text(annotation.impact)}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function CompactAlerts({ workspaceId, period }: CompactAlertsProps) {
  const { annotations, bySeverity, loading, error } =
    useForecastAnnotations(workspaceId, period);

  if (loading) {
    return (
      <div
        style={{
          background: colors.surface,
          border: `1px solid ${colors.border}`,
          borderRadius: 8,
          padding: 16,
        }}
      >
        <div style={{ height: 14, background: colors.surfaceHover, borderRadius: 4, width: '30%' }} />
        <div style={{ height: 44, background: colors.surfaceRaised, borderRadius: 6, marginTop: 10 }} />
        <div style={{ height: 44, background: colors.surfaceRaised, borderRadius: 6, marginTop: 6 }} />
      </div>
    );
  }

  if (error || annotations.length === 0) {
    return null;
  }

  const prioritized = [
    ...bySeverity.critical,
    ...bySeverity.warning,
  ].slice(0, 3);

  if (prioritized.length === 0) {
    return null;
  }

  const totalAlerts = annotations.length;
  const remaining = totalAlerts - prioritized.length;

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
          padding: '10px 16px',
          borderBottom: `1px solid ${colors.border}`,
          background: colors.surfaceRaised,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 15 }}>✨</span>
          <span
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: colors.text,
              fontFamily: fonts.sans,
            }}
          >
            AI Alerts
          </span>
          {bySeverity.critical.length > 0 && (
            <span
              style={{
                fontSize: 11,
                padding: '2px 8px',
                background: colors.redSoft,
                color: colors.red,
                borderRadius: 10,
                fontWeight: 500,
                fontFamily: fonts.sans,
              }}
            >
              {bySeverity.critical.length} critical
            </span>
          )}
        </div>
        <a
          href="/forecast"
          style={{
            fontSize: 12,
            color: colors.accent,
            textDecoration: 'none',
            fontWeight: 500,
            fontFamily: fonts.sans,
          }}
        >
          View all insights →
        </a>
      </div>

      <div style={{ padding: 12 }}>
        {prioritized.map(annotation => (
          <CompactAlertCard key={annotation.id} annotation={annotation} />
        ))}

        {remaining > 0 && (
          <a
            href="/forecast"
            style={{
              display: 'block',
              textAlign: 'center',
              fontSize: 12,
              color: colors.textSecondary,
              textDecoration: 'none',
              padding: '6px 0 2px',
              fontFamily: fonts.sans,
            }}
          >
            {remaining} more insight{remaining !== 1 ? 's' : ''} on the Forecast page →
          </a>
        )}
      </div>
    </div>
  );
}
