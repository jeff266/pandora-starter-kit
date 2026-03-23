import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { colors, fonts } from '../../styles/theme';
import { useWorkspace } from '../../context/WorkspaceContext';
import CalibrationProgress from '../calibration/CalibrationProgress';
import type { CalibrationStep } from '../calibration/CalibrationProgress';
import QuotaImportSection from '../calibration/QuotaImportSection';
import DimensionCopySection from '../calibration/DimensionCopySection';
import { api } from '../../lib/api';

interface CalibrationStatus {
  status: 'not_started' | 'in_progress' | 'complete';
  stage_mappings: Record<string, string>;
  sections_calibrated: number;
  started_at: string | null;
  completed_at: string | null;
  calibration_method: string | null;
}

interface InterviewState {
  current_step: CalibrationStep;
  completed_steps: CalibrationStep[];
  started_at: string | null;
}

const METHOD_LABELS: Record<string, string> = {
  chat:   'Conversational Interview',
  upload: 'Report Upload',
  manual: 'Manual Configuration',
};

function StatusBadge({ status }: { status: CalibrationStatus['status'] }) {
  const cfg = {
    not_started: { label: 'Not Started', bg: colors.surfaceRaised, fg: colors.textMuted },
    in_progress:  { label: 'In Progress',  bg: '#fef3c7',            fg: '#92400e' },
    complete:     { label: 'Complete',     bg: '#dcfce7',            fg: '#15803d' },
  }[status];

  return (
    <span style={{
      background: cfg.bg,
      color: cfg.fg,
      fontSize: 11,
      fontWeight: 700,
      padding: '3px 10px',
      borderRadius: 12,
      textTransform: 'uppercase',
      letterSpacing: '0.05em',
    }}>
      {cfg.label}
    </span>
  );
}

function StageMappingTable({ mappings }: { mappings: Record<string, string> }) {
  const entries = Object.entries(mappings);
  if (entries.length === 0) {
    return (
      <p style={{ fontSize: 13, color: colors.textMuted, fontStyle: 'italic' }}>
        No stage mappings configured yet. Start the calibration interview to map your CRM stages.
      </p>
    );
  }

  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
      <thead>
        <tr style={{ borderBottom: `1px solid ${colors.border}` }}>
          <th style={{ textAlign: 'left', padding: '6px 12px 6px 0', color: colors.textSecondary, fontWeight: 600 }}>CRM Stage</th>
          <th style={{ textAlign: 'left', padding: '6px 0', color: colors.textSecondary, fontWeight: 600 }}>Normalized Stage</th>
        </tr>
      </thead>
      <tbody>
        {entries.map(([crm, normalized]) => (
          <tr key={crm} style={{ borderBottom: `1px solid ${colors.border}` }}>
            <td style={{ padding: '8px 12px 8px 0', color: colors.text }}>{crm}</td>
            <td style={{ padding: '8px 0', color: colors.textSecondary, fontFamily: fonts.mono, fontSize: 12 }}>{normalized}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function CalibrationTab() {
  const navigate = useNavigate();
  const { currentWorkspace } = useWorkspace();
  const wsId = currentWorkspace?.id;

  const [status, setStatus]     = useState<CalibrationStatus | null>(null);
  const [interview, setInterview] = useState<InterviewState | null>(null);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!wsId) return;
    setLoading(true);
    setError(null);
    try {
      const [statusData, interviewData] = await Promise.all([
        api.get('/calibration-status'),
        api.get('/calibration-interview-state').catch(() => null),
      ]);
      setStatus(statusData);
      if (interviewData) setInterview(interviewData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load calibration status');
    } finally {
      setLoading(false);
    }
  }, [wsId]);

  useEffect(() => { load(); }, [load]);

  const handleStartCalibration = () => {
    navigate('/');
    setTimeout(() => {
      const event = new CustomEvent('pandora:open-ask', {
        detail: { initialMessage: 'Let\'s calibrate my pipeline definitions' },
      });
      window.dispatchEvent(event);
    }, 200);
  };

  const handleRerunCalibration = () => {
    navigate('/');
    setTimeout(() => {
      const event = new CustomEvent('pandora:open-ask', {
        detail: { initialMessage: 'Let\'s recalibrate my pipeline definitions' },
      });
      window.dispatchEvent(event);
    }, 200);
  };

  if (loading) {
    return (
      <div style={{ padding: '40px 0', textAlign: 'center', color: colors.textMuted, fontFamily: fonts.sans }}>
        Loading calibration status…
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ maxWidth: 700, fontFamily: fonts.sans }}>
        <p style={{ color: '#ef4444', fontSize: 13 }}>{error}</p>
        <button onClick={load} style={{ fontSize: 13, color: colors.accent, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
          Retry
        </button>
      </div>
    );
  }

  const calStatus = status?.status ?? 'not_started';

  return (
    <div style={{ maxWidth: 700, fontFamily: fonts.sans, display: 'flex', flexDirection: 'column', gap: 28 }}>
      <div>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: colors.text, marginBottom: 6, marginTop: 0 }}>
          Pipeline Calibration
        </h1>
        <p style={{ fontSize: 14, color: colors.textSecondary, margin: 0 }}>
          Calibration teaches Pandora how your team defines pipeline, win rate, and forecast.
          Once calibrated, all reports and calculations use your confirmed definitions.
        </p>
      </div>

      <div style={{
        background: colors.surface,
        border: `1px solid ${colors.border}`,
        borderRadius: 10,
        padding: '20px 24px',
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 12, color: colors.textMuted, marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>
              Status
            </div>
            <StatusBadge status={calStatus} />
          </div>

          {status?.completed_at && (
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 11, color: colors.textMuted }}>Completed</div>
              <div style={{ fontSize: 13, color: colors.textSecondary }}>
                {new Date(status.completed_at).toLocaleDateString()}
              </div>
            </div>
          )}

          {status?.calibration_method && (
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 11, color: colors.textMuted }}>Method</div>
              <div style={{ fontSize: 13, color: colors.textSecondary }}>
                {METHOD_LABELS[status.calibration_method] ?? status.calibration_method}
              </div>
            </div>
          )}
        </div>

        {calStatus === 'not_started' && (
          <div style={{
            background: '#fef9ec',
            border: '1px solid #fde68a',
            borderRadius: 8,
            padding: '14px 16px',
            fontSize: 13,
            color: '#92400e',
          }}>
            Pandora is using default pipeline definitions. Calibrate to get accurate numbers that match your CRM.
          </div>
        )}

        {calStatus !== 'complete' && interview && (
          <div style={{ borderTop: `1px solid ${colors.border}`, paddingTop: 16 }}>
            <div style={{ fontSize: 12, color: colors.textMuted, marginBottom: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Interview Progress
            </div>
            <CalibrationProgress
              currentStep={interview.current_step}
              completedSteps={interview.completed_steps}
            />
          </div>
        )}

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {calStatus === 'not_started' && (
            <button
              onClick={handleStartCalibration}
              style={{
                padding: '9px 18px',
                background: '#f59e0b',
                color: '#fff',
                border: 'none',
                borderRadius: 6,
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
                fontFamily: fonts.sans,
              }}
            >
              Start Calibration
            </button>
          )}

          {calStatus === 'in_progress' && (
            <button
              onClick={handleStartCalibration}
              style={{
                padding: '9px 18px',
                background: '#f59e0b',
                color: '#fff',
                border: 'none',
                borderRadius: 6,
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
                fontFamily: fonts.sans,
              }}
            >
              Continue Calibration
            </button>
          )}

          {calStatus === 'complete' && (
            <button
              onClick={handleRerunCalibration}
              style={{
                padding: '9px 18px',
                background: 'transparent',
                color: colors.textSecondary,
                border: `1px solid ${colors.border}`,
                borderRadius: 6,
                fontSize: 13,
                fontWeight: 500,
                cursor: 'pointer',
                fontFamily: fonts.sans,
              }}
            >
              Re-run Calibration
            </button>
          )}
        </div>
      </div>

      <div style={{
        background: colors.surface,
        border: `1px solid ${colors.border}`,
        borderRadius: 10,
        padding: '20px 24px',
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
      }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: colors.text }}>Stage Mappings</div>
        <p style={{ fontSize: 13, color: colors.textSecondary, margin: 0 }}>
          Maps your CRM's stage names to Pandora's normalized funnel stages.
        </p>
        <StageMappingTable mappings={status?.stage_mappings ?? {}} />
      </div>

      <div style={{
        background: colors.surface,
        border: `1px solid ${colors.border}`,
        borderRadius: 10,
        padding: '20px 24px',
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
      }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: colors.text }}>Definitions Calibrated</div>
        <p style={{ fontSize: 13, color: colors.textSecondary, margin: 0 }}>
          Confirmed definitions used in pipeline, win rate, and forecast calculations.
        </p>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          {[
            'Active Pipeline', 'Pipeline Coverage', 'Win Rate',
            'At-Risk Deals', 'Commit / Forecast', 'Forecast Rollup',
          ].map((label, i) => {
            const confirmed = (status?.sections_calibrated ?? 0) > i;
            return (
              <div key={label} style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                fontSize: 13,
                color: confirmed ? colors.text : colors.textMuted,
              }}>
                <span style={{ color: confirmed ? '#22c55e' : colors.border }}>{confirmed ? '✓' : '○'}</span>
                {label}
              </div>
            );
          })}
        </div>
      </div>

      <QuotaImportSection onImportComplete={load} />
      <DimensionCopySection onCopyComplete={load} />
    </div>
  );
}
