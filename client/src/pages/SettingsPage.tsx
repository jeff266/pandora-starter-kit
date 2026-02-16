import React, { useEffect, useState } from 'react';
import { colors, fonts } from '../styles/theme';
import { api } from '../lib/api';
import Skeleton from '../components/Skeleton';

type Tab = 'voice' | 'skills' | 'tokens';

const TABS: { key: Tab; label: string }[] = [
  { key: 'voice', label: 'Voice & Tone' },
  { key: 'skills', label: 'Skills' },
  { key: 'tokens', label: 'Token Budget' },
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
