import React, { useState, useEffect } from 'react';
import { colors, fonts } from '../../styles/theme';
import { useWorkspace } from '../../context/WorkspaceContext';
import { api } from '../../lib/api';

interface WorkspaceActionSettings {
  id: string;
  workspace_id: string;
  action_threshold: 'high' | 'medium' | 'low';
  protected_stages: string[];
  field_overrides: Record<string, 'high' | 'medium' | 'low'>;
  protected_fields: string[];
  notify_on_auto_write: boolean;
  notify_channel: string | null;
  notify_rep: boolean;
  notify_manager: boolean;
  undo_window_hours: number;
  audit_webhook_url: string | null;
  audit_webhook_secret: string | null;
  audit_webhook_enabled: boolean;
}

interface Stage {
  raw_stage: string;
  normalized_stage: string;
  pipeline: string;
}

interface PandoraField {
  key: string;
  label: string;
  category: string;
  always_queue?: boolean;
}

export default function AgenticActionsTab() {
  const { currentWorkspace } = useWorkspace();
  const [settings, setSettings] = useState<WorkspaceActionSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Data for pickers
  const [availableStages, setAvailableStages] = useState<Stage[]>([]);
  const [availableFields, setAvailableFields] = useState<PandoraField[]>([]);
  const [loadingPickerData, setLoadingPickerData] = useState(true);

  // Form state
  const [actionThreshold, setActionThreshold] = useState<'high' | 'medium' | 'low'>('medium');
  const [protectedStages, setProtectedStages] = useState<string[]>([]);
  const [protectedFields, setProtectedFields] = useState<string[]>([]);
  const [notifyOnAutoWrite, setNotifyOnAutoWrite] = useState(true);
  const [notifyChannel, setNotifyChannel] = useState('');
  const [notifyRep, setNotifyRep] = useState(true);
  const [notifyManager, setNotifyManager] = useState(true);
  const [undoWindowHours, setUndoWindowHours] = useState(24);
  const [auditWebhookUrl, setAuditWebhookUrl] = useState('');
  const [auditWebhookSecret, setAuditWebhookSecret] = useState('');
  const [auditWebhookEnabled, setAuditWebhookEnabled] = useState(false);

  useEffect(() => {
    if (currentWorkspace?.id) {
      fetchPickerData();
      fetchSettings();
    }
  }, [currentWorkspace?.id]);

  const fetchPickerData = async () => {
    try {
      setLoadingPickerData(true);

      // Fetch available stages
      const stagesData = await api.get('/workspace-config/stages') as any;
      const stages: Stage[] = stagesData.stages || [];
      setAvailableStages(stages);

      // Fetch available fields
      const fieldsData = await api.get('/crm-writeback/fields') as any;
      const fields: PandoraField[] = fieldsData.fields || [];
      setAvailableFields(fields);
    } catch (err) {
      console.error('Failed to fetch picker data:', err);
    } finally {
      setLoadingPickerData(false);
    }
  };

  const fetchSettings = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await api.get('/agentic-actions/settings') as any;
      setSettings(data.settings);

      // Populate form
      setActionThreshold(data.settings.action_threshold);
      setProtectedStages(data.settings.protected_stages || []);
      setProtectedFields(data.settings.protected_fields || []);
      setNotifyOnAutoWrite(data.settings.notify_on_auto_write);
      setNotifyChannel(data.settings.notify_channel || '');
      setNotifyRep(data.settings.notify_rep);
      setNotifyManager(data.settings.notify_manager);
      setUndoWindowHours(data.settings.undo_window_hours);
      setAuditWebhookUrl(data.settings.audit_webhook_url || '');
      setAuditWebhookSecret(data.settings.audit_webhook_secret || '');
      setAuditWebhookEnabled(data.settings.audit_webhook_enabled);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      setError(null);

      const payload = {
        action_threshold: actionThreshold,
        protected_stages: protectedStages,
        protected_fields: protectedFields,
        notify_on_auto_write: notifyOnAutoWrite,
        notify_channel: notifyChannel || null,
        notify_rep: notifyRep,
        notify_manager: notifyManager,
        undo_window_hours: undoWindowHours,
        audit_webhook_url: auditWebhookUrl || null,
        audit_webhook_secret: auditWebhookSecret || null,
        audit_webhook_enabled: auditWebhookEnabled,
      };

      const data = await api.put('/agentic-actions/settings', payload) as any;
      setSettings(data.settings);
      alert('Settings saved successfully');
    } catch (err: any) {
      setError(err.message);
      alert(`Error: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div style={{ padding: 20, color: colors.textSecondary }}>Loading...</div>;
  }

  if (error && !settings) {
    return <div style={{ padding: 20, color: colors.error }}>Error: {error}</div>;
  }

  return (
    <div style={{ maxWidth: 800, fontFamily: fonts.sans }}>
      <h1 style={{ fontSize: 24, fontWeight: 600, color: colors.text, marginBottom: 8 }}>
        Agentic Actions
      </h1>
      <p style={{ fontSize: 14, color: colors.textSecondary, marginBottom: 32 }}>
        Configure Pandora's autonomous CRM write capabilities, field protection, and audit controls.
      </p>

      {/* Global Threshold */}
      <div style={{ marginBottom: 32 }}>
        <h3 style={{ fontSize: 16, fontWeight: 600, color: colors.text, marginBottom: 16 }}>
          Global Action Threshold
        </h3>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          {(['high', 'medium', 'low'] as const).map(level => (
            <label
              key={level}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '12px 16px',
                background: actionThreshold === level ? colors.accentSoft : colors.surface,
                border: `1px solid ${actionThreshold === level ? colors.accent : colors.border}`,
                borderRadius: 8,
                cursor: 'pointer',
                transition: 'all 0.15s',
              }}
            >
              <input
                type="radio"
                value={level}
                checked={actionThreshold === level}
                onChange={(e) => setActionThreshold(e.target.value as 'high' | 'medium' | 'low')}
                style={{ cursor: 'pointer' }}
              />
              <div>
                <div style={{ fontSize: 14, fontWeight: 600, color: colors.text, textTransform: 'capitalize' }}>
                  {level}
                </div>
                <div style={{ fontSize: 12, color: colors.textSecondary }}>
                  {level === 'high' && 'Write immediately, notify after'}
                  {level === 'medium' && 'Queue for approval (HITL)'}
                  {level === 'low' && 'Never write, recommend only'}
                </div>
              </div>
            </label>
          ))}
        </div>
      </div>

      {/* Protected Stages */}
      <div style={{ marginBottom: 32 }}>
        <h3 style={{ fontSize: 16, fontWeight: 600, color: colors.text, marginBottom: 8 }}>
          Protected Stages
        </h3>
        <p style={{ fontSize: 13, color: colors.textSecondary, marginBottom: 12 }}>
          Select deal stages that Pandora will never write to
        </p>
        {loadingPickerData ? (
          <div style={{ fontSize: 13, color: colors.textMuted, padding: '12px 0' }}>Loading stages...</div>
        ) : (
          <div style={{
            background: colors.surface,
            border: `1px solid ${colors.border}`,
            borderRadius: 6,
            padding: 12,
            maxHeight: 240,
            overflowY: 'auto'
          }}>
            {availableStages.length === 0 ? (
              <div style={{ fontSize: 13, color: colors.textMuted, padding: 8 }}>No stages available</div>
            ) : (
              // Group by pipeline
              Object.entries(
                availableStages.reduce((acc, stage) => {
                  const pipeline = stage.pipeline || 'Unknown Pipeline';
                  if (!acc[pipeline]) acc[pipeline] = [];
                  acc[pipeline].push(stage);
                  return acc;
                }, {} as Record<string, Stage[]>)
              ).map(([pipeline, stages]) => (
                <div key={pipeline} style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>
                    {pipeline}
                  </div>
                  {stages.map((stage) => {
                    const isChecked = protectedStages.includes(stage.raw_stage);
                    return (
                      <label
                        key={`${pipeline}-${stage.raw_stage}`}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                          padding: '6px 8px',
                          cursor: 'pointer',
                          borderRadius: 4,
                          transition: 'background 0.15s',
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.background = `${colors.accent}10`; }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                      >
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setProtectedStages([...protectedStages, stage.raw_stage]);
                            } else {
                              setProtectedStages(protectedStages.filter(s => s !== stage.raw_stage));
                            }
                          }}
                          style={{ cursor: 'pointer' }}
                        />
                        <span style={{ fontSize: 13, color: colors.text }}>{stage.raw_stage}</span>
                      </label>
                    );
                  })}
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {/* Protected Fields */}
      <div style={{ marginBottom: 32 }}>
        <h3 style={{ fontSize: 16, fontWeight: 600, color: colors.text, marginBottom: 8 }}>
          Protected Fields
        </h3>
        <p style={{ fontSize: 13, color: colors.textSecondary, marginBottom: 12 }}>
          Select fields that Pandora will never write to. Some fields are always protected and cannot be disabled.
        </p>
        {loadingPickerData ? (
          <div style={{ fontSize: 13, color: colors.textMuted, padding: '12px 0' }}>Loading fields...</div>
        ) : (
          <div style={{
            background: colors.surface,
            border: `1px solid ${colors.border}`,
            borderRadius: 6,
            padding: 12,
            maxHeight: 320,
            overflowY: 'auto'
          }}>
            {availableFields.length === 0 ? (
              <div style={{ fontSize: 13, color: colors.textMuted, padding: 8 }}>No fields available</div>
            ) : (
              // Group by category
              Object.entries(
                availableFields.reduce((acc, field) => {
                  const category = field.category || 'Other';
                  if (!acc[category]) acc[category] = [];
                  acc[category].push(field);
                  return acc;
                }, {} as Record<string, PandoraField[]>)
              ).map(([category, fields]) => (
                <div key={category} style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>
                    {category}
                  </div>
                  {fields.map((field) => {
                    const isLocked = field.always_queue === true;
                    const isChecked = isLocked || protectedFields.includes(field.key);
                    return (
                      <label
                        key={field.key}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                          padding: '6px 8px',
                          cursor: isLocked ? 'not-allowed' : 'pointer',
                          borderRadius: 4,
                          transition: 'background 0.15s',
                          opacity: isLocked ? 0.7 : 1,
                        }}
                        onMouseEnter={(e) => { if (!isLocked) e.currentTarget.style.background = `${colors.accent}10`; }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                        title={isLocked ? 'Always protected — cannot be disabled' : ''}
                      >
                        <input
                          type="checkbox"
                          checked={isChecked}
                          disabled={isLocked}
                          onChange={(e) => {
                            if (!isLocked) {
                              if (e.target.checked) {
                                setProtectedFields([...protectedFields, field.key]);
                              } else {
                                setProtectedFields(protectedFields.filter(k => k !== field.key));
                              }
                            }
                          }}
                          style={{ cursor: isLocked ? 'not-allowed' : 'pointer' }}
                        />
                        <span style={{ fontSize: 13, color: colors.text, flex: 1 }}>{field.label}</span>
                        {isLocked && (
                          <span style={{ fontSize: 11, color: colors.yellow, marginLeft: 4 }} title="Always protected">🔒</span>
                        )}
                      </label>
                    );
                  })}
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {/* Notification Settings */}
      <div style={{ marginBottom: 32 }}>
        <h3 style={{ fontSize: 16, fontWeight: 600, color: colors.text, marginBottom: 16 }}>
          Notifications
        </h3>

        <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={notifyOnAutoWrite}
            onChange={(e) => setNotifyOnAutoWrite(e.target.checked)}
            style={{ cursor: 'pointer' }}
          />
          <span style={{ fontSize: 14, color: colors.text }}>
            Notify on high-threshold writes
          </span>
        </label>

        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 13, color: colors.textSecondary, display: 'block', marginBottom: 6 }}>
            Slack Channel ID
          </label>
          <input
            type="text"
            value={notifyChannel}
            onChange={(e) => setNotifyChannel(e.target.value)}
            placeholder="C01234ABCD"
            disabled={!notifyOnAutoWrite}
            style={{
              width: '100%',
              padding: '10px 12px',
              fontSize: 14,
              fontFamily: fonts.mono,
              color: colors.text,
              background: colors.surface,
              border: `1px solid ${colors.border}`,
              borderRadius: 6,
              opacity: notifyOnAutoWrite ? 1 : 0.5,
            }}
          />
        </div>

        <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={notifyRep}
            onChange={(e) => setNotifyRep(e.target.checked)}
            disabled={!notifyOnAutoWrite}
            style={{ cursor: 'pointer' }}
          />
          <span style={{ fontSize: 14, color: colors.text, opacity: notifyOnAutoWrite ? 1 : 0.5 }}>
            DM deal owner
          </span>
        </label>

        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={notifyManager}
            onChange={(e) => setNotifyManager(e.target.checked)}
            disabled={!notifyOnAutoWrite}
            style={{ cursor: 'pointer' }}
          />
          <span style={{ fontSize: 14, color: colors.text, opacity: notifyOnAutoWrite ? 1 : 0.5 }}>
            DM manager
          </span>
        </label>
      </div>

      {/* Undo Window */}
      <div style={{ marginBottom: 32 }}>
        <h3 style={{ fontSize: 16, fontWeight: 600, color: colors.text, marginBottom: 8 }}>
          Undo Window (hours)
        </h3>
        <p style={{ fontSize: 13, color: colors.textSecondary, marginBottom: 12 }}>
          Time window during which high-threshold writes can be reversed
        </p>
        <input
          type="number"
          value={undoWindowHours}
          onChange={(e) => setUndoWindowHours(parseInt(e.target.value, 10))}
          min={1}
          max={168}
          style={{
            width: 120,
            padding: '10px 12px',
            fontSize: 14,
            color: colors.text,
            background: colors.surface,
            border: `1px solid ${colors.border}`,
            borderRadius: 6,
          }}
        />
      </div>

      {/* Audit Webhook — managed in Webhooks settings */}
      <div style={{
        marginBottom: 32,
        padding: '14px 16px',
        borderRadius: 8,
        background: colors.surface,
        border: `1px solid ${colors.border}`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 16,
      }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: colors.text, marginBottom: 3 }}>Audit Webhook</div>
          <div style={{ fontSize: 12, color: colors.textMuted }}>
            Configure audit webhook endpoints in the Webhooks settings page.
          </div>
        </div>
        <a
          href="/settings/webhooks"
          style={{
            flexShrink: 0,
            padding: '6px 14px',
            fontSize: 12,
            fontWeight: 600,
            fontFamily: fonts.sans,
            color: colors.accent,
            border: `1px solid ${colors.accent}`,
            borderRadius: 6,
            background: colors.accentSoft,
            textDecoration: 'none',
            whiteSpace: 'nowrap',
            transition: 'all 0.15s',
          }}
          onMouseEnter={e => {
            (e.currentTarget as HTMLAnchorElement).style.background = colors.accent;
            (e.currentTarget as HTMLAnchorElement).style.color = '#fff';
          }}
          onMouseLeave={e => {
            (e.currentTarget as HTMLAnchorElement).style.background = colors.accentSoft;
            (e.currentTarget as HTMLAnchorElement).style.color = colors.accent;
          }}
        >
          Go to Webhooks →
        </a>
      </div>

      {/* Save Button */}
      <div style={{ display: 'flex', gap: 12 }}>
        <button
          onClick={handleSave}
          disabled={saving}
          style={{
            padding: '12px 24px',
            fontSize: 14,
            fontWeight: 600,
            color: '#fff',
            background: saving ? colors.textDim : colors.accent,
            border: 'none',
            borderRadius: 6,
            cursor: saving ? 'not-allowed' : 'pointer',
            transition: 'background 0.15s',
          }}
        >
          {saving ? 'Saving...' : 'Save Changes'}
        </button>
      </div>

      {error && (
        <div style={{
          marginTop: 16,
          padding: 12,
          fontSize: 13,
          color: colors.error,
          background: `${colors.error}15`,
          border: `1px solid ${colors.error}40`,
          borderRadius: 6,
        }}>
          {error}
        </div>
      )}
    </div>
  );
}
