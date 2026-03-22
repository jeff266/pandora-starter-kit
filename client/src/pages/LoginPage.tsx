import React, { useState } from 'react';
import { useWorkspace } from '../context/WorkspaceContext';
import { colors, fonts } from '../styles/theme';
import { api } from '../lib/api';

type Screen = 'email' | 'name' | 'join' | 'forgot' | 'forgot-sent';

export default function LoginPage() {
  const { login, joinWorkspace, isAuthenticated, workspaces, selectWorkspace } = useWorkspace();
  const [screen, setScreen] = useState<Screen>('email');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  if (isAuthenticated && workspaces.length === 0) {
    return <JoinScreen
      apiKey={apiKey}
      setApiKey={setApiKey}
      error={error}
      loading={loading}
      onJoin={async () => {
        if (!apiKey.trim()) { setError('API key is required'); return; }
        setLoading(true); setError('');
        try {
          const ws = await joinWorkspace(apiKey.trim());
          selectWorkspace(ws);
        } catch (err: any) {
          setError(err.message || 'Failed to join workspace');
        } finally { setLoading(false); }
      }}
    />;
  }

  if (isAuthenticated && workspaces.length > 0) {
    return <WorkspacePicker
      workspaces={workspaces}
      onSelect={selectWorkspace}
      onJoin={() => setScreen('join')}
    />;
  }

  if (screen === 'join') {
    return <JoinScreen
      apiKey={apiKey}
      setApiKey={setApiKey}
      error={error}
      loading={loading}
      onJoin={async () => {
        if (!apiKey.trim()) { setError('API key is required'); return; }
        setLoading(true); setError('');
        try {
          const ws = await joinWorkspace(apiKey.trim());
          selectWorkspace(ws);
        } catch (err: any) {
          setError(err.message || 'Failed to join workspace');
        } finally { setLoading(false); }
      }}
      onBack={() => setScreen('email')}
    />;
  }

  if (screen === 'forgot') {
    return (
      <Shell>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ textAlign: 'center', marginBottom: 8 }}>
            <h1 style={{ fontSize: 18, fontWeight: 700, color: colors.text, fontFamily: fonts.sans }}>
              Reset your password
            </h1>
            <p style={{ fontSize: 12, color: colors.textMuted, marginTop: 4 }}>
              Enter your email and we'll send a reset link
            </p>
          </div>
          <Input
            label="Email"
            type="email"
            value={email}
            onChange={setEmail}
            placeholder="you@company.com"
            autoFocus
          />
          {error && <ErrorText>{error}</ErrorText>}
          <SubmitButton
            loading={loading}
            onClick={async () => {
              if (!email.trim()) { setError('Email is required'); return; }
              setLoading(true); setError('');
              try {
                await api.post('/auth/forgot-password', { email: email.trim() });
                setScreen('forgot-sent');
              } catch (err: any) {
                setError(err.message || 'Something went wrong. Please try again.');
              } finally {
                setLoading(false);
              }
            }}
          >
            Send reset link
          </SubmitButton>
          <button
            onClick={() => { setError(''); setScreen('email'); }}
            style={{ fontSize: 12, color: colors.accent, background: 'none', cursor: 'pointer', border: 'none', textAlign: 'center', fontFamily: fonts.sans }}
          >
            Back to sign in
          </button>
        </div>
      </Shell>
    );
  }

  if (screen === 'forgot-sent') {
    return (
      <Shell>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, textAlign: 'center' }}>
          <div style={{
            width: 48, height: 48, borderRadius: '50%',
            background: `${colors.accent}20`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            margin: '0 auto 8px',
            fontSize: 22,
          }}>
            ✉
          </div>
          <h1 style={{ fontSize: 18, fontWeight: 700, color: colors.text, fontFamily: fonts.sans, margin: 0 }}>
            Check your email
          </h1>
          <p style={{ fontSize: 13, color: colors.textMuted, lineHeight: 1.6, margin: 0 }}>
            If <strong style={{ color: colors.text }}>{email}</strong> is registered,
            you'll receive a reset link shortly. Check your spam folder if you don't see it.
          </p>
          <button
            onClick={() => { setError(''); setScreen('email'); }}
            style={{ fontSize: 12, color: colors.accent, background: 'none', cursor: 'pointer', border: 'none', textAlign: 'center', fontFamily: fonts.sans, marginTop: 4 }}
          >
            Back to sign in
          </button>
        </div>
      </Shell>
    );
  }

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) { setError('Email is required'); return; }
    if (!password) { setError('Password is required'); return; }
    setLoading(true); setError('');
    try {
      await login(email.trim(), password);
    } catch (err: any) {
      setError(err.message || 'Invalid email or password.');
    } finally { setLoading(false); }
  };

  const handleNameSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) { setError('Name is required'); return; }
    if (!password) { setError('Password is required'); return; }
    setLoading(true); setError('');
    try {
      await login(email.trim(), password, name.trim());
    } catch (err: any) {
      setError(err.message || 'Something went wrong. Please try again.');
    } finally { setLoading(false); }
  };

  if (screen === 'name') {
    return (
      <Shell>
        <form onSubmit={handleNameSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ textAlign: 'center', marginBottom: 8 }}>
            <h1 style={{ fontSize: 18, fontWeight: 700, color: colors.text }}>
              Welcome! What's your name?
            </h1>
            <p style={{ fontSize: 12, color: colors.textMuted, marginTop: 4 }}>
              We'll create your Pandora account
            </p>
          </div>
          <Input label="Name" value={name} onChange={setName} placeholder="Your full name" autoFocus />
          <PasswordInput
            label="Password"
            value={password}
            onChange={setPassword}
            placeholder="Choose a password"
            autoComplete="new-password"
          />
          {error && <ErrorText>{error}</ErrorText>}
          <SubmitButton loading={loading}>Create Account</SubmitButton>
        </form>
      </Shell>
    );
  }

  return (
    <Shell>
      <form onSubmit={handleEmailSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ textAlign: 'center', marginBottom: 8 }}>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: colors.text, fontFamily: fonts.sans, letterSpacing: '-0.02em' }}>
            Pandora
          </h1>
          <p style={{ fontSize: 12, color: colors.textMuted, marginTop: 4 }}>
            Sign in to your account
          </p>
        </div>
        <Input label="Email" type="email" value={email} onChange={setEmail} placeholder="you@company.com" autoFocus />
        <PasswordInput
          label="Password"
          value={password}
          onChange={setPassword}
          placeholder="Your password"
          autoComplete="current-password"
        />
        {error && <ErrorText>{error}</ErrorText>}
        <SubmitButton loading={loading}>Sign In</SubmitButton>
        <button
          type="button"
          onClick={() => { setError(''); setScreen('forgot'); }}
          style={{
            fontSize: 12, color: colors.accent, background: 'none',
            cursor: 'pointer', border: 'none', textAlign: 'center',
            fontFamily: fonts.sans, marginTop: -4,
          }}
        >
          Forgot password?
        </button>
      </form>
      <p style={{ textAlign: 'center', margin: '16px 0 0', fontSize: 12, color: colors.textMuted }}>
        <a href="/help" target="_blank" rel="noopener noreferrer" style={{ color: colors.accent, textDecoration: 'none' }}>
          Help & FAQ
        </a>
      </p>
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

function Input({ label, value, onChange, placeholder, type = 'text', autoFocus }: {
  label: string; value: string; onChange: (v: string) => void; placeholder: string; type?: string; autoFocus?: boolean;
}) {
  return (
    <div>
      <label style={{ fontSize: 11, fontWeight: 600, color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        {label}
      </label>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        autoFocus={autoFocus}
        autoComplete={type === 'email' ? 'email' : undefined}
        style={{
          display: 'block', width: '100%', marginTop: 6, padding: '8px 12px',
          background: colors.surfaceRaised, border: `1px solid ${colors.border}`,
          borderRadius: 6, color: colors.text, fontSize: 13, fontFamily: fonts.sans,
          boxSizing: 'border-box',
        }}
      />
    </div>
  );
}

function PasswordInput({ label, value, onChange, placeholder, autoComplete, autoFocus }: {
  label: string; value: string; onChange: (v: string) => void;
  placeholder: string; autoComplete?: string; autoFocus?: boolean;
}) {
  const [visible, setVisible] = useState(false);

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
          onClick={() => setVisible(v => !v)}
          tabIndex={-1}
          style={{
            position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
            background: 'none', border: 'none', padding: 4, cursor: 'pointer',
            color: colors.textMuted, display: 'flex', alignItems: 'center', justifyContent: 'center',
            lineHeight: 1,
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

function SubmitButton({ loading, children, onClick }: { loading: boolean; children: React.ReactNode; onClick?: () => void }) {
  return (
    <button
      type={onClick ? 'button' : 'submit'}
      disabled={loading}
      onClick={onClick}
      style={{
        padding: '10px 14px', background: loading ? colors.surfaceHover : colors.accent,
        color: '#fff', borderRadius: 6, fontSize: 13, fontWeight: 600, marginTop: 4,
        opacity: loading ? 0.7 : 1, cursor: loading ? 'wait' : 'pointer', border: 'none',
        width: '100%',
      }}
    >
      {loading ? 'Please wait...' : children}
    </button>
  );
}

function ErrorText({ children }: { children: React.ReactNode }) {
  return <p style={{ fontSize: 12, color: colors.red, textAlign: 'center', margin: 0 }}>{children}</p>;
}

function WorkspacePicker({ workspaces, onSelect, onJoin }: {
  workspaces: any[]; onSelect: (ws: any) => void; onJoin: () => void;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: colors.bg }}>
      <div style={{ width: 460 }}>
        <h1 style={{ fontSize: 18, fontWeight: 700, color: colors.text, marginBottom: 20, textAlign: 'center' }}>
          Select a Workspace
        </h1>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {workspaces.map(ws => (
            <div
              key={ws.id}
              onClick={() => onSelect(ws)}
              style={{
                background: colors.surface, border: `1px solid ${colors.border}`,
                borderRadius: 10, padding: '16px 18px', cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: 14, transition: 'border-color 0.15s',
              }}
              onMouseEnter={e => (e.currentTarget.style.borderColor = colors.accent)}
              onMouseLeave={e => (e.currentTarget.style.borderColor = colors.border)}
            >
              <div style={{
                width: 36, height: 36, borderRadius: 8, background: colors.accent,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 16, fontWeight: 700, color: '#fff', flexShrink: 0,
              }}>
                {ws.name.charAt(0).toUpperCase()}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: colors.text }}>{ws.name}</div>
                <div style={{ fontSize: 11, color: colors.textMuted, marginTop: 2 }}>
                  {ws.role} · {ws.deal_count} deals · {ws.connector_count} connectors
                </div>
              </div>
              <span style={{
                fontSize: 9, fontWeight: 600, padding: '2px 8px', borderRadius: 4,
                background: colors.accentSoft, color: colors.accent, textTransform: 'capitalize',
              }}>
                {ws.role}
              </span>
            </div>
          ))}
        </div>
        <button
          onClick={onJoin}
          style={{
            display: 'block', width: '100%', marginTop: 16, padding: '10px',
            background: 'none', border: `1px dashed ${colors.border}`, borderRadius: 8,
            color: colors.textMuted, fontSize: 13, cursor: 'pointer', textAlign: 'center',
          }}
          onMouseEnter={e => (e.currentTarget.style.borderColor = colors.accent)}
          onMouseLeave={e => (e.currentTarget.style.borderColor = colors.border)}
        >
          + Join Another Workspace
        </button>
      </div>
    </div>
  );
}

function JoinScreen({ apiKey, setApiKey, error, loading, onJoin, onBack }: {
  apiKey: string; setApiKey: (v: string) => void; error: string; loading: boolean;
  onJoin: () => void; onBack?: () => void;
}) {
  return (
    <Shell>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ textAlign: 'center', marginBottom: 8 }}>
          <h1 style={{ fontSize: 18, fontWeight: 700, color: colors.text }}>Join a Workspace</h1>
          <p style={{ fontSize: 12, color: colors.textMuted, marginTop: 4 }}>
            Enter the workspace API key to get access
          </p>
        </div>
        <Input label="Workspace API Key" value={apiKey} onChange={setApiKey} placeholder="Paste the API key" />
        {error && <ErrorText>{error}</ErrorText>}
        <button
          onClick={onJoin}
          disabled={loading}
          style={{
            padding: '10px 14px', background: loading ? colors.surfaceHover : colors.accent,
            color: '#fff', borderRadius: 6, fontSize: 13, fontWeight: 600,
            opacity: loading ? 0.7 : 1, cursor: loading ? 'wait' : 'pointer', border: 'none',
          }}
        >
          {loading ? 'Joining...' : 'Join'}
        </button>
        {onBack && (
          <button
            onClick={onBack}
            style={{ fontSize: 12, color: colors.accent, background: 'none', cursor: 'pointer', border: 'none', textAlign: 'center' }}
          >
            Back to sign in
          </button>
        )}
      </div>
    </Shell>
  );
}
