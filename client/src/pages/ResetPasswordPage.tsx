import React, { useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { colors, fonts } from '../styles/theme';
import { api } from '../lib/api';

export default function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = searchParams.get('token');

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  if (!token) {
    return (
      <Shell>
        <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ fontSize: 32 }}>🔗</div>
          <h1 style={{ fontSize: 18, fontWeight: 700, color: colors.text, fontFamily: fonts.sans, margin: 0 }}>
            Invalid reset link
          </h1>
          <p style={{ fontSize: 13, color: colors.textMuted, lineHeight: 1.6, margin: 0 }}>
            This link is missing or invalid. Please request a new password reset.
          </p>
          <LinkButton onClick={() => navigate('/login')}>Back to sign in</LinkButton>
        </div>
      </Shell>
    );
  }

  if (success) {
    return (
      <Shell>
        <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{
            width: 48, height: 48, borderRadius: '50%',
            background: '#22c55e20',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            margin: '0 auto', fontSize: 22,
          }}>
            ✓
          </div>
          <h1 style={{ fontSize: 18, fontWeight: 700, color: colors.text, fontFamily: fonts.sans, margin: 0 }}>
            Password updated
          </h1>
          <p style={{ fontSize: 13, color: colors.textMuted, lineHeight: 1.6, margin: 0 }}>
            Your password has been reset. You can now sign in with your new password.
          </p>
          <button
            onClick={() => navigate('/login')}
            style={{
              padding: '10px 14px', background: colors.accent,
              color: '#fff', borderRadius: 6, fontSize: 13, fontWeight: 600,
              cursor: 'pointer', border: 'none', width: '100%', fontFamily: fonts.sans,
            }}
          >
            Sign in
          </button>
        </div>
      </Shell>
    );
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!newPassword) { setError('Password is required'); return; }
    if (newPassword.length < 8) { setError('Password must be at least 8 characters'); return; }
    if (newPassword !== confirmPassword) { setError('Passwords do not match'); return; }

    setLoading(true);
    try {
      await api.post('/auth/reset-password', { token, newPassword });
      setSuccess(true);
    } catch (err: any) {
      setError(err.message || 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Shell>
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ textAlign: 'center', marginBottom: 8 }}>
          <h1 style={{ fontSize: 18, fontWeight: 700, color: colors.text, fontFamily: fonts.sans, margin: '0 0 4px' }}>
            Choose a new password
          </h1>
          <p style={{ fontSize: 12, color: colors.textMuted, margin: 0 }}>
            Must be at least 8 characters
          </p>
        </div>

        <PasswordInput
          label="New password"
          value={newPassword}
          onChange={setNewPassword}
          placeholder="New password"
          visible={showNew}
          onToggle={() => setShowNew(v => !v)}
          autoComplete="new-password"
          autoFocus
        />

        <PasswordInput
          label="Confirm password"
          value={confirmPassword}
          onChange={setConfirmPassword}
          placeholder="Confirm new password"
          visible={showConfirm}
          onToggle={() => setShowConfirm(v => !v)}
          autoComplete="new-password"
        />

        {error && (
          <p style={{ fontSize: 12, color: colors.red, textAlign: 'center', margin: 0 }}>
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={loading}
          style={{
            padding: '10px 14px', background: loading ? colors.surfaceHover : colors.accent,
            color: '#fff', borderRadius: 6, fontSize: 13, fontWeight: 600, marginTop: 4,
            opacity: loading ? 0.7 : 1, cursor: loading ? 'wait' : 'pointer', border: 'none',
            width: '100%', fontFamily: fonts.sans,
          }}
        >
          {loading ? 'Updating...' : 'Set new password'}
        </button>

        <LinkButton onClick={() => navigate('/login')}>Back to sign in</LinkButton>
      </form>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: colors.bg }}>
      <div style={{
        background: colors.surface, border: `1px solid ${colors.border}`,
        borderRadius: 10, padding: 32, width: 380,
      }}>
        {children}
      </div>
    </div>
  );
}

function PasswordInput({ label, value, onChange, placeholder, visible, onToggle, autoComplete, autoFocus }: {
  label: string; value: string; onChange: (v: string) => void;
  placeholder: string; visible: boolean; onToggle: () => void;
  autoComplete?: string; autoFocus?: boolean;
}) {
  return (
    <div>
      <label style={{ fontSize: 11, fontWeight: 600, color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        {label}
      </label>
      <div style={{ position: 'relative', marginTop: 6 }}>
        <input
          type={visible ? 'text' : 'password'}
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          autoFocus={autoFocus}
          autoComplete={autoComplete}
          style={{
            display: 'block', width: '100%', padding: '8px 36px 8px 12px',
            background: colors.surfaceRaised, border: `1px solid ${colors.border}`,
            borderRadius: 6, color: colors.text, fontSize: 13, fontFamily: fonts.sans,
            boxSizing: 'border-box',
          }}
        />
        <button
          type="button"
          onClick={onToggle}
          tabIndex={-1}
          style={{
            position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
            background: 'none', border: 'none', padding: 4, cursor: 'pointer',
            color: colors.textMuted, display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
          aria-label={visible ? 'Hide password' : 'Show password'}
        >
          {visible ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
              <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
              <line x1="1" y1="1" x2="23" y2="23" />
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          )}
        </button>
      </div>
    </div>
  );
}

function LinkButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        fontSize: 12, color: colors.accent, background: 'none',
        cursor: 'pointer', border: 'none', textAlign: 'center',
        fontFamily: fonts.sans, padding: 0,
      }}
    >
      {children}
    </button>
  );
}
