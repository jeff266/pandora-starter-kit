import React, { useState, useEffect, useCallback } from 'react';
import { colors, fonts } from '../../styles/theme';
import { api } from '../../lib/api';

interface ProviderConfig {
  apiKey?: string;
  baseURL?: string;
  enabled?: boolean;
}

interface LLMConfig {
  providers: Record<string, ProviderConfig>;
}

interface ProviderMeta {
  key: string;
  label: string;
  placeholder: string;
  docsUrl: string;
  defaultBaseURL?: string;
}

const PROVIDERS: ProviderMeta[] = [
  {
    key: 'anthropic',
    label: 'Anthropic',
    placeholder: 'sk-ant-...',
    docsUrl: 'https://console.anthropic.com/settings/keys',
  },
  {
    key: 'openai',
    label: 'OpenAI',
    placeholder: 'sk-...',
    docsUrl: 'https://platform.openai.com/api-keys',
  },
  {
    key: 'fireworks',
    label: 'Fireworks AI',
    placeholder: 'fw-...',
    docsUrl: 'https://fireworks.ai/account/api-keys',
  },
  {
    key: 'google',
    label: 'Google (Gemini)',
    placeholder: 'AIza...',
    docsUrl: 'https://aistudio.google.com/app/apikey',
  },
];

function maskKey(key: string): string {
  if (!key || key.length < 8) return key;
  return key.slice(0, 6) + '••••••••' + key.slice(-4);
}

interface ProviderState {
  apiKey: string;
  baseURL: string;
  enabled: boolean;
  revealed: boolean;
  dirty: boolean;
}

export default function AIKeysTab() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [providers, setProviders] = useState<Record<string, ProviderState>>(() =>
    Object.fromEntries(
      PROVIDERS.map(p => [p.key, { apiKey: '', baseURL: '', enabled: false, revealed: false, dirty: false }])
    )
  );

  const loadConfig = useCallback(async () => {
    try {
      setLoading(true);
      const config: LLMConfig = await api.get('/llm/config');
      setProviders(prev => {
        const next = { ...prev };
        for (const p of PROVIDERS) {
          const serverCfg = config.providers?.[p.key] ?? {};
          next[p.key] = {
            apiKey: serverCfg.apiKey ?? '',
            baseURL: serverCfg.baseURL ?? '',
            enabled: serverCfg.enabled ?? false,
            revealed: false,
            dirty: false,
          };
        }
        return next;
      });
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load config');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  const handleChange = (providerKey: string, field: keyof ProviderState, value: string | boolean) => {
    setProviders(prev => ({
      ...prev,
      [providerKey]: { ...prev[providerKey], [field]: value, dirty: true },
    }));
    setSuccessMsg(null);
  };

  const handleSave = async (providerKey: string) => {
    setSaving(providerKey);
    setError(null);
    try {
      const currentProviders: Record<string, ProviderConfig> = {};
      for (const p of PROVIDERS) {
        const s = providers[p.key];
        currentProviders[p.key] = {
          enabled: s.enabled,
          ...(s.apiKey ? { apiKey: s.apiKey } : {}),
          ...(s.baseURL ? { baseURL: s.baseURL } : {}),
        };
      }
      await api.post('/llm/config', { providers: currentProviders });
      setProviders(prev => ({
        ...prev,
        [providerKey]: { ...prev[providerKey], dirty: false },
      }));
      setSuccessMsg(`${PROVIDERS.find(p => p.key === providerKey)?.label} key saved`);
      setTimeout(() => setSuccessMsg(null), 3000);
    } catch (e: any) {
      setError(e?.message ?? 'Failed to save');
    } finally {
      setSaving(null);
    }
  };

  const isConnected = (pKey: string) => {
    const s = providers[pKey];
    return s.enabled && !!s.apiKey;
  };

  if (loading) {
    return (
      <div style={{ color: colors.textMuted, fontFamily: fonts.sans, fontSize: 13, paddingTop: 40, textAlign: 'center' }}>
        Loading AI key configuration…
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 680, fontFamily: fonts.sans }}>
      <h1 style={{ fontSize: 22, fontWeight: 600, color: colors.text, marginBottom: 6 }}>AI Keys</h1>
      <p style={{ fontSize: 13, color: colors.textSecondary, marginBottom: 8, lineHeight: 1.6 }}>
        Provide your own API keys to route AI usage to your account (BYOK). Usage via your keys appears as{' '}
        <span style={{ color: colors.green, fontWeight: 500 }}>BYOK</span> on the Token Usage page and is billed
        directly by the provider — not through Pandora infrastructure.
      </p>
      <p style={{ fontSize: 12, color: colors.textMuted, marginBottom: 28 }}>
        Keys are stored encrypted and used only within this workspace.
      </p>

      {error && (
        <div style={{
          background: colors.redSoft,
          border: `1px solid ${colors.red}`,
          borderRadius: 6,
          padding: '10px 14px',
          fontSize: 13,
          color: colors.red,
          marginBottom: 20,
        }}>
          {error}
        </div>
      )}

      {successMsg && (
        <div style={{
          background: colors.greenSoft,
          border: `1px solid ${colors.green}`,
          borderRadius: 6,
          padding: '10px 14px',
          fontSize: 13,
          color: colors.green,
          marginBottom: 20,
        }}>
          {successMsg}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {PROVIDERS.map(provider => {
          const state = providers[provider.key];
          const connected = isConnected(provider.key);
          const isSaving = saving === provider.key;

          return (
            <div
              key={provider.key}
              style={{
                background: colors.surface,
                border: `1px solid ${connected ? colors.green : colors.border}`,
                borderRadius: 8,
                padding: '18px 20px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 14, fontWeight: 600, color: colors.text }}>{provider.label}</span>
                  {connected ? (
                    <span style={{
                      fontSize: 9,
                      color: colors.green,
                      background: colors.greenSoft,
                      padding: '2px 7px',
                      borderRadius: 3,
                      letterSpacing: '0.1em',
                      fontWeight: 600,
                    }}>
                      CONNECTED
                    </span>
                  ) : (
                    <span style={{
                      fontSize: 9,
                      color: colors.textMuted,
                      background: colors.surfaceRaised,
                      padding: '2px 7px',
                      borderRadius: 3,
                      letterSpacing: '0.1em',
                    }}>
                      NOT CONFIGURED
                    </span>
                  )}
                </div>

                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                  <span style={{ fontSize: 12, color: colors.textSecondary }}>Enabled</span>
                  <div
                    onClick={() => handleChange(provider.key, 'enabled', !state.enabled)}
                    style={{
                      width: 36,
                      height: 20,
                      borderRadius: 10,
                      background: state.enabled ? colors.accent : colors.border,
                      position: 'relative',
                      cursor: 'pointer',
                      transition: 'background 0.2s',
                      flexShrink: 0,
                    }}
                  >
                    <div style={{
                      width: 14,
                      height: 14,
                      borderRadius: '50%',
                      background: colors.text,
                      position: 'absolute',
                      top: 3,
                      left: state.enabled ? 19 : 3,
                      transition: 'left 0.2s',
                    }} />
                  </div>
                </label>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div>
                  <label style={{ fontSize: 11, color: colors.textMuted, letterSpacing: '0.08em', display: 'block', marginBottom: 5 }}>
                    API KEY
                  </label>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input
                      type={state.revealed ? 'text' : 'password'}
                      value={state.apiKey}
                      onChange={e => handleChange(provider.key, 'apiKey', e.target.value)}
                      placeholder={provider.placeholder}
                      style={{
                        flex: 1,
                        background: colors.bg,
                        border: `1px solid ${colors.border}`,
                        borderRadius: 5,
                        padding: '8px 10px',
                        fontSize: 13,
                        color: colors.text,
                        fontFamily: fonts.mono,
                        outline: 'none',
                      }}
                    />
                    <button
                      onClick={() => handleChange(provider.key, 'revealed', !state.revealed)}
                      style={{
                        padding: '8px 12px',
                        background: colors.surfaceRaised,
                        border: `1px solid ${colors.border}`,
                        borderRadius: 5,
                        color: colors.textSecondary,
                        fontSize: 11,
                        cursor: 'pointer',
                        whiteSpace: 'nowrap',
                        fontFamily: fonts.sans,
                      }}
                    >
                      {state.revealed ? 'Hide' : 'Show'}
                    </button>
                  </div>
                  <a
                    href={provider.docsUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ fontSize: 11, color: colors.accent, marginTop: 4, display: 'inline-block' }}
                  >
                    Get API key →
                  </a>
                </div>

                <div>
                  <label style={{ fontSize: 11, color: colors.textMuted, letterSpacing: '0.08em', display: 'block', marginBottom: 5 }}>
                    BASE URL OVERRIDE <span style={{ color: colors.textDim, fontWeight: 400 }}>(optional)</span>
                  </label>
                  <input
                    type="text"
                    value={state.baseURL}
                    onChange={e => handleChange(provider.key, 'baseURL', e.target.value)}
                    placeholder="https://api.example.com/v1"
                    style={{
                      width: '100%',
                      boxSizing: 'border-box',
                      background: colors.bg,
                      border: `1px solid ${colors.border}`,
                      borderRadius: 5,
                      padding: '8px 10px',
                      fontSize: 13,
                      color: colors.text,
                      fontFamily: fonts.mono,
                      outline: 'none',
                    }}
                  />
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: 4 }}>
                  <button
                    onClick={() => handleSave(provider.key)}
                    disabled={isSaving || !state.dirty}
                    style={{
                      padding: '8px 18px',
                      background: state.dirty ? colors.accent : colors.surfaceRaised,
                      border: `1px solid ${state.dirty ? colors.accent : colors.border}`,
                      borderRadius: 5,
                      color: state.dirty ? '#fff' : colors.textMuted,
                      fontSize: 13,
                      fontWeight: 500,
                      cursor: state.dirty && !isSaving ? 'pointer' : 'default',
                      fontFamily: fonts.sans,
                      transition: 'background 0.15s, color 0.15s',
                    }}
                  >
                    {isSaving ? 'Saving…' : 'Save'}
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
