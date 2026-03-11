import React, { useState, useEffect } from 'react';
import { colors, fonts } from '../../styles/theme';
import { useWorkspace } from '../../context/WorkspaceContext';
import { api } from '../../lib/api';

interface WorkflowRule {
  id: string;
  workspace_id: string;
  name: string;
  trigger_type: string;
  trigger_skill_id?: string;
  trigger_finding_category?: string;
  trigger_severity?: string;
  condition_json: Record<string, any>;
  action_type: string;
  action_payload: Record<string, any>;
  execution_mode: 'auto' | 'queue' | 'manual';
  is_active: boolean;
  created_at: string;
  updated_at: string;
  last_triggered_at?: string;
  execution_count: number;
}

export default function AutomationsSettings() {
  const { currentWorkspace } = useWorkspace();
  const [loading, setLoading] = useState(true);
  const [rules, setRules] = useState<WorkflowRule[]>([]);
  const [showBuilder, setShowBuilder] = useState(false);
  const [editingRule, setEditingRule] = useState<WorkflowRule | null>(null);

  useEffect(() => {
    if (currentWorkspace?.id) {
      fetchRules();
    }
  }, [currentWorkspace]);

  const fetchRules = async () => {
    if (!currentWorkspace?.id) return;

    setLoading(true);
    try {
      const response = await api.get(`/workflow-rules`);
      setRules(response.rules || []);
    } catch (err) {
      console.error('[AutomationsSettings] Failed to fetch rules:', err);
    } finally {
      setLoading(false);
    }
  };

  const activeRules = rules.filter(r => r.is_active);
  const inactiveRules = rules.filter(r => !r.is_active);

  const handleNewRule = () => {
    setEditingRule(null);
    setShowBuilder(true);
  };

  const handleEditRule = (rule: WorkflowRule) => {
    setEditingRule(rule);
    setShowBuilder(true);
  };

  const handleCloseBuilder = () => {
    setShowBuilder(false);
    setEditingRule(null);
  };

  const handleToggleActive = async (ruleId: string, currentActive: boolean) => {
    try {
      await api.patch(`/workflow-rules/${ruleId}`, {
        is_active: !currentActive,
      });
      await fetchRules();
    } catch (err) {
      console.error('[AutomationsSettings] Failed to toggle rule:', err);
    }
  };

  const handleDeleteRule = async (ruleId: string) => {
    if (!confirm('Are you sure you want to delete this automation rule?')) {
      return;
    }

    try {
      await api.delete(`/workflow-rules/${ruleId}`);
      await fetchRules();
    } catch (err) {
      console.error('[AutomationsSettings] Failed to delete rule:', err);
    }
  };

  if (loading) {
    return (
      <div style={{ padding: '40px 0', textAlign: 'center', color: colors.textMuted }}>
        Loading automation rules...
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 1000, fontFamily: fonts.sans }}>
      <div style={{ marginBottom: 32 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <h1 style={{ fontSize: 24, fontWeight: 600, color: colors.text, margin: 0 }}>
            Automation Rules
          </h1>
          <button
            onClick={handleNewRule}
            style={{
              padding: '8px 16px',
              fontSize: 13,
              fontWeight: 600,
              fontFamily: fonts.sans,
              color: colors.accent,
              background: colors.accentSoft,
              border: `1px solid ${colors.accentGlow}`,
              borderRadius: 6,
              cursor: 'pointer',
            }}
          >
            + New Rule
          </button>
        </div>
        <p style={{ fontSize: 13, color: colors.textSecondary, margin: 0 }}>
          Automate CRM updates, task creation, and notifications based on deal signals and findings.
        </p>
      </div>

      {/* Active Rules */}
      <div style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 14, fontWeight: 600, color: colors.text, marginBottom: 16, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Active Rules ({activeRules.length})
        </h2>

        {activeRules.length === 0 ? (
          <div style={{
            padding: 32,
            textAlign: 'center',
            background: colors.surface,
            border: `1px solid ${colors.border}`,
            borderRadius: 10,
            color: colors.textMuted,
            fontSize: 13,
          }}>
            No active automation rules. Click "+ New Rule" to create one.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {activeRules.map(rule => (
              <RuleCard
                key={rule.id}
                rule={rule}
                onEdit={handleEditRule}
                onToggleActive={handleToggleActive}
                onDelete={handleDeleteRule}
              />
            ))}
          </div>
        )}
      </div>

      {/* Inactive Rules */}
      {inactiveRules.length > 0 && (
        <div>
          <h2 style={{ fontSize: 14, fontWeight: 600, color: colors.textSecondary, marginBottom: 16, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Inactive Rules ({inactiveRules.length})
          </h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {inactiveRules.map(rule => (
              <RuleCard
                key={rule.id}
                rule={rule}
                onEdit={handleEditRule}
                onToggleActive={handleToggleActive}
                onDelete={handleDeleteRule}
              />
            ))}
          </div>
        </div>
      )}

      {/* Rule Builder Modal */}
      {showBuilder && (
        <RuleBuilderModal
          rule={editingRule}
          onClose={handleCloseBuilder}
          onSave={() => {
            fetchRules();
            handleCloseBuilder();
          }}
        />
      )}
    </div>
  );
}

interface RuleCardProps {
  rule: WorkflowRule;
  onEdit: (rule: WorkflowRule) => void;
  onToggleActive: (ruleId: string, currentActive: boolean) => void;
  onDelete: (ruleId: string) => void;
}

function RuleCard({ rule, onEdit, onToggleActive, onDelete }: RuleCardProps) {
  const triggerLabel = formatTrigger(rule);
  const conditionLabel = formatCondition(rule.condition_json);
  const actionLabel = formatAction(rule);

  return (
    <div style={{
      background: colors.surface,
      border: `1px solid ${colors.border}`,
      borderRadius: 10,
      padding: 16,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <span style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: rule.is_active ? colors.success : colors.textDim,
            }} />
            <h3 style={{ fontSize: 14, fontWeight: 600, color: colors.text, margin: 0 }}>
              {rule.name}
            </h3>
            <span style={{
              fontSize: 10,
              fontWeight: 600,
              padding: '2px 6px',
              borderRadius: 4,
              background: rule.is_active ? colors.successSoft : colors.surfaceRaised,
              color: rule.is_active ? colors.success : colors.textMuted,
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
            }}>
              {rule.is_active ? 'ACTIVE' : 'INACTIVE'}
            </span>
          </div>

          <div style={{ fontSize: 12, color: colors.textSecondary, marginBottom: 6 }}>
            <strong>Trigger:</strong> {triggerLabel} {conditionLabel && `· IF ${conditionLabel}`}
          </div>

          <div style={{ fontSize: 12, color: colors.textSecondary, marginBottom: 6 }}>
            <strong>Action:</strong> {actionLabel}
          </div>

          <div style={{ fontSize: 11, color: colors.textMuted }}>
            Mode: <strong>{formatExecutionMode(rule.execution_mode)}</strong>
            {rule.last_triggered_at && ` · Last triggered: ${formatRelativeTime(rule.last_triggered_at)}`}
            {rule.execution_count > 0 && ` · Run: ${rule.execution_count}x`}
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <button
          onClick={() => onEdit(rule)}
          style={{
            padding: '6px 12px',
            fontSize: 12,
            fontWeight: 500,
            fontFamily: fonts.sans,
            color: colors.textSecondary,
            background: 'transparent',
            border: `1px solid ${colors.border}`,
            borderRadius: 6,
            cursor: 'pointer',
          }}
        >
          Edit
        </button>
        <button
          onClick={() => onToggleActive(rule.id, rule.is_active)}
          style={{
            padding: '6px 12px',
            fontSize: 12,
            fontWeight: 500,
            fontFamily: fonts.sans,
            color: colors.textSecondary,
            background: 'transparent',
            border: `1px solid ${colors.border}`,
            borderRadius: 6,
            cursor: 'pointer',
          }}
        >
          {rule.is_active ? 'Disable' : 'Enable'}
        </button>
        <button
          onClick={() => onDelete(rule.id)}
          style={{
            padding: '6px 12px',
            fontSize: 12,
            fontWeight: 500,
            fontFamily: fonts.sans,
            color: colors.danger,
            background: 'transparent',
            border: `1px solid ${colors.dangerSoft}`,
            borderRadius: 6,
            cursor: 'pointer',
          }}
        >
          Delete
        </button>
      </div>
    </div>
  );
}

// Helper functions
function formatTrigger(rule: WorkflowRule): string {
  switch (rule.trigger_type) {
    case 'skill_run':
      return rule.trigger_skill_id || 'Skill Run';
    case 'finding_created':
      return `Finding: ${rule.trigger_finding_category || 'Any'}`;
    case 'manual':
      return 'Manual';
    default:
      return rule.trigger_type;
  }
}

function formatCondition(conditionJson: Record<string, any>): string {
  if (!conditionJson || Object.keys(conditionJson).length === 0) {
    return '';
  }

  const { field, operator, value } = conditionJson;
  if (!field || !operator) return '';

  return `${field} ${operator} ${value}`;
}

function formatAction(rule: WorkflowRule): string {
  switch (rule.action_type) {
    case 'crm_field_write':
      return `Set ${rule.action_payload.field || 'field'} = ${rule.action_payload.value_expr || 'value'}`;
    case 'crm_task_create':
      return `Create task: ${rule.action_payload.title_template || 'Task'}`;
    case 'slack_notify':
      return `Send Slack notification`;
    case 'finding_escalate':
      return `Escalate finding severity`;
    case 'stage_change':
      return `Change stage to ${rule.action_payload.target_stage || 'stage'}`;
    default:
      return rule.action_type;
  }
}

function formatExecutionMode(mode: string): string {
  switch (mode) {
    case 'auto':
      return 'Auto';
    case 'queue':
      return 'Queue for review';
    case 'manual':
      return 'Manual';
    default:
      return mode;
  }
}

function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) {
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    if (diffHours === 0) {
      const diffMins = Math.floor(diffMs / (1000 * 60));
      return `${diffMins}m ago`;
    }
    return `${diffHours}h ago`;
  }

  return `${diffDays}d ago`;
}

// Rule Builder Modal (placeholder for now - will implement in next phase)
interface RuleBuilderModalProps {
  rule: WorkflowRule | null;
  onClose: () => void;
  onSave: () => void;
}

function RuleBuilderModal({ rule, onClose, onSave }: RuleBuilderModalProps) {
  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      background: 'rgba(0, 0, 0, 0.5)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1000,
    }}>
      <div style={{
        background: colors.surface,
        borderRadius: 12,
        padding: 24,
        maxWidth: 600,
        width: '90%',
        maxHeight: '80vh',
        overflowY: 'auto',
      }}>
        <div style={{ marginBottom: 16, fontSize: 18, fontWeight: 600, color: colors.text }}>
          {rule ? 'Edit Rule' : 'New Automation Rule'}
        </div>

        <div style={{ padding: 40, textAlign: 'center', color: colors.textMuted }}>
          Rule builder coming soon...
        </div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 24 }}>
          <button
            onClick={onClose}
            style={{
              padding: '8px 16px',
              fontSize: 13,
              fontWeight: 600,
              fontFamily: fonts.sans,
              color: colors.textSecondary,
              background: 'transparent',
              border: `1px solid ${colors.border}`,
              borderRadius: 6,
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
