import React from 'react';
import { colors } from '../../styles/theme';

interface QuickActionPillsProps {
  onSend: (text: string) => void;
}

const DOW_ACTIONS: Record<number, string[]> = {
  1: ['Walk me through the findings', 'Show the week ahead', 'Prep my 1:1s', 'Run pipeline review'],
  5: ['Week in review', "What needs attention Monday?", 'Build board update', 'Show win/loss this week'],
};

const MID_WEEK = ['What changed today?', 'Show at-risk deals', 'Pipeline health check', 'Forecast update'];

function getPills(): string[] {
  const dow = new Date().getDay();
  return DOW_ACTIONS[dow] ?? MID_WEEK;
}

export default function QuickActionPills({ onSend }: QuickActionPillsProps) {
  const pills = getPills();
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 28 }}>
      {pills.map(p => (
        <button
          key={p}
          onClick={() => onSend(p)}
          style={{
            padding: '6px 12px', fontSize: 12, fontWeight: 500, border: `1px solid ${colors.border}`,
            borderRadius: 20, background: colors.surface, color: colors.textSecondary,
            cursor: 'pointer', transition: 'all 0.15s', whiteSpace: 'nowrap',
          }}
          onMouseEnter={e => {
            (e.currentTarget as HTMLButtonElement).style.background = colors.accentSoft;
            (e.currentTarget as HTMLButtonElement).style.color = colors.accent;
            (e.currentTarget as HTMLButtonElement).style.borderColor = colors.accent;
          }}
          onMouseLeave={e => {
            (e.currentTarget as HTMLButtonElement).style.background = colors.surface;
            (e.currentTarget as HTMLButtonElement).style.color = colors.textSecondary;
            (e.currentTarget as HTMLButtonElement).style.borderColor = colors.border;
          }}
        >
          {p}
        </button>
      ))}
    </div>
  );
}
