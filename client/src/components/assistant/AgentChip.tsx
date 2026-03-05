import React from 'react';
import { colors } from '../../styles/theme';

export type AgentPhase = 'recruiting' | 'thinking' | 'found' | 'done';

export interface OperatorProgress {
  agent_id: string;
  agent_name: string;
  icon: string;
  color: string;
  phase: AgentPhase;
  finding_preview?: string;
  skills?: string[];
}

interface AgentChipProps {
  operator: OperatorProgress;
  onClick?: () => void;
}

function PulsingDots() {
  return (
    <span style={{ display: 'inline-flex', gap: 3, alignItems: 'center' }}>
      {[0, 1, 2].map(i => (
        <span
          key={i}
          style={{
            width: 4, height: 4, borderRadius: '50%', background: colors.accent,
            display: 'inline-block',
            animation: `pulse-dot 1.2s ease-in-out ${i * 0.2}s infinite`,
          }}
        />
      ))}
      <style>{`
        @keyframes pulse-dot {
          0%, 80%, 100% { opacity: 0.3; transform: scale(0.8); }
          40% { opacity: 1; transform: scale(1.2); }
        }
      `}</style>
    </span>
  );
}

export default function AgentChip({ operator, onClick }: AgentChipProps) {
  const { phase, agent_name, icon, color, finding_preview, skills } = operator;
  const isClickable = !!onClick && phase === 'done';

  const borderColor = phase === 'recruiting' ? colors.border
    : phase === 'thinking' ? color
    : phase === 'found' ? color
    : '#34D399';

  const statusText = () => {
    switch (phase) {
      case 'recruiting': return <span style={{ color: colors.textMuted, fontSize: 11 }}>Recruiting...</span>;
      case 'thinking': return (
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <PulsingDots />
          <span style={{ fontSize: 11, color: colors.textSecondary }}>
            {skills?.[0] ? `${skills[0]}...` : 'Analyzing...'}
          </span>
        </span>
      );
      case 'found': return (
        <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span style={{ color: '#34D399', fontSize: 11 }}>●</span>
          <span style={{ fontSize: 11, color: colors.textSecondary, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {finding_preview || 'Finding retrieved'}
          </span>
        </span>
      );
      case 'done': return (
        <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span style={{ color: '#34D399', fontSize: 12 }}>✓</span>
          <span style={{ fontSize: 11, color: colors.textSecondary, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {finding_preview || 'Done'}
          </span>
        </span>
      );
    }
  };

  return (
    <div
      onClick={isClickable ? onClick : undefined}
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        background: colors.surfaceRaised, borderRadius: 6,
        border: `1px solid ${borderColor}`,
        padding: '8px 12px', minWidth: 180, maxWidth: 260,
        transition: 'border-color 0.3s',
        borderLeft: `3px solid ${borderColor}`,
        cursor: isClickable ? 'pointer' : 'default',
      }}
    >
      <span style={{ fontSize: 16, flexShrink: 0 }}>{icon}</span>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: colors.text, marginBottom: 2 }}>
          {agent_name}
          {isClickable && (
            <span style={{ color: colors.accent, fontWeight: 400, marginLeft: 6, fontSize: 10 }}>View →</span>
          )}
        </div>
        {statusText()}
      </div>
    </div>
  );
}
