import React, { useState } from 'react';
import { useWorkspace } from '../context/WorkspaceContext';
import { verifyWorkspace, setApiCredentials } from '../lib/api';
import { colors, fonts } from '../styles/theme';

export default function LoginPage() {
  const { setWorkspace } = useWorkspace();
  const [workspaceId, setWorkspaceId] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!workspaceId.trim() || !apiKey.trim()) {
      setError('Both fields are required');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const { name } = await verifyWorkspace(workspaceId.trim(), apiKey.trim());
      setApiCredentials(workspaceId.trim(), apiKey.trim());
      setWorkspace({
        workspaceId: workspaceId.trim(),
        workspaceName: name,
        apiKey: apiKey.trim(),
      });
    } catch {
      setError('Invalid workspace ID or API key');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      height: '100vh',
      background: colors.bg,
    }}>
      <form onSubmit={handleSubmit} style={{
        background: colors.surface,
        border: `1px solid ${colors.border}`,
        borderRadius: 10,
        padding: 32,
        width: 380,
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
      }}>
        <div style={{ textAlign: 'center', marginBottom: 8 }}>
          <h1 style={{
            fontSize: 20,
            fontWeight: 700,
            color: colors.text,
            fontFamily: fonts.sans,
            letterSpacing: '-0.02em',
          }}>
            Pandora
          </h1>
          <p style={{ fontSize: 12, color: colors.textMuted, marginTop: 4 }}>
            Connect to your workspace
          </p>
        </div>

        <div>
          <label style={{ fontSize: 11, fontWeight: 600, color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Workspace ID
          </label>
          <input
            type="text"
            value={workspaceId}
            onChange={e => setWorkspaceId(e.target.value)}
            placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
            style={{
              display: 'block',
              width: '100%',
              marginTop: 6,
              padding: '8px 12px',
              background: colors.surfaceRaised,
              border: `1px solid ${colors.border}`,
              borderRadius: 6,
              color: colors.text,
              fontSize: 13,
              fontFamily: fonts.mono,
            }}
          />
        </div>

        <div>
          <label style={{ fontSize: 11, fontWeight: 600, color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            API Key
          </label>
          <input
            type="password"
            value={apiKey}
            onChange={e => setApiKey(e.target.value)}
            placeholder="Your workspace API key"
            style={{
              display: 'block',
              width: '100%',
              marginTop: 6,
              padding: '8px 12px',
              background: colors.surfaceRaised,
              border: `1px solid ${colors.border}`,
              borderRadius: 6,
              color: colors.text,
              fontSize: 13,
              fontFamily: fonts.mono,
            }}
          />
        </div>

        {error && (
          <p style={{ fontSize: 12, color: colors.red, textAlign: 'center' }}>
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={loading}
          style={{
            padding: '10px 14px',
            background: loading ? colors.surfaceHover : colors.accent,
            color: '#fff',
            borderRadius: 6,
            fontSize: 13,
            fontWeight: 600,
            marginTop: 4,
            opacity: loading ? 0.7 : 1,
          }}
        >
          {loading ? 'Connecting...' : 'Connect'}
        </button>
      </form>
    </div>
  );
}
