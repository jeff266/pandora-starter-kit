import React, { useState } from 'react';
import { colors } from '../../styles/theme';
import { api } from '../../lib/api';

export interface FindingAssumptionData {
  label: string;
  config_path: string;
  current_value: string | number | string[] | null;
  correctable: boolean;
  correction_prompt: string | null;
  correction_value: string | number | string[] | null;
}

export interface EvidenceCardData {
  id: string;
  title: string;
  severity: 'critical' | 'warning' | 'info';
  operator_name: string;
  operator_icon: string;
  operator_color: string;
  body: string;
  skill_run_id?: string | null;
  assumptions?: FindingAssumptionData[];
  workspaceId?: string;
}

interface EvidenceCardProps {
  card: EvidenceCardData;
}

const SEV_COLOR: Record<string, string> = {
  critical: '#ff8c82',
  warning: '#FBBF24',
  info: '#48af9b',
};

function AssumptionRow({ assumption, findingId, workspaceId }: {
  assumption: FindingAssumptionData;
  findingId: string;
  workspaceId?: string;
}) {
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  const handleCorrect = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!workspaceId || assumption.correction_value === null) return;
    setStatus('saving');
    try {
      await api.post(`/workspaces/${workspaceId}/config/correct`, {
        config_path: assumption.config_path,
        new_value: assumption.correction_value,
        finding_id: findingId,
      });
      setStatus('saved');
    } catch {
      setStatus('error');
    }
  };

  if (status === 'saved') {
    return (
      <div style={{ fontSize: 11, color: colors.accent, padding: '2px 0' }}>
        ✓ Updated — future analysis will reflect this.
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '2px 0' }}>
      <span style={{ fontSize: 11, color: colors.textSecondary }}>· {assumption.label}</span>
      {assumption.correctable && assumption.correction_prompt && assumption.correction_value !== null && (
        <button
          onClick={handleCorrect}
          disabled={status === 'saving'}
          style={{
            fontSize: 11,
            color: status === 'error' ? '#ff8c82' : colors.accent,
            background: 'transparent',
            border: `1px solid ${status === 'error' ? '#ff8c82' : colors.border}`,
            borderRadius: 4,
            padding: '1px 6px',
            cursor: status === 'saving' ? 'not-allowed' : 'pointer',
            flexShrink: 0,
            opacity: status === 'saving' ? 0.5 : 1,
            transition: 'all 0.15s',
          }}
          onMouseEnter={e => { if (status === 'idle') (e.currentTarget as HTMLButtonElement).style.borderColor = colors.accent; }}
          onMouseLeave={e => { if (status === 'idle') (e.currentTarget as HTMLButtonElement).style.borderColor = colors.border; }}
        >
          {status === 'saving' ? 'Saving...' : status === 'error' ? 'Failed. Try again.' : assumption.correction_prompt}
        </button>
      )}
    </div>
  );
}

export default function EvidenceCard({ card }: EvidenceCardProps) {
  const [expanded, setExpanded] = useState(false);
  const sevColor = SEV_COLOR[card.severity] ?? colors.accent;
  const hasAssumptions = Array.isArray(card.assumptions) && card.assumptions.length > 0;

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
          {hasAssumptions && (
            <div style={{ marginTop: 12, paddingTop: 10, borderTop: `1px solid ${colors.border}` }}>
              <div style={{
                fontSize: 10, fontWeight: 700, color: colors.textMuted,
                letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 6,
              }}>
                ASSUMES
              </div>
              {card.assumptions!.map((a, i) => (
                <AssumptionRow
                  key={i}
                  assumption={a}
                  findingId={card.id}
                  workspaceId={card.workspaceId}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
