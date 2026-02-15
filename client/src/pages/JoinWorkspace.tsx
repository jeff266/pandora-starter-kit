import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useWorkspace } from '../context/WorkspaceContext';
import { colors, fonts } from '../styles/theme';

export default function JoinWorkspace() {
  const { joinWorkspace, selectWorkspace } = useWorkspace();
  const navigate = useNavigate();
  const [apiKey, setApiKey] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!apiKey.trim()) { setError('API key is required'); return; }
    setLoading(true);
    setError('');
    try {
      const ws = await joinWorkspace(apiKey.trim());
      selectWorkspace(ws);
      navigate('/');
    } catch (err: any) {
      setError(err.message || 'Failed to join workspace');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: colors.bg, fontFamily: fonts.sans }}>
      <form onSubmit={handleSubmit} style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 10, padding: 32, width: 380, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ textAlign: 'center', marginBottom: 8 }}>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: colors.text, letterSpacing: '-0.02em' }}>Join a Workspace</h1>
          <p style={{ fontSize: 12, color: colors.textMuted, marginTop: 4 }}>Enter a workspace API key to get access</p>
        </div>
        <div>
          <label style={{ fontSize: 11, fontWeight: 600, color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: '0.05em' }}>API Key</label>
          <input type="password" value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder="Workspace API key" autoFocus
            style={{ display: 'block', width: '100%', marginTop: 6, padding: '8px 12px', background: colors.surfaceRaised, border: `1px solid ${colors.border}`, borderRadius: 6, color: colors.text, fontSize: 13, fontFamily: fonts.mono, boxSizing: 'border-box' }} />
        </div>
        {error && <p style={{ fontSize: 12, color: colors.red, textAlign: 'center' }}>{error}</p>}
        <button type="submit" disabled={loading}
          style={{ padding: '10px 14px', background: loading ? colors.surfaceHover : colors.accent, color: '#fff', borderRadius: 6, fontSize: 13, fontWeight: 600, marginTop: 4, opacity: loading ? 0.7 : 1, border: 'none', cursor: loading ? 'wait' : 'pointer' }}>
          {loading ? 'Joining...' : 'Join'}
        </button>
      </form>
    </div>
  );
}
