import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useWorkspace } from '../context/WorkspaceContext';
import { colors, fonts } from '../styles/theme';

type Mode = 'choose' | 'create' | 'join';

export default function JoinWorkspace() {
  const { joinWorkspace, selectWorkspace, refreshAuth } = useWorkspace();
  const navigate = useNavigate();
  const [mode, setMode] = useState<Mode>('choose');
  const [apiKey, setApiKey] = useState('');
  const [workspaceName, setWorkspaceName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleJoin = async (e: React.FormEvent) => {
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

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!workspaceName.trim()) { setError('Workspace name is required'); return; }
    setLoading(true);
    setError('');
    try {
      const token = localStorage.getItem('pandora_session');
      const res = await fetch('/api/auth/workspaces/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ name: workspaceName.trim() }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to create workspace');
      }
      const ws = await res.json();
      await refreshAuth();
      selectWorkspace({ id: ws.id, name: ws.name, slug: ws.slug, role: 'admin', connector_count: 0, deal_count: 0, last_sync: null });
      navigate('/');
    } catch (err: any) {
      setError(err.message || 'Failed to create workspace');
    } finally {
      setLoading(false);
    }
  };

  const cardStyle: React.CSSProperties = {
    background: colors.surface,
    border: `1px solid ${colors.border}`,
    borderRadius: 10,
    padding: 32,
    width: 400,
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
  };

  const inputStyle: React.CSSProperties = {
    display: 'block',
    width: '100%',
    marginTop: 6,
    padding: '10px 12px',
    background: colors.surfaceRaised,
    border: `1px solid ${colors.border}`,
    borderRadius: 6,
    color: colors.text,
    fontSize: 14,
    fontFamily: fonts.sans,
    boxSizing: 'border-box',
  };

  const btnStyle = (primary: boolean, disabled: boolean): React.CSSProperties => ({
    padding: '10px 14px',
    background: disabled ? colors.surfaceHover : primary ? colors.accent : colors.surfaceRaised,
    color: primary ? '#fff' : colors.text,
    borderRadius: 6,
    fontSize: 14,
    fontWeight: 600,
    border: primary ? 'none' : `1px solid ${colors.border}`,
    cursor: disabled ? 'wait' : 'pointer',
    opacity: disabled ? 0.7 : 1,
    fontFamily: fonts.sans,
    width: '100%',
  });

  if (mode === 'choose') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: colors.bg, fontFamily: fonts.sans }}>
        <div style={cardStyle}>
          <div style={{ textAlign: 'center', marginBottom: 8 }}>
            <h1 style={{ fontSize: 20, fontWeight: 700, color: colors.text, letterSpacing: '-0.02em' }}>Get Started</h1>
            <p style={{ fontSize: 13, color: colors.textMuted, marginTop: 4 }}>Create a new workspace or join an existing one</p>
          </div>
          <button onClick={() => setMode('create')} style={btnStyle(true, false)}>
            Create New Workspace
          </button>
          <button onClick={() => setMode('join')} style={btnStyle(false, false)}>
            Join with API Key
          </button>
        </div>
      </div>
    );
  }

  if (mode === 'create') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: colors.bg, fontFamily: fonts.sans }}>
        <form onSubmit={handleCreate} style={cardStyle}>
          <div style={{ textAlign: 'center', marginBottom: 8 }}>
            <h1 style={{ fontSize: 20, fontWeight: 700, color: colors.text, letterSpacing: '-0.02em' }}>Create Workspace</h1>
            <p style={{ fontSize: 13, color: colors.textMuted, marginTop: 4 }}>You'll be the admin of this workspace</p>
          </div>
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: colors.textSecondary }}>Workspace Name</label>
            <input type="text" value={workspaceName} onChange={e => setWorkspaceName(e.target.value)} placeholder="e.g. Acme Corp" autoFocus style={inputStyle} />
          </div>
          {error && <p style={{ fontSize: 12, color: colors.red, textAlign: 'center' }}>{error}</p>}
          <button type="submit" disabled={loading} style={btnStyle(true, loading)}>
            {loading ? 'Creating...' : 'Create Workspace'}
          </button>
          <button type="button" onClick={() => { setMode('choose'); setError(''); }} style={{ ...btnStyle(false, false), marginTop: -8 }}>
            Back
          </button>
        </form>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: colors.bg, fontFamily: fonts.sans }}>
      <form onSubmit={handleJoin} style={cardStyle}>
        <div style={{ textAlign: 'center', marginBottom: 8 }}>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: colors.text, letterSpacing: '-0.02em' }}>Join a Workspace</h1>
          <p style={{ fontSize: 13, color: colors.textMuted, marginTop: 4 }}>Enter a workspace API key to get access</p>
        </div>
        <div>
          <label style={{ fontSize: 12, fontWeight: 600, color: colors.textSecondary }}>API Key</label>
          <input type="password" value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder="Workspace API key" autoFocus style={inputStyle} />
        </div>
        {error && <p style={{ fontSize: 12, color: colors.red, textAlign: 'center' }}>{error}</p>}
        <button type="submit" disabled={loading} style={btnStyle(true, loading)}>
          {loading ? 'Joining...' : 'Join Workspace'}
        </button>
        <button type="button" onClick={() => { setMode('choose'); setError(''); }} style={{ ...btnStyle(false, false), marginTop: -8 }}>
          Back
        </button>
      </form>
    </div>
  );
}
