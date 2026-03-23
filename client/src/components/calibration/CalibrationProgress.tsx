import React from 'react';
import { colors, fonts } from '../../styles/theme';

export type CalibrationStep =
  | 'stage_mapping'
  | 'active_pipeline'
  | 'pipeline_coverage'
  | 'win_rate'
  | 'at_risk'
  | 'commit'
  | 'forecast_rollup'
  | 'complete';

const STEP_LABELS: Record<CalibrationStep, string> = {
  stage_mapping:     'Stage Mapping',
  active_pipeline:   'Active Pipeline',
  pipeline_coverage: 'Pipeline Coverage',
  win_rate:          'Win Rate',
  at_risk:           'At-Risk Deals',
  commit:            'Commit / Forecast',
  forecast_rollup:   'Forecast Rollup',
  complete:          'Complete',
};

const STEP_ORDER: CalibrationStep[] = [
  'stage_mapping', 'active_pipeline', 'pipeline_coverage',
  'win_rate', 'at_risk', 'commit', 'forecast_rollup',
];

interface CalibrationProgressProps {
  currentStep: CalibrationStep;
  completedSteps: CalibrationStep[];
  compact?: boolean;
}

export default function CalibrationProgress({
  currentStep,
  completedSteps,
  compact = false,
}: CalibrationProgressProps) {
  if (compact) {
    const total     = STEP_ORDER.length;
    const completed = completedSteps.filter(s => STEP_ORDER.includes(s)).length;
    const pct       = Math.round((completed / total) * 100);

    return (
      <div style={{ fontFamily: fonts.sans, display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ flex: 1, height: 4, background: colors.border, borderRadius: 2 }}>
          <div style={{
            height: '100%',
            width: `${pct}%`,
            background: pct === 100 ? '#22c55e' : '#f59e0b',
            borderRadius: 2,
            transition: 'width 0.4s ease',
          }} />
        </div>
        <span style={{ fontSize: 11, color: colors.textMuted, whiteSpace: 'nowrap' }}>
          {completed}/{total} steps
        </span>
      </div>
    );
  }

  return (
    <div style={{ fontFamily: fonts.sans, display: 'flex', flexDirection: 'column', gap: 8 }}>
      {STEP_ORDER.map((step, i) => {
        const isDone    = completedSteps.includes(step);
        const isCurrent = step === currentStep;
        const isPending = !isDone && !isCurrent;

        return (
          <div key={step} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              width: 20,
              height: 20,
              borderRadius: '50%',
              flexShrink: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 11,
              fontWeight: 700,
              background: isDone    ? '#22c55e'
                        : isCurrent ? '#f59e0b'
                        : colors.border,
              color: isDone || isCurrent ? '#fff' : colors.textMuted,
            }}>
              {isDone ? '✓' : i + 1}
            </div>

            <span style={{
              fontSize: 13,
              fontWeight: isCurrent ? 600 : 400,
              color: isDone ? colors.textSecondary
                   : isCurrent ? colors.text
                   : colors.textMuted,
            }}>
              {STEP_LABELS[step]}
            </span>

            {isCurrent && (
              <span style={{
                fontSize: 10,
                fontWeight: 700,
                background: '#fef3c7',
                color: '#92400e',
                padding: '1px 6px',
                borderRadius: 8,
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
              }}>
                Now
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
