import React, { useState } from 'react';
import { useForecastAnnotations } from '../../hooks/useForecastAnnotations';
import AnnotationCard from './AnnotationCard';
import { colors, fonts } from '../../styles/theme';

interface AnnotationsPanelProps {
  workspaceId: string;
  period?: string;
  defaultExpanded?: boolean;
  showToggle?: boolean;
}

export default function AnnotationsPanel({
  workspaceId,
  period,
  defaultExpanded = true,
  showToggle = true,
}: AnnotationsPanelProps) {
  const [showAnnotations, setShowAnnotations] = useState(defaultExpanded);
  const { annotations, bySeverity, metadata, loading, error, dismiss, snooze } =
    useForecastAnnotations(workspaceId, period);

  if (loading) {
    return (
      <div style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 8, padding: 20 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ height: 16, background: colors.surfaceHover, borderRadius: 4, width: '25%' }} />
          <div style={{ height: 60, background: colors.surfaceRaised, borderRadius: 6 }} />
          <div style={{ height: 60, background: colors.surfaceRaised, borderRadius: 6 }} />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ background: colors.redSoft, border: `1px solid rgba(239,68,68,0.25)`, borderRadius: 8, padding: 14 }}>
        <p style={{ fontSize: 13, color: colors.red }}>Failed to load annotations: {error}</p>
      </div>
    );
  }

  if (annotations.length === 0) {
    return null;
  }

  const criticalCount = bySeverity.critical.length;
  const warningCount = bySeverity.warning.length;
  const positiveCount = bySeverity.positive.length;

  return (
    <div style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 8, overflow: 'hidden' }}>
      <div style={{ padding: '10px 16px', borderBottom: `1px solid ${colors.border}`, background: colors.surfaceRaised, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 15 }}>✨</span>
            <span style={{ fontSize: 13, fontWeight: 600, color: colors.text, fontFamily: fonts.sans }}>AI Insights</span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {criticalCount > 0 && (
              <span style={{ fontSize: 11, padding: '2px 8px', background: colors.redSoft, color: colors.red, borderRadius: 10, fontWeight: 500, fontFamily: fonts.sans }}>
                {criticalCount} critical
              </span>
            )}
            {warningCount > 0 && (
              <span style={{ fontSize: 11, padding: '2px 8px', background: colors.yellowSoft, color: colors.yellow, borderRadius: 10, fontWeight: 500, fontFamily: fonts.sans }}>
                {warningCount} warning{warningCount !== 1 ? 's' : ''}
              </span>
            )}
            {positiveCount > 0 && (
              <span style={{ fontSize: 11, padding: '2px 8px', background: colors.greenSoft, color: colors.green, borderRadius: 10, fontWeight: 500, fontFamily: fonts.sans }}>
                {positiveCount} positive
              </span>
            )}
          </div>
        </div>

        {showToggle && (
          <button
            onClick={() => setShowAnnotations(!showAnnotations)}
            style={{
              fontSize: 11,
              padding: '3px 10px',
              background: colors.surfaceHover,
              border: `1px solid ${colors.borderLight}`,
              borderRadius: 4,
              color: colors.textSecondary,
              fontWeight: 500,
              cursor: 'pointer',
              fontFamily: fonts.sans,
            }}
          >
            {showAnnotations ? 'Hide' : 'Show'}
          </button>
        )}
      </div>

      {metadata.total_generated > annotations.length && (
        <div style={{ padding: '6px 16px 0', fontSize: 11, color: colors.textMuted }}>
          {annotations.length} active ({metadata.total_generated - annotations.length} dismissed/snoozed)
        </div>
      )}

      {showAnnotations && (
        <div style={{ padding: 12 }}>
          {bySeverity.critical.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <h4 style={{ fontSize: 10, fontWeight: 600, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8, fontFamily: fonts.sans }}>
                Critical
              </h4>
              {bySeverity.critical.map(annotation => (
                <AnnotationCard key={annotation.id} annotation={annotation} onDismiss={dismiss} onSnooze={snooze} />
              ))}
            </div>
          )}

          {bySeverity.warning.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <h4 style={{ fontSize: 10, fontWeight: 600, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8, fontFamily: fonts.sans }}>
                Warnings
              </h4>
              {bySeverity.warning.map(annotation => (
                <AnnotationCard key={annotation.id} annotation={annotation} onDismiss={dismiss} onSnooze={snooze} />
              ))}
            </div>
          )}

          {bySeverity.positive.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <h4 style={{ fontSize: 10, fontWeight: 600, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8, fontFamily: fonts.sans }}>
                Positive Signals
              </h4>
              {bySeverity.positive.map(annotation => (
                <AnnotationCard key={annotation.id} annotation={annotation} onDismiss={dismiss} onSnooze={snooze} />
              ))}
            </div>
          )}

          {bySeverity.info.length > 0 && (
            <div>
              <h4 style={{ fontSize: 10, fontWeight: 600, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8, fontFamily: fonts.sans }}>
                Information
              </h4>
              {bySeverity.info.map(annotation => (
                <AnnotationCard key={annotation.id} annotation={annotation} onDismiss={dismiss} onSnooze={snooze} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
