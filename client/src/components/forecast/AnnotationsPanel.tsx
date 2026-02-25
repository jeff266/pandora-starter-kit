import React, { useState } from 'react';
import { useForecastAnnotations } from '../../hooks/useForecastAnnotations';
import AnnotationCard from './AnnotationCard';

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
      <div className="bg-white border border-slate-200 rounded-lg p-6">
        <div className="animate-pulse space-y-3">
          <div className="h-4 bg-slate-200 rounded w-1/4"></div>
          <div className="h-20 bg-slate-100 rounded"></div>
          <div className="h-20 bg-slate-100 rounded"></div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-4">
        <p className="text-sm text-red-800">Failed to load annotations: {error}</p>
      </div>
    );
  }

  if (annotations.length === 0) {
    return null; // Don't show panel if no annotations
  }

  const criticalCount = bySeverity.critical.length;
  const warningCount = bySeverity.warning.length;
  const positiveCount = bySeverity.positive.length;

  return (
    <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-slate-200 bg-slate-50">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <span className="text-lg">✨</span>
              <h3 className="text-sm font-semibold text-slate-900">AI Insights</h3>
            </div>

            {/* Severity Badges */}
            <div className="flex items-center gap-2">
              {criticalCount > 0 && (
                <span className="text-xs px-2 py-0.5 bg-red-100 text-red-800 rounded-full font-medium">
                  {criticalCount} critical
                </span>
              )}
              {warningCount > 0 && (
                <span className="text-xs px-2 py-0.5 bg-amber-100 text-amber-800 rounded-full font-medium">
                  {warningCount} warning
                </span>
              )}
              {positiveCount > 0 && (
                <span className="text-xs px-2 py-0.5 bg-green-100 text-green-800 rounded-full font-medium">
                  {positiveCount} positive
                </span>
              )}
            </div>
          </div>

          {/* Toggle Button */}
          {showToggle && (
            <button
              onClick={() => setShowAnnotations(!showAnnotations)}
              className="text-xs px-3 py-1 bg-white border border-slate-300 rounded hover:bg-slate-50 text-slate-700 font-medium transition-colors"
            >
              {showAnnotations ? 'Hide' : 'Show'}
            </button>
          )}
        </div>

        {metadata.total_generated > annotations.length && (
          <p className="text-xs text-slate-500 mt-2">
            {annotations.length} active ({metadata.total_generated - annotations.length} dismissed/snoozed)
          </p>
        )}
      </div>

      {/* Annotations List */}
      {showAnnotations && (
        <div className="p-4">
          {/* Critical Annotations First */}
          {bySeverity.critical.length > 0 && (
            <div className="mb-4">
              <h4 className="text-xs font-semibold text-slate-700 uppercase tracking-wide mb-2">
                Critical
              </h4>
              {bySeverity.critical.map(annotation => (
                <AnnotationCard
                  key={annotation.id}
                  annotation={annotation}
                  onDismiss={dismiss}
                  onSnooze={snooze}
                />
              ))}
            </div>
          )}

          {/* Warning Annotations */}
          {bySeverity.warning.length > 0 && (
            <div className="mb-4">
              <h4 className="text-xs font-semibold text-slate-700 uppercase tracking-wide mb-2">
                Warnings
              </h4>
              {bySeverity.warning.map(annotation => (
                <AnnotationCard
                  key={annotation.id}
                  annotation={annotation}
                  onDismiss={dismiss}
                  onSnooze={snooze}
                />
              ))}
            </div>
          )}

          {/* Positive Annotations */}
          {bySeverity.positive.length > 0 && (
            <div className="mb-4">
              <h4 className="text-xs font-semibold text-slate-700 uppercase tracking-wide mb-2">
                Positive Signals
              </h4>
              {bySeverity.positive.map(annotation => (
                <AnnotationCard
                  key={annotation.id}
                  annotation={annotation}
                  onDismiss={dismiss}
                  onSnooze={snooze}
                />
              ))}
            </div>
          )}

          {/* Info Annotations */}
          {bySeverity.info.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-slate-700 uppercase tracking-wide mb-2">
                Information
              </h4>
              {bySeverity.info.map(annotation => (
                <AnnotationCard
                  key={annotation.id}
                  annotation={annotation}
                  onDismiss={dismiss}
                  onSnooze={snooze}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
