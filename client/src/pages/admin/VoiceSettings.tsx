import React, { useState, useEffect, useCallback, useRef } from 'react';
import { colors, fonts } from '../../styles/theme';
import { api } from '../../lib/api';
import { useWorkspace } from '../../context/WorkspaceContext';
import { VoiceModifierConfig } from '../../types/workspace-config.ts';
import { VoiceProfile } from '../../voice/types.ts';

interface PreviewResponse {
  systemPromptSection: string;
  sampleOutputBefore: string;
  sampleOutputAfter: string;
  transformationsApplied: string[];
}

export default function VoiceSettings() {
  const { currentWorkspace } = useWorkspace();
  const [config, setConfig] = useState<VoiceModifierConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const debounceTimer = useRef<NodeJS.Timeout | null>(null);

  const fetchConfig = useCallback(async () => {
    if (!currentWorkspace?.id) return;
    try {
      setLoading(true);
      const res = await api.get(`/api/workspaces/${currentWorkspace.id}/config/voice`);
      setConfig(res as VoiceModifierConfig);
    } catch (err: any) {
      setError(err.message || 'Failed to load voice settings');
    } finally {
      setLoading(false);
    }
  }, [currentWorkspace?.id]);

  useEffect(() => {
    fetchConfig();
  }, [fetchConfig]);

  const fetchPreview = useCallback(async (currentConfig: VoiceModifierConfig) => {
    if (!currentWorkspace?.id) return;
    setPreviewLoading(true);
    try {
      const res = await api.post(`/api/workspaces/${currentWorkspace.id}/voice/preview`, {
        voiceProfile: currentConfig,
        sampleContext: {
          attainment_pct: 65,
          days_remaining: 12,
          sample_scenario: 'late_quarter_behind'
        }
      });
      setPreview(res as PreviewResponse);
    } catch (err: any) {
      console.error('Preview failed', err);
    } finally {
      setPreviewLoading(false);
    }
  }, [currentWorkspace?.id]);

  useEffect(() => {
    if (config) {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
      debounceTimer.current = setTimeout(() => {
        fetchPreview(config);
      }, 500);
    }
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, [config, fetchPreview]);

  const updateConfig = (patch: Partial<VoiceModifierConfig>) => {
    setConfig((prev: VoiceModifierConfig | null) => prev ? { ...prev, ...patch } : null);
  };

  const handleSave = async () => {
    if (!currentWorkspace?.id || !config) return;
    try {
      setError(null);
      await api.patch(`/api/workspaces/${currentWorkspace.id}/config/voice`, config);
      setSuccessMsg('Settings saved successfully');
      setTimeout(() => setSuccessMsg(null), 3000);
    } catch (err: any) {
      setError(err.message || 'Failed to save settings');
    }
  };

  const handleReset = async () => {
    if (!currentWorkspace?.id) return;
    if (!window.confirm('Are you sure you want to reset voice settings to defaults?')) return;
    try {
      const res = await api.post(`/api/workspaces/${currentWorkspace.id}/voice/reset`, {});
      setConfig(res as VoiceModifierConfig);
      setSuccessMsg('Settings reset to defaults');
      setTimeout(() => setSuccessMsg(null), 3000);
    } catch (err: any) {
      setError(err.message || 'Failed to reset settings');
    }
  };

  if (loading) {
    return <div style={{ padding: 24, color: colors.textMuted }}>Loading voice settings...</div>;
  }

  if (!config) {
    return <div style={{ padding: 24, color: colors.red }}>Failed to load configuration.</div>;
  }

  const Section = ({ title, children }: { title: string, children: React.ReactNode }) => (
    <div style={{ marginBottom: 32 }}>
      <h2 style={{ fontSize: 14, fontWeight: 600, color: colors.text, marginBottom: 16, borderBottom: `1px solid ${colors.border}`, paddingBottom: 8 }}>
        {title}
      </h2>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
        {children}
      </div>
    </div>
  );

  const Control = ({ label, children }: { label: string, children: React.ReactNode }) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <label style={{ fontSize: 12, fontWeight: 500, color: colors.textSecondary }}>{label}</label>
      {children}
    </div>
  );

  const RadioGroup = <T extends string>({ options, value, onChange }: { options: { label: string, value: T }[], value: T, onChange: (v: T) => void }) => (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      {options.map(opt => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          style={{
            padding: '6px 12px',
            fontSize: 12,
            borderRadius: 4,
            border: `1px solid ${value === opt.value ? colors.accent : colors.border}`,
            background: value === opt.value ? colors.accentSoft : colors.surface,
            color: value === opt.value ? colors.accent : colors.textSecondary,
            cursor: 'pointer',
            transition: 'all 0.15s'
          }}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );

  return (
    <div style={{ fontFamily: fonts.sans, color: colors.text, padding: '28px 32px', maxWidth: 1200 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 600, margin: 0, marginBottom: 4 }}>Voice & Tone Settings</h1>
          <p style={{ fontSize: 13, color: colors.textMuted, margin: 0 }}>
            Configure how Pandora speaks in chat, briefings, and documents.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 12 }}>
          <button
            onClick={handleReset}
            style={{ padding: '8px 16px', background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 6, fontSize: 13, cursor: 'pointer' }}
          >
            Reset to Defaults
          </button>
          <button
            onClick={handleSave}
            style={{ padding: '8px 24px', background: colors.accent, color: '#fff', border: 'none', borderRadius: 6, fontSize: 13, fontWeight: 500, cursor: 'pointer' }}
          >
            Save Changes
          </button>
        </div>
      </div>

      {error && (
        <div style={{ background: colors.redSoft, color: colors.red, padding: '10px 14px', borderRadius: 6, fontSize: 13, marginBottom: 20 }}>
          {error}
        </div>
      )}
      {successMsg && (
        <div style={{ background: colors.greenSoft, color: colors.green, padding: '10px 14px', borderRadius: 6, fontSize: 13, marginBottom: 20 }}>
          {successMsg}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 400px', gap: 40 }}>
        <div>
          <Section title="Core Voice">
            <Control label="Persona">
              <RadioGroup
                value={config.persona}
                onChange={v => updateConfig({ persona: v })}
                options={[
                  { label: 'Teammate', value: 'teammate' },
                  { label: 'Advisor', value: 'advisor' },
                  { label: 'Analyst', value: 'analyst' }
                ]}
              />
            </Control>
            <Control label="Ownership Pronoun">
              <RadioGroup
                value={config.ownership_pronoun}
                onChange={v => updateConfig({ ownership_pronoun: v })}
                options={[
                  { label: 'We', value: 'we' },
                  { label: 'You', value: 'you' }
                ]}
              />
            </Control>
            <Control label="Directness">
              <RadioGroup
                value={config.directness}
                onChange={v => updateConfig({ directness: v })}
                options={[
                  { label: 'Direct', value: 'direct' },
                  { label: 'Diplomatic', value: 'diplomatic' }
                ]}
              />
            </Control>
            <Control label="Detail Level">
              <RadioGroup
                value={config.detail_level}
                onChange={v => updateConfig({ detail_level: v })}
                options={[
                  { label: 'Executive', value: 'executive' },
                  { label: 'Manager', value: 'manager' },
                  { label: 'Analyst', value: 'analyst' }
                ]}
              />
            </Control>
          </Section>

          <Section title="Content Preferences">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13 }}>
                <input type="checkbox" checked={config.name_entities} onChange={e => updateConfig({ name_entities: e.target.checked })} />
                Name Entities (Reps/Accounts)
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13 }}>
                <input type="checkbox" checked={config.celebrate_wins} onChange={e => updateConfig({ celebrate_wins: e.target.checked })} />
                Celebrate Wins
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13 }}>
                <input type="checkbox" checked={config.surface_uncertainty} onChange={e => updateConfig({ surface_uncertainty: e.target.checked })} />
                Surface Uncertainty
              </label>
            </div>
            <Control label="Temporal Awareness">
              <select
                value={config.temporal_awareness}
                onChange={e => updateConfig({ temporal_awareness: e.target.value as any })}
                style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 4, padding: '6px 10px', fontSize: 13, color: colors.text }}
              >
                <option value="both">Both (Quarter & Day)</option>
                <option value="quarter_phase">Quarter Phase Only</option>
                <option value="week_day">Week Day Only</option>
                <option value="none">None</option>
              </select>
            </Control>
          </Section>

          <Section title="Custom Terminology">
            <Control label="Deal">
              <input type="text" value={config.custom_terms?.deal || ''} onChange={e => updateConfig({ custom_terms: { ...config.custom_terms, deal: e.target.value } })} placeholder="e.g. Opportunity" style={{ padding: '8px 12px', borderRadius: 4, border: `1px solid ${colors.border}`, background: colors.surface, color: colors.text, fontSize: 13 }} />
            </Control>
            <Control label="Rep">
              <input type="text" value={config.custom_terms?.rep || ''} onChange={e => updateConfig({ custom_terms: { ...config.custom_terms, rep: e.target.value } })} placeholder="e.g. Owner" style={{ padding: '8px 12px', borderRadius: 4, border: `1px solid ${colors.border}`, background: colors.surface, color: colors.text, fontSize: 13 }} />
            </Control>
            <Control label="Commit">
              <input type="text" value={config.custom_terms?.commit || ''} onChange={e => updateConfig({ custom_terms: { ...config.custom_terms, commit: e.target.value } })} placeholder="e.g. Forecast" style={{ padding: '8px 12px', borderRadius: 4, border: `1px solid ${colors.border}`, background: colors.surface, color: colors.text, fontSize: 13 }} />
            </Control>
            <Control label="Pipeline">
              <input type="text" value={config.custom_terms?.pipeline || ''} onChange={e => updateConfig({ custom_terms: { ...config.custom_terms, pipeline: e.target.value } })} placeholder="e.g. Funnel" style={{ padding: '8px 12px', borderRadius: 4, border: `1px solid ${colors.border}`, background: colors.surface, color: colors.text, fontSize: 13 }} />
            </Control>
          </Section>

          <Section title="Demo Mode">
             <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13 }}>
                <input type="checkbox" checked={config.anonymize_mode} onChange={e => updateConfig({ anonymize_mode: e.target.checked })} />
                Anonymize Mode (Hides real names in outputs)
              </label>
          </Section>

          <Section title="Overrides">
            <Control label="Brief Opening Style">
              <RadioGroup
                value={config.brief_overrides?.opening_style || 'standard'}
                onChange={v => updateConfig({ brief_overrides: { ...config.brief_overrides, opening_style: v } })}
                options={[
                  { label: 'Standard', value: 'standard' },
                  { label: 'Bullet Point', value: 'bullet' },
                  { label: 'Narrative', value: 'narrative' }
                ]}
              />
            </Control>
            <Control label="Chat Max Sentences">
              <select
                value={config.chat_overrides?.response_max_sentences || 5}
                onChange={e => updateConfig({ chat_overrides: { ...config.chat_overrides, response_max_sentences: parseInt(e.target.value) } })}
                style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 4, padding: '6px 10px', fontSize: 13, color: colors.text }}
              >
                {[3, 5, 8, 12].map(n => <option key={n} value={n}>{n} sentences</option>)}
              </select>
            </Control>
          </Section>
        </div>

        <div>
          <div style={{ position: 'sticky', top: 24 }}>
            <div style={{ background: colors.surfaceRaised, border: `1px solid ${colors.border}`, borderRadius: 12, overflow: 'hidden' }}>
              <div style={{ padding: '12px 16px', background: colors.bg, borderBottom: `1px solid ${colors.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: colors.textMuted }}>Live Preview</span>
                {previewLoading && <span style={{ fontSize: 10, color: colors.accent }}>Updating...</span>}
              </div>
              <div style={{ padding: 20 }}>
                <div style={{ marginBottom: 20 }}>
                  <div style={{ fontSize: 10, color: colors.textMuted, marginBottom: 8, textTransform: 'uppercase' }}>Before Voice Transforms</div>
                  <div style={{ fontSize: 13, color: colors.textSecondary, background: colors.bg, padding: 12, borderRadius: 6, border: `1px solid ${colors.border}`, lineHeight: 1.5 }}>
                    {preview?.sampleOutputBefore || 'Generating...'}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 10, color: colors.textMuted, marginBottom: 8, textTransform: 'uppercase' }}>After Voice Transforms</div>
                  <div style={{ fontSize: 13, color: colors.text, background: '#fff', padding: 12, borderRadius: 6, border: `1px solid ${colors.accent}`, lineHeight: 1.5, boxShadow: '0 2px 8px rgba(0,0,0,0.05)' }}>
                    {preview?.sampleOutputAfter || 'Generating...'}
                  </div>
                </div>
                {preview?.transformationsApplied && preview.transformationsApplied.length > 0 && (
                  <div style={{ marginTop: 16 }}>
                    <div style={{ fontSize: 10, color: colors.textMuted, marginBottom: 8 }}>TRANSFORMS APPLIED:</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                      {preview.transformationsApplied.map((t, i) => (
                        <span key={i} style={{ fontSize: 9, background: colors.accentSoft, color: colors.accent, padding: '2px 6px', borderRadius: 10 }}>{t}</span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
