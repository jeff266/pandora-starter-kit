import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../lib/api';
import { colors, fonts } from '../../styles/theme';
import { formatCurrency } from '../../lib/format';

interface PendingAction {
  id: string;
  workspace_id: string;
  target_deal_id: string;
  workflow_rule_id: string | null;
  action_type: string;
  severity: 'info' | 'warning' | 'critical';
  title: string;
  summary: string;
  execution_payload: Record<string, any>;
  approval_status: 'pending' | 'approved' | 'rejected';
  created_at: string;
  // Populated from join
  rule_name?: string;
  deal_name?: string;
  deal_amount?: number;
}

interface PendingActionsGrouped {
  rule_id: string | null;
  rule_name: string;
  action_type: string;
  actions: PendingAction[];
}

export default function PendingActions() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [actions, setActions] = useState<PendingAction[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [approving, setApproving] = useState(false);
  const [rejecting, setRejecting] = useState(false);

  useEffect(() => {
    fetchPendingActions();
  }, []);

  const fetchPendingActions = async () => {
    setLoading(true);
    try {
      const response = await api.get('/workflow-rules/pending');
      setActions(response.actions || []);
    } catch (err) {
      console.error('[PendingActions] Failed to fetch:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleApprove = async (actionId: string) => {
    setApproving(true);
    try {
      await api.post(`/workflow-rules/pending/${actionId}/approve`);

      // Show success toast
      const event = new CustomEvent('toast', {
        detail: {
          message: 'Action approved and written to CRM',
          type: 'success',
        },
      });
      window.dispatchEvent(event);

      // Remove from list
      setActions(prev => prev.filter(a => a.id !== actionId));
      setSelectedIds(prev => {
        const newSet = new Set(prev);
        newSet.delete(actionId);
        return newSet;
      });
    } catch (err: any) {
      const event = new CustomEvent('toast', {
        detail: {
          message: `Failed to approve: ${err.message || 'Unknown error'}`,
          type: 'error',
        },
      });
      window.dispatchEvent(event);
    } finally {
      setApproving(false);
    }
  };

  const handleReject = async (actionId: string) => {
    setRejecting(true);
    try {
      await api.post(`/workflow-rules/pending/${actionId}/reject`);

      const event = new CustomEvent('toast', {
        detail: {
          message: 'Action rejected',
          type: 'success',
        },
      });
      window.dispatchEvent(event);

      setActions(prev => prev.filter(a => a.id !== actionId));
      setSelectedIds(prev => {
        const newSet = new Set(prev);
        newSet.delete(actionId);
        return newSet;
      });
    } catch (err: any) {
      const event = new CustomEvent('toast', {
        detail: {
          message: `Failed to reject: ${err.message || 'Unknown error'}`,
          type: 'error',
        },
      });
      window.dispatchEvent(event);
    } finally {
      setRejecting(false);
    }
  };

  const handleBulkApprove = async () => {
    if (selectedIds.size === 0) return;

    setApproving(true);
    try {
      await api.post('/workflow-rules/pending/bulk-approve', {
        action_ids: Array.from(selectedIds),
      });

      const event = new CustomEvent('toast', {
        detail: {
          message: `Approved ${selectedIds.size} action(s)`,
          type: 'success',
        },
      });
      window.dispatchEvent(event);

      setActions(prev => prev.filter(a => !selectedIds.has(a.id)));
      setSelectedIds(new Set());
    } catch (err: any) {
      const event = new CustomEvent('toast', {
        detail: {
          message: `Failed to bulk approve: ${err.message || 'Unknown error'}`,
          type: 'error',
        },
      });
      window.dispatchEvent(event);
    } finally {
      setApproving(false);
    }
  };

  const handleSelectAll = () => {
    if (selectedIds.size === actions.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(actions.map(a => a.id)));
    }
  };

  const handleToggleSelect = (actionId: string) => {
    setSelectedIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(actionId)) {
        newSet.delete(actionId);
      } else {
        newSet.add(actionId);
      }
      return newSet;
    });
  };

  if (loading) {
    return (
      <div style={{
        background: colors.surface,
        border: `1px solid ${colors.border}`,
        borderRadius: 10,
        padding: 24,
        textAlign: 'center',
        color: colors.textMuted,
        fontSize: 13,
      }}>
        Loading pending actions...
      </div>
    );
  }

  if (actions.length === 0) {
    // Hide panel entirely when no pending actions
    return null;
  }

  // Group actions by rule
  const grouped = groupActionsByRule(actions);

  return (
    <div style={{
      background: colors.surface,
      border: `1px solid ${colors.border}`,
      borderRadius: 10,
      overflow: 'hidden',
      marginBottom: 24,
    }}>
      {/* Header */}
      <div style={{
        padding: '12px 16px',
        borderBottom: `1px solid ${colors.border}`,
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
      }}>
        <div>
          <h3 style={{ fontSize: 14, fontWeight: 600, color: colors.text, margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 16 }}>⚡</span>
            Pending Actions
          </h3>
          <p style={{ fontSize: 11, color: colors.textMuted, margin: '2px 0 0' }}>
            {actions.length} queued for review
          </p>
        </div>
        <button
          onClick={() => navigate('/settings/automations')}
          style={{
            fontSize: 12,
            fontWeight: 600,
            padding: '6px 12px',
            borderRadius: 6,
            background: 'transparent',
            color: colors.accent,
            border: `1px solid ${colors.accentGlow}`,
            cursor: 'pointer',
            fontFamily: fonts.sans,
          }}
        >
          View all →
        </button>
      </div>

      {/* Actions List */}
      <div style={{ maxHeight: 400, overflowY: 'auto' }}>
        {grouped.map((group, idx) => {
          if (group.actions.length > 1) {
            // Bulk row
            const allSelected = group.actions.every(a => selectedIds.has(a.id));
            return (
              <div
                key={`${group.rule_id}-${idx}`}
                style={{
                  padding: '12px 16px',
                  borderBottom: `1px solid ${colors.border}`,
                }}
              >
                <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={() => {
                      if (allSelected) {
                        setSelectedIds(prev => {
                          const newSet = new Set(prev);
                          group.actions.forEach(a => newSet.delete(a.id));
                          return newSet;
                        });
                      } else {
                        setSelectedIds(prev => {
                          const newSet = new Set(prev);
                          group.actions.forEach(a => newSet.add(a.id));
                          return newSet;
                        });
                      }
                    }}
                    style={{ marginTop: 2, cursor: 'pointer' }}
                  />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 500, color: colors.text, marginBottom: 4 }}>
                      {formatActionTitle(group)} on {group.actions.length} deals
                      <span style={{
                        marginLeft: 8,
                        fontSize: 10,
                        fontWeight: 600,
                        padding: '2px 6px',
                        borderRadius: 4,
                        background: colors.accentSoft,
                        color: colors.accent,
                        textTransform: 'uppercase',
                      }}>
                        BULK
                      </span>
                    </div>
                    <div style={{ fontSize: 11, color: colors.textSecondary, marginBottom: 8 }}>
                      Rule: {group.rule_name || 'Manual'} · {formatActionType(group.action_type)}
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button
                        onClick={() => {
                          // Preview: navigate to first deal
                          if (group.actions[0]?.target_deal_id) {
                            navigate(`/deals/${group.actions[0].target_deal_id}`);
                          }
                        }}
                        style={{
                          fontSize: 11,
                          fontWeight: 500,
                          padding: '4px 8px',
                          borderRadius: 4,
                          background: 'transparent',
                          color: colors.textSecondary,
                          border: `1px solid ${colors.border}`,
                          cursor: 'pointer',
                          fontFamily: fonts.sans,
                        }}
                      >
                        Preview {group.actions.length} deals ↗
                      </button>
                      <button
                        onClick={handleBulkApprove}
                        disabled={!allSelected || approving}
                        style={{
                          fontSize: 11,
                          fontWeight: 500,
                          padding: '4px 8px',
                          borderRadius: 4,
                          background: colors.successSoft,
                          color: colors.success,
                          border: 'none',
                          cursor: approving || !allSelected ? 'not-allowed' : 'pointer',
                          opacity: approving || !allSelected ? 0.5 : 1,
                          fontFamily: fonts.sans,
                        }}
                      >
                        Approve All
                      </button>
                      <button
                        onClick={() => {
                          group.actions.forEach(a => handleReject(a.id));
                        }}
                        disabled={rejecting}
                        style={{
                          fontSize: 11,
                          fontWeight: 500,
                          padding: '4px 8px',
                          borderRadius: 4,
                          background: 'transparent',
                          color: colors.danger,
                          border: `1px solid ${colors.dangerSoft}`,
                          cursor: rejecting ? 'not-allowed' : 'pointer',
                          opacity: rejecting ? 0.5 : 1,
                          fontFamily: fonts.sans,
                        }}
                      >
                        Reject
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            );
          } else {
            // Individual action row
            const action = group.actions[0];
            return (
              <div
                key={action.id}
                style={{
                  padding: '12px 16px',
                  borderBottom: `1px solid ${colors.border}`,
                }}
              >
                <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                  <input
                    type="checkbox"
                    checked={selectedIds.has(action.id)}
                    onChange={() => handleToggleSelect(action.id)}
                    style={{ marginTop: 2, cursor: 'pointer' }}
                  />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 500, color: colors.text, marginBottom: 4 }}>
                      {action.title}
                    </div>
                    <div style={{ fontSize: 11, color: colors.textSecondary, marginBottom: 4 }}>
                      {action.deal_name && `${action.deal_name} · `}
                      Rule: {action.rule_name || 'Manual'} · {formatActionType(action.action_type)}
                    </div>
                    <div style={{ fontSize: 11, color: colors.textMuted, marginBottom: 8 }}>
                      {action.summary}
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button
                        onClick={() => navigate(`/deals/${action.target_deal_id}`)}
                        style={{
                          fontSize: 11,
                          fontWeight: 500,
                          padding: '4px 8px',
                          borderRadius: 4,
                          background: 'transparent',
                          color: colors.textSecondary,
                          border: `1px solid ${colors.border}`,
                          cursor: 'pointer',
                          fontFamily: fonts.sans,
                        }}
                      >
                        Preview ↗
                      </button>
                      <button
                        onClick={() => handleApprove(action.id)}
                        disabled={approving}
                        style={{
                          fontSize: 11,
                          fontWeight: 500,
                          padding: '4px 8px',
                          borderRadius: 4,
                          background: colors.successSoft,
                          color: colors.success,
                          border: 'none',
                          cursor: approving ? 'not-allowed' : 'pointer',
                          opacity: approving ? 0.5 : 1,
                          fontFamily: fonts.sans,
                        }}
                      >
                        Approve
                      </button>
                      <button
                        onClick={() => handleReject(action.id)}
                        disabled={rejecting}
                        style={{
                          fontSize: 11,
                          fontWeight: 500,
                          padding: '4px 8px',
                          borderRadius: 4,
                          background: 'transparent',
                          color: colors.danger,
                          border: `1px solid ${colors.dangerSoft}`,
                          cursor: rejecting ? 'not-allowed' : 'pointer',
                          opacity: rejecting ? 0.5 : 1,
                          fontFamily: fonts.sans,
                        }}
                      >
                        Reject
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            );
          }
        })}
      </div>

      {/* Bulk Actions Footer */}
      {selectedIds.size > 0 && (
        <div style={{
          padding: '12px 16px',
          borderTop: `1px solid ${colors.border}`,
          background: colors.surfaceRaised,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}>
          <label style={{ fontSize: 12, color: colors.textSecondary, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
            <input
              type="checkbox"
              checked={selectedIds.size === actions.length}
              onChange={handleSelectAll}
            />
            Select all ({actions.length})
          </label>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={handleBulkApprove}
              disabled={approving}
              style={{
                fontSize: 12,
                fontWeight: 600,
                padding: '6px 12px',
                borderRadius: 6,
                background: colors.success,
                color: '#fff',
                border: 'none',
                cursor: approving ? 'not-allowed' : 'pointer',
                opacity: approving ? 0.5 : 1,
                fontFamily: fonts.sans,
              }}
            >
              Bulk Approve Selected ({selectedIds.size})
            </button>
            <button
              onClick={() => {
                selectedIds.forEach(id => handleReject(id));
              }}
              disabled={rejecting}
              style={{
                fontSize: 12,
                fontWeight: 600,
                padding: '6px 12px',
                borderRadius: 6,
                background: 'transparent',
                color: colors.danger,
                border: `1px solid ${colors.danger}`,
                cursor: rejecting ? 'not-allowed' : 'pointer',
                opacity: rejecting ? 0.5 : 1,
                fontFamily: fonts.sans,
              }}
            >
              Bulk Reject Selected
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function groupActionsByRule(actions: PendingAction[]): PendingActionsGrouped[] {
  const grouped = new Map<string, PendingActionsGrouped>();

  for (const action of actions) {
    const key = action.workflow_rule_id || `manual-${action.id}`;

    if (!grouped.has(key)) {
      grouped.set(key, {
        rule_id: action.workflow_rule_id,
        rule_name: action.rule_name || 'Manual',
        action_type: action.action_type,
        actions: [],
      });
    }

    grouped.get(key)!.actions.push(action);
  }

  return Array.from(grouped.values());
}

function formatActionTitle(group: PendingActionsGrouped): string {
  const action = group.actions[0];

  if (action.action_type === 'crm_field_write') {
    const field = action.execution_payload.field || 'field';
    return `Set ${field}`;
  } else if (action.action_type === 'update_stage') {
    return `Change stage`;
  }

  return action.title || 'Action';
}

function formatActionType(actionType: string): string {
  switch (actionType) {
    case 'crm_field_write':
      return 'CRM Field Write';
    case 'crm_task_create':
      return 'Create Task';
    case 'update_stage':
      return 'Update Stage';
    case 'slack_notify':
      return 'Slack Notification';
    case 'finding_escalate':
      return 'Escalate Finding';
    default:
      return actionType;
  }
}
