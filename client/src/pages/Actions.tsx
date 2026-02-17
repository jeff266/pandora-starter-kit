import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { colors, fonts } from '../styles/theme';
import { formatCurrency, formatTimeAgo } from '../lib/format';
import Skeleton from '../components/Skeleton';
import SectionErrorBoundary from '../components/SectionErrorBoundary';
import { useDemoMode } from '../contexts/DemoModeContext';

interface ActionsSummary {
  open_total: number;
  open_critical: number;
  open_warning: number;
  open_info: number;
  in_progress: number;
  executed_7d: number;
  total_impact_at_risk: number;
  reps_with_actions: number;
  by_type: Array<{ action_type: string; count: number }>;
  by_rep: Array<{ owner_email: string; action_count: number; critical_count: number }>;
}

interface CRMOperation {
  type: 'crm_update' | 'crm_note' | 'slack_notify';
  target: string;
  result: any;
  error?: string;
}

interface Action {
  id: string;
  action_type: string;
  severity: string;
  title: string;
  summary?: string;
  recommended_steps?: string[];
  target_deal_name?: string;
  target_entity_name?: string;
  deal_name?: string;
  target_deal_id?: string;
  target_account_id?: string;
  owner_email?: string;
  impact_amount?: number;
  urgency_label?: string;
  execution_status: string;
  execution_result?: CRMOperation[];
  executed_at?: string;
  executed_by?: string;
  snoozed_until?: string;
  dismissed_reason?: string;
  source_skill: string;
  source_run_id?: string;
  created_at: string;
  execution_payload?: {
    crm_updates?: Array<{ field: string; current_value: any; proposed_value: any }>;
  };
}

const sevColors: Record<string, string> = {
  critical: '#ef4444',
  warning: '#f59e0b',
  notable: '#6c5ce7',
  info: '#3b82f6',
};

const statusConfig: Record<string, { color: string; label: string; bg: string }> = {
  open: { color: '#6b7280', label: 'Open', bg: 'rgba(107,114,128,0.1)' },
  in_progress: { color: '#3b82f6', label: 'In Progress', bg: 'rgba(59,130,246,0.1)' },
  executed: { color: '#22c55e', label: 'Executed', bg: 'rgba(34,197,94,0.1)' },
  dismissed: { color: '#4b5563', label: 'Dismissed', bg: 'rgba(75,85,99,0.1)' },
  rejected: { color: '#ef4444', label: 'Rejected', bg: 'rgba(239,68,68,0.1)' },
  snoozed: { color: '#a78bfa', label: 'Snoozed', bg: 'rgba(167,139,250,0.1)' },
  failed: { color: '#f97316', label: 'Failed', bg: 'rgba(249,115,22,0.1)' },
};

const statusTabs = [
  { key: 'pending', label: 'Pending', match: ['open', 'in_progress'] },
  { key: 'snoozed', label: 'Snoozed', match: ['snoozed'] },
  { key: 'executed', label: 'Executed', match: ['executed'] },
  { key: 'rejected', label: 'Rejected', match: ['rejected', 'dismissed'] },
  { key: 'all', label: 'All', match: [] },
];

const snoozeDurations = [
  { label: '1 day', days: 1 },
  { label: '3 days', days: 3 },
  { label: '1 week', days: 7 },
  { label: '2 weeks', days: 14 },
  { label: '1 month', days: 30 },
];

export default function Actions() {
  const navigate = useNavigate();
  const { anon } = useDemoMode();
  const [summary, setSummary] = useState<ActionsSummary | null>(null);
  const [actions, setActions] = useState<Action[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [selectedAction, setSelectedAction] = useState<Action | null>(null);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const [activeTab, setActiveTab] = useState('pending');
  const [severityFilter, setSeverityFilter] = useState<string[]>(['critical', 'warning', 'notable', 'info']);
  const [repFilter, setRepFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [skillFilter, setSkillFilter] = useState('all');
  const [sortBy, setSortBy] = useState<'severity' | 'impact' | 'age'>('severity');

  const showToast = useCallback((message: string, type: 'success' | 'error') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  }, []);

  const fetchData = useCallback(async (isRefresh?: boolean) => {
    try {
      if (isRefresh) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }
      const [summaryData, actionsData] = await Promise.all([
        api.get('/action-items/summary'),
        api.get('/action-items?status=all&limit=200'),
      ]);
      setSummary(summaryData);
      setActions(actionsData.actions || []);
      setLastUpdated(new Date());
    } catch (err) {
      console.error('Failed to fetch actions:', err);
    } finally {
      if (isRefresh) {
        setRefreshing(false);
      } else {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  useEffect(() => {
    const interval = setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      fetchData(true);
    }, 120000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const tabMatch = statusTabs.find(t => t.key === activeTab);
  const filtered = actions
    .filter(a => severityFilter.includes(a.severity))
    .filter(a => {
      if (activeTab === 'all') return true;
      return tabMatch?.match.includes(a.execution_status) ?? false;
    })
    .filter(a => repFilter === 'all' || a.owner_email === repFilter)
    .filter(a => typeFilter === 'all' || a.action_type === typeFilter)
    .filter(a => skillFilter === 'all' || a.source_skill === skillFilter)
    .sort((a, b) => {
      if (sortBy === 'severity') {
        const order: Record<string, number> = { critical: 0, warning: 1, notable: 2, info: 3 };
        const diff = (order[a.severity] ?? 9) - (order[b.severity] ?? 9);
        if (diff !== 0) return diff;
        return (b.impact_amount || 0) - (a.impact_amount || 0);
      }
      if (sortBy === 'impact') return (b.impact_amount || 0) - (a.impact_amount || 0);
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });

  const tabCounts: Record<string, number> = {};
  for (const tab of statusTabs) {
    if (tab.key === 'all') {
      tabCounts[tab.key] = actions.length;
    } else {
      tabCounts[tab.key] = actions.filter(a => tab.match.includes(a.execution_status)).length;
    }
  }

  const reps = Array.from(new Set(actions.map(a => a.owner_email).filter((x): x is string => !!x)));
  const types = Array.from(new Set(actions.map(a => a.action_type).filter((x): x is string => !!x)));
  const skills = Array.from(new Set(actions.map(a => a.source_skill).filter((x): x is string => !!x)));

  async function handleExecute(actionId: string) {
    try {
      const result = await api.post(`/action-items/${actionId}/execute`, { actor: 'user' });
      if (result.success) {
        showToast('Action executed — CRM updated', 'success');
      } else {
        showToast(result.error || 'Execution failed', 'error');
      }
      setSelectedAction(null);
      await fetchData();
    } catch (err: any) {
      showToast(err.message || 'Failed to execute', 'error');
    }
  }

  async function handleReject(actionId: string, reason: string) {
    try {
      await api.put(`/action-items/${actionId}/status`, {
        status: 'rejected',
        actor: 'user',
        reason,
      });
      showToast('Action rejected', 'success');
      setSelectedAction(null);
      await fetchData();
    } catch (err: any) {
      showToast(err.message || 'Failed to reject', 'error');
    }
  }

  async function handleSnooze(actionId: string, days: number) {
    try {
      await api.post(`/action-items/${actionId}/snooze`, { days, actor: 'user' });
      showToast(`Snoozed for ${days} day${days > 1 ? 's' : ''}`, 'success');
      setSelectedAction(null);
      await fetchData();
    } catch (err: any) {
      showToast(err.message || 'Failed to snooze', 'error');
    }
  }

  async function handleReopen(actionId: string) {
    try {
      await api.put(`/action-items/${actionId}/status`, { status: 'open', actor: 'user' });
      showToast('Action reopened', 'success');
      setSelectedAction(null);
      await fetchData();
    } catch (err: any) {
      showToast(err.message || 'Failed to reopen', 'error');
    }
  }

  async function handleRetry(actionId: string) {
    await handleExecute(actionId);
  }

  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }}>
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} height={100} borderRadius={10} />)}
        </div>
        <Skeleton height={50} borderRadius={10} />
        {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} height={48} />)}
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {toast && (
        <div style={{
          position: 'fixed', top: 16, right: 16, zIndex: 1000,
          padding: '10px 16px', borderRadius: 8,
          background: toast.type === 'success' ? colors.greenSoft : colors.redSoft,
          border: `1px solid ${toast.type === 'success' ? colors.green : colors.red}`,
          color: toast.type === 'success' ? colors.green : colors.red,
          fontSize: 12, fontWeight: 500,
        }}>
          {toast.message}
        </div>
      )}

      <SectionErrorBoundary fallbackMessage="Failed to load summary cards.">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }}>
          <SummaryCard
            label="Open Actions"
            value={summary?.open_total || 0}
            sub={
              <div style={{ display: 'flex', gap: 10, fontSize: 11, marginTop: 4 }}>
                <span style={{ color: sevColors.critical }}>{summary?.open_critical || 0} critical</span>
                <span style={{ color: sevColors.warning }}>{summary?.open_warning || 0} warning</span>
              </div>
            }
          />
          <SummaryCard
            label="Total Impact at Risk"
            value={formatCurrency(anon.amount(Number(summary?.total_impact_at_risk) || 0))}
            sub={<span style={{ fontSize: 11, color: colors.textMuted }}>{filtered.filter(a => a.target_deal_id).length} deals affected</span>}
          />
          <SummaryCard
            label="Reps with Actions"
            value={summary?.reps_with_actions || 0}
            sub={
              <span style={{ fontSize: 11, color: colors.textMuted }}>
                {summary?.by_rep?.filter(r => r.critical_count > 0).length || 0} with critical
              </span>
            }
          />
          <SummaryCard
            label="Executed This Week"
            value={summary?.executed_7d || 0}
            sub={<span style={{ fontSize: 11, color: colors.textMuted }}>resolved actions</span>}
          />
        </div>
      </SectionErrorBoundary>

      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: colors.textDim }}>
        {refreshing && (
          <span style={{
            display: 'inline-block', width: 10, height: 10,
            border: `1.5px solid ${colors.textDim}`, borderTopColor: colors.accent,
            borderRadius: '50%', animation: 'spin 0.8s linear infinite',
          }} />
        )}
        {lastUpdated && (
          <span>Updated {Math.max(0, Math.round((Date.now() - lastUpdated.getTime()) / 60000))}m ago</span>
        )}
      </div>

      <div style={{
        display: 'flex', gap: 2,
        background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 10,
        padding: 4,
      }}>
        {statusTabs.map(tab => {
          const active = activeTab === tab.key;
          const count = tabCounts[tab.key] || 0;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              style={{
                flex: 1, padding: '8px 12px', borderRadius: 8,
                background: active ? colors.surfaceActive : 'transparent',
                color: active ? colors.text : colors.textMuted,
                fontSize: 12, fontWeight: active ? 600 : 500,
                cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                transition: 'all 0.15s',
              }}
            >
              {tab.label}
              {count > 0 && (
                <span style={{
                  fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 10,
                  background: active ? colors.accent : colors.surfaceHover,
                  color: active ? '#fff' : colors.textMuted,
                }}>
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div style={{
        display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
        background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 10, padding: '8px 16px',
      }}>
        <div style={{ display: 'flex', gap: 4 }}>
          {(['critical', 'warning', 'notable', 'info'] as const).map(sev => {
            const active = severityFilter.includes(sev);
            return (
              <button
                key={sev}
                onClick={() => {
                  if (active) setSeverityFilter(severityFilter.filter(s => s !== sev));
                  else setSeverityFilter([...severityFilter, sev]);
                }}
                style={{
                  fontSize: 11, fontWeight: 500, padding: '4px 10px', borderRadius: 4,
                  background: active ? sevColors[sev] : colors.surfaceHover,
                  color: active ? '#fff' : colors.textMuted,
                  textTransform: 'capitalize',
                }}
              >
                {sev}
              </button>
            );
          })}
        </div>

        <div style={{ width: 1, height: 20, background: colors.border }} />

        <SelectFilter value={typeFilter} onChange={setTypeFilter}
          options={[['all', 'All Types'], ...types.map(t => [t, t.replace(/_/g, ' ')])]} />

        <SelectFilter value={repFilter} onChange={setRepFilter}
          options={[['all', 'All Reps'], ...reps.map(r => [r, anon.email(r).split('@')[0]])]} />

        <SelectFilter value={skillFilter} onChange={setSkillFilter}
          options={[['all', 'All Skills'], ...skills.map(s => [s, s.replace(/-/g, ' ')])]} />

        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ fontSize: 11, color: colors.textDim, fontWeight: 600, marginRight: 4 }}>Sort:</span>
          {(['severity', 'impact', 'age'] as const).map(s => (
            <button
              key={s}
              onClick={() => setSortBy(s)}
              style={{
                fontSize: 11, fontWeight: 500, padding: '3px 8px', borderRadius: 4,
                background: sortBy === s ? colors.surfaceActive : 'transparent',
                color: sortBy === s ? colors.text : colors.textMuted,
                textTransform: 'capitalize',
              }}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      <SectionErrorBoundary fallbackMessage="Failed to load action list.">
        {filtered.length === 0 ? (
          <div style={{
            textAlign: 'center', padding: 60,
            background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 10,
          }}>
            <p style={{ fontSize: 32, marginBottom: 12 }}>&#x26A1;</p>
            <p style={{ fontSize: 15, color: colors.textSecondary }}>
              {actions.length === 0 ? 'No actions yet' : 'No actions match your filters'}
            </p>
            <p style={{ fontSize: 12, color: colors.textMuted, marginTop: 6 }}>
              {actions.length === 0
                ? 'Actions will be created when skills run and produce recommendations.'
                : 'Try adjusting your filter criteria.'}
            </p>
          </div>
        ) : (
          <div style={{
            background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 10, overflow: 'hidden',
          }}>
            <div style={{
              display: 'grid',
              gridTemplateColumns: '8px 2fr 1.2fr 1fr 0.8fr 0.7fr 0.5fr 0.8fr',
              padding: '10px 16px',
              borderBottom: `1px solid ${colors.border}`,
              fontSize: 11, fontWeight: 600, color: colors.textDim,
              textTransform: 'uppercase', letterSpacing: '0.05em',
            }}>
              <span></span>
              <span>Title</span>
              <span>Deal</span>
              <span>Owner</span>
              <span style={{ textAlign: 'right' }}>Impact</span>
              <span>Urgency</span>
              <span>Age</span>
              <span>Status</span>
            </div>

            {filtered.map(action => {
              const sc = sevColors[action.severity] || colors.textMuted;
              const hasFailed = action.execution_result?.some(op => op.error);
              const effectiveStatus = hasFailed && action.execution_status !== 'executed' ? 'failed' : action.execution_status;
              const st = statusConfig[effectiveStatus] || statusConfig.open;
              const dealName = action.deal_name || action.target_entity_name || action.target_deal_name;

              return (
                <div
                  key={action.id}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '8px 2fr 1.2fr 1fr 0.8fr 0.7fr 0.5fr 0.8fr',
                    padding: '10px 16px',
                    borderBottom: `1px solid ${colors.border}`,
                    borderLeft: `3px solid ${sc}`,
                    alignItems: 'center',
                    cursor: 'pointer',
                  }}
                  onClick={() => setSelectedAction(action)}
                  onMouseEnter={e => (e.currentTarget.style.background = colors.surfaceHover)}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >
                  <span style={{
                    width: 7, height: 7, borderRadius: '50%', background: sc,
                    boxShadow: `0 0 6px ${sc}40`,
                  }} />
                  <div style={{ minWidth: 0, overflow: 'hidden' }}>
                    <span style={{ fontSize: 13, fontWeight: 500, color: colors.text, display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {anon.text(action.title)}
                    </span>
                    <p style={{ fontSize: 11, color: colors.textMuted, marginTop: 1 }}>
                      {action.action_type.replace(/_/g, ' ')} &middot; {action.source_skill}
                    </p>
                  </div>
                  <span
                    style={{ fontSize: 12, color: dealName ? colors.accent : colors.textDim, cursor: dealName ? 'pointer' : 'default', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                    onClick={e => {
                      if (action.target_deal_id) {
                        e.stopPropagation();
                        navigate(`/deals/${action.target_deal_id}`);
                      }
                    }}
                  >
                    {dealName ? anon.deal(dealName) : '--'}
                  </span>
                  <span style={{ fontSize: 12, color: colors.textMuted }}>
                    {action.owner_email ? anon.email(action.owner_email).split('@')[0] : '--'}
                  </span>
                  <span style={{ fontSize: 12, fontFamily: fonts.mono, color: colors.text, textAlign: 'right' }}>
                    {action.impact_amount ? formatCurrency(anon.amount(Number(action.impact_amount))) : '--'}
                  </span>
                  <span style={{ fontSize: 11, color: colors.textMuted }}>{action.urgency_label || '--'}</span>
                  <span style={{ fontSize: 11, color: colors.textMuted }}>{formatTimeAgo(action.created_at)}</span>
                  <span style={{
                    fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 4,
                    background: st.bg, color: st.color,
                    justifySelf: 'start',
                  }}>
                    {st.label}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </SectionErrorBoundary>

      {selectedAction && (
        <ActionPanel
          action={selectedAction}
          onClose={() => setSelectedAction(null)}
          onExecute={handleExecute}
          onReject={handleReject}
          onSnooze={handleSnooze}
          onReopen={handleReopen}
          onRetry={handleRetry}
          navigate={navigate}
        />
      )}
    </div>
  );
}

function SummaryCard({ label, value, sub }: { label: string; value: string | number; sub?: React.ReactNode }) {
  return (
    <div style={{
      background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 10, padding: 20,
    }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: colors.textDim, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        {label}
      </div>
      <div style={{ fontSize: 28, fontWeight: 700, fontFamily: fonts.mono, color: colors.text, marginTop: 6 }}>
        {value}
      </div>
      {sub && <div style={{ marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

function SelectFilter({ value, onChange, options }: {
  value: string; onChange: (v: string) => void; options: string[][];
}) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      style={{
        fontSize: 11, padding: '4px 8px', borderRadius: 4,
        background: colors.surfaceHover, color: colors.textSecondary,
        border: `1px solid ${colors.border}`,
      }}
    >
      {options.map(([val, label]) => (
        <option key={val} value={val}>{label}</option>
      ))}
    </select>
  );
}

function ActionPanel({ action, onClose, onExecute, onReject, onSnooze, onReopen, onRetry, navigate }: {
  action: Action;
  onClose: () => void;
  onExecute: (id: string) => void;
  onReject: (id: string, reason: string) => void;
  onSnooze: (id: string, days: number) => void;
  onReopen: (id: string) => void;
  onRetry: (id: string) => void;
  navigate: (path: string) => void;
}) {
  const { anon } = useDemoMode();
  const [rejectReason, setRejectReason] = useState('');
  const [showReject, setShowReject] = useState(false);
  const [showSnooze, setShowSnooze] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [showExecLog, setShowExecLog] = useState(false);

  const sc = sevColors[action.severity] || colors.textMuted;
  const hasFailed = action.execution_result?.some(op => op.error);
  const effectiveStatus = hasFailed && action.execution_status !== 'executed' ? 'failed' : action.execution_status;
  const st = statusConfig[effectiveStatus] || statusConfig.open;
  const dealName = action.deal_name || action.target_entity_name || action.target_deal_name;

  const isActionable = ['open', 'in_progress'].includes(action.execution_status);
  const isExecuted = action.execution_status === 'executed';
  const isFailed = hasFailed && !isExecuted;
  const canReopen = ['dismissed', 'rejected', 'snoozed'].includes(action.execution_status);

  const hasCRMPayload = action.execution_payload?.crm_updates && action.execution_payload.crm_updates.length > 0;

  async function handleExecuteClick() {
    setExecuting(true);
    await onExecute(action.id);
    setExecuting(false);
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
      display: 'flex', justifyContent: 'flex-end', zIndex: 1000,
    }} onClick={onClose}>
      <div
        style={{
          width: 480, height: '100%', overflowY: 'auto',
          background: colors.surface, borderLeft: `1px solid ${colors.border}`, padding: 24,
        }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 }}>
            <span style={{
              width: 10, height: 10, borderRadius: '50%', background: sc,
              boxShadow: `0 0 8px ${sc}40`, flexShrink: 0,
            }} />
            <div style={{ minWidth: 0 }}>
              <h3 style={{ fontSize: 16, fontWeight: 700, color: colors.text }}>{anon.text(action.title)}</h3>
              <p style={{ fontSize: 12, color: colors.textMuted, marginTop: 2 }}>
                {action.action_type.replace(/_/g, ' ')} &middot; {action.source_skill}
              </p>
            </div>
          </div>
          <button onClick={onClose} style={{ fontSize: 18, color: colors.textMuted, background: 'none', cursor: 'pointer', padding: 4 }}>
            &#x2715;
          </button>
        </div>

        <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
          <span style={{
            fontSize: 10, fontWeight: 600, padding: '3px 10px', borderRadius: 4,
            background: st.bg, color: st.color,
          }}>
            {st.label}
          </span>
          <span style={{
            fontSize: 10, fontWeight: 600, padding: '3px 10px', borderRadius: 4,
            background: `${sc}15`, color: sc,
            textTransform: 'capitalize',
          }}>
            {action.severity}
          </span>
          {action.snoozed_until && action.execution_status === 'snoozed' && (
            <span style={{
              fontSize: 10, fontWeight: 500, padding: '3px 10px', borderRadius: 4,
              background: 'rgba(167,139,250,0.1)', color: colors.purple,
            }}>
              Until {new Date(action.snoozed_until).toLocaleDateString()}
            </span>
          )}
        </div>

        {action.summary && (
          <div style={{ marginBottom: 16 }}>
            <SectionLabel>Summary</SectionLabel>
            <p style={{ fontSize: 13, color: colors.textSecondary, lineHeight: 1.5 }}>{anon.text(action.summary)}</p>
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
          <InfoCard label="Impact" value={action.impact_amount ? formatCurrency(anon.amount(Number(action.impact_amount))) : '--'} mono />
          <InfoCard label="Urgency" value={action.urgency_label || '--'} />
        </div>

        {dealName && (
          <div style={{ marginBottom: 16 }}>
            <SectionLabel>Deal</SectionLabel>
            <span
              style={{ fontSize: 13, color: colors.accent, cursor: action.target_deal_id ? 'pointer' : 'default' }}
              onClick={() => action.target_deal_id && navigate(`/deals/${action.target_deal_id}`)}
            >
              {anon.deal(dealName)}
            </span>
          </div>
        )}

        {action.target_account_id && (
          <div style={{ marginBottom: 16 }}>
            <SectionLabel>Account</SectionLabel>
            <span
              style={{ fontSize: 13, color: colors.accent, cursor: 'pointer' }}
              onClick={() => navigate(`/accounts/${action.target_account_id}`)}
            >
              View Account
            </span>
          </div>
        )}

        {action.owner_email && (
          <div style={{ marginBottom: 16 }}>
            <SectionLabel>Owner</SectionLabel>
            <span style={{ fontSize: 13, color: colors.textSecondary }}>{anon.email(action.owner_email)}</span>
          </div>
        )}

        {hasCRMPayload && (
          <div style={{ marginBottom: 16 }}>
            <SectionLabel>Proposed CRM Changes</SectionLabel>
            <div style={{
              background: colors.surfaceRaised, borderRadius: 8, padding: 12,
              border: `1px solid ${colors.border}`,
            }}>
              {action.execution_payload!.crm_updates!.map((u, i) => (
                <div key={i} style={{
                  display: 'flex', alignItems: 'center', gap: 8, fontSize: 12,
                  padding: '4px 0',
                  borderBottom: i < action.execution_payload!.crm_updates!.length - 1 ? `1px solid ${colors.border}` : 'none',
                }}>
                  <span style={{ color: colors.textMuted, fontFamily: fonts.mono }}>{u.field}</span>
                  <span style={{ color: colors.textDim }}>:</span>
                  <span style={{ color: colors.red, textDecoration: 'line-through', fontFamily: fonts.mono }}>{String(u.current_value ?? '--')}</span>
                  <span style={{ color: colors.textDim }}>&#x2192;</span>
                  <span style={{ color: colors.green, fontFamily: fonts.mono, fontWeight: 600 }}>{String(u.proposed_value)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {action.recommended_steps && action.recommended_steps.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <SectionLabel>Recommended Steps</SectionLabel>
            <ol style={{ paddingLeft: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 6 }}>
              {action.recommended_steps.map((step, idx) => (
                <li key={idx} style={{ display: 'flex', gap: 8, fontSize: 12 }}>
                  <span style={{ color: colors.accent, fontWeight: 600, flexShrink: 0 }}>{idx + 1}.</span>
                  <span style={{ color: colors.textSecondary, lineHeight: 1.4 }}>{step}</span>
                </li>
              ))}
            </ol>
          </div>
        )}

        {isExecuted && (
          <div style={{ marginBottom: 16 }}>
            <SectionLabel>Execution Details</SectionLabel>
            <div style={{
              background: 'rgba(34,197,94,0.06)', borderRadius: 8, padding: 12,
              border: `1px solid rgba(34,197,94,0.15)`,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <span style={{ fontSize: 14 }}>&#x2705;</span>
                <span style={{ fontSize: 12, fontWeight: 600, color: colors.green }}>Successfully executed</span>
              </div>
              {action.executed_by && (
                <div style={{ fontSize: 11, color: colors.textMuted, marginBottom: 4 }}>
                  By: {action.executed_by}
                </div>
              )}
              {action.executed_at && (
                <div style={{ fontSize: 11, color: colors.textMuted }}>
                  {new Date(action.executed_at).toLocaleString()}
                </div>
              )}
              {action.execution_result && action.execution_result.length > 0 && (
                <>
                  <button
                    onClick={() => setShowExecLog(!showExecLog)}
                    style={{
                      fontSize: 11, color: colors.accent, background: 'none', cursor: 'pointer',
                      marginTop: 8, padding: 0,
                    }}
                  >
                    {showExecLog ? 'Hide' : 'Show'} execution log ({action.execution_result.length} operations)
                  </button>
                  {showExecLog && (
                    <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {action.execution_result.map((op, i) => (
                        <OperationLogEntry key={i} op={op} />
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        )}

        {isFailed && action.execution_result && (
          <div style={{ marginBottom: 16 }}>
            <SectionLabel>Execution Errors</SectionLabel>
            <div style={{
              background: 'rgba(249,115,22,0.06)', borderRadius: 8, padding: 12,
              border: `1px solid rgba(249,115,22,0.15)`,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <span style={{ fontSize: 14 }}>&#x26A0;&#xFE0F;</span>
                <span style={{ fontSize: 12, fontWeight: 600, color: colors.orange }}>Execution failed</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {action.execution_result.map((op, i) => (
                  <OperationLogEntry key={i} op={op} />
                ))}
              </div>
            </div>
          </div>
        )}

        {action.dismissed_reason && ['dismissed', 'rejected'].includes(action.execution_status) && (
          <div style={{ marginBottom: 16 }}>
            <SectionLabel>{action.execution_status === 'rejected' ? 'Rejection Reason' : 'Dismiss Reason'}</SectionLabel>
            <p style={{ fontSize: 12, color: colors.textMuted, fontStyle: 'italic' }}>
              {action.dismissed_reason}
            </p>
          </div>
        )}

        <div style={{
          display: 'flex', flexDirection: 'column', gap: 8, marginTop: 24,
          paddingTop: 16, borderTop: `1px solid ${colors.border}`,
        }}>
          {isActionable && (
            <>
              <button
                onClick={handleExecuteClick}
                disabled={executing}
                style={{
                  width: '100%', padding: '10px 16px', borderRadius: 8,
                  background: executing ? colors.surfaceHover : colors.green,
                  color: executing ? colors.textMuted : '#fff',
                  fontSize: 13, fontWeight: 600, cursor: executing ? 'not-allowed' : 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                }}
              >
                {executing ? (
                  <>
                    <span style={{ display: 'inline-block', width: 14, height: 14, border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
                    Executing...
                  </>
                ) : (
                  <>&#x2705; Approve &amp; Execute</>
                )}
              </button>

              {!showSnooze && !showReject && (
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    onClick={() => setShowSnooze(true)}
                    style={{
                      flex: 1, padding: '8px 12px', borderRadius: 8,
                      background: colors.surfaceHover, color: colors.purple,
                      fontSize: 12, fontWeight: 500, cursor: 'pointer',
                    }}
                  >
                    Snooze
                  </button>
                  <button
                    onClick={() => setShowReject(true)}
                    style={{
                      flex: 1, padding: '8px 12px', borderRadius: 8,
                      background: colors.surfaceHover, color: colors.red,
                      fontSize: 12, fontWeight: 500, cursor: 'pointer',
                    }}
                  >
                    Reject
                  </button>
                </div>
              )}

              {showSnooze && (
                <div style={{
                  background: colors.surfaceRaised, borderRadius: 8, padding: 12,
                  border: `1px solid ${colors.border}`,
                }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: colors.textDim, marginBottom: 8, textTransform: 'uppercase' }}>
                    Snooze Duration
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {snoozeDurations.map(d => (
                      <button
                        key={d.days}
                        onClick={() => onSnooze(action.id, d.days)}
                        style={{
                          padding: '5px 12px', borderRadius: 6,
                          background: colors.surfaceHover, color: colors.purple,
                          fontSize: 11, fontWeight: 500, cursor: 'pointer',
                          border: `1px solid ${colors.border}`,
                        }}
                      >
                        {d.label}
                      </button>
                    ))}
                  </div>
                  <button
                    onClick={() => setShowSnooze(false)}
                    style={{
                      fontSize: 11, color: colors.textMuted, background: 'none', cursor: 'pointer',
                      marginTop: 8, padding: 0,
                    }}
                  >
                    Cancel
                  </button>
                </div>
              )}

              {showReject && (
                <div style={{
                  background: colors.surfaceRaised, borderRadius: 8, padding: 12,
                  border: `1px solid ${colors.border}`,
                }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: colors.textDim, marginBottom: 8, textTransform: 'uppercase' }}>
                    Rejection Reason
                  </div>
                  <textarea
                    value={rejectReason}
                    onChange={e => setRejectReason(e.target.value)}
                    placeholder="Why is this action not relevant?"
                    style={{
                      width: '100%', minHeight: 60, padding: 8, borderRadius: 6,
                      background: colors.surfaceHover, color: colors.text,
                      border: `1px solid ${colors.border}`, fontSize: 12,
                      resize: 'vertical', fontFamily: fonts.sans,
                    }}
                  />
                  <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                    <button
                      onClick={() => {
                        onReject(action.id, rejectReason || 'No reason provided');
                      }}
                      style={{
                        padding: '6px 16px', borderRadius: 6,
                        background: colors.red, color: '#fff',
                        fontSize: 12, fontWeight: 600, cursor: 'pointer',
                      }}
                    >
                      Confirm Reject
                    </button>
                    <button
                      onClick={() => { setShowReject(false); setRejectReason(''); }}
                      style={{
                        padding: '6px 16px', borderRadius: 6,
                        background: colors.surfaceHover, color: colors.textMuted,
                        fontSize: 12, cursor: 'pointer',
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </>
          )}

          {isFailed && (
            <button
              onClick={() => onRetry(action.id)}
              style={{
                width: '100%', padding: '10px 16px', borderRadius: 8,
                background: colors.orange, color: '#fff',
                fontSize: 13, fontWeight: 600, cursor: 'pointer',
              }}
            >
              &#x1F504; Retry Execution
            </button>
          )}

          {canReopen && (
            <button
              onClick={() => onReopen(action.id)}
              style={{
                width: '100%', padding: '10px 16px', borderRadius: 8,
                background: colors.surfaceHover, color: colors.text,
                fontSize: 13, fontWeight: 600, cursor: 'pointer',
              }}
            >
              Reopen
            </button>
          )}
        </div>
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontSize: 11, fontWeight: 600, color: colors.textDim,
      marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em',
    }}>
      {children}
    </div>
  );
}

function InfoCard({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div style={{ background: colors.surfaceRaised, borderRadius: 8, padding: 12 }}>
      <div style={{ fontSize: 11, color: colors.textDim }}>{label}</div>
      <div style={{
        fontSize: mono ? 18 : 14, fontWeight: mono ? 700 : 600,
        fontFamily: mono ? fonts.mono : fonts.sans,
        color: colors.text, marginTop: 4, textTransform: mono ? 'none' : 'capitalize',
      }}>
        {value}
      </div>
    </div>
  );
}

function OperationLogEntry({ op }: { op: CRMOperation }) {
  const opLabels: Record<string, string> = {
    crm_update: 'CRM Update',
    crm_note: 'CRM Note',
    slack_notify: 'Slack Notification',
  };
  const success = !op.error;

  return (
    <div style={{
      background: colors.surfaceHover, borderRadius: 6, padding: 8,
      border: `1px solid ${op.error ? 'rgba(239,68,68,0.2)' : colors.border}`,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
        <span style={{ fontSize: 12 }}>{success ? '\u2713' : '\u2717'}</span>
        <span style={{
          fontSize: 11, fontWeight: 600,
          color: success ? colors.green : colors.red,
        }}>
          {opLabels[op.type] || op.type}
        </span>
        <span style={{ fontSize: 10, color: colors.textDim, fontFamily: fonts.mono }}>
          {op.target}
        </span>
      </div>
      {op.error && (
        <div style={{
          fontSize: 11, color: colors.red, fontFamily: fonts.mono,
          padding: '4px 6px', background: 'rgba(239,68,68,0.06)', borderRadius: 4, marginTop: 4,
        }}>
          {op.error}
        </div>
      )}
    </div>
  );
}
