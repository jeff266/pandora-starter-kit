import { useState, useEffect } from 'react';
import { api } from '../../lib/api';
import { useWorkspace } from '../../context/WorkspaceContext';
import { useDemoMode } from '../../contexts/DemoModeContext';
import { colors, fonts } from '../../styles/theme';

const font = fonts.sans;
const mono = fonts.mono;

type Tab = 'deals' | 'competitors' | 'intel';
type CompetitorPattern =
  | 'displacement_threat' | 'pricing_pressure' | 'feature_gap'
  | 'emerging_threat' | 'declining_threat' | 'segment_specific';

const PATTERN_META: Record<string, { label: string; color: string; bg: string; border: string; tip: string }> = {
  displacement_threat: { label: 'Displacement Threat', color: colors.red,    bg: colors.redSoft,    border: 'rgba(239,68,68,0.25)',    tip: 'Actively replacing your product in existing accounts' },
  pricing_pressure:   { label: 'Pricing Pressure',    color: colors.orange,  bg: colors.orangeSoft, border: 'rgba(249,115,22,0.25)', tip: 'Driving discounting behavior and budget conversations' },
  feature_gap:        { label: 'Feature Gap',          color: colors.yellow,  bg: colors.yellowSoft, border: 'rgba(234,179,8,0.25)',  tip: 'Winning on specific capability your product lacks' },
  emerging_threat:    { label: 'Emerging Threat',      color: colors.purple,  bg: colors.purpleSoft, border: 'rgba(167,139,250,0.25)', tip: 'Appearing more frequently — watch for acceleration' },
  declining_threat:   { label: 'Declining',            color: colors.green,   bg: colors.greenSoft,  border: 'rgba(34,197,94,0.25)',  tip: 'Mention frequency and win-rate impact both decreasing' },
  segment_specific:   { label: 'Segment-Specific',     color: '#06b6d4', bg: 'rgba(6,182,212,0.1)', border: 'rgba(6,182,212,0.25)', tip: 'Dominant in one ICP segment but not broadly threatening' },
};

interface Competitor {
  name: string; deal_count: number; win_rate: number;
  delta: number; trend: 'up' | 'down' | 'stable'; mention_trend: string; pattern: CompetitorPattern | null;
}
interface OpenDeal {
  deal_id: string; deal_name: string; competitor_name: string; amount: number;
  stage: string; owner_email: string; mention_count: number; last_mention_at: string; risk: 'high' | 'med' | 'low';
}
interface FieldIntel {
  competitor_name: string; deal_name: string; owner_email: string;
  source_quote: string; confidence_score: number; created_at: string;
}
interface PageData {
  last_run_at: string | null; competitors_tracked: number; baseline_win_rate: number;
  mention_change_pct: number | null; pipeline_at_risk: number; high_risk_pipeline: number;
  hardest_competitor: string | null; hardest_competitor_delta: number | null;
  competitors: Competitor[]; open_deals: OpenDeal[]; field_intel: FieldIntel[]; exclusions: string[];
}

type SortOption = 'Deal Value' | 'Risk' | 'Last Mention';
const SORT_OPTIONS: SortOption[] = ['Deal Value', 'Risk', 'Last Mention'];
const RISK_ORDER = { high: 0, med: 1, low: 2 };

function formatDate(iso: string): string {
  try { return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); }
  catch { return iso; }
}
function formatTimeAgo(iso: string): string {
  try {
    const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
    if (days === 0) return 'today';
    if (days === 1) return '1d ago';
    return `${days}d ago`;
  } catch { return '—'; }
}
function formatCurrency(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return `$${Math.round(n)}`;
}

function ShieldIcon({ size = 15, color = colors.purple }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z" />
    </svg>
  );
}

function PatternBadge({ pattern }: { pattern: string | null }) {
  const [hovered, setHovered] = useState(false);
  if (!pattern) return <span style={{ fontSize: 11, color: colors.textMuted }}>—</span>;
  const meta = PATTERN_META[pattern] ?? { label: pattern, color: colors.textMuted, bg: colors.surface, border: colors.border, tip: '' };
  return (
    <div style={{ position: 'relative', display: 'inline-block' }}
      onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
      <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.03em', color: meta.color, background: meta.bg, border: `1px solid ${meta.border}`, borderRadius: 4, padding: '2px 8px', fontFamily: font, whiteSpace: 'nowrap', cursor: 'default' }}>{meta.label}</span>
      {hovered && meta.tip && (
        <div style={{ position: 'absolute', bottom: 'calc(100% + 6px)', left: '50%', transform: 'translateX(-50%)', background: colors.surfaceRaised, border: `1px solid ${colors.borderLight}`, borderRadius: 6, padding: '6px 10px', fontSize: 12, color: colors.textSecondary, fontFamily: font, whiteSpace: 'nowrap', zIndex: 100, boxShadow: '0 4px 16px rgba(0,0,0,0.4)', pointerEvents: 'none' }}>{meta.tip}</div>
      )}
    </div>
  );
}

function TrendArrow({ trend }: { trend: 'up' | 'down' | 'stable' }) {
  if (trend === 'up')   return <span style={{ color: colors.red,   fontSize: 14 }}>↑</span>;
  if (trend === 'down') return <span style={{ color: colors.green, fontSize: 14 }}>↓</span>;
  return <span style={{ color: colors.textMuted, fontSize: 14 }}>→</span>;
}
function Delta({ value }: { value: number }) {
  const color = value > 0 ? colors.green : value < 0 ? colors.red : colors.textMuted;
  return <span style={{ color, fontFamily: mono, fontSize: 13, fontWeight: 600 }}>{value > 0 ? '+' : ''}{value}pp</span>;
}
function RiskDot({ risk }: { risk: 'high' | 'med' | 'low' }) {
  const color = risk === 'high' ? colors.red : risk === 'med' ? colors.yellow : colors.green;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, color, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: color, boxShadow: `0 0 5px ${color}88`, flexShrink: 0 }} />{risk}
    </span>
  );
}
function StatCard({ label, value, sub, valueColor, accent }: { label: string; value: string; sub?: string; valueColor?: string; accent?: string }) {
  return (
    <div style={{ flex: 1, minWidth: 0, background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 10, padding: '18px 22px', borderTop: accent ? `2px solid ${accent}` : undefined }}>
      <div style={{ fontSize: 11, color: colors.textMuted, fontFamily: font, fontWeight: 600, marginBottom: 6, letterSpacing: '0.06em', textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 700, color: valueColor ?? colors.text, fontFamily: font, lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: colors.textMuted, fontFamily: font, marginTop: 5 }}>{sub}</div>}
    </div>
  );
}
function SkeletonBlock({ w = '100%', h = 18, radius = 4 }: { w?: string | number; h?: number; radius?: number }) {
  return <div style={{ width: w, height: h, borderRadius: radius, background: `linear-gradient(90deg, ${colors.surfaceRaised} 25%, ${colors.surfaceHover} 50%, ${colors.surfaceRaised} 75%)`, backgroundSize: '200% 100%', animation: 'shimmer 1.5s infinite' }} />;
}

export default function CompetitiveIntelligencePage() {
  const { currentWorkspace } = useWorkspace();
  const workspaceId = currentWorkspace?.id;

  const [data, setData]                     = useState<PageData | null>(null);
  const [loading, setLoading]               = useState(true);
  const [error, setError]                   = useState<string | null>(null);
  const [activeTab, setActiveTab]           = useState<Tab>('deals');
  const [selectedCompetitor, setSelected]   = useState<string | null>(null);
  const [sortBy, setSortBy]                 = useState<SortOption>('Deal Value');
  const [running, setRunning]               = useState(false);
  const [runMessage, setRunMessage]         = useState<string | null>(null);
  const [exclusions, setExclusions]         = useState<string[]>([]);
  const [showMath, setShowMath]             = useState(false);
  const { anon } = useDemoMode();

  const loadData = () => {
    if (!workspaceId) return;
    setLoading(true); setError(null);
    api.get('/intelligence/competitive')
      .then((res: any) => { setData(res); setExclusions(res.exclusions ?? []); })
      .catch((err: any) => setError(err.message ?? 'Failed to load data'))
      .finally(() => setLoading(false));
  };
  useEffect(() => { loadData(); }, [workspaceId]);

  const runAnalysis = async () => {
    if (running) return;
    setRunning(true); setRunMessage(null);
    try {
      await api.post('/skills/competitive-intelligence/run', {});
      setRunMessage('Analysis complete — refreshing data');
      loadData();
    } catch (err: any) { setRunMessage(err.message ?? 'Run failed'); }
    finally { setRunning(false); }
  };

  const toggleCompetitor = (name: string) => setSelected(prev => prev === name ? null : name);

  const excludeCompetitor = (name: string) => {
    const key = name.toLowerCase().trim();
    setExclusions(prev => prev.includes(key) ? prev : [...prev, key]);
    if (selectedCompetitor?.toLowerCase() === key) setSelected(null);
    api.post('/intelligence/competitive/exclusions', { name }).catch(() => {});
  };

  const restoreCompetitor = (key: string) => {
    setExclusions(prev => prev.filter(e => e !== key));
    api.delete(`/intelligence/competitive/exclusions/${encodeURIComponent(key)}`).catch(() => {});
  };

  const isExcluded = (name: string) => exclusions.includes(name.toLowerCase().trim());
  const visibleCompetitors = (data?.competitors ?? []).filter(c => !isExcluded(c.name));

  const sortedDeals = (() => {
    if (!data) return [];
    const deals = (selectedCompetitor
      ? data.open_deals.filter(d => d.competitor_name === selectedCompetitor)
      : [...data.open_deals]
    ).filter(d => !isExcluded(d.competitor_name));
    if (sortBy === 'Deal Value')   return deals.sort((a, b) => b.amount - a.amount);
    if (sortBy === 'Risk')         return deals.sort((a, b) => RISK_ORDER[a.risk] - RISK_ORDER[b.risk]);
    if (sortBy === 'Last Mention') return deals.sort((a, b) => new Date(b.last_mention_at).getTime() - new Date(a.last_mention_at).getTime());
    return deals;
  })();

  const filteredFeed = (data
    ? (selectedCompetitor ? data.field_intel.filter(f => f.competitor_name === selectedCompetitor) : data.field_intel)
    : []
  ).filter(f => !isExcluded(f.competitor_name));

  const noData = !loading && data && data.competitors.length === 0 && data.field_intel.length === 0;

  const kpiPipelineAtRisk = sortedDeals.reduce((s, d) => s + d.amount, 0);
  const kpiHighRisk       = sortedDeals.filter(d => d.risk === 'high').reduce((s, d) => s + d.amount, 0);
  const kpiHardest = selectedCompetitor
    ? (visibleCompetitors.find(c => c.name === selectedCompetitor) ?? null)
    : (visibleCompetitors.length > 0 ? [...visibleCompetitors].sort((a, b) => a.delta - b.delta)[0] : null);
  const kpiMentionCount = selectedCompetitor
    ? (visibleCompetitors.find(c => c.name === selectedCompetitor)?.deal_count ?? '—')
    : data?.mention_change_pct;

  const exportCsv = () => {
    const rows: string[][] = [];
    rows.push(['=== Competitor Win Rate Breakdown ===']);
    rows.push(['Competitor', 'Deals Mentioned', 'Win Rate %', 'Baseline %', 'Delta pp', 'Pattern']);
    for (const c of visibleCompetitors) rows.push([anon.company(c.name), String(c.deal_count), String(c.win_rate), String(data?.baseline_win_rate ?? 0), String(c.delta), c.pattern ?? '']);
    rows.push([]);
    rows.push(['=== Open Deal Exposure ===']);
    rows.push(['Deal', 'Competitor', 'Amount', 'Stage', 'Mentions', 'Last Mention', 'Risk']);
    for (const d of sortedDeals) rows.push([d.deal_name, anon.company(d.competitor_name), String(d.amount), d.stage, String(d.mention_count), d.last_mention_at, d.risk]);
    const csv = rows.map(r => r.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'competitive-intelligence.csv'; a.click();
    URL.revokeObjectURL(url);
  };

  const tabStyle = (t: Tab) => ({
    padding: '8px 18px', fontSize: 13, fontWeight: 600, fontFamily: font,
    borderRadius: '6px 6px 0 0', border: 'none', cursor: 'pointer',
    background: activeTab === t ? colors.surface : 'transparent',
    color: activeTab === t ? colors.text : colors.textMuted,
    borderBottom: activeTab === t ? `2px solid ${colors.accent}` : '2px solid transparent',
    transition: 'all 0.15s',
  } as React.CSSProperties);

  return (
    <div style={{ background: colors.bg, minHeight: '100vh', fontFamily: font, color: colors.text, padding: '28px 32px' }}>
      <style>{`
        @keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>

      {/* ── Page Header ─────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
            <div style={{ width: 28, height: 28, borderRadius: 7, background: 'rgba(167,139,250,0.15)', border: '1px solid rgba(167,139,250,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <ShieldIcon size={15} color={colors.purple} />
            </div>
            <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0, color: colors.text, fontFamily: font }}>Competitive Intelligence</h1>
          </div>
          <div style={{ fontSize: 13, color: colors.textMuted, fontFamily: font }}>
            {data?.last_run_at
              ? <>Last analyzed <strong style={{ color: colors.textSecondary }}>{formatDate(data.last_run_at)}</strong> · 90-day trailing window · {data.competitors_tracked} competitor{data.competitors_tracked !== 1 ? 's' : ''} tracked</>
              : loading ? 'Loading…' : 'No analysis run yet · 90-day trailing window'}
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {selectedCompetitor && (
              <button onClick={() => setSelected(null)} style={{ background: colors.surfaceRaised, border: `1px solid ${colors.borderLight}`, color: colors.textSecondary, fontSize: 13, padding: '7px 14px', borderRadius: 7, cursor: 'pointer', fontFamily: font }}>
                ✕ {anon.company(selectedCompetitor)}
              </button>
            )}
            <button onClick={runAnalysis} disabled={running} style={{ background: running ? colors.surfaceRaised : colors.accentSoft, border: `1px solid ${running ? colors.borderLight : colors.accent}`, color: running ? colors.textMuted : colors.accent, fontSize: 13, fontWeight: 600, padding: '7px 14px', borderRadius: 7, cursor: running ? 'not-allowed' : 'pointer', fontFamily: font, display: 'flex', alignItems: 'center', gap: 6, transition: 'all 0.15s' }}>
              {running && <span style={{ width: 10, height: 10, borderRadius: '50%', border: `2px solid ${colors.accent}`, borderTopColor: 'transparent', animation: 'spin 0.7s linear infinite', display: 'inline-block' }} />}
              {running ? 'Running…' : '▶ Run Analysis'}
            </button>
            <div style={{ background: colors.surfaceRaised, border: `1px solid ${colors.borderLight}`, borderRadius: 7, padding: '7px 13px', fontSize: 12, color: colors.textMuted, display: 'flex', alignItems: 'center', gap: 6, fontFamily: font }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: colors.green, boxShadow: `0 0 5px ${colors.green}88` }} />
              Auto-runs 1st of each month
            </div>
          </div>
          {runMessage && <div style={{ fontSize: 12, color: runMessage.includes('fail') || runMessage.includes('Fail') ? colors.red : colors.green, fontFamily: font }}>{runMessage}</div>}
        </div>
      </div>

      {error && <div style={{ background: colors.redSoft, border: `1px solid rgba(239,68,68,0.25)`, borderRadius: 8, padding: '12px 18px', marginBottom: 20, fontSize: 13, color: colors.red, fontFamily: font }}>{error}</div>}

      {/* ── KPI Strip — always visible ───────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 14, marginBottom: 24, alignItems: 'stretch' }}>
        {loading ? (
          [0,1,2,3].map(i => (
            <div key={i} style={{ flex: 1, background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 10, padding: '18px 22px' }}>
              <SkeletonBlock h={10} w="60%" /><div style={{ marginTop: 10 }}><SkeletonBlock h={28} w="50%" /></div><div style={{ marginTop: 8 }}><SkeletonBlock h={10} w="80%" /></div>
            </div>
          ))
        ) : (
          <>
            <StatCard label="Baseline win rate" value={data ? `${data.baseline_win_rate}%` : '—'} sub="Deals with no competitors" accent={colors.green} />
            <StatCard label={selectedCompetitor ? `${anon.company(selectedCompetitor)} pipeline` : 'Open pipeline at risk'} value={data ? formatCurrency(kpiPipelineAtRisk) : '—'} sub={data ? `${formatCurrency(kpiHighRisk)} flagged high-risk` : undefined} valueColor={colors.red} accent={colors.red} />
            <StatCard
              label={selectedCompetitor ? 'Win rate vs. baseline' : 'Hardest to beat'}
              value={selectedCompetitor ? (kpiHardest ? `${kpiHardest.win_rate}%` : '—') : (kpiHardest ? anon.company(kpiHardest.name) : '—')}
              sub={kpiHardest ? (selectedCompetitor ? `${kpiHardest.delta > 0 ? '+' : ''}${kpiHardest.delta}pp vs. ${data?.baseline_win_rate}% baseline` : `${kpiHardest.delta > 0 ? '+' : ''}${kpiHardest.delta}pp vs. baseline`) : 'No data yet'}
              valueColor={selectedCompetitor && kpiHardest && kpiHardest.win_rate < (data?.baseline_win_rate ?? 50) ? colors.red : (selectedCompetitor ? colors.green : colors.red)}
              accent={colors.purple}
            />
            <StatCard
              label={selectedCompetitor ? `${anon.company(selectedCompetitor)} deal count` : 'Competitor mentions'}
              value={selectedCompetitor ? String(kpiMentionCount ?? '—') : (data?.mention_change_pct != null ? `${data.mention_change_pct > 0 ? '+' : ''}${data.mention_change_pct}%` : 'First run')}
              sub={selectedCompetitor ? 'Deals with at least one mention' : 'vs. prior 90-day period'}
              valueColor={colors.orange} accent={colors.orange}
            />
          </>
        )}
      </div>

      {/* ── Tabs ────────────────────────────────────────────────────────────── */}
      <div style={{ borderBottom: `1px solid ${colors.border}`, marginBottom: 0, display: 'flex', gap: 2 }}>
        <button style={tabStyle('deals')}    onClick={() => setActiveTab('deals')}>Deals at Risk</button>
        <button style={tabStyle('competitors')} onClick={() => setActiveTab('competitors')}>Competitors</button>
        <button style={tabStyle('intel')}    onClick={() => setActiveTab('intel')}>Field Intel</button>
      </div>

      {/* ── No-data empty state ──────────────────────────────────────────────── */}
      {noData && (
        <div style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderTop: 'none', borderRadius: '0 0 12px 12px', padding: '48px 32px', textAlign: 'center' }}>
          <ShieldIcon size={32} color={colors.textDim} />
          <div style={{ fontSize: 15, fontWeight: 600, color: colors.textSecondary, marginTop: 16, marginBottom: 8, fontFamily: font }}>No competitive data yet</div>
          <div style={{ fontSize: 13, color: colors.textMuted, maxWidth: 420, margin: '0 auto', lineHeight: 1.6, fontFamily: font }}>
            The Competitive Intelligence skill runs automatically on the 1st of each month. It can also be triggered manually from the Skills page.
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          TAB: DEALS AT RISK
      ══════════════════════════════════════════════════════════════════════ */}
      {!noData && activeTab === 'deals' && (
        <div style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderTop: 'none', borderRadius: '0 0 12px 12px', overflow: 'hidden' }}>
          <div style={{ padding: '18px 22px 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, color: colors.text, marginBottom: 2, fontFamily: font }}>Open Deal Exposure</div>
              <div style={{ fontSize: 12, color: colors.textMuted, fontFamily: font }}>
                {loading ? 'Loading…' : `${sortedDeals.length} open deal${sortedDeals.length !== 1 ? 's' : ''} with competitor mentions · sorted by ${sortBy.toLowerCase()}`}
                {selectedCompetitor && <span style={{ color: colors.purple }}> · filtered to {anon.company(selectedCompetitor)}</span>}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              {SORT_OPTIONS.map(s => (
                <button key={s} onClick={() => setSortBy(s)} style={{ background: sortBy === s ? colors.accentSoft : 'transparent', border: `1px solid ${sortBy === s ? colors.accent : colors.border}`, color: sortBy === s ? colors.accent : colors.textMuted, fontSize: 12, padding: '5px 11px', borderRadius: 6, cursor: 'pointer', fontFamily: font }}>{s}</button>
              ))}
            </div>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 14 }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${colors.border}` }}>
                  {[{ label: 'Deal', pad: '8px 22px' }, { label: 'Competitor', pad: '8px 22px' }, { label: 'Amount', pad: '8px 14px' }, { label: 'Stage', pad: '8px 22px' }, { label: 'Mentions', pad: '8px 14px' }, { label: 'Last Mention', pad: '8px 14px' }, { label: 'Risk', pad: '8px 22px' }].map(h => (
                    <th key={h.label} style={{ padding: h.pad, textAlign: 'left', fontSize: 11, fontWeight: 600, color: colors.textMuted, letterSpacing: '0.06em', textTransform: 'uppercase', fontFamily: font, whiteSpace: 'nowrap' }}>{h.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading && [0,1,2,3].map(i => (
                  <tr key={i} style={{ borderBottom: `1px solid ${colors.border}` }}>
                    {[0,1,2,3,4,5,6].map(j => <td key={j} style={{ padding: '13px 22px' }}><SkeletonBlock h={12} w={j === 0 ? '120px' : j === 2 ? '60px' : '80px'} /></td>)}
                  </tr>
                ))}
                {!loading && sortedDeals.map(d => (
                  <tr key={`${d.deal_id}-${d.competitor_name}`} style={{ borderBottom: `1px solid ${colors.border}`, transition: 'background 0.15s' }}
                    onMouseEnter={e => (e.currentTarget.style.background = colors.surfaceHover)}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                    <td style={{ padding: '11px 22px', fontSize: 13, fontWeight: 500, color: colors.text, fontFamily: font }}>{d.deal_name}</td>
                    <td style={{ padding: '11px 22px' }}>
                      <button onClick={() => { toggleCompetitor(d.competitor_name); setActiveTab('competitors'); }} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontFamily: font, textAlign: 'left' }}>
                        <span style={{ fontSize: 13, color: colors.accent, fontWeight: 600 }}>{anon.company(d.competitor_name)}</span>
                      </button>
                    </td>
                    <td style={{ padding: '11px 14px', fontSize: 13, fontFamily: mono, color: colors.text, fontWeight: 600, whiteSpace: 'nowrap' }}>{formatCurrency(d.amount)}</td>
                    <td style={{ padding: '11px 22px' }}><span style={{ fontSize: 12, color: colors.textSecondary, background: colors.surfaceRaised, border: `1px solid ${colors.border}`, borderRadius: 4, padding: '2px 8px', fontFamily: font }}>{d.stage}</span></td>
                    <td style={{ padding: '11px 14px', fontSize: 13, fontFamily: mono, color: colors.textSecondary }}>{d.mention_count}</td>
                    <td style={{ padding: '11px 14px', fontSize: 13, color: colors.textMuted, fontFamily: font, whiteSpace: 'nowrap' }}>{formatTimeAgo(d.last_mention_at)}</td>
                    <td style={{ padding: '11px 22px' }}><RiskDot risk={d.risk} /></td>
                  </tr>
                ))}
                {!loading && sortedDeals.length === 0 && (
                  <tr><td colSpan={7} style={{ padding: '32px 22px', textAlign: 'center', color: colors.textMuted, fontSize: 13, fontFamily: font }}>
                    {selectedCompetitor ? `No open deals with ${anon.company(selectedCompetitor)} mentions` : 'No open deals with competitor mentions'}
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          TAB: COMPETITORS
      ══════════════════════════════════════════════════════════════════════ */}
      {!noData && activeTab === 'competitors' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* Leaderboard — full width */}
          <div style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderTop: 'none', borderRadius: '0 0 12px 12px', overflow: 'hidden' }}>
            <div style={{ padding: '18px 22px 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600, color: colors.text, marginBottom: 2, fontFamily: font }}>Competitor Leaderboard</div>
                <div style={{ fontSize: 12, color: colors.textMuted, fontFamily: font }}>
                  Win rate vs. your <span style={{ color: colors.green, fontWeight: 600 }}>{data?.baseline_win_rate ?? '—'}% baseline</span> · click a row to filter all views
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => setShowMath(v => !v)} style={{ background: showMath ? colors.accentSoft : 'transparent', border: `1px solid ${showMath ? colors.accent : colors.borderLight}`, color: showMath ? colors.accent : colors.textMuted, fontSize: 12, fontFamily: font, fontWeight: 500, padding: '6px 12px', borderRadius: 6, cursor: 'pointer', transition: 'all 0.15s' }}>
                  {showMath ? '✕ Hide math' : '∑ Show math'}
                </button>
                <button onClick={exportCsv} style={{ background: colors.accentSoft, border: `1px solid ${colors.accent}`, color: colors.accent, fontSize: 12, fontFamily: font, fontWeight: 600, padding: '6px 12px', borderRadius: 6, cursor: 'pointer' }}>
                  ↓ Export CSV
                </button>
              </div>
            </div>

            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 14 }}>
                <thead>
                  <tr style={{ borderBottom: `1px solid ${colors.border}` }}>
                    {['Competitor', 'Deals', 'Win Rate', 'vs. Baseline', 'Trend', 'Pattern'].map(h => (
                      <th key={h} style={{ padding: '8px 16px', textAlign: 'left', fontSize: 11, fontWeight: 600, color: colors.textMuted, letterSpacing: '0.06em', textTransform: 'uppercase', fontFamily: font, whiteSpace: 'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {loading && [0,1,2,3].map(i => (
                    <tr key={i} style={{ borderBottom: `1px solid ${colors.border}` }}>
                      {[0,1,2,3,4,5].map(j => <td key={j} style={{ padding: '13px 16px' }}><SkeletonBlock h={12} w={j === 0 ? '100px' : '50px'} /></td>)}
                    </tr>
                  ))}
                  {!loading && visibleCompetitors.map(c => (
                    <tr key={c.name} onClick={() => toggleCompetitor(c.name)}
                      style={{ borderBottom: `1px solid ${colors.border}`, cursor: 'pointer', background: selectedCompetitor === c.name ? colors.surfaceActive : 'transparent', transition: 'background 0.15s' }}
                      onMouseEnter={e => { if (selectedCompetitor !== c.name) e.currentTarget.style.background = colors.surfaceHover; }}
                      onMouseLeave={e => { if (selectedCompetitor !== c.name) e.currentTarget.style.background = 'transparent'; }}>
                      <td style={{ padding: '11px 16px', fontSize: 13, fontWeight: 600, color: colors.text, fontFamily: font }}>{anon.company(c.name)}</td>
                      <td style={{ padding: '11px 16px', fontSize: 13, fontFamily: mono, color: colors.textSecondary }}>{c.deal_count}</td>
                      <td style={{ padding: '11px 16px', fontSize: 13, fontFamily: mono, fontWeight: 600, color: c.win_rate < (data?.baseline_win_rate ?? 50) ? colors.red : colors.green }}>{c.win_rate}%</td>
                      <td style={{ padding: '11px 16px' }}><Delta value={c.delta} /></td>
                      <td style={{ padding: '11px 16px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <TrendArrow trend={c.trend} />
                          <span style={{ fontSize: 11, color: colors.textMuted, fontFamily: mono }}>{c.mention_trend}</span>
                        </div>
                      </td>
                      <td style={{ padding: '11px 16px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                          <PatternBadge pattern={c.pattern} />
                          <button
                            onClick={e => { e.stopPropagation(); excludeCompetitor(c.name); }}
                            onMouseEnter={e => (e.currentTarget.style.color = colors.red)}
                            onMouseLeave={e => (e.currentTarget.style.color = colors.textMuted)}
                            title="Not a competitor"
                            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 15, color: colors.textMuted, padding: '2px 4px', borderRadius: 4, transition: 'color 0.15s', lineHeight: 1, flexShrink: 0 }}>
                            ⊘
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {!loading && visibleCompetitors.length === 0 && (
                    <tr><td colSpan={6} style={{ padding: '32px 16px', textAlign: 'center', fontSize: 13, color: colors.textMuted, fontFamily: font }}>
                      No competitive data yet. The skill runs on the 1st of each month.
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Math breakdown — inline under leaderboard */}
            {showMath && data && (
              <div style={{ borderTop: `1px solid ${colors.border}`, padding: '16px 22px' }}>
                <div style={{ fontSize: 12, color: colors.textMuted, fontFamily: font, marginBottom: 12 }}>
                  Full win rate breakdown · Baseline {data.baseline_win_rate}% · {visibleCompetitors.length} competitor{visibleCompetitors.length !== 1 ? 's' : ''}
                  {selectedCompetitor && <span style={{ color: colors.purple }}> · filtered to {anon.company(selectedCompetitor)}</span>}
                </div>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ borderBottom: `1px solid ${colors.border}` }}>
                        {['Competitor', 'Deals Mentioned', 'Win Rate', 'Baseline', 'Delta', 'Pipeline at Risk', 'High-Risk Pipeline', 'Pattern'].map(h => (
                          <th key={h} style={{ padding: '7px 14px', textAlign: 'left', fontSize: 11, fontWeight: 600, color: colors.textMuted, letterSpacing: '0.06em', textTransform: 'uppercase', fontFamily: font, whiteSpace: 'nowrap' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {visibleCompetitors.filter(c => !selectedCompetitor || c.name === selectedCompetitor).map(c => {
                        const cDeals = sortedDeals.filter(d => d.competitor_name === c.name);
                        const cPipeline = cDeals.reduce((s, d) => s + d.amount, 0);
                        const cHighRisk = cDeals.filter(d => d.risk === 'high').reduce((s, d) => s + d.amount, 0);
                        return (
                          <tr key={c.name} style={{ borderBottom: `1px solid ${colors.border}` }}>
                            <td style={{ padding: '9px 14px', fontSize: 13, fontWeight: 600, color: colors.text, fontFamily: font }}>{anon.company(c.name)}</td>
                            <td style={{ padding: '9px 14px', fontSize: 13, fontFamily: mono, color: colors.textSecondary }}>{c.deal_count}</td>
                            <td style={{ padding: '9px 14px', fontSize: 13, fontFamily: mono, fontWeight: 600, color: c.win_rate < data.baseline_win_rate ? colors.red : colors.green }}>{c.win_rate}%</td>
                            <td style={{ padding: '9px 14px', fontSize: 13, fontFamily: mono, color: colors.textMuted }}>{data.baseline_win_rate}%</td>
                            <td style={{ padding: '9px 14px' }}><Delta value={c.delta} /></td>
                            <td style={{ padding: '9px 14px', fontSize: 13, fontFamily: mono, color: colors.text, fontWeight: 600 }}>{formatCurrency(cPipeline)}</td>
                            <td style={{ padding: '9px 14px', fontSize: 13, fontFamily: mono, color: cHighRisk > 0 ? colors.red : colors.textMuted }}>{formatCurrency(cHighRisk)}</td>
                            <td style={{ padding: '9px 14px' }}><PatternBadge pattern={c.pattern} /></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>

          {/* Non-competition list */}
          {exclusions.length > 0 && (
            <div style={{ background: colors.surfaceRaised, border: `1px solid ${colors.borderLight}`, borderRadius: 10, padding: '12px 18px' }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 8 }}>
                <span style={{ fontSize: 11, color: colors.textMuted, fontFamily: font, fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>Non-competition list</span>
                <span style={{ fontSize: 11, color: colors.textDim, fontFamily: font }}>These names are excluded from competitive analysis. Remove a name if it becomes an actual competitor.</span>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {exclusions.map(key => (
                  <span key={key} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 6, padding: '3px 10px' }}>
                    <span style={{ fontSize: 12, color: colors.textSecondary, fontFamily: font, fontWeight: 500, textTransform: 'capitalize' }}>{anon.company(key)}</span>
                    <button onClick={() => restoreCompetitor(key)}
                      onMouseEnter={e => (e.currentTarget.style.color = colors.accent)}
                      onMouseLeave={e => (e.currentTarget.style.color = colors.textMuted)}
                      title="Remove from non-competition list"
                      style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: colors.textMuted, fontFamily: font, padding: 0, transition: 'color 0.15s', lineHeight: 1 }}>
                      × Remove
                    </button>
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Pattern legend */}
          <div style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 10, padding: '14px 22px', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 11, color: colors.textMuted, fontWeight: 600, marginRight: 8, letterSpacing: '0.06em', textTransform: 'uppercase', fontFamily: font }}>Pattern Legend</span>
            {Object.entries(PATTERN_META).map(([key, meta]) => (
              <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: meta.color, background: meta.bg, border: `1px solid ${meta.border}`, borderRadius: 4, padding: '2px 8px', fontFamily: font }}>{meta.label}</span>
                <span style={{ fontSize: 11, color: colors.textMuted, fontFamily: font }}>{meta.tip}</span>
                <span style={{ color: colors.border, marginLeft: 4 }}>·</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          TAB: FIELD INTEL
      ══════════════════════════════════════════════════════════════════════ */}
      {!noData && activeTab === 'intel' && (
        <div style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderTop: 'none', borderRadius: '0 0 12px 12px', overflow: 'hidden' }}>
          <div style={{ padding: '18px 22px 16px' }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: colors.text, marginBottom: 2, fontFamily: font }}>Field Intel Feed</div>
            <div style={{ fontSize: 12, color: colors.textMuted, fontFamily: font }}>
              Raw quotes extracted from call transcripts · ranked by confidence
              {selectedCompetitor && <span style={{ color: colors.purple }}> · {anon.company(selectedCompetitor)} only</span>}
            </div>
          </div>
          <div style={{ padding: '0 22px 22px', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(480px, 1fr))', gap: 12 }}>
            {loading && [0,1,2,3].map(i => (
              <div key={i} style={{ background: colors.surfaceRaised, border: `1px solid ${colors.borderLight}`, borderRadius: 9, padding: '14px 16px', borderLeft: `3px solid ${colors.border}` }}>
                <SkeletonBlock h={10} w="60%" /><div style={{ marginTop: 10 }}><SkeletonBlock h={10} w="100%" /></div><div style={{ marginTop: 6 }}><SkeletonBlock h={10} w="85%" /></div>
              </div>
            ))}
            {!loading && filteredFeed.map((item, i) => {
              const comp = data?.competitors.find(c => c.name.toLowerCase() === item.competitor_name.toLowerCase());
              const pMeta = comp?.pattern ? PATTERN_META[comp.pattern] : null;
              const score = Math.round(item.confidence_score * 100);
              const scoreColor = score >= 90 ? colors.green : score >= 75 ? colors.yellow : colors.textMuted;
              return (
                <div key={i} style={{ background: colors.surfaceRaised, border: `1px solid ${colors.borderLight}`, borderRadius: 9, padding: '14px 16px', borderLeft: pMeta ? `3px solid ${pMeta.color}` : `3px solid ${colors.accent}` }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
                    <button onClick={() => { toggleCompetitor(item.competitor_name); setActiveTab('competitors'); }} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: 12, fontWeight: 700, color: pMeta?.color ?? colors.accent, fontFamily: font }}>{anon.company(item.competitor_name)}</button>
                    <span style={{ fontSize: 11, color: colors.textMuted }}>→</span>
                    <span style={{ fontSize: 12, color: colors.textSecondary, fontWeight: 500, fontFamily: font }}>{item.deal_name}</span>
                    <span style={{ marginLeft: 'auto', fontSize: 11, color: colors.textMuted, fontFamily: font }}>{formatDate(item.created_at)}{item.owner_email ? ` · ${item.owner_email.split('@')[0]}` : ''}</span>
                    <span style={{ fontSize: 11, fontFamily: mono, fontWeight: 700, color: scoreColor, background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 4, padding: '1px 7px' }}>{score}</span>
                  </div>
                  <p style={{ margin: 0, fontSize: 13, lineHeight: 1.55, color: colors.textSecondary, fontStyle: 'italic', fontFamily: font }}>"{item.source_quote}"</p>
                </div>
              );
            })}
            {!loading && filteredFeed.length === 0 && (
              <div style={{ gridColumn: '1 / -1', textAlign: 'center', color: colors.textMuted, fontSize: 13, padding: '32px 0', fontFamily: font }}>
                {selectedCompetitor ? `No intel found for ${anon.company(selectedCompetitor)}` : 'No call transcripts with competitor mentions'}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
