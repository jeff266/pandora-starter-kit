import React, { useState, useEffect, useCallback } from 'react';
import { colors, fonts } from '../../styles/theme';
import { api } from '../../lib/api';

interface ProviderConfig {
  apiKey?: string;
  baseURL?: string;
  enabled?: boolean;
}

interface LLMConfig {
  providers: Record<string, ProviderConfig & { connected?: boolean }>;
  routing: Record<string, string | { primary: string; fallback?: string }>;
}

interface ProviderMeta {
  key: string;
  label: string;
  placeholder: string;
  docsUrl: string;
}

const PROVIDERS: ProviderMeta[] = [
  { key: 'anthropic', label: 'Anthropic', placeholder: 'sk-ant-...', docsUrl: 'https://console.anthropic.com/settings/keys' },
  { key: 'openai', label: 'OpenAI', placeholder: 'sk-...', docsUrl: 'https://platform.openai.com/api-keys' },
  { key: 'google', label: 'Google (Gemini)', placeholder: 'AIza...', docsUrl: 'https://aistudio.google.com/app/apikey' },
  { key: 'fireworks', label: 'Fireworks AI', placeholder: 'fw-...', docsUrl: 'https://fireworks.ai/account/api-keys' },
  { key: 'perplexity', label: 'Perplexity', placeholder: 'pplx-...', docsUrl: 'https://www.perplexity.ai/settings/api' },
];

interface ModelEntry {
  id: string;
  label: string;
  provider: string;
  contextWindow: number;
  tier: 'reasoning' | 'fast' | 'search';
  costTier: 'high' | 'mid' | 'low';
  strengths: string;
  pandoraDefault?: boolean;
}

const MODEL_CATALOG: ModelEntry[] = [
  // Reasoning tier
  {
    id: 'anthropic/claude-sonnet-4-20250514',
    label: 'Claude Sonnet 4',
    provider: 'anthropic',
    contextWindow: 200_000,
    tier: 'reasoning',
    costTier: 'high',
    strengths: 'Pandora default. Best overall for narrative generation, deal analysis, and structured reasoning.',
    pandoraDefault: true,
  },
  {
    id: 'anthropic/claude-opus-4-20250514',
    label: 'Claude Opus 4',
    provider: 'anthropic',
    contextWindow: 200_000,
    tier: 'reasoning',
    costTier: 'high',
    strengths: 'Most capable Claude model. Ideal for the highest-stakes analysis where quality matters most.',
  },
  {
    id: 'google/gemini-2.5-pro',
    label: 'Gemini 2.5 Pro',
    provider: 'google',
    contextWindow: 1_048_576,
    tier: 'reasoning',
    costTier: 'high',
    strengths: 'Largest context window (1M tokens). Excellent for very long documents and multi-deal analysis.',
  },
  {
    id: 'openai/gpt-4.1',
    label: 'GPT-4.1',
    provider: 'openai',
    contextWindow: 1_048_576,
    tier: 'reasoning',
    costTier: 'high',
    strengths: 'Strong instruction-following and structured output. 1M context. Excellent for document-heavy workflows.',
  },
  {
    id: 'fireworks/deepseek-r1',
    label: 'DeepSeek R1',
    provider: 'fireworks',
    contextWindow: 131_072,
    tier: 'reasoning',
    costTier: 'low',
    strengths: 'Reasoning-specialized. Strong on forecasting and scoring tasks at ~1/5th the cost of Claude.',
  },
  // Fast tier
  {
    id: 'fireworks/deepseek-v3-0324',
    label: 'DeepSeek V3',
    provider: 'fireworks',
    contextWindow: 131_072,
    tier: 'fast',
    costTier: 'low',
    strengths: 'Pandora default for extraction. Fast and cost-efficient for classification and data extraction.',
    pandoraDefault: true,
  },
  {
    id: 'google/gemini-2.0-flash',
    label: 'Gemini 2.0 Flash',
    provider: 'google',
    contextWindow: 1_048_576,
    tier: 'fast',
    costTier: 'low',
    strengths: 'Fastest Gemini model. Ideal for high-volume extraction and classification. 1M context at low cost.',
  },
  {
    id: 'openai/gpt-4o-mini',
    label: 'GPT-4o mini',
    provider: 'openai',
    contextWindow: 128_000,
    tier: 'fast',
    costTier: 'low',
    strengths: 'Cost-efficient OpenAI model. Good for extraction and classification at high volume.',
  },
  // Search-augmented tier
  {
    id: 'perplexity/sonar-pro',
    label: 'Perplexity Sonar Pro',
    provider: 'perplexity',
    contextWindow: 127_072,
    tier: 'search',
    costTier: 'mid',
    strengths: 'Search-augmented. Uses live web data — best for competitive intelligence and account research.',
  },
  {
    id: 'perplexity/sonar',
    label: 'Perplexity Sonar',
    provider: 'perplexity',
    contextWindow: 127_072,
    tier: 'search',
    costTier: 'low',
    strengths: 'Fast search-augmented model. Good for quick market lookups and account enrichment.',
  },
  {
    id: 'perplexity/sonar-reasoning',
    label: 'Perplexity Sonar Reasoning',
    provider: 'perplexity',
    contextWindow: 127_072,
    tier: 'search',
    costTier: 'mid',
    strengths: 'Combines reasoning with live web search. Best for research-heavy analysis tasks.',
  },
];

const CAPABILITY_GROUPS = [
  {
    key: 'reasoning',
    label: 'Reasoning & Generation',
    capabilities: ['reason', 'generate'],
    description: 'Used for deep analysis, narrative generation, deal scoring, and forecasting.',
    allowedTiers: ['reasoning'] as ModelEntry['tier'][],
    guardrailNote: 'Fast models are not suitable for complex analysis and multi-step reasoning.',
    defaultModel: 'anthropic/claude-sonnet-4-20250514',
  },
  {
    key: 'extraction',
    label: 'Extraction & Classification',
    capabilities: ['extract', 'classify'],
    description: 'Used for structured data extraction, CRM field mapping, and intent classification.',
    allowedTiers: ['fast', 'search'] as ModelEntry['tier'][],
    guardrailNote: 'Reasoning models are overkill here — fast models reduce cost and latency by 10×.',
    defaultModel: 'fireworks/deepseek-v3-0324',
  },
];

function fmtContext(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`;
  return String(n);
}

const COST_COLORS: Record<string, string> = {
  high: '#F59E0B',
  mid: '#60A5FA',
  low: '#34D399',
};

const COST_LABELS: Record<string, string> = {
  high: '$$$',
  mid: '$$',
  low: '$',
};

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
  const [savingRouting, setSavingRouting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [connectedProviders, setConnectedProviders] = useState<Record<string, boolean>>({});
  const [providers, setProviders] = useState<Record<string, ProviderState>>(() =>
    Object.fromEntries(
      PROVIDERS.map(p => [p.key, { apiKey: '', baseURL: '', enabled: false, revealed: false, dirty: false }])
    )
  );
  // routing: per capability-group selected model id
  const [routing, setRouting] = useState<Record<string, string>>({
    reasoning: 'anthropic/claude-sonnet-4-20250514',
    extraction: 'fireworks/deepseek-v3-0324',
  });
  const [routingDirty, setRoutingDirty] = useState(false);

  const loadConfig = useCallback(async () => {
    try {
      setLoading(true);
      const config: LLMConfig = await api.get('/llm/config');
      setProviders(prev => {
        const next = { ...prev };
        for (const p of PROVIDERS) {
          const serverCfg = config.providers?.[p.key] ?? {};
          next[p.key] = {
            apiKey: (serverCfg as any).apiKey ?? '',
            baseURL: serverCfg.baseURL ?? '',
            enabled: serverCfg.enabled ?? false,
            revealed: false,
            dirty: false,
          };
        }
        return next;
      });
      // Build connected map from config.providers
      const connected: Record<string, boolean> = {};
      for (const p of PROVIDERS) {
        const pState = config.providers?.[p.key];
        connected[p.key] = !!(pState as any)?.connected || !!(pState?.enabled && (pState as any)?.apiKey);
      }
      setConnectedProviders(connected);

      // Map routing config to group selections
      const r = config.routing || {};
      const getRoute = (cap: string): string => {
        const entry = r[cap];
        if (!entry) return '';
        if (typeof entry === 'string') return entry;
        return entry.primary || '';
      };
      const reasonRoute = getRoute('reason') || getRoute('generate');
      const extractRoute = getRoute('extract') || getRoute('classify');
      setRouting({
        reasoning: reasonRoute || 'anthropic/claude-sonnet-4-20250514',
        extraction: extractRoute || 'fireworks/deepseek-v3-0324',
      });
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load config');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadConfig(); }, [loadConfig]);

  const handleChange = (providerKey: string, field: keyof ProviderState, value: string | boolean) => {
    setProviders(prev => ({ ...prev, [providerKey]: { ...prev[providerKey], [field]: value, dirty: true } }));
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
      setProviders(prev => ({ ...prev, [providerKey]: { ...prev[providerKey], dirty: false } }));
      const label = PROVIDERS.find(p => p.key === providerKey)?.label;
      setSuccessMsg(`${label} key saved`);
      setTimeout(() => setSuccessMsg(null), 3000);
      // Reload to get updated connected state
      await loadConfig();
    } catch (e: any) {
      setError(e?.message ?? 'Failed to save');
    } finally {
      setSaving(null);
    }
  };

  const handleRoutingChange = (groupKey: string, modelId: string) => {
    setRouting(prev => ({ ...prev, [groupKey]: modelId }));
    setRoutingDirty(true);
    setSuccessMsg(null);
  };

  const handleSaveRouting = async () => {
    setSavingRouting(true);
    setError(null);
    try {
      const routingPayload: Record<string, string> = {
        reason: routing.reasoning,
        generate: routing.reasoning,
        extract: routing.extraction,
        classify: routing.extraction,
      };
      await api.post('/llm/config', { routing: routingPayload });
      setRoutingDirty(false);
      setSuccessMsg('Model routing saved');
      setTimeout(() => setSuccessMsg(null), 3000);
    } catch (e: any) {
      setError(e?.message ?? 'Failed to save routing');
    } finally {
      setSavingRouting(false);
    }
  };

  const isConnected = (pKey: string) => {
    return connectedProviders[pKey] || (providers[pKey]?.enabled && !!providers[pKey]?.apiKey);
  };

  if (loading) {
    return (
      <div style={{ color: colors.textMuted, fontFamily: fonts.sans, fontSize: 13, paddingTop: 40, textAlign: 'center' }}>
        Loading AI key configuration…
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 700, fontFamily: fonts.sans }}>
      <h1 style={{ fontSize: 22, fontWeight: 600, color: colors.text, marginBottom: 6 }}>AI Keys</h1>
      <p style={{ fontSize: 13, color: colors.textSecondary, marginBottom: 8, lineHeight: 1.6 }}>
        Provide your own API keys to route AI usage to your account (BYOK). Usage via your keys appears as{' '}
        <span style={{ color: colors.green, fontWeight: 500 }}>BYOK</span> on the Token Usage page and is billed
        directly by the provider — Pandora infrastructure charges do not apply.
      </p>
      <p style={{ fontSize: 12, color: colors.textMuted, marginBottom: 28 }}>
        Keys are stored encrypted and used only within this workspace.
      </p>

      {error && (
        <div style={{ background: colors.redSoft, border: `1px solid ${colors.red}`, borderRadius: 6, padding: '10px 14px', fontSize: 13, color: colors.red, marginBottom: 20 }}>
          {error}
        </div>
      )}
      {successMsg && (
        <div style={{ background: colors.greenSoft, border: `1px solid ${colors.green}`, borderRadius: 6, padding: '10px 14px', fontSize: 13, color: colors.green, marginBottom: 20 }}>
          {successMsg}
        </div>
      )}

      {/* Provider key cards */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 40 }}>
        {PROVIDERS.map(provider => {
          const state = providers[provider.key];
          const connected = isConnected(provider.key);
          const isSaving = saving === provider.key;

          return (
            <div key={provider.key} style={{
              background: colors.surface,
              border: `1px solid ${connected ? colors.green : colors.border}`,
              borderRadius: 8,
              padding: '16px 18px',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: colors.text }}>{provider.label}</span>
                  {connected ? (
                    <span style={{ fontSize: 9, color: colors.green, background: colors.greenSoft, padding: '2px 7px', borderRadius: 3, letterSpacing: '0.1em', fontWeight: 600 }}>
                      CONNECTED
                    </span>
                  ) : (
                    <span style={{ fontSize: 9, color: colors.textMuted, background: colors.surfaceRaised, padding: '2px 7px', borderRadius: 3, letterSpacing: '0.1em' }}>
                      NOT CONFIGURED
                    </span>
                  )}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 12, color: colors.textSecondary }}>Enabled</span>
                  <div
                    onClick={() => handleChange(provider.key, 'enabled', !state.enabled)}
                    style={{ width: 34, height: 18, borderRadius: 9, background: state.enabled ? colors.accent : colors.border, position: 'relative', cursor: 'pointer', transition: 'background 0.2s', flexShrink: 0 }}
                  >
                    <div style={{ width: 12, height: 12, borderRadius: '50%', background: '#fff', position: 'absolute', top: 3, left: state.enabled ? 19 : 3, transition: 'left 0.2s' }} />
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                <input
                  type={state.revealed ? 'text' : 'password'}
                  value={state.apiKey}
                  onChange={e => handleChange(provider.key, 'apiKey', e.target.value)}
                  placeholder={provider.placeholder}
                  style={{ flex: 1, background: colors.bg, border: `1px solid ${colors.border}`, borderRadius: 5, padding: '7px 10px', fontSize: 12, color: colors.text, fontFamily: fonts.mono, outline: 'none' }}
                />
                <button
                  onClick={() => handleChange(provider.key, 'revealed', !state.revealed)}
                  style={{ padding: '7px 10px', background: colors.surfaceRaised, border: `1px solid ${colors.border}`, borderRadius: 5, color: colors.textSecondary, fontSize: 11, cursor: 'pointer', whiteSpace: 'nowrap', fontFamily: fonts.sans }}
                >
                  {state.revealed ? 'Hide' : 'Show'}
                </button>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <a href={provider.docsUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11, color: colors.accent }}>
                  Get API key →
                </a>
                <button
                  onClick={() => handleSave(provider.key)}
                  disabled={isSaving || !state.dirty}
                  style={{ padding: '6px 14px', background: state.dirty ? colors.accent : colors.surfaceRaised, border: `1px solid ${state.dirty ? colors.accent : colors.border}`, borderRadius: 5, color: state.dirty ? '#fff' : colors.textMuted, fontSize: 12, fontWeight: 500, cursor: state.dirty && !isSaving ? 'pointer' : 'default', fontFamily: fonts.sans, transition: 'background 0.15s, color 0.15s' }}
                >
                  {isSaving ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Model routing section */}
      <div style={{ borderTop: `1px solid ${colors.border}`, paddingTop: 32, marginBottom: 32 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20 }}>
          <div>
            <h2 style={{ fontSize: 16, fontWeight: 600, color: colors.text, margin: 0, marginBottom: 4 }}>Model Routing</h2>
            <p style={{ fontSize: 12, color: colors.textMuted, margin: 0 }}>
              Choose which model handles each type of task. Settings are per-workspace and don't affect other workspaces.
            </p>
          </div>
          <button
            onClick={handleSaveRouting}
            disabled={savingRouting || !routingDirty}
            style={{ padding: '7px 16px', background: routingDirty ? colors.accent : colors.surfaceRaised, border: `1px solid ${routingDirty ? colors.accent : colors.border}`, borderRadius: 5, color: routingDirty ? '#fff' : colors.textMuted, fontSize: 12, fontWeight: 500, cursor: routingDirty && !savingRouting ? 'pointer' : 'default', fontFamily: fonts.sans, flexShrink: 0 }}
          >
            {savingRouting ? 'Saving…' : 'Save Routing'}
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          {CAPABILITY_GROUPS.map(group => {
            const allowedModels = MODEL_CATALOG.filter(m => group.allowedTiers.includes(m.tier));
            const selected = routing[group.key];

            return (
              <div key={group.key} style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 8, overflow: 'hidden' }}>
                <div style={{ padding: '14px 18px', borderBottom: `1px solid ${colors.border}`, background: colors.bg }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: colors.text, marginBottom: 2 }}>{group.label}</div>
                  <div style={{ fontSize: 11, color: colors.textMuted }}>{group.description}</div>
                  <div style={{ fontSize: 10, color: colors.yellow, marginTop: 6, fontStyle: 'italic' }}>{group.guardrailNote}</div>
                </div>

                <div style={{ padding: '12px 18px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {allowedModels.map(model => {
                    const isSelected = selected === model.id;
                    const providerConnected = isConnected(model.provider);
                    const needsKey = !providerConnected && !['anthropic', 'fireworks'].includes(model.provider);

                    return (
                      <div
                        key={model.id}
                        onClick={() => handleRoutingChange(group.key, model.id)}
                        style={{
                          display: 'flex',
                          alignItems: 'flex-start',
                          gap: 10,
                          padding: '10px 12px',
                          borderRadius: 6,
                          border: `1px solid ${isSelected ? colors.accent : colors.border}`,
                          background: isSelected ? colors.accentSoft : colors.surfaceRaised,
                          cursor: 'pointer',
                          transition: 'border-color 0.15s, background 0.15s',
                          opacity: needsKey ? 0.7 : 1,
                        }}
                      >
                        {/* Radio dot */}
                        <div style={{ width: 14, height: 14, borderRadius: '50%', border: `2px solid ${isSelected ? colors.accent : colors.border}`, background: isSelected ? colors.accent : 'transparent', flexShrink: 0, marginTop: 1, transition: 'background 0.15s, border-color 0.15s' }} />

                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                            <span style={{ fontSize: 12, fontWeight: 600, color: isSelected ? colors.accent : colors.text }}>{model.label}</span>
                            {model.pandoraDefault && (
                              <span style={{ fontSize: 8, background: colors.accentSoft, color: colors.accent, padding: '1px 5px', borderRadius: 3, letterSpacing: '0.08em', fontWeight: 600 }}>DEFAULT</span>
                            )}
                            <span style={{ fontSize: 9, background: colors.surfaceRaised, color: colors.textMuted, padding: '1px 5px', borderRadius: 3, fontFamily: fonts.mono }}>
                              {fmtContext(model.contextWindow)} ctx
                            </span>
                            <span style={{ fontSize: 10, color: COST_COLORS[model.costTier], fontWeight: 600 }}>
                              {COST_LABELS[model.costTier]}
                            </span>
                          </div>
                          <div style={{ fontSize: 11, color: colors.textMuted, marginTop: 3, lineHeight: 1.4 }}>{model.strengths}</div>
                          {needsKey && (
                            <div style={{ fontSize: 10, color: colors.yellow, marginTop: 4 }}>
                              ⚠ Requires {PROVIDERS.find(p => p.key === model.provider)?.label} key to use
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
