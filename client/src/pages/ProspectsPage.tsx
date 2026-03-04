import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../lib/api';
import { colors, fonts } from '../styles/theme';

// ── Constants ─────────────────────────────────────────────────────────────────

const GRADE_COLORS: Record<string, string> = {
  A: '#10b981', B: '#3b82f6', C: '#f59e0b', D: '#f97316', F: '#ef4444',
};
const ACTION_LABELS: Record<string, string> = {
  prospect: 'Create Opportunity',
  reengage: 'Re-engage',
  multi_thread: 'Multi-Thread',
  nurture: 'Nurture',
  disqualify: 'Disqualify',
};
const ACTION_COLORS: Record<string, string> = {
  prospect: '#10b981', reengage: '#f59e0b', multi_thread: '#8b5cf6',
  nurture: '#6366f1', disqualify: '#ef4444',
};
const CATEGORY_COLORS: Record<string, string> = {
  fit: '#3b82f6', engagement: '#10b981', intent: '#f59e0b', timing: '#8b5cf6',
};
const CATEGORY_LABELS: Record<string, string> = {
  fit: 'Fit', engagement: 'Engagement', intent: 'Intent', timing: 'Timing',
};

// ── Sub-components ────────────────────────────────────────────────────────────

function ScoreRing({ score, size = 48, stroke = 4, grade }: {
  score: number; size?: number; stroke?: number; grade: string;
}) {
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ - (Math.max(0, Math.min(score, 100)) / 100) * circ;
  const c = GRADE_COLORS[grade] || '#6b7280';
  return (
    <svg width={size} height={size} style={{ transform: 'rotate(-90deg)', flexShrink: 0 }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={colors.surfaceRaised} strokeWidth={stroke} />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={c} strokeWidth={stroke}
        strokeDasharray={circ} strokeDashoffset={offset} strokeLinecap="round"
        style={{ transition: 'stroke-dashoffset 0.8s ease' }} />
      <text x={size / 2} y={size / 2} textAnchor="middle" dominantBaseline="central"
        fill={c} fontSize={size * 0.3} fontWeight="700" fontFamily={fonts.mono || 'monospace'}
        style={{ transform: 'rotate(90deg)', transformOrigin: 'center' }}>
        {score}
      </text>
    </svg>
  );
}

function ComponentBar({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{ marginBottom: 6 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
        <span style={{ fontSize: 11, color: colors.textMuted, fontWeight: 600, letterSpacing: '0.05em', fontFamily: fonts.sans }}>{label}</span>
        <span style={{ fontSize: 11, color, fontWeight: 700, fontFamily: fonts.mono }}>{value}</span>
      </div>
      <div style={{ height: 4, background: colors.surfaceRaised, borderRadius: 2, overflow: 'hidden' }}>
        <div style={{ width: `${Math.max(0, Math.min(value, 100))}%`, height: '100%', background: color, borderRadius: 2, transition: 'width 0.6s ease' }} />
      </div>
    </div>
  );
}

function FactorRow({ factor, maxContrib }: { factor: any; maxContrib: number }) {
  const isPos = factor.direction === 'positive';
  const barColor = isPos ? '#10b981' : '#ef4444';
  const barWidth = maxContrib > 0 ? (Math.abs(factor.contribution) / maxContrib) * 100 : 0;
  const catColor = CATEGORY_COLORS[factor.category] || '#6b7280';
  return (
    <div style={{ padding: '10px 0', borderBottom: `1px solid ${colors.border}` }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{
            fontSize: 9, fontWeight: 700, color: catColor, textTransform: 'uppercase',
            letterSpacing: '0.08em', background: `${catColor}18`, padding: '2px 6px', borderRadius: 3,
            fontFamily: fonts.sans,
          }}>
            {CATEGORY_LABELS[factor.category]}
          </span>
          <span style={{ fontSize: 13, fontWeight: 600, color: colors.text, fontFamily: fonts.sans }}>{factor.label}</span>
        </div>
        <span style={{ fontSize: 13, fontWeight: 700, color: barColor, fontFamily: fonts.mono, whiteSpace: 'nowrap' }}>
          {isPos ? '+' : '−'}{Math.abs(factor.contribution)} pts
        </span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 5 }}>
        <div style={{ flex: 1, height: 6, background: colors.surfaceRaised, borderRadius: 3, overflow: 'hidden' }}>
          <div style={{ width: `${barWidth}%`, height: '100%', background: barColor, opacity: 0.85, borderRadius: 3, transition: 'width 0.4s ease' }} />
        </div>
        <span style={{ fontSize: 11, color: colors.textMuted, minWidth: 60, textAlign: 'right', fontFamily: fonts.sans }}>
          of {factor.max_possible} max
        </span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
        <span style={{ fontSize: 11, color: colors.textMuted }}>Value:</span>
        <span style={{ fontSize: 11, color: colors.text, fontWeight: 500 }}>{factor.value}</span>
      </div>
      {factor.benchmark && (
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          <div style={{ fontSize: 10, color: colors.textMuted }}>
            Pop. avg: <span style={{ color: colors.textSecondary, fontWeight: 600 }}>{factor.benchmark.population_avg}</span>
          </div>
          <div style={{ fontSize: 10, color: colors.textMuted }}>
            Percentile: <span style={{ color: colors.textSecondary, fontWeight: 600 }}>{factor.benchmark.percentile}th</span>
          </div>
          <div style={{ fontSize: 10, color: colors.textMuted }}>
            Won-deal avg: <span style={{ color: '#10b981', fontWeight: 600 }}>{factor.benchmark.won_deal_avg}</span>
          </div>
        </div>
      )}
      {factor.explanation && (
        <p style={{ fontSize: 11, color: colors.textMuted, margin: '5px 0 0', lineHeight: 1.5, fontStyle: 'italic', fontFamily: fonts.sans }}>
          {factor.explanation}
        </p>
      )}
    </div>
  );
}

function ProspectRow({ p, onSelect }: { p: any; onSelect: (p: any) => void }) {
  const [hovered, setHovered] = useState(false);
  const change = p.score_change;
  return (
    <div
      onClick={() => onSelect(p)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex', alignItems: 'center', padding: '12px 16px',
        borderBottom: `1px solid ${colors.border}`, cursor: 'pointer',
        background: hovered ? (colors.surfaceHover || '#1a2744') : (colors.surface || '#0f172a'),
        transition: 'background 0.12s', gap: 12,
      }}>
      <ScoreRing score={p.score} size={40} stroke={3} grade={p.grade} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: colors.text, fontFamily: fonts.sans }}>{p.name}</span>
          {p.title && <><span style={{ fontSize: 10, color: colors.border }}>•</span><span style={{ fontSize: 11, color: colors.textMuted, fontFamily: fonts.sans }}>{p.title}</span></>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
          {p.company && <span style={{ fontSize: 11, color: colors.textMuted, fontFamily: fonts.sans }}>{p.company}</span>}
          {p.industry && (
            <span style={{ fontSize: 9, color: colors.textMuted, background: colors.surfaceRaised, padding: '1px 6px', borderRadius: 3, fontFamily: fonts.sans }}>
              {p.industry}
            </span>
          )}
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {([['FIT', p.fit, 'fit'], ['ENG', p.engagement, 'engagement'], ['INT', p.intent, 'intent'], ['TIM', p.timing, 'timing']] as [string, number, string][]).map(([lbl, val, cat]) => (
            <div key={lbl} style={{ textAlign: 'center', minWidth: 32 }}>
              <div style={{ fontSize: 9, color: colors.textMuted, letterSpacing: '0.06em', fontFamily: fonts.sans }}>{lbl}</div>
              <div style={{ fontSize: 12, fontWeight: 700, color: CATEGORY_COLORS[cat], fontFamily: fonts.mono }}>{val ?? '—'}</div>
            </div>
          ))}
        </div>
        <div style={{ textAlign: 'right', minWidth: 40 }}>
          {change !== null && change !== undefined ? (
            <span style={{ fontSize: 11, fontWeight: 700, color: change >= 0 ? '#10b981' : '#ef4444', fontFamily: fonts.mono }}>
              {change >= 0 ? '▲' : '▼'}{Math.abs(change)}
            </span>
          ) : <span style={{ fontSize: 11, color: colors.textMuted }}>—</span>}
        </div>
        <span style={{
          fontSize: 10, fontWeight: 600, color: ACTION_COLORS[p.recommended_action] || colors.textMuted,
          background: `${ACTION_COLORS[p.recommended_action] || '#64748b'}18`,
          padding: '3px 8px', borderRadius: 4, whiteSpace: 'nowrap', fontFamily: fonts.sans,
          minWidth: 120, display: 'inline-block', textAlign: 'center',
        }}>
          {ACTION_LABELS[p.recommended_action] || p.recommended_action}
        </span>
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0 }}>
          <path d="M6 4l4 4-4 4" stroke={colors.textMuted} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
    </div>
  );
}

function ProspectDetail({ p, onBack }: { p: any; onBack: () => void }) {
  const change = p.score_change;
  const bm = p.segment_benchmarks || {};
  const factors: any[] = p.factors || [];
  const maxContrib = Math.max(...factors.map((f: any) => Math.abs(f.contribution)), 1);
  const positiveFactors = factors.filter((f: any) => f.direction === 'positive').sort((a: any, b: any) => b.contribution - a.contribution);
  const negativeFactors = factors.filter((f: any) => f.direction === 'negative').sort((a: any, b: any) => a.contribution - b.contribution);

  const statTile = (label: string, value: string) => (
    <div style={{ background: colors.surfaceRaised, borderRadius: 6, padding: '8px 10px', textAlign: 'center' }}>
      <div style={{ fontSize: 10, color: colors.textMuted, marginBottom: 3, textTransform: 'uppercase', letterSpacing: '0.06em', fontFamily: fonts.sans }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 700, color: colors.text, fontFamily: fonts.mono }}>{value}</div>
    </div>
  );

  const fmt = (v: number, isRate = false) =>
    isRate ? `${(v * 100).toFixed(0)}%` : v > 0 ? `$${(v / 1000).toFixed(0)}K` : '—';

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20, cursor: 'pointer', width: 'fit-content' }} onClick={onBack}>
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path d="M10 12L6 8l4-4" stroke={colors.textMuted} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span style={{ fontSize: 12, color: colors.textMuted, fontFamily: fonts.sans }}>Back to prospects</span>
      </div>

      {/* Profile card */}
      <div style={{ background: colors.surface || '#0f172a', border: `1px solid ${colors.border}`, borderRadius: 10, padding: 20, marginBottom: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 16 }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
              <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: colors.text, fontFamily: fonts.sans }}>{p.name}</h2>
              {p.source && (
                <span style={{ fontSize: 10, fontWeight: 600, color: colors.textMuted, background: colors.surfaceRaised, padding: '2px 8px', borderRadius: 4, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  {p.source}
                </span>
              )}
            </div>
            {(p.title || p.company) && (
              <p style={{ margin: '0 0 2px', fontSize: 13, color: colors.textMuted, fontFamily: fonts.sans }}>
                {[p.title, p.company].filter(Boolean).join(' at ')}
              </p>
            )}
            {p.email && <p style={{ margin: 0, fontSize: 12, color: colors.textMuted, fontFamily: fonts.mono }}>{p.email}</p>}
            {p.recommended_action && (
              <div style={{ marginTop: 10 }}>
                <span style={{
                  fontSize: 12, fontWeight: 600,
                  color: ACTION_COLORS[p.recommended_action],
                  background: `${ACTION_COLORS[p.recommended_action]}18`,
                  padding: '4px 10px', borderRadius: 5, letterSpacing: '0.02em', fontFamily: fonts.sans,
                }}>
                  ▸ {ACTION_LABELS[p.recommended_action]}
                </span>
              </div>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <ScoreRing score={p.score} size={72} stroke={5} grade={p.grade} />
            <div>
              <div style={{ fontSize: 11, color: colors.textMuted, marginBottom: 2, fontFamily: fonts.sans }}>Grade</div>
              <div style={{ fontSize: 28, fontWeight: 800, color: GRADE_COLORS[p.grade] || colors.text, fontFamily: fonts.mono }}>{p.grade}</div>
              {change !== null && change !== undefined && (
                <div style={{ fontSize: 11, color: change >= 0 ? '#10b981' : '#ef4444', fontWeight: 600, fontFamily: fonts.mono }}>
                  {change >= 0 ? '▲' : '▼'} {Math.abs(change)} pts
                </div>
              )}
            </div>
          </div>
        </div>

        {p.summary && (
          <div style={{ marginTop: 14, padding: 12, background: colors.surfaceRaised, borderRadius: 8, borderLeft: `3px solid ${GRADE_COLORS[p.grade] || colors.border}` }}>
            <p style={{ margin: 0, fontSize: 12, color: colors.textSecondary || '#cbd5e1', lineHeight: 1.6, fontFamily: fonts.sans }}>{p.summary}</p>
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 16 }}>
          <ComponentBar label="FIT" value={p.fit ?? 0} color={CATEGORY_COLORS.fit} />
          <ComponentBar label="ENGAGEMENT" value={p.engagement ?? 0} color={CATEGORY_COLORS.engagement} />
          <ComponentBar label="INTENT" value={p.intent ?? 0} color={CATEGORY_COLORS.intent} />
          <ComponentBar label="TIMING" value={p.timing ?? 0} color={CATEGORY_COLORS.timing} />
        </div>
      </div>

      {/* Segment benchmarks */}
      <div style={{ background: colors.surface || '#0f172a', border: `1px solid ${colors.border}`, borderRadius: 10, padding: 16, marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12 }}>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
            <path d="M2 12l3-4 3 2 4-6" stroke="#8b5cf6" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <h3 style={{ margin: 0, fontSize: 13, fontWeight: 700, color: '#c4b5fd', letterSpacing: '0.02em', fontFamily: fonts.sans }}>Segment Benchmarks</h3>
        </div>
        {p.segment && (
          <div style={{ fontSize: 11, color: colors.textMuted, marginBottom: 12, padding: '4px 8px', background: colors.surfaceRaised, borderRadius: 4, display: 'inline-block', fontFamily: fonts.sans }}>
            {p.segment}
          </div>
        )}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(90px, 1fr))', gap: 8 }}>
          {statTile('Meeting Rate', bm.meeting_rate != null ? fmt(bm.meeting_rate, true) : '—')}
          {statTile('Conversion', bm.conversion_rate != null ? fmt(bm.conversion_rate, true) : '—')}
          {statTile('Win Rate', bm.win_rate != null && bm.win_rate > 0 ? fmt(bm.win_rate, true) : '—')}
          {statTile('Avg Deal', bm.avg_deal_size != null && bm.avg_deal_size > 0 ? fmt(bm.avg_deal_size) : '—')}
          {statTile('Avg Cycle', bm.avg_sales_cycle != null && bm.avg_sales_cycle > 0 ? `${bm.avg_sales_cycle}d` : '—')}
        </div>
      </div>

      {/* Factor breakdown */}
      {factors.length > 0 && (
        <div style={{ background: colors.surface || '#0f172a', border: `1px solid ${colors.border}`, borderRadius: 10, padding: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                <path d="M3 3h10M3 8h7M3 13h4" stroke="#f59e0b" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
              <h3 style={{ margin: 0, fontSize: 13, fontWeight: 700, color: '#fbbf24', letterSpacing: '0.02em', fontFamily: fonts.sans }}>
                Score Factors — Show Your Math
              </h3>
            </div>
            <span style={{ fontSize: 10, color: colors.textMuted, fontFamily: fonts.sans }}>
              {p.method} · {p.confidence != null ? `${(p.confidence * 100).toFixed(0)}% confidence` : ''}
            </span>
          </div>

          {positiveFactors.length > 0 && (
            <div style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#10b981', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 4, paddingBottom: 4, borderBottom: `1px solid ${colors.border}`, fontFamily: fonts.sans }}>
                Positive Factors
              </div>
              {positiveFactors.map((f: any, i: number) => <FactorRow key={i} factor={f} maxContrib={maxContrib} />)}
            </div>
          )}

          {negativeFactors.length > 0 && (
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#ef4444', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 4, marginTop: 14, paddingBottom: 4, borderBottom: `1px solid ${colors.border}`, fontFamily: fonts.sans }}>
                Negative Factors
              </div>
              {negativeFactors.map((f: any, i: number) => <FactorRow key={i} factor={f} maxContrib={maxContrib} />)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function ProspectsPage() {
  const [prospects, setProspects] = useState<any[]>([]);
  const [gradeDistribution, setGradeDistribution] = useState<Record<string, number>>({ A: 0, B: 0, C: 0, D: 0, F: 0 });
  const [stats, setStats] = useState({ avg_score: 0, a_grade_count: 0, unworked_ab_count: 0, trending_up_count: 0 });
  const [total, setTotal] = useState(0);
  const [scoredCount, setScoredCount] = useState(0);
  const [lastRunAt, setLastRunAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [runResult, setRunResult] = useState<{ scored: number; duration_ms: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [gradeFilter, setGradeFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('score_desc');
  const [offset, setOffset] = useState(0);
  const LIMIT = 50;

  const [selectedProspect, setSelectedProspect] = useState<any | null>(null);

  const fetchProspects = useCallback(async (gradeF = gradeFilter, searchF = search, sortF = sort, offsetF = offset) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        grade: gradeF, sort: sortF,
        limit: String(LIMIT), offset: String(offsetF),
      });
      if (searchF) params.set('search', searchF);
      const data = await api.get(`/prospect-scores?${params}`) as any;
      setProspects(data.prospects || []);
      setTotal(data.total || 0);
      setGradeDistribution(data.grade_distribution || { A: 0, B: 0, C: 0, D: 0, F: 0 });
      setStats(data.stats || { avg_score: 0, a_grade_count: 0, unworked_ab_count: 0, trending_up_count: 0 });
      setScoredCount(data.scored_count || 0);
      setLastRunAt(data.last_run_at || null);
    } catch (e: any) {
      setError(e.message || 'Failed to load prospects');
    } finally {
      setLoading(false);
    }
  }, [gradeFilter, search, sort, offset]);

  useEffect(() => { fetchProspects(); }, []);

  const handleGrade = (g: string) => {
    setGradeFilter(g); setOffset(0);
    fetchProspects(g, search, sort, 0);
  };
  const handleSearch = (s: string) => {
    setSearch(s); setOffset(0);
    fetchProspects(gradeFilter, s, sort, 0);
  };
  const handleSort = (s: string) => {
    setSort(s); setOffset(0);
    fetchProspects(gradeFilter, search, s, 0);
  };

  const handleRunScoring = async () => {
    setRunning(true); setRunResult(null);
    try {
      const result = await api.post('/prospect-scores/run', {}) as any;
      setRunResult(result);
      await fetchProspects(gradeFilter, search, sort, offset);
    } catch (e: any) {
      setError(e.message || 'Scoring run failed');
    } finally {
      setRunning(false);
    }
  };

  const formatLastRun = (iso: string | null) => {
    if (!iso) return 'never';
    const diff = (Date.now() - new Date(iso).getTime()) / 1000;
    if (diff < 60) return 'just now';
    if (diff < 3600) return `${Math.round(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.round(diff / 3600)}h ago`;
    return `${Math.round(diff / 86400)}d ago`;
  };

  const statCards = [
    { label: 'Avg Score', value: stats.avg_score.toFixed(0) },
    { label: 'A-Grade', value: String(stats.a_grade_count) },
    { label: 'Unworked A/B', value: String(stats.unworked_ab_count) },
    { label: 'Score ▲ This Week', value: String(stats.trending_up_count) },
  ];

  const selectStyle: React.CSSProperties = {
    padding: '4px 8px', borderRadius: 6, border: `1px solid ${colors.border}`,
    background: colors.surfaceRaised, color: colors.text, fontSize: 12,
    fontFamily: fonts.sans, cursor: 'pointer',
  };

  return (
    <div style={{ fontFamily: fonts.sans, background: colors.bg, color: colors.text, minHeight: '100vh', padding: 24 }}>

      {/* Top bar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: colors.text, letterSpacing: '-0.02em' }}>Prospects</h1>
          <div style={{ fontSize: 11, color: colors.textMuted, marginTop: 3, fontFamily: fonts.sans }}>
            Tier 1 — Point Based
            {scoredCount > 0 && ` · ${scoredCount.toLocaleString()} scored`}
            {lastRunAt && ` · Updated ${formatLastRun(lastRunAt)}`}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {runResult && (
            <span style={{ fontSize: 11, color: '#10b981', fontFamily: fonts.sans }}>
              ✓ Scored {runResult.scored} in {(runResult.duration_ms / 1000).toFixed(1)}s
            </span>
          )}
          <button
            onClick={handleRunScoring}
            disabled={running}
            style={{
              padding: '7px 14px', borderRadius: 7, border: '1px solid #3b82f6',
              background: running ? 'transparent' : '#1e3a5f',
              color: '#93c5fd', fontSize: 12, fontWeight: 600,
              cursor: running ? 'not-allowed' : 'pointer', fontFamily: fonts.sans,
              opacity: running ? 0.7 : 1, transition: 'all 0.15s',
            }}>
            {running ? 'Scoring…' : '▶ Run Scoring'}
          </button>
        </div>
      </div>

      {selectedProspect ? (
        <ProspectDetail p={selectedProspect} onBack={() => setSelectedProspect(null)} />
      ) : (
        <>
          {/* Grade pills */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
            {(['all', 'A', 'B', 'C', 'D', 'F'] as const).map(g => {
              const active = gradeFilter === g;
              const count = g === 'all' ? scoredCount : (gradeDistribution[g] || 0);
              const col = g === 'all' ? '#3b82f6' : GRADE_COLORS[g];
              return (
                <button key={g} onClick={() => handleGrade(g)} style={{
                  padding: '5px 14px', borderRadius: 6, fontFamily: fonts.sans, fontSize: 12, fontWeight: 600,
                  border: `1px solid ${active ? col : colors.border}`,
                  background: active ? `${col}18` : (colors.surface || '#0f172a'),
                  color: active ? col : colors.textMuted,
                  cursor: 'pointer', transition: 'all 0.15s',
                }}>
                  {g === 'all' ? 'All' : g} ({count})
                </button>
              );
            })}
            <div style={{ flex: 1 }} />
            <input
              type="text"
              placeholder="Search name, company…"
              value={search}
              onChange={e => handleSearch(e.target.value)}
              style={{ ...selectStyle, minWidth: 180, padding: '5px 10px' }}
            />
            <select value={sort} onChange={e => handleSort(e.target.value)} style={selectStyle}>
              <option value="score_desc">Score ↓</option>
              <option value="score_asc">Score ↑</option>
              <option value="change_desc">Score Change ↓</option>
              <option value="name_asc">Name A–Z</option>
            </select>
          </div>

          {/* Grade scale legend */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 12, flexWrap: 'wrap' }}>
            {([['A', '≥58', '#10b981'], ['B', '45–57', '#3b82f6'], ['C', '30–44', '#f59e0b'], ['D', '15–29', '#f97316'], ['F', '<15', '#ef4444']] as [string, string, string][]).map(([g, range, col]) => (
              <span key={g} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: colors.textMuted, fontFamily: fonts.mono }}>
                <span style={{ fontWeight: 700, color: col }}>{g}</span>
                <span>{range}</span>
              </span>
            ))}
            <span style={{ fontSize: 10, color: colors.textMuted, fontFamily: fonts.sans }}>
              · score/100 &nbsp;·&nbsp; 35% fit · 30% engagement · 25% intent · 10% timing
            </span>
          </div>

          {/* Stat cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 8, marginBottom: 16 }}>
            {statCards.map((s, i) => (
              <div key={i} style={{ background: colors.surface || '#0f172a', border: `1px solid ${colors.border}`, borderRadius: 8, padding: '10px 14px' }}>
                <div style={{ fontSize: 10, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4, fontFamily: fonts.sans }}>{s.label}</div>
                <div style={{ fontSize: 22, fontWeight: 800, color: colors.text, fontFamily: fonts.mono }}>{s.value}</div>
              </div>
            ))}
          </div>

          {/* Column headers */}
          <div style={{ display: 'flex', alignItems: 'center', padding: '6px 16px', gap: 12, marginBottom: 2 }}>
            <div style={{ width: 40 }} />
            <div style={{ flex: 1, fontSize: 10, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600, fontFamily: fonts.sans }}>Prospect</div>
            <div style={{ display: 'flex', gap: 12, fontSize: 10, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600, fontFamily: fonts.sans }}>
              {['Fit', 'Eng', 'Int', 'Tim'].map(l => <span key={l} style={{ minWidth: 32, textAlign: 'center' }}>{l}</span>)}
            </div>
            <span style={{ minWidth: 40, textAlign: 'right', fontSize: 10, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600, fontFamily: fonts.sans }}>Δ</span>
            <span style={{ minWidth: 120, fontSize: 10, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600, fontFamily: fonts.sans }}>Action</span>
            <div style={{ width: 14 }} />
          </div>

          {/* Prospect list */}
          {loading ? (
            <div style={{ padding: 40, textAlign: 'center', color: colors.textMuted, fontSize: 13, fontFamily: fonts.sans }}>Loading prospects…</div>
          ) : error ? (
            <div style={{ padding: 20, background: '#450a0a', border: '1px solid #7f1d1d', borderRadius: 8, color: '#fca5a5', fontSize: 13, fontFamily: fonts.sans }}>
              {error}
              {scoredCount === 0 && (
                <div style={{ marginTop: 8 }}>
                  No scores yet. Click <strong>Run Scoring</strong> to score your contacts.
                </div>
              )}
            </div>
          ) : prospects.length === 0 ? (
            <div style={{ padding: 40, textAlign: 'center', background: colors.surface || '#0f172a', border: `1px solid ${colors.border}`, borderRadius: 10 }}>
              <div style={{ fontSize: 14, color: colors.textMuted, fontFamily: fonts.sans, marginBottom: 10 }}>
                {scoredCount === 0 ? 'No scores yet — click Run Scoring to get started.' : 'No prospects match your filters.'}
              </div>
              {scoredCount === 0 && (
                <button onClick={handleRunScoring} disabled={running} style={{
                  padding: '8px 16px', borderRadius: 7, border: '1px solid #3b82f6',
                  background: '#1e3a5f', color: '#93c5fd', fontSize: 13, fontWeight: 600,
                  cursor: 'pointer', fontFamily: fonts.sans,
                }}>
                  {running ? 'Scoring…' : '▶ Run Scoring Now'}
                </button>
              )}
            </div>
          ) : (
            <div style={{ borderRadius: 10, overflow: 'hidden', border: `1px solid ${colors.border}` }}>
              {prospects.map(p => (
                <ProspectRow key={p.contact_id} p={p} onSelect={setSelectedProspect} />
              ))}
            </div>
          )}

          {/* Pagination */}
          {total > LIMIT && (
            <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginTop: 16 }}>
              <button disabled={offset === 0} onClick={() => { const o = Math.max(0, offset - LIMIT); setOffset(o); fetchProspects(gradeFilter, search, sort, o); }}
                style={{ ...selectStyle, opacity: offset === 0 ? 0.4 : 1 }}>← Prev</button>
              <span style={{ fontSize: 12, color: colors.textMuted, padding: '4px 8px', fontFamily: fonts.sans }}>
                {offset + 1}–{Math.min(offset + LIMIT, total)} of {total}
              </span>
              <button disabled={offset + LIMIT >= total} onClick={() => { const o = offset + LIMIT; setOffset(o); fetchProspects(gradeFilter, search, sort, o); }}
                style={{ ...selectStyle, opacity: offset + LIMIT >= total ? 0.4 : 1 }}>Next →</button>
            </div>
          )}

          {/* Webhook hint */}
          <div style={{ marginTop: 16, padding: 12, background: colors.surface || '#0f172a', border: `1px solid ${colors.border}`, borderRadius: 8, display: 'flex', alignItems: 'center', gap: 10 }}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <circle cx="8" cy="8" r="6" stroke={colors.textMuted} strokeWidth="1.5" />
              <path d="M8 4v4l2.5 1.5" stroke={colors.textMuted} strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            <span style={{ fontSize: 11, color: colors.textMuted, fontFamily: fonts.sans }}>
              All fields available via webhook (prospect.scored events) and CRM writeback. 13 Pandora fields per prospect — score, grade, 4 components, summary, segment, benchmarks, factors, action.
            </span>
          </div>
        </>
      )}
    </div>
  );
}
