import React, { useEffect, useState } from 'react';
import { colors, fonts } from '../styles/theme';
import { api } from '../lib/api';
import Skeleton from '../components/Skeleton';

type Tab = 'voice' | 'skills' | 'tokens' | 'learning' | 'quotas';

const TABS: { key: Tab; label: string }[] = [
  { key: 'voice', label: 'Voice & Tone' },
  { key: 'skills', label: 'Skills' },
  { key: 'tokens', label: 'Token Budget' },
  { key: 'learning', label: 'Learning' },
  { key: 'quotas', label: 'Quotas' },
];

const CRON_PRESETS = [
  { label: 'Daily 8 AM', value: '0 8 * * *' },
  { label: 'Weekdays 8 AM', value: '0 8 * * 1-5' },
  { label: 'Mondays 8 AM', value: '0 8 * * 1' },
  { label: 'Mondays and Thursdays 8 AM', value: '0 8 * * 1,4' },
  { label: 'Fridays 4 PM', value: '0 16 * * 5' },
  { label: 'Custom', value: '__custom__' },
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
      }}>
        {TABS.map(tab => {
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

function SkillsSection() {
  const [loading, setLoading] = useState(true);
  const [skills, setSkills] = useState<any[]>([]);
  const [schedules, setSchedules] = useState<Record<string, { cron: string; enabled: boolean; preset: string; customCron: string }>>({});
  const [savedMap, setSavedMap] = useState<Record<string, boolean>>({});
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    api.get('/skills')
      .then((data: any) => {
        const arr = Array.isArray(data) ? data : data.skills || [];
        setSkills(arr);
        const sched: Record<string, any> = {};
        arr.forEach((s: any) => {
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
      })
      .catch(() => setSkills([]))
      .finally(() => setLoading(false));
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
    setErrorMsg('');
    try {
      await api.patch(`/skills/${skillId}/schedule`, { cron: s.cron, enabled: s.enabled });
      setSavedMap(prev => ({ ...prev, [skillId]: true }));
      setTimeout(() => setSavedMap(prev => ({ ...prev, [skillId]: false })), 2000);
    } catch (err: any) {
      if (err.message?.includes('404') || err.message?.includes('Not Found')) {
        setErrorMsg('Schedule updates not yet available');
        setTimeout(() => setErrorMsg(''), 3000);
      }
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
      <h2 style={{ fontSize: 18, fontWeight: 600, color: colors.text, marginBottom: 24 }}>Skill Scheduling</h2>

      {errorMsg && (
        <div style={{
          padding: '8px 14px',
          marginBottom: 16,
          borderRadius: 8,
          background: colors.yellowSoft,
          border: `1px solid ${colors.yellow}`,
          color: colors.yellow,
          fontSize: 12,
          fontWeight: 500,
        }}>
          {errorMsg}
        </div>
      )}

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
                  <input
                    type="text"
                    value={sched.customCron}
                    onChange={e => handleCustomCron(skill.id, e.target.value)}
                    placeholder="* * * * *"
                    style={{
                      fontSize: 12,
                      fontFamily: fonts.mono,
                      color: colors.text,
                      background: colors.surfaceRaised,
                      border: `1px solid ${colors.border}`,
                      borderRadius: 6,
                      padding: '5px 10px',
                      width: 120,
                    }}
                  />
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
                {savedMap[skill.id] && (
                  <span style={{ fontSize: 11, color: colors.green, fontWeight: 500 }}>Saved ✓</span>
                )}
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
          {byWeek.slice(-8).map((w, i) => {
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
    ]).then(([periodsData, quotasData, goalsData, healthData]) => {
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

  const handleAddQuota = async () => {
    if (!addName || !addEmail || !addAmount) return;
    setError('');
    const currentPeriod = periods[currentPeriodIdx];
    try {
      await api.post('/quotas/add', {
        rep_name: addName,
        email: addEmail,
        quota_amount: parseFloat(addAmount),
        period_start: currentPeriod?.start_date,
        period_end: currentPeriod?.end_date,
      });
      setShowAddForm(false);
      setAddName('');
      setAddEmail('');
      setAddAmount('');
      await loadQuotas();
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
          {importButtons}
        </div>
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
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
            <input
              type="text"
              placeholder="Rep Name"
              value={addName}
              onChange={e => setAddName(e.target.value)}
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
