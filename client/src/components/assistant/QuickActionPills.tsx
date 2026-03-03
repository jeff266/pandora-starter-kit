import React from 'react';
import { colors } from '../../styles/theme';
import type { GreetingPhase } from './Greeting';

interface QuickActionPillsProps {
  onSend: (text: string) => void;
  onSection: (section: string) => void;
  openSections: string[];
  hasBrief: boolean;
  phase: GreetingPhase;
}

const SECTION_PILLS = [
  { key: 'the_number', label: 'The Number' },
  { key: 'what_changed', label: 'What Changed' },
  { key: 'reps', label: 'Reps' },
  { key: 'deals', label: 'Deals to Watch' },
];

const DOW_ACTIONS: Record<number, string[]> = {
  1: ['Walk me through the findings', 'Show the week ahead', 'Prep my 1:1s', 'Run pipeline review'],
  5: ['Week in review', 'What needs attention Monday?', 'Build board update', 'Show win/loss this week'],
};
const MID_WEEK = ['What changed today?', 'Show at-risk deals', 'Pipeline health check', 'Forecast update'];

function getActionPills(): string[] {
  const dow = new Date().getDay();
  return DOW_ACTIONS[dow] ?? MID_WEEK;
}

export default function QuickActionPills({ onSend, onSection, openSections, hasBrief, phase }: QuickActionPillsProps) {
  const visible = ['pills', 'browsing'].includes(phase);
  if (!visible) return null;

  const actionPills = getActionPills();

  const sectionPillStyle = (key: string): React.CSSProperties => {
    const active = openSections.includes(key);
    return {
      padding: '7px 14px',
      fontSize: 12,
      fontWeight: 600,
      border: `1px solid ${active ? colors.accent : colors.border}`,
      borderRadius: 20,
      background: active ? colors.accentSoft ?? 'rgba(100,136,234,0.12)' : colors.surface,
      color: active ? colors.accent : colors.textSecondary,
      cursor: 'pointer',
      transition: 'all 0.15s',
      whiteSpace: 'nowrap' as const,
    };
  };

  const actionPillStyle: React.CSSProperties = {
    padding: '6px 12px',
    fontSize: 12,
    fontWeight: 500,
    border: `1px solid ${colors.border}`,
    borderRadius: 20,
    background: colors.surface,
    color: colors.textSecondary,
    cursor: 'pointer',
    transition: 'all 0.15s',
    whiteSpace: 'nowrap' as const,
  };

  return (
    <div style={{ animation: 'pandora-fade-up 300ms ease-out forwards', marginBottom: 24 }}>
      {hasBrief && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
          {SECTION_PILLS.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => onSection(key)}
              style={sectionPillStyle(key)}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, animation: 'pandora-fade-up 300ms 80ms ease-out both' }}>
        {actionPills.map(p => (
          <button
            key={p}
            onClick={() => onSend(p)}
            style={actionPillStyle}
            onMouseEnter={e => {
              const el = e.currentTarget as HTMLButtonElement;
              el.style.background = colors.accentSoft ?? 'rgba(100,136,234,0.12)';
              el.style.color = colors.accent;
              el.style.borderColor = colors.accent;
            }}
            onMouseLeave={e => {
              const el = e.currentTarget as HTMLButtonElement;
              el.style.background = colors.surface;
              el.style.color = colors.textSecondary;
              el.style.borderColor = colors.border;
            }}
          >
            {p}
          </button>
        ))}
      </div>
    </div>
  );
}
