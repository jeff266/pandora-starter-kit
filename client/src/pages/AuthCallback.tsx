import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useWorkspace } from '../context/WorkspaceContext';
import { colors, fonts } from '../styles/theme';

export default function AuthCallback() {
  const navigate = useNavigate();
  const { handleCallback } = useWorkspace();
  const [error, setError] = useState('');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const session = params.get('session');
    if (!session) {
      setError('No session token found');
      return;
    }

    handleCallback(session)
      .then(() => navigate('/', { replace: true }))
      .catch(() => setError('Failed to sign in. Please try again.'));
  }, [handleCallback, navigate]);

  if (error) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        height: '100vh', background: colors.bg, flexDirection: 'column', gap: 16,
      }}>
        <p style={{ fontSize: 14, color: colors.red }}>{error}</p>
        <button
          onClick={() => navigate('/', { replace: true })}
          style={{
            padding: '8px 20px', background: colors.accent, color: '#fff',
            borderRadius: 6, fontSize: 13, fontWeight: 600, border: 'none', cursor: 'pointer',
          }}
        >
          Go to Login
        </button>
      </div>
    );
  }

  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      height: '100vh', background: colors.bg, fontFamily: fonts.sans,
    }}>
      <div style={{
        background: colors.surface, border: `1px solid ${colors.border}`,
        borderRadius: 10, padding: 32, width: 380, textAlign: 'center',
      }}>
        <div style={{
          width: 32, height: 32,
          border: `3px solid ${colors.border}`, borderTopColor: colors.accent,
          borderRadius: '50%', animation: 'spin 0.8s linear infinite',
          margin: '0 auto 16px',
        }} />
        <p style={{ fontSize: 14, color: colors.textSecondary }}>Signing you in...</p>
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
