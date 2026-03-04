import { useState, useEffect } from 'react';
import { api } from '../../lib/api';
import { useWorkspace } from '../../context/WorkspaceContext';

const C = {
  bg: '#06080c',
  bgSidebar: '#0a0d14',
  surface: '#0f1219',
  surfaceRaised: '#141820',
  surfaceHover: '#1a1f2a',
  surfaceActive: '#1e2436',
  border: '#1a1f2b',
  borderLight: '#242b3a',
  text: '#e8ecf4',
  textSecondary: '#94a3b8',
  textMuted: '#5a6578',
  textDim: '#3a4252',
  accent: '#3b82f6',
  accentSoft: 'rgba(59,130,246,0.12)',
  green: '#22c55e',
  greenSoft: 'rgba(34,197,94,0.1)',
  greenBorder: 'rgba(34,197,94,0.25)',
  yellow: '#eab308',
  yellowSoft: 'rgba(234,179,8,0.1)',
  yellowBorder: 'rgba(234,179,8,0.25)',
  red: '#ef4444',
  redSoft: 'rgba(239,68,68,0.1)',
  redBorder: 'rgba(239,68,68,0.25)',
  purple: '#a78bfa',
  purpleSoft: 'rgba(167,139,250,0.1)',
  orange: '#f97316',
  orangeSoft: 'rgba(249,115,22,0.1)',
  cyan: '#06b6d4',
  cyanSoft: 'rgba(6,182,212,0.1)',
};

const font = "'IBM Plex Sans', -apple-system, sans-serif";
const mono = "'IBM Plex Mono', monospace";

type CompetitorPattern =
  | 'displacement_threat'
  | 'pricing_pressure'
  | 'feature_gap'
  | 'emerging_threat'
  | 'declining_threat'
  | 'segment_specific';

const PATTERN_META: Record<string, { label: string; color: string; bg: string; border: string; tip: string }> = {
  displacement_threat: { label: 'Displacement Threat', color: C.red,    bg: C.redSoft,    border: C.redBorder,    tip: 'Actively replacing your product in existing accounts' },
  pricing_pressure:   { label: 'Pricing Pressure',    color: C.orange,  bg: C.orangeSoft, border: 'rgba(249,115,22,0.25)', tip: 'Driving discounting behavior and budget conversations' },
  feature_gap:        { label: 'Feature Gap',          color: C.yellow,  bg: C.yellowSoft, border: C.yellowBorder, tip: 'Winning on specific capability your product lacks' },
  emerging_threat:    { label: 'Emerging Threat',      color: C.purple,  bg: C.purpleSoft, border: 'rgba(167,139,250,0.25)', tip: 'Appearing more frequently — watch for acceleration' },
  declining_threat:   { label: 'Declining',            color: C.green,   bg: C.greenSoft,  border: C.greenBorder,  tip: 'Mention frequency and win-rate impact both decreasing' },
  segment_specific:   { label: 'Segment-Specific',     color: C.cyan,    bg: C.cyanSoft,   border: 'rgba(6,182,212,0.25)', tip: 'Dominant in one ICP segment but not broadly threatening' },
};

interface Competitor {
  name: string;
  deal_count: number;
  win_rate: number;
  delta: number;
  trend: 'up' | 'down' | 'stable';
  mention_trend: string;
  pattern: CompetitorPattern | null;
}

interface OpenDeal {
  deal_id: string;
  deal_name: string;
  competitor_name: string;
  amount: number;
  stage: string;
  owner_email: string;
  mention_count: number;
  last_mention_at: string;
  risk: 'high' | 'med' | 'low';
}

interface FieldIntel {
  competitor_name: string;
  deal_name: string;
  owner_email: string;
  source_quote: string;
  confidence_score: number;
  created_at: string;
}

interface PageData {
  last_run_at: string | null;
  competitors_tracked: number;
  baseline_win_rate: number;
  mention_change_pct: number | null;
  pipeline_at_risk: number;
  high_risk_pipeline: number;
  hardest_competitor: string | null;
  hardest_competitor_delta: number | null;
  competitors: Competitor[];
  open_deals: OpenDeal[];
  field_intel: FieldIntel[];
  exclusions: string[];
}

type SortOption = 'Deal Value' | 'Risk' | 'Last Mention';
const SORT_OPTIONS: SortOption[] = ['Deal Value', 'Risk', 'Last Mention'];
const RISK_ORDER = { high: 0, med: 1, low: 2 };

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch { return iso; }
}

function formatTimeAgo(iso: string): string {
  try {
    const diff = Date.now() - new Date(iso).getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    if (days === 0) return 'today';
    if (days === 1) return '1d ago';
    return `${days}d ago`;
  } catch { return '—'; }
}

function formatCurrency(amount: number): string {
  if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(1)}M`;
  if (amount >= 1_000) return `$${Math.round(amount / 1_000)}K`;
  return `$${Math.round(amount)}`;
}

function ShieldIcon({ size = 15, color = C.purple }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z" />
    </svg>
  );
}

function PatternBadge({ pattern, showTooltip = true }: { pattern: string | null; showTooltip?: boolean }) {
  const [hovered, setHovered] = useState(false);
  if (!pattern) return <span style={{ fontSize: 11, color: C.textMuted }}>—</span>;
  const meta = PATTERN_META[pattern] ?? { label: pattern, color: C.textMuted, bg: C.surface, border: C.border, tip: '' };
  return (
    <div style={{ position: 'relative', display: 'inline-block' }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}>
      <span style={{
        fontSize: 11, fontWeight: 600, letterSpacing: '0.03em',
        color: meta.color, background: meta.bg,
        border: `1px solid ${meta.border}`,
        borderRadius: 4, padding: '2px 8px',
        fontFamily: font, whiteSpace: 'nowrap',
        cursor: 'default',
      }}>{meta.label}</span>
      {showTooltip && hovered && meta.tip && (
        <div style={{
          position: 'absolute', bottom: 'calc(100% + 6px)', left: '50%',
          transform: 'translateX(-50%)',
          background: C.surfaceRaised, border: `1px solid ${C.borderLight}`,
          borderRadius: 6, padding: '6px 10px',
          fontSize: 12, color: C.textSecondary, fontFamily: font,
          whiteSpace: 'nowrap', zIndex: 100,
          boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
          pointerEvents: 'none',
        }}>{meta.tip}</div>
      )}
    </div>
  );
}

function TrendArrow({ trend }: { trend: 'up' | 'down' | 'stable' }) {
  if (trend === 'up')   return <span style={{ color: C.red,   fontSize: 14 }}>↑</span>;
  if (trend === 'down') return <span style={{ color: C.green, fontSize: 14 }}>↓</span>;
  return <span style={{ color: C.textMuted, fontSize: 14 }}>→</span>;
}

function Delta({ value }: { value: number }) {
  const color = value > 0 ? C.green : value < 0 ? C.red : C.textMuted;
  const sign  = value > 0 ? '+' : '';
  return <span style={{ color, fontFamily: mono, fontSize: 13, fontWeight: 600 }}>{sign}{value}pp</span>;
}

function RiskDot({ risk }: { risk: 'high' | 'med' | 'low' }) {
  const color = risk === 'high' ? C.red : risk === 'med' ? C.yellow : C.green;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      fontSize: 12, color, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase',
    }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: color, boxShadow: `0 0 5px ${color}88`, flexShrink: 0 }} />
      {risk}
    </span>
  );
}

function StatCard({ label, value, sub, valueColor, accent }: { label: string; value: string; sub?: string; valueColor?: string; accent?: string }) {
  return (
    <div style={{
      flex: 1, minWidth: 0,
      background: C.surface, border: `1px solid ${C.border}`,
      borderRadius: 10, padding: '18px 22px',
      borderTop: accent ? `2px solid ${accent}` : undefined,
    }}>
      <div style={{ fontSize: 11, color: C.textMuted, fontFamily: font, fontWeight: 600, marginBottom: 6, letterSpacing: '0.06em', textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 700, color: valueColor ?? C.text, fontFamily: font, lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: C.textMuted, fontFamily: font, marginTop: 5 }}>{sub}</div>}
    </div>
  );
}

function SkeletonBlock({ w = '100%', h = 18, radius = 4 }: { w?: string | number; h?: number; radius?: number }) {
  return (
    <div style={{
      width: w, height: h, borderRadius: radius,
      background: `linear-gradient(90deg, ${C.surfaceRaised} 25%, ${C.surfaceHover} 50%, ${C.surfaceRaised} 75%)`,
      backgroundSize: '200% 100%',
      animation: 'shimmer 1.5s infinite',
    }} />
  );
}

export default function CompetitiveIntelligencePage() {
  const { currentWorkspace } = useWorkspace();
  const workspaceId = currentWorkspace?.id;

  const [data, setData] = useState<PageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedCompetitor, setSelectedCompetitor] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<SortOption>('Deal Value');
  const [running, setRunning] = useState(false);
  const [runMessage, setRunMessage] = useState<string | null>(null);
  const [exclusions, setExclusions] = useState<string[]>([]);
  const [excludeHover, setExcludeHover] = useState<string | null>(null);

  const loadData = () => {
    if (!workspaceId) return;
    setLoading(true);
    setError(null);
    api.get('/intelligence/competitive')
      .then((res: any) => {
        setData(res);
        setExclusions(res.exclusions ?? []);
      })
      .catch((err: any) => { setError(err.message ?? 'Failed to load data'); })
      .finally(() => setLoading(false));
  };

  useEffect(() => { loadData(); }, [workspaceId]);

  const runAnalysis = async () => {
    if (running) return;
    setRunning(true);
    setRunMessage(null);
    try {
      await api.post('/skills/competitive-intelligence/run', {});
      setRunMessage('Analysis complete — refreshing data');
      loadData();
    } catch (err: any) {
      setRunMessage(err.message ?? 'Run failed');
    } finally {
      setRunning(false);
    }
  };

  const toggleCompetitor = (name: string) => {
    setSelectedCompetitor(prev => prev === name ? null : name);
  };

  const excludeCompetitor = (name: string) => {
    const key = name.toLowerCase().trim();
    setExclusions(prev => prev.includes(key) ? prev : [...prev, key]);
    if (selectedCompetitor?.toLowerCase() === key) setSelectedCompetitor(null);
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
    if (sortBy === 'Deal Value') return deals.sort((a, b) => b.amount - a.amount);
    if (sortBy === 'Risk') return deals.sort((a, b) => RISK_ORDER[a.risk] - RISK_ORDER[b.risk]);
    if (sortBy === 'Last Mention') return deals.sort((a, b) => new Date(b.last_mention_at).getTime() - new Date(a.last_mention_at).getTime());
    return deals;
  })();

  const filteredFeed = (data
    ? (selectedCompetitor ? data.field_intel.filter(f => f.competitor_name === selectedCompetitor) : data.field_intel)
    : []
  ).filter(f => !isExcluded(f.competitor_name));

  const noData = !loading && data && data.competitors.length === 0 && data.field_intel.length === 0;

  return (
    <div style={{ background: C.bg, minHeight: '100vh', fontFamily: font, color: C.text, padding: '28px 32px' }}>
      <style>{`
        @keyframes shimmer {
          0%   { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>

      {/* ── Page Header ───────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 28 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
            <div style={{
              width: 28, height: 28, borderRadius: 7,
              background: 'rgba(167,139,250,0.15)', border: '1px solid rgba(167,139,250,0.3)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <ShieldIcon size={15} color={C.purple} />
            </div>
            <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0, color: C.text, fontFamily: font }}>Competitive Intelligence</h1>
          </div>
          <div style={{ fontSize: 13, color: C.textMuted, fontFamily: font }}>
            {data?.last_run_at
              ? <>Last analyzed <strong style={{ color: C.textSecondary }}>{formatDate(data.last_run_at)}</strong> · 90-day trailing window · {data.competitors_tracked} competitor{data.competitors_tracked !== 1 ? 's' : ''} tracked</>
              : loading ? 'Loading…' : 'No analysis run yet · 90-day trailing window'}
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {selectedCompetitor && (
              <button onClick={() => setSelectedCompetitor(null)} style={{
                background: C.surfaceRaised, border: `1px solid ${C.borderLight}`,
                color: C.textSecondary, fontSize: 13, padding: '7px 14px',
                borderRadius: 7, cursor: 'pointer', fontFamily: font,
              }}>
                Clear filter
              </button>
            )}
            <button
              onClick={runAnalysis}
              disabled={running}
              style={{
                background: running ? C.surfaceRaised : C.accentSoft,
                border: `1px solid ${running ? C.borderLight : C.accent}`,
                color: running ? C.textMuted : C.accent,
                fontSize: 13, fontWeight: 600, padding: '7px 14px',
                borderRadius: 7, cursor: running ? 'not-allowed' : 'pointer',
                fontFamily: font, display: 'flex', alignItems: 'center', gap: 6,
                transition: 'all 0.15s',
              }}
            >
              {running && (
                <span style={{
                  width: 10, height: 10, borderRadius: '50%',
                  border: `2px solid ${C.accent}`, borderTopColor: 'transparent',
                  animation: 'spin 0.7s linear infinite', display: 'inline-block',
                }} />
              )}
              {running ? 'Running…' : '▶ Run Analysis'}
            </button>
            <div style={{
              background: C.surfaceRaised, border: `1px solid ${C.borderLight}`,
              borderRadius: 7, padding: '7px 13px',
              fontSize: 12, color: C.textMuted, display: 'flex', alignItems: 'center', gap: 6,
              fontFamily: font,
            }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: C.green, boxShadow: `0 0 5px ${C.green}88` }} />
              Auto-runs 1st of each month
            </div>
          </div>
          {runMessage && (
            <div style={{
              fontSize: 12, color: runMessage.includes('failed') || runMessage.includes('Failed') ? C.red : C.green,
              fontFamily: font,
            }}>
              {runMessage}
            </div>
          )}
        </div>
      </div>

      {/* ── Error ─────────────────────────────────────────────────────────── */}
      {error && (
        <div style={{ background: C.redSoft, border: `1px solid ${C.redBorder}`, borderRadius: 8, padding: '12px 18px', marginBottom: 24, fontSize: 13, color: C.red, fontFamily: font }}>
          {error}
        </div>
      )}

      {/* ── KPI Strip ─────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 14, marginBottom: 28 }}>
        {loading ? (
          <>
            {[0,1,2,3].map(i => (
              <div key={i} style={{ flex: 1, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: '18px 22px' }}>
                <SkeletonBlock h={10} w="60%" />
                <div style={{ marginTop: 10 }}><SkeletonBlock h={28} w="50%" /></div>
                <div style={{ marginTop: 8 }}><SkeletonBlock h={10} w="80%" /></div>
              </div>
            ))}
          </>
        ) : (
          <>
            <StatCard
              label="Baseline win rate"
              value={data ? `${data.baseline_win_rate}%` : '—'}
              sub="Deals with no competitors"
              accent={C.green}
            />
            <StatCard
              label="Open pipeline at risk"
              value={data ? formatCurrency(data.pipeline_at_risk) : '—'}
              sub={data ? `${formatCurrency(data.high_risk_pipeline)} flagged high-risk` : undefined}
              valueColor={C.red}
              accent={C.red}
            />
            <StatCard
              label="Hardest to beat"
              value={data?.hardest_competitor ?? '—'}
              sub={data?.hardest_competitor_delta != null ? `${data.hardest_competitor_delta > 0 ? '+' : ''}${data.hardest_competitor_delta}pp vs. baseline` : 'No data yet'}
              valueColor={C.red}
              accent={C.purple}
            />
            <StatCard
              label="Competitor mentions"
              value={data?.mention_change_pct != null ? `${data.mention_change_pct > 0 ? '+' : ''}${data.mention_change_pct}%` : 'First run'}
              sub="vs. prior 90-day period"
              valueColor={C.orange}
              accent={C.orange}
            />
          </>
        )}
      </div>

      {/* ── No-data empty state ────────────────────────────────────────────── */}
      {noData && (
        <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: '48px 32px', textAlign: 'center', marginBottom: 16 }}>
          <ShieldIcon size={32} color={C.textDim} />
          <div style={{ fontSize: 15, fontWeight: 600, color: C.textSecondary, marginTop: 16, marginBottom: 8, fontFamily: font }}>No competitive data yet</div>
          <div style={{ fontSize: 13, color: C.textMuted, maxWidth: 420, margin: '0 auto', lineHeight: 1.6, fontFamily: font }}>
            The Competitive Intelligence skill runs automatically on the 1st of each month. It can also be triggered manually from the Skills page.
          </div>
        </div>
      )}

      {/* ── Main sections ─────────────────────────────────────────────────── */}
      {!noData && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>

          {/* Open Deal Exposure — full width */}
          <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden', gridColumn: '1 / -1' }}>
            <div style={{ padding: '18px 22px 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600, color: C.text, marginBottom: 2, fontFamily: font }}>Open Deal Exposure</div>
                <div style={{ fontSize: 12, color: C.textMuted, fontFamily: font }}>
                  {loading ? 'Loading…' : `${sortedDeals.length} open deal${sortedDeals.length !== 1 ? 's' : ''} with competitor mentions · sorted by ${sortBy.toLowerCase()}`}
                  {selectedCompetitor && <span style={{ color: C.purple }}> · filtered to {selectedCompetitor}</span>}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                {SORT_OPTIONS.map(s => (
                  <button key={s} onClick={() => setSortBy(s)} style={{
                    background: sortBy === s ? C.accentSoft : 'transparent',
                    border: `1px solid ${sortBy === s ? C.accent : C.border}`,
                    color: sortBy === s ? C.accent : C.textMuted,
                    fontSize: 12, padding: '5px 11px', borderRadius: 6,
                    cursor: 'pointer', fontFamily: font,
                  }}>{s}</button>
                ))}
              </div>
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 14 }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                  {[
                    { label: 'Deal', pad: '8px 22px' },
                    { label: 'Competitor', pad: '8px 22px' },
                    { label: 'Amount', pad: '8px 14px' },
                    { label: 'Stage', pad: '8px 22px' },
                    { label: 'Mentions', pad: '8px 14px' },
                    { label: 'Last Mention', pad: '8px 14px' },
                    { label: 'Risk', pad: '8px 22px' },
                  ].map(h => (
                    <th key={h.label} style={{ padding: h.pad, textAlign: 'left', fontSize: 11, fontWeight: 600, color: C.textMuted, letterSpacing: '0.06em', textTransform: 'uppercase', fontFamily: font, whiteSpace: 'nowrap' }}>{h.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading && (
                  [0,1,2,3].map(i => (
                    <tr key={i} style={{ borderBottom: `1px solid ${C.border}` }}>
                      {[0,1,2,3,4,5,6].map(j => (
                        <td key={j} style={{ padding: '13px 22px' }}>
                          <SkeletonBlock h={12} w={j === 0 ? '120px' : j === 2 ? '60px' : '80px'} />
                        </td>
                      ))}
                    </tr>
                  ))
                )}
                {!loading && sortedDeals.map((d, i) => (
                  <tr key={`${d.deal_id}-${d.competitor_name}`}
                    style={{ borderBottom: `1px solid ${C.border}`, transition: 'background 0.15s' }}
                    onMouseEnter={e => (e.currentTarget.style.background = C.surfaceHover)}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                    <td style={{ padding: '11px 22px', fontSize: 13, fontWeight: 500, color: C.text, fontFamily: font }}>{d.deal_name}</td>
                    <td style={{ padding: '11px 22px' }}>
                      <button onClick={() => toggleCompetitor(d.competitor_name)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontFamily: font, textAlign: 'left', display: 'block' }}>
                        <span style={{ fontSize: 13, color: C.accent, fontWeight: 600 }}>{d.competitor_name}</span>
                      </button>
                    </td>
                    <td style={{ padding: '11px 14px', fontSize: 13, fontFamily: mono, color: C.text, fontWeight: 600, whiteSpace: 'nowrap' }}>{formatCurrency(d.amount)}</td>
                    <td style={{ padding: '11px 22px' }}>
                      <span style={{ fontSize: 12, color: C.textSecondary, background: C.surfaceRaised, border: `1px solid ${C.border}`, borderRadius: 4, padding: '2px 8px', fontFamily: font }}>{d.stage}</span>
                    </td>
                    <td style={{ padding: '11px 14px', fontSize: 13, fontFamily: mono, color: C.textSecondary }}>{d.mention_count}</td>
                    <td style={{ padding: '11px 14px', fontSize: 13, color: C.textMuted, fontFamily: font, whiteSpace: 'nowrap' }}>{formatTimeAgo(d.last_mention_at)}</td>
                    <td style={{ padding: '11px 22px' }}><RiskDot risk={d.risk} /></td>
                  </tr>
                ))}
                {!loading && sortedDeals.length === 0 && (
                  <tr>
                    <td colSpan={7} style={{ padding: '32px 22px', textAlign: 'center', color: C.textMuted, fontSize: 13, fontFamily: font }}>
                      {selectedCompetitor ? `No open deals with ${selectedCompetitor} mentions` : 'No open deals with competitor mentions'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Competitor Leaderboard */}
          <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden' }}>
            <div style={{ padding: '18px 22px 0' }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: C.text, marginBottom: 2, fontFamily: font }}>Competitor Leaderboard</div>
              <div style={{ fontSize: 12, color: C.textMuted, fontFamily: font }}>
                Win rate vs. your{' '}
                <span style={{ color: C.green, fontWeight: 600 }}>{data?.baseline_win_rate ?? '—'}% baseline</span>
                {' '}· click to filter
              </div>
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 14 }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                  {['Competitor', 'Deals', 'Win Rate', 'vs. Baseline', 'Trend', 'Pattern', ''].map(h => (
                    <th key={h} style={{ padding: '8px 16px', textAlign: 'left', fontSize: 11, fontWeight: 600, color: C.textMuted, letterSpacing: '0.06em', textTransform: 'uppercase', fontFamily: font, whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading && [0,1,2,3].map(i => (
                  <tr key={i} style={{ borderBottom: `1px solid ${C.border}` }}>
                    {[0,1,2,3,4,5,6].map(j => (
                      <td key={j} style={{ padding: '13px 16px' }}><SkeletonBlock h={12} w={j === 0 ? '80px' : '50px'} /></td>
                    ))}
                  </tr>
                ))}
                {!loading && visibleCompetitors.map((c) => (
                  <tr key={c.name}
                    onClick={() => toggleCompetitor(c.name)}
                    style={{
                      borderBottom: `1px solid ${C.border}`, cursor: 'pointer',
                      background: selectedCompetitor === c.name ? C.surfaceActive : 'transparent',
                      transition: 'background 0.15s',
                    }}
                    onMouseEnter={e => { if (selectedCompetitor !== c.name) e.currentTarget.style.background = C.surfaceHover; setExcludeHover(c.name); }}
                    onMouseLeave={e => { if (selectedCompetitor !== c.name) e.currentTarget.style.background = 'transparent'; setExcludeHover(null); }}>
                    <td style={{ padding: '11px 16px', fontSize: 13, fontWeight: 600, color: C.text, fontFamily: font }}>{c.name}</td>
                    <td style={{ padding: '11px 16px', fontSize: 13, fontFamily: mono, color: C.textSecondary }}>{c.deal_count}</td>
                    <td style={{ padding: '11px 16px', fontSize: 13, fontFamily: mono, fontWeight: 600, color: c.win_rate < 50 ? C.red : C.green }}>{c.win_rate}%</td>
                    <td style={{ padding: '11px 16px' }}><Delta value={c.delta} /></td>
                    <td style={{ padding: '11px 16px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <TrendArrow trend={c.trend} />
                        <span style={{ fontSize: 11, color: C.textMuted, fontFamily: mono }}>{c.mention_trend}</span>
                      </div>
                    </td>
                    <td style={{ padding: '11px 16px' }}><PatternBadge pattern={c.pattern} /></td>
                    <td style={{ padding: '11px 16px', textAlign: 'right', width: 80 }}>
                      {excludeHover === c.name && (
                        <button
                          onClick={e => { e.stopPropagation(); excludeCompetitor(c.name); }}
                          onMouseEnter={e => (e.currentTarget.style.color = C.red)}
                          onMouseLeave={e => (e.currentTarget.style.color = C.textMuted)}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: C.textMuted, fontFamily: font, padding: '2px 6px', borderRadius: 4, transition: 'color 0.15s' }}>
                          ⊘ Exclude
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {!loading && visibleCompetitors.length === 0 && (
                  <tr>
                    <td colSpan={7} style={{ padding: '32px 16px', textAlign: 'center', fontSize: 13, color: C.textMuted, fontFamily: font }}>
                      No competitive data yet. The skill runs on the 1st of each month.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Exclusions panel */}
          {exclusions.length > 0 && (
            <div style={{ background: C.surfaceRaised, border: `1px solid ${C.borderLight}`, borderRadius: 10, padding: '10px 18px', display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
              <span style={{ fontSize: 11, color: C.textMuted, fontFamily: font, fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', marginRight: 4, whiteSpace: 'nowrap' }}>Excluded from analysis</span>
              {exclusions.map(key => (
                <span key={key} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 6, padding: '3px 10px' }}>
                  <span style={{ fontSize: 12, color: C.textSecondary, fontFamily: font, fontWeight: 500, textTransform: 'capitalize' }}>{key}</span>
                  <button
                    onClick={() => restoreCompetitor(key)}
                    onMouseEnter={e => (e.currentTarget.style.color = C.accent)}
                    onMouseLeave={e => (e.currentTarget.style.color = C.textMuted)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: C.textMuted, fontFamily: font, padding: 0, transition: 'color 0.15s', lineHeight: 1 }}>
                    ↩ Restore
                  </button>
                </span>
              ))}
            </div>
          )}

          {/* Field Intel Feed */}
          <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden' }}>
            <div style={{ padding: '18px 22px 16px' }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: C.text, marginBottom: 2, fontFamily: font }}>Field Intel Feed</div>
              <div style={{ fontSize: 12, color: C.textMuted, fontFamily: font }}>
                Raw quotes from call transcripts · ranked by confidence
                {selectedCompetitor && <span style={{ color: C.purple }}> · {selectedCompetitor} only</span>}
              </div>
            </div>
            <div style={{ padding: '0 22px 22px', display: 'flex', flexDirection: 'column', gap: 12 }}>
              {loading && [0,1,2].map(i => (
                <div key={i} style={{ background: C.surfaceRaised, border: `1px solid ${C.borderLight}`, borderRadius: 9, padding: '14px 16px', borderLeft: `3px solid ${C.border}` }}>
                  <SkeletonBlock h={10} w="60%" />
                  <div style={{ marginTop: 10 }}><SkeletonBlock h={10} w="100%" /></div>
                  <div style={{ marginTop: 6 }}><SkeletonBlock h={10} w="85%" /></div>
                </div>
              ))}
              {!loading && filteredFeed.map((item, i) => {
                const comp = data?.competitors.find(c => c.name.toLowerCase() === item.competitor_name.toLowerCase());
                const pMeta = comp?.pattern ? PATTERN_META[comp.pattern] : null;
                const score = Math.round(item.confidence_score * 100);
                const scoreColor = score >= 90 ? C.green : score >= 75 ? C.yellow : C.textMuted;
                return (
                  <div key={i} style={{
                    background: C.surfaceRaised, border: `1px solid ${C.borderLight}`,
                    borderRadius: 9, padding: '14px 16px',
                    borderLeft: pMeta ? `3px solid ${pMeta.color}` : `3px solid ${C.accent}`,
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 12, fontWeight: 700, color: pMeta?.color ?? C.accent, fontFamily: font }}>{item.competitor_name}</span>
                      <span style={{ fontSize: 11, color: C.textMuted }}>→</span>
                      <span style={{ fontSize: 12, color: C.textSecondary, fontWeight: 500, fontFamily: font }}>{item.deal_name}</span>
                      <span style={{ marginLeft: 'auto', fontSize: 11, color: C.textMuted, fontFamily: font }}>
                        {formatDate(item.created_at)}{item.owner_email ? ` · ${item.owner_email.split('@')[0]}` : ''}
                      </span>
                      <span style={{
                        fontSize: 11, fontFamily: mono, fontWeight: 700,
                        color: scoreColor,
                        background: C.surface, border: `1px solid ${C.border}`,
                        borderRadius: 4, padding: '1px 7px',
                      }}>{score}</span>
                    </div>
                    <p style={{ margin: 0, fontSize: 13, lineHeight: 1.55, color: C.textSecondary, fontStyle: 'italic', fontFamily: font }}>
                      "{item.source_quote}"
                    </p>
                  </div>
                );
              })}
              {!loading && filteredFeed.length === 0 && (
                <div style={{ textAlign: 'center', color: C.textMuted, fontSize: 13, padding: '32px 0', fontFamily: font }}>
                  {selectedCompetitor ? `No intel found for ${selectedCompetitor}` : 'No call transcripts with competitor mentions'}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Pattern Legend ─────────────────────────────────────────────────── */}
      <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: '14px 22px', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 11, color: C.textMuted, fontWeight: 600, marginRight: 8, letterSpacing: '0.06em', textTransform: 'uppercase', fontFamily: font }}>Pattern Legend</span>
        {Object.entries(PATTERN_META).map(([key, meta]) => (
          <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{
              fontSize: 11, fontWeight: 600, color: meta.color,
              background: meta.bg, border: `1px solid ${meta.border}`,
              borderRadius: 4, padding: '2px 8px', fontFamily: font,
            }}>{meta.label}</span>
            <span style={{ fontSize: 11, color: C.textMuted, fontFamily: font }}>{meta.tip}</span>
            <span style={{ color: C.border, marginLeft: 4 }}>·</span>
          </div>
        ))}
      </div>
    </div>
  );
}
