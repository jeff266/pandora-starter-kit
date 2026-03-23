import React from 'react';
import type { CalibrationConfirmedBlock } from '../../../../shared/types/response-blocks';
import { colors, fonts } from '../../styles/theme';

interface Props {
  block: CalibrationConfirmedBlock;
}

function formatValue(v: number): string {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000)     return `$${Math.round(v / 1_000)}K`;
  return `$${Math.round(v)}`;
}

export default function CalibrationConfirmedBlockView({ block }: Props) {
  const progressPct = Math.round((parseInt(block.step) / block.total_steps) * 100);

  return (
    <div style={{
      background: colors.surface,
      border: `1px solid ${colors.border}`,
      borderLeft: `4px solid #22c55e`,
      borderRadius: 8,
      padding: '16px 20px',
      fontFamily: fonts.sans,
      display: 'flex',
      flexDirection: 'column',
      gap: 12,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 18 }}>✓</span>
          <span style={{ fontWeight: 600, fontSize: 14, color: colors.text }}>
            {block.dimension_label} Confirmed
          </span>
        </div>
        {block.is_final && (
          <span style={{
            background: '#dcfce7',
            color: '#15803d',
            fontSize: 11,
            fontWeight: 700,
            padding: '2px 8px',
            borderRadius: 12,
            letterSpacing: '0.04em',
            textTransform: 'uppercase',
          }}>
            Calibration Complete
          </span>
        )}
      </div>

      <div style={{ display: 'flex', gap: 24 }}>
        <div>
          <div style={{ fontSize: 11, color: colors.textMuted, marginBottom: 2 }}>VALUE</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: colors.text }}>
            {formatValue(block.confirmed_value)}
          </div>
        </div>
        <div>
          <div style={{ fontSize: 11, color: colors.textMuted, marginBottom: 2 }}>DEALS</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: colors.text }}>
            {block.confirmed_count.toLocaleString()}
          </div>
        </div>
      </div>

      {block.filter_summary && (
        <div style={{
          background: colors.surfaceRaised,
          borderRadius: 4,
          padding: '6px 10px',
          fontSize: 12,
          color: colors.textSecondary,
          fontFamily: fonts.mono,
        }}>
          {block.filter_summary}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: colors.textMuted }}>
          <span>Step {block.step} of {block.total_steps}</span>
          <span>{progressPct}%</span>
        </div>
        <div style={{
          height: 4,
          background: colors.border,
          borderRadius: 2,
          overflow: 'hidden',
        }}>
          <div style={{
            height: '100%',
            width: `${progressPct}%`,
            background: '#22c55e',
            borderRadius: 2,
            transition: 'width 0.4s ease',
          }} />
        </div>
      </div>

      {block.next_step && !block.is_final && (
        <div style={{ fontSize: 12, color: colors.textSecondary }}>
          Next: <span style={{ fontWeight: 500, color: colors.text }}>{block.next_step}</span>
        </div>
      )}
    </div>
  );
}
