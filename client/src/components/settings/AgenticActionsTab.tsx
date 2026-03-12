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

export default function AgenticActionsTab() {
  const { currentWorkspace } = useWorkspace();
  const [settings, setSettings] = useState<WorkspaceActionSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [actionThreshold, setActionThreshold] = useState<'high' | 'medium' | 'low'>('medium');
  const [protectedStages, setProtectedStages] = useState<string>('');
  const [protectedFields, setProtectedFields] = useState<string>('');
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
      fetchSettings();
    }
  }, [currentWorkspace?.id]);

  const fetchSettings = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await api.get('/agentic-actions/settings') as any;
      setSettings(data.settings);

      // Populate form
      setActionThreshold(data.settings.action_threshold);
      setProtectedStages(data.settings.protected_stages.join(', '));
      setProtectedFields(data.settings.protected_fields.join(', '));
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
        protected_stages: protectedStages.split(',').map(s => s.trim()).filter(Boolean),
        protected_fields: protectedFields.split(',').map(s => s.trim()).filter(Boolean),
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
          Comma-separated list of deal stages that Pandora will never write to (e.g., "Closed Won, Closed Lost")
        </p>
        <input
          type="text"
          value={protectedStages}
          onChange={(e) => setProtectedStages(e.target.value)}
          placeholder="Closed Won, Closed Lost"
          style={{
            width: '100%',
            padding: '10px 12px',
            fontSize: 14,
            fontFamily: fonts.mono,
            color: colors.text,
            background: colors.surface,
            border: `1px solid ${colors.border}`,
            borderRadius: 6,
          }}
        />
      </div>

      {/* Protected Fields */}
      <div style={{ marginBottom: 32 }}>
        <h3 style={{ fontSize: 16, fontWeight: 600, color: colors.text, marginBottom: 8 }}>
          Protected Fields
        </h3>
        <p style={{ fontSize: 13, color: colors.textSecondary, marginBottom: 12 }}>
          Comma-separated list of field keys that Pandora will never write to (e.g., "amount, close_date")
        </p>
        <input
          type="text"
          value={protectedFields}
          onChange={(e) => setProtectedFields(e.target.value)}
          placeholder="amount, close_date"
          style={{
            width: '100%',
            padding: '10px 12px',
            fontSize: 14,
            fontFamily: fonts.mono,
            color: colors.text,
            background: colors.surface,
            border: `1px solid ${colors.border}`,
            borderRadius: 6,
          }}
        />
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

      {/* Audit Webhook */}
      <div style={{ marginBottom: 32 }}>
        <h3 style={{ fontSize: 16, fontWeight: 600, color: colors.text, marginBottom: 16 }}>
          Audit Webhook
        </h3>

        <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={auditWebhookEnabled}
            onChange={(e) => setAuditWebhookEnabled(e.target.checked)}
            style={{ cursor: 'pointer' }}
          />
          <span style={{ fontSize: 14, color: colors.text }}>
            Enable audit webhook
          </span>
        </label>

        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 13, color: colors.textSecondary, display: 'block', marginBottom: 6 }}>
            Webhook URL
          </label>
          <input
            type="url"
            value={auditWebhookUrl}
            onChange={(e) => setAuditWebhookUrl(e.target.value)}
            placeholder="https://your-endpoint.com/webhook"
            disabled={!auditWebhookEnabled}
            style={{
              width: '100%',
              padding: '10px 12px',
              fontSize: 14,
              fontFamily: fonts.mono,
              color: colors.text,
              background: colors.surface,
              border: `1px solid ${colors.border}`,
              borderRadius: 6,
              opacity: auditWebhookEnabled ? 1 : 0.5,
            }}
          />
        </div>

        <div>
          <label style={{ fontSize: 13, color: colors.textSecondary, display: 'block', marginBottom: 6 }}>
            HMAC Secret
          </label>
          <input
            type="password"
            value={auditWebhookSecret}
            onChange={(e) => setAuditWebhookSecret(e.target.value)}
            placeholder="Your HMAC-SHA256 signing key"
            disabled={!auditWebhookEnabled}
            style={{
              width: '100%',
              padding: '10px 12px',
              fontSize: 14,
              fontFamily: fonts.mono,
              color: colors.text,
              background: colors.surface,
              border: `1px solid ${colors.border}`,
              borderRadius: 6,
              opacity: auditWebhookEnabled ? 1 : 0.5,
            }}
          />
        </div>
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
