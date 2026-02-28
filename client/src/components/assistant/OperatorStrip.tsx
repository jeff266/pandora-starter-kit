import React from 'react';
import { useNavigate } from 'react-router-dom';
import { colors } from '../../styles/theme';

interface OperatorStatus {
  id: string;
  name: string;
  icon: string;
  color: string;
  status: 'green' | 'amber' | 'red' | 'paused';
  last_run_at: string | null;
  last_run_relative: string;
}

interface OperatorStripProps {
  operators?: OperatorStatus[];
  loading?: boolean;
  onOperatorClick?: (operatorName: string) => void;
}

const STATUS_COLOR: Record<string, string> = {
  green: '#34D399',
  amber: '#FBBF24',
  red: '#ff8c82',
  paused: '#6b8b84',
};

export default function OperatorStrip({ operators, loading, onOperatorClick }: OperatorStripProps) {
  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{ fontSize: 10, fontWeight: 600, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>
        Your Operators
      </div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        {loading || !operators ? (
          [1, 2, 3].map(i => (
            <div key={i} style={{ width: 140, height: 44, background: colors.surfaceRaised, borderRadius: 8 }} />
          ))
        ) : operators.length === 0 ? (
          <div style={{ fontSize: 13, color: colors.textMuted }}>No operators configured.</div>
        ) : (
          operators.map(op => {
            const dotColor = STATUS_COLOR[op.status] ?? colors.textMuted;
            return (
              <div
                key={op.id}
                onClick={() => onOperatorClick?.(op.name)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  background: colors.surface, border: `1px solid ${colors.border}`,
                  borderRadius: 8, padding: '8px 12px', cursor: 'pointer',
                  transition: 'border-color 0.15s', minWidth: 120,
                }}
                onMouseEnter={e => (e.currentTarget as HTMLDivElement).style.borderColor = op.color}
                onMouseLeave={e => (e.currentTarget as HTMLDivElement).style.borderColor = colors.border}
              >
                <div style={{ position: 'relative', flexShrink: 0 }}>
                  <span style={{ fontSize: 16 }}>{op.icon}</span>
                  <div style={{
                    position: 'absolute', bottom: -1, right: -1, width: 7, height: 7,
                    borderRadius: '50%', background: dotColor,
                    boxShadow: op.status !== 'paused' ? `0 0 5px ${dotColor}` : undefined,
                    border: `1px solid ${colors.surface}`,
                  }} />
                </div>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: colors.text, whiteSpace: 'nowrap' }}>{op.name}</div>
                  <div style={{ fontSize: 10, color: colors.textMuted }}>{op.last_run_relative}</div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
