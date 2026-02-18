import React, { useEffect, useState, useCallback } from 'react';
import { api } from '../lib/api';
import { colors, fonts } from '../styles/theme';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Tool {
  id: string;
  name: string;
  description: string;
  category: string;
  status: 'live' | 'experimental' | 'coming_soon';
  params?: ParamDef[];
}

interface ParamDef {
  name: string;
  type: 'string' | 'number' | 'boolean';
  description: string;
  required?: boolean;
}

interface ToolCallStat {
  tool_name: string;
  call_count: number;
  avg_duration_ms: number;
  empty_rate_pct: number;
  error_rate_pct: number;
  last_called_at: string | null;
}

// ─── Tool catalog with parameter definitions ──────────────────────────────────

const TOOLS: Tool[] = [
  {
    id: 'query_deals', name: 'Query Deals', category: 'Data', status: 'live',
    description: 'Search and filter deals by stage, owner, amount, close date, and custom fields.',
    params: [
      { name: 'stage', type: 'string', description: 'Filter by stage name (e.g. "Proposal")' },
      { name: 'owner_email', type: 'string', description: 'Filter by rep email' },
      { name: 'min_amount', type: 'number', description: 'Minimum deal amount ($)' },
      { name: 'max_amount', type: 'number', description: 'Maximum deal amount ($)' },
      { name: 'forecast_category', type: 'string', description: 'commit | best_case | pipeline' },
      { name: 'limit', type: 'number', description: 'Max records to return (default 25)' },
    ],
  },
  {
    id: 'query_accounts', name: 'Query Accounts', category: 'Data', status: 'live',
    description: 'Fetch account records with contacts, deals, and engagement history.',
    params: [
      { name: 'industry', type: 'string', description: 'Filter by industry' },
      { name: 'has_open_deals', type: 'boolean', description: 'Only accounts with open deals (true/false)' },
      { name: 'limit', type: 'number', description: 'Max records (default 25)' },
    ],
  },
  {
    id: 'query_contacts', name: 'Query Contacts', category: 'Data', status: 'live',
    description: 'Search contacts by name, email, role, and account association.',
    params: [
      { name: 'deal_id', type: 'string', description: 'UUID of deal to get contacts for' },
      { name: 'account_id', type: 'string', description: 'UUID of account' },
      { name: 'limit', type: 'number', description: 'Max records (default 25)' },
    ],
  },
  {
    id: 'query_conversations', name: 'Query Conversations', category: 'Data', status: 'live',
    description: 'Search call recordings and meeting transcripts by account, rep, or topic.',
    params: [
      { name: 'account_id', type: 'string', description: 'Filter by account UUID' },
      { name: 'deal_id', type: 'string', description: 'Filter by deal UUID' },
      { name: 'since_days', type: 'number', description: 'Look back N days (default 30)' },
      { name: 'limit', type: 'number', description: 'Max records (default 20)' },
    ],
  },
  {
    id: 'query_stage_history', name: 'Query Stage History', category: 'Data', status: 'live',
    description: 'Track how deals moved through pipeline stages over time.',
    params: [
      { name: 'deal_id', type: 'string', description: 'UUID of the deal' },
      { name: 'since_days', type: 'number', description: 'Look back N days' },
    ],
  },
  {
    id: 'query_field_history', name: 'Query Field History', category: 'Data', status: 'live',
    description: 'View changes to deal fields like amount, close date, and owner.',
    params: [
      { name: 'deal_id', type: 'string', description: 'UUID of the deal' },
      { name: 'field_name', type: 'string', description: 'Field to track (e.g. "amount")' },
    ],
  },
  {
    id: 'query_activity_timeline', name: 'Activity Timeline', category: 'Data', status: 'live',
    description: 'Pull emails, calls, and meetings associated with a deal or account.',
    params: [
      { name: 'deal_id', type: 'string', description: 'Deal UUID' },
      { name: 'account_id', type: 'string', description: 'Account UUID' },
      { name: 'since_days', type: 'number', description: 'Look back N days (default 30)' },
    ],
  },
  {
    id: 'compute_metric', name: 'Compute Metric', category: 'Analytics', status: 'live',
    description: 'Calculate key metrics: win rate, pipeline total, average deal size, sales cycle, coverage.',
    params: [
      { name: 'metric', type: 'string', description: 'win_rate | pipeline_total | avg_deal_size | sales_cycle | coverage_ratio', required: true },
      { name: 'filter_owner', type: 'string', description: 'Filter to a specific rep email' },
      { name: 'filter_stage', type: 'string', description: 'Filter to a specific stage' },
    ],
  },
  {
    id: 'compute_metric_segmented', name: 'Segmented Metrics', category: 'Analytics', status: 'live',
    description: 'Break down any metric by rep, stage, pipeline, or time period.',
    params: [
      { name: 'metric', type: 'string', description: 'Metric name', required: true },
      { name: 'segment_by', type: 'string', description: 'rep | stage | pipeline | month', required: true },
    ],
  },
  {
    id: 'compute_stage_benchmarks', name: 'Stage Benchmarks', category: 'Analytics', status: 'live',
    description: 'Calculate median time-in-stage and conversion rates across your pipeline.',
    params: [
      { name: 'lookback_months', type: 'number', description: 'Months of history to use (default 12)' },
    ],
  },
  {
    id: 'compute_forecast_accuracy', name: 'Forecast Accuracy', category: 'Analytics', status: 'live',
    description: 'Compare predicted vs actual close dates and amounts to measure rep forecast quality.',
    params: [
      { name: 'lookback_quarters', type: 'number', description: 'Quarters to analyze (default 4)' },
    ],
  },
  {
    id: 'compute_close_probability', name: 'Close Probability', category: 'Analytics', status: 'live',
    description: 'Score individual deals on their likelihood to close based on historical patterns.',
    params: [
      { name: 'deal_id', type: 'string', description: 'UUID of deal to score' },
    ],
  },
  {
    id: 'compute_pipeline_creation', name: 'Pipeline Creation', category: 'Analytics', status: 'live',
    description: 'Track how much new pipeline is being generated over time.',
    params: [
      { name: 'since_months', type: 'number', description: 'Months to analyze (default 6)' },
    ],
  },
  {
    id: 'compute_inqtr_close_rate', name: 'In-Quarter Close Rate', category: 'Analytics', status: 'live',
    description: 'Measure the rate at which deals created in the current quarter actually close.',
    params: [
      { name: 'lookback_quarters', type: 'number', description: 'Quarters for baseline (default 4)' },
    ],
  },
  {
    id: 'compute_competitive_rates', name: 'Competitive Win Rates', category: 'Analytics', status: 'live',
    description: 'Break down win/loss rates by competitor to surface competitive patterns.',
    params: [
      { name: 'lookback_months', type: 'number', description: 'Months of history (default 6)' },
    ],
  },
  {
    id: 'get_skill_evidence', name: 'Skill Evidence', category: 'Intelligence', status: 'live',
    description: 'Pull structured evidence records from any skill run for export or review.',
    params: [
      { name: 'skill_id', type: 'string', description: 'Skill ID (e.g. pipeline-hygiene)', required: true },
      { name: 'limit', type: 'number', description: 'Max runs to pull from (default 1)' },
    ],
  },
  {
    id: 'search_transcripts', name: 'Transcript Search', category: 'Intelligence', status: 'live',
    description: 'Semantic search across call and meeting transcripts for topics, objections, or competitor mentions.',
    params: [
      { name: 'query', type: 'string', description: 'Search phrase or keyword', required: true },
      { name: 'limit', type: 'number', description: 'Max results (default 10)' },
    ],
  },
  {
    id: 'compute_activity_trend', name: 'Activity Trend', category: 'Analytics', status: 'live',
    description: '30-day engagement trajectory for a deal',
    params: [
      { name: 'deal_id', type: 'string', description: 'UUID of the deal', required: true },
      { name: 'lookback_days', type: 'number', description: 'Days to look back (default 30)' },
    ],
  },
  {
    id: 'compute_shrink_rate', name: 'Shrink Rate', category: 'Analytics', status: 'live',
    description: 'Deal amount shrinkage from initial to closed-won',
    params: [
      { name: 'lookback_quarters', type: 'number', description: 'Quarters of history (default 4)' },
      { name: 'segment_by', type: 'string', description: 'rep or deal_size' },
    ],
  },
  {
    id: 'infer_contact_role', name: 'Infer Contact Role', category: 'Intelligence', status: 'live',
    description: 'Infer buying role from title and call history',
    params: [
      { name: 'contact_id', type: 'string', description: 'UUID of the contact', required: true },
    ],
  },
];

const STATUS_BADGE: Record<Tool['status'], { label: string; bg: string; color: string }> = {
  live: { label: 'Live', bg: '#14532d', color: '#86efac' },
  experimental: { label: 'Beta', bg: '#78350f', color: '#fde68a' },
  coming_soon: { label: 'Coming Soon', bg: '#1e293b', color: '#64748b' },
};

const CATEGORY_ORDER = ['Data', 'Analytics', 'Intelligence'];

// ─── Playground panel ─────────────────────────────────────────────────────────

function PlaygroundPanel({ tool, onClose }: { tool: Tool; onClose: () => void }) {
  const [paramValues, setParamValues] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [duration, setDuration] = useState<number | null>(null);

  const run = useCallback(async () => {
    setLoading(true);
    setResult(null);
    setError(null);
    setDuration(null);

    const params: Record<string, any> = {};
    for (const p of tool.params || []) {
      const raw = paramValues[p.name];
      if (raw === undefined || raw === '') continue;
      if (p.type === 'number') { const n = parseFloat(raw); if (!isNaN(n)) params[p.name] = n; }
      else if (p.type === 'boolean') { params[p.name] = raw === 'true'; }
      else { params[p.name] = raw; }
    }

    try {
      const data = await api.post(`/tools/${tool.id}/run`, params);
      setResult(data.result);
      setDuration(data.duration_ms ?? null);
    } catch (err: any) {
      setError(err.message || 'Tool execution failed');
      setDuration(null);
    } finally {
      setLoading(false);
    }
  }, [tool, paramValues]);

  const rowCount = result
    ? (result.total_count ?? result.deals?.length ?? result.accounts?.length
       ?? result.contacts?.length ?? result.conversations?.length
       ?? result.events?.length ?? (Array.isArray(result) ? result.length : null))
    : null;

  return (
    <div style={{
      position: 'fixed', top: 0, right: 0, width: 480, height: '100vh',
      background: colors.surface, borderLeft: `1px solid ${colors.border}`,
      display: 'flex', flexDirection: 'column', zIndex: 100, boxShadow: '-4px 0 24px rgba(0,0,0,0.3)',
    }}>
      <div style={{ padding: '16px 20px', borderBottom: `1px solid ${colors.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, color: colors.text, fontFamily: fonts.sans }}>{tool.name}</div>
          <div style={{ fontSize: 11, color: colors.textMuted, fontFamily: fonts.mono }}>{tool.id}</div>
        </div>
        <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: colors.textMuted, fontSize: 20, cursor: 'pointer', padding: '2px 6px', lineHeight: 1 }}>×</button>
      </div>

      <div style={{ padding: '16px 20px', borderBottom: `1px solid ${colors.border}`, flexShrink: 0 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: colors.textMuted, fontFamily: fonts.sans, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 12 }}>Parameters</div>
        {(tool.params || []).length === 0 && (
          <div style={{ fontSize: 12, color: colors.textSecondary, fontFamily: fonts.sans, marginBottom: 12 }}>No parameters — runs with workspace defaults.</div>
        )}
        {(tool.params || []).map(p => (
          <div key={p.name} style={{ marginBottom: 12 }}>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: colors.textSecondary, fontFamily: fonts.sans, marginBottom: 4 }}>
              {p.name}{p.required && <span style={{ color: '#f87171', marginLeft: 3 }}>*</span>}
              <span style={{ fontWeight: 400, color: colors.textMuted, marginLeft: 6 }}>{p.type}</span>
            </label>
            <input
              type={p.type === 'number' ? 'number' : 'text'}
              placeholder={p.description}
              value={paramValues[p.name] ?? ''}
              onChange={e => setParamValues(v => ({ ...v, [p.name]: e.target.value }))}
              style={{
                width: '100%', boxSizing: 'border-box',
                background: colors.surfaceRaised, border: `1px solid ${colors.border}`,
                borderRadius: 6, padding: '7px 10px', fontSize: 12,
                color: colors.text, fontFamily: fonts.mono, outline: 'none',
              }}
            />
          </div>
        ))}
        <button onClick={run} disabled={loading} style={{
          marginTop: 4, width: '100%', background: colors.accent, color: '#fff',
          border: 'none', borderRadius: 6, padding: '8px 16px',
          fontSize: 13, fontWeight: 600, fontFamily: fonts.sans, cursor: loading ? 'not-allowed' : 'pointer',
          opacity: loading ? 0.7 : 1,
        }}>
          {loading ? 'Running…' : 'Run Tool'}
        </button>
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: '16px 20px' }}>
        {error && (
          <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 8, padding: '12px 14px', marginBottom: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#f87171', fontFamily: fonts.sans, marginBottom: 4 }}>Error</div>
            <div style={{ fontSize: 12, color: '#fca5a5', fontFamily: fonts.mono, wordBreak: 'break-all' }}>{error}</div>
          </div>
        )}
        {result !== null && !error && (
          <>
            <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
              {duration !== null && (
                <span style={{ fontSize: 11, color: colors.textMuted, fontFamily: fonts.sans, background: colors.surfaceRaised, border: `1px solid ${colors.border}`, borderRadius: 4, padding: '2px 8px' }}>
                  {duration}ms
                </span>
              )}
              {rowCount !== null && (
                <span style={{ fontSize: 11, color: colors.textMuted, fontFamily: fonts.sans, background: colors.surfaceRaised, border: `1px solid ${colors.border}`, borderRadius: 4, padding: '2px 8px' }}>
                  {rowCount} rows
                </span>
              )}
              {rowCount === 0 && (
                <span style={{ fontSize: 11, color: '#f59e0b', fontFamily: fonts.sans, background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: 4, padding: '2px 8px' }}>
                  Empty result
                </span>
              )}
            </div>
            <pre style={{
              fontSize: 11, fontFamily: fonts.mono, color: colors.text,
              background: colors.surfaceRaised, border: `1px solid ${colors.border}`,
              borderRadius: 8, padding: 14, overflow: 'auto', margin: 0,
              whiteSpace: 'pre-wrap', wordBreak: 'break-all', lineHeight: 1.5,
            }}>
              {JSON.stringify(result, null, 2)}
            </pre>
          </>
        )}
        {result === null && !error && !loading && (
          <div style={{ fontSize: 12, color: colors.textMuted, fontFamily: fonts.sans, textAlign: 'center', marginTop: 40 }}>
            Configure parameters above and click Run Tool.
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Usage tab ────────────────────────────────────────────────────────────────

function emptyRateColor(pct: number): string {
  if (pct > 50) return '#f87171';
  if (pct > 20) return '#f59e0b';
  return '#86efac';
}

function timeAgo(iso: string | null): string {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  const h = Math.floor(diff / 3600000);
  if (h < 1) return `${Math.floor(diff / 60000)}m ago`;
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function UsageTab() {
  const [stats, setStats] = useState<ToolCallStat[]>([]);
  const [loading, setLoading] = useState(true);
  const [calledByFilter, setCalledByFilter] = useState<string>('all');
  const [days, setDays] = useState(7);

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams({ days: String(days) });
    if (calledByFilter !== 'all') params.set('called_by', calledByFilter);
    api.get(`/tools/stats?${params.toString()}`)
      .then((d: any) => setStats(d.stats || []))
      .catch(() => setStats([]))
      .finally(() => setLoading(false));
  }, [calledByFilter, days]);

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, alignItems: 'center' }}>
        {(['all', 'ask_pandora', 'skill_run', 'playground'] as const).map(opt => (
          <button
            key={opt}
            onClick={() => setCalledByFilter(opt)}
            style={{
              fontSize: 12, fontWeight: calledByFilter === opt ? 600 : 400,
              padding: '5px 12px', borderRadius: 6, border: `1px solid ${calledByFilter === opt ? colors.accent : colors.border}`,
              background: calledByFilter === opt ? 'rgba(99,102,241,0.1)' : 'transparent',
              color: calledByFilter === opt ? colors.accent : colors.textSecondary,
              fontFamily: fonts.sans, cursor: 'pointer',
            }}
          >
            {opt === 'all' ? 'All callers' : opt.replace('_', ' ')}
          </button>
        ))}
        <select
          value={days}
          onChange={e => setDays(parseInt(e.target.value, 10))}
          style={{
            marginLeft: 'auto', background: colors.surfaceRaised, border: `1px solid ${colors.border}`,
            borderRadius: 6, padding: '5px 10px', fontSize: 12, color: colors.text,
            fontFamily: fonts.sans, cursor: 'pointer',
          }}
        >
          <option value={1}>Last 24h</option>
          <option value={7}>Last 7 days</option>
          <option value={30}>Last 30 days</option>
        </select>
      </div>

      {loading && (
        <div style={{ textAlign: 'center', padding: 32, color: colors.textMuted, fontFamily: fonts.sans, fontSize: 13 }}>Loading usage data…</div>
      )}

      {!loading && stats.length === 0 && (
        <div style={{ textAlign: 'center', padding: '48px 24px', background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 10 }}>
          <div style={{ fontSize: 13, color: colors.textSecondary, fontFamily: fonts.sans }}>No tool calls logged yet for this period.</div>
          <div style={{ fontSize: 12, color: colors.textMuted, fontFamily: fonts.sans, marginTop: 6 }}>
            Usage is tracked automatically from Ask Pandora, skill runs, and Playground tests.
          </div>
        </div>
      )}

      {!loading && stats.length > 0 && (
        <>
          <div style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 10, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${colors.border}` }}>
                  {['Tool', 'Calls (7d)', 'Avg Latency', 'Empty Rate', 'Error Rate', 'Last Called'].map(h => (
                    <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontSize: 11, fontWeight: 600, color: colors.textMuted, fontFamily: fonts.sans, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {stats.map((s, i) => (
                  <tr key={s.tool_name} style={{ borderBottom: i < stats.length - 1 ? `1px solid ${colors.border}` : 'none' }}>
                    <td style={{ padding: '10px 14px' }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: colors.text, fontFamily: fonts.sans }}>{s.tool_name.replace(/_/g, ' ')}</div>
                      <div style={{ fontSize: 10, color: colors.textMuted, fontFamily: fonts.mono }}>{s.tool_name}</div>
                    </td>
                    <td style={{ padding: '10px 14px', fontSize: 13, fontWeight: 600, color: colors.text, fontFamily: fonts.sans }}>{s.call_count.toLocaleString()}</td>
                    <td style={{ padding: '10px 14px', fontSize: 12, color: colors.textSecondary, fontFamily: fonts.mono }}>{s.avg_duration_ms}ms</td>
                    <td style={{ padding: '10px 14px' }}>
                      <span style={{ fontSize: 12, fontWeight: 600, fontFamily: fonts.sans, color: emptyRateColor(s.empty_rate_pct) }}>{s.empty_rate_pct}%</span>
                    </td>
                    <td style={{ padding: '10px 14px', fontSize: 12, fontFamily: fonts.sans, color: s.error_rate_pct > 0 ? '#f87171' : colors.textMuted }}>{s.error_rate_pct}%</td>
                    <td style={{ padding: '10px 14px', fontSize: 11, color: colors.textMuted, fontFamily: fonts.sans }}>{timeAgo(s.last_called_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ display: 'flex', gap: 16, marginTop: 10, alignItems: 'center' }}>
            <span style={{ fontSize: 11, color: colors.textMuted, fontFamily: fonts.sans }}>Empty rate:</span>
            {[{ label: '< 20% healthy', color: '#86efac' }, { label: '20–50% watch', color: '#f59e0b' }, { label: '> 50% critical', color: '#f87171' }].map(l => (
              <span key={l.label} style={{ fontSize: 11, color: l.color, fontFamily: fonts.sans }}>● {l.label}</span>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function ToolsPage() {
  const [activeTab, setActiveTab] = useState<'tools' | 'usage'>('tools');
  const [selectedTool, setSelectedTool] = useState<Tool | null>(null);

  const grouped = CATEGORY_ORDER.map(cat => ({
    category: cat,
    tools: TOOLS.filter(t => t.category === cat),
  }));

  const TAB_STYLE = (active: boolean): React.CSSProperties => ({
    padding: '6px 14px', fontSize: 13, fontWeight: active ? 600 : 400,
    fontFamily: fonts.sans, border: 'none', cursor: 'pointer', borderRadius: 6,
    background: active ? colors.accent : 'transparent',
    color: active ? '#fff' : colors.textSecondary,
  });

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', position: 'relative' }}>
      <div style={{ marginBottom: 24, display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 600, color: colors.text, fontFamily: fonts.sans, margin: 0, marginBottom: 6 }}>Data Tools</h1>
          <p style={{ fontSize: 13, color: colors.textSecondary, fontFamily: fonts.sans, margin: 0 }}>
            Building blocks Pandora uses to answer questions and run skills.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 4, background: colors.surfaceRaised, border: `1px solid ${colors.border}`, borderRadius: 8, padding: 3 }}>
          <button style={TAB_STYLE(activeTab === 'tools')} onClick={() => { setActiveTab('tools'); }}>Tools</button>
          <button style={TAB_STYLE(activeTab === 'usage')} onClick={() => { setActiveTab('usage'); setSelectedTool(null); }}>Usage</button>
        </div>
      </div>

      {activeTab === 'tools' && grouped.map(({ category, tools }) => (
        <div key={category} style={{ marginBottom: 32 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: colors.textMuted, fontFamily: fonts.sans, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 12 }}>
            {category}
          </div>
          <div style={{ display: 'grid', gap: 8 }}>
            {tools.map(tool => {
              const badge = STATUS_BADGE[tool.status];
              const isSelected = selectedTool?.id === tool.id;
              return (
                <div key={tool.id} style={{
                  background: colors.surface,
                  border: `1px solid ${isSelected ? colors.accent : colors.border}`,
                  borderRadius: 8, padding: '14px 16px',
                  display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16,
                }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                      <span style={{ fontSize: 13, fontWeight: 600, color: colors.text, fontFamily: fonts.sans }}>{tool.name}</span>
                      <span style={{ fontSize: 10, fontFamily: fonts.mono, color: colors.textMuted }}>{tool.id}</span>
                    </div>
                    <div style={{ fontSize: 12, color: colors.textSecondary, fontFamily: fonts.sans, lineHeight: 1.5 }}>{tool.description}</div>
                  </div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
                    <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 10, background: badge.bg, color: badge.color, fontFamily: fonts.sans }}>
                      {badge.label}
                    </span>
                    {tool.status === 'live' && (
                      <button
                        onClick={() => setSelectedTool(isSelected ? null : tool)}
                        style={{
                          fontSize: 11, fontWeight: 600, padding: '4px 10px', borderRadius: 6,
                          background: isSelected ? colors.accent : 'transparent',
                          color: isSelected ? '#fff' : colors.accent,
                          border: `1px solid ${colors.accent}`,
                          fontFamily: fonts.sans, cursor: 'pointer',
                        }}
                      >
                        {isSelected ? 'Close' : 'Test'}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {activeTab === 'usage' && <UsageTab />}

      {selectedTool && activeTab === 'tools' && (
        <PlaygroundPanel tool={selectedTool} onClose={() => setSelectedTool(null)} />
      )}
    </div>
  );
}
