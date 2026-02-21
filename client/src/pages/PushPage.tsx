import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../lib/api';
import { useIsMobile } from '../hooks/useIsMobile';
import { colors, fonts } from '../styles/theme';
import Skeleton from '../components/Skeleton';
import SectionErrorBoundary from '../components/SectionErrorBoundary';
import Toast from '../components/Toast';

interface Channel {
  id: string;
  name: string;
  channel_type: 'slack' | 'email' | 'webhook';
  config: any;
  is_active: boolean;
  verified_at: string | null;
  last_used_at: string | null;
  created_at: string;
}

interface Rule {
  id: string;
  name: string;
  channel_id: string;
  channel_name: string;
  channel_type: string;
  trigger_type: 'cron' | 'skill_run' | 'threshold';
  trigger_config: any;
  filter_config: any;
  template: string;
  is_active: boolean;
  consecutive_failures: number;
  last_delivery_at: string | null;
  last_triggered_at: string | null;
}

interface LogEntry {
  id: string;
  rule_id: string;
  rule_name: string;
  channel_type: string;
  channel_id: string;
  status: string;
  findings_count: number;
  triggered_by: string;
  error_message: string | null;
  payload_preview: any;
  delivered_at: string;
}

interface ToastState {
  message: string;
  type: 'success' | 'error' | 'info';
}

const SKILL_IDS = [
  'pipeline-hygiene', 'deal-risk-review', 'weekly-recap', 'single-thread-alert',
  'data-quality-audit', 'pipeline-coverage', 'forecast-rollup', 'pipeline-waterfall',
  'rep-scorecard', 'custom-field-discovery', 'lead-scoring', 'contact-role-resolution',
  'icp-discovery', 'bowtie-analysis', 'pipeline-goals', 'project-recap',
  'strategy-insights', 'workspace-config-audit', 'stage-velocity-benchmarks',
  'conversation-intelligence', 'forecast-model', 'pipeline-gen-forecast',
  'competitive-intelligence',
];

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function timeAgo(date: string | null): string {
  if (!date) return 'Never';
  const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (seconds < 0) return 'just now';
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

function formatTrigger(rule: Rule): string {
  const tc = rule.trigger_config || {};
  if (rule.trigger_type === 'cron') {
    const days = (tc.days || []).map((d: number) => DAY_LABELS[d]).join(', ');
    const h = tc.hour ?? 9;
    const m = tc.minute ?? 0;
    const ampm = h >= 12 ? 'PM' : 'AM';
    const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
    const tz = tc.timezone || 'UTC';
    return `${days || 'Daily'} at ${h12}:${String(m).padStart(2, '0')} ${ampm} ${tz}`;
  }
  if (rule.trigger_type === 'skill_run') {
    return `After ${(tc.skill_id || 'skill').replace(/-/g, ' ')} runs`;
  }
  if (rule.trigger_type === 'threshold') {
    const interval = tc.check_interval || '1h';
    return `Score ≥ ${tc.threshold || 30}, checked every ${interval}`;
  }
  return rule.trigger_type;
}

const channelTypeIcon: Record<string, string> = { slack: '#', email: '✉', webhook: '⚡' };
const channelTypeLabel: Record<string, string> = { slack: 'Slack', email: 'Email', webhook: 'Webhook' };

const inputStyle: React.CSSProperties = {
  background: colors.surfaceRaised, border: `1px solid ${colors.border}`, borderRadius: 6,
  padding: '8px 12px', color: colors.text, fontSize: 13, fontFamily: fonts.sans, width: '100%',
  outline: 'none', boxSizing: 'border-box',
};

const selectStyle: React.CSSProperties = { ...inputStyle, appearance: 'auto' as any };

const primaryBtn: React.CSSProperties = {
  background: colors.accent, color: '#fff', padding: '8px 18px', borderRadius: 6,
  fontSize: 13, fontWeight: 600, cursor: 'pointer', border: 'none',
};

const secondaryBtn: React.CSSProperties = {
  background: 'transparent', color: colors.textSecondary, padding: '8px 18px', borderRadius: 6,
  fontSize: 13, fontWeight: 500, cursor: 'pointer', border: `1px solid ${colors.border}`,
};

const dangerBtn: React.CSSProperties = {
  background: colors.redSoft, color: colors.red, padding: '6px 14px', borderRadius: 6,
  fontSize: 12, fontWeight: 600, cursor: 'pointer', border: `1px solid ${colors.red}`,
};

export default function PushPage() {
  const isMobile = useIsMobile();
  const [channels, setChannels] = useState<Channel[]>([]);
  const [rules, setRules] = useState<Rule[]>([]);
  const [logEntries, setLogEntries] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'channels' | 'rules' | 'log'>('channels');
  const [toast, setToast] = useState<ToastState | null>(null);

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingChannel, setEditingChannel] = useState<Channel | null>(null);

  const [ruleModalOpen, setRuleModalOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<Rule | null>(null);

  const [logFilter, setLogFilter] = useState({ status: '', ruleId: '', timeRange: '7d', limit: 25, offset: 0 });
  const [logHasMore, setLogHasMore] = useState(true);

  const [deleteConfirm, setDeleteConfirm] = useState<{ type: 'channel' | 'rule'; id: string } | null>(null);

  const fetchChannels = useCallback(async () => {
    try {
      const data = await api.get('/push/channels');
      setChannels(data.channels || []);
      return data.channels || [];
    } catch { return []; }
  }, []);

  const fetchRules = useCallback(async () => {
    try {
      const data = await api.get('/push/rules');
      setRules(data.rules || []);
    } catch {}
  }, []);

  const buildLogParams = useCallback((offset: number) => {
    const params = new URLSearchParams({ limit: '25', offset: String(offset) });
    if (logFilter.status) params.set('status', logFilter.status);
    if (logFilter.ruleId) params.set('rule_id', logFilter.ruleId);
    if (logFilter.timeRange) {
      const hrs: Record<string, number> = { '24h': 24, '7d': 168, '30d': 720 };
      const h = hrs[logFilter.timeRange];
      if (h) params.set('since', new Date(Date.now() - h * 3600000).toISOString());
    }
    return params;
  }, [logFilter.status, logFilter.ruleId, logFilter.timeRange]);

  const fetchLog = useCallback(async (reset?: boolean) => {
    try {
      const offset = reset ? 0 : logFilter.offset;
      const params = buildLogParams(offset);
      const data = await api.get(`/push/log?${params}`);
      const entries = data.log || [];
      if (reset) {
        setLogEntries(entries);
      } else {
        setLogEntries(prev => [...prev, ...entries]);
      }
      setLogHasMore(entries.length >= 25);
      setLogFilter(prev => ({ ...prev, offset: offset + entries.length }));
    } catch {}
  }, [logFilter.status, logFilter.ruleId, logFilter.timeRange, logFilter.offset, buildLogParams]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const ch = await fetchChannels();
      await fetchRules();
      const hasVerified = (ch as Channel[]).some(c => c.verified_at);
      if (hasVerified) setActiveTab('rules');
      setLoading(false);
    })();
  }, []);

  useEffect(() => {
    if (activeTab === 'log') {
      setLogFilter(prev => ({ ...prev, offset: 0 }));
      setLogEntries([]);
      setLogHasMore(true);
    }
  }, [activeTab]);

  useEffect(() => {
    if (activeTab === 'log') {
      const params = buildLogParams(0);
      api.get(`/push/log?${params}`).then(data => {
        setLogEntries(data.log || []);
        setLogHasMore((data.log || []).length >= 25);
        setLogFilter(prev => ({ ...prev, offset: (data.log || []).length }));
      }).catch(() => {});
    }
  }, [activeTab, logFilter.status, logFilter.ruleId, logFilter.timeRange]);

  const handleDeleteChannel = async (id: string) => {
    try {
      await api.delete(`/push/channels/${id}`);
      setToast({ message: 'Channel deleted', type: 'success' });
      fetchChannels();
      fetchRules();
    } catch (err: any) {
      setToast({ message: err.message || 'Failed to delete', type: 'error' });
    }
    setDeleteConfirm(null);
  };

  const handleDeleteRule = async (id: string) => {
    try {
      await api.delete(`/push/rules/${id}`);
      setToast({ message: 'Rule deleted', type: 'success' });
      fetchRules();
    } catch (err: any) {
      setToast({ message: err.message || 'Failed to delete', type: 'error' });
    }
    setDeleteConfirm(null);
  };

  const handleToggleRule = async (id: string) => {
    try {
      const data = await api.patch(`/push/rules/${id}/toggle`, {});
      setToast({ message: data.is_active ? 'Rule enabled' : 'Rule disabled', type: 'success' });
      fetchRules();
    } catch (err: any) {
      setToast({ message: err.message || 'Toggle failed', type: 'error' });
    }
  };

  const handleTriggerRule = async (id: string) => {
    try {
      const data = await api.post(`/push/rules/${id}/trigger`);
      setToast({ message: `Triggered — ${data.findings_sent} findings sent`, type: 'success' });
      fetchRules();
    } catch (err: any) {
      setToast({ message: err.message || 'Trigger failed', type: 'error' });
    }
  };

  const handleRetrigger = async (ruleId: string) => {
    try {
      const data = await api.post(`/push/rules/${ruleId}/trigger`);
      setToast({ message: `Re-triggered — ${data.findings_sent} findings sent`, type: 'success' });
    } catch (err: any) {
      setToast({ message: err.message || 'Re-trigger failed', type: 'error' });
    }
  };

  const verifiedChannels = channels.filter(c => c.verified_at);

  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <Skeleton width={200} height={28} borderRadius={6} />
        <Skeleton height={48} borderRadius={8} />
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} height={80} borderRadius={8} />
        ))}
      </div>
    );
  }

  const tabs = [
    { key: 'channels' as const, label: 'Channels', count: channels.length },
    { key: 'rules' as const, label: 'Rules', count: rules.length },
    { key: 'log' as const, label: 'Delivery Log' },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, fontFamily: fonts.sans }}>
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: colors.text, margin: 0 }}>Push</h1>
          <p style={{ fontSize: 13, color: colors.textMuted, marginTop: 4 }}>
            Deliver findings to Slack, email, or webhooks
          </p>
        </div>
        {activeTab === 'channels' && (
          <button style={primaryBtn} onClick={() => { setEditingChannel(null); setDrawerOpen(true); }}>
            Add Channel
          </button>
        )}
        {activeTab === 'rules' && (
          <button
            style={{ ...primaryBtn, ...(verifiedChannels.length === 0 ? { opacity: 0.5, cursor: 'not-allowed' } : {}) }}
            onClick={() => { if (verifiedChannels.length > 0) { setEditingRule(null); setRuleModalOpen(true); } }}
            title={verifiedChannels.length === 0 ? 'Add and verify a channel first' : ''}
          >
            Add Rule
          </button>
        )}
      </div>

      <div style={{
        display: 'flex', gap: 2, background: colors.surface, border: `1px solid ${colors.border}`,
        borderRadius: 10, padding: 4,
      }}>
        {tabs.map(tab => {
          const active = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              style={{
                flex: 1, padding: '8px 12px', borderRadius: 8,
                background: active ? colors.surfaceActive : 'transparent',
                color: active ? colors.text : colors.textMuted,
                fontSize: 12, fontWeight: active ? 600 : 500, cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                transition: 'all 0.15s', border: 'none',
              }}
            >
              {tab.label}
              {tab.count !== undefined && tab.count > 0 && (
                <span style={{
                  fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 10,
                  background: active ? colors.accent : colors.surfaceHover,
                  color: active ? '#fff' : colors.textMuted,
                }}>
                  {tab.count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <SectionErrorBoundary fallbackMessage="Failed to load push configuration.">
        {activeTab === 'channels' && (
          <ChannelsTab
            channels={channels}
            onEdit={ch => { setEditingChannel(ch); setDrawerOpen(true); }}
            onDelete={id => setDeleteConfirm({ type: 'channel', id })}
          />
        )}
        {activeTab === 'rules' && (
          <RulesTab
            rules={rules}
            verifiedChannels={verifiedChannels}
            onToggle={handleToggleRule}
            onTrigger={handleTriggerRule}
            onEdit={r => { setEditingRule(r); setRuleModalOpen(true); }}
            onDelete={id => setDeleteConfirm({ type: 'rule', id })}
            onAdd={() => { setEditingRule(null); setRuleModalOpen(true); }}
            isMobile={isMobile}
          />
        )}
        {activeTab === 'log' && (
          <LogTab
            entries={logEntries}
            rules={rules}
            logFilter={logFilter}
            setLogFilter={setLogFilter}
            hasMore={logHasMore}
            onLoadMore={() => {
              const params = buildLogParams(logFilter.offset);
              api.get(`/push/log?${params}`).then(data => {
                const entries = data.log || [];
                setLogEntries(prev => [...prev, ...entries]);
                setLogHasMore(entries.length >= 25);
                setLogFilter(prev => ({ ...prev, offset: prev.offset + entries.length }));
              }).catch(() => {});
            }}
            onRetrigger={handleRetrigger}
            isMobile={isMobile}
          />
        )}
      </SectionErrorBoundary>

      {drawerOpen && (
        <ChannelDrawer
          channel={editingChannel}
          onClose={() => { setDrawerOpen(false); setEditingChannel(null); }}
          onSaved={() => { setDrawerOpen(false); setEditingChannel(null); fetchChannels(); }}
          setToast={setToast}
          isMobile={isMobile}
        />
      )}

      {ruleModalOpen && (
        <RuleModal
          rule={editingRule}
          channels={verifiedChannels}
          onClose={() => { setRuleModalOpen(false); setEditingRule(null); }}
          onSaved={() => { setRuleModalOpen(false); setEditingRule(null); fetchRules(); }}
          setToast={setToast}
          isMobile={isMobile}
        />
      )}

      {deleteConfirm && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 1100, display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.5)' }}
            onClick={() => setDeleteConfirm(null)} />
          <div style={{
            position: 'relative', background: colors.bg, border: `1px solid ${colors.border}`,
            borderRadius: 12, padding: isMobile ? 20 : 24, width: isMobile ? '90%' : 400, maxWidth: '100vw', zIndex: 1,
          }}>
            <h3 style={{ fontSize: 16, fontWeight: 700, color: colors.text, margin: '0 0 8px' }}>
              Delete {deleteConfirm.type === 'channel' ? 'Channel' : 'Rule'}?
            </h3>
            <p style={{ fontSize: 13, color: colors.textSecondary, margin: '0 0 20px' }}>
              This action cannot be undone. {deleteConfirm.type === 'channel'
                ? 'All rules using this channel will also be removed.'
                : 'Delivery history will be preserved.'}
            </p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button style={secondaryBtn} onClick={() => setDeleteConfirm(null)}>Cancel</button>
              <button style={dangerBtn} onClick={() => {
                if (deleteConfirm.type === 'channel') handleDeleteChannel(deleteConfirm.id);
                else handleDeleteRule(deleteConfirm.id);
              }}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ChannelsTab({ channels, onEdit, onDelete }: {
  channels: Channel[];
  onEdit: (ch: Channel) => void;
  onDelete: (id: string) => void;
}) {
  if (channels.length === 0) {
    return (
      <div style={{
        textAlign: 'center', padding: 60, background: colors.surface,
        border: `1px solid ${colors.border}`, borderRadius: 10,
      }}>
        <p style={{ fontSize: 32, marginBottom: 12 }}>📡</p>
        <p style={{ fontSize: 15, color: colors.textSecondary }}>No delivery channels yet</p>
        <p style={{ fontSize: 12, color: colors.textMuted, marginTop: 6 }}>
          Add a Slack, email, or webhook channel to start receiving findings.
        </p>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {channels.map(ch => {
        const verified = !!ch.verified_at;
        return (
          <div key={ch.id} style={{
            background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 8,
            padding: 16, display: 'flex', alignItems: 'center', gap: 14,
          }}>
            <div style={{
              width: 38, height: 38, borderRadius: 8, background: colors.surfaceRaised,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 18, flexShrink: 0,
            }}>
              {channelTypeIcon[ch.channel_type] || '?'}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 14, fontWeight: 600, color: colors.text }}>{ch.name}</span>
                <span style={{
                  fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 4,
                  background: colors.surfaceRaised, color: colors.textSecondary,
                }}>
                  {channelTypeLabel[ch.channel_type]}
                </span>
                {verified ? (
                  <span style={{
                    fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 4,
                    background: colors.greenSoft, color: colors.green,
                  }}>✓ Verified</span>
                ) : (
                  <span style={{
                    fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 4,
                    background: colors.yellowSoft, color: colors.yellow,
                  }}>⚠ Unverified</span>
                )}
              </div>
              <div style={{ fontSize: 11, color: colors.textMuted, marginTop: 4 }}>
                Last used: {timeAgo(ch.last_used_at)}
                {ch.channel_type === 'slack' && ch.config?.webhook_url && (
                  <span style={{ marginLeft: 8, fontFamily: fonts.mono, fontSize: 10, color: colors.textDim }}>
                    {ch.config.webhook_url.substring(0, 40)}…
                  </span>
                )}
                {ch.channel_type === 'email' && ch.config?.recipients && (
                  <span style={{ marginLeft: 8, fontSize: 10, color: colors.textDim }}>
                    {ch.config.recipients.length} recipient{ch.config.recipients.length !== 1 ? 's' : ''}
                  </span>
                )}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
              <button style={{ ...secondaryBtn, padding: '5px 12px', fontSize: 11 }}
                onClick={() => onEdit(ch)}>Edit</button>
              <button style={{ ...secondaryBtn, padding: '5px 12px', fontSize: 11, color: colors.red }}
                onClick={() => onDelete(ch.id)}>Delete</button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ChannelDrawer({ channel, onClose, onSaved, setToast, isMobile }: {
  channel: Channel | null;
  onClose: () => void;
  onSaved: () => void;
  setToast: (t: ToastState) => void;
  isMobile?: boolean;
}) {
  const isEdit = !!channel;
  const [step, setStep] = useState(isEdit ? 2 : 1);
  const [channelType, setChannelType] = useState<'slack' | 'email' | 'webhook'>(channel?.channel_type || 'slack');
  const [name, setName] = useState(channel?.name || '');
  const [webhookUrl, setWebhookUrl] = useState(channel?.config?.webhook_url || '');
  const [endpointUrl, setEndpointUrl] = useState(channel?.config?.endpoint_url || '');
  const [secret, setSecret] = useState(channel?.config?.secret || '');
  const [recipients, setRecipients] = useState<string[]>(channel?.config?.recipients || []);
  const [recipientInput, setRecipientInput] = useState('');
  const [fromName, setFromName] = useState(channel?.config?.from_name || 'Pandora');
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [savedChannelId, setSavedChannelId] = useState<string | null>(channel?.id || null);
  const [configChanged, setConfigChanged] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const buildConfig = () => {
    if (channelType === 'slack') return { webhook_url: webhookUrl };
    if (channelType === 'email') return { recipients, from_name: fromName };
    return { endpoint_url: endpointUrl, ...(secret ? { secret } : {}) };
  };

  const canProceedStep2 = () => {
    if (!name.trim()) return false;
    if (channelType === 'slack' && !webhookUrl.trim()) return false;
    if (channelType === 'email' && recipients.length === 0) return false;
    if (channelType === 'webhook' && !endpointUrl.trim()) return false;
    return true;
  };

  const handleSaveConfig = async () => {
    setSaving(true);
    setError('');
    try {
      if (isEdit && savedChannelId) {
        await api.patch(`/push/channels/${savedChannelId}`, { name, config: buildConfig() });
        setConfigChanged(true);
      } else {
        const result = await api.post('/push/channels', { name, channel_type: channelType, config: buildConfig() });
        setSavedChannelId(result.id);
      }
      setStep(3);
    } catch (err: any) {
      setError(err.message || 'Failed to save channel');
    }
    setSaving(false);
  };

  const handleTest = async () => {
    if (!savedChannelId) return;
    setTesting(true);
    setTestResult(null);
    try {
      const result = await api.post(`/push/channels/${savedChannelId}/test`);
      setTestResult({ ok: true, message: result.message || 'Test message sent successfully' });
      setConfigChanged(false);
    } catch (err: any) {
      setTestResult({ ok: false, message: err.message || 'Test failed' });
    }
    setTesting(false);
  };

  const handleFinish = () => {
    setToast({ message: isEdit ? 'Channel updated' : 'Channel added', type: 'success' });
    onSaved();
  };

  const testPassed = testResult?.ok && !configChanged;

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', justifyContent: 'flex-end' }}>
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.4)' }} onClick={onClose} />
      <div style={{
        position: 'relative', width: isMobile ? '100%' : 480, maxWidth: '100vw', height: '100vh', background: colors.bg,
        borderLeft: `1px solid ${colors.border}`, display: 'flex', flexDirection: 'column',
        overflowY: 'auto',
      }}>
        <div style={{
          padding: '20px 24px', borderBottom: `1px solid ${colors.border}`,
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, color: colors.text, margin: 0 }}>
            {isEdit ? 'Edit Channel' : 'Add Channel'}
          </h2>
          <button style={{ background: 'none', border: 'none', color: colors.textMuted, fontSize: 18, cursor: 'pointer' }}
            onClick={onClose}>✕</button>
        </div>

        <div style={{ padding: '12px 24px', borderBottom: `1px solid ${colors.border}`, display: 'flex', gap: 8 }}>
          {[1, 2, 3].map(s => (
            <div key={s} style={{
              flex: 1, height: 3, borderRadius: 2,
              background: s <= step ? colors.accent : colors.surfaceRaised,
            }} />
          ))}
        </div>

        <div style={{ flex: 1, padding: 24 }}>
          {step === 1 && (
            <div>
              <p style={{ fontSize: 13, color: colors.textSecondary, marginBottom: 16 }}>
                Select a channel type
              </p>
              {(['slack', 'email', 'webhook'] as const).map(type => {
                const active = channelType === type;
                const descriptions: Record<string, string> = {
                  slack: 'Send findings to a Slack channel via incoming webhook',
                  email: 'Email digests to one or more recipients',
                  webhook: 'POST JSON payloads to any HTTP endpoint',
                };
                return (
                  <div key={type} onClick={() => setChannelType(type)} style={{
                    background: active ? colors.accentSoft : colors.surface,
                    border: `1px solid ${active ? colors.accent : colors.border}`,
                    borderRadius: 8, padding: 16, marginBottom: 10, cursor: 'pointer',
                    display: 'flex', alignItems: 'center', gap: 14,
                  }}>
                    <div style={{
                      width: 40, height: 40, borderRadius: 8, background: colors.surfaceRaised,
                      display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20,
                    }}>
                      {channelTypeIcon[type]}
                    </div>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 600, color: colors.text }}>
                        {channelTypeLabel[type]}
                      </div>
                      <div style={{ fontSize: 12, color: colors.textMuted, marginTop: 2 }}>
                        {descriptions[type]}
                      </div>
                    </div>
                  </div>
                );
              })}
              <div style={{ marginTop: 20, display: 'flex', justifyContent: 'flex-end' }}>
                <button style={primaryBtn} onClick={() => setStep(2)}>Next</button>
              </div>
            </div>
          )}

          {step === 2 && (
            <div>
              <p style={{ fontSize: 13, color: colors.textSecondary, marginBottom: 16 }}>
                Configure your {channelTypeLabel[channelType]} channel
              </p>

              <label style={{ fontSize: 12, color: colors.textSecondary, fontWeight: 600, marginBottom: 4, display: 'block' }}>
                Channel Name
              </label>
              <input style={inputStyle} value={name} onChange={e => setName(e.target.value)}
                placeholder={`My ${channelTypeLabel[channelType]} Channel`} />

              {channelType === 'slack' && (
                <div style={{ marginTop: 16 }}>
                  <label style={{ fontSize: 12, color: colors.textSecondary, fontWeight: 600, marginBottom: 4, display: 'block' }}>
                    Webhook URL
                  </label>
                  <input style={{ ...inputStyle, fontFamily: fonts.mono, fontSize: 12 }}
                    value={webhookUrl}
                    onChange={e => { setWebhookUrl(e.target.value); setConfigChanged(true); }}
                    placeholder="https://hooks.slack.com/services/..." />
                </div>
              )}

              {channelType === 'email' && (
                <>
                  <div style={{ marginTop: 16 }}>
                    <label style={{ fontSize: 12, color: colors.textSecondary, fontWeight: 600, marginBottom: 4, display: 'block' }}>
                      Recipients
                    </label>
                    <div style={{
                      ...inputStyle, display: 'flex', flexWrap: 'wrap', gap: 4, padding: '6px 8px',
                      minHeight: 38, alignItems: 'center',
                    }}>
                      {recipients.map((email, i) => (
                        <span key={i} style={{
                          fontSize: 11, background: colors.accentSoft, color: colors.accent,
                          padding: '2px 8px', borderRadius: 4, display: 'flex', alignItems: 'center', gap: 4,
                        }}>
                          {email}
                          <span style={{ cursor: 'pointer', fontSize: 13, lineHeight: 1 }}
                            onClick={() => { setRecipients(recipients.filter((_, j) => j !== i)); setConfigChanged(true); }}>×</span>
                        </span>
                      ))}
                      <input
                        style={{ border: 'none', background: 'transparent', color: colors.text, fontSize: 12,
                          outline: 'none', flex: 1, minWidth: 120, fontFamily: fonts.sans }}
                        value={recipientInput}
                        onChange={e => setRecipientInput(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter' && recipientInput.includes('@')) {
                            e.preventDefault();
                            setRecipients([...recipients, recipientInput.trim()]);
                            setRecipientInput('');
                            setConfigChanged(true);
                          }
                        }}
                        placeholder="type email + Enter"
                      />
                    </div>
                  </div>
                  <div style={{ marginTop: 16 }}>
                    <label style={{ fontSize: 12, color: colors.textSecondary, fontWeight: 600, marginBottom: 4, display: 'block' }}>
                      From Name
                    </label>
                    <input style={inputStyle} value={fromName} onChange={e => setFromName(e.target.value)} />
                  </div>
                </>
              )}

              {channelType === 'webhook' && (
                <>
                  <div style={{ marginTop: 16 }}>
                    <label style={{ fontSize: 12, color: colors.textSecondary, fontWeight: 600, marginBottom: 4, display: 'block' }}>
                      Endpoint URL
                    </label>
                    <input style={{ ...inputStyle, fontFamily: fonts.mono, fontSize: 12 }}
                      value={endpointUrl}
                      onChange={e => { setEndpointUrl(e.target.value); setConfigChanged(true); }}
                      placeholder="https://example.com/webhook" />
                  </div>
                  <div style={{ marginTop: 16 }}>
                    <label style={{ fontSize: 12, color: colors.textSecondary, fontWeight: 600, marginBottom: 4, display: 'block' }}>
                      Secret (optional, for HMAC signing)
                    </label>
                    <input style={{ ...inputStyle, fontFamily: fonts.mono, fontSize: 12 }}
                      value={secret} onChange={e => setSecret(e.target.value)}
                      placeholder="optional-hmac-secret" />
                  </div>
                </>
              )}

              {error && (
                <p style={{ fontSize: 12, color: colors.red, marginTop: 12 }}>{error}</p>
              )}

              <div style={{ marginTop: 24, display: 'flex', justifyContent: 'space-between' }}>
                {!isEdit && (
                  <button style={secondaryBtn} onClick={() => setStep(1)}>Back</button>
                )}
                <div style={{ marginLeft: 'auto' }}>
                  <button style={{ ...primaryBtn, ...((!canProceedStep2() || saving) ? { opacity: 0.5 } : {}) }}
                    disabled={!canProceedStep2() || saving}
                    onClick={handleSaveConfig}>
                    {saving ? 'Saving...' : 'Save & Test'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {step === 3 && (
            <div>
              <p style={{ fontSize: 13, color: colors.textSecondary, marginBottom: 16 }}>
                Test your channel to verify it works
              </p>

              <div style={{
                background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 8,
                padding: 20, textAlign: 'center',
              }}>
                <button
                  style={{ ...primaryBtn, ...(testing ? { opacity: 0.6 } : {}) }}
                  disabled={testing}
                  onClick={handleTest}
                >
                  {testing ? 'Sending...' : 'Send Test Message'}
                </button>

                {testResult && (
                  <div style={{
                    marginTop: 16, padding: '10px 14px', borderRadius: 6,
                    background: testResult.ok ? colors.greenSoft : colors.redSoft,
                    border: `1px solid ${testResult.ok ? colors.green : colors.red}`,
                    color: testResult.ok ? colors.green : colors.red,
                    fontSize: 12, textAlign: 'left',
                  }}>
                    {testResult.ok ? '✓ ' : '✕ '}{testResult.message}
                  </div>
                )}
              </div>

              <div style={{ marginTop: 24, display: 'flex', justifyContent: 'space-between' }}>
                <button style={secondaryBtn} onClick={() => setStep(2)}>Back</button>
                <button style={{ ...primaryBtn, ...((!testPassed) ? { opacity: 0.5, cursor: 'not-allowed' } : {}) }}
                  disabled={!testPassed}
                  onClick={handleFinish}>
                  Done
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function RulesTab({ rules, verifiedChannels, onToggle, onTrigger, onEdit, onDelete, onAdd, isMobile }: {
  rules: Rule[];
  verifiedChannels: Channel[];
  onToggle: (id: string) => void;
  onTrigger: (id: string) => void;
  onEdit: (r: Rule) => void;
  onDelete: (id: string) => void;
  onAdd: () => void;
  isMobile?: boolean;
}) {
  if (rules.length === 0) {
    return (
      <div style={{
        textAlign: 'center', padding: 60, background: colors.surface,
        border: `1px solid ${colors.border}`, borderRadius: 10,
      }}>
        <p style={{ fontSize: 32, marginBottom: 12 }}>📋</p>
        <p style={{ fontSize: 15, color: colors.textSecondary }}>No delivery rules yet</p>
        <p style={{ fontSize: 12, color: colors.textMuted, marginTop: 6 }}>
          {verifiedChannels.length === 0
            ? 'Add and verify a channel first, then create rules to deliver findings.'
            : 'Create a rule to start delivering findings to your channels.'}
        </p>
        <button
          style={{ ...primaryBtn, marginTop: 16, ...(verifiedChannels.length === 0 ? { opacity: 0.5, cursor: 'not-allowed' } : {}) }}
          disabled={verifiedChannels.length === 0}
          title={verifiedChannels.length === 0 ? 'Add and verify a channel first' : ''}
          onClick={onAdd}
        >
          Add Rule
        </button>
      </div>
    );
  }

  if (isMobile) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {rules.map(rule => {
          const autoDisabled = rule.consecutive_failures >= 5;
          const failed = rule.consecutive_failures > 0;
          let statusBg = colors.surfaceRaised;
          let statusColor = colors.textMuted;
          let statusLabel = 'Inactive';
          if (autoDisabled) {
            statusBg = colors.redSoft; statusColor = colors.red; statusLabel = 'Auto-disabled';
          } else if (failed) {
            statusBg = colors.redSoft; statusColor = colors.red; statusLabel = `Failed (${rule.consecutive_failures})`;
          } else if (rule.is_active) {
            statusBg = colors.greenSoft; statusColor = colors.green; statusLabel = 'Active';
          }

          return (
            <div key={rule.id} style={{
              background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 8,
              padding: 14,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: colors.text }}>{rule.name}</span>
                <span style={{
                  fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 4,
                  background: statusBg, color: statusColor,
                }}>
                  {statusLabel}
                </span>
              </div>
              <div style={{ fontSize: 12, color: colors.textSecondary, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 14 }}>{channelTypeIcon[rule.channel_type] || '?'}</span>
                {rule.channel_name}
              </div>
              <div style={{ fontSize: 11, color: colors.textMuted, marginBottom: 4 }}>{formatTrigger(rule)}</div>
              <div style={{ fontSize: 11, color: colors.textMuted, marginBottom: 10 }}>Last delivered: {timeAgo(rule.last_delivery_at)}</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <button onClick={() => onToggle(rule.id)} title={rule.is_active ? 'Disable' : 'Enable'}
                  style={{
                    width: 36, height: 20, borderRadius: 10, cursor: 'pointer', border: 'none',
                    background: rule.is_active ? colors.green : colors.surfaceRaised,
                    position: 'relative', transition: 'background 0.2s',
                  }}>
                  <span style={{
                    position: 'absolute', top: 2, left: rule.is_active ? 18 : 2,
                    width: 16, height: 16, borderRadius: '50%', background: '#fff',
                    transition: 'left 0.2s',
                  }} />
                </button>
                <button style={{ ...secondaryBtn, padding: '3px 8px', fontSize: 12 }}
                  onClick={() => onTrigger(rule.id)} title="Trigger now">▶</button>
                <button style={{ ...secondaryBtn, padding: '3px 8px', fontSize: 12 }}
                  onClick={() => onEdit(rule)} title="Edit">✎</button>
                <button style={{ ...secondaryBtn, padding: '3px 8px', fontSize: 12, color: colors.red }}
                  onClick={() => onDelete(rule.id)} title="Delete">🗑</button>
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 10, overflow: 'hidden' }}>
      <div style={{
        display: 'grid', gridTemplateColumns: '2fr 1.2fr 1.5fr 1fr 0.8fr 1.2fr',
        padding: '10px 16px', borderBottom: `1px solid ${colors.border}`,
        fontSize: 10, fontWeight: 600, color: colors.textDim, textTransform: 'uppercase', letterSpacing: '0.05em',
      }}>
        <span>Rule Name</span>
        <span>Channel</span>
        <span>Trigger</span>
        <span>Last Delivered</span>
        <span>Status</span>
        <span style={{ textAlign: 'right' }}>Actions</span>
      </div>

      {rules.map(rule => {
        const autoDisabled = rule.consecutive_failures >= 5;
        const failed = rule.consecutive_failures > 0;
        let statusBg = colors.surfaceRaised;
        let statusColor = colors.textMuted;
        let statusLabel = 'Inactive';
        if (autoDisabled) {
          statusBg = colors.redSoft; statusColor = colors.red; statusLabel = '🔒 Auto-disabled';
        } else if (failed) {
          statusBg = colors.redSoft; statusColor = colors.red; statusLabel = `Failed (${rule.consecutive_failures})`;
        } else if (rule.is_active) {
          statusBg = colors.greenSoft; statusColor = colors.green; statusLabel = 'Active';
        }

        return (
          <div key={rule.id} style={{
            display: 'grid', gridTemplateColumns: '2fr 1.2fr 1.5fr 1fr 0.8fr 1.2fr',
            padding: '10px 16px', borderBottom: `1px solid ${colors.border}`, alignItems: 'center',
          }}
            onMouseEnter={e => (e.currentTarget.style.background = colors.surfaceHover)}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
          >
            <span style={{ fontSize: 13, fontWeight: 500, color: colors.text }}>{rule.name}</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 14 }}>{channelTypeIcon[rule.channel_type] || '?'}</span>
              <span style={{ fontSize: 12, color: colors.textSecondary }}>{rule.channel_name}</span>
            </div>
            <span style={{ fontSize: 11, color: colors.textMuted }}>{formatTrigger(rule)}</span>
            <span style={{ fontSize: 11, color: colors.textMuted }}>{timeAgo(rule.last_delivery_at)}</span>
            <span style={{
              fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 4,
              background: statusBg, color: statusColor, justifySelf: 'start',
            }}>
              {statusLabel}
            </span>
            <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
              <button onClick={() => onToggle(rule.id)} title={rule.is_active ? 'Disable' : 'Enable'}
                style={{
                  width: 36, height: 20, borderRadius: 10, cursor: 'pointer', border: 'none',
                  background: rule.is_active ? colors.green : colors.surfaceRaised,
                  position: 'relative', transition: 'background 0.2s',
                }}>
                <span style={{
                  position: 'absolute', top: 2, left: rule.is_active ? 18 : 2,
                  width: 16, height: 16, borderRadius: '50%', background: '#fff',
                  transition: 'left 0.2s',
                }} />
              </button>
              <button style={{ ...secondaryBtn, padding: '3px 8px', fontSize: 12 }}
                onClick={() => onTrigger(rule.id)} title="Trigger now">▶</button>
              <button style={{ ...secondaryBtn, padding: '3px 8px', fontSize: 12 }}
                onClick={() => onEdit(rule)} title="Edit">✎</button>
              <button style={{ ...secondaryBtn, padding: '3px 8px', fontSize: 12, color: colors.red }}
                onClick={() => onDelete(rule.id)} title="Delete">🗑</button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function RuleModal({ rule, channels, onClose, onSaved, setToast, isMobile }: {
  rule: Rule | null;
  channels: Channel[];
  onClose: () => void;
  onSaved: () => void;
  setToast: (t: ToastState) => void;
  isMobile?: boolean;
}) {
  const isEdit = !!rule;
  const [step, setStep] = useState(1);
  const [channelId, setChannelId] = useState(rule?.channel_id || (channels[0]?.id || ''));
  const [triggerType, setTriggerType] = useState<'cron' | 'skill_run' | 'threshold'>(rule?.trigger_type || 'cron');
  const [cronDays, setCronDays] = useState<number[]>(rule?.trigger_config?.days || [1, 2, 3, 4, 5]);
  const [cronHour, setCronHour] = useState(rule?.trigger_config?.hour ?? 9);
  const [cronMinute, setCronMinute] = useState(rule?.trigger_config?.minute ?? 0);
  const [cronTimezone, setCronTimezone] = useState(rule?.trigger_config?.timezone || 'UTC');
  const [skillId, setSkillId] = useState(rule?.trigger_config?.skill_id || SKILL_IDS[0]);
  const [threshold, setThreshold] = useState(rule?.trigger_config?.threshold ?? 30);
  const [minAmount, setMinAmount] = useState(rule?.trigger_config?.min_amount ?? '');
  const [checkInterval, setCheckInterval] = useState(rule?.trigger_config?.check_interval || '1h');
  const [severities, setSeverities] = useState<string[]>(rule?.filter_config?.severities || ['act', 'watch']);
  const [filterSkillIds, setFilterSkillIds] = useState<string[] | null>(rule?.filter_config?.skill_ids || null);
  const [filterMinDeal, setFilterMinDeal] = useState(rule?.filter_config?.min_deal_amount ?? '');
  const [maxFindings, setMaxFindings] = useState(rule?.filter_config?.max_findings ?? 20);
  const [template, setTemplate] = useState(rule?.template || 'standard');
  const [ruleName, setRuleName] = useState(rule?.name || '');
  const [saveInactive, setSaveInactive] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const selectedChannel = channels.find(c => c.id === channelId);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  useEffect(() => {
    if (!isEdit && step === 4) {
      if (triggerType === 'threshold') setTemplate('alert');
      else if (selectedChannel?.channel_type === 'email') setTemplate('digest');
      else if (selectedChannel?.channel_type === 'webhook') setTemplate('raw_json');
    }
  }, [step]);

  useEffect(() => {
    if (!isEdit && !ruleName) {
      const chName = selectedChannel?.name || '';
      const trigLabel = triggerType === 'cron' ? 'Scheduled' : triggerType === 'skill_run' ? 'Post-run' : 'Threshold';
      setRuleName(`${trigLabel} → ${chName}`.trim());
    }
  }, [step, channelId, triggerType]);

  const buildTriggerConfig = () => {
    if (triggerType === 'cron') return { days: cronDays, hour: cronHour, minute: cronMinute, timezone: cronTimezone };
    if (triggerType === 'skill_run') return { skill_id: skillId };
    return { threshold, ...(minAmount ? { min_amount: Number(minAmount) } : {}), check_interval: checkInterval };
  };

  const buildFilterConfig = () => ({
    severities,
    skill_ids: filterSkillIds,
    min_deal_amount: filterMinDeal ? Number(filterMinDeal) : null,
    max_findings: maxFindings,
  });

  const handleSave = async () => {
    setSaving(true);
    setError('');
    try {
      if (isEdit && rule) {
        await api.patch(`/push/rules/${rule.id}`, {
          name: ruleName,
          trigger_config: buildTriggerConfig(),
          filter_config: buildFilterConfig(),
          template,
          is_active: saveInactive ? false : undefined,
        });
      } else {
        await api.post('/push/rules', {
          channel_id: channelId,
          name: ruleName,
          trigger_type: triggerType,
          trigger_config: buildTriggerConfig(),
          filter_config: buildFilterConfig(),
          template,
        });
        if (saveInactive) {
        }
      }
      setToast({ message: isEdit ? 'Rule updated' : 'Rule created', type: 'success' });
      onSaved();
    } catch (err: any) {
      setError(err.message || 'Failed to save rule');
    }
    setSaving(false);
  };

  const stepLabels = ['Channel', 'Trigger', 'Filters', 'Template', 'Name'];

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.5)' }} onClick={onClose} />
      <div style={{
        position: 'relative', background: colors.bg, border: `1px solid ${colors.border}`,
        borderRadius: isMobile ? 0 : 12, width: isMobile ? '100%' : '90%', maxWidth: isMobile ? '100vw' : 680,
        maxHeight: isMobile ? '100vh' : '90vh', overflow: 'auto',
        display: 'flex', flexDirection: 'column',
      }}>
        <div style={{
          padding: '20px 24px', borderBottom: `1px solid ${colors.border}`,
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, color: colors.text, margin: 0 }}>
            {isEdit ? 'Edit Rule' : 'Add Rule'}
          </h2>
          <button style={{ background: 'none', border: 'none', color: colors.textMuted, fontSize: 18, cursor: 'pointer' }}
            onClick={onClose}>✕</button>
        </div>

        <div style={{ display: 'flex', gap: 4, padding: '12px 24px', borderBottom: `1px solid ${colors.border}` }}>
          {stepLabels.map((label, i) => {
            const s = i + 1;
            const active = s === step;
            const done = s < step;
            return (
              <button key={s} onClick={() => (isEdit || done) && setStep(s)} style={{
                flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
                background: 'none', border: 'none', cursor: (isEdit || done) ? 'pointer' : 'default',
                opacity: active ? 1 : done ? 0.8 : 0.4,
              }}>
                <span style={{
                  width: 24, height: 24, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 11, fontWeight: 700,
                  background: active ? colors.accent : done ? colors.greenSoft : colors.surfaceRaised,
                  color: active ? '#fff' : done ? colors.green : colors.textMuted,
                }}>
                  {done ? '✓' : s}
                </span>
                <span style={{ fontSize: 10, color: active ? colors.text : colors.textMuted }}>{label}</span>
              </button>
            );
          })}
        </div>

        <div style={{ padding: 24, flex: 1 }}>
          {step === 1 && (
            <div>
              <label style={{ fontSize: 12, color: colors.textSecondary, fontWeight: 600, marginBottom: 6, display: 'block' }}>
                Delivery Channel
              </label>
              <select style={selectStyle} value={channelId} onChange={e => setChannelId(e.target.value)}>
                {channels.map(ch => (
                  <option key={ch.id} value={ch.id}>
                    {channelTypeIcon[ch.channel_type]} {ch.name} ({channelTypeLabel[ch.channel_type]})
                  </option>
                ))}
              </select>
            </div>
          )}

          {step === 2 && (
            <div>
              <p style={{ fontSize: 13, color: colors.textSecondary, marginBottom: 16 }}>When should this rule fire?</p>
              <div style={{ display: 'flex', gap: 10, marginBottom: 20 }}>
                {([
                  { key: 'cron', label: 'Schedule', desc: 'Recurring on selected days/times' },
                  { key: 'skill_run', label: 'After Skill Run', desc: 'Fires after a specific skill completes' },
                  { key: 'threshold', label: 'Score Threshold', desc: 'When risk score crosses a threshold' },
                ] as const).map(t => {
                  const active = triggerType === t.key;
                  return (
                    <div key={t.key} onClick={() => setTriggerType(t.key)} style={{
                      flex: 1, background: active ? colors.accentSoft : colors.surface,
                      border: `1px solid ${active ? colors.accent : colors.border}`,
                      borderRadius: 8, padding: 14, cursor: 'pointer', textAlign: 'center',
                    }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: colors.text }}>{t.label}</div>
                      <div style={{ fontSize: 11, color: colors.textMuted, marginTop: 4 }}>{t.desc}</div>
                    </div>
                  );
                })}
              </div>

              {triggerType === 'cron' && (
                <div>
                  <label style={{ fontSize: 12, color: colors.textSecondary, fontWeight: 600, marginBottom: 8, display: 'block' }}>
                    Days
                  </label>
                  <div style={{ display: 'flex', gap: 4, marginBottom: 16 }}>
                    {DAY_LABELS.map((d, i) => {
                      const active = cronDays.includes(i);
                      return (
                        <button key={i} onClick={() => {
                          setCronDays(active ? cronDays.filter(x => x !== i) : [...cronDays, i].sort());
                        }} style={{
                          width: 40, height: 32, borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer',
                          background: active ? colors.accent : colors.surfaceRaised,
                          color: active ? '#fff' : colors.textMuted,
                          border: `1px solid ${active ? colors.accent : colors.border}`,
                        }}>
                          {d}
                        </button>
                      );
                    })}
                  </div>

                  <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
                    <div style={{ flex: 1 }}>
                      <label style={{ fontSize: 11, color: colors.textMuted, display: 'block', marginBottom: 4 }}>Hour</label>
                      <select style={selectStyle} value={cronHour} onChange={e => setCronHour(Number(e.target.value))}>
                        {Array.from({ length: 24 }, (_, i) => {
                          const ampm = i >= 12 ? 'PM' : 'AM';
                          const h12 = i === 0 ? 12 : i > 12 ? i - 12 : i;
                          return <option key={i} value={i}>{h12} {ampm}</option>;
                        })}
                      </select>
                    </div>
                    <div style={{ flex: 1 }}>
                      <label style={{ fontSize: 11, color: colors.textMuted, display: 'block', marginBottom: 4 }}>Minute</label>
                      <select style={selectStyle} value={cronMinute} onChange={e => setCronMinute(Number(e.target.value))}>
                        {[0, 15, 30, 45].map(m => (
                          <option key={m} value={m}>{String(m).padStart(2, '0')}</option>
                        ))}
                      </select>
                    </div>
                    <div style={{ flex: 1 }}>
                      <label style={{ fontSize: 11, color: colors.textMuted, display: 'block', marginBottom: 4 }}>Timezone</label>
                      <select style={selectStyle} value={cronTimezone} onChange={e => setCronTimezone(e.target.value)}>
                        {['UTC', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'Europe/London', 'Europe/Berlin', 'Asia/Tokyo'].map(tz => (
                          <option key={tz} value={tz}>{tz}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div style={{ fontSize: 12, color: colors.textSecondary, background: colors.surfaceRaised, borderRadius: 6, padding: '8px 12px' }}>
                    Preview: {cronDays.map(d => DAY_LABELS[d]).join(', ') || 'No days selected'} at{' '}
                    {cronHour === 0 ? 12 : cronHour > 12 ? cronHour - 12 : cronHour}:{String(cronMinute).padStart(2, '0')}{' '}
                    {cronHour >= 12 ? 'PM' : 'AM'} {cronTimezone}
                  </div>
                </div>
              )}

              {triggerType === 'skill_run' && (
                <div>
                  <label style={{ fontSize: 12, color: colors.textSecondary, fontWeight: 600, marginBottom: 6, display: 'block' }}>
                    After which skill?
                  </label>
                  <select style={selectStyle} value={skillId} onChange={e => setSkillId(e.target.value)}>
                    {SKILL_IDS.map(id => (
                      <option key={id} value={id}>{id.replace(/-/g, ' ')}</option>
                    ))}
                  </select>
                </div>
              )}

              {triggerType === 'threshold' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  <div>
                    <label style={{ fontSize: 12, color: colors.textSecondary, fontWeight: 600, marginBottom: 6, display: 'block' }}>
                      Score Threshold (1-100)
                    </label>
                    <input type="number" style={inputStyle} value={threshold} min={1} max={100}
                      onChange={e => setThreshold(Number(e.target.value))} />
                  </div>
                  <div>
                    <label style={{ fontSize: 12, color: colors.textSecondary, fontWeight: 600, marginBottom: 6, display: 'block' }}>
                      Min Deal Amount (optional)
                    </label>
                    <input type="number" style={inputStyle} value={minAmount}
                      onChange={e => setMinAmount(e.target.value)} placeholder="0" />
                  </div>
                  <div>
                    <label style={{ fontSize: 12, color: colors.textSecondary, fontWeight: 600, marginBottom: 6, display: 'block' }}>
                      Check Interval
                    </label>
                    <select style={selectStyle} value={checkInterval} onChange={e => setCheckInterval(e.target.value)}>
                      {['15m', '30m', '1h', '4h'].map(v => (
                        <option key={v} value={v}>{v}</option>
                      ))}
                    </select>
                  </div>
                </div>
              )}
            </div>
          )}

          {step === 3 && (
            <div>
              <p style={{ fontSize: 13, color: colors.textSecondary, marginBottom: 16 }}>Which findings should be included?</p>

              <div style={{ marginBottom: 16 }}>
                <label style={{ fontSize: 12, color: colors.textSecondary, fontWeight: 600, marginBottom: 8, display: 'block' }}>
                  Severities
                </label>
                <div style={{ display: 'flex', gap: 6 }}>
                  {['act', 'watch', 'info'].map(sev => {
                    const active = severities.includes(sev);
                    const sevColor = sev === 'act' ? colors.red : sev === 'watch' ? colors.yellow : colors.accent;
                    return (
                      <button key={sev} onClick={() => {
                        setSeverities(active ? severities.filter(s => s !== sev) : [...severities, sev]);
                      }} style={{
                        padding: '6px 14px', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                        background: active ? sevColor : colors.surfaceRaised,
                        color: active ? '#fff' : colors.textMuted,
                        border: `1px solid ${active ? sevColor : colors.border}`,
                        textTransform: 'capitalize',
                      }}>
                        {sev}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div style={{ marginBottom: 16 }}>
                <label style={{ fontSize: 12, color: colors.textSecondary, fontWeight: 600, marginBottom: 6, display: 'block' }}>
                  Skills (leave empty for all)
                </label>
                <div style={{
                  ...inputStyle, display: 'flex', flexWrap: 'wrap', gap: 4, padding: '6px 8px',
                  minHeight: 38, alignItems: 'center', maxHeight: 120, overflowY: 'auto',
                }}>
                  {(filterSkillIds || []).map(id => (
                    <span key={id} style={{
                      fontSize: 10, background: colors.accentSoft, color: colors.accent,
                      padding: '2px 6px', borderRadius: 4, display: 'flex', alignItems: 'center', gap: 3,
                    }}>
                      {id.replace(/-/g, ' ')}
                      <span style={{ cursor: 'pointer', fontSize: 12 }}
                        onClick={() => {
                          const newIds = (filterSkillIds || []).filter(s => s !== id);
                          setFilterSkillIds(newIds.length ? newIds : null);
                        }}>×</span>
                    </span>
                  ))}
                  <select style={{ ...selectStyle, width: 'auto', flex: 1, minWidth: 120, fontSize: 11, padding: '2px 4px', border: 'none', background: 'transparent' }}
                    value="" onChange={e => {
                      if (e.target.value) {
                        setFilterSkillIds([...(filterSkillIds || []), e.target.value]);
                        e.target.value = '';
                      }
                    }}>
                    <option value="">+ add skill</option>
                    {SKILL_IDS.filter(id => !(filterSkillIds || []).includes(id)).map(id => (
                      <option key={id} value={id}>{id.replace(/-/g, ' ')}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div style={{ marginBottom: 16 }}>
                <label style={{ fontSize: 12, color: colors.textSecondary, fontWeight: 600, marginBottom: 6, display: 'block' }}>
                  Min Deal Amount
                </label>
                <input type="number" style={inputStyle} value={filterMinDeal}
                  onChange={e => setFilterMinDeal(e.target.value)} placeholder="No minimum" />
              </div>

              <div style={{ marginBottom: 16 }}>
                <label style={{ fontSize: 12, color: colors.textSecondary, fontWeight: 600, marginBottom: 6, display: 'block' }}>
                  Max Findings: {maxFindings}
                </label>
                <input type="range" min={1} max={50} value={maxFindings}
                  onChange={e => setMaxFindings(Number(e.target.value))}
                  style={{ width: '100%', accentColor: colors.accent }} />
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: colors.textDim }}>
                  <span>1</span><span>50</span>
                </div>
              </div>

              <div style={{ fontSize: 12, color: colors.textSecondary, background: colors.surfaceRaised, borderRadius: 6, padding: '8px 12px' }}>
                Include {severities.join(', ') || 'no'} severities
                {filterSkillIds ? ` from ${filterSkillIds.length} skill${filterSkillIds.length !== 1 ? 's' : ''}` : ' from all skills'}
                , up to {maxFindings} findings
                {filterMinDeal ? ` (deals ≥ $${filterMinDeal})` : ''}
              </div>
            </div>
          )}

          {step === 4 && (
            <div>
              <p style={{ fontSize: 13, color: colors.textSecondary, marginBottom: 16 }}>Choose a message template</p>
              {([
                { key: 'standard', label: 'Standard', desc: 'Clean summary with key findings and action items' },
                { key: 'alert', label: 'Alert', desc: 'Urgent format for threshold-triggered notifications' },
                { key: 'digest', label: 'Digest', desc: 'Comprehensive overview — great for email' },
                { key: 'raw_json', label: 'Raw JSON', desc: 'Full payload for webhook integrations and pipelines' },
              ] as const).map(t => {
                const active = template === t.key;
                return (
                  <div key={t.key} onClick={() => setTemplate(t.key)} style={{
                    background: active ? colors.accentSoft : colors.surface,
                    border: `1px solid ${active ? colors.accent : colors.border}`,
                    borderRadius: 8, padding: 14, marginBottom: 10, cursor: 'pointer',
                    display: 'flex', alignItems: 'center', gap: 14,
                  }}>
                    <div style={{
                      width: 36, height: 36, borderRadius: 8, background: colors.surfaceRaised,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 14, fontFamily: fonts.mono, color: active ? colors.accent : colors.textMuted,
                    }}>
                      {t.key === 'standard' ? '📄' : t.key === 'alert' ? '🚨' : t.key === 'digest' ? '📊' : '{ }'}
                    </div>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: colors.text }}>{t.label}</div>
                      <div style={{ fontSize: 11, color: colors.textMuted, marginTop: 2 }}>{t.desc}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {step === 5 && (
            <div>
              <div style={{ marginBottom: 20 }}>
                <label style={{ fontSize: 12, color: colors.textSecondary, fontWeight: 600, marginBottom: 6, display: 'block' }}>
                  Rule Name
                </label>
                <input style={inputStyle} value={ruleName} onChange={e => setRuleName(e.target.value)} />
              </div>

              <div style={{
                background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 8, padding: 16,
                marginBottom: 20,
              }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: colors.textDim, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 12 }}>
                  Summary
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: colors.textMuted }}>Channel</span>
                    <span style={{ color: colors.text }}>{selectedChannel?.name} ({channelTypeLabel[selectedChannel?.channel_type || '']})</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: colors.textMuted }}>Trigger</span>
                    <span style={{ color: colors.text }}>{triggerType === 'cron' ? 'Schedule' : triggerType === 'skill_run' ? 'After Skill Run' : 'Score Threshold'}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: colors.textMuted }}>Severities</span>
                    <span style={{ color: colors.text }}>{severities.join(', ')}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: colors.textMuted }}>Template</span>
                    <span style={{ color: colors.text }}>{template}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: colors.textMuted }}>Max Findings</span>
                    <span style={{ color: colors.text, fontFamily: fonts.mono }}>{maxFindings}</span>
                  </div>
                </div>
              </div>

              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: colors.textSecondary, cursor: 'pointer' }}>
                <input type="checkbox" checked={saveInactive} onChange={e => setSaveInactive(e.target.checked)}
                  style={{ accentColor: colors.accent }} />
                Save as inactive (won't trigger until enabled)
              </label>

              {error && <p style={{ fontSize: 12, color: colors.red, marginTop: 12 }}>{error}</p>}
            </div>
          )}
        </div>

        <div style={{
          padding: '16px 24px', borderTop: `1px solid ${colors.border}`,
          display: 'flex', justifyContent: 'space-between',
        }}>
          <button style={secondaryBtn} onClick={() => step > 1 ? setStep(step - 1) : onClose()}>
            {step === 1 ? 'Cancel' : 'Back'}
          </button>
          {step < 5 ? (
            <button style={primaryBtn} onClick={() => setStep(step + 1)}>Next</button>
          ) : (
            <button style={{ ...primaryBtn, ...(saving ? { opacity: 0.6 } : {}) }} disabled={saving || !ruleName.trim()}
              onClick={handleSave}>
              {saving ? 'Saving...' : isEdit ? 'Update Rule' : 'Create Rule'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function LogTab({ entries, rules, logFilter, setLogFilter, hasMore, onLoadMore, onRetrigger, isMobile }: {
  entries: LogEntry[];
  rules: Rule[];
  logFilter: { status: string; ruleId: string; timeRange: string; limit: number; offset: number };
  setLogFilter: React.Dispatch<React.SetStateAction<{ status: string; ruleId: string; timeRange: string; limit: number; offset: number }>>;
  hasMore: boolean;
  onLoadMore: () => void;
  onRetrigger: (ruleId: string) => void;
  isMobile?: boolean;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const statusBadge = (status: string) => {
    const cfg: Record<string, { bg: string; color: string }> = {
      success: { bg: colors.greenSoft, color: colors.green },
      failed: { bg: colors.redSoft, color: colors.red },
      empty: { bg: colors.surfaceRaised, color: colors.textMuted },
      skipped: { bg: colors.surfaceRaised, color: colors.textMuted },
    };
    const c = cfg[status] || cfg.empty;
    return (
      <span style={{
        fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 4,
        background: c.bg, color: c.color, textTransform: 'capitalize',
      }}>
        {status}
      </span>
    );
  };

  return (
    <div>
      <div style={{
        display: 'flex', gap: 10, marginBottom: 12, alignItems: 'center', flexWrap: 'wrap',
      }}>
        <select style={{ ...selectStyle, width: 'auto' }}
          value={logFilter.status}
          onChange={e => setLogFilter(prev => ({ ...prev, status: e.target.value, offset: 0 }))}>
          <option value="">All Statuses</option>
          <option value="success">Success</option>
          <option value="failed">Failed</option>
          <option value="empty">Empty</option>
        </select>

        <select style={{ ...selectStyle, width: 'auto' }}
          value={logFilter.ruleId}
          onChange={e => setLogFilter(prev => ({ ...prev, ruleId: e.target.value, offset: 0 }))}>
          <option value="">All Rules</option>
          {rules.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>

        <select style={{ ...selectStyle, width: 'auto' }}
          value={logFilter.timeRange}
          onChange={e => setLogFilter(prev => ({ ...prev, timeRange: e.target.value, offset: 0 }))}>
          <option value="24h">Last 24 hours</option>
          <option value="7d">Last 7 days</option>
          <option value="30d">Last 30 days</option>
        </select>
      </div>

      {entries.length === 0 ? (
        <div style={{
          textAlign: 'center', padding: 60, background: colors.surface,
          border: `1px solid ${colors.border}`, borderRadius: 10,
        }}>
          <p style={{ fontSize: 32, marginBottom: 12 }}>📭</p>
          <p style={{ fontSize: 15, color: colors.textSecondary }}>No delivery logs</p>
          <p style={{ fontSize: 12, color: colors.textMuted, marginTop: 6 }}>
            Logs will appear here after rules are triggered.
          </p>
        </div>
      ) : isMobile ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {entries.map(entry => {
            const expanded = expandedId === entry.id;
            return (
              <div key={entry.id} style={{
                background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 8,
                overflow: 'hidden',
              }}>
                <div
                  style={{ padding: 14, cursor: 'pointer' }}
                  onClick={() => setExpandedId(expanded ? null : entry.id)}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                    <span style={{ fontSize: 13, fontWeight: 500, color: colors.text }}>{entry.rule_name}</span>
                    {statusBadge(entry.status)}
                  </div>
                  <div style={{ display: 'flex', gap: 12, fontSize: 11, color: colors.textMuted, flexWrap: 'wrap' }}>
                    <span>{channelTypeLabel[entry.channel_type] || entry.channel_type}</span>
                    <span>{entry.triggered_by}</span>
                    <span style={{ fontFamily: fonts.mono }}>{entry.findings_count} findings</span>
                    <span>{timeAgo(entry.delivered_at)}</span>
                  </div>
                </div>

                {expanded && (
                  <div style={{
                    padding: '12px 14px', borderTop: `1px solid ${colors.border}`,
                    background: colors.surfaceRaised,
                  }}>
                    {entry.error_message && (
                      <div style={{
                        padding: '8px 12px', borderRadius: 6, marginBottom: 10,
                        background: colors.redSoft, border: `1px solid ${colors.red}`,
                        color: colors.red, fontSize: 12,
                      }}>
                        Error: {entry.error_message}
                      </div>
                    )}
                    {entry.payload_preview && (
                      <pre style={{
                        background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 6,
                        padding: 12, fontSize: 11, fontFamily: fonts.mono, color: colors.textSecondary,
                        overflow: 'auto', maxHeight: 200, margin: 0,
                        whiteSpace: 'pre-wrap', wordBreak: 'break-all',
                      }}>
                        {typeof entry.payload_preview === 'string'
                          ? entry.payload_preview
                          : JSON.stringify(entry.payload_preview, null, 2)}
                      </pre>
                    )}
                    <div style={{ display: 'flex', gap: 8, marginTop: 10, justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: 11, color: colors.textMuted }}>
                        {entry.findings_count} finding{entry.findings_count !== 1 ? 's' : ''} delivered
                      </span>
                      {entry.status === 'failed' && (
                        <button style={{ ...primaryBtn, padding: '5px 12px', fontSize: 11 }}
                          onClick={e => { e.stopPropagation(); onRetrigger(entry.rule_id); }}>
                          Re-trigger
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 10, overflow: 'hidden' }}>
          <div style={{
            display: 'grid', gridTemplateColumns: '2fr 1fr 0.8fr 0.7fr 1fr',
            padding: '10px 16px', borderBottom: `1px solid ${colors.border}`,
            fontSize: 10, fontWeight: 600, color: colors.textDim, textTransform: 'uppercase', letterSpacing: '0.05em',
          }}>
            <span>Rule</span>
            <span>Triggered By</span>
            <span style={{ textAlign: 'right' }}>Findings</span>
            <span>Status</span>
            <span style={{ textAlign: 'right' }}>Time</span>
          </div>

          {entries.map(entry => {
            const expanded = expandedId === entry.id;
            return (
              <React.Fragment key={entry.id}>
                <div
                  style={{
                    display: 'grid', gridTemplateColumns: '2fr 1fr 0.8fr 0.7fr 1fr',
                    padding: '10px 16px', borderBottom: `1px solid ${colors.border}`,
                    alignItems: 'center', cursor: 'pointer',
                  }}
                  onClick={() => setExpandedId(expanded ? null : entry.id)}
                  onMouseEnter={e => (e.currentTarget.style.background = colors.surfaceHover)}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >
                  <div>
                    <span style={{ fontSize: 13, fontWeight: 500, color: colors.text }}>{entry.rule_name}</span>
                    <span style={{ fontSize: 10, color: colors.textDim, marginLeft: 6 }}>
                      {channelTypeLabel[entry.channel_type] || entry.channel_type}
                    </span>
                  </div>
                  <span style={{ fontSize: 11, color: colors.textMuted }}>{entry.triggered_by}</span>
                  <span style={{ fontSize: 12, fontFamily: fonts.mono, color: colors.text, textAlign: 'right' }}>
                    {entry.findings_count}
                  </span>
                  {statusBadge(entry.status)}
                  <span style={{ fontSize: 11, color: colors.textMuted, textAlign: 'right' }}>{timeAgo(entry.delivered_at)}</span>
                </div>

                {expanded && (
                  <div style={{
                    padding: '12px 16px', borderBottom: `1px solid ${colors.border}`,
                    background: colors.surfaceRaised,
                  }}>
                    {entry.error_message && (
                      <div style={{
                        padding: '8px 12px', borderRadius: 6, marginBottom: 10,
                        background: colors.redSoft, border: `1px solid ${colors.red}`,
                        color: colors.red, fontSize: 12,
                      }}>
                        Error: {entry.error_message}
                      </div>
                    )}
                    {entry.payload_preview && (
                      <pre style={{
                        background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 6,
                        padding: 12, fontSize: 11, fontFamily: fonts.mono, color: colors.textSecondary,
                        overflow: 'auto', maxHeight: 200, margin: 0,
                        whiteSpace: 'pre-wrap', wordBreak: 'break-all',
                      }}>
                        {typeof entry.payload_preview === 'string'
                          ? entry.payload_preview
                          : JSON.stringify(entry.payload_preview, null, 2)}
                      </pre>
                    )}
                    <div style={{ display: 'flex', gap: 8, marginTop: 10, justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: 11, color: colors.textMuted }}>
                        {entry.findings_count} finding{entry.findings_count !== 1 ? 's' : ''} delivered
                      </span>
                      {entry.status === 'failed' && (
                        <button style={{ ...primaryBtn, padding: '5px 12px', fontSize: 11 }}
                          onClick={e => { e.stopPropagation(); onRetrigger(entry.rule_id); }}>
                          Re-trigger
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </React.Fragment>
            );
          })}
        </div>
      )}

      {hasMore && entries.length > 0 && (
        <div style={{ textAlign: 'center', marginTop: 16 }}>
          <button style={secondaryBtn} onClick={onLoadMore}>Load More</button>
        </div>
      )}
    </div>
  );
}
