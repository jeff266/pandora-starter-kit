import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { colors, fonts } from '../styles/theme';
import { formatCurrency, formatTimeAgo } from '../lib/format';
import Skeleton from '../components/Skeleton';

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

interface Action {
  id: string;
  action_type: string;
  severity: string;
  title: string;
  summary?: string;
  recommended_steps?: string[];
  target_deal_name?: string;
  deal_name?: string;
  target_deal_id?: string;
  owner_email?: string;
  impact_amount?: number;
  urgency_label?: string;
  execution_status: string;
  created_at: string;
  source_skill: string;
}

const sevColors: Record<string, string> = {
  critical: '#ef4444',
  warning: '#f59e0b',
  notable: '#6c5ce7',
  info: '#3b82f6',
};

const statusLabels: Record<string, { color: string; label: string }> = {
  open: { color: '#6b7280', label: 'Open' },
  in_progress: { color: '#3b82f6', label: 'In Progress' },
  executed: { color: '#22c55e', label: 'Executed' },
  dismissed: { color: '#4b5563', label: 'Dismissed' },
};

export default function Actions() {
  const navigate = useNavigate();
  const [summary, setSummary] = useState<ActionsSummary | null>(null);
  const [actions, setActions] = useState<Action[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedAction, setSelectedAction] = useState<Action | null>(null);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const [severityFilter, setSeverityFilter] = useState<string[]>(['critical', 'warning', 'notable', 'info']);
  const [statusFilter, setStatusFilter] = useState('open');
  const [repFilter, setRepFilter] = useState('all');
  const [skillFilter, setSkillFilter] = useState('all');
  const [sortBy, setSortBy] = useState<'severity' | 'impact' | 'age'>('severity');

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const [summaryData, actionsData] = await Promise.all([
        api.get('/action-items/summary'),
        api.get('/action-items?status=all&limit=200'),
      ]);
      setSummary(summaryData);
      setActions(actionsData.actions || []);
    } catch (err) {
      console.error('Failed to fetch actions:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const filtered = actions
    .filter(a => severityFilter.includes(a.severity))
    .filter(a => statusFilter === 'all' || a.execution_status === statusFilter)
    .filter(a => repFilter === 'all' || a.owner_email === repFilter)
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

  const reps = Array.from(new Set(actions.map(a => a.owner_email).filter((x): x is string => !!x)));
  const skills = Array.from(new Set(actions.map(a => a.source_skill).filter((x): x is string => !!x)));

  async function updateStatus(actionId: string, status: string) {
    try {
      await api.put(`/action-items/${actionId}/status`, {
        status,
        actor: 'user',
      });
      setToast({ message: `Action ${status === 'dismissed' ? 'dismissed' : 'updated'}`, type: 'success' });
      setTimeout(() => setToast(null), 3000);
      setSelectedAction(null);
      await fetchData();
    } catch (err: any) {
      setToast({ message: err.message || 'Failed to update', type: 'error' });
      setTimeout(() => setToast(null), 5000);
    }
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
          background: toast.type === 'success' ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)',
          border: `1px solid ${toast.type === 'success' ? '#22c55e' : '#ef4444'}`,
          color: toast.type === 'success' ? '#22c55e' : '#ef4444',
          fontSize: 12, fontWeight: 500,
        }}>
          {toast.message}
        </div>
      )}

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
          value={formatCurrency(Number(summary?.total_impact_at_risk) || 0)}
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

      <div style={{
        display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
        background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 10, padding: '10px 16px',
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

        <SelectFilter value={statusFilter} onChange={setStatusFilter}
          options={[['all', 'All Status'], ['open', 'Open'], ['in_progress', 'In Progress'], ['executed', 'Executed'], ['dismissed', 'Dismissed']]} />

        <SelectFilter value={repFilter} onChange={setRepFilter}
          options={[['all', 'All Reps'], ...reps.map(r => [r, r.split('@')[0]])]} />

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
            const st = statusLabels[action.execution_status] || statusLabels.open;
            const dealName = action.deal_name || action.target_deal_name;
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
                <div style={{ minWidth: 0 }}>
                  <span style={{ fontSize: 13, fontWeight: 500, color: colors.text }}>{action.title}</span>
                  <p style={{ fontSize: 11, color: colors.textMuted, marginTop: 1 }}>{action.source_skill}</p>
                </div>
                <span
                  style={{ fontSize: 12, color: dealName ? colors.accent : colors.textDim, cursor: dealName ? 'pointer' : 'default' }}
                  onClick={e => {
                    if (action.target_deal_id) {
                      e.stopPropagation();
                      navigate(`/deals/${action.target_deal_id}`);
                    }
                  }}
                >
                  {dealName || '--'}
                </span>
                <span style={{ fontSize: 12, color: colors.textMuted }}>
                  {action.owner_email?.split('@')[0] || '--'}
                </span>
                <span style={{ fontSize: 12, fontFamily: fonts.mono, color: colors.text, textAlign: 'right' }}>
                  {action.impact_amount ? formatCurrency(Number(action.impact_amount)) : '--'}
                </span>
                <span style={{ fontSize: 11, color: colors.textMuted }}>{action.urgency_label || '--'}</span>
                <span style={{ fontSize: 11, color: colors.textMuted }}>{formatTimeAgo(action.created_at)}</span>
                <span style={{
                  fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 4,
                  background: `${st.color}15`, color: st.color,
                  justifySelf: 'start',
                }}>
                  {st.label}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {selectedAction && (
        <ActionPanel
          action={selectedAction}
          onClose={() => setSelectedAction(null)}
          onUpdateStatus={updateStatus}
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

function ActionPanel({ action, onClose, onUpdateStatus, navigate }: {
  action: Action;
  onClose: () => void;
  onUpdateStatus: (id: string, status: string) => void;
  navigate: (path: string) => void;
}) {
  const sc = sevColors[action.severity] || colors.textMuted;
  const st = statusLabels[action.execution_status] || statusLabels.open;
  const dealName = action.deal_name || action.target_deal_name;

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
      display: 'flex', justifyContent: 'flex-end', zIndex: 1000,
    }} onClick={onClose}>
      <div
        style={{
          width: 460, height: '100%', overflowY: 'auto',
          background: colors.surface, borderLeft: `1px solid ${colors.border}`, padding: 24,
        }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{
              width: 10, height: 10, borderRadius: '50%', background: sc,
              boxShadow: `0 0 8px ${sc}40`, flexShrink: 0,
            }} />
            <div>
              <h3 style={{ fontSize: 16, fontWeight: 700, color: colors.text }}>{action.title}</h3>
              <p style={{ fontSize: 12, color: colors.textMuted, marginTop: 2 }}>
                {action.action_type.replace(/_/g, ' ')} &middot; {action.source_skill}
              </p>
            </div>
          </div>
          <button onClick={onClose} style={{ fontSize: 18, color: colors.textMuted, background: 'none', cursor: 'pointer', padding: 4 }}>
            &#x2715;
          </button>
        </div>

        <span style={{
          fontSize: 10, fontWeight: 600, padding: '3px 10px', borderRadius: 4,
          background: `${st.color}15`, color: st.color, display: 'inline-block', marginBottom: 16,
        }}>
          {st.label}
        </span>

        {action.summary && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: colors.textDim, marginBottom: 6, textTransform: 'uppercase' }}>Summary</div>
            <p style={{ fontSize: 13, color: colors.textSecondary, lineHeight: 1.5 }}>{action.summary}</p>
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
          <div style={{ background: colors.surfaceRaised, borderRadius: 8, padding: 12 }}>
            <div style={{ fontSize: 11, color: colors.textDim }}>Impact</div>
            <div style={{ fontSize: 18, fontWeight: 700, fontFamily: fonts.mono, color: colors.text, marginTop: 4 }}>
              {action.impact_amount ? formatCurrency(Number(action.impact_amount)) : '--'}
            </div>
          </div>
          <div style={{ background: colors.surfaceRaised, borderRadius: 8, padding: 12 }}>
            <div style={{ fontSize: 11, color: colors.textDim }}>Urgency</div>
            <div style={{ fontSize: 14, fontWeight: 600, color: colors.text, marginTop: 4, textTransform: 'capitalize' }}>
              {action.urgency_label || '--'}
            </div>
          </div>
        </div>

        {dealName && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: colors.textDim, marginBottom: 6, textTransform: 'uppercase' }}>Deal</div>
            <span
              style={{ fontSize: 13, color: colors.accent, cursor: action.target_deal_id ? 'pointer' : 'default' }}
              onClick={() => action.target_deal_id && navigate(`/deals/${action.target_deal_id}`)}
            >
              {dealName}
            </span>
          </div>
        )}

        {action.owner_email && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: colors.textDim, marginBottom: 6, textTransform: 'uppercase' }}>Owner</div>
            <span style={{ fontSize: 13, color: colors.textSecondary }}>{action.owner_email}</span>
          </div>
        )}

        {action.recommended_steps && action.recommended_steps.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: colors.textDim, marginBottom: 8, textTransform: 'uppercase' }}>
              Recommended Steps
            </div>
            <ol style={{ paddingLeft: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 6 }}>
              {action.recommended_steps.map((step, idx) => (
                <li key={idx} style={{ display: 'flex', gap: 8, fontSize: 12 }}>
                  <span style={{ color: colors.accent, fontWeight: 600 }}>{idx + 1}.</span>
                  <span style={{ color: colors.textSecondary, lineHeight: 1.4 }}>{step}</span>
                </li>
              ))}
            </ol>
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 24 }}>
          {(action.execution_status === 'open') && (
            <button
              onClick={() => onUpdateStatus(action.id, 'in_progress')}
              style={{
                width: '100%', padding: '10px 16px', borderRadius: 8,
                background: colors.accent, color: '#fff',
                fontSize: 13, fontWeight: 600, cursor: 'pointer',
              }}
            >
              Mark In Progress
            </button>
          )}
          {(action.execution_status === 'open' || action.execution_status === 'in_progress') && (
            <button
              onClick={() => onUpdateStatus(action.id, 'executed')}
              style={{
                width: '100%', padding: '10px 16px', borderRadius: 8,
                background: colors.surfaceHover, color: colors.text,
                fontSize: 13, fontWeight: 600, cursor: 'pointer',
              }}
            >
              Mark as Executed
            </button>
          )}
          {(action.execution_status === 'open' || action.execution_status === 'in_progress') && (
            <button
              onClick={() => {
                if (confirm('Dismiss this action?')) {
                  onUpdateStatus(action.id, 'dismissed');
                }
              }}
              style={{
                width: '100%', padding: '8px 16px', borderRadius: 8,
                background: 'transparent', color: colors.textMuted,
                fontSize: 12, cursor: 'pointer',
              }}
            >
              Dismiss
            </button>
          )}
          {action.execution_status === 'dismissed' && (
            <button
              onClick={() => onUpdateStatus(action.id, 'open')}
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
    </div>
  );
}
