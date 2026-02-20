import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { colors, fonts } from '../../styles/theme';
import Toast from '../Toast';

type PasswordStrength = 'weak' | 'fair' | 'strong';

function evaluatePasswordStrength(password: string): PasswordStrength {
  if (password.length < 8) return 'weak';

  const hasUpper = /[A-Z]/.test(password);
  const hasLower = /[a-z]/.test(password);
  const hasNumber = /[0-9]/.test(password);
  const hasSpecial = /[^A-Za-z0-9]/.test(password);

  const criteriaMet = [hasUpper, hasLower, hasNumber, hasSpecial].filter(Boolean).length;

  if (criteriaMet >= 3) return 'strong';
  return 'fair';
}

export default function SecurityTab() {
  const navigate = useNavigate();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [currentPasswordError, setCurrentPasswordError] = useState('');
  const [confirmPasswordError, setConfirmPasswordError] = useState('');
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);

  const passwordStrength = evaluatePasswordStrength(newPassword);

  const strengthConfig = {
    weak: { color: colors.red, bg: colors.redSoft, label: 'Weak', width: '33%' },
    fair: { color: colors.yellow, bg: colors.yellowSoft, label: 'Fair', width: '66%' },
    strong: { color: colors.green, bg: colors.greenSoft, label: 'Strong', width: '100%' },
  };

  const handlePasswordChange = async () => {
    // Reset errors
    setCurrentPasswordError('');
    setConfirmPasswordError('');

    // Validation
    if (!currentPassword || !newPassword || !confirmPassword) {
      setToast({ message: 'All fields are required', type: 'error' });
      return;
    }

    if (newPassword.length < 8) {
      setToast({ message: 'New password must be at least 8 characters', type: 'error' });
      return;
    }

    if (newPassword !== confirmPassword) {
      setConfirmPasswordError('Passwords do not match');
      return;
    }

    try {
      setSubmitting(true);
      const token = localStorage.getItem('pandora_token');
      const res = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ currentPassword, newPassword }),
      });

      if (!res.ok) {
        const error = await res.json();
        if (res.status === 401) {
          setCurrentPasswordError('Current password is incorrect');
          return;
        }
        throw new Error(error.error || 'Failed to change password');
      }

      // Clear fields and show success
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setToast({ message: "Password updated. You'll be signed out of other devices.", type: 'success' });
    } catch (err) {
      console.error('Failed to change password:', err);
      setToast({ message: err instanceof Error ? err.message : 'Failed to change password', type: 'error' });
    } finally {
      setSubmitting(false);
    }
  };

  const handleLogoutAll = async () => {
    try {
      const token = localStorage.getItem('pandora_token');
      const res = await fetch('/api/auth/logout-all', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      if (!res.ok) {
        throw new Error('Failed to logout');
      }

      // Clear local storage and redirect
      localStorage.removeItem('pandora_token');
      localStorage.removeItem('pandora_last_workspace');
      navigate('/login?reason=signed_out_all');
    } catch (err) {
      console.error('Failed to logout all:', err);
      setToast({ message: 'Failed to sign out', type: 'error' });
    }
  };

  return (
    <div style={{ maxWidth: 600, fontFamily: fonts.sans }}>
      <h1 style={{ fontSize: 24, fontWeight: 600, color: colors.text, marginBottom: 8 }}>
        Security
      </h1>
      <p style={{ fontSize: 14, color: colors.textSecondary, marginBottom: 32 }}>
        Manage your password and active sessions
      </p>

      {/* SECTION 1: Change Password */}
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
          Change Password
        </h2>

        {/* Current Password */}
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
            Current Password
          </label>
          <div style={{ position: 'relative' }}>
            <input
              type={showCurrentPassword ? 'text' : 'password'}
              value={currentPassword}
              onChange={e => {
                setCurrentPassword(e.target.value);
                setCurrentPasswordError('');
              }}
              style={{
                width: '100%',
                padding: '10px 40px 10px 12px',
                fontSize: 14,
                fontFamily: fonts.sans,
                color: colors.text,
                background: colors.surfaceRaised,
                border: `1px solid ${currentPasswordError ? colors.red : colors.border}`,
                borderRadius: 6,
                outline: 'none',
              }}
              onFocus={e => {
                if (!currentPasswordError) e.target.style.borderColor = colors.borderFocus;
              }}
              onBlur={e => {
                if (!currentPasswordError) e.target.style.borderColor = colors.border;
              }}
            />
            <button
              type="button"
              onClick={() => setShowCurrentPassword(!showCurrentPassword)}
              style={{
                position: 'absolute',
                right: 10,
                top: '50%',
                transform: 'translateY(-50%)',
                background: 'transparent',
                border: 'none',
                color: colors.textMuted,
                fontSize: 12,
                cursor: 'pointer',
                fontFamily: fonts.sans,
              }}
            >
              {showCurrentPassword ? 'Hide' : 'Show'}
            </button>
          </div>
          {currentPasswordError && (
            <p style={{ fontSize: 12, color: colors.red, marginTop: 4 }}>
              {currentPasswordError}
            </p>
          )}
        </div>

        {/* New Password */}
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
            New Password
          </label>
          <div style={{ position: 'relative' }}>
            <input
              type={showNewPassword ? 'text' : 'password'}
              value={newPassword}
              onChange={e => setNewPassword(e.target.value)}
              style={{
                width: '100%',
                padding: '10px 40px 10px 12px',
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
            <button
              type="button"
              onClick={() => setShowNewPassword(!showNewPassword)}
              style={{
                position: 'absolute',
                right: 10,
                top: '50%',
                transform: 'translateY(-50%)',
                background: 'transparent',
                border: 'none',
                color: colors.textMuted,
                fontSize: 12,
                cursor: 'pointer',
                fontFamily: fonts.sans,
              }}
            >
              {showNewPassword ? 'Hide' : 'Show'}
            </button>
          </div>

          {/* Password Strength Indicator */}
          {newPassword && (
            <div style={{ marginTop: 8 }}>
              <div
                style={{
                  height: 3,
                  background: colors.surfaceHover,
                  borderRadius: 2,
                  overflow: 'hidden',
                  marginBottom: 4,
                }}
              >
                <div
                  style={{
                    height: '100%',
                    width: strengthConfig[passwordStrength].width,
                    background: strengthConfig[passwordStrength].color,
                    transition: 'width 0.3s, background 0.3s',
                  }}
                />
              </div>
              <p
                style={{
                  fontSize: 12,
                  color: strengthConfig[passwordStrength].color,
                  fontWeight: 500,
                }}
              >
                {strengthConfig[passwordStrength].label}
              </p>
            </div>
          )}
        </div>

        {/* Confirm Password */}
        <div style={{ marginBottom: 24 }}>
          <label
            style={{
              display: 'block',
              fontSize: 13,
              fontWeight: 500,
              color: colors.text,
              marginBottom: 6,
            }}
          >
            Confirm New Password
          </label>
          <div style={{ position: 'relative' }}>
            <input
              type={showConfirmPassword ? 'text' : 'password'}
              value={confirmPassword}
              onChange={e => {
                setConfirmPassword(e.target.value);
                setConfirmPasswordError('');
              }}
              style={{
                width: '100%',
                padding: '10px 40px 10px 12px',
                fontSize: 14,
                fontFamily: fonts.sans,
                color: colors.text,
                background: colors.surfaceRaised,
                border: `1px solid ${confirmPasswordError ? colors.red : colors.border}`,
                borderRadius: 6,
                outline: 'none',
              }}
              onFocus={e => {
                if (!confirmPasswordError) e.target.style.borderColor = colors.borderFocus;
              }}
              onBlur={e => {
                if (!confirmPasswordError) e.target.style.borderColor = colors.border;
              }}
            />
            <button
              type="button"
              onClick={() => setShowConfirmPassword(!showConfirmPassword)}
              style={{
                position: 'absolute',
                right: 10,
                top: '50%',
                transform: 'translateY(-50%)',
                background: 'transparent',
                border: 'none',
                color: colors.textMuted,
                fontSize: 12,
                cursor: 'pointer',
                fontFamily: fonts.sans,
              }}
            >
              {showConfirmPassword ? 'Hide' : 'Show'}
            </button>
          </div>
          {confirmPasswordError && (
            <p style={{ fontSize: 12, color: colors.red, marginTop: 4 }}>
              {confirmPasswordError}
            </p>
          )}
        </div>

        {/* Submit Button */}
        <button
          onClick={handlePasswordChange}
          disabled={submitting}
          style={{
            padding: '10px 20px',
            fontSize: 14,
            fontWeight: 500,
            fontFamily: fonts.sans,
            color: '#fff',
            background: submitting ? colors.surfaceHover : colors.accent,
            border: 'none',
            borderRadius: 6,
            cursor: submitting ? 'not-allowed' : 'pointer',
            transition: 'background 0.2s',
          }}
        >
          {submitting ? 'Updating...' : 'Update Password'}
        </button>
      </div>

      {/* SECTION 2: Active Sessions */}
      <div
        style={{
          background: colors.surface,
          border: `1px solid ${colors.border}`,
          borderRadius: 8,
          padding: 32,
        }}
      >
        <h2 style={{ fontSize: 16, fontWeight: 600, color: colors.text, marginBottom: 16 }}>
          Active Sessions
        </h2>

        <p style={{ fontSize: 14, color: colors.textSecondary, marginBottom: 20 }}>
          Signing out of all devices will revoke all active sessions. You'll need to sign in again on each device.
        </p>

        {!showLogoutConfirm ? (
          <button
            onClick={() => setShowLogoutConfirm(true)}
            style={{
              padding: '10px 20px',
              fontSize: 14,
              fontWeight: 500,
              fontFamily: fonts.sans,
              color: colors.red,
              background: colors.redSoft,
              border: `1px solid ${colors.red}`,
              borderRadius: 6,
              cursor: 'pointer',
              transition: 'background 0.2s',
            }}
          >
            Sign Out All Devices
          </button>
        ) : (
          <div
            style={{
              padding: 16,
              background: colors.redSoft,
              border: `1px solid ${colors.red}`,
              borderRadius: 6,
            }}
          >
            <p style={{ fontSize: 14, color: colors.red, marginBottom: 12, fontWeight: 500 }}>
              Are you sure? This will sign you out everywhere.
            </p>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={handleLogoutAll}
                style={{
                  padding: '8px 16px',
                  fontSize: 13,
                  fontWeight: 500,
                  fontFamily: fonts.sans,
                  color: '#fff',
                  background: colors.red,
                  border: 'none',
                  borderRadius: 6,
                  cursor: 'pointer',
                }}
              >
                Confirm
              </button>
              <button
                onClick={() => setShowLogoutConfirm(false)}
                style={{
                  padding: '8px 16px',
                  fontSize: 13,
                  fontWeight: 500,
                  fontFamily: fonts.sans,
                  color: colors.text,
                  background: colors.surfaceRaised,
                  border: `1px solid ${colors.border}`,
                  borderRadius: 6,
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
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
