import React, { useState, useEffect } from 'react';
import { colors, fonts } from '../../styles/theme';
import { api } from '../../lib/api';
import { useWorkspace } from '../../context/WorkspaceContext';

interface CategoryRule {
  enabled: boolean;
  delivery: 'realtime' | 'digest' | 'inherit';
  min_severity?: string;
  min_score_change?: number;
  min_score_tier?: string;
  max_per_run?: number;
}

interface CategoryDisplay {
  id: string;
  label: string;
  description: string;
  default_enabled: boolean;
  default_delivery: string;
  supports_threshold?: boolean;
  default_min_score_change?: number;
  default_min_score_tier?: string;
  default_max_per_run?: number;
  rule: CategoryRule;
}

interface Preferences {
  enabled: boolean;
  quiet_hours: {
    enabled: boolean;
    start: string;
    end: string;
    timezone: string;
  };
  delivery_mode: 'realtime' | 'digest' | 'smart';
  digest_schedule: {
    frequency: 'daily' | 'twice_daily';
    times: string[];
    timezone: string;
  };
  category_rules: Record<string, CategoryRule>;
  categories: CategoryDisplay[];
  _paused_until?: string;
}

interface QueueItem {
  category: string;
  severity: string;
  count: number;
}

export default function NotificationsTab() {
  const { currentWorkspace } = useWorkspace();
  const workspaceId = currentWorkspace?.id;

  const [prefs, setPrefs] = useState<Preferences | null>(null);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (workspaceId) loadPrefs();
  }, [workspaceId]);

  async function loadPrefs() {
    try {
      setLoading(true);
      const [prefsData, queueData] = await Promise.all([
        api.get(`/notification-preferences`),
        api.get(`/notifications/queue`),
      ]);
      setPrefs(prefsData);
      setQueue(queueData.pending || []);
    } catch (err) {
      console.error('Failed to load notification preferences:', err);
    } finally {
      setLoading(false);
    }
  }

  async function savePrefs(updates: Partial<Preferences>) {
    if (!workspaceId) return;
    try {
      setSaving(true);
      const updated = await api.patch(
        `/notification-preferences`,
        updates
      );
      setPrefs(prev => prev ? { ...prev, ...updated, categories: prev.categories } : prev);
    } catch (err) {
      console.error('Failed to save notification preferences:', err);
    } finally {
      setSaving(false);
    }
  }

  async function pauseNotifications(hours: number) {
    if (!workspaceId) return;
    try {
      await api.post(`/notifications/pause`, { hours });
      await loadPrefs();
    } catch (err) {
      console.error('Failed to pause notifications:', err);
    }
  }

  async function resumeNotifications() {
    if (!workspaceId) return;
    try {
      await api.post(`/notifications/resume`, {});
      await loadPrefs();
    } catch (err) {
      console.error('Failed to resume notifications:', err);
    }
  }

  function updateCategoryRule(categoryId: string, field: string, value: any) {
    if (!prefs) return;
    const currentRules = { ...prefs.category_rules };
    const currentRule = currentRules[categoryId] || { enabled: true, delivery: 'inherit' };
    currentRules[categoryId] = { ...currentRule, [field]: value };
    savePrefs({ category_rules: currentRules });
  }

  if (loading || !prefs) {
    return (
      <div style={{ maxWidth: 800, color: colors.textMuted, fontFamily: fonts.sans }}>
        Loading notification preferences...
      </div>
    );
  }

  const totalQueued = queue.reduce((sum, q) => sum + q.count, 0);
  const isPaused = !!prefs._paused_until && new Date(prefs._paused_until) > new Date();

  return (
    <div style={{ maxWidth: 800, fontFamily: fonts.sans }}>
      <h1 style={{ fontSize: 24, fontWeight: 600, color: colors.text, marginBottom: 8 }}>
        Notifications
      </h1>
      <p style={{ fontSize: 14, color: colors.textSecondary, marginBottom: 32 }}>
        Control how and when Pandora sends Slack notifications to your workspace.
      </p>

      {/* Master Toggle + Pause */}
      <div style={{
        background: colors.surface,
        border: `1px solid ${colors.border}`,
        borderRadius: 8,
        padding: 20,
        marginBottom: 24,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 600, color: colors.text }}>Slack Notifications</div>
            <div style={{ fontSize: 13, color: colors.textSecondary, marginTop: 4 }}>
              {isPaused
                ? `Paused until ${new Date(prefs._paused_until!).toLocaleString()}`
                : prefs.enabled ? 'Notifications are active' : 'All notifications are disabled'}
            </div>
          </div>
          <ToggleSwitch
            checked={prefs.enabled}
            onChange={(val) => savePrefs({ enabled: val })}
          />
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          {prefs.enabled ? (
            <>
              <SmallButton onClick={() => pauseNotifications(4)} label="Pause 4h" />
              <SmallButton onClick={() => pauseNotifications(8)} label="Pause 8h" />
              <SmallButton onClick={() => pauseNotifications(24)} label="Pause 24h" />
            </>
          ) : isPaused ? (
            <SmallButton onClick={resumeNotifications} label="Resume Now" accent />
          ) : (
            <SmallButton onClick={() => savePrefs({ enabled: true })} label="Enable" accent />
          )}
        </div>

        {totalQueued > 0 && (
          <div style={{
            marginTop: 16,
            padding: '8px 12px',
            background: colors.accentSoft,
            borderRadius: 6,
            fontSize: 13,
            color: colors.accent,
          }}>
            {totalQueued} notification{totalQueued !== 1 ? 's' : ''} queued for next digest
          </div>
        )}
      </div>

      {/* Delivery Mode */}
      <div style={{
        background: colors.surface,
        border: `1px solid ${colors.border}`,
        borderRadius: 8,
        padding: 20,
        marginBottom: 24,
      }}>
        <div style={{ fontSize: 16, fontWeight: 600, color: colors.text, marginBottom: 12 }}>
          Delivery Mode
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {([
            { value: 'realtime', label: 'Real-time', desc: 'Send each notification immediately as it happens' },
            { value: 'smart', label: 'Smart', desc: 'Critical alerts sent immediately, everything else batched into digests' },
            { value: 'digest', label: 'Digest Only', desc: 'All notifications batched into scheduled digest messages' },
          ] as const).map(mode => (
            <label
              key={mode.value}
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 12,
                padding: '12px 16px',
                borderRadius: 8,
                cursor: 'pointer',
                background: prefs.delivery_mode === mode.value ? colors.accentSoft : 'transparent',
                border: `1px solid ${prefs.delivery_mode === mode.value ? colors.accent : colors.border}`,
                transition: 'all 0.15s',
              }}
            >
              <input
                type="radio"
                name="delivery_mode"
                checked={prefs.delivery_mode === mode.value}
                onChange={() => savePrefs({ delivery_mode: mode.value })}
                style={{ marginTop: 2 }}
              />
              <div>
                <div style={{ fontSize: 14, fontWeight: 500, color: colors.text }}>{mode.label}</div>
                <div style={{ fontSize: 12, color: colors.textSecondary, marginTop: 2 }}>{mode.desc}</div>
              </div>
            </label>
          ))}
        </div>

        {(prefs.delivery_mode === 'digest' || prefs.delivery_mode === 'smart') && (
          <div style={{ marginTop: 16, padding: '12px 16px', background: colors.surfaceRaised, borderRadius: 8 }}>
            <div style={{ fontSize: 13, fontWeight: 500, color: colors.text, marginBottom: 8 }}>Digest Schedule</div>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              <select
                value={prefs.digest_schedule.frequency}
                onChange={(e) => savePrefs({
                  digest_schedule: { ...prefs.digest_schedule, frequency: e.target.value as any }
                })}
                style={selectStyle}
              >
                <option value="daily">Daily</option>
                <option value="twice_daily">Twice Daily</option>
              </select>
              <span style={{ fontSize: 13, color: colors.textSecondary }}>at</span>
              <input
                type="time"
                value={prefs.digest_schedule.times[0] || '08:00'}
                onChange={(e) => savePrefs({
                  digest_schedule: {
                    ...prefs.digest_schedule,
                    times: prefs.digest_schedule.frequency === 'twice_daily'
                      ? [e.target.value, prefs.digest_schedule.times[1] || '16:00']
                      : [e.target.value]
                  }
                })}
                style={inputStyle}
              />
              {prefs.digest_schedule.frequency === 'twice_daily' && (
                <>
                  <span style={{ fontSize: 13, color: colors.textSecondary }}>and</span>
                  <input
                    type="time"
                    value={prefs.digest_schedule.times[1] || '16:00'}
                    onChange={(e) => savePrefs({
                      digest_schedule: {
                        ...prefs.digest_schedule,
                        times: [prefs.digest_schedule.times[0] || '08:00', e.target.value]
                      }
                    })}
                    style={inputStyle}
                  />
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Quiet Hours */}
      <div style={{
        background: colors.surface,
        border: `1px solid ${colors.border}`,
        borderRadius: 8,
        padding: 20,
        marginBottom: 24,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 600, color: colors.text }}>Quiet Hours</div>
            <div style={{ fontSize: 12, color: colors.textSecondary, marginTop: 2 }}>
              Notifications will be queued and delivered after quiet hours end
            </div>
          </div>
          <ToggleSwitch
            checked={prefs.quiet_hours.enabled}
            onChange={(val) => savePrefs({ quiet_hours: { ...prefs.quiet_hours, enabled: val } })}
          />
        </div>

        {prefs.quiet_hours.enabled && (
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <input
              type="time"
              value={prefs.quiet_hours.start}
              onChange={(e) => savePrefs({ quiet_hours: { ...prefs.quiet_hours, start: e.target.value } })}
              style={inputStyle}
            />
            <span style={{ fontSize: 13, color: colors.textSecondary }}>to</span>
            <input
              type="time"
              value={prefs.quiet_hours.end}
              onChange={(e) => savePrefs({ quiet_hours: { ...prefs.quiet_hours, end: e.target.value } })}
              style={inputStyle}
            />
            <select
              value={prefs.quiet_hours.timezone}
              onChange={(e) => savePrefs({ quiet_hours: { ...prefs.quiet_hours, timezone: e.target.value } })}
              style={selectStyle}
            >
              <option value="America/New_York">Eastern</option>
              <option value="America/Chicago">Central</option>
              <option value="America/Denver">Mountain</option>
              <option value="America/Los_Angeles">Pacific</option>
              <option value="UTC">UTC</option>
              <option value="Europe/London">London</option>
              <option value="Europe/Berlin">Berlin</option>
            </select>
          </div>
        )}
      </div>

      {/* Category Rules */}
      <div style={{
        background: colors.surface,
        border: `1px solid ${colors.border}`,
        borderRadius: 8,
        padding: 20,
        marginBottom: 24,
      }}>
        <div style={{ fontSize: 16, fontWeight: 600, color: colors.text, marginBottom: 16 }}>
          Notification Categories
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          {prefs.categories.map(cat => {
            const queuedForCat = queue.filter(q => q.category === cat.id).reduce((s, q) => s + q.count, 0);
            return (
              <div
                key={cat.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '12px 16px',
                  background: colors.surfaceRaised,
                  borderRadius: 6,
                  marginBottom: 4,
                }}
              >
                <ToggleSwitch
                  checked={cat.rule.enabled}
                  onChange={(val) => updateCategoryRule(cat.id, 'enabled', val)}
                  small
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 500, color: cat.rule.enabled ? colors.text : colors.textMuted }}>
                    {cat.label}
                    {queuedForCat > 0 && (
                      <span style={{ marginLeft: 8, fontSize: 11, color: colors.accent, fontWeight: 400 }}>
                        {queuedForCat} queued
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 12, color: colors.textMuted, marginTop: 2 }}>{cat.description}</div>
                </div>
                <select
                  value={cat.rule.delivery}
                  onChange={(e) => updateCategoryRule(cat.id, 'delivery', e.target.value)}
                  style={{ ...selectStyle, width: 100, fontSize: 12 }}
                  disabled={!cat.rule.enabled}
                >
                  <option value="inherit">Default</option>
                  <option value="realtime">Real-time</option>
                  <option value="digest">Digest</option>
                </select>
                {cat.supports_threshold && cat.rule.enabled && (
                  <input
                    type="number"
                    value={cat.rule.min_score_change ?? cat.default_min_score_change ?? ''}
                    onChange={(e) => updateCategoryRule(cat.id, 'min_score_change', parseInt(e.target.value) || 0)}
                    title="Min score change"
                    placeholder="Min pts"
                    style={{ ...inputStyle, width: 70, fontSize: 12, textAlign: 'center' as const }}
                  />
                )}
                {cat.default_max_per_run !== undefined && cat.rule.enabled && (
                  <input
                    type="number"
                    value={cat.rule.max_per_run ?? cat.default_max_per_run ?? ''}
                    onChange={(e) => updateCategoryRule(cat.id, 'max_per_run', parseInt(e.target.value) || 0)}
                    title="Max per run"
                    placeholder="Max"
                    style={{ ...inputStyle, width: 60, fontSize: 12, textAlign: 'center' as const }}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {saving && (
        <div style={{ fontSize: 12, color: colors.textMuted, textAlign: 'center' }}>
          Saving...
        </div>
      )}
    </div>
  );
}

function ToggleSwitch({ checked, onChange, small }: { checked: boolean; onChange: (val: boolean) => void; small?: boolean }) {
  const w = small ? 36 : 44;
  const h = small ? 20 : 24;
  const dot = small ? 14 : 18;

  return (
    <button
      onClick={() => onChange(!checked)}
      style={{
        width: w,
        height: h,
        borderRadius: h / 2,
        background: checked ? colors.accent : colors.border,
        border: 'none',
        cursor: 'pointer',
        position: 'relative',
        transition: 'background 0.2s',
        flexShrink: 0,
      }}
    >
      <div
        style={{
          width: dot,
          height: dot,
          borderRadius: '50%',
          background: '#fff',
          position: 'absolute',
          top: (h - dot) / 2,
          left: checked ? w - dot - (h - dot) / 2 : (h - dot) / 2,
          transition: 'left 0.2s',
        }}
      />
    </button>
  );
}

function SmallButton({ onClick, label, accent }: { onClick: () => void; label: string; accent?: boolean }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '6px 14px',
        fontSize: 12,
        fontWeight: 500,
        fontFamily: fonts.sans,
        borderRadius: 6,
        border: `1px solid ${accent ? colors.accent : colors.border}`,
        background: accent ? colors.accent : colors.surfaceRaised,
        color: accent ? '#fff' : colors.text,
        cursor: 'pointer',
        transition: 'background 0.15s',
      }}
    >
      {label}
    </button>
  );
}

const inputStyle: React.CSSProperties = {
  padding: '6px 10px',
  fontSize: 13,
  fontFamily: fonts.sans,
  borderRadius: 6,
  border: `1px solid ${colors.border}`,
  background: colors.surfaceRaised,
  color: colors.text,
  outline: 'none',
};

const selectStyle: React.CSSProperties = {
  padding: '6px 10px',
  fontSize: 13,
  fontFamily: fonts.sans,
  borderRadius: 6,
  border: `1px solid ${colors.border}`,
  background: colors.surfaceRaised,
  color: colors.text,
  outline: 'none',
  cursor: 'pointer',
};
