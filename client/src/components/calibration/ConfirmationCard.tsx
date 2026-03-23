import React, { useState } from 'react';
import { colors, fonts } from '../../styles/theme';

interface ConfirmationCardProps {
  dimensionLabel: string;
  dealCount: number;
  totalValue: number;
  filterSummary: string;
  onConfirm: () => void;
  onAdjust: () => void;
  loading?: boolean;
}

function formatValue(v: number): string {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000)     return `$${Math.round(v / 1_000)}K`;
  return `$${Math.round(v)}`;
}

export default function ConfirmationCard({
  dimensionLabel,
  dealCount,
  totalValue,
  filterSummary,
  onConfirm,
  onAdjust,
  loading = false,
}: ConfirmationCardProps) {
  const [confirmed, setConfirmed] = useState(false);

  const handleConfirm = () => {
    setConfirmed(true);
    onConfirm();
  };

  return (
    <div style={{
      background: colors.surface,
      border: `1px solid ${colors.border}`,
      borderRadius: 10,
      padding: '20px 24px',
      fontFamily: fonts.sans,
      display: 'flex',
      flexDirection: 'column',
      gap: 16,
      maxWidth: 480,
    }}>
      <div>
        <div style={{ fontSize: 12, color: colors.textMuted, marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>
          Preview: {dimensionLabel}
        </div>
        <div style={{ display: 'flex', gap: 24, alignItems: 'flex-end' }}>
          <div>
            <div style={{ fontSize: 28, fontWeight: 700, color: colors.text, lineHeight: 1 }}>
              {formatValue(totalValue)}
            </div>
            <div style={{ fontSize: 12, color: colors.textSecondary, marginTop: 2 }}>
              total value
            </div>
          </div>
          <div>
            <div style={{ fontSize: 28, fontWeight: 700, color: colors.text, lineHeight: 1 }}>
              {dealCount.toLocaleString()}
            </div>
            <div style={{ fontSize: 12, color: colors.textSecondary, marginTop: 2 }}>
              deals
            </div>
          </div>
        </div>
      </div>

      {filterSummary && (
        <div style={{
          background: colors.surfaceRaised,
          borderRadius: 6,
          padding: '8px 12px',
          fontSize: 12,
          color: colors.textSecondary,
          fontFamily: fonts.mono,
          lineHeight: 1.5,
        }}>
          {filterSummary}
        </div>
      )}

      <div style={{ display: 'flex', gap: 10 }}>
        <button
          onClick={handleConfirm}
          disabled={loading || confirmed}
          style={{
            flex: 1,
            padding: '9px 16px',
            background: confirmed ? '#22c55e' : colors.accent,
            color: '#fff',
            border: 'none',
            borderRadius: 6,
            fontSize: 13,
            fontWeight: 600,
            cursor: loading || confirmed ? 'default' : 'pointer',
            fontFamily: fonts.sans,
            transition: 'background 0.15s',
            opacity: loading ? 0.7 : 1,
          }}
        >
          {confirmed ? '✓ Confirmed' : loading ? 'Saving…' : 'Confirm Definition'}
        </button>

        {!confirmed && (
          <button
            onClick={onAdjust}
            disabled={loading}
            style={{
              padding: '9px 16px',
              background: 'transparent',
              color: colors.textSecondary,
              border: `1px solid ${colors.border}`,
              borderRadius: 6,
              fontSize: 13,
              fontWeight: 500,
              cursor: loading ? 'default' : 'pointer',
              fontFamily: fonts.sans,
            }}
          >
            Adjust
          </button>
        )}
      </div>
    </div>
  );
}
