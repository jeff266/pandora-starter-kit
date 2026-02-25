import React, { useState } from 'react';
import type { ForecastAnnotation } from '../../hooks/useForecastAnnotations';

interface AnnotationCardProps {
  annotation: ForecastAnnotation;
  onDismiss: (id: string) => Promise<void>;
  onSnooze: (id: string, weeks: 1 | 2) => Promise<void>;
}

const SEVERITY_CONFIG = {
  critical: {
    bg: 'bg-red-50',
    border: 'border-red-200',
    accent: 'border-l-red-500',
    icon: '🔴',
    textColor: 'text-red-900',
  },
  warning: {
    bg: 'bg-amber-50',
    border: 'border-amber-200',
    accent: 'border-l-amber-500',
    icon: '⚠️',
    textColor: 'text-amber-900',
  },
  positive: {
    bg: 'bg-green-50',
    border: 'border-green-200',
    accent: 'border-l-green-500',
    icon: '✅',
    textColor: 'text-green-900',
  },
  info: {
    bg: 'bg-blue-50',
    border: 'border-blue-200',
    accent: 'border-l-blue-500',
    icon: 'ℹ️',
    textColor: 'text-blue-900',
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
      className={`border ${config.border} ${config.bg} ${config.accent} border-l-4 rounded-lg p-3 mb-2 transition-all duration-200 hover:shadow-sm`}
    >
      <div className="flex items-start gap-3">
        {/* Icon */}
        <div className="text-lg mt-0.5 flex-shrink-0">{config.icon}</div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          {/* Header */}
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1">
              <div className={`text-sm font-semibold ${config.textColor} leading-snug`}>
                {annotation.title}
              </div>
              <div className="text-xs text-slate-500 mt-0.5">
                {ACTIONABILITY_LABELS[annotation.actionability]}
              </div>
            </div>

            {/* Expand/Collapse Button */}
            <button
              onClick={() => setExpanded(!expanded)}
              className="text-slate-400 hover:text-slate-600 transition-colors flex-shrink-0"
              aria-label={expanded ? 'Collapse' : 'Expand'}
            >
              <svg
                className={`w-5 h-5 transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
          </div>

          {/* Expanded Content */}
          {expanded && (
            <div className="mt-3 space-y-2">
              {/* Body */}
              <div className="text-sm text-slate-700 leading-relaxed">{annotation.body}</div>

              {/* Impact */}
              {annotation.impact && (
                <div className="text-sm">
                  <span className="font-semibold text-slate-900">Impact:</span>{' '}
                  <span className="text-slate-700">{annotation.impact}</span>
                </div>
              )}

              {/* Recommendation */}
              {annotation.recommendation && (
                <div className="text-sm bg-white bg-opacity-50 rounded p-2 border border-slate-200">
                  <span className="font-semibold text-slate-900">→ Recommended Action:</span>{' '}
                  <span className="text-slate-700">{annotation.recommendation}</span>
                </div>
              )}

              {/* Actions */}
              <div className="flex items-center gap-2 pt-2 border-t border-slate-200">
                <button
                  onClick={handleDismiss}
                  disabled={actionInProgress}
                  className="text-xs px-3 py-1.5 bg-white border border-slate-300 rounded hover:bg-slate-50 text-slate-700 font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Dismiss
                </button>
                <button
                  onClick={() => handleSnooze(1)}
                  disabled={actionInProgress}
                  className="text-xs px-3 py-1.5 bg-white border border-slate-300 rounded hover:bg-slate-50 text-slate-700 font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Snooze 1w
                </button>
                <button
                  onClick={() => handleSnooze(2)}
                  disabled={actionInProgress}
                  className="text-xs px-3 py-1.5 bg-white border border-slate-300 rounded hover:bg-slate-50 text-slate-700 font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Snooze 2w
                </button>
                {annotation.evidence.deal_names.length > 0 && (
                  <span className="text-xs text-slate-500 ml-auto">
                    {annotation.evidence.deal_names.length} deal
                    {annotation.evidence.deal_names.length !== 1 ? 's' : ''}
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
