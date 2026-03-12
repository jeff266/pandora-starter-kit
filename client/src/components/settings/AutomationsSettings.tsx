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

// Rule Builder Modal
function validateExpr(expr: string): { valid: boolean; message: string } | null {
  if (!expr.trim()) return null;

  const openCount = (expr.match(/\{\{/g) || []).length;
  const closeCount = (expr.match(/\}\}/g) || []).length;
  if (openCount !== closeCount) {
    return { valid: false, message: 'Unclosed template variable — use {{deal.field}}' };
  }

  if (expr.startsWith('today') && expr !== 'today' && !/^today[+-]\d+d$/.test(expr)) {
    return { valid: false, message: 'Invalid date offset — use today+7d or today-30d' };
  }

  return { valid: true, message: 'Valid expression' };
}

interface RuleBuilderModalProps {
  rule: WorkflowRule | null;
  onClose: () => void;
  onSave: () => void;
}

interface Skill {
  id: string;
  name: string;
  description?: string;
  category?: string;
}

interface PandoraField {
  key: string;
  label: string;
  description: string;
  writable?: boolean;
  value_type: string;
}

function RuleBuilderModal({ rule, onClose, onSave }: RuleBuilderModalProps) {
  const { currentWorkspace } = useWorkspace();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [name, setName] = useState(rule?.name || '');
  const [description, setDescription] = useState(rule?.description || '');
  const [triggerType, setTriggerType] = useState<string>(rule?.trigger_type || 'skill_run');
  const [triggerSkillId, setTriggerSkillId] = useState(rule?.trigger_skill_id || '');
  const [triggerFindingCategory, setTriggerFindingCategory] = useState(rule?.trigger_finding_category || '');
  const [triggerSeverity, setTriggerSeverity] = useState(rule?.trigger_severity || '');
  const [conditionField, setConditionField] = useState(rule?.condition_json?.field || '');
  const [conditionOperator, setConditionOperator] = useState(rule?.condition_json?.operator || '');
  const [conditionValue, setConditionValue] = useState(rule?.condition_json?.value || '');
  const [actionType, setActionType] = useState<string>(rule?.action_type || 'crm_field_write');
  const [actionField, setActionField] = useState(rule?.action_payload?.field || '');
  const [actionValueExpr, setActionValueExpr] = useState(rule?.action_payload?.value_expr || '');
  const [actionTaskTitle, setActionTaskTitle] = useState(rule?.action_payload?.title_template || '');
  const [actionTaskDescription, setActionTaskDescription] = useState(rule?.action_payload?.description_template || '');
  const [actionTargetStage, setActionTargetStage] = useState(rule?.action_payload?.target_stage || '');
  const [executionMode, setExecutionMode] = useState<'auto' | 'queue' | 'manual'>(rule?.execution_mode || 'queue');
  const [isActive, setIsActive] = useState(rule?.is_active ?? true);
  const [showExprHelp, setShowExprHelp] = useState(false);
  const [exprValidation, setExprValidation] = useState<{ valid: boolean; message: string } | null>(null);

  // Data fetching
  const [skills, setSkills] = useState<Skill[]>([]);
  const [fields, setFields] = useState<PandoraField[]>([]);
  const [loadingData, setLoadingData] = useState(true);

  useEffect(() => {
    if (currentWorkspace?.id) {
      fetchData();
    }
  }, [currentWorkspace]);

  const fetchData = async () => {
    if (!currentWorkspace?.id) return;

    setLoadingData(true);
    try {
      const [skillsRes, customRes, fieldsRes] = await Promise.all([
        api.get('/skills'),
        api.get('/skills/custom'),
        api.get('/crm-writeback/fields'),
      ]) as any[];

      // Registry skills: API returns a plain array (not { skills: [] })
      const registrySkills: Skill[] = (Array.isArray(skillsRes) ? skillsRes : []).map((s: any) => ({
        id: s.id,
        name: s.name,
        description: s.description,
        category: s.category || 'other',
      }));

      // Custom skills: API returns { skills: [] } with skill_id as trigger key
      const customSkills: Skill[] = (customRes.skills || []).map((s: any) => ({
        id: s.skill_id,
        name: `${s.name} [Custom]`,
        description: s.description,
        category: 'custom',
      }));

      setSkills([...registrySkills, ...customSkills]);
      setFields((fieldsRes.fields || []).filter((f: PandoraField) => f.writable));
    } catch (err) {
      console.error('[RuleBuilderModal] Failed to fetch data:', err);
    } finally {
      setLoadingData(false);
    }
  };

  const handleSave = async () => {
    setError(null);

    // Validate required fields
    if (!name.trim()) {
      setError('Rule name is required');
      return;
    }

    if (triggerType === 'skill_run' && !triggerSkillId) {
      setError('Please select a skill for the trigger');
      return;
    }

    if (triggerType === 'finding_created' && !triggerFindingCategory) {
      setError('Please enter a finding category for the trigger');
      return;
    }

    if (actionType === 'crm_field_write' && !actionField) {
      setError('Please select a field to write');
      return;
    }

    if (actionType === 'crm_field_write' && !actionValueExpr) {
      setError('Please enter a value expression');
      return;
    }

    if (actionType === 'crm_task_create' && !actionTaskTitle) {
      setError('Please enter a task title template');
      return;
    }

    if (actionType === 'stage_change' && !actionTargetStage) {
      setError('Please enter a target stage');
      return;
    }

    // Build condition_json
    const condition_json = (conditionField && conditionOperator && conditionValue)
      ? { field: conditionField, operator: conditionOperator, value: conditionValue }
      : {};

    // Build action_payload
    let action_payload: Record<string, any> = {};
    if (actionType === 'crm_field_write') {
      action_payload = { field: actionField, value_expr: actionValueExpr };
    } else if (actionType === 'crm_task_create') {
      action_payload = {
        title_template: actionTaskTitle,
        description_template: actionTaskDescription,
      };
    } else if (actionType === 'stage_change') {
      action_payload = { target_stage: actionTargetStage };
    }

    const payload = {
      name,
      description: description || undefined,
      trigger_type: triggerType,
      trigger_skill_id: triggerType === 'skill_run' ? triggerSkillId : undefined,
      trigger_finding_category: triggerType === 'finding_created' ? triggerFindingCategory : undefined,
      trigger_severity: triggerType === 'finding_created' && triggerSeverity ? triggerSeverity : undefined,
      condition_json,
      action_type: actionType,
      action_payload,
      execution_mode: executionMode,
      is_active: isActive,
    };

    setSaving(true);
    try {
      if (rule) {
        await api.patch(`/workflow-rules/${rule.id}`, payload);
      } else {
        await api.post(`/workflow-rules`, payload);
      }
      onSave();
    } catch (err: any) {
      console.error('[RuleBuilderModal] Failed to save rule:', err);
      setError(err.response?.data?.error || 'Failed to save rule');
      setSaving(false);
    }
  };

  if (loadingData) {
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
          padding: 40,
          textAlign: 'center',
          color: colors.textMuted,
        }}>
          Loading...
        </div>
      </div>
    );
  }

  // Force queue mode for stage changes and amount updates
  const finalExecutionMode = (actionType === 'stage_change' || (actionType === 'crm_field_write' && actionField === 'amount'))
    ? 'queue'
    : executionMode;

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
        maxWidth: 700,
        width: '90%',
        maxHeight: '85vh',
        overflowY: 'auto',
        fontFamily: fonts.sans,
      }}>
        <div style={{ marginBottom: 20 }}>
          <h2 style={{ fontSize: 18, fontWeight: 600, color: colors.text, margin: 0 }}>
            {rule ? 'Edit Rule' : 'New Automation Rule'}
          </h2>
        </div>

        {error && (
          <div style={{
            padding: 12,
            marginBottom: 16,
            background: colors.dangerSoft,
            border: `1px solid ${colors.danger}`,
            borderRadius: 6,
            color: colors.danger,
            fontSize: 13,
          }}>
            {error}
          </div>
        )}

        {/* Basic Info */}
        <div style={{ marginBottom: 20 }}>
          <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: colors.text, marginBottom: 6 }}>
            Rule Name *
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g., Auto-update deal score when MEDDIC runs"
            style={{
              width: '100%',
              padding: '8px 12px',
              fontSize: 13,
              fontFamily: fonts.sans,
              color: colors.text,
              background: colors.surfaceRaised,
              border: `1px solid ${colors.border}`,
              borderRadius: 6,
              outline: 'none',
            }}
          />
        </div>

        <div style={{ marginBottom: 20 }}>
          <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: colors.text, marginBottom: 6 }}>
            Description
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Optional: What does this rule do?"
            rows={2}
            style={{
              width: '100%',
              padding: '8px 12px',
              fontSize: 13,
              fontFamily: fonts.sans,
              color: colors.text,
              background: colors.surfaceRaised,
              border: `1px solid ${colors.border}`,
              borderRadius: 6,
              outline: 'none',
              resize: 'vertical',
            }}
          />
        </div>

        {/* Trigger */}
        <div style={{ marginBottom: 20 }}>
          <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: colors.text, marginBottom: 6 }}>
            Trigger Type *
          </label>
          <select
            value={triggerType}
            onChange={(e) => setTriggerType(e.target.value)}
            style={{
              width: '100%',
              padding: '8px 12px',
              fontSize: 13,
              fontFamily: fonts.sans,
              color: colors.text,
              background: colors.surfaceRaised,
              border: `1px solid ${colors.border}`,
              borderRadius: 6,
              outline: 'none',
              cursor: 'pointer',
            }}
          >
            <option value="skill_run">Skill Run</option>
            <option value="finding_created">Finding Created</option>
            <option value="manual">Manual</option>
          </select>
        </div>

        {triggerType === 'skill_run' && (
          <div style={{ marginBottom: 20 }}>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: colors.text, marginBottom: 6 }}>
              Skill *
            </label>
            <select
              value={triggerSkillId}
              onChange={(e) => setTriggerSkillId(e.target.value)}
              style={{
                width: '100%',
                padding: '8px 12px',
                fontSize: 13,
                fontFamily: fonts.sans,
                color: colors.text,
                background: colors.surfaceRaised,
                border: `1px solid ${colors.border}`,
                borderRadius: 6,
                outline: 'none',
                cursor: 'pointer',
              }}
            >
              <option value="">Select a skill...</option>
              {Array.from(new Set(skills.filter(s => s.category !== 'custom').map(s => s.category))).sort().map(cat => (
                <optgroup key={cat} label={cat ? (cat.charAt(0).toUpperCase() + cat.slice(1)) : 'Other'}>
                  {skills.filter(s => s.category === cat).map(skill => (
                    <option key={skill.id} value={skill.id}>{skill.name}</option>
                  ))}
                </optgroup>
              ))}
              {skills.some(s => s.category === 'custom') && (
                <optgroup label="Custom Skills">
                  {skills.filter(s => s.category === 'custom').map(skill => (
                    <option key={skill.id} value={skill.id}>{skill.name}</option>
                  ))}
                </optgroup>
              )}
            </select>
          </div>
        )}

        {triggerType === 'finding_created' && (
          <>
            <div style={{ marginBottom: 20 }}>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: colors.text, marginBottom: 6 }}>
                Finding Category *
              </label>
              <input
                type="text"
                value={triggerFindingCategory}
                onChange={(e) => setTriggerFindingCategory(e.target.value)}
                placeholder="e.g., stale_deal, at_risk"
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  fontSize: 13,
                  fontFamily: fonts.sans,
                  color: colors.text,
                  background: colors.surfaceRaised,
                  border: `1px solid ${colors.border}`,
                  borderRadius: 6,
                  outline: 'none',
                }}
              />
            </div>
            <div style={{ marginBottom: 20 }}>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: colors.text, marginBottom: 6 }}>
                Severity
              </label>
              <select
                value={triggerSeverity}
                onChange={(e) => setTriggerSeverity(e.target.value)}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  fontSize: 13,
                  fontFamily: fonts.sans,
                  color: colors.text,
                  background: colors.surfaceRaised,
                  border: `1px solid ${colors.border}`,
                  borderRadius: 6,
                  outline: 'none',
                  cursor: 'pointer',
                }}
              >
                <option value="">Any severity</option>
                <option value="act">Act</option>
                <option value="watch">Watch</option>
                <option value="info">Info</option>
              </select>
            </div>
          </>
        )}

        {/* Condition (Optional) */}
        <div style={{ marginBottom: 20 }}>
          <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: colors.text, marginBottom: 6 }}>
            Condition (Optional)
          </label>
          <div style={{ fontSize: 12, color: colors.textMuted, marginBottom: 8 }}>
            Only execute if this condition is met
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 120px 1fr', gap: 8 }}>
            <select
              value={conditionField}
              onChange={(e) => setConditionField(e.target.value)}
              style={{
                padding: '8px 12px',
                fontSize: 13,
                fontFamily: fonts.sans,
                color: colors.text,
                background: colors.surfaceRaised,
                border: `1px solid ${colors.border}`,
                borderRadius: 6,
                outline: 'none',
                cursor: 'pointer',
              }}
            >
              <option value="">Select field...</option>
              {fields.map(field => (
                <option key={field.key} value={field.key}>{field.label}</option>
              ))}
            </select>
            <select
              value={conditionOperator}
              onChange={(e) => setConditionOperator(e.target.value)}
              disabled={!conditionField}
              style={{
                padding: '8px 12px',
                fontSize: 13,
                fontFamily: fonts.sans,
                color: colors.text,
                background: colors.surfaceRaised,
                border: `1px solid ${colors.border}`,
                borderRadius: 6,
                outline: 'none',
                cursor: conditionField ? 'pointer' : 'not-allowed',
                opacity: conditionField ? 1 : 0.5,
              }}
            >
              <option value="">Operator</option>
              <option value="equals">=</option>
              <option value="not_equals">≠</option>
              <option value="greater_than">&gt;</option>
              <option value="less_than">&lt;</option>
              <option value="contains">contains</option>
            </select>
            <input
              type="text"
              value={conditionValue}
              onChange={(e) => setConditionValue(e.target.value)}
              disabled={!conditionField || !conditionOperator}
              placeholder="Value"
              style={{
                padding: '8px 12px',
                fontSize: 13,
                fontFamily: fonts.sans,
                color: colors.text,
                background: colors.surfaceRaised,
                border: `1px solid ${colors.border}`,
                borderRadius: 6,
                outline: 'none',
                opacity: conditionField && conditionOperator ? 1 : 0.5,
              }}
            />
          </div>
        </div>

        {/* Action */}
        <div style={{ marginBottom: 20 }}>
          <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: colors.text, marginBottom: 6 }}>
            Action Type *
          </label>
          <select
            value={actionType}
            onChange={(e) => setActionType(e.target.value)}
            style={{
              width: '100%',
              padding: '8px 12px',
              fontSize: 13,
              fontFamily: fonts.sans,
              color: colors.text,
              background: colors.surfaceRaised,
              border: `1px solid ${colors.border}`,
              borderRadius: 6,
              outline: 'none',
              cursor: 'pointer',
            }}
          >
            <option value="crm_field_write">CRM Field Write</option>
            <option value="crm_task_create">Create Task</option>
            <option value="stage_change">Change Stage</option>
            <option value="slack_notify">Send Slack Notification</option>
            <option value="finding_escalate">Escalate Finding</option>
          </select>
        </div>

        {actionType === 'crm_field_write' && (
          <>
            <div style={{ marginBottom: 20 }}>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: colors.text, marginBottom: 6 }}>
                Field to Write *
              </label>
              <select
                value={actionField}
                onChange={(e) => setActionField(e.target.value)}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  fontSize: 13,
                  fontFamily: fonts.sans,
                  color: colors.text,
                  background: colors.surfaceRaised,
                  border: `1px solid ${colors.border}`,
                  borderRadius: 6,
                  outline: 'none',
                  cursor: 'pointer',
                }}
              >
                <option value="">Select field...</option>
                {fields.map(field => (
                  <option key={field.key} value={field.key}>{field.label}</option>
                ))}
              </select>
            </div>
            <div style={{ marginBottom: 20 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                <label style={{ fontSize: 13, fontWeight: 600, color: colors.text }}>
                  Value Expression *
                </label>
                <button
                  type="button"
                  onClick={() => setShowExprHelp(h => !h)}
                  style={{
                    fontSize: 11,
                    color: showExprHelp ? colors.accent : colors.textMuted,
                    background: 'transparent',
                    border: `1px solid ${showExprHelp ? colors.accent : colors.border}`,
                    borderRadius: 4,
                    cursor: 'pointer',
                    padding: '2px 8px',
                    fontFamily: fonts.sans,
                  }}
                >
                  {showExprHelp ? '✕ close' : 'ⓘ syntax guide'}
                </button>
              </div>

              {showExprHelp && (
                <div style={{
                  marginBottom: 8,
                  padding: '10px 12px',
                  background: colors.surfaceRaised,
                  border: `1px solid ${colors.border}`,
                  borderRadius: 6,
                  fontSize: 11,
                  lineHeight: 1.8,
                }}>
                  <div style={{ fontWeight: 600, marginBottom: 6, fontFamily: fonts.sans, color: colors.text, fontSize: 12 }}>
                    Syntax Reference
                  </div>
                  <table style={{ borderSpacing: 0, width: '100%', fontFamily: fonts.mono }}>
                    <tbody>
                      {([
                        ["'text'", 'Plain text literal', "'High Priority'"],
                        ['today+Nd', 'N days from now', 'today+7d'],
                        ['today-Nd', 'N days ago', 'today-30d'],
                        ['{{deal.field}}', 'Dynamic deal field', '{{deal.amount}}'],
                        ['{{deal.field}}*n', 'Arithmetic on field', '{{deal.amount}}*0.9'],
                      ] as [string, string, string][]).map(([syntax, desc, ex]) => (
                        <tr key={syntax}>
                          <td style={{ color: colors.accent, paddingRight: 12, whiteSpace: 'nowrap', verticalAlign: 'top' }}>{syntax}</td>
                          <td style={{ paddingRight: 12, color: colors.textMuted, verticalAlign: 'top' }}>{desc}</td>
                          <td style={{ color: colors.textSecondary, verticalAlign: 'top' }}>{ex}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div style={{ marginTop: 8, fontFamily: fonts.sans, color: colors.text, fontWeight: 600, fontSize: 11 }}>
                    Available deal fields:
                  </div>
                  <div style={{ marginTop: 4, color: colors.textMuted, fontFamily: fonts.mono, fontSize: 10, lineHeight: 1.7 }}>
                    deal.amount · deal.name · deal.stage · deal.close_date · deal.owner_email<br />
                    deal.health_score · deal.days_in_stage · deal.crm_id · deal.source_id
                  </div>
                </div>
              )}

              <input
                type="text"
                value={actionValueExpr}
                onChange={(e) => {
                  setActionValueExpr(e.target.value);
                  setExprValidation(validateExpr(e.target.value));
                }}
                placeholder="e.g., {{deal.amount}}*0.9, today+7d, 'High Priority'"
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  fontSize: 13,
                  fontFamily: fonts.sans,
                  color: colors.text,
                  background: colors.surfaceRaised,
                  border: `1px solid ${exprValidation ? (exprValidation.valid ? colors.success : colors.danger) : colors.border}`,
                  borderRadius: 6,
                  outline: 'none',
                }}
              />
              {exprValidation && (
                <div style={{ fontSize: 11, marginTop: 4, color: exprValidation.valid ? colors.success : colors.danger }}>
                  {exprValidation.valid ? '✓ ' : '✗ '}{exprValidation.message}
                </div>
              )}
            </div>
          </>
        )}

        {actionType === 'crm_task_create' && (
          <>
            <div style={{ marginBottom: 20 }}>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: colors.text, marginBottom: 6 }}>
                Task Title Template *
              </label>
              <input
                type="text"
                value={actionTaskTitle}
                onChange={(e) => setActionTaskTitle(e.target.value)}
                placeholder="e.g., Follow up on {{deal_name}}"
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  fontSize: 13,
                  fontFamily: fonts.sans,
                  color: colors.text,
                  background: colors.surfaceRaised,
                  border: `1px solid ${colors.border}`,
                  borderRadius: 6,
                  outline: 'none',
                }}
              />
            </div>
            <div style={{ marginBottom: 20 }}>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: colors.text, marginBottom: 6 }}>
                Task Description Template
              </label>
              <textarea
                value={actionTaskDescription}
                onChange={(e) => setActionTaskDescription(e.target.value)}
                placeholder="e.g., Deal score: {{deal_score}}. Next steps: {{next_steps}}"
                rows={3}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  fontSize: 13,
                  fontFamily: fonts.sans,
                  color: colors.text,
                  background: colors.surfaceRaised,
                  border: `1px solid ${colors.border}`,
                  borderRadius: 6,
                  outline: 'none',
                  resize: 'vertical',
                }}
              />
            </div>
          </>
        )}

        {actionType === 'stage_change' && (
          <div style={{ marginBottom: 20 }}>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: colors.text, marginBottom: 6 }}>
              Target Stage *
            </label>
            <input
              type="text"
              value={actionTargetStage}
              onChange={(e) => setActionTargetStage(e.target.value)}
              placeholder="e.g., Proposal, Closed Won"
              style={{
                width: '100%',
                padding: '8px 12px',
                fontSize: 13,
                fontFamily: fonts.sans,
                color: colors.text,
                background: colors.surfaceRaised,
                border: `1px solid ${colors.border}`,
                borderRadius: 6,
                outline: 'none',
              }}
            />
          </div>
        )}

        {/* Execution Mode */}
        <div style={{ marginBottom: 20 }}>
          <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: colors.text, marginBottom: 6 }}>
            Execution Mode
          </label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: colors.text, cursor: 'pointer' }}>
              <input
                type="radio"
                value="auto"
                checked={finalExecutionMode === 'auto'}
                onChange={(e) => setExecutionMode(e.target.value as 'auto')}
                disabled={actionType === 'stage_change' || (actionType === 'crm_field_write' && actionField === 'amount')}
                style={{ cursor: 'pointer' }}
              />
              <span>Auto - Execute immediately</span>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: colors.text, cursor: 'pointer' }}>
              <input
                type="radio"
                value="queue"
                checked={finalExecutionMode === 'queue'}
                onChange={(e) => setExecutionMode(e.target.value as 'queue')}
                style={{ cursor: 'pointer' }}
              />
              <span>Queue - Require approval before executing</span>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: colors.text, cursor: 'pointer' }}>
              <input
                type="radio"
                value="manual"
                checked={finalExecutionMode === 'manual'}
                onChange={(e) => setExecutionMode(e.target.value as 'manual')}
                disabled={actionType === 'stage_change' || (actionType === 'crm_field_write' && actionField === 'amount')}
                style={{ cursor: 'pointer' }}
              />
              <span>Manual - Never auto-execute</span>
            </label>
          </div>
          {(actionType === 'stage_change' || (actionType === 'crm_field_write' && actionField === 'amount')) && (
            <div style={{ fontSize: 11, color: colors.warning, marginTop: 6 }}>
              Stage changes and amount updates always require approval
            </div>
          )}
        </div>

        {/* Active Toggle */}
        <div style={{ marginBottom: 24 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: colors.text, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
              style={{ cursor: 'pointer' }}
            />
            <span>Active (rule will execute when triggered)</span>
          </label>
        </div>

        {/* Footer */}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', paddingTop: 16, borderTop: `1px solid ${colors.border}` }}>
          <button
            onClick={onClose}
            disabled={saving}
            style={{
              padding: '8px 16px',
              fontSize: 13,
              fontWeight: 600,
              fontFamily: fonts.sans,
              color: colors.textSecondary,
              background: 'transparent',
              border: `1px solid ${colors.border}`,
              borderRadius: 6,
              cursor: saving ? 'not-allowed' : 'pointer',
              opacity: saving ? 0.5 : 1,
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            style={{
              padding: '8px 16px',
              fontSize: 13,
              fontWeight: 600,
              fontFamily: fonts.sans,
              color: '#fff',
              background: saving ? colors.textMuted : colors.accent,
              border: 'none',
              borderRadius: 6,
              cursor: saving ? 'not-allowed' : 'pointer',
            }}
          >
            {saving ? 'Saving...' : (rule ? 'Update Rule' : 'Create Rule')}
          </button>
        </div>
      </div>
    </div>
  );
}
