import React, { useState } from 'react';
import { colors } from '../../styles/theme';
import { api, getWorkspaceId } from '../../lib/api';

export interface RecommendedAction {
  id: string;
  type: 'slack' | 'crm' | 'email' | 'generic';
  title: string;
  detail: string;
  preview?: string;
  judgment_mode?: 'autonomous' | 'approval' | 'escalate';
  judgment_reason?: string;
  approval_prompt?: string;
  escalation_reason?: string;
}

interface ActionCardProps {
  action: RecommendedAction;
  onDismiss: (id: string) => void;
}

const TYPE_ICON: Record<string, string> = {
  slack: '💬',
  crm: '🗂️',
  email: '📧',
  generic: '⚡',
};

export default function ActionCard({ action, onDismiss }: ActionCardProps) {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(action.preview || action.detail);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  const handleApprove = async () => {
    setLoading(true);
    try {
      const workspaceId = getWorkspaceId();
      if (action.id && workspaceId) {
        // Use inline execute route if it's a real action with ID
        await api.post(`/workspaces/${workspaceId}/actions/${action.id}/execute-inline`, {
          user_id: 'user', // In a real app, this would be from auth context
          content: editValue
        });
      } else {
        // Fallback for mock/generated actions
        await api.post(`/actions/${action.id}/execute`, { content: editValue });
      }
      setDone(true);
    } catch {
    } finally {
      setLoading(false);
    }
  };

  if (done || action.judgment_mode === 'autonomous') {
    return (
      <div style={{
        background: colors.surface, border: `1px solid #34D39940`,
        borderRadius: 8, padding: '10px 14px', marginBottom: 8,
        display: 'flex', alignItems: 'center', gap: 8,
      }}>
        <span style={{ color: '#34D399', fontSize: 14 }}>✓</span>
        <span style={{ fontSize: 12, color: colors.textSecondary }}>
          {action.judgment_mode === 'autonomous' ? `Created ${action.title} (autonomous)` : `${action.title} — executed`}
        </span>
      </div>
    );
  }

  if (action.judgment_mode === 'escalate') {
    return (
      <div style={{
        background: colors.surface, border: `1px solid ${colors.accent}40`,
        borderRadius: 8, padding: '12px 14px', marginBottom: 8,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <span style={{ fontSize: 18 }}>⚡</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: colors.text }}>{action.title} flagged for decision</div>
            <div style={{ fontSize: 11, color: colors.textMuted }}>{action.escalation_reason || action.judgment_reason}</div>
          </div>
        </div>
        <button
          onClick={() => {}}
          style={{
            padding: '5px 12px', fontSize: 11, fontWeight: 600, border: 'none',
            borderRadius: 6, cursor: 'pointer', background: colors.accent, color: '#0b1014',
          }}
        >
          Show me the scenarios →
        </button>
      </div>
    );
  }

  return (
    <div style={{
      background: colors.surface, border: `1px solid ${colors.border}`,
      borderRadius: 8, padding: '12px 14px', marginBottom: 8,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span style={{ fontSize: 18 }}>{TYPE_ICON[action.type]}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: colors.text }}>{action.title}</div>
          <div style={{ fontSize: 11, color: colors.textMuted }}>{action.detail}</div>
        </div>
      </div>
      {editing && (
        <textarea
          value={editValue}
          onChange={e => setEditValue(e.target.value)}
          rows={3}
          style={{
            width: '100%', background: colors.bg, border: `1px solid ${colors.border}`,
            borderRadius: 6, padding: '8px 10px', fontSize: 12, color: colors.text,
            fontFamily: 'inherit', resize: 'vertical', marginBottom: 8, boxSizing: 'border-box',
          }}
        />
      )}
      <div style={{ display: 'flex', gap: 6 }}>
        <button
          onClick={handleApprove}
          disabled={loading}
          style={{
            padding: '5px 12px', fontSize: 11, fontWeight: 600, border: 'none',
            borderRadius: 6, cursor: 'pointer', background: colors.accent, color: '#0b1014',
          }}
        >
          {loading ? 'Sending...' : 'Approve & Send'}
        </button>
        <button
          onClick={() => setEditing(e => !e)}
          style={{
            padding: '5px 12px', fontSize: 11, fontWeight: 500,
            border: `1px solid ${colors.border}`, borderRadius: 6, cursor: 'pointer',
            background: 'transparent', color: colors.textSecondary,
          }}
        >
          {editing ? 'Hide' : 'Edit first'}
        </button>
        <button
          onClick={() => onDismiss(action.id)}
          style={{
            padding: '5px 10px', fontSize: 11, border: 'none',
            borderRadius: 6, cursor: 'pointer', background: 'transparent', color: colors.textMuted,
          }}
        >
          Skip
        </button>
      </div>
    </div>
  );
}
