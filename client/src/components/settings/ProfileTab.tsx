import React, { useState, useEffect } from 'react';
import { colors, fonts } from '../../styles/theme';
import Toast from '../Toast';

interface UserProfile {
  id: string;
  email: string;
  name: string;
  avatar_url?: string | null;
  account_type: string;
}

function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash);
}

function getAvatarGradient(name: string): string {
  const hash = hashString(name);
  const hue1 = hash % 360;
  const hue2 = (hash + 137) % 360;
  return `linear-gradient(135deg, hsl(${hue1}, 65%, 55%), hsl(${hue2}, 65%, 45%))`;
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0) return '??';
  if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export default function ProfileTab() {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);

  useEffect(() => {
    fetchUser();
  }, []);

  const fetchUser = async () => {
    try {
      setLoading(true);
      const token = localStorage.getItem('pandora_session');
      const res = await fetch('/api/auth/me', {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Failed to fetch user');
      const data = await res.json();
      setUser(data.user);
      setName(data.user.name);
    } catch (err) {
      console.error('Failed to load user:', err);
      setToast({ message: 'Failed to load profile', type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!user || name.trim() === user.name) return;

    try {
      setSaving(true);
      const token = localStorage.getItem('pandora_session');
      const res = await fetch('/api/auth/profile', {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: name.trim() }),
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Failed to update profile');
      }

      const data = await res.json();
      setUser(data.user);
      setName(data.user.name);
      setToast({ message: 'Profile updated', type: 'success' });
    } catch (err) {
      console.error('Failed to save profile:', err);
      setToast({ message: err instanceof Error ? err.message : 'Failed to save profile', type: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const handleChangePhoto = () => {
    setToast({ message: 'Photo upload coming soon', type: 'info' });
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

  if (!user) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: colors.textMuted }}>
        Failed to load profile
      </div>
    );
  }

  const hasChanges = name.trim() !== user.name && name.trim().length > 0;

  return (
    <div style={{ maxWidth: 600, fontFamily: fonts.sans }}>
      <h1 style={{ fontSize: 24, fontWeight: 600, color: colors.text, marginBottom: 8 }}>
        Profile
      </h1>
      <p style={{ fontSize: 14, color: colors.textSecondary, marginBottom: 32 }}>
        Manage your personal information
      </p>

      {/* SECTION 1: Profile Information */}
      <div
        style={{
          background: colors.surface,
          border: `1px solid ${colors.border}`,
          borderRadius: 8,
          padding: 32,
          marginBottom: 24,
        }}
      >
        <h2 style={{ fontSize: 16, fontWeight: 600, color: colors.text, marginBottom: 24 }}>
          Profile Information
        </h2>

        {/* Avatar */}
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 32 }}>
          <div
            style={{
              width: 64,
              height: 64,
              borderRadius: '50%',
              background: user.avatar_url ? `url(${user.avatar_url})` : getAvatarGradient(user.name),
              backgroundSize: 'cover',
              backgroundPosition: 'center',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 22,
              fontWeight: 600,
              color: '#fff',
              flexShrink: 0,
            }}
          >
            {!user.avatar_url && getInitials(user.name)}
          </div>
          <div style={{ marginLeft: 20 }}>
            <button
              onClick={handleChangePhoto}
              style={{
                background: 'transparent',
                border: 'none',
                color: colors.accent,
                fontSize: 14,
                cursor: 'pointer',
                fontFamily: fonts.sans,
                padding: 0,
                textDecoration: 'underline',
              }}
            >
              Change photo
            </button>
          </div>
        </div>

        {/* Name Field */}
        <div style={{ marginBottom: 20 }}>
          <label
            style={{
              display: 'block',
              fontSize: 13,
              fontWeight: 500,
              color: colors.text,
              marginBottom: 6,
            }}
          >
            Name
          </label>
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            style={{
              width: '100%',
              padding: '10px 12px',
              fontSize: 14,
              fontFamily: fonts.sans,
              color: colors.text,
              background: colors.surfaceRaised,
              border: `1px solid ${colors.border}`,
              borderRadius: 6,
              outline: 'none',
            }}
            onFocus={e => (e.target.style.borderColor = colors.borderFocus)}
            onBlur={e => (e.target.style.borderColor = colors.border)}
          />
        </div>

        {/* Email Field */}
        <div style={{ marginBottom: 8 }}>
          <label
            style={{
              display: 'block',
              fontSize: 13,
              fontWeight: 500,
              color: colors.text,
              marginBottom: 6,
            }}
          >
            Email
          </label>
          <input
            type="email"
            value={user.email}
            disabled
            style={{
              width: '100%',
              padding: '10px 12px',
              fontSize: 14,
              fontFamily: fonts.sans,
              color: colors.textMuted,
              background: colors.surface,
              border: `1px solid ${colors.border}`,
              borderRadius: 6,
              cursor: 'not-allowed',
            }}
          />
        </div>
        <p style={{ fontSize: 12, color: colors.textMuted, marginBottom: 24 }}>
          To change your email address, contact support.
        </p>

        {/* Save Button */}
        <button
          onClick={handleSave}
          disabled={!hasChanges || saving}
          style={{
            padding: '10px 20px',
            fontSize: 14,
            fontWeight: 500,
            fontFamily: fonts.sans,
            color: hasChanges && !saving ? '#fff' : colors.textMuted,
            background: hasChanges && !saving ? colors.accent : colors.surfaceHover,
            border: 'none',
            borderRadius: 6,
            cursor: hasChanges && !saving ? 'pointer' : 'not-allowed',
            transition: 'background 0.2s',
          }}
        >
          {saving ? 'Saving...' : 'Save Profile'}
        </button>
      </div>

      {/* SECTION 2: Account Type */}
      <div
        style={{
          background: colors.surface,
          border: `1px solid ${colors.border}`,
          borderRadius: 8,
          padding: 32,
        }}
      >
        <h2 style={{ fontSize: 16, fontWeight: 600, color: colors.text, marginBottom: 20 }}>
          Account Type
        </h2>

        <div style={{ marginBottom: 8 }}>
          <label style={{ display: 'block', fontSize: 13, color: colors.textSecondary, marginBottom: 8 }}>
            Account Type
          </label>
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '6px 12px',
              fontSize: 13,
              fontWeight: 500,
              fontFamily: fonts.sans,
              color: user.account_type === 'multi_workspace' ? colors.accent : colors.textSecondary,
              background: user.account_type === 'multi_workspace' ? colors.accentSoft : colors.surfaceHover,
              border: `1px solid ${user.account_type === 'multi_workspace' ? colors.accent : colors.border}`,
              borderRadius: 6,
            }}
          >
            {user.account_type === 'multi_workspace' && <span style={{ fontSize: 14 }}>✦</span>}
            {user.account_type === 'multi_workspace' ? 'Multi-Workspace' : 'Standard'}
          </div>
        </div>

        <p style={{ fontSize: 13, color: colors.textMuted }}>
          {user.account_type === 'multi_workspace'
            ? 'Access to multiple workspaces with unified navigation.'
            : 'Access to a single workspace.'}
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
