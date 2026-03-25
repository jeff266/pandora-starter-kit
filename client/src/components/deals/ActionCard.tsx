import { useState } from 'react';
import { api } from '../../lib/api';
import { colors, fonts } from '../../styles/theme';

export interface ActionCardItem {
  id: string;
  title: string;
  priority: 'P0' | 'P1' | 'P2';
  source: string;
  suggested_crm_action: 'task_create' | 'note_create' | 'field_write' | null;
  action_type?: string;
  skill_id?: string;
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

type InFlight = 'primary' | 'note' | 'dismiss' | null;

const INTERNAL_TYPE_CONFIG: Record<string, { icon: string; label: string; buttonLabel: string }> = {
  update_data_dictionary: {
    icon: '📖',
    label: 'Update Data Dictionary',
    buttonLabel: 'Save definition ▶',
  },
  update_workspace_knowledge: {
    icon: '🧠',
    label: 'Save to workspace knowledge',
    buttonLabel: 'Save knowledge ▶',
  },
  confirm_metric_definition: {
    icon: '✓',
    label: 'Confirm metric benchmark',
    buttonLabel: 'Confirm & lock ▶',
  },
  update_calibration: {
    icon: '⚙',
    label: 'Update calibration',
    buttonLabel: 'Save threshold ▶',
  },
};

function isInternalType(actionType?: string) {
  return !!actionType && actionType in INTERNAL_TYPE_CONFIG;
}

function getPrimaryConfig(item: ActionCardItem): { label: string; mode: string } {
  if (isInternalType(item.action_type)) {
    return { label: INTERNAL_TYPE_CONFIG[item.action_type!].buttonLabel, mode: 'internal' };
  }
  switch (item.action_type) {
    case 'run_skill':
      return { label: 'Run skill ▶', mode: 'skill_run' };
    case 'run_meddic_coverage':
      return { label: 'Run MEDDIC ▶', mode: 'skill_run' };
    case 'update_forecast_category':
    case 'update_close_date':
      return { label: 'Review change ▶', mode: 'field_write' };
    default:
      return { label: 'Create CRM Task ▶', mode: 'task_create' };
  }
}

function isSkillType(actionType?: string) {
  return actionType === 'run_skill' || actionType === 'run_meddic_coverage';
}

function isFieldWriteType(actionType?: string) {
  return actionType === 'update_forecast_category' || actionType === 'update_close_date';
}

export function ActionCard({ item, crmSource, onRemove }: ActionCardProps) {
  const [inFlight, setInFlight] = useState<InFlight>(null);
  const [error, setError] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState(false);

  const pm = PRIORITY_META[item.priority] || PRIORITY_META.P2;
  const sourceLabel = SOURCE_LABELS[item.source] || item.source;
  const primaryConfig = getPrimaryConfig(item);

  async function handlePrimary() {
    if (inFlight) return;

    if (isFieldWriteType(item.action_type)) {
      setReviewing(r => !r);
      return;
    }

    setInFlight('primary');
    setError(null);
    try {
      if (isInternalType(item.action_type)) {
        await api.post(`/actions/${item.id}/execute-inline`, {
          mode: 'internal',
          user_id: 'rep',
        });
      } else if (isSkillType(item.action_type)) {
        await api.post(`/actions/${item.id}/execute-inline`, {
          mode: 'skill_run',
          skill_id: item.skill_id,
          user_id: 'rep',
        });
      } else {
        await api.post(`/actions/${item.id}/execute-inline`, {
          mode: 'task_create',
          user_id: 'rep',
        });
      }
      onRemove(item.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed');
      setInFlight(null);
    }
  }

  async function handleConfirmFieldWrite() {
    if (inFlight) return;
    setInFlight('primary');
    setError(null);
    try {
      await api.post(`/actions/${item.id}/execute-inline`, {
        mode: 'field_write',
        user_id: 'rep',
      });
      onRemove(item.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed');
      setInFlight(null);
      setReviewing(false);
    }
  }

  async function handleNote() {
    if (inFlight) return;
    setInFlight('note');
    setError(null);
    try {
      await api.post(`/actions/${item.id}/execute-inline`, {
        mode: 'note_create',
        user_id: 'rep',
      });
      onRemove(item.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed');
      setInFlight(null);
    }
  }

  async function handleDismiss() {
    if (inFlight) return;
    setInFlight('dismiss');
    setError(null);
    try {
      await api.post(`/actions/${item.id}/dismiss`);
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

  const showNoteButton = !isSkillType(item.action_type) && !isFieldWriteType(item.action_type) && !isInternalType(item.action_type);

  const internalConfig = item.action_type ? INTERNAL_TYPE_CONFIG[item.action_type] : undefined;

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
        {internalConfig ? (
          <span style={{ fontSize: 16, flexShrink: 0, marginTop: 1 }}>{internalConfig.icon}</span>
        ) : (
          <span style={{
            fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 4,
            background: pm.bg, color: pm.color, flexShrink: 0, marginTop: 1,
          }}>{item.priority}</span>
        )}
        <span style={{ fontSize: 13, color: colors.text, lineHeight: 1.45, flex: 1 }}>
          {internalConfig ? internalConfig.label : item.title}
        </span>
      </div>

      <div style={{ fontSize: 11, color: colors.textMuted }}>
        {internalConfig ? item.title : `Source: ${sourceLabel}`}
      </div>

      {reviewing && isFieldWriteType(item.action_type) && (
        <div style={{
          background: `${colors.accent}08`,
          border: `1px solid ${colors.accent}30`,
          borderRadius: 6,
          padding: '8px 10px',
          fontSize: 12,
          color: colors.text,
          fontFamily: fonts.sans,
        }}>
          <div style={{ fontWeight: 600, marginBottom: 4, color: colors.accent }}>Confirm field update</div>
          <div style={{ color: colors.textMuted, marginBottom: 8 }}>{item.title}</div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              disabled={!!inFlight}
              onClick={handleConfirmFieldWrite}
              style={{ ...btnBase, background: colors.accent, color: '#fff' }}
            >
              {inFlight === 'primary' && <Spinner />}
              Approve
            </button>
            <button
              disabled={!!inFlight}
              onClick={() => setReviewing(false)}
              style={{ ...btnBase, background: 'transparent', color: colors.textMuted, border: `1px solid ${colors.border}` }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {error && (
        <div style={{ fontSize: 11, color: '#ef4444' }}>{error}</div>
      )}

      {!reviewing && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <button
            disabled={!!inFlight}
            onClick={handlePrimary}
            style={{
              ...btnBase,
              background: colors.accent,
              color: '#fff',
            }}
          >
            {inFlight === 'primary' && !isFieldWriteType(item.action_type) && <Spinner />}
            {primaryConfig.label}
          </button>

          {showNoteButton && (
            <button
              disabled={!!inFlight}
              onClick={handleNote}
              style={{
                ...btnBase,
                background: colors.accentSoft || `${colors.accent}15`,
                color: colors.accent,
              }}
            >
              {inFlight === 'note' && <Spinner />}
              Log as Note
            </button>
          )}

          <button
            disabled={!!inFlight}
            onClick={handleDismiss}
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
      )}
    </div>
  );
}
