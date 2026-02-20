import React, { useState, useEffect } from 'react';
import { colors, fonts } from '../../styles/theme';
import Toast from '../Toast';
import { useWorkspace } from '../../context/WorkspaceContext';

interface UserPreferences {
  anonymize_mode?: boolean;
}

export default function PreferencesTab() {
  const { currentWorkspace } = useWorkspace();
  const [anonymizeMode, setAnonymizeMode] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);
  const [workspaceForceAnonymize, setWorkspaceForceAnonymize] = useState(false);

  useEffect(() => {
    fetchPreferences();
  }, []);

  const fetchPreferences = async () => {
    try {
      setLoading(true);
      const token = localStorage.getItem('pandora_token');
      const res = await fetch('/api/auth/me', {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Failed to fetch preferences');
      const data = await res.json();
      setAnonymizeMode(data.user?.anonymize_mode || false);

      // Check if workspace forces anonymization (if this feature exists)
      // For now, assume it's always false unless we have workspace settings
      setWorkspaceForceAnonymize(false);
    } catch (err) {
      console.error('Failed to load preferences:', err);
      setToast({ message: 'Failed to load preferences', type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  const handleToggleAnonymize = async (enabled: boolean) => {
    if (workspaceForceAnonymize) return; // Disabled when workspace forces it

    try {
      setSaving(true);
      const token = localStorage.getItem('pandora_token');
      const res = await fetch('/api/auth/profile', {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ anonymize_mode: enabled }),
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Failed to update preference');
      }

      setAnonymizeMode(enabled);
      setToast({ message: 'Preference saved', type: 'success' });
    } catch (err) {
      console.error('Failed to save preference:', err);
      setToast({ message: err instanceof Error ? err.message : 'Failed to save preference', type: 'error' });
      // Revert on error
      setAnonymizeMode(!enabled);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div style={{ padding: 40, textAlign: 'center' }}>
        <div style={{
          width: 32,
          height: 32,
          border: `3px solid ${colors.border}`,
          borderTopColor: colors.accent,
          borderRadius: '50%',
          animation: 'spin 0.8s linear infinite',
          margin: '0 auto',
        }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 600, fontFamily: fonts.sans }}>
      <h1 style={{ fontSize: 24, fontWeight: 600, color: colors.text, marginBottom: 8 }}>
        Preferences
      </h1>
      <p style={{ fontSize: 14, color: colors.textSecondary, marginBottom: 32 }}>
        Customize your experience
      </p>

      {/* SECTION 1: Anonymize Mode */}
      <div
        style={{
          background: colors.surface,
          border: `1px solid ${colors.border}`,
          borderRadius: 8,
          padding: 32,
          marginBottom: 24,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 24 }}>
          <div style={{ flex: 1 }}>
            <h2 style={{ fontSize: 16, fontWeight: 600, color: colors.text, marginBottom: 8 }}>
              Anonymize Output
            </h2>
            <p style={{ fontSize: 13, color: colors.textSecondary, lineHeight: 1.6 }}>
              Replace company names, deal names, and rep names with generic labels (Company A, Deal #1, Rep X) in all skill and agent output. Useful for creating content and demos.
            </p>
          </div>

          {/* Toggle Switch */}
          <div
            onClick={() => !saving && !workspaceForceAnonymize && handleToggleAnonymize(!anonymizeMode)}
            style={{
              width: 48,
              height: 26,
              borderRadius: 13,
              background: anonymizeMode ? colors.accent : colors.surfaceHover,
              position: 'relative',
              cursor: workspaceForceAnonymize ? 'not-allowed' : saving ? 'wait' : 'pointer',
              transition: 'background 0.2s',
              flexShrink: 0,
              opacity: workspaceForceAnonymize ? 0.5 : 1,
            }}
          >
            <div
              style={{
                width: 20,
                height: 20,
                borderRadius: '50%',
                background: '#fff',
                position: 'absolute',
                top: 3,
                left: anonymizeMode ? 25 : 3,
                transition: 'left 0.2s',
                boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
              }}
            />
          </div>
        </div>

        {/* Info Callout when ON */}
        {anonymizeMode && !workspaceForceAnonymize && (
          <div
            style={{
              marginTop: 16,
              padding: 12,
              background: colors.accentSoft,
              border: `1px solid ${colors.accent}`,
              borderRadius: 6,
              fontSize: 13,
              color: colors.accent,
            }}
          >
            ℹ️ Anonymize mode is active. All skill output will use generic labels.
          </div>
        )}

        {/* Workspace Enforcement Message */}
        {workspaceForceAnonymize && (
          <p style={{ fontSize: 12, color: colors.textMuted, marginTop: 12 }}>
            Anonymize mode is enforced by your workspace administrator.
          </p>
        )}
      </div>

      {/* SECTION 2: Coming Soon - Notification Preferences */}
      <div
        style={{
          background: colors.surface,
          border: `1px solid ${colors.border}`,
          borderRadius: 8,
          padding: 32,
          opacity: 0.5,
          cursor: 'not-allowed',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
          <h2 style={{ fontSize: 16, fontWeight: 600, color: colors.textMuted }}>
            Notification Preferences
          </h2>
          <span
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: colors.textMuted,
              background: colors.surfaceHover,
              padding: '2px 8px',
              borderRadius: 4,
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
            }}
          >
            Coming Soon
          </span>
        </div>
        <p style={{ fontSize: 13, color: colors.textMuted, lineHeight: 1.6 }}>
          Control which notifications you receive and how.
        </p>
      </div>

      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onClose={() => setToast(null)}
        />
      )}
    </div>
  );
}
