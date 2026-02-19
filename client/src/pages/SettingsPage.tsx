import React, { useEffect, useRef, useState } from 'react';
import { colors, fonts } from '../styles/theme';
import { api } from '../lib/api';
import Skeleton from '../components/Skeleton';
import { formatCurrency } from '../lib/format';
import Toast from '../components/Toast';

type Tab = 'voice' | 'skills' | 'tokens' | 'learning' | 'quotas' | 'ws-general' | 'ws-stages' | 'ws-filters' | 'ws-team' | 'ws-thresholds' | 'ws-suggestions';

const TABS: { key: Tab; label: string; section?: string }[] = [
  { key: 'voice', label: 'Voice & Tone' },
  { key: 'skills', label: 'Skills' },
  { key: 'tokens', label: 'Token Budget' },
  { key: 'learning', label: 'Learning' },
  { key: 'quotas', label: 'Quotas' },
  { key: 'ws-general', label: 'General', section: 'workspace' },
  { key: 'ws-stages', label: 'Pipeline & Stages', section: 'workspace' },
  { key: 'ws-filters', label: 'Metric Filters', section: 'workspace' },
  { key: 'ws-team', label: 'Team', section: 'workspace' },
  { key: 'ws-thresholds', label: 'Thresholds', section: 'workspace' },
  { key: 'ws-suggestions', label: 'Suggestions', section: 'workspace' },
];

const CRON_PRESETS = [
  { label: 'Daily at 8 AM', value: '0 8 * * *', frequency: 'daily' },
  { label: 'Daily at 6 AM', value: '0 6 * * *', frequency: 'daily' },
  { label: 'Weekdays at 8 AM', value: '0 8 * * 1-5', frequency: 'daily' },
  { label: 'Every Monday at 8 AM', value: '0 8 * * 1', frequency: 'weekly' },
  { label: 'Every Monday at 7 AM', value: '0 7 * * 1', frequency: 'weekly' },
  { label: 'Mon & Thu at 8 AM', value: '0 8 * * 1,4', frequency: 'biweekly' },
  { label: 'Every Friday at 4 PM', value: '0 16 * * 5', frequency: 'weekly' },
  { label: 'Monthly on the 1st at 9 AM', value: '0 9 1 * *', frequency: 'monthly' },
  { label: 'Advanced (custom cron)', value: '__custom__', frequency: 'custom' },
];

function getPreviewText(detailLevel: string, framing: string): string {
  if (detailLevel === 'concise') {
    return '$420K stalled in Proposal stage, 30+ days inactive. 3 deals, 2 owned by Sara Bollman.';
  }
  if (detailLevel === 'detailed') {
    return 'Pipeline velocity analysis shows 3 deals ($420K total) have exceeded the 14-day threshold in Proposal stage, averaging 34 days without recorded activity. This represents 9% of open pipeline value. Based on historical patterns, deals stalled at this stage for 30+ days have a 23% lower close rate. Consider scheduling a pipeline review with Sara Bollman, who owns 2 of the 3 affected deals, to determine if these should be re-staged or removed.';
  }
  return '3 deals totaling $420K have been in Proposal for 30+ days with no activity. Sara Bollman owns 2 of these. Consider reviewing pipeline hygiene with the team.';
}

function formatTokens(n: number): string {
  return n.toLocaleString();
}

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<Tab>('voice');

  return (
    <div style={{ display: 'flex', minHeight: '100%', fontFamily: fonts.sans }}>
      <div style={{
        width: 200,
        flexShrink: 0,
        background: colors.surface,
        borderRight: `1px solid ${colors.border}`,
        display: 'flex',
        flexDirection: 'column',
        padding: '8px 0',
        overflowY: 'auto',
      }}>
        {TABS.filter(t => !t.section).map(tab => {
          const isActive = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              style={{
                display: 'block',
                width: '100%',
                textAlign: 'left',
                padding: '10px 16px',
                fontSize: 13,
                fontWeight: isActive ? 600 : 400,
                fontFamily: fonts.sans,
                color: isActive ? colors.accent : colors.textSecondary,
                background: isActive ? colors.accentSoft : 'transparent',
                border: 'none',
                borderLeft: isActive ? `3px solid ${colors.accent}` : '3px solid transparent',
                cursor: 'pointer',
                transition: 'background 0.12s, color 0.12s',
              }}
              onMouseEnter={e => {
                if (!isActive) e.currentTarget.style.background = colors.surfaceHover;
              }}
              onMouseLeave={e => {
                if (!isActive) e.currentTarget.style.background = 'transparent';
              }}
            >
              {tab.label}
            </button>
          );
        })}
        <div style={{
          padding: '12px 16px 4px',
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          color: colors.textMuted,
          fontFamily: fonts.sans,
          marginTop: 8,
          borderTop: `1px solid ${colors.border}`,
        }}>
          Workspace
        </div>
        {TABS.filter(t => t.section === 'workspace').map(tab => {
          const isActive = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              style={{
                display: 'block',
                width: '100%',
                textAlign: 'left',
                padding: '10px 16px',
                fontSize: 13,
                fontWeight: isActive ? 600 : 400,
                fontFamily: fonts.sans,
                color: isActive ? colors.accent : colors.textSecondary,
                background: isActive ? colors.accentSoft : 'transparent',
                border: 'none',
                borderLeft: isActive ? `3px solid ${colors.accent}` : '3px solid transparent',
                cursor: 'pointer',
                transition: 'background 0.12s, color 0.12s',
              }}
              onMouseEnter={e => {
                if (!isActive) e.currentTarget.style.background = colors.surfaceHover;
              }}
              onMouseLeave={e => {
                if (!isActive) e.currentTarget.style.background = 'transparent';
              }}
            >
              {tab.label}
            </button>
          );
        })}
      </div>
      <div style={{ flex: 1, padding: 24, overflow: 'auto' }}>
        {activeTab === 'voice' && <VoiceSection />}
        {activeTab === 'skills' && <SkillsSection />}
        {activeTab === 'tokens' && <TokensSection />}
        {activeTab === 'learning' && <LearningSection />}
        {activeTab === 'quotas' && <QuotasSection />}
        {activeTab === 'ws-general' && <WsGeneralSection />}
        {activeTab === 'ws-stages' && <WsPipelineStagesSection />}
        {activeTab === 'ws-filters' && <WsMetricFiltersSection />}
        {activeTab === 'ws-team' && <WsTeamSection />}
        {activeTab === 'ws-thresholds' && <WsThresholdsSection />}
        {activeTab === 'ws-suggestions' && <WsSuggestionsSection />}
      </div>
    </div>
  );
}

function RadioOption({ selected, label, description, isDefault, onClick }: {
  selected: boolean;
  label: string;
  description: string;
  isDefault?: boolean;
  onClick: () => void;
}) {
  return (
    <div
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 10,
        padding: '8px 0',
        cursor: 'pointer',
      }}
    >
      <div style={{
        width: 16,
        height: 16,
        borderRadius: '50%',
        border: `2px solid ${selected ? colors.accent : colors.border}`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        marginTop: 1,
      }}>
        {selected && (
          <div style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: colors.accent,
          }} />
        )}
      </div>
      <div>
        <span style={{ fontSize: 13, fontWeight: 500, color: colors.text }}>
          {label}
        </span>
        {isDefault && (
          <span style={{
            fontSize: 10,
            fontWeight: 600,
            color: colors.accent,
            background: colors.accentSoft,
            padding: '1px 6px',
            borderRadius: 4,
            marginLeft: 8,
          }}>
            default
          </span>
        )}
        <p style={{ fontSize: 12, color: colors.textMuted, marginTop: 2, lineHeight: 1.4 }}>
          {description}
        </p>
      </div>
    </div>
  );
}

function VoiceSection() {
  const [loading, setLoading] = useState(true);
  const [detailLevel, setDetailLevel] = useState('standard');
  const [framing, setFraming] = useState('direct');
  const [alertThreshold, setAlertThreshold] = useState('watch_and_act');
  const [showPreview, setShowPreview] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState('');

  useEffect(() => {
    api.get('/workspace-config')
      .then((data: any) => {
        const voice = data?.config?.voice;
        if (voice) {
          if (voice.detail_level) setDetailLevel(voice.detail_level);
          if (voice.framing) setFraming(voice.framing);
          if (voice.alert_threshold) setAlertThreshold(voice.alert_threshold);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.patch('/workspace-config/voice', {
        detail_level: detailLevel,
        framing,
        alert_threshold: alertThreshold,
      });
      setToast('Voice settings saved');
      setTimeout(() => setToast(''), 2000);
    } catch {
      setToast('Failed to save');
      setTimeout(() => setToast(''), 2000);
    } finally {
      setSaving(false);
    }
  };

  const toggleExperimentalSkill = async (skillId: string) => {
    const next = enabledExperimentalIds.includes(skillId)
      ? enabledExperimentalIds.filter(id => id !== skillId)
      : [...enabledExperimentalIds, skillId];
    setEnabledExperimentalIds(next);
    try {
      await api.patch('/workspace-config/experimental_skills', {
        enabled_skill_ids: next,
      });
    } catch {
      setEnabledExperimentalIds(enabledExperimentalIds);
    }
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <Skeleton height={24} width={200} />
        <Skeleton height={120} />
        <Skeleton height={120} />
        <Skeleton height={120} />
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 640 }}>
      <h2 style={{ fontSize: 18, fontWeight: 600, color: colors.text, marginBottom: 24 }}>Voice & Tone</h2>

      <div style={{
        background: colors.surface,
        border: `1px solid ${colors.border}`,
        borderRadius: 10,
        padding: 24,
        marginBottom: 16,
      }}>
        <h3 style={{ fontSize: 14, fontWeight: 600, color: colors.text, marginBottom: 12 }}>Detail Level</h3>
        <RadioOption
          selected={detailLevel === 'concise'}
          label="Executive"
          description="1-2 sentences. Lead with the implication."
          onClick={() => setDetailLevel('concise')}
        />
        <RadioOption
          selected={detailLevel === 'standard'}
          label="Manager"
          description="Balanced detail with enough context to act."
          isDefault
          onClick={() => setDetailLevel('standard')}
        />
        <RadioOption
          selected={detailLevel === 'detailed'}
          label="Analyst"
          description="Include supporting data points and methodology notes."
          onClick={() => setDetailLevel('detailed')}
        />
      </div>

      <div style={{
        background: colors.surface,
        border: `1px solid ${colors.border}`,
        borderRadius: 10,
        padding: 24,
        marginBottom: 16,
      }}>
        <h3 style={{ fontSize: 14, fontWeight: 600, color: colors.text, marginBottom: 12 }}>Framing</h3>
        <RadioOption
          selected={framing === 'direct'}
          label="Direct"
          description="State findings plainly. No hedging."
          isDefault
          onClick={() => setFraming('direct')}
        />
        <RadioOption
          selected={framing === 'balanced'}
          label="Diplomatic"
          description="Frame observations as opportunities. Acknowledge what works."
          onClick={() => setFraming('balanced')}
        />
        <RadioOption
          selected={framing === 'diplomatic'}
          label="Consultative"
          description="Present as expert recommendations with reasoning."
          onClick={() => setFraming('diplomatic')}
        />
      </div>

      <div style={{
        background: colors.surface,
        border: `1px solid ${colors.border}`,
        borderRadius: 10,
        padding: 24,
        marginBottom: 16,
      }}>
        <h3 style={{ fontSize: 14, fontWeight: 600, color: colors.text, marginBottom: 12 }}>Alert Threshold</h3>
        <RadioOption
          selected={alertThreshold === 'all'}
          label="All findings"
          description="Surface everything including informational items."
          onClick={() => setAlertThreshold('all')}
        />
        <RadioOption
          selected={alertThreshold === 'watch_and_act'}
          label="Watch and above"
          description="Skip info-level findings. Show watch, act, and notable."
          isDefault
          onClick={() => setAlertThreshold('watch_and_act')}
        />
        <RadioOption
          selected={alertThreshold === 'act_only'}
          label="Act only"
          description="Only surface items requiring immediate action."
          onClick={() => setAlertThreshold('act_only')}
        />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <button
          onClick={() => setShowPreview(!showPreview)}
          style={{
            fontSize: 12,
            fontWeight: 500,
            fontFamily: fonts.sans,
            color: colors.accent,
            background: 'none',
            border: `1px solid ${colors.border}`,
            borderRadius: 6,
            padding: '6px 14px',
            cursor: 'pointer',
          }}
        >
          {showPreview ? 'Hide Preview' : 'Preview'}
        </button>
        <button
          onClick={handleSave}
          disabled={saving}
          style={{
            fontSize: 12,
            fontWeight: 600,
            fontFamily: fonts.sans,
            color: '#fff',
            background: saving ? colors.surfaceHover : colors.accent,
            border: 'none',
            borderRadius: 6,
            padding: '6px 18px',
            cursor: saving ? 'not-allowed' : 'pointer',
            opacity: saving ? 0.6 : 1,
          }}
        >
          {saving ? 'Saving...' : 'Save'}
        </button>
        {toast && (
          <span style={{
            fontSize: 12,
            fontWeight: 500,
            color: toast === 'Voice settings saved' ? colors.green : colors.red,
          }}>
            {toast}
          </span>
        )}
      </div>

      {showPreview && (
        <div style={{
          background: colors.surfaceRaised,
          border: `1px solid ${colors.border}`,
          borderRadius: 10,
          padding: 20,
        }}>
          <p style={{
            fontSize: 12,
            fontWeight: 500,
            color: colors.textMuted,
            marginBottom: 8,
          }}>
            Sample finding preview
          </p>
          <p style={{
            fontSize: 13,
            color: colors.textSecondary,
            fontStyle: 'italic',
            lineHeight: 1.6,
          }}>
            {getPreviewText(detailLevel, framing)}
          </p>
        </div>
      )}
    </div>
  );
}

function Toggle({ enabled, onChange }: { enabled: boolean; onChange: (v: boolean) => void }) {
  return (
    <div
      onClick={() => onChange(!enabled)}
      style={{
        width: 36,
        height: 20,
        borderRadius: 10,
        background: enabled ? colors.accent : colors.surfaceHover,
        cursor: 'pointer',
        position: 'relative',
        transition: 'background 0.2s',
        flexShrink: 0,
      }}
    >
      <div style={{
        width: 16,
        height: 16,
        borderRadius: '50%',
        background: '#fff',
        position: 'absolute',
        top: 2,
        left: enabled ? 18 : 2,
        transition: 'left 0.2s',
      }} />
    </div>
  );
}

interface ToastItem { id: number; message: string; type: 'success' | 'error' | 'info'; }

function SkillsSection() {
  const [loading, setLoading] = useState(true);
  const [skills, setSkills] = useState<any[]>([]);
  const [experimentalSkills, setExperimentalSkills] = useState<any[]>([]);
  const [enabledExperimentalIds, setEnabledExperimentalIds] = useState<string[]>([]);
  const [schedules, setSchedules] = useState<Record<string, { cron: string; enabled: boolean; preset: string; customCron: string }>>({});
  const [savingAll, setSavingAll] = useState(false);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const toastIdRef = useRef(0);

  const addToast = (message: string, type: ToastItem['type'] = 'success') => {
    const id = ++toastIdRef.current;
    setToasts(prev => [...prev, { id, message, type }]);
  };
  const removeToast = (id: number) => setToasts(prev => prev.filter(t => t.id !== id));

  useEffect(() => {
    Promise.all([
      api.get('/skills'),
      api.get('/workspace-config').catch(() => ({ config: {} })),
    ]).then(([skillData, cfgData]: any[]) => {
      const arr = Array.isArray(skillData) ? skillData : skillData.skills || [];
      const regularSkills = arr.filter((s: any) => !s.experimental);
      const expSkills = arr.filter((s: any) => s.experimental);
      setExperimentalSkills(expSkills);
      setSkills(regularSkills);
      const enabledIds = cfgData.config?.experimental_skills?.enabled_skill_ids || [];
      setEnabledExperimentalIds(enabledIds);
      const sched: Record<string, any> = {};
      regularSkills.forEach((s: any) => {
        const cronVal = s.schedule?.cron || '';
        const enabled = s.schedule?.enabled ?? false;
        const matchedPreset = CRON_PRESETS.find(p => p.value === cronVal);
        sched[s.id] = {
          cron: cronVal,
          enabled,
          preset: matchedPreset ? matchedPreset.value : (cronVal ? '__custom__' : ''),
          customCron: matchedPreset ? '' : cronVal,
        };
      });
      setSchedules(sched);
    }).catch(() => setSkills([])).finally(() => setLoading(false));
  }, []);

  const handlePresetChange = (skillId: string, presetValue: string) => {
    setSchedules(prev => {
      const cur = prev[skillId] || { cron: '', enabled: false, preset: '', customCron: '' };
      if (presetValue === '__custom__') {
        return { ...prev, [skillId]: { ...cur, preset: '__custom__', cron: cur.customCron || cur.cron } };
      }
      return { ...prev, [skillId]: { ...cur, preset: presetValue, cron: presetValue, customCron: '' } };
    });
  };

  const handleCustomCron = (skillId: string, value: string) => {
    setSchedules(prev => {
      const cur = prev[skillId] || { cron: '', enabled: false, preset: '__custom__', customCron: '' };
      return { ...prev, [skillId]: { ...cur, cron: value, customCron: value } };
    });
  };

  const handleToggle = (skillId: string, enabled: boolean) => {
    setSchedules(prev => {
      const cur = prev[skillId] || { cron: '', enabled: false, preset: '', customCron: '' };
      return { ...prev, [skillId]: { ...cur, enabled } };
    });
    saveSchedule(skillId, { ...schedules[skillId], enabled });
  };

  const saveSchedule = async (skillId: string, sched?: any) => {
    const s = sched || schedules[skillId];
    if (!s) return;
    try {
      await api.patch(`/skills/${skillId}/schedule`, { cron: s.cron || null, enabled: s.enabled });
      addToast('Schedule saved', 'success');
    } catch (err: any) {
      addToast(err.message || 'Failed to save schedule', 'error');
    }
  };

  const saveAll = async () => {
    const skillIds = Object.keys(schedules);
    if (skillIds.length === 0) return;
    setSavingAll(true);
    try {
      await Promise.all(skillIds.map(id => api.patch(`/skills/${id}/schedule`, {
        cron: schedules[id]?.cron || null,
        enabled: schedules[id]?.enabled ?? false,
      })));
      addToast(`Saved ${skillIds.length} skill schedules`, 'success');
    } catch (err: any) {
      addToast(err.message || 'Some schedules failed to save', 'error');
    } finally {
      setSavingAll(false);
    }
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Skeleton height={24} width={200} />
        {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} height={56} />)}
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 720 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <h2 style={{ fontSize: 18, fontWeight: 600, color: colors.text, margin: 0 }}>Skill Scheduling</h2>
        <button
          onClick={saveAll}
          disabled={savingAll || skills.length === 0}
          style={{
            fontSize: 12,
            fontWeight: 600,
            fontFamily: fonts.sans,
            color: '#fff',
            background: savingAll ? colors.textMuted : colors.accent,
            border: 'none',
            borderRadius: 6,
            padding: '7px 16px',
            cursor: savingAll ? 'default' : 'pointer',
          }}
        >
          {savingAll ? 'Saving...' : 'Save All'}
        </button>
      </div>
      {toasts.map(t => (
        <Toast key={t.id} message={t.message} type={t.type} onClose={() => removeToast(t.id)} />
      ))}

      {skills.length === 0 ? (
        <div style={{
          background: colors.surface,
          border: `1px solid ${colors.border}`,
          borderRadius: 10,
          padding: 40,
          textAlign: 'center',
        }}>
          <p style={{ fontSize: 13, color: colors.textMuted }}>No skills registered</p>
        </div>
      ) : (
        <div style={{
          background: colors.surface,
          border: `1px solid ${colors.border}`,
          borderRadius: 10,
          overflow: 'hidden',
        }}>
          {skills.map((skill, idx) => {
            const sched = schedules[skill.id] || { cron: '', enabled: false, preset: '', customCron: '' };
            const isCustom = sched.preset === '__custom__';

            return (
              <div
                key={skill.id}
                style={{
                  padding: '14px 20px',
                  borderBottom: idx < skills.length - 1 ? `1px solid ${colors.border}` : 'none',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 16,
                  flexWrap: 'wrap',
                }}
              >
                <div style={{ flex: 1, minWidth: 140 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: colors.text }}>{skill.name || skill.id}</span>
                  {!skill.schedule && (
                    <span style={{ fontSize: 11, color: colors.textMuted, marginLeft: 8 }}>Not scheduled</span>
                  )}
                </div>
                <select
                  value={sched.preset || ''}
                  onChange={e => handlePresetChange(skill.id, e.target.value)}
                  style={{
                    fontSize: 12,
                    fontFamily: fonts.sans,
                    color: colors.text,
                    background: colors.surfaceRaised,
                    border: `1px solid ${colors.border}`,
                    borderRadius: 6,
                    padding: '5px 10px',
                    cursor: 'pointer',
                    minWidth: 180,
                  }}
                >
                  <option value="">Select schedule</option>
                  {CRON_PRESETS.map(p => (
                    <option key={p.value} value={p.value}>{p.label}</option>
                  ))}
                </select>
                {isCustom && (
                  <details style={{ marginTop: 6 }}>
                    <summary style={{ fontSize: 11, color: colors.textMuted, cursor: "pointer", fontFamily: fonts.sans, userSelect: "none" }}>
                      Advanced: Custom cron expression
                    </summary>
                    <input
                      style={{ fontFamily: fonts.mono, fontSize: 12, marginTop: 6, width: "100%", background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 6, padding: "6px 10px", color: colors.text, boxSizing: "border-box" as const }}
                      placeholder="* * * * *"
                      value={sched.customCron}
                      onChange={e => handleCustomCron(skill.id, e.target.value)}
                    />
                  </details>
                )}
                <Toggle enabled={sched.enabled} onChange={v => handleToggle(skill.id, v)} />
                <button
                  onClick={() => saveSchedule(skill.id)}
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    fontFamily: fonts.sans,
                    color: '#fff',
                    background: colors.accent,
                    border: 'none',
                    borderRadius: 6,
                    padding: '5px 12px',
                    cursor: 'pointer',
                  }}
                >
                  Save
                </button>
              </div>
            );
          })}
        </div>
      )}
      {experimentalSkills.length > 0 && (
        <div style={{ marginTop: 32 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: colors.text, fontFamily: fonts.sans, marginBottom: 4 }}>Experimental Skills</div>
          <div style={{ fontSize: 12, color: colors.textMuted, fontFamily: fonts.sans, marginBottom: 16 }}>
            Beta features — findings may be less accurate than production skills.
          </div>
          {experimentalSkills.map((skill: any) => {
            const isEnabled = enabledExperimentalIds.includes(skill.id);
            return (
              <div key={skill.id} style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', padding: '12px 0', borderBottom: `1px solid ${colors.border}` }}>
                <div style={{ flex: 1, marginRight: 16 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <span style={{ fontSize: 14 }}>🧪</span>
                    <span style={{ fontSize: 13, fontWeight: 500, color: colors.text, fontFamily: fonts.sans }}>{skill.name}</span>
                    <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 10, background: '#78350f', color: '#fef3c7', fontWeight: 600, fontFamily: fonts.sans }}>BETA</span>
                  </div>
                  <div style={{ fontSize: 12, color: colors.textSecondary, fontFamily: fonts.sans, lineHeight: 1.5 }}>{skill.description}</div>
                </div>
                <div style={{ flexShrink: 0 }}>
                  <WsToggle on={isEnabled} onChange={() => toggleExperimentalSkill(skill.id)} />
                </div>
              </div>
            );
          })}
        </div>
      )}

    </div>
  );
}

function TokensSection() {
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState('30d');
  const [data, setData] = useState<any>(null);
  const [isEmpty, setIsEmpty] = useState(false);

  const fetchData = (p: string) => {
    setLoading(true);
    setIsEmpty(false);
    api.get(`/token-usage/summary?period=${p}`)
      .then((d: any) => {
        if (!d || d.totalTokens === 0) {
          setIsEmpty(true);
          setData(null);
        } else {
          setData(d);
        }
      })
      .catch(() => {
        setIsEmpty(true);
        setData(null);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchData(period);
  }, []);

  const handlePeriodChange = (p: string) => {
    setPeriod(p);
    fetchData(p);
  };

  const budget = 100000;
  const totalTokens = data?.totalTokens || 0;
  const remaining = Math.max(budget - totalTokens, 0);
  const pct = Math.min((totalTokens / budget) * 100, 100);
  const barColor = pct > 80 ? colors.red : pct > 50 ? colors.yellow : colors.green;

  const now = new Date();
  const monthLabel = now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <Skeleton height={24} width={200} />
        <Skeleton height={80} />
        <Skeleton height={200} />
      </div>
    );
  }

  if (isEmpty) {
    return (
      <div style={{ maxWidth: 640 }}>
        <h2 style={{ fontSize: 18, fontWeight: 600, color: colors.text, marginBottom: 24 }}>Token Budget</h2>
        <div style={{
          background: colors.surface,
          border: `1px solid ${colors.border}`,
          borderRadius: 10,
          padding: 40,
          textAlign: 'center',
        }}>
          <p style={{ fontSize: 13, color: colors.textMuted, lineHeight: 1.6 }}>
            Token usage tracking is not yet configured for this workspace. Usage data will appear here after your next skill run.
          </p>
        </div>
      </div>
    );
  }

  const bySkill = data?.bySkill || [];

  return (
    <div style={{ maxWidth: 720 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h2 style={{ fontSize: 18, fontWeight: 600, color: colors.text, marginBottom: 4 }}>Token Budget</h2>
          <p style={{ fontSize: 12, color: colors.textMuted }}>{monthLabel}</p>
        </div>
        <select
          value={period}
          onChange={e => handlePeriodChange(e.target.value)}
          style={{
            fontSize: 12,
            fontFamily: fonts.sans,
            color: colors.text,
            background: colors.surfaceRaised,
            border: `1px solid ${colors.border}`,
            borderRadius: 6,
            padding: '5px 10px',
            cursor: 'pointer',
          }}
        >
          <option value="7d">Last 7 days</option>
          <option value="30d">Last 30 days</option>
          <option value="90d">Last 90 days</option>
        </select>
      </div>

      <div style={{
        background: colors.surface,
        border: `1px solid ${colors.border}`,
        borderRadius: 10,
        padding: 24,
        marginBottom: 16,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Tokens Used
            </div>
            <div style={{ fontSize: 22, fontWeight: 700, fontFamily: fonts.mono, color: colors.text, marginTop: 4 }}>
              {formatTokens(totalTokens)}
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Remaining
            </div>
            <div style={{ fontSize: 22, fontWeight: 700, fontFamily: fonts.mono, color: colors.text, marginTop: 4 }}>
              {formatTokens(remaining)}
            </div>
          </div>
        </div>
        <div style={{ fontSize: 11, color: colors.textMuted, marginBottom: 6 }}>
          Budget: {formatTokens(budget)}
        </div>
        <div style={{
          width: '100%',
          height: 10,
          background: colors.surfaceRaised,
          borderRadius: 5,
          overflow: 'hidden',
        }}>
          <div style={{
            width: `${pct}%`,
            height: '100%',
            background: barColor,
            borderRadius: 5,
            transition: 'width 0.5s ease',
          }} />
        </div>
        {data?.totalCostUsd != null && (
          <div style={{ fontSize: 11, color: colors.textMuted, marginTop: 8 }}>
            Total cost: ${data.totalCostUsd.toFixed(2)}
          </div>
        )}
      </div>

      {bySkill.length > 0 && (
        <div style={{
          background: colors.surface,
          border: `1px solid ${colors.border}`,
          borderRadius: 10,
          overflow: 'hidden',
        }}>
          <div style={{ padding: '16px 20px', borderBottom: `1px solid ${colors.border}` }}>
            <h3 style={{ fontSize: 14, fontWeight: 600, color: colors.text }}>By Skill</h3>
          </div>
          <div style={{
            display: 'grid',
            gridTemplateColumns: '2fr 1fr 80px 80px',
            gap: 0,
            padding: '8px 20px',
            fontSize: 10,
            fontWeight: 600,
            color: colors.textMuted,
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            borderBottom: `1px solid ${colors.border}`,
          }}>
            <span>Skill</span>
            <span style={{ textAlign: 'right' }}>Tokens</span>
            <span style={{ textAlign: 'right' }}>Runs</span>
            <span style={{ textAlign: 'right' }}>Cost</span>
          </div>
          {bySkill.map((row: any, idx: number) => (
            <div
              key={row.skillId || idx}
              style={{
                display: 'grid',
                gridTemplateColumns: '2fr 1fr 80px 80px',
                gap: 0,
                padding: '10px 20px',
                fontSize: 12,
                borderBottom: idx < bySkill.length - 1 ? `1px solid ${colors.border}` : 'none',
                alignItems: 'center',
              }}
            >
              <span style={{ color: colors.text, fontWeight: 500 }}>
                {row.skillId}
                {row.trend && row.trend !== 'stable' && (
                  <span style={{
                    marginLeft: 8,
                    fontSize: 10,
                    color: row.trend === 'increasing' ? colors.yellow : colors.green,
                  }}>
                    {row.trend === 'increasing' ? '↑' : '↓'}
                  </span>
                )}
              </span>
              <span style={{ textAlign: 'right', fontFamily: fonts.mono, color: colors.textSecondary }}>
                {formatTokens((row.avgInputTokens || 0) + (row.avgOutputTokens || 0))}
              </span>
              <span style={{ textAlign: 'right', fontFamily: fonts.mono, color: colors.textSecondary }}>
                {row.runs}
              </span>
              <span style={{ textAlign: 'right', fontFamily: fonts.mono, color: colors.textSecondary }}>
                ${row.totalCostUsd?.toFixed(2) || '0.00'}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

interface LearningSummary {
  annotations: {
    active: number;
    byType: Record<string, number>;
    byEntity: Record<string, number>;
    expiringIn30Days: number;
    recentlyAdded: Array<{
      entity_name: string | null;
      content: string;
      source: string;
      created_at: string;
      annotation_type: string;
      entity_type: string;
    }>;
  };
  feedbackSignals: {
    last30Days: {
      thumbs_up: number;
      thumbs_down: number;
      dismiss: number;
      confirm: number;
      correct: number;
      total: number;
    };
    byWeek: Array<{ week_start: string; count: number }>;
  };
  configSuggestions: {
    pending: number;
    accepted: number;
    dismissed: number;
    fromFeedback: number;
    fromSkills: number;
    items: Array<{
      id: string;
      message: string;
      confidence: number;
      source_skill: string;
      created_at: string;
    }>;
  };
  health: {
    learningRate: 'growing' | 'stable' | 'declining';
    annotationCoverage: number;
    configConfidence: number;
  };
}

function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH}h ago`;
  const diffD = Math.floor(diffH / 24);
  if (diffD < 30) return `${diffD}d ago`;
  const diffMo = Math.floor(diffD / 30);
  return `${diffMo}mo ago`;
}

const SIGNAL_COLORS: Record<string, string> = {
  thumbs_up: '#22c55e',
  thumbs_down: '#ef4444',
  confirm: '#3b82f6',
  correct: '#eab308',
  dismiss: '#5a6578',
};

const SIGNAL_LABELS: Record<string, string> = {
  thumbs_up: 'Thumbs Up',
  thumbs_down: 'Thumbs Down',
  confirm: 'Confirm',
  correct: 'Correction',
  dismiss: 'Dismiss',
};

function LearningSection() {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<LearningSummary | null>(null);
  const [isEmpty, setIsEmpty] = useState(false);

  useEffect(() => {
    api.get('/learning/summary')
      .then((d: any) => {
        if (!d || (d.feedbackSignals?.last30Days?.total === 0 && d.annotations?.active === 0)) {
          setIsEmpty(true);
          setData(null);
        } else {
          setData(d);
        }
      })
      .catch(() => {
        setIsEmpty(true);
        setData(null);
      })
      .finally(() => setLoading(false));
  }, []);

  const resolveSuggestion = async (id: string, action: 'accepted' | 'dismissed') => {
    try {
      await api.post(`/workspace-config/suggestions/${id}/resolve`, { action });
      setData(prev => prev ? {
        ...prev,
        configSuggestions: {
          ...prev.configSuggestions,
          items: prev.configSuggestions.items.filter(s => s.id !== id),
          pending: prev.configSuggestions.pending - 1,
          [action]: (prev.configSuggestions as any)[action] + 1,
        }
      } : prev);
    } catch (err) {
      console.error('Failed to resolve suggestion:', err);
    }
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <Skeleton height={24} width={200} />
        <div style={{ display: 'flex', gap: 12 }}>
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} height={90} style={{ flex: 1 }} />)}
        </div>
        <Skeleton height={160} />
        <div style={{ display: 'flex', gap: 12 }}>
          <Skeleton height={200} style={{ flex: 1 }} />
          <Skeleton height={200} style={{ flex: 1 }} />
        </div>
        <Skeleton height={160} />
      </div>
    );
  }

  if (isEmpty || !data) {
    return (
      <div style={{ maxWidth: 640 }}>
        <h2 style={{ fontSize: 18, fontWeight: 600, color: colors.text, marginBottom: 24 }}>Workspace Learning</h2>
        <div style={{
          background: colors.surface,
          border: `1px solid ${colors.border}`,
          borderRadius: 10,
          padding: 40,
          textAlign: 'center',
        }}>
          <p style={{ fontSize: 13, color: colors.textMuted, lineHeight: 1.6 }}>
            No feedback signals yet. As you interact with Pandora, the system will start learning from your feedback.
          </p>
        </div>
      </div>
    );
  }

  const { annotations, feedbackSignals, configSuggestions, health } = data;
  const byWeek = feedbackSignals.byWeek || [];
  const maxWeekCount = Math.max(...byWeek.map(w => w.count), 1);
  const last30 = feedbackSignals.last30Days;
  const signalTypes = ['thumbs_up', 'thumbs_down', 'confirm', 'correct', 'dismiss'] as const;
  const maxSignalCount = Math.max(...signalTypes.map(s => (last30 as any)[s] || 0), 1);

  const healthDotColor = health.learningRate === 'growing' ? colors.green : health.learningRate === 'stable' ? colors.yellow : colors.red;

  return (
    <div style={{ maxWidth: 860 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
        <h2 style={{ fontSize: 18, fontWeight: 600, color: colors.text }}>Workspace Learning</h2>
        <div style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          fontSize: 11,
          fontWeight: 500,
          color: colors.textMuted,
          background: colors.surfaceRaised,
          padding: '3px 10px',
          borderRadius: 12,
        }}>
          <div style={{
            width: 7,
            height: 7,
            borderRadius: '50%',
            background: healthDotColor,
          }} />
          {health.learningRate}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
        {[
          { value: annotations.active, label: 'Active Annotations' },
          { value: last30.total, label: 'Feedback Signals (30d)' },
          { value: last30.correct, label: 'Corrections' },
          { value: configSuggestions.pending, label: 'Pending Suggestions' },
        ].map((card, i) => (
          <div key={i} style={{
            flex: 1,
            background: colors.surface,
            border: `1px solid ${colors.border}`,
            borderRadius: 10,
            padding: 16,
            textAlign: 'center',
          }}>
            <div style={{ fontSize: 28, fontWeight: 700, color: colors.text }}>{card.value}</div>
            <div style={{ fontSize: 12, color: colors.textMuted, marginTop: 4 }}>{card.label}</div>
          </div>
        ))}
      </div>

      <div style={{
        background: colors.surface,
        border: `1px solid ${colors.border}`,
        borderRadius: 10,
        padding: 20,
        marginBottom: 16,
      }}>
        <h3 style={{ fontSize: 14, fontWeight: 600, color: colors.text, marginBottom: 16 }}>Learning Rate</h3>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 100 }}>
          {byWeek.slice(-8).filter(w => !isNaN(new Date(w.week_start).getTime())).map((w, i) => {
            const barH = Math.max((w.count / maxWeekCount) * 80, 2);
            const weekLabel = new Date(w.week_start).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
            return (
              <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <div style={{ fontSize: 10, color: colors.textMuted, marginBottom: 4 }}>{w.count}</div>
                <div style={{
                  width: '100%',
                  maxWidth: 40,
                  height: barH,
                  background: colors.accent,
                  borderRadius: 3,
                }} />
                <div style={{ fontSize: 9, color: colors.textMuted, marginTop: 4 }}>{weekLabel}</div>
              </div>
            );
          })}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
        <div style={{
          flex: 1,
          background: colors.surface,
          border: `1px solid ${colors.border}`,
          borderRadius: 10,
          padding: 20,
        }}>
          <h3 style={{ fontSize: 14, fontWeight: 600, color: colors.text, marginBottom: 12 }}>Recent Annotations</h3>
          {annotations.recentlyAdded.length === 0 ? (
            <p style={{ fontSize: 12, color: colors.textMuted }}>No annotations yet</p>
          ) : (
            annotations.recentlyAdded.slice(0, 5).map((a, i) => (
              <div key={i} style={{
                padding: '8px 0',
                borderBottom: i < Math.min(annotations.recentlyAdded.length, 5) - 1 ? `1px solid ${colors.border}` : 'none',
                display: 'flex',
                alignItems: 'flex-start',
                gap: 8,
              }}>
                <span style={{ fontSize: 13, color: colors.textMuted, flexShrink: 0, marginTop: 1 }}>
                  {a.annotation_type === 'confirmation' ? '\u2713' : '\u2691'}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  {a.entity_name && (
                    <div style={{ fontSize: 12, fontWeight: 600, color: colors.text, marginBottom: 2 }}>
                      {a.entity_name}
                    </div>
                  )}
                  <div style={{ fontSize: 12, color: colors.textSecondary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {a.content.length > 80 ? a.content.slice(0, 80) + '...' : a.content}
                  </div>
                  <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                    <span style={{
                      fontSize: 10,
                      fontWeight: 500,
                      color: colors.accent,
                      background: colors.accentSoft,
                      padding: '1px 6px',
                      borderRadius: 4,
                    }}>
                      {a.source}
                    </span>
                    <span style={{ fontSize: 10, color: colors.textMuted }}>{timeAgo(a.created_at)}</span>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        <div style={{
          flex: 1,
          background: colors.surface,
          border: `1px solid ${colors.border}`,
          borderRadius: 10,
          padding: 20,
        }}>
          <h3 style={{ fontSize: 14, fontWeight: 600, color: colors.text, marginBottom: 12 }}>Config Suggestions from Feedback</h3>
          {configSuggestions.items.length === 0 ? (
            <p style={{ fontSize: 12, color: colors.textMuted }}>No pending suggestions</p>
          ) : (
            configSuggestions.items.map((s) => (
              <div key={s.id} style={{
                padding: '10px 0',
                borderBottom: `1px solid ${colors.border}`,
              }}>
                <div style={{ fontSize: 12, color: colors.text, marginBottom: 4 }}>{s.message}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <span style={{ fontSize: 10, color: colors.textMuted }}>
                    {Math.round(s.confidence * 100)}% confidence
                  </span>
                  <span style={{
                    fontSize: 10,
                    fontWeight: 500,
                    color: colors.accent,
                    background: colors.accentSoft,
                    padding: '1px 6px',
                    borderRadius: 4,
                  }}>
                    {s.source_skill}
                  </span>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    onClick={() => resolveSuggestion(s.id, 'accepted')}
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      fontFamily: fonts.sans,
                      color: '#fff',
                      background: colors.accent,
                      border: 'none',
                      borderRadius: 6,
                      padding: '4px 12px',
                      cursor: 'pointer',
                    }}
                  >
                    Accept
                  </button>
                  <button
                    onClick={() => resolveSuggestion(s.id, 'dismissed')}
                    style={{
                      fontSize: 11,
                      fontWeight: 500,
                      fontFamily: fonts.sans,
                      color: colors.textMuted,
                      background: 'transparent',
                      border: `1px solid ${colors.border}`,
                      borderRadius: 6,
                      padding: '4px 12px',
                      cursor: 'pointer',
                    }}
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      <div style={{
        background: colors.surface,
        border: `1px solid ${colors.border}`,
        borderRadius: 10,
        padding: 20,
      }}>
        <h3 style={{ fontSize: 14, fontWeight: 600, color: colors.text, marginBottom: 12 }}>Feedback Breakdown</h3>
        {signalTypes.map((type) => {
          const count = (last30 as any)[type] || 0;
          const barWidth = maxSignalCount > 0 ? (count / maxSignalCount) * 100 : 0;
          return (
            <div key={type} style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: '6px 0',
            }}>
              <span style={{ fontSize: 12, color: colors.textSecondary, width: 100, flexShrink: 0 }}>
                {SIGNAL_LABELS[type]}
              </span>
              <div style={{ flex: 1, height: 8, background: colors.surfaceRaised, borderRadius: 4, overflow: 'hidden' }}>
                <div style={{
                  width: `${barWidth}%`,
                  height: '100%',
                  background: SIGNAL_COLORS[type],
                  borderRadius: 4,
                  transition: 'width 0.3s ease',
                }} />
              </div>
              <span style={{ fontSize: 12, fontWeight: 600, color: colors.text, width: 36, textAlign: 'right', flexShrink: 0 }}>
                {count}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function QuotasSection() {
  const [quotas, setQuotas] = useState<any[]>([]);
  const [periods, setPeriods] = useState<any[]>([]);
  const [currentPeriodIdx, setCurrentPeriodIdx] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState<any>(null);
  const [previewSource, setPreviewSource] = useState<'csv' | 'hubspot' | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingQuotaId, setEditingQuotaId] = useState<string | null>(null);
  const [editAmount, setEditAmount] = useState('');
  const [pendingGoals, setPendingGoals] = useState<any>(null);
  const [syncing, setSyncing] = useState(false);
  const [hubspotConnected, setHubspotConnected] = useState(false);
  const [teamTotal, setTeamTotal] = useState(0);
  const [periodLabel, setPeriodLabel] = useState('');
  const [repCount, setRepCount] = useState(0);
  const [addName, setAddName] = useState('');
  const [addEmail, setAddEmail] = useState('');
  const [addAmount, setAddAmount] = useState('');
  const [addQuarter, setAddQuarter] = useState(() => {
    const q = Math.ceil((new Date().getMonth() + 1) / 3);
    return `Q${q}`;
  });
  const [addYear, setAddYear] = useState(() => String(new Date().getFullYear()));
  const [repSuggestions, setRepSuggestions] = useState<Array<{ rep_name: string; rep_email: string | null }>>([]);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const loadQuotas = (periodsArr?: any[], idx?: number) => {
    const p = periodsArr || periods;
    const i = idx ?? currentPeriodIdx;
    let url = '/quotas';
    if (p.length > 0 && p[i]) {
      url += `?period_start=${p[i].start_date}&period_end=${p[i].end_date}`;
    }
    return api.get(url).then((data: any) => {
      setQuotas(data.quotas || []);
      setTeamTotal(data.teamTotal || 0);
      const per = data.period;
      setPeriodLabel(typeof per === 'object' && per !== null ? per.name || '' : per || '');
      setRepCount(data.repCount || 0);
    }).catch(() => setQuotas([]));
  };

  useEffect(() => {
    setLoading(true);
    Promise.all([
      api.get('/quotas/periods').catch(() => []),
      api.get('/quotas').catch(() => ({ quotas: [], teamTotal: 0, period: '', repCount: 0 })),
      api.get('/quotas/pending-goals').catch(() => null),
      api.get('/connectors/health').catch(() => []),
      api.get('/quotas/reps').catch(() => ({ reps: [] })),
    ]).then(([periodsData, quotasData, goalsData, healthData, repsData]) => {
      setRepSuggestions(repsData?.reps || []);
      const pArr = Array.isArray(periodsData) ? periodsData : periodsData?.periods || [];
      setPeriods(pArr);
      const now = new Date();
      const curIdx = pArr.findIndex((p: any) => new Date(p.start_date) <= now && new Date(p.end_date) >= now);
      setCurrentPeriodIdx(curIdx >= 0 ? curIdx : 0);
      setQuotas(quotasData?.quotas || []);
      setTeamTotal(quotasData?.teamTotal || 0);
      const qp = quotasData?.period;
      setPeriodLabel(typeof qp === 'object' && qp !== null ? qp.name || '' : qp || '');
      setRepCount(quotasData?.repCount || 0);
      setPendingGoals(goalsData);
      const healthArr = Array.isArray(healthData) ? healthData : healthData?.connectors || [];
      const hs = healthArr.find((c: any) => c.connector_name === 'hubspot' && c.status === 'healthy');
      setHubspotConnected(!!hs);
    }).catch(() => {
      setError('Failed to load quota data');
    }).finally(() => setLoading(false));
  }, []);

  const navigatePeriod = (dir: number) => {
    const newIdx = currentPeriodIdx + dir;
    if (newIdx < 0 || newIdx >= periods.length) return;
    setCurrentPeriodIdx(newIdx);
    loadQuotas(periods, newIdx);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError('');
    setSyncing(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const result = await api.upload('/quotas/upload', formData);
      setPreview(result);
      setPreviewSource('csv');
    } catch (err: any) {
      setError(err.message || 'Upload failed');
    } finally {
      setSyncing(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleHubspotSync = async () => {
    setError('');
    setSyncing(true);
    try {
      const result = await api.post('/quotas/sync-hubspot');
      setPreview(result);
      setPreviewSource('hubspot');
    } catch (err: any) {
      if (err.message?.includes('missing_scope')) {
        setError('HubSpot requires re-authorization with the goals scope. Please reconnect HubSpot in Connectors.');
      } else {
        setError(err.message || 'HubSpot sync failed');
      }
    } finally {
      setSyncing(false);
    }
  };

  const handleConfirmImport = async () => {
    setError('');
    setSyncing(true);
    try {
      if (previewSource === 'csv') {
        await api.post('/quotas/confirm', { uploadId: preview.uploadId, preview });
      } else if (previewSource === 'hubspot') {
        await api.post('/quotas/sync-hubspot/confirm', { goals: preview.goals });
      }
      setPreview(null);
      setPreviewSource(null);
      await loadQuotas();
    } catch (err: any) {
      setError(err.message || 'Import failed');
    } finally {
      setSyncing(false);
    }
  };

  const handleDismissGoals = async () => {
    try {
      await api.post('/quotas/dismiss-pending-goals');
      setPendingGoals(null);
    } catch {}
  };

  const handleEditSave = async (quotaId: string) => {
    try {
      await api.put(`/quotas/${quotaId}`, { quota_amount: parseFloat(editAmount) });
      setEditingQuotaId(null);
      setEditAmount('');
      await loadQuotas();
    } catch (err: any) {
      setError(err.message || 'Failed to update quota');
    }
  };

  const handleDelete = async (quotaId: string) => {
    if (!window.confirm('Delete this quota?')) return;
    try {
      await api.delete(`/quotas/${quotaId}`);
      await loadQuotas();
    } catch (err: any) {
      setError(err.message || 'Failed to delete quota');
    }
  };

  const getQuarterDates = (quarter: string, year: string) => {
    const y = parseInt(year);
    const qNum = parseInt(quarter.replace('Q', ''));
    const startMonth = (qNum - 1) * 3;
    const start = new Date(y, startMonth, 1);
    const end = new Date(y, startMonth + 3, 0);
    return {
      start: start.toISOString().slice(0, 10),
      end: end.toISOString().slice(0, 10),
    };
  };

  const handleAddQuota = async () => {
    if (!addName || !addEmail || !addAmount) return;
    setError('');
    const currentPeriod = periods[currentPeriodIdx];
    let periodStart: string;
    let periodEnd: string;
    let periodType = 'quarterly';
    let periodLabelStr: string;

    if (currentPeriod) {
      periodStart = currentPeriod.start_date;
      periodEnd = currentPeriod.end_date;
      periodLabelStr = currentPeriod.name;
      periodType = currentPeriod.period_type || 'quarterly';
    } else {
      const dates = getQuarterDates(addQuarter, addYear);
      periodStart = dates.start;
      periodEnd = dates.end;
      periodLabelStr = `${addQuarter} ${addYear}`;
    }

    try {
      await api.post('/quotas/add', {
        rep_name: addName,
        email: addEmail,
        quota_amount: parseFloat(addAmount),
        period_start: periodStart,
        period_end: periodEnd,
        period_type: periodType,
        period_label: periodLabelStr,
      });
      setShowAddForm(false);
      setAddName('');
      setAddEmail('');
      setAddAmount('');
      const pData = await api.get('/quotas/periods').catch(() => []);
      const pArr = Array.isArray(pData) ? pData : pData?.periods || [];
      setPeriods(pArr);
      const now = new Date();
      const curIdx = pArr.findIndex((p: any) => new Date(p.start_date) <= now && new Date(p.end_date) >= now);
      setCurrentPeriodIdx(curIdx >= 0 ? curIdx : 0);
      await loadQuotas(pArr, curIdx >= 0 ? curIdx : 0);
    } catch (err: any) {
      setError(err.message || 'Failed to add quota');
    }
  };

  const sourceBadge = (source: string) => {
    const map: Record<string, { bg: string; color: string; label: string }> = {
      hubspot_goals: { bg: 'rgba(59,130,246,0.15)', color: colors.accent, label: 'HubSpot' },
      upload: { bg: 'rgba(148,163,184,0.15)', color: colors.textSecondary, label: 'Upload' },
      manual: { bg: 'rgba(34,197,94,0.15)', color: colors.green, label: 'Manual' },
    };
    const s = map[source?.toLowerCase()] || map.manual;
    return (
      <span style={{
        fontSize: 10,
        fontWeight: 600,
        color: s.color,
        background: s.bg,
        padding: '2px 8px',
        borderRadius: 4,
      }}>
        {s.label}
      </span>
    );
  };

  const importButtons = (
    <div style={{ display: 'flex', gap: 10 }}>
      <input
        ref={fileInputRef}
        type="file"
        accept=".csv,.xlsx,.xls"
        onChange={handleFileUpload}
        style={{ display: 'none' }}
      />
      <button
        onClick={() => fileInputRef.current?.click()}
        disabled={syncing}
        style={{
          fontSize: 12,
          fontWeight: 600,
          fontFamily: fonts.sans,
          color: '#fff',
          background: colors.accent,
          border: 'none',
          borderRadius: 6,
          padding: '8px 16px',
          cursor: syncing ? 'not-allowed' : 'pointer',
          opacity: syncing ? 0.6 : 1,
        }}
        onMouseEnter={e => { if (!syncing) e.currentTarget.style.background = '#2563eb'; }}
        onMouseLeave={e => { e.currentTarget.style.background = colors.accent; }}
      >
        Upload CSV / Excel
      </button>
      {hubspotConnected && (
        <button
          onClick={handleHubspotSync}
          disabled={syncing}
          style={{
            fontSize: 12,
            fontWeight: 600,
            fontFamily: fonts.sans,
            color: colors.accent,
            background: 'transparent',
            border: `1px solid ${colors.accent}`,
            borderRadius: 6,
            padding: '8px 16px',
            cursor: syncing ? 'not-allowed' : 'pointer',
            opacity: syncing ? 0.6 : 1,
          }}
          onMouseEnter={e => { if (!syncing) e.currentTarget.style.background = colors.accentSoft; }}
          onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
        >
          {syncing ? 'Syncing...' : 'HubSpot Goals Sync'}
        </button>
      )}
    </div>
  );

  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <Skeleton height={24} width={200} />
        <Skeleton height={80} />
        <Skeleton height={200} />
      </div>
    );
  }

  const emptyInputStyle: React.CSSProperties = {
    fontSize: 12,
    fontFamily: fonts.sans,
    color: colors.text,
    background: colors.surfaceRaised,
    border: `1px solid ${colors.border}`,
    borderRadius: 6,
    padding: '6px 10px',
    outline: 'none',
  };

  if (quotas.length === 0 && periods.length === 0) {
    return (
      <div style={{ maxWidth: 640 }}>
        <h2 style={{ fontSize: 18, fontWeight: 600, color: colors.text, marginBottom: 24 }}>Quotas</h2>
        {error && (
          <div style={{ padding: '8px 14px', marginBottom: 16, borderRadius: 8, background: colors.redSoft, border: `1px solid ${colors.red}`, color: colors.red, fontSize: 12, fontWeight: 500 }}>
            {error}
          </div>
        )}
        <div style={{
          background: colors.surface,
          border: `1px solid ${colors.border}`,
          borderRadius: 10,
          padding: 48,
          textAlign: 'center',
        }}>
          <p style={{ fontSize: 15, fontWeight: 600, color: colors.text, marginBottom: 8 }}>No quotas set up yet.</p>
          <p style={{ fontSize: 13, color: colors.textSecondary, lineHeight: 1.6, marginBottom: 24, maxWidth: 440, margin: '0 auto 24px' }}>
            Quotas enable attainment tracking, gap analysis, and rep performance scoring across Pipeline Coverage and Forecast reports.
          </p>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
            {importButtons}
            <button
              onClick={() => setShowAddForm(true)}
              style={{
                fontSize: 12,
                fontWeight: 600,
                fontFamily: fonts.sans,
                color: colors.green,
                background: 'transparent',
                border: `1px solid ${colors.green}`,
                borderRadius: 6,
                padding: '8px 16px',
                cursor: 'pointer',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = 'rgba(34,197,94,0.1)'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
            >
              + Add Manually
            </button>
          </div>
        </div>

        {showAddForm && (
          <div style={{
            background: colors.surface,
            border: `1px solid ${colors.border}`,
            borderRadius: 10,
            padding: 20,
            marginTop: 16,
          }}>
            <h3 style={{ fontSize: 14, fontWeight: 600, color: colors.text, marginBottom: 12 }}>Add Rep Quota</h3>
            <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
              <select
                value={addQuarter}
                onChange={e => setAddQuarter(e.target.value)}
                style={{ ...emptyInputStyle, width: 80 }}
              >
                <option value="Q1">Q1</option>
                <option value="Q2">Q2</option>
                <option value="Q3">Q3</option>
                <option value="Q4">Q4</option>
              </select>
              <select
                value={addYear}
                onChange={e => setAddYear(e.target.value)}
                style={{ ...emptyInputStyle, width: 90 }}
              >
                {[new Date().getFullYear() - 1, new Date().getFullYear(), new Date().getFullYear() + 1].map(y => (
                  <option key={y} value={String(y)}>{y}</option>
                ))}
              </select>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <div style={{ flex: 1, minWidth: 120 }}>
                <label style={{ fontSize: 11, color: colors.textSecondary, display: 'block', marginBottom: 4 }}>Rep Name</label>
                <input
                  value={addName}
                  onChange={e => {
                    setAddName(e.target.value);
                    const match = repSuggestions.find(r => r.rep_name === e.target.value);
                    if (match?.rep_email) setAddEmail(match.rep_email);
                  }}
                  list="rep-suggestions-empty"
                  placeholder="e.g. Jane Smith"
                  style={{ ...emptyInputStyle, width: '100%' }}
                />
                <datalist id="rep-suggestions-empty">
                  {repSuggestions.map((r, i) => (
                    <option key={i} value={r.rep_name} />
                  ))}
                </datalist>
              </div>
              <div style={{ flex: 1, minWidth: 140 }}>
                <label style={{ fontSize: 11, color: colors.textSecondary, display: 'block', marginBottom: 4 }}>Email</label>
                <input
                  value={addEmail}
                  onChange={e => setAddEmail(e.target.value)}
                  placeholder="jane@company.com"
                  style={{ ...emptyInputStyle, width: '100%' }}
                />
              </div>
              <div style={{ minWidth: 100 }}>
                <label style={{ fontSize: 11, color: colors.textSecondary, display: 'block', marginBottom: 4 }}>Quota ($)</label>
                <input
                  type="number"
                  value={addAmount}
                  onChange={e => setAddAmount(e.target.value)}
                  placeholder="500000"
                  style={{ ...emptyInputStyle, width: '100%' }}
                />
              </div>
              <button
                onClick={handleAddQuota}
                disabled={!addName || !addEmail || !addAmount}
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  fontFamily: fonts.sans,
                  color: '#fff',
                  background: (!addName || !addEmail || !addAmount) ? colors.textMuted : colors.green,
                  border: 'none',
                  borderRadius: 6,
                  padding: '7px 14px',
                  cursor: (!addName || !addEmail || !addAmount) ? 'not-allowed' : 'pointer',
                  whiteSpace: 'nowrap',
                }}
              >
                Add
              </button>
              <button
                onClick={() => { setShowAddForm(false); setAddName(''); setAddEmail(''); setAddAmount(''); setAddQuarter(() => { const q = Math.ceil((new Date().getMonth() + 1) / 3); return `Q${q}`; }); setAddYear(String(new Date().getFullYear())); }}
                style={{
                  fontSize: 12,
                  fontFamily: fonts.sans,
                  color: colors.textMuted,
                  background: 'transparent',
                  border: `1px solid ${colors.border}`,
                  borderRadius: 6,
                  padding: '7px 14px',
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {preview && (
          <div style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999,
          }}>
            <div style={{ background: colors.bg, borderRadius: 12, padding: 24, maxWidth: 600, width: '90%', maxHeight: '80vh', overflow: 'auto' }}>
              <h3 style={{ fontSize: 16, fontWeight: 600, color: colors.text, marginBottom: 16 }}>Confirm Import</h3>
              <p style={{ fontSize: 13, color: colors.textSecondary, marginBottom: 16 }}>
                {preview.quotas?.length || preview.goals?.length || 0} rep quotas will be imported.
              </p>
              <div style={{ display: 'flex', gap: 10 }}>
                <button onClick={handleConfirmImport} style={{ fontSize: 12, fontWeight: 600, fontFamily: fonts.sans, color: '#fff', background: colors.accent, border: 'none', borderRadius: 6, padding: '8px 16px', cursor: 'pointer' }}>
                  Confirm
                </button>
                <button onClick={() => { setPreview(null); setPreviewSource(null); }} style={{ fontSize: 12, fontFamily: fonts.sans, color: colors.textMuted, background: 'transparent', border: `1px solid ${colors.border}`, borderRadius: 6, padding: '8px 16px', cursor: 'pointer' }}>
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  const inputStyle: React.CSSProperties = {
    fontSize: 12,
    fontFamily: fonts.sans,
    color: colors.text,
    background: colors.surfaceRaised,
    border: `1px solid ${colors.border}`,
    borderRadius: 6,
    padding: '6px 10px',
    outline: 'none',
  };

  return (
    <div style={{ maxWidth: 800 }}>
      <h2 style={{ fontSize: 18, fontWeight: 600, color: colors.text, marginBottom: 24 }}>Quotas</h2>

      {error && (
        <div style={{ padding: '8px 14px', marginBottom: 16, borderRadius: 8, background: colors.redSoft, border: `1px solid ${colors.red}`, color: colors.red, fontSize: 12, fontWeight: 500 }}>
          {error}
        </div>
      )}

      {pendingGoals?.pending && (
        <div style={{
          padding: '12px 16px',
          marginBottom: 16,
          borderRadius: 8,
          background: colors.yellowSoft,
          border: `1px solid ${colors.yellow}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          flexWrap: 'wrap',
        }}>
          <span style={{ fontSize: 13, color: colors.yellow, fontWeight: 500 }}>
            Pandora detected {pendingGoals.count || pendingGoals.goals?.length || 0} revenue goals in HubSpot. Import them as rep quotas?
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={() => {
                if (pendingGoals?.preview) {
                  setPreview(pendingGoals.preview);
                  setPreviewSource('hubspot');
                } else {
                  handleHubspotSync();
                }
              }}
              style={{
                fontSize: 11,
                fontWeight: 600,
                fontFamily: fonts.sans,
                color: '#fff',
                background: colors.yellow,
                border: 'none',
                borderRadius: 6,
                padding: '5px 12px',
                cursor: 'pointer',
              }}
              onMouseEnter={e => { e.currentTarget.style.opacity = '0.85'; }}
              onMouseLeave={e => { e.currentTarget.style.opacity = '1'; }}
            >
              Review & Import
            </button>
            <button
              onClick={handleDismissGoals}
              style={{
                fontSize: 11,
                fontWeight: 500,
                fontFamily: fonts.sans,
                color: colors.textMuted,
                background: 'transparent',
                border: `1px solid ${colors.border}`,
                borderRadius: 6,
                padding: '5px 12px',
                cursor: 'pointer',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = colors.surfaceHover; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      <div style={{
        background: colors.surface,
        border: `1px solid ${colors.border}`,
        borderRadius: 10,
        padding: 20,
        marginBottom: 16,
      }}>
        <h3 style={{ fontSize: 14, fontWeight: 600, color: colors.text, marginBottom: 12 }}>Import Quotas</h3>
        {importButtons}
      </div>

      {preview && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0,0,0,0.7)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
        }}>
          <div style={{
            background: colors.surface,
            border: `1px solid ${colors.border}`,
            borderRadius: 12,
            padding: 24,
            maxWidth: 700,
            width: '90%',
            maxHeight: '80vh',
            overflow: 'auto',
          }}>
            <h3 style={{ fontSize: 16, fontWeight: 600, color: colors.text, marginBottom: 16 }}>
              Preview — {preview.repCount || preview.goals?.length || 0} reps detected, {preview.period || ''}, {preview.periodType || ''}
            </h3>
            <div style={{ overflowX: 'auto', marginBottom: 16 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ borderBottom: `1px solid ${colors.border}` }}>
                    <th style={{ textAlign: 'left', padding: '8px 12px', color: colors.textSecondary, fontWeight: 500 }}>Rep Name</th>
                    <th style={{ textAlign: 'left', padding: '8px 12px', color: colors.textSecondary, fontWeight: 500 }}>Email</th>
                    <th style={{ textAlign: 'right', padding: '8px 12px', color: colors.textSecondary, fontWeight: 500 }}>Quota</th>
                  </tr>
                </thead>
                <tbody>
                  {(preview.quotas || preview.goals || []).map((q: any, i: number) => (
                    <tr key={i} style={{ borderBottom: `1px solid ${colors.border}` }}>
                      <td style={{ padding: '8px 12px', color: colors.text }}>{q.rep_name || q.name}</td>
                      <td style={{ padding: '8px 12px', color: colors.textSecondary }}>{q.email}</td>
                      <td style={{ padding: '8px 12px', color: colors.text, textAlign: 'right' }}>${(q.quota_amount || q.amount || 0).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {preview.warnings && preview.warnings.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                {preview.warnings.map((w: string, i: number) => (
                  <p key={i} style={{ fontSize: 12, color: colors.yellow, marginBottom: 4 }}>{w}</p>
                ))}
              </div>
            )}
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button
                onClick={() => { setPreview(null); setPreviewSource(null); }}
                style={{
                  fontSize: 12,
                  fontWeight: 500,
                  fontFamily: fonts.sans,
                  color: colors.textMuted,
                  background: 'transparent',
                  border: `1px solid ${colors.border}`,
                  borderRadius: 6,
                  padding: '8px 16px',
                  cursor: 'pointer',
                }}
                onMouseEnter={e => { e.currentTarget.style.background = colors.surfaceHover; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmImport}
                disabled={syncing}
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  fontFamily: fonts.sans,
                  color: '#fff',
                  background: colors.accent,
                  border: 'none',
                  borderRadius: 6,
                  padding: '8px 16px',
                  cursor: syncing ? 'not-allowed' : 'pointer',
                  opacity: syncing ? 0.6 : 1,
                }}
                onMouseEnter={e => { if (!syncing) e.currentTarget.style.background = '#2563eb'; }}
                onMouseLeave={e => { e.currentTarget.style.background = colors.accent; }}
              >
                {syncing ? 'Importing...' : 'Confirm & Import'}
              </button>
            </div>
          </div>
        </div>
      )}

      <div style={{
        background: colors.surface,
        border: `1px solid ${colors.border}`,
        borderRadius: 10,
        overflow: 'hidden',
        marginBottom: 16,
      }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '14px 20px',
          borderBottom: `1px solid ${colors.border}`,
        }}>
          <h3 style={{ fontSize: 14, fontWeight: 600, color: colors.text, margin: 0 }}>
            Current Quotas — {periodLabel}
          </h3>
          {periods.length > 1 && (
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                onClick={() => navigatePeriod(-1)}
                disabled={currentPeriodIdx <= 0}
                style={{
                  fontSize: 14,
                  fontFamily: fonts.sans,
                  color: currentPeriodIdx <= 0 ? colors.textMuted : colors.text,
                  background: 'transparent',
                  border: `1px solid ${colors.border}`,
                  borderRadius: 4,
                  padding: '2px 8px',
                  cursor: currentPeriodIdx <= 0 ? 'not-allowed' : 'pointer',
                }}
                onMouseEnter={e => { if (currentPeriodIdx > 0) e.currentTarget.style.background = colors.surfaceHover; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
              >
                ‹
              </button>
              <button
                onClick={() => navigatePeriod(1)}
                disabled={currentPeriodIdx >= periods.length - 1}
                style={{
                  fontSize: 14,
                  fontFamily: fonts.sans,
                  color: currentPeriodIdx >= periods.length - 1 ? colors.textMuted : colors.text,
                  background: 'transparent',
                  border: `1px solid ${colors.border}`,
                  borderRadius: 4,
                  padding: '2px 8px',
                  cursor: currentPeriodIdx >= periods.length - 1 ? 'not-allowed' : 'pointer',
                }}
                onMouseEnter={e => { if (currentPeriodIdx < periods.length - 1) e.currentTarget.style.background = colors.surfaceHover; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
              >
                ›
              </button>
            </div>
          )}
        </div>

        {quotas.length === 0 ? (
          <div style={{ padding: 32, textAlign: 'center' }}>
            <p style={{ fontSize: 13, color: colors.textMuted }}>No quotas for this period</p>
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${colors.border}` }}>
                <th style={{ textAlign: 'left', padding: '10px 16px', color: colors.textSecondary, fontWeight: 500 }}>Rep</th>
                <th style={{ textAlign: 'left', padding: '10px 16px', color: colors.textSecondary, fontWeight: 500 }}>Email</th>
                <th style={{ textAlign: 'right', padding: '10px 16px', color: colors.textSecondary, fontWeight: 500 }}>Quota</th>
                <th style={{ textAlign: 'center', padding: '10px 16px', color: colors.textSecondary, fontWeight: 500 }}>Source</th>
                <th style={{ textAlign: 'center', padding: '10px 16px', color: colors.textSecondary, fontWeight: 500 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {quotas.map((q: any) => (
                <tr key={q.id} style={{ borderBottom: `1px solid ${colors.border}` }}>
                  <td style={{ padding: '10px 16px', color: colors.text, fontWeight: 500 }}>{q.rep_name}</td>
                  <td style={{ padding: '10px 16px', color: colors.textSecondary }}>{q.email}</td>
                  <td style={{ padding: '10px 16px', textAlign: 'right' }}>
                    {editingQuotaId === q.id ? (
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6 }}>
                        <input
                          type="number"
                          value={editAmount}
                          onChange={e => setEditAmount(e.target.value)}
                          style={{ ...inputStyle, width: 100, textAlign: 'right' }}
                          autoFocus
                        />
                        <button
                          onClick={() => handleEditSave(q.id)}
                          style={{ fontSize: 11, color: colors.green, background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}
                        >
                          ✓
                        </button>
                        <button
                          onClick={() => { setEditingQuotaId(null); setEditAmount(''); }}
                          style={{ fontSize: 11, color: colors.textMuted, background: 'none', border: 'none', cursor: 'pointer' }}
                        >
                          ✕
                        </button>
                      </div>
                    ) : (
                      <span style={{ color: colors.text }}>${(q.quota_amount || 0).toLocaleString()}</span>
                    )}
                  </td>
                  <td style={{ padding: '10px 16px', textAlign: 'center' }}>{sourceBadge(q.source)}</td>
                  <td style={{ padding: '10px 16px', textAlign: 'center' }}>
                    <div style={{ display: 'flex', justifyContent: 'center', gap: 8 }}>
                      <button
                        onClick={() => { setEditingQuotaId(q.id); setEditAmount(String(q.quota_amount || '')); }}
                        title="Edit"
                        style={{ fontSize: 13, color: colors.textSecondary, background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px' }}
                        onMouseEnter={e => { e.currentTarget.style.color = colors.accent; }}
                        onMouseLeave={e => { e.currentTarget.style.color = colors.textSecondary; }}
                      >
                        ✏
                      </button>
                      <button
                        onClick={() => handleDelete(q.id)}
                        title="Delete"
                        style={{ fontSize: 13, color: colors.textSecondary, background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px' }}
                        onMouseEnter={e => { e.currentTarget.style.color = colors.red; }}
                        onMouseLeave={e => { e.currentTarget.style.color = colors.textSecondary; }}
                      >
                        🗑
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              <tr style={{ background: colors.surfaceRaised }}>
                <td style={{ padding: '10px 16px', color: colors.text, fontWeight: 700 }} colSpan={2}>Team Total</td>
                <td style={{ padding: '10px 16px', textAlign: 'right', color: colors.text, fontWeight: 700 }}>${teamTotal.toLocaleString()}</td>
                <td colSpan={2} />
              </tr>
            </tbody>
          </table>
        )}
      </div>

      {!showAddForm ? (
        <button
          onClick={() => setShowAddForm(true)}
          style={{
            fontSize: 12,
            fontWeight: 500,
            fontFamily: fonts.sans,
            color: colors.accent,
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: 0,
          }}
          onMouseEnter={e => { e.currentTarget.style.textDecoration = 'underline'; }}
          onMouseLeave={e => { e.currentTarget.style.textDecoration = 'none'; }}
        >
          + Add quota manually
        </button>
      ) : (
        <div style={{
          background: colors.surface,
          border: `1px solid ${colors.border}`,
          borderRadius: 10,
          padding: 20,
        }}>
          <h3 style={{ fontSize: 14, fontWeight: 600, color: colors.text, marginBottom: 12 }}>Add Quota</h3>
          <datalist id="quota-rep-suggestions">
            {repSuggestions.map((r, i) => (
              <option key={i} value={r.rep_name} />
            ))}
          </datalist>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
            <input
              type="text"
              placeholder="Rep Name"
              list="quota-rep-suggestions"
              value={addName}
              onChange={e => {
                const name = e.target.value;
                setAddName(name);
                // Auto-fill email when an existing rep is selected
                const match = repSuggestions.find(r => r.rep_name === name);
                if (match?.rep_email) setAddEmail(match.rep_email);
              }}
              style={{ ...inputStyle, flex: 1, minWidth: 120 }}
            />
            <input
              type="email"
              placeholder="Email"
              value={addEmail}
              onChange={e => setAddEmail(e.target.value)}
              style={{ ...inputStyle, flex: 1, minWidth: 140 }}
            />
            <input
              type="number"
              placeholder="Quota Amount"
              value={addAmount}
              onChange={e => setAddAmount(e.target.value)}
              style={{ ...inputStyle, width: 130 }}
            />
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={handleAddQuota}
              style={{
                fontSize: 12,
                fontWeight: 600,
                fontFamily: fonts.sans,
                color: '#fff',
                background: colors.accent,
                border: 'none',
                borderRadius: 6,
                padding: '6px 16px',
                cursor: 'pointer',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = '#2563eb'; }}
              onMouseLeave={e => { e.currentTarget.style.background = colors.accent; }}
            >
              Add
            </button>
            <button
              onClick={() => { setShowAddForm(false); setAddName(''); setAddEmail(''); setAddAmount(''); }}
              style={{
                fontSize: 12,
                fontWeight: 500,
                fontFamily: fonts.sans,
                color: colors.textMuted,
                background: 'transparent',
                border: `1px solid ${colors.border}`,
                borderRadius: 6,
                padding: '6px 16px',
                cursor: 'pointer',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = colors.surfaceHover; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Workspace Section Shared Styles ─────────────────────────────────────────

const wsCard: React.CSSProperties = {
  background: colors.surfaceRaised,
  border: `1px solid ${colors.border}`,
  borderRadius: 10,
  padding: 20,
  marginBottom: 16,
};

const wsInput: React.CSSProperties = {
  padding: '8px 12px',
  fontSize: 13,
  fontFamily: fonts.sans,
  background: colors.surface,
  border: `1px solid ${colors.border}`,
  borderRadius: 6,
  color: colors.text,
  outline: 'none',
  width: '100%',
  boxSizing: 'border-box' as const,
};

const wsSelect: React.CSSProperties = {
  ...wsInput,
  appearance: 'none' as const,
  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' fill='%235a6578'%3E%3Cpath d='M6 8L0 0h12z'/%3E%3C/svg%3E")`,
  backgroundRepeat: 'no-repeat',
  backgroundPosition: 'right 10px center',
  paddingRight: 30,
};

const wsBtn = (variant: 'default' | 'primary' | 'danger' | 'sm' = 'default'): React.CSSProperties => ({
  padding: variant === 'sm' ? '5px 12px' : '8px 16px',
  fontSize: variant === 'sm' ? 12 : 13,
  fontWeight: 500,
  fontFamily: fonts.sans,
  border: variant === 'primary' ? 'none' : `1px solid ${colors.border}`,
  borderRadius: 6,
  background: variant === 'primary' ? colors.accent : variant === 'danger' ? colors.redSoft : 'transparent',
  color: variant === 'primary' ? '#fff' : variant === 'danger' ? colors.red : colors.textSecondary,
  cursor: 'pointer',
  transition: 'all 0.15s',
});

const wsBadge = (color: string, bg: string): React.CSSProperties => ({
  display: 'inline-block',
  padding: '2px 8px',
  borderRadius: 4,
  fontSize: 11,
  fontWeight: 600,
  fontFamily: fonts.mono,
  color,
  background: bg,
  letterSpacing: '0.02em',
});

const wsToggleStyle = (on: boolean): React.CSSProperties => ({
  width: 40,
  height: 22,
  borderRadius: 11,
  background: on ? colors.accent : colors.borderLight,
  border: 'none',
  cursor: 'pointer',
  position: 'relative',
  transition: 'background 0.2s',
  flexShrink: 0,
});

const wsToggleDot = (on: boolean): React.CSSProperties => ({
  width: 16,
  height: 16,
  borderRadius: 8,
  background: '#fff',
  position: 'absolute',
  top: 3,
  left: on ? 21 : 3,
  transition: 'left 0.2s',
  boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
});

function WsToggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button style={wsToggleStyle(on)} onClick={() => onChange(!on)} aria-label="Toggle">
      <div style={wsToggleDot(on)} />
    </button>
  );
}

function WsSectionHeader({ title, description, count }: { title: string; description?: string; count?: number }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: colors.text, fontFamily: fonts.sans }}>{title}</h3>
        {count !== undefined && (
          <span style={wsBadge(colors.accent, colors.accentSoft)}>{count}</span>
        )}
      </div>
      {description && (
        <p style={{ margin: '4px 0 0', fontSize: 12.5, color: colors.textSecondary, fontFamily: fonts.sans, lineHeight: 1.5 }}>{description}</p>
      )}
    </div>
  );
}

// ─── Workspace Tab: General ───────────────────────────────────────────────────

function WsGeneralSection() {
  const [config, setConfig] = useState({
    timezone: 'America/New_York',
    fiscal_start: 1,
    quota_period: 'quarterly',
    week_start: 1,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api.get('/workspace-config').then((data: any) => {
      const c = data.config?.cadence;
      if (c) {
        setConfig({
          timezone: c.timezone || 'America/New_York',
          fiscal_start: c.fiscal_year_start_month || 1,
          quota_period: c.quota_period || 'quarterly',
          week_start: c.week_start_day ?? 1,
        });
      }
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      await api.patch('/workspace-config/cadence', {
        timezone: config.timezone,
        fiscal_year_start_month: Number(config.fiscal_start),
        quota_period: config.quota_period,
        week_start_day: Number(config.week_start),
        planning_cadence: 'weekly',
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      // ignore
    } finally {
      setSaving(false);
    }
  };

  const timezones = ['America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'America/Phoenix', 'Europe/London', 'Europe/Berlin', 'Asia/Tokyo', 'UTC'];
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  if (loading) return <Skeleton />;

  return (
    <div>
      <WsSectionHeader title="Workspace Settings" description="General configuration for time handling, fiscal year, and quota periods." />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        {[
          {
            label: 'Timezone', key: 'timezone' as const,
            options: timezones.map(t => ({ label: t, value: t })),
          },
          {
            label: 'Fiscal Year Start', key: 'fiscal_start' as const,
            options: months.map((m, i) => ({ label: m, value: String(i + 1) })),
          },
          {
            label: 'Quota Period', key: 'quota_period' as const,
            options: [{ label: 'Monthly', value: 'monthly' }, { label: 'Quarterly', value: 'quarterly' }, { label: 'Annual', value: 'annual' }],
          },
          {
            label: 'Week Starts On', key: 'week_start' as const,
            options: days.map((d, i) => ({ label: d, value: String(i) })),
          },
        ].map(item => (
          <div key={item.key} style={wsCard}>
            <div style={{ fontSize: 13, fontWeight: 500, color: colors.text, fontFamily: fonts.sans, marginBottom: 8 }}>{item.label}</div>
            <select
              style={wsSelect}
              value={String(config[item.key])}
              onChange={e => setConfig({ ...config, [item.key]: isNaN(Number(e.target.value)) ? e.target.value : Number(e.target.value) } as any)}
            >
              {item.options.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 8 }}>
        {saved && <span style={{ fontSize: 13, color: colors.green, fontFamily: fonts.sans, alignSelf: 'center' }}>Saved</span>}
        <button style={wsBtn('primary')} onClick={save} disabled={saving}>{saving ? 'Saving...' : 'Save Changes'}</button>
      </div>
    </div>
  );
}

// ─── Workspace Tab: Pipeline & Stages ────────────────────────────────────────

interface WsStage {
  pipeline: string;
  raw_stage: string;
  stage_normalized: string;
  is_open: boolean;
  deal_count: number;
  total_amount: number;
  won_count: number;
  lost_count: number;
  is_excluded_from_pipeline: boolean;
  is_excluded_from_win_rate: boolean;
  is_excluded_from_forecast: boolean;
}

function WsPipelineStagesSection() {
  const [stages, setStages] = useState<WsStage[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    api.get('/workspace-config/stages').then((data: any) => {
      setStages(data.stages || []);
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const toggleExclusion = (idx: number, field: 'is_excluded_from_pipeline' | 'is_excluded_from_win_rate' | 'is_excluded_from_forecast') => {
    const next = [...stages];
    next[idx] = { ...next[idx], [field]: !next[idx][field] };
    setStages(next);
  };

  const save = async () => {
    setSaving(true);
    try {
      const exclude_stages = stages.filter(s => s.is_excluded_from_pipeline).map(s => s.raw_stage);
      const wr_exclude = stages.filter(s => s.is_excluded_from_win_rate).map(s => s.raw_stage);
      const fc_exclude = stages.filter(s => s.is_excluded_from_forecast).map(s => s.raw_stage);
      await api.patch('/workspace-config/tool_filters', {
        global: { exclude_stages, exclude_pipelines: [], exclude_deal_types: [], custom_exclusions: [] },
        metric_overrides: {
          win_rate: { enabled: wr_exclude.length > 0, exclude_stages: wr_exclude },
          pipeline_value: { enabled: false },
          forecast: { enabled: fc_exclude.length > 0, exclude_stages: fc_exclude },
          velocity: { enabled: false },
          activity: { enabled: false },
        },
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      // ignore
    } finally {
      setSaving(false);
    }
  };

  const PIPELINE_COLORS = ['#3b82f6', '#a78bfa', '#22c55e', '#f97316', '#ec4899'];
  const pipelineGroups = stages.reduce((acc, s, idx) => {
    const key = s.pipeline || 'Default';
    if (!acc[key]) acc[key] = [];
    acc[key].push({ ...s, _idx: idx });
    return acc;
  }, {} as Record<string, (WsStage & { _idx: number })[]>);
  const pipelineNames = Object.keys(pipelineGroups).sort();

  if (loading) return <Skeleton />;

  return (
    <div>
      <WsSectionHeader title="Stage Configuration" description="Control which stages count for each metric type. Grouped by pipeline." />

      {pipelineNames.map((pipelineName, pIdx) => {
        const pipelineStages = pipelineGroups[pipelineName];
        const totalDeals = pipelineStages.reduce((s, st) => s + st.deal_count, 0);
        const totalAmount = pipelineStages.reduce((s, st) => s + st.total_amount, 0);
        const borderColor = PIPELINE_COLORS[pIdx % PIPELINE_COLORS.length];
        return (
          <div key={pipelineName} style={{ ...wsCard, padding: 0, marginBottom: 16, borderLeft: `3px solid ${borderColor}` }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', background: colors.surface, borderRadius: '6px 6px 0 0', borderBottom: `1px solid ${colors.border}` }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 10, height: 10, borderRadius: 2, background: borderColor }} />
                <span style={{ fontSize: 14, fontWeight: 600, color: colors.text, fontFamily: fonts.sans }}>{pipelineName}</span>
              </div>
              <span style={{ fontSize: 12, color: colors.textMuted, fontFamily: fonts.mono }}>
                {totalDeals} deals · ${(totalAmount / 1000).toFixed(0)}K
              </span>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: fonts.sans, minWidth: 700 }}>
                <thead>
                  <tr style={{ borderBottom: `1px solid ${colors.border}` }}>
                    {["Stage", "Normalized", "Deals", "Amount", "Pipeline", "Win Rate", "Forecast"].map(h => (
                      <th key={h} style={{ padding: '8px 10px', fontSize: 11, fontWeight: 600, color: colors.textMuted, textAlign: 'left', textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {pipelineStages.map((s, i) => {
                    const isClosed = !s.is_open;
                    const isWon = s.stage_normalized === 'closed_won';
                    const isLost = s.stage_normalized === 'closed_lost';
                    const hasNormMismatch = (s.raw_stage.toLowerCase().includes('closed') || s.raw_stage.toLowerCase().includes('won')) && s.stage_normalized !== 'closed_won';
                    return (
                      <tr key={`${s.pipeline}-${s.raw_stage}`} style={{ borderBottom: i < pipelineStages.length - 1 ? `1px solid ${colors.border}` : 'none', opacity: s.deal_count === 0 ? 0.5 : 1 }}>
                        <td style={{ padding: '10px 10px', fontSize: 13, color: colors.text, fontWeight: 500 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <div style={{ width: 8, height: 8, borderRadius: 4, background: isWon ? colors.green : isLost ? colors.red : borderColor, flexShrink: 0 }} />
                            {s.raw_stage}
                            {hasNormMismatch && <span title="Stage name suggests 'closed_won' but normalization differs. Fix in the dropdown →" style={{ fontSize: 12, color: colors.yellow, marginLeft: 4, cursor: 'help' }}>⚠</span>}
                          </div>
                        </td>
                        <td style={{ padding: '10px 10px' }}>
                          <select
                            value={s.stage_normalized || ''}
                            onChange={(e) => {
                              const newNorm = e.target.value;
                              const newStages = [...stages];
                              newStages[s._idx] = { ...newStages[s._idx], stage_normalized: newNorm };
                              setStages(newStages);
                              const overrides: Record<string, string> = {};
                              newStages.forEach(st => { if (st.stage_normalized) overrides[st.raw_stage] = st.stage_normalized; });
                              api.patch('/workspace-config', {
                                section: 'pipelines',
                                data: { stage_normalizations: overrides },
                              }).catch(() => {});
                            }}
                            style={{
                              fontSize: 11, fontFamily: fonts.mono,
                              color: colors.text, background: colors.surface,
                              border: `1px solid ${colors.border}`, borderRadius: 3,
                              padding: '2px 6px', cursor: 'pointer', outline: 'none',
                            }}
                          >
                            {['awareness', 'qualification', 'evaluation', 'decision', 'proposal', 'negotiation', 'closed_won', 'closed_lost'].map(v => (
                              <option key={v} value={v}>{v}</option>
                            ))}
                          </select>
                        </td>
                        <td style={{ padding: '10px 10px', fontSize: 13, fontFamily: fonts.mono, color: colors.textSecondary }}>{s.deal_count}</td>
                        <td style={{ padding: '10px 10px', fontSize: 13, fontFamily: fonts.mono, color: s.total_amount === 0 ? colors.textMuted : colors.textSecondary }}>
                          {s.total_amount === 0 ? '$0' : `${(s.total_amount / 1000).toFixed(0)}K`} 
                        </td>
                        <td style={{ padding: '10px 10px' }}>
                          {isClosed ? <span style={{ fontSize: 11, color: colors.textMuted }}>N/A</span> : (
                            <WsToggle on={!s.is_excluded_from_pipeline} onChange={() => toggleExclusion(s._idx, 'is_excluded_from_pipeline')} />
                          )}
                        </td>
                        <td style={{ padding: '10px 10px' }}>
                          {isWon ? <span style={wsBadge(colors.green, colors.greenSoft)}>Won</span>
                            : isLost ? (
                              <div style={s.stage_normalized !== 'closed_won' ? { pointerEvents: 'none', opacity: 0.4 } : {}}>
                                <WsToggle on={!s.is_excluded_from_win_rate} onChange={() => toggleExclusion(s._idx, 'is_excluded_from_win_rate')} />
                              </div>
                            ) : s.is_open ? (
                              <span style={{ fontSize: 11, color: colors.textMuted }}>—</span>
                            ) : null}
                        </td>
                        <td style={{ padding: '10px 10px' }}>
                          {isClosed ? <span style={{ fontSize: 11, color: colors.textMuted }}>N/A</span> : (
                            <WsToggle on={!s.is_excluded_from_forecast} onChange={() => toggleExclusion(s._idx, 'is_excluded_from_forecast')} />
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 12 }}>
        {saved && <span style={{ fontSize: 13, color: colors.green, fontFamily: fonts.sans, alignSelf: 'center' }}>Filters saved</span>}
        <button style={wsBtn('primary')} onClick={save} disabled={saving}>{saving ? 'Saving...' : 'Save Changes'}</button>
      </div>
    </div>
  );
}

// ─── Workspace Tab: Metric Filters ───────────────────────────────────────────

interface WsFilterRule {
  id: string;
  field: string;
  operator: string;
  value: string | string[];
  label: string;
  created_by: string;
  created_at: string;
}

interface WsFieldOption {
  field: string;
  label: string;
  type: string;
  values: { val: string; count: number }[];
}

interface WsPreviewData {
  before: number;
  after: number;
  metric: string;
  affected_deals: number;
}

function WsMetricFiltersSection() {
  const [rules, setRules] = useState<WsFilterRule[]>([]);
  const [fields, setFields] = useState<WsFieldOption[]>([]);
  const [showBuilder, setShowBuilder] = useState(false);
  const [newRule, setNewRule] = useState<{ field: string; operator: string; value: string | string[]; label: string }>({ field: '', operator: 'eq', value: '', label: '' });
  const [previewData, setPreviewData] = useState<WsPreviewData | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [expandedMetric, setExpandedMetric] = useState<string | null>(null);
  const [metricOverrides, setMetricOverrides] = useState<Record<string, any>>({
    win_rate: { enabled: false },
    pipeline_value: { enabled: false },
    forecast: { enabled: false },
    velocity: { enabled: false },
    activity: { enabled: false },
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    Promise.all([
      api.get('/workspace-config').catch(() => ({ config: {} })),
      api.get('/workspace-config/field-options').catch(() => ({ fields: [] })),
    ]).then(([cfgData, fieldData]: any[]) => {
      const tf = cfgData.config?.tool_filters;
      if (tf) {
        setRules(tf.global?.custom_exclusions || []);
        setMetricOverrides(tf.metric_overrides || metricOverrides);
      }
      setFields(fieldData.fields || []);
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const selectedField = fields.find(f => f.field === newRule.field);

  const previewImpact = async () => {
    if (!newRule.field || !newRule.operator) return;
    setPreviewLoading(true);
    try {
      const data: any = await api.post('/workspace-config/preview-filter', {
        rule: { field: newRule.field, operator: newRule.operator, value: newRule.value },
        metric_context: 'win_rate',
      });
      setPreviewData({
        before: data.metric_before?.win_rate || 0,
        after: data.metric_after?.win_rate || 0,
        metric: 'Win Rate',
        affected_deals: data.affected_deals || 0,
      });
    } catch (e) {
      // ignore
    } finally {
      setPreviewLoading(false);
    }
  };

  const addRule = () => {
    if (!newRule.field || !newRule.label) return;
    const rule: WsFilterRule = {
      ...newRule,
      value: Array.isArray(newRule.value) ? (newRule.value as string[]).join(',') : newRule.value as string,
      id: `r${Date.now()}`,
      created_by: 'admin',
      created_at: new Date().toISOString().split('T')[0],
    };
    setRules([...rules, rule]);
    setNewRule({ field: '', operator: 'eq', value: '', label: '' });
    setShowBuilder(false);
    setPreviewData(null);
  };

  const save = async () => {
    setSaving(true);
    try {
      await api.patch('/workspace-config/tool_filters', {
        global: {
          exclude_stages: [],
          exclude_pipelines: [],
          exclude_deal_types: [],
          custom_exclusions: rules,
        },
        metric_overrides: metricOverrides,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      // ignore
    } finally {
      setSaving(false);
    }
  };

  const wsMetrics = [
    { key: 'win_rate', label: 'Win Rate', desc: 'Controls which deals count in win/loss rate calculation' },
    { key: 'pipeline_value', label: 'Pipeline Value', desc: 'Controls which deals count as active pipeline' },
    { key: 'forecast', label: 'Forecast', desc: 'Controls which deals appear in forecast models' },
    { key: 'velocity', label: 'Velocity', desc: 'Controls which stage transitions count in velocity benchmarks' },
    { key: 'activity', label: 'Activity', desc: 'Controls which activities count in engagement scoring' },
  ];

  if (loading) return <Skeleton />;

  return (
    <div>
      <WsSectionHeader
        title="Global Exclusions"
        description="These rules apply to ALL pipeline and forecasting tools. Deals matching any rule are excluded from every metric."
        count={rules.length}
      />

      <div style={wsCard}>
        {rules.map((r, i) => (
          <div key={r.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0', borderBottom: i < rules.length - 1 ? `1px solid ${colors.border}` : 'none' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ width: 6, height: 6, borderRadius: 3, background: colors.red }} />
              <div>
                <div style={{ fontSize: 13, color: colors.text, fontFamily: fonts.sans }}>
                  <span style={{ fontFamily: fonts.mono, fontSize: 12, color: colors.accent, background: colors.accentSoft, padding: '1px 5px', borderRadius: 3, marginRight: 6 }}>
                    {fields.find(f => f.field === r.field)?.label || r.field}
                  </span>
                  <span style={{ color: colors.textSecondary }}>{r.operator === 'eq' ? '=' : r.operator}</span>
                  <span style={{ color: colors.yellow, fontFamily: fonts.mono, fontSize: 12, marginLeft: 4 }}>
                    {r.operator === 'is_null' || r.operator === 'is_not_null' ? '' : `"${r.value}"`}
                  </span>
                </div>
                <div style={{ fontSize: 11.5, color: colors.textMuted, marginTop: 3, fontFamily: fonts.sans }}>{r.label} · {r.created_by} · {r.created_at}</div>
              </div>
            </div>
            <button style={wsBtn('sm')} onClick={() => setRules(rules.filter(x => x.id !== r.id))}>Remove</button>
          </div>
        ))}

        {rules.length === 0 && (
          <div style={{ padding: 20, textAlign: 'center', color: colors.textMuted, fontSize: 13, fontFamily: fonts.sans }}>
            No global exclusion rules configured
          </div>
        )}

        {!showBuilder ? (
          <button
            style={{ ...wsBtn(), marginTop: 12, width: '100%', textAlign: 'center', borderStyle: 'dashed' }}
            onClick={() => setShowBuilder(true)}
          >
            + Add Exclusion Rule
          </button>
        ) : (
          <div style={{ marginTop: 12, padding: 16, background: colors.surface, borderRadius: 8, border: `1px solid ${colors.borderLight}` }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: colors.textSecondary, marginBottom: 12, fontFamily: fonts.sans, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              New Exclusion Rule
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 120px 1fr', gap: 10, marginBottom: 10 }}>
              <select style={wsSelect} value={newRule.field} onChange={e => { setNewRule({ ...newRule, field: e.target.value, value: '' }); setPreviewData(null); }}>
                <option value="">Select field...</option>
                <optgroup label="Standard Fields">
                  {fields.filter(f => !f.field.startsWith('custom')).map(f => <option key={f.field} value={f.field}>{f.label}</option>)}
                </optgroup>
                {fields.some(f => f.field.startsWith('custom')) && (
                  <optgroup label="Custom Fields">
                    {fields.filter(f => f.field.startsWith('custom')).map(f => <option key={f.field} value={f.field}>{f.label}</option>)}
                  </optgroup>
                )}
              </select>
              <select style={wsSelect} value={newRule.operator} onChange={e => setNewRule({ ...newRule, operator: e.target.value })}>
                <option value="eq">equals</option>
                <option value="neq">not equals</option>
                <option value="contains">contains</option>
                <option value="in">in list</option>
                <option value="is_null">is empty</option>
                <option value="is_not_null">is not empty</option>
                {selectedField?.type === 'number' && <option value="gt">greater than</option>}
                {selectedField?.type === 'number' && <option value="lt">less than</option>}
              </select>
              { newRule.operator === 'is_null' || newRule.operator === 'is_not_null' ? null : (
                newRule.operator === 'in' || newRule.operator === 'not_in' ? (
                  selectedField && selectedField.values.length > 0 ? (
                    <div style={{ border: `1px solid ${colors.border}`, borderRadius: 6, padding: '6px 10px', maxHeight: 140, overflowY: 'auto', background: colors.bg }}>
                      {selectedField.values.map(v => {
                        const checked = Array.isArray(newRule.value) && (newRule.value as string[]).includes(v.val);
                        return (
                          <label key={v.val} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 0', cursor: 'pointer', fontSize: 13, fontFamily: fonts.sans, color: colors.text }}>
                            <input type="checkbox" checked={checked} onChange={() => {
                              const cur = Array.isArray(newRule.value) ? (newRule.value as string[]) : [];
                              const next = checked ? cur.filter(x => x !== v.val) : [...cur, v.val];
                              setNewRule({ ...newRule, value: next });
                            }} />
                            <span>{v.val}</span>
                            <span style={{ fontSize: 11, color: colors.textMuted, marginLeft: 'auto' }}>{v.count}</span>
                          </label>
                        );
                      })}
                    </div>
                  ) : (
                    <input style={wsInput} placeholder="Comma-separated values..." value={Array.isArray(newRule.value) ? (newRule.value as string[]).join(', ') : newRule.value as string} onChange={e => setNewRule({ ...newRule, value: e.target.value.split(',').map((s: string) => s.trim()) })} />
                  )
                ) : (
                  selectedField && selectedField.values.length > 0 ? (
                    <select style={wsSelect} value={newRule.value as string} onChange={e => setNewRule({ ...newRule, value: e.target.value })}>
                      <option value="">Select value...</option>
                      {selectedField.values.map(v => (
                        <option key={v.val} value={v.val}>{v.val} ({v.count})</option>
                      ))}
                    </select>
                  ) : (
                    <input style={wsInput} placeholder="Value..." value={newRule.value as string} onChange={e => setNewRule({ ...newRule, value: e.target.value })} />
                  )
                )
              ) }
            </div>
            <input
              style={{ ...wsInput, marginBottom: 10 }}
              placeholder='Label (e.g. "Exclude duplicate opportunities")'
              value={newRule.label}
              onChange={e => setNewRule({ ...newRule, label: e.target.value })}
            />

            {previewData && (
              <div style={{ ...wsCard, background: colors.accentSoft, borderColor: colors.accent, padding: 14, display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
                  <span style={{ fontSize: 12, color: colors.textSecondary, fontFamily: fonts.sans }}>Impact Preview</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 14, fontFamily: fonts.mono, color: colors.textMuted, textDecoration: 'line-through' }}>{(previewData.before * 100).toFixed(1)}%</span>
                    <span style={{ fontSize: 12, color: colors.textMuted }}>→</span>
                    <span style={{ fontSize: 14, fontFamily: fonts.mono, fontWeight: 600, color: previewData.after > previewData.before ? colors.green : colors.red }}>{(previewData.after * 100).toFixed(1)}%</span>
                  </div>
                  <span style={{ fontSize: 12, color: colors.textSecondary, fontFamily: fonts.sans }}>{previewData.affected_deals} deals affected</span>
                </div>
                <span style={{ fontSize: 12, color: colors.textSecondary, fontFamily: fonts.sans }}>{previewData.metric}</span>
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 10 }}>
              <button style={wsBtn()} onClick={previewImpact} disabled={previewLoading}>{previewLoading ? 'Loading...' : 'Preview Impact'}</button>
              <div style={{ display: 'flex', gap: 8 }}>
                <button style={wsBtn()} onClick={() => { setShowBuilder(false); setPreviewData(null); }}>Cancel</button>
                <button style={wsBtn('primary')} onClick={addRule}>Add Rule</button>
              </div>
            </div>
          </div>
        )}
      </div>

      <div style={{ marginTop: 28 }}>
        <WsSectionHeader title="Metric-Specific Overrides" description="Fine-tune which deals count for each individual metric. These extend the global exclusions above." />
      </div>

      {wsMetrics.map(m => {
        const override = metricOverrides[m.key] || { enabled: false };
        const isExpanded = expandedMetric === m.key;
        return (
          <div key={m.key} style={{ ...wsCard, padding: 0, marginBottom: 8, cursor: 'pointer', transition: 'border-color 0.15s', borderColor: isExpanded ? colors.borderLight : colors.border }}>
            <div
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px' }}
              onClick={() => setExpandedMetric(isExpanded ? null : m.key)}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div>
                  <div style={{ fontSize: 13.5, fontWeight: 500, color: colors.text, fontFamily: fonts.sans }}>{m.label}</div>
                  <div style={{ fontSize: 11.5, color: colors.textMuted, fontFamily: fonts.sans }}>{m.desc}</div>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                {override.enabled && (
                  <span style={wsBadge(colors.yellow, colors.yellowSoft)}>
                    {(override.exclude_stages?.length || 0) + (override.additional_exclusions?.length || 0)} rules
                  </span>
                )}
                <WsToggle on={override.enabled} onChange={v => {
                  setMetricOverrides({ ...metricOverrides, [m.key]: { ...override, enabled: v } });
                }} />
                <span style={{ fontSize: 14, color: colors.textMuted, transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s', display: 'inline-block' }}>▼</span>
              </div>
            </div>
            {isExpanded && override.enabled && (
              <div style={{ padding: '0 18px 16px', borderTop: `1px solid ${colors.border}` }}>
                <div style={{ marginTop: 14, fontSize: 12.5, color: colors.textSecondary, fontFamily: fonts.sans }}>
                  Override enabled. Use the Global Exclusions above to add rules that apply to this metric.
                </div>
              </div>
            )}
          </div>
        );
      })}

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 12 }}>
        {saved && <span style={{ fontSize: 13, color: colors.green, fontFamily: fonts.sans, alignSelf: 'center' }}>Saved</span>}
        <button style={wsBtn('primary')} onClick={save} disabled={saving}>{saving ? 'Saving...' : 'Save Filters'}</button>
      </div>
    </div>
  );
}

// ─── Workspace Tab: Team ──────────────────────────────────────────────────────

interface WsOwner {
  owner_name: string;
  total_deals: number;
  open_deals: number;
  open_pipeline: number;
  is_excluded: boolean;
  role: string;
}

function WsTeamSection() {
  const [owners, setOwners] = useState<WsOwner[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const roles = ['AE', 'SDR', 'Manager', 'VP Sales', 'System', 'Other'];

  useEffect(() => {
    api.get('/workspace-config/owners').then((data: any) => {
      setOwners(data.owners || []);
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      const excluded_owners = owners.filter(o => o.is_excluded).map(o => o.owner_name);
      const rolesMap: Record<string, string> = {};
      owners.forEach(o => { rolesMap[o.owner_name] = o.role; });
      await api.patch('/workspace-config/teams', {
        rep_field: 'owner',
        roles: [],
        groups: [],
        excluded_owners,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      // ignore
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <Skeleton />;

  return (
    <div>
      <WsSectionHeader title="Team Members" description="Configure which deal owners are included in rep-level metrics. Exclude system accounts, managers, and VPs who shouldn't appear in leaderboards." />
      <div style={wsCard}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: fonts.sans }}>
          <thead>
            <tr style={{ borderBottom: `1px solid ${colors.border}` }}>
              {['Name', 'Role', 'Open Deals', 'Pipeline', 'In Metrics'].map(h => (
                <th key={h} style={{ padding: '8px 10px', fontSize: 11, fontWeight: 600, color: colors.textMuted, textAlign: 'left', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {owners.map((o, i) => (
              <tr key={o.owner_name} style={{ borderBottom: i < owners.length - 1 ? `1px solid ${colors.border}` : 'none', opacity: o.is_excluded ? 0.6 : 1 }}>
                <td style={{ padding: '10px 10px', fontSize: 13, color: colors.text, fontWeight: 500 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ width: 28, height: 28, borderRadius: 14, background: !o.is_excluded ? colors.accentSoft : colors.surface, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 600, color: !o.is_excluded ? colors.accent : colors.textMuted, fontFamily: fonts.sans }}>
                      {o.owner_name.split(' ').map((w: string) => w[0]).join('')}
                    </div>
                    {o.owner_name}
                  </div>
                </td>
                <td style={{ padding: '10px 10px' }}>
                  <select
                    style={{ ...wsSelect, width: 100, padding: '4px 8px', fontSize: 12 }}
                    value={o.role}
                    onChange={e => { const next = [...owners]; next[i] = { ...next[i], role: e.target.value }; setOwners(next); }}
                  >
                    {roles.map(r => <option key={r} value={r}>{r}</option>)}
                  </select>
                </td>
                <td style={{ padding: '10px 10px', fontSize: 13, fontFamily: fonts.mono, color: colors.textSecondary }}>{o.open_deals}</td>
                <td style={{ padding: '10px 10px', fontSize: 13, fontFamily: fonts.mono, color: colors.textSecondary }}>{formatCurrency(o.open_pipeline)}</td>
                <td style={{ padding: '10px 10px' }}>
                  <WsToggle on={!o.is_excluded} onChange={v => { const next = [...owners]; next[i] = { ...next[i], is_excluded: !v }; setOwners(next); }} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 12 }}>
        {saved && <span style={{ fontSize: 13, color: colors.green, fontFamily: fonts.sans, alignSelf: 'center' }}>Saved</span>}
        <button style={wsBtn('primary')} onClick={save} disabled={saving}>{saving ? 'Saving...' : 'Save Changes'}</button>
      </div>
    </div>
  );
}

// ─── Workspace Tab: Thresholds ────────────────────────────────────────────────

function WsThresholdsSection() {
  const [thresholds, setThresholds] = useState({
    stale_deal_days: 14,
    critical_stale_days: 30,
    coverage_target: 3.0,
    min_contacts: 2,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api.get('/workspace-config').then((data: any) => {
      const t = data.config?.thresholds;
      if (t) {
        setThresholds({
          stale_deal_days: typeof t.stale_deal_days === 'number' ? t.stale_deal_days : 14,
          critical_stale_days: typeof t.critical_stale_days === 'number' ? t.critical_stale_days : 30,
          coverage_target: typeof t.coverage_target === 'number' ? t.coverage_target : 3.0,
          min_contacts: t.minimum_contacts_per_deal ?? 2,
        });
      }
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      await api.patch('/workspace-config/thresholds', {
        stale_deal_days: thresholds.stale_deal_days,
        critical_stale_days: thresholds.critical_stale_days,
        coverage_target: thresholds.coverage_target,
        minimum_contacts_per_deal: thresholds.min_contacts,
        required_fields: [
          { field: 'amount', object: 'deals' },
          { field: 'close_date', object: 'deals' },
        ],
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      // ignore
    } finally {
      setSaving(false);
    }
  };

  const items = [
    { key: 'stale_deal_days' as const, label: 'Stale Deal Threshold', unit: 'days', desc: 'Deals with no activity for longer than this are flagged as stale', min: 1, max: 120, step: 1 },
    { key: 'critical_stale_days' as const, label: 'Critical Stale Threshold', unit: 'days', desc: 'Deals exceeding this threshold are escalated as critical', min: 1, max: 180, step: 1 },
    { key: 'coverage_target' as const, label: 'Pipeline Coverage Target', unit: '×', desc: 'Required pipeline-to-quota ratio for healthy coverage', min: 1, max: 10, step: 0.5 },
    { key: 'min_contacts' as const, label: 'Minimum Contacts per Deal', unit: 'contacts', desc: 'Deals with fewer contacts than this are flagged as single-threaded', min: 1, max: 10, step: 1 },
  ];

  if (loading) return <Skeleton />;

  return (
    <div>
      <WsSectionHeader title="Thresholds & Benchmarks" description="Adjust the numeric thresholds used by pipeline hygiene, coverage, and engagement skills." />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        {items.map(item => (
          <div key={item.key} style={wsCard}>
            <div style={{ fontSize: 13, fontWeight: 500, color: colors.text, fontFamily: fonts.sans, marginBottom: 4 }}>{item.label}</div>
            <div style={{ fontSize: 11.5, color: colors.textMuted, fontFamily: fonts.sans, marginBottom: 14, lineHeight: 1.4 }}>{item.desc}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <input
                type="range"
                min={item.min}
                max={item.max}
                step={item.step}
                value={thresholds[item.key]}
                onChange={e => setThresholds({ ...thresholds, [item.key]: Number(e.target.value) })}
                style={{ flex: 1, accentColor: colors.accent }}
              />
              <div style={{ minWidth: 60, textAlign: 'right' }}>
                <span style={{ fontSize: 20, fontWeight: 700, fontFamily: fonts.mono, color: colors.text }}>{thresholds[item.key]}</span>
                <span style={{ fontSize: 11, color: colors.textMuted, fontFamily: fonts.sans, marginLeft: 3 }}>{item.unit}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 12 }}>
        {saved && <span style={{ fontSize: 13, color: colors.green, fontFamily: fonts.sans, alignSelf: 'center' }}>Saved</span>}
        <button style={wsBtn('primary')} onClick={save} disabled={saving}>{saving ? 'Saving...' : 'Save Changes'}</button>
      </div>
    </div>
  );
}

// ─── Workspace Tab: Suggestions ───────────────────────────────────────────────

interface WsSuggestion {
  id: string;
  skill: string;
  confidence: number;
  message: string;
  impact: string;
  suggested_rule?: any;
}

function WsSuggestionsSection() {
  const [suggestions, setSuggestions] = useState<WsSuggestion[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/workspace-config/suggestions').then((data: any) => {
      setSuggestions(data.suggestions || []);
    }).catch(() => { setSuggestions([]); }).finally(() => setLoading(false));
  }, []);

  const dismiss = (id: string) => setSuggestions(suggestions.filter(s => s.id !== id));

  const accept = async (s: WsSuggestion) => {
    if (!s.suggested_rule) { dismiss(s.id); return; }
    try {
      await api.post(`/workspace-config/suggestions/${s.id}/resolve`, { action: 'accept' });
    } catch (e) {
      // ignore
    }
    dismiss(s.id);
  };

  if (loading) return <Skeleton />;

  return (
    <div>
      <WsSectionHeader
        title="AI Suggestions"
        description="Pandora's skills analyze your data and suggest configuration improvements. Review and apply with one click."
        count={suggestions.length}
      />

      {suggestions.length === 0 ? (
        <div style={{ ...wsCard, padding: 40, textAlign: 'center' }}>
          <div style={{ fontSize: 14, color: colors.text, fontFamily: fonts.sans, fontWeight: 500, marginBottom: 4 }}>All caught up</div>
          <div style={{ fontSize: 12.5, color: colors.textMuted, fontFamily: fonts.sans }}>New suggestions appear as skills identify configuration improvements</div>
        </div>
      ) : (
        suggestions.map(s => (
          <div key={s.id} style={{ ...wsCard, borderLeft: `3px solid ${s.confidence > 0.85 ? colors.accent : colors.yellow}` }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: colors.accent, fontFamily: fonts.sans }}>{s.skill}</span>
              <span style={wsBadge(s.confidence > 0.85 ? colors.green : colors.yellow, s.confidence > 0.85 ? colors.greenSoft : colors.yellowSoft)}>
                {(s.confidence * 100).toFixed(0)}% confidence
              </span>
            </div>
            <p style={{ margin: '0 0 10px', fontSize: 13.5, color: colors.text, fontFamily: fonts.sans, lineHeight: 1.6 }}>{s.message}</p>
            <div style={{ padding: '8px 12px', background: colors.surface, borderRadius: 6, marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 12, color: colors.textMuted, fontFamily: fonts.sans }}>Impact:</span>
              <span style={{ fontSize: 12.5, color: colors.green, fontFamily: fonts.sans, fontWeight: 500 }}>{s.impact}</span>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button style={wsBtn('primary')} onClick={() => accept(s)}>Accept & Apply</button>
              <button style={wsBtn()} onClick={() => dismiss(s.id)}>Dismiss</button>
            </div>
          </div>
        ))
      )}
    </div>
  );
}
