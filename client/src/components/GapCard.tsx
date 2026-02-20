import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { colors, fonts } from '../styles/theme';
import { formatCurrency, formatNumber } from '../lib/format';
import Skeleton from './Skeleton';

interface GapData {
  target_amount: number;
  target_metric: string;
  period_label: string;
  period_start: string;
  period_end: string;
  days_remaining: number;

  closed_amount: number;
  closed_deal_count: number;
  attainment_pct: number;

  monte_carlo_p50: number | null;
  monte_carlo_p10: number | null;
  monte_carlo_p90: number | null;
  hit_probability: number | null;

  gap_to_target: number;
  gap_status: 'on_track' | 'at_risk' | 'critical' | 'achieved';

  workspace_win_rate: number;
  avg_deal_size: number;
  avg_sales_cycle_days: number;
  required_pipeline: number;
  required_deals: number;
  pipeline_deadline: string;
  days_to_pipeline_deadline: number;

  current_open_pipeline: number;
  current_open_deal_count: number;
  pipeline_vs_required: number;

  current_deals_per_week: number;
  required_deals_per_week: number;
}

type GapCardState = 'loading' | 'empty' | 'ready' | 'error';

const STATUS_CONFIG = {
  achieved: {
    label: '✓ Target Hit',
    color: colors.green,
    bg: 'rgba(34,197,94,0.1)',
    border: colors.green,
  },
  on_track: {
    label: 'On Track',
    color: colors.green,
    bg: 'rgba(34,197,94,0.1)',
    border: colors.green,
  },
  at_risk: {
    label: 'At Risk',
    color: colors.orange,
    bg: 'rgba(251,146,60,0.1)',
    border: colors.orange,
  },
  critical: {
    label: 'Critical',
    color: colors.red,
    bg: 'rgba(239,68,68,0.1)',
    border: colors.red,
  },
};

export default function GapCard({ wsId }: { wsId?: string }) {
  const navigate = useNavigate();
  const [state, setState] = useState<GapCardState>('loading');
  const [gap, setGap] = useState<GapData | null>(null);
  const [editModalOpen, setEditModalOpen] = useState(false);

  useEffect(() => {
    if (!wsId) return;

    setState('loading');
    api.get(`/targets/gap`)
      .then((data: GapData) => {
        setGap(data);
        setState('ready');
      })
      .catch(err => {
        if (err.message?.includes('No active target')) {
          setState('empty');
        } else {
          console.error('[GapCard] Error fetching gap:', err);
          setState('error');
        }
      });
  }, [wsId]);

  if (state === 'loading') {
    return (
      <div style={{
        background: colors.surface,
        border: `1px solid ${colors.border}`,
        borderRadius: 8,
        padding: 20,
        fontFamily: fonts.sans,
      }}>
        <Skeleton height={120} />
      </div>
    );
  }

  if (state === 'empty') {
    return (
      <div style={{
        background: colors.accentSoft,
        border: `1px solid rgba(59,130,246,0.2)`,
        borderRadius: 8,
        padding: '14px 18px',
        fontFamily: fonts.sans,
        fontSize: 13,
        display: 'flex',
        alignItems: 'center',
        gap: 10,
      }}>
        <span style={{ fontSize: 16 }}>{'\uD83D\uDCAF'}</span>
        <span style={{ color: colors.textSecondary }}>
          Set your target to unlock gap analysis and hit probability —{' '}
          <span
            onClick={() => navigate('/targets')}
            style={{ color: colors.accent, cursor: 'pointer', textDecoration: 'underline' }}
          >
            Set up targets
          </span>
        </span>
      </div>
    );
  }

  if (state === 'error' || !gap) {
    return null;
  }

  const status = STATUS_CONFIG[gap.gap_status];
  const targetAmount = typeof gap.target_amount === 'string' ? parseFloat(gap.target_amount) : gap.target_amount;
  const deadlinePassed = gap.days_to_pipeline_deadline < 0;

  return (
    <div style={{
      background: colors.surface,
      border: `2px solid ${status.border}`,
      borderRadius: 8,
      padding: '18px 20px',
      fontFamily: fonts.sans,
      position: 'relative',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: colors.text }}>
            {gap.period_label}
          </span>
          <span style={{
            fontSize: 11,
            fontWeight: 600,
            color: status.color,
            background: status.bg,
            padding: '2px 8px',
            borderRadius: 12,
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
          }}>
            {status.label}
          </span>
        </div>
        <button
          onClick={() => navigate('/targets')}
          style={{
            background: 'transparent',
            border: `1px solid ${colors.border}`,
            borderRadius: 6,
            padding: '4px 10px',
            fontSize: 12,
            color: colors.textSecondary,
            cursor: 'pointer',
            fontFamily: fonts.sans,
            display: 'flex',
            alignItems: 'center',
            gap: 4,
          }}
          onMouseEnter={e => (e.currentTarget.style.background = colors.surfaceHover)}
          onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
        >
          Edit target ✎
        </button>
      </div>

      {/* Main metrics */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(3, 1fr)',
        gap: 16,
        marginBottom: 12,
      }}>
        <div>
          <div style={{ fontSize: 11, color: colors.textMuted, marginBottom: 4 }}>Target</div>
          <div style={{ fontSize: 20, fontWeight: 600, color: colors.text }}>
            {formatCurrency(targetAmount)}
          </div>
        </div>
        <div>
          <div style={{ fontSize: 11, color: colors.textMuted, marginBottom: 4 }}>Closed</div>
          <div style={{ fontSize: 20, fontWeight: 600, color: colors.text }}>
            {formatCurrency(gap.closed_amount)}
          </div>
        </div>
        <div>
          <div style={{ fontSize: 11, color: colors.textMuted, marginBottom: 4 }}>Gap</div>
          <div style={{ fontSize: 20, fontWeight: 600, color: gap.gap_to_target > 0 ? colors.orange : colors.green }}>
            {formatCurrency(Math.abs(gap.gap_to_target))}
          </div>
        </div>
      </div>

      {/* Progress bar */}
      <div style={{ marginBottom: 16 }}>
        <div style={{
          height: 8,
          background: colors.surfaceHover,
          borderRadius: 4,
          overflow: 'hidden',
          position: 'relative',
        }}>
          <div style={{
            position: 'absolute',
            top: 0,
            left: 0,
            height: '100%',
            width: `${Math.min(100, gap.attainment_pct * 100)}%`,
            background: status.color,
            transition: 'width 0.3s ease',
          }} />
        </div>
        <div style={{ fontSize: 11, color: colors.textMuted, marginTop: 4 }}>
          {(gap.attainment_pct * 100).toFixed(0)}% attained
        </div>
      </div>

      {/* Gap closure section */}
      {gap.gap_status !== 'achieved' && (
        <>
          <div style={{
            fontSize: 12,
            fontWeight: 600,
            color: colors.text,
            marginBottom: 8,
          }}>
            To close the gap:
          </div>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            fontSize: 12,
            color: colors.textSecondary,
            marginBottom: 12,
          }}>
            <span>
              <strong style={{ color: colors.text }}>{formatCurrency(gap.required_pipeline)}</strong> pipeline needed
            </span>
            <span style={{ color: colors.textDim }}>·</span>
            <span>
              <strong style={{ color: colors.text }}>{gap.required_deals}</strong> deals
            </span>
            <span style={{ color: colors.textDim }}>·</span>
            <span>
              enter by{' '}
              <strong style={{ color: colors.text }}>
                {new Date(gap.pipeline_deadline).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
              </strong>
              {deadlinePassed ? (
                <span style={{ color: colors.red, marginLeft: 4 }}>(window closed)</span>
              ) : (
                <span style={{ color: colors.textMuted, marginLeft: 4 }}>({gap.days_to_pipeline_deadline}d away)</span>
              )}
            </span>
          </div>

          {!deadlinePassed && (
            <div style={{
              fontSize: 12,
              color: colors.textSecondary,
              marginBottom: 12,
            }}>
              Need{' '}
              <strong style={{ color: colors.text }}>{gap.required_deals_per_week.toFixed(1)}</strong>{' '}
              deals/week · generating{' '}
              <strong style={{
                color: gap.current_deals_per_week >= gap.required_deals_per_week ? colors.green : colors.orange
              }}>
                {gap.current_deals_per_week.toFixed(1)}
              </strong>/week
            </div>
          )}

          {deadlinePassed && (
            <div style={{
              fontSize: 12,
              color: colors.orange,
              background: 'rgba(251,146,60,0.1)',
              padding: '8px 12px',
              borderRadius: 6,
              marginBottom: 12,
            }}>
              Pipeline window has closed — focus on late-stage acceleration
            </div>
          )}
        </>
      )}

      {/* Monte Carlo integration */}
      {gap.monte_carlo_p50 !== null && (
        <div style={{
          borderTop: `1px solid ${colors.border}`,
          paddingTop: 12,
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          fontSize: 12,
          color: colors.textSecondary,
        }}>
          <span>
            Monte Carlo P50:{' '}
            <strong style={{ color: colors.text }}>{formatCurrency(gap.monte_carlo_p50)}</strong>
          </span>
          {gap.hit_probability !== null && (
            <>
              <span style={{ color: colors.textDim }}>·</span>
              <span>
                Hit probability:{' '}
                <strong style={{
                  color: gap.hit_probability >= 0.7 ? colors.green : gap.hit_probability >= 0.4 ? colors.orange : colors.red
                }}>
                  {(gap.hit_probability * 100).toFixed(0)}%
                </strong>
              </span>
            </>
          )}
        </div>
      )}

      {/* Action buttons */}
      <div style={{
        borderTop: `1px solid ${colors.border}`,
        paddingTop: 12,
        marginTop: 12,
        display: 'flex',
        gap: 8,
      }}>
        <button
          onClick={() => navigate('/deals')}
          style={{
            background: colors.accentSoft,
            border: `1px solid ${colors.accent}`,
            borderRadius: 6,
            padding: '6px 12px',
            fontSize: 12,
            color: colors.accent,
            cursor: 'pointer',
            fontFamily: fonts.sans,
            fontWeight: 500,
          }}
          onMouseEnter={e => (e.currentTarget.style.background = colors.accent) && (e.currentTarget.style.color = '#fff')}
          onMouseLeave={e => (e.currentTarget.style.background = colors.accentSoft) && (e.currentTarget.style.color = colors.accent)}
        >
          Drill into pipeline
        </button>
        <button
          onClick={() => navigate('/targets')}
          style={{
            background: 'transparent',
            border: `1px solid ${colors.border}`,
            borderRadius: 6,
            padding: '6px 12px',
            fontSize: 12,
            color: colors.textSecondary,
            cursor: 'pointer',
            fontFamily: fonts.sans,
          }}
          onMouseEnter={e => (e.currentTarget.style.background = colors.surfaceHover)}
          onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
        >
          View full breakdown
        </button>
      </div>
    </div>
  );
}
