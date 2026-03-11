import { useState } from 'react';
import { api } from '../../lib/api';
import { colors, fonts } from '../../styles/theme';

export interface ActionCardItem {
  id: string;
  title: string;
  priority: 'P0' | 'P1' | 'P2';
  source: string;
  suggested_crm_action: 'task_create' | 'note_create' | 'field_write' | null;
}

interface ActionCardProps {
  item: ActionCardItem;
  crmSource?: string;
  onRemove: (id: string) => void;
}

const PRIORITY_META: Record<string, { bg: string; color: string }> = {
  P0: { bg: '#ef444420', color: '#ef4444' },
  P1: { bg: '#f9731620', color: '#f97316' },
  P2: { bg: '#6b728020', color: '#6b7280' },
};

const SOURCE_LABELS: Record<string, string> = {
  dossier: 'AI Analysis',
  client_rule: 'Deal Risk',
  meddic: 'MEDDIC Coverage',
  coaching: 'Stage Benchmark',
};

type InFlight = 'task' | 'note' | 'dismiss' | null;

export function ActionCard({ item, crmSource, onRemove }: ActionCardProps) {
  const [inFlight, setInFlight] = useState<InFlight>(null);
  const [error, setError] = useState<string | null>(null);

  const crmLabel = crmSource === 'salesforce' ? 'Salesforce' : 'HubSpot';
  const pm = PRIORITY_META[item.priority] || PRIORITY_META.P2;
  const sourceLabel = SOURCE_LABELS[item.source] || item.source;

  async function handleAction(mode: 'task' | 'note' | 'dismiss') {
    if (inFlight) return;
    setInFlight(mode);
    setError(null);
    try {
      if (mode === 'dismiss') {
        await api.post(`/actions/${item.id}/dismiss`);
      } else {
        await api.post(`/actions/${item.id}/execute-inline`, {
          mode: mode === 'task' ? 'task_create' : 'note_create',
          user_id: 'rep',
        });
      }
      onRemove(item.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed');
      setInFlight(null);
    }
  }

  const btnBase: React.CSSProperties = {
    fontSize: 11,
    fontWeight: 600,
    padding: '4px 10px',
    borderRadius: 5,
    border: 'none',
    cursor: inFlight ? 'not-allowed' : 'pointer',
    fontFamily: fonts.sans,
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    opacity: inFlight ? 0.55 : 1,
    transition: 'opacity 0.1s',
  };

  function Spinner() {
    return (
      <span style={{
        width: 8, height: 8, borderRadius: '50%',
        border: '1.5px solid currentColor',
        borderTopColor: 'transparent',
        display: 'inline-block',
        animation: 'spin 0.6s linear infinite',
      }} />
    );
  }

  return (
    <div style={{
      background: colors.surface,
      border: `1px solid ${colors.border}`,
      borderRadius: 8,
      padding: '12px 14px',
      display: 'flex',
      flexDirection: 'column',
      gap: 8,
    }}>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>

      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <span style={{
          fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 4,
          background: pm.bg, color: pm.color, flexShrink: 0, marginTop: 1,
        }}>{item.priority}</span>
        <span style={{ fontSize: 13, color: colors.text, lineHeight: 1.45, flex: 1 }}>
          {item.title}
        </span>
      </div>

      <div style={{ fontSize: 11, color: colors.textMuted }}>
        Source: {sourceLabel}
      </div>

      {error && (
        <div style={{ fontSize: 11, color: colors.red || '#ef4444' }}>{error}</div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <button
          disabled={!!inFlight}
          onClick={() => handleAction('task')}
          style={{
            ...btnBase,
            background: colors.accent,
            color: '#fff',
          }}
        >
          {inFlight === 'task' && <Spinner />}
          Create CRM Task ▶
        </button>

        <button
          disabled={!!inFlight}
          onClick={() => handleAction('note')}
          style={{
            ...btnBase,
            background: colors.accentSoft || `${colors.accent}15`,
            color: colors.accent,
          }}
        >
          {inFlight === 'note' && <Spinner />}
          Log as Note
        </button>

        <button
          disabled={!!inFlight}
          onClick={() => handleAction('dismiss')}
          style={{
            ...btnBase,
            background: 'transparent',
            color: colors.textMuted,
            border: `1px solid ${colors.border}`,
          }}
        >
          {inFlight === 'dismiss' && <Spinner />}
          Dismiss
        </button>
      </div>
    </div>
  );
}
