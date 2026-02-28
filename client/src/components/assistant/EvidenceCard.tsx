import React, { useState } from 'react';
import { colors } from '../../styles/theme';

export interface EvidenceCardData {
  id: string;
  title: string;
  severity: 'critical' | 'warning' | 'info';
  operator_name: string;
  operator_icon: string;
  operator_color: string;
  body: string;
  skill_run_id?: string | null;
}

interface EvidenceCardProps {
  card: EvidenceCardData;
}

const SEV_COLOR: Record<string, string> = {
  critical: '#ff8c82',
  warning: '#FBBF24',
  info: '#48af9b',
};

export default function EvidenceCard({ card }: EvidenceCardProps) {
  const [expanded, setExpanded] = useState(false);
  const sevColor = SEV_COLOR[card.severity] ?? colors.accent;

  return (
    <div style={{
      background: colors.surface, border: `1px solid ${colors.border}`,
      borderRadius: 8, marginBottom: 8, overflow: 'hidden',
      borderLeft: `3px solid ${sevColor}`,
    }}>
      <div
        onClick={() => setExpanded(e => !e)}
        style={{
          display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px',
          cursor: 'pointer', transition: 'background 0.15s',
        }}
        onMouseEnter={e => (e.currentTarget as HTMLDivElement).style.background = colors.surfaceRaised}
        onMouseLeave={e => (e.currentTarget as HTMLDivElement).style.background = 'transparent'}
      >
        <div style={{ width: 8, height: 8, borderRadius: '50%', background: sevColor, flexShrink: 0, boxShadow: card.severity === 'critical' ? `0 0 5px ${sevColor}` : undefined }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: colors.text }}>{card.title}</span>
        </div>
        <span style={{
          fontSize: 11, padding: '1px 6px', borderRadius: 4,
          background: `${card.operator_color}18`, color: card.operator_color,
          border: `1px solid ${card.operator_color}40`, flexShrink: 0,
        }}>
          {card.operator_icon} {card.operator_name}
        </span>
        <span style={{ fontSize: 12, color: colors.textMuted, flexShrink: 0 }}>{expanded ? '▲' : '▼'}</span>
      </div>
      {expanded && (
        <div style={{ padding: '0 14px 12px 32px', borderTop: `1px solid ${colors.border}` }}>
          <p style={{ fontSize: 12, color: colors.textSecondary, margin: '10px 0 8px 0', lineHeight: 1.5 }}>{card.body}</p>
          {card.skill_run_id && (
            <a
              href={`/findings`}
              style={{ fontSize: 12, color: colors.accent, textDecoration: 'none' }}
              onMouseEnter={e => (e.target as HTMLAnchorElement).style.textDecoration = 'underline'}
              onMouseLeave={e => (e.target as HTMLAnchorElement).style.textDecoration = 'none'}
            >
              View in findings →
            </a>
          )}
        </div>
      )}
    </div>
  );
}
